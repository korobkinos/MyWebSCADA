import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import type {
  ArchiveFileKind,
  ArchiveConflictPreviewItem,
  ArchiveManifestFile,
  Asset,
  ElementLibrary,
  EventDefinition,
  EventSound,
  HmiObject,
  HmiScreen,
  InternalVariableDefinition,
  LwStoreConfig,
  MacroDefinition,
  ProjectArchiveAssetsImportOptions,
  ProjectArchiveImportOptions,
  ProjectArchiveImportResult,
  ProjectArchiveInspectionResult,
  ProjectArchiveLibraryImportOptions,
  ProjectArchiveMacroImportOptions,
  ProjectArchivePartialImportResult,
  ProjectArchiveScreenImportOptions,
  ProjectArchiveIssue,
  ProjectArchiveManifest,
  ProjectArchiveSignature,
  ProjectArchiveValidationOptions,
  ProjectArchiveValidationResult,
  ScadaProject,
  ScreenArchiveDependencyMode,
  ScreenArchiveData,
  ScreenArchiveExportOptions,
  ScreenArchiveImportOptions,
  ScreenArchiveImportResult,
  ScreenArchiveManifest,
  ScreenArchiveValidationOptions,
  ScreenArchiveValidationResult,
  TagDefinition,
} from "@web-scada/shared";
import {
  projectArchiveImportOptionsSchema,
  projectArchiveAssetsImportOptionsSchema,
  projectArchiveLibraryImportOptionsSchema,
  projectArchiveMacroImportOptionsSchema,
  projectArchiveManifestSchema,
  projectArchiveScreenImportOptionsSchema,
  projectArchiveSignatureSchema,
  projectArchiveValidationOptionsSchema,
  projectSchema,
  screenArchiveDataSchema,
  screenArchiveExportOptionsSchema,
  screenArchiveImportOptionsSchema,
  screenArchiveManifestSchema,
  screenArchiveValidationOptionsSchema,
} from "@web-scada/shared";
import { getRuntimeValueSourceDependencies } from "@web-scada/shared";
import { EventSoundService } from "../events/event-sound-service.js";
import { LibraryService } from "../libraries/library-service.js";
import { buildInternalAndLwTagDefinitions, toInternalTagName, toLwTagName } from "../runtime/internal-variable-service.js";
import { ProjectService } from "./project-service.js";

export type UploadInput = {
  fileName: string;
  mimeType: string;
  size: number;
  content: Buffer;
  name?: string;
  options?: string;
};

type ExportArchiveResult = {
  buffer: Buffer;
  fileName: string;
};

type ParsedZip = {
  files: Map<string, Buffer>;
  sizes: Map<string, number>;
  signature?: ProjectArchiveSignature;
};

type ParsedProjectArchive = ParsedZip & {
  kind: "project";
  manifest: ProjectArchiveManifest;
  project: ScadaProject;
};

type ParsedScreenArchive = ParsedZip & {
  kind: "screen";
  manifest: ScreenArchiveManifest;
  data: ScreenArchiveData;
};

type AnyParsedArchive = ParsedProjectArchive | ParsedScreenArchive;

type StagedProjectImport = {
  stageRoot: string;
  rollbackRoot: string;
  projectFile: string;
  projectDir: string;
  stagedProjectFile: string;
  stagedAssetsDir: string;
  stagedEventSoundsDir: string;
  librariesRoot: string;
  stagedLibrariesRoot: string;
  libraryIds: string[];
};

type ResolvedAssets = {
  nextAssets: Asset[];
  assetIdMap: Map<string, string>;
  importedAssets: number;
  reusedAssets: number;
  copiedAssets: number;
};

type ResolvedLibraries = {
  libraryIdMap: Map<string, string>;
  nextProjectLibraryRefs: NonNullable<ScadaProject["libraries"]>;
  importedLibraries: number;
  reusedLibraries: number;
  copiedLibraries: number;
};

type ResolvedMacros = {
  macros: MacroDefinition[];
  idMap: Map<string, string>;
  importedMacros: number;
  reusedMacros: number;
  copiedMacros: number;
};

type ResolvedTags = {
  tags: TagDefinition[];
  importedTags: number;
  skippedTags: number;
};

type ResolvedVariables = {
  variables: InternalVariableDefinition[];
  idMap: Map<string, string>;
  importedVariables: number;
  reusedVariables: number;
};

type ResolvedLwStore = {
  lwStore?: LwStoreConfig;
  importedLw: number;
  reusedLw: number;
};

const PROJECT_FORMAT = "mywebscada-project";
const SCREEN_FORMAT = "mywebscada-screen";
const FORMAT_VERSION = 1;
const MAX_ARCHIVE_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 5000;
const ALLOWED_EXTENSIONS = new Set([".json", ".png", ".jpg", ".jpeg", ".svg", ".mp3", ".wav", ".ogg"]);
const ALLOWED_ASSET_MIME = new Set(["image/png", "image/jpeg", "image/svg+xml"]);
const ALLOWED_SOUND_MIME = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/ogg"]);

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function archiveSecret(): string | undefined {
  const value = process.env.PROJECT_ARCHIVE_SECRET?.trim();
  return value || undefined;
}

function hmacSha256(buffer: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(buffer).digest("hex");
}

function timingSafeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
}

function addIssue(out: ProjectArchiveIssue[], code: string, message: string, filePath?: string): void {
  out.push(filePath ? { code, message, path: filePath } : { code, message });
}

function normalizeArchivePath(input: string): { ok: true; value: string } | { ok: false; reason: string } {
  if (!input) {
    return { ok: false, reason: "Path is empty" };
  }
  const replaced = input.replace(/\\/g, "/").trim();
  if (!replaced) {
    return { ok: false, reason: "Path is empty" };
  }
  if (replaced.includes("\0")) {
    return { ok: false, reason: "Path contains null byte" };
  }
  if (replaced.startsWith("/") || /^[a-zA-Z]:/.test(replaced)) {
    return { ok: false, reason: "Absolute paths are not allowed" };
  }
  const segments = replaced.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return { ok: false, reason: "Path traversal is not allowed" };
  }
  return { ok: true, value: segments.join("/") };
}

function isSupportedArchiveFile(archivePath: string): boolean {
  return ALLOWED_EXTENSIONS.has(path.posix.extname(archivePath).toLowerCase());
}

function slugifyFileName(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "mywebscada";
}

function safeId(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
}

function parseStoredFileName(filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }
  return filePath.replace(/\\/g, "/").split("/").filter(Boolean).at(-1);
}

function makeUniqueId(sourceId: string, taken: Set<string>, fallback: string): string {
  const base = safeId(sourceId) || fallback;
  if (!taken.has(base)) {
    return base;
  }
  for (let i = 2; i < 10_000; i += 1) {
    const next = `${base}-${i}`;
    if (!taken.has(next)) {
      return next;
    }
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedFileName(input: string | undefined): string {
  return (input ?? "").replace(/\\/g, "/").split("/").filter(Boolean).at(-1)?.trim().toLowerCase() ?? "";
}

function assetExtension(asset: Asset): string {
  return path.posix.extname(asset.fileName || asset.storagePath) || `.${asset.type || "asset"}`;
}

function macroContentKey(macro: MacroDefinition): string {
  return sha256(Buffer.from(stableJson({ language: macro.language, code: macro.code }), "utf8"));
}

function normalizedVariableDefinition(variable: InternalVariableDefinition): unknown {
  const { id: _id, currentValue: _currentValue, createdAt: _createdAt, updatedAt: _updatedAt, ...definition } = variable;
  return definition;
}

function normalizedTagDefinition(tag: TagDefinition): unknown {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...definition } = tag;
  return definition;
}

function withProjectAssetPreview(asset: Asset): Asset {
  return {
    ...asset,
    previewUrl: `/api/assets/${encodeURIComponent(asset.id)}/file`,
  };
}

function withLibraryAssetPreview(libraryId: string, asset: Asset): Asset {
  return {
    ...asset,
    previewUrl: `/api/libraries/${encodeURIComponent(libraryId)}/assets/${encodeURIComponent(asset.id)}/file`,
  };
}

function normalizeImportedLibrary(library: ElementLibrary, id: string): ElementLibrary {
  return {
    ...library,
    id,
    assets: library.assets.map((asset) => withLibraryAssetPreview(id, asset)),
    elements: library.elements.map((element) => ({
      ...element,
      libraryId: element.libraryId ? id : element.libraryId,
    })),
    macros: library.macros ?? [],
  };
}

function collectObjectAssetIds(object: HmiObject, out: Set<string>): void {
  const visit = (value: unknown, keyHint = ""): void => {
    if (typeof value === "string") {
      const key = keyHint.toLowerCase();
      if (key === "assetid" || key.endsWith("assetid")) {
        out.add(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, keyHint));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, key);
      }
    }
  };
  visit(object);
}

function collectObjectMacroIds(object: HmiObject, out: Set<string>): void {
  const visit = (value: unknown, keyHint = ""): void => {
    if (typeof value === "string") {
      const key = keyHint.toLowerCase();
      if (key === "macroid" || key.endsWith("macroid")) {
        out.add(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, keyHint));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, key);
      }
    }
  };
  visit(object);
}

function collectObjectLibraryIds(object: HmiObject, out: Set<string>): void {
  if (object.type === "libraryElementInstance") {
    out.add(object.libraryId);
  }
  if (object.type === "group") {
    for (const child of object.objects) {
      collectObjectLibraryIds(child, out);
    }
  }
}

const EXPLICIT_TAG_REFERENCE_KEYS = new Set([
  "tag",
  "tagname",
  "tagid",
  "sourcetag",
  "sourcetagname",
  "readtag",
  "writetag",
  "pulsetag",
  "toggletag",
  "visibletag",
  "disabledtag",
  "statetag",
  "valuetag",
  "opentag",
  "closedtag",
  "errortag",
  "faulttag",
  "runtag",
  "commandopentag",
  "commandclosetag",
  "commandstarttag",
  "commandstoptag",
  "triggertag",
  "speedtag",
  "acktagname",
  "notificationtagname",
  "elapsedtimetagname",
  "securitytagname",
]);

function isStaticReferenceValue(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed)
    && !trimmed.includes("${")
    && !trimmed.includes("{{")
    && !trimmed.startsWith(".")
    && !trimmed.startsWith("$binding");
}

function collectObjectTagNames(object: HmiObject, out: Set<string>): void {
  const visit = (value: unknown, keyHint = ""): void => {
    if (typeof value === "string") {
      const key = keyHint.toLowerCase();
      if (EXPLICIT_TAG_REFERENCE_KEYS.has(key) && isStaticReferenceValue(value)) {
        out.add(value.trim());
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, keyHint));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, key);
      }
    }
  };
  visit(object);
}

function macroTagReferences(macroCode: string): string[] {
  const refs = new Set<string>();
  const pattern = /\b(?:tag|readTag|writeTag|pulseTag|toggleTag)\s*\(\s*(['"`])([^'"`]+)\1/g;
  let match = pattern.exec(macroCode);
  while (match) {
    const tagName = match[2]?.trim();
    if (tagName && isStaticReferenceValue(tagName)) {
      refs.add(tagName);
    }
    match = pattern.exec(macroCode);
  }
  return [...refs];
}

function collectExpressionTagReferences(expression: string): string[] {
  const refs = new Set<string>();
  const pattern = /\b(?:tag|readTag|writeTag|pulseTag|toggleTag)\s*\(\s*(['"`])([^'"`]+)\1/g;
  let match = pattern.exec(expression);
  while (match) {
    const value = match[2]?.trim();
    if (value && isStaticReferenceValue(value)) {
      refs.add(value);
    }
    match = pattern.exec(expression);
  }
  return [...refs];
}

type ScreenDependencyRefs = {
  assetIds: Set<string>;
  libraryIds: Set<string>;
  libraryElements: Map<string, Set<string>>;
  tagNames: Set<string>;
  variableNames: Set<string>;
  lwAddresses: Set<number>;
  macroIds: Set<string>;
  screenIds: Set<string>;
  dynamicWarnings: ProjectArchiveIssue[];
};

function makeScreenDependencyRefs(): ScreenDependencyRefs {
  return {
    assetIds: new Set(),
    libraryIds: new Set(),
    libraryElements: new Map(),
    tagNames: new Set(),
    variableNames: new Set(),
    lwAddresses: new Set(),
    macroIds: new Set(),
    screenIds: new Set(),
    dynamicWarnings: [],
  };
}

function addLibraryElementRef(refs: ScreenDependencyRefs, libraryId: string, elementId: string): void {
  refs.libraryIds.add(libraryId);
  const elements = refs.libraryElements.get(libraryId) ?? new Set<string>();
  elements.add(elementId);
  refs.libraryElements.set(libraryId, elements);
}

function collectRuntimeActionRefs(action: unknown, refs: ScreenDependencyRefs): void {
  if (!action || typeof action !== "object") {
    return;
  }
  const value = action as Record<string, unknown>;
  switch (value.type) {
    case "openScreen":
      if (typeof value.screenId === "string") {
        refs.screenIds.add(value.screenId);
      }
      break;
    case "openPopup":
      if (typeof value.popupScreenId === "string") {
        refs.screenIds.add(value.popupScreenId);
      }
      if (typeof value.tagPrefix === "string" && value.tagPrefix.trim()) {
        addIssue(refs.dynamicWarnings, "DYNAMIC_TAG_REFERENCE", "Popup tagPrefix may resolve tags dynamically.");
      }
      break;
    case "runMacro":
      if (typeof value.macroId === "string") {
        refs.macroIds.add(value.macroId);
      }
      break;
    case "write":
    case "pulse":
    case "toggle":
      if (typeof value.tag === "string" && isStaticReferenceValue(value.tag)) {
        refs.tagNames.add(value.tag);
      }
      break;
    case "writeConst":
    case "writeNumberPrompt":
      if (value.target === "tag" && typeof value.name === "string" && isStaticReferenceValue(value.name)) {
        refs.tagNames.add(value.name);
      }
      if (value.target === "variable" && typeof value.name === "string") {
        refs.variableNames.add(value.name);
      }
      break;
    case "setLW":
      if (typeof value.address === "number" && Number.isFinite(value.address)) {
        refs.lwAddresses.add(Math.max(0, Math.floor(value.address)));
      }
      break;
    case "setInternalVar":
      if (typeof value.name === "string") {
        refs.variableNames.add(value.name);
      }
      break;
    default:
      break;
  }
}

function collectRuntimeValueSourceRefs(source: unknown, refs: ScreenDependencyRefs): void {
  if (!source || typeof source !== "object") {
    return;
  }
  const dependencies = getRuntimeValueSourceDependencies(source as Parameters<typeof getRuntimeValueSourceDependencies>[0]);
  for (const dependency of dependencies) {
    if (dependency.type === "tag") {
      refs.tagNames.add(dependency.tag);
    } else if (dependency.type === "lw") {
      refs.lwAddresses.add(dependency.address);
    } else if (dependency.type === "internal") {
      refs.variableNames.add(dependency.name);
    }
  }
}

function collectBindingRefs(bindings: unknown, refs: ScreenDependencyRefs): void {
  if (!bindings || typeof bindings !== "object") {
    return;
  }
  for (const binding of Object.values(bindings as Record<string, unknown>)) {
    if (!binding || typeof binding !== "object") {
      continue;
    }
    const value = binding as Record<string, unknown>;
    if (value.mode === "tag" && typeof value.source === "string" && isStaticReferenceValue(value.source)) {
      refs.tagNames.add(value.source);
    }
    if (value.mode === "expr" && typeof value.source === "string") {
      const refsFromExpression = collectExpressionTagReferences(value.source);
      refsFromExpression.forEach((tag) => refs.tagNames.add(tag));
      if (refsFromExpression.length === 0 && /\btag\s*\(/.test(value.source)) {
        addIssue(refs.dynamicWarnings, "UNRESOLVED_DYNAMIC_REFERENCE", "Expression contains a dynamic tag reference.");
      }
    }
  }
}

function collectKnownObjectRefs(object: HmiObject, refs: ScreenDependencyRefs): void {
  collectBindingRefs(object.bindings, refs);
  if (object.visibleTag && isStaticReferenceValue(object.visibleTag)) {
    refs.tagNames.add(object.visibleTag);
  }
  if (object.disabledTag && isStaticReferenceValue(object.disabledTag)) {
    refs.tagNames.add(object.disabledTag);
  }
  if (object.onPressMacroId) {
    refs.macroIds.add(object.onPressMacroId);
  }
  if (object.onReleaseMacroId) {
    refs.macroIds.add(object.onReleaseMacroId);
  }
  if (object.tagIndexing || object.tagIndexingByField) {
    addIssue(refs.dynamicWarnings, "UNRESOLVED_DYNAMIC_REFERENCE", "Indexed tag addressing may reference tags dynamically.", `object:${object.id}`);
  }

  if ("action" in object) {
    collectRuntimeActionRefs((object as { action?: unknown }).action, refs);
  }
  if (object.type === "button") {
    for (const step of object.actions ?? []) {
      collectRuntimeActionRefs(step.action, refs);
    }
  }

  switch (object.type) {
    case "group":
      object.objects.forEach((child) => collectKnownObjectRefs(child, refs));
      break;
    case "image":
      if (object.assetId) {
        refs.assetIds.add(object.assetId);
      }
      if (object.stateTag && isStaticReferenceValue(object.stateTag)) {
        refs.tagNames.add(object.stateTag);
      }
      object.stateImages?.forEach((state) => {
        if (state.assetId) {
          refs.assetIds.add(state.assetId);
        }
      });
      break;
    case "stateImage":
      if (isStaticReferenceValue(object.tag)) {
        refs.tagNames.add(object.tag);
      }
      if (object.defaultAssetId) {
        refs.assetIds.add(object.defaultAssetId);
      }
      if (object.badQualityAssetId) {
        refs.assetIds.add(object.badQualityAssetId);
      }
      object.states.forEach((state) => {
        if (state.assetId) {
          refs.assetIds.add(state.assetId);
        }
      });
      break;
    case "numeric-image-indicator":
      if (object.tag) {
        refs.tagNames.add(object.tag);
      }
      if (object.defaultAssetId) {
        refs.assetIds.add(object.defaultAssetId);
      }
      if (object.badQualityAssetId) {
        refs.assetIds.add(object.badQualityAssetId);
      }
      object.states.forEach((state) => {
        if (state.assetId) {
          refs.assetIds.add(state.assetId);
        }
      });
      break;
    case "button":
      if (object.backgroundAssetId) {
        refs.assetIds.add(object.backgroundAssetId);
      }
      if (object.pressedBackgroundAssetId) {
        refs.assetIds.add(object.pressedBackgroundAssetId);
      }
      if (object.disabledBackgroundAssetId) {
        refs.assetIds.add(object.disabledBackgroundAssetId);
      }
      break;
    case "libraryElementInstance":
      addLibraryElementRef(refs, object.libraryId, object.elementId);
      if (object.tagPrefix) {
        addIssue(refs.dynamicWarnings, "UNRESOLVED_DYNAMIC_REFERENCE", "Library tagPrefix may resolve tags dynamically.", `object:${object.id}`);
      }
      for (const assignment of Object.values(object.bindingAssignments ?? {})) {
        if (assignment.baseTag && isStaticReferenceValue(assignment.baseTag)) {
          refs.tagNames.add(assignment.baseTag);
        }
        if (assignment.overrideTag && isStaticReferenceValue(assignment.overrideTag)) {
          refs.tagNames.add(assignment.overrideTag);
        }
        collectRuntimeValueSourceRefs(assignment.prefixSource, refs);
        collectRuntimeValueSourceRefs(assignment.indexOffsetSource, refs);
        collectRuntimeValueSourceRefs(assignment.overrideTagSource, refs);
        if (assignment.prefix || assignment.prefixMode?.type !== "none" || assignment.indexMode?.type !== "none") {
          addIssue(refs.dynamicWarnings, "UNRESOLVED_DYNAMIC_REFERENCE", "Library binding may derive tag names dynamically.", `object:${object.id}`);
        }
      }
      break;
    case "frame":
      refs.screenIds.add(object.screenId);
      if (object.tagPrefix) {
        addIssue(refs.dynamicWarnings, "UNRESOLVED_DYNAMIC_REFERENCE", "Frame tagPrefix may resolve tags dynamically.", `object:${object.id}`);
      }
      break;
    case "trendChart":
      object.selectedTags.forEach((series) => {
        if (isStaticReferenceValue(series.tag)) {
          refs.tagNames.add(series.tag);
        }
      });
      break;
    case "eventTable":
      if (object.sourceTagFilter) {
        refs.tagNames.add(object.sourceTagFilter);
      }
      break;
    case "valueSelect":
      if (object.target.type === "tag" && isStaticReferenceValue(object.target.tag)) {
        refs.tagNames.add(object.target.tag);
      } else if (object.target.type === "internal") {
        refs.variableNames.add(object.target.name);
      } else if (object.target.type === "lw") {
        refs.lwAddresses.add(object.target.address);
      }
      break;
    default:
      collectObjectTagNames(object, refs.tagNames);
      collectObjectAssetIds(object, refs.assetIds);
      break;
  }
}

function collectDependencies(project: ScadaProject, screen: HmiScreen): {
  assets: Asset[];
  libraries: string[];
  tags: TagDefinition[];
  variables: InternalVariableDefinition[];
  lwStore?: LwStoreConfig;
  macros: MacroDefinition[];
  events: EventDefinition[];
  warnings: ProjectArchiveIssue[];
} {
  const refs = makeScreenDependencyRefs();

  for (const object of screen.objects) {
    collectKnownObjectRefs(object, refs);
  }

  for (const macro of project.macros ?? []) {
    const screenTrigger = macro.triggers?.some((trigger) => {
      if (trigger.type === "onScreenOpen" || trigger.type === "onScreenClose") {
        return trigger.screenKey === screen.id || trigger.screenKey === screen.name;
      }
      if (trigger.type === "onButtonClick") {
        return trigger.screenKey === screen.id || trigger.screenKey === screen.name;
      }
      return false;
    });
    if (screenTrigger) {
      refs.macroIds.add(macro.id);
    }
  }

  const macros = (project.macros ?? []).filter((macro) => refs.macroIds.has(macro.id));
  for (const macro of macros) {
    macroTagReferences(macro.code).forEach((tagName) => refs.tagNames.add(tagName));
    macro.triggers?.forEach((trigger) => {
      if (trigger.type === "onTagChange") {
        refs.tagNames.add(trigger.tag);
      }
      if (trigger.type === "onCondition") {
        collectExpressionTagReferences(trigger.condition).forEach((tagName) => refs.tagNames.add(tagName));
      }
    });
  }

  return {
    assets: (project.assets ?? []).filter((asset) => refs.assetIds.has(asset.id)),
    libraries: [...refs.libraryIds],
    tags: collectReferencedTags(project, refs),
    variables: collectReferencedVariables(project, refs),
    lwStore: collectReferencedLwStore(project, refs),
    macros,
    events: [],
    warnings: refs.dynamicWarnings,
  };
}

function collectReferencedTags(project: ScadaProject, refs: ScreenDependencyRefs): TagDefinition[] {
  const names = new Set(refs.tagNames);
  for (const variableName of refs.variableNames) {
    names.add(variableName);
    names.add(toInternalTagName(variableName));
  }
  for (const address of refs.lwAddresses) {
    names.add(toLwTagName(address));
  }
  return completeGeneratedSimulationTags(project, names).filter((tag) => names.has(tag.name));
}

function collectReferencedVariables(project: ScadaProject, refs: ScreenDependencyRefs): InternalVariableDefinition[] {
  const names = new Set(refs.variableNames);
  for (const tagName of refs.tagNames) {
    names.add(tagName);
  }
  return (project.variables ?? []).filter((variable) =>
    names.has(variable.name) ||
    names.has(toInternalTagName(variable.name)) ||
    (typeof variable.lwAddress === "number" && refs.lwAddresses.has(variable.lwAddress)),
  );
}

function collectReferencedLwStore(project: ScadaProject, refs: ScreenDependencyRefs): LwStoreConfig | undefined {
  const values = project.lwStore?.values ?? {};
  const selected: Record<number, number> = {};
  for (const [addressText, value] of Object.entries(values)) {
    const address = Number(addressText);
    if (Number.isFinite(address) && refs.lwAddresses.has(address)) {
      selected[address] = value;
    }
  }
  for (const variable of project.variables ?? []) {
    if (typeof variable.lwAddress === "number" && refs.variableNames.has(variable.name) && values[variable.lwAddress] !== undefined) {
      selected[variable.lwAddress] = values[variable.lwAddress]!;
    }
  }
  return Object.keys(selected).length > 0 ? { mode: project.lwStore?.mode, values: selected } : undefined;
}

function replaceIdsInUnknown(value: unknown, maps: { assetIds: Map<string, string>; libraryIds: Map<string, string>; macroIds?: Map<string, string>; variableIds?: Map<string, string> }): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replaceIdsInUnknown(item, maps));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string") {
      const lower = key.toLowerCase();
      if ((lower === "assetid" || lower.endsWith("assetid")) && maps.assetIds.has(child)) {
        next[key] = maps.assetIds.get(child);
        continue;
      }
      if (lower === "libraryid" && maps.libraryIds.has(child)) {
        next[key] = maps.libraryIds.get(child);
        continue;
      }
      if ((lower === "macroid" || lower.endsWith("macroid")) && maps.macroIds?.has(child)) {
        next[key] = maps.macroIds.get(child);
        continue;
      }
      if ((lower === "variableid" || lower.endsWith("variableid")) && maps.variableIds?.has(child)) {
        next[key] = maps.variableIds.get(child);
        continue;
      }
    }
    next[key] = replaceIdsInUnknown(child, maps);
  }
  return next;
}

function canonicalLibraryPayload(library: ElementLibrary, files: Map<string, Buffer>, prefix: string): Buffer {
  const canonicalLibrary = {
    ...library,
    id: "__library__",
    assets: library.assets.map((asset) => ({
      ...asset,
      previewUrl: "",
    })),
    elements: library.elements.map((element) => ({
      ...element,
      libraryId: element.libraryId ? "__library__" : element.libraryId,
    })),
    macros: library.macros ?? [],
  };
  const chunks: Uint8Array[] = [Buffer.from(stableJson(canonicalLibrary), "utf8")];
  const paths = [...files.keys()].filter((item) => item.startsWith(prefix) && item !== `${prefix}library.json`).sort();
  for (const item of paths) {
    chunks.push(Buffer.from(`\n${item.slice(prefix.length)}\n`, "utf8"));
    chunks.push(files.get(item)!);
  }
  return Buffer.concat(chunks);
}

function collectProjectReferenceRefs(project: ScadaProject): ScreenDependencyRefs {
  const refs = makeScreenDependencyRefs();
  for (const screen of project.screens) {
    screen.objects.forEach((object) => collectKnownObjectRefs(object, refs));
  }
  for (const macro of project.macros ?? []) {
    macroTagReferences(macro.code).forEach((tagName) => refs.tagNames.add(tagName));
    macroVariableReferences(macro.code).forEach((variableName) => refs.variableNames.add(variableName));
    macroLwReferences(macro.code).forEach((address) => refs.lwAddresses.add(address));
    for (const trigger of macro.triggers ?? []) {
      if (trigger.type === "onTagChange" && isStaticReferenceValue(trigger.tag)) {
        refs.tagNames.add(trigger.tag);
      }
      if (trigger.type === "onCondition") {
        collectExpressionTagReferences(trigger.condition).forEach((tagName) => refs.tagNames.add(tagName));
      }
    }
  }
  for (const event of project.events ?? []) {
    [
      event.sourceTagName,
      event.ackTagName,
      event.notificationTagName,
      event.elapsedTimeTagName,
      event.securityTagName,
    ].forEach((tagName) => {
      if (tagName && isStaticReferenceValue(tagName)) {
        refs.tagNames.add(tagName);
      }
    });
    [...(event.onActiveActions ?? []), ...(event.onClearedActions ?? []), ...(event.onAckActions ?? [])].forEach((action) =>
      collectRuntimeActionRefs(action, refs),
    );
  }
  return refs;
}

function macroVariableReferences(macroCode: string): string[] {
  const refs = new Set<string>();
  const pattern = /\b(?:getVar|setVar|readVariable|writeVariable)\s*\(\s*(['"`])([^'"`]+)\1/g;
  let match = pattern.exec(macroCode);
  while (match) {
    const variableName = match[2]?.trim();
    if (variableName && isStaticReferenceValue(variableName)) {
      refs.add(variableName);
    }
    match = pattern.exec(macroCode);
  }
  return [...refs];
}

function macroLwReferences(macroCode: string): number[] {
  const refs = new Set<number>();
  const pattern = /\b(?:getLW|setLW)\s*\(\s*(\d+)/g;
  let match = pattern.exec(macroCode);
  while (match) {
    const address = Number(match[1]);
    if (Number.isFinite(address)) {
      refs.add(Math.max(0, Math.floor(address)));
    }
    match = pattern.exec(macroCode);
  }
  return [...refs];
}

function buildBindableTagNames(project: ScadaProject): Set<string> {
  const names = new Set<string>();
  const requiredNames = collectProjectReferenceRefs(project).tagNames;
  for (const tag of completeGeneratedSimulationTags(project, requiredNames)) {
    names.add(tag.name);
  }
  for (const definition of buildInternalAndLwTagDefinitions(project.variables ?? [], project.lwStore)) {
    names.add(definition.name);
  }
  for (const variable of project.variables ?? []) {
    names.add(variable.name);
    names.add(toInternalTagName(variable.name));
  }
  return names;
}

function completeGeneratedSimulationTags(project: ScadaProject, requiredNames?: Set<string>): TagDefinition[] {
  const tags = [...project.tags];
  const existingNames = new Set(tags.map((tag) => tag.name));
  const simulatedDriver = project.drivers.find((driver) => driver.type === "simulated" && driver.enabled !== false);
  if (!simulatedDriver || !requiredNames) {
    return tags;
  }

  const simulatedTemplates = tags.filter((tag) => (tag.sourceType ?? (tag.driverId ? undefined : "simulated")) === "simulated" || tag.driverId === simulatedDriver.id);
  const templateByPrefix = new Map<string, TagDefinition>();
  for (const tag of simulatedTemplates) {
    const match = /^(.*_)(\d+)$/.exec(tag.name);
    if (match && !templateByPrefix.has(match[1]!)) {
      templateByPrefix.set(match[1]!, tag);
    }
  }

  for (const name of requiredNames) {
    if (existingNames.has(name)) {
      continue;
    }
    const match = /^(.*_)(\d+)$/.exec(name);
    if (!match) {
      continue;
    }
    const template = templateByPrefix.get(match[1]!) ?? (match[1] === "AI_SIM_" ? simulatedTemplates[0] : undefined);
    if (!template) {
      continue;
    }
    const generated: TagDefinition = {
      ...template,
      id: undefined,
      name,
      description: `Generated simulation tag ${name}`,
      sourceType: "simulated",
      driverId: template.driverId ?? simulatedDriver.id,
      createdAt: undefined,
      updatedAt: undefined,
    };
    tags.push(generated);
    existingNames.add(name);
  }
  return tags;
}

function completePortableProjectForArchive(project: ScadaProject): ScadaProject {
  const refs = collectProjectReferenceRefs(project);
  const completedTags = completeGeneratedSimulationTags(project, refs.tagNames);
  const portableVariables = project.variables?.map(({ currentValue: _currentValue, ...variable }) => variable);
  if (completedTags.length === project.tags.length && portableVariables === project.variables) {
    return project;
  }
  return { ...project, tags: completedTags, variables: portableVariables };
}

export class ProjectArchiveService {
  public constructor(
    private readonly projectService: ProjectService,
    private readonly libraryService: LibraryService,
    private readonly eventSoundService: EventSoundService,
  ) {}

  public async exportProjectArchive(): Promise<ExportArchiveResult> {
    const project = projectSchema.parse(completePortableProjectForArchive(this.projectService.getProject()));
    const zip = new AdmZip();
    const files: ArchiveManifestFile[] = [];
    const projectDir = path.dirname(this.projectService.getProjectFile());

    const addFile = (entryPath: string, buffer: Buffer, type: ArchiveFileKind): void => {
      zip.addFile(entryPath, buffer);
      files.push({ path: entryPath, type, size: buffer.byteLength, sha256: sha256(buffer) });
    };
    const addJson = (entryPath: string, value: unknown, type: ArchiveFileKind): void => {
      addFile(entryPath, Buffer.from(JSON.stringify(value, null, 2), "utf8"), type);
    };
    const readRequired = async (absolutePath: string, archivePath: string): Promise<Buffer> => {
      const buffer = await readFile(absolutePath).catch(() => undefined);
      if (!buffer) {
        throw new Error(`Archive export blocked: referenced file is missing (${archivePath})`);
      }
      return buffer;
    };

    addJson("project.json", project, "project");

    for (const asset of project.assets ?? []) {
      const normalized = normalizeArchivePath(asset.storagePath);
      if (!normalized.ok) {
        throw new Error(`Archive export blocked: invalid asset path '${asset.storagePath}': ${normalized.reason}`);
      }
      const absolute = path.join(projectDir, ...normalized.value.split("/"));
      addFile(normalized.value, await readRequired(absolute, normalized.value), "asset");
    }

    for (const sound of project.eventSounds ?? []) {
      const storedFileName = parseStoredFileName(sound.filePath);
      if (!storedFileName) {
        continue;
      }
      const absolute = path.join(this.eventSoundService.getStorageDir(), storedFileName);
      addFile(`data/event-sounds/${storedFileName}`, await readRequired(absolute, `data/event-sounds/${storedFileName}`), "eventSound");
    }

    const attachedIds = new Set((project.libraries ?? []).filter((ref) => ref.enabled !== false).map((ref) => ref.libraryId));
    const libraries = await this.libraryService.listLibraries();
    for (const libraryId of attachedIds) {
      if (!libraries.some((item) => item.id === libraryId)) {
        throw new Error(`Archive export blocked: enabled library is missing (${libraryId})`);
      }
    }
    for (const library of libraries.filter((item) => attachedIds.has(item.id))) {
      const libraryDir = path.dirname(this.libraryService.libraryFilePath(library.id));
      addJson(`libraries/${library.id}/library.json`, library, "library");
      for (const asset of library.assets ?? []) {
        const normalized = normalizeArchivePath(asset.storagePath);
        if (!normalized.ok) {
          throw new Error(`Archive export blocked: invalid library asset path '${asset.storagePath}': ${normalized.reason}`);
        }
        const absolute = path.join(libraryDir, ...normalized.value.split("/"));
        addFile(`libraries/${library.id}/${normalized.value}`, await readRequired(absolute, `libraries/${library.id}/${normalized.value}`), "libraryAsset");
      }
      await this.addLooseLibraryFiles(libraryDir, `libraries/${library.id}`, zip, files);
    }

    const manifest: ProjectArchiveManifest = {
      format: PROJECT_FORMAT,
      formatVersion: FORMAT_VERSION,
      exportedAt: nowIso(),
      appName: "MyWebSCADA",
      projectName: project.name,
      counts: {
        screens: project.screens.length,
        tags: project.tags.length,
        assets: (project.assets ?? []).length,
        libraries: attachedIds.size,
        events: (project.events ?? []).length,
        macros: (project.macros ?? []).length,
        variables: (project.variables ?? []).length,
      },
      files,
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    addFile("manifest.json", manifestBytes, "metadata");
    this.addSignature(zip, manifestBytes);

    return {
      buffer: zip.toBuffer() as Buffer,
      fileName: `${slugifyFileName(project.name)}.webscada-project.zip`,
    };
  }

  public async exportScreenArchive(screenId: string, options?: ScreenArchiveExportOptions): Promise<ExportArchiveResult> {
    const parsedOptions = screenArchiveExportOptionsSchema.parse(options ?? {});
    const project = projectSchema.parse(this.projectService.getProject());
    const screen = project.screens.find((item) => item.id === screenId);
    if (!screen) {
      throw new Error("Screen not found");
    }

    const dependencies = this.collectScreenArchiveDependencies(project, screen, parsedOptions.dependencyMode);
    const libraries = await this.libraryService.listLibraries();
    const librarySet = new Set(dependencies.libraries);
    for (const libraryId of librarySet) {
      if (!libraries.some((item) => item.id === libraryId)) {
        throw new Error(`Archive export blocked: referenced library is missing (${libraryId})`);
      }
    }
    const includedLibraries = libraries.filter((library) => librarySet.has(library.id));
    const data: ScreenArchiveData = {
      screen,
      assets: dependencies.assets,
      libraries: includedLibraries,
      tags: dependencies.tags,
      variables: dependencies.variables,
      lwStore: dependencies.lwStore,
      macros: dependencies.macros,
      events: dependencies.events,
    };

    const zip = new AdmZip();
    const files: ArchiveManifestFile[] = [];
    const projectDir = path.dirname(this.projectService.getProjectFile());
    const addFile = (entryPath: string, buffer: Buffer, type: ArchiveFileKind): void => {
      zip.addFile(entryPath, buffer);
      files.push({ path: entryPath, type, size: buffer.byteLength, sha256: sha256(buffer) });
    };
    const addJson = (entryPath: string, value: unknown, type: ArchiveFileKind): void => {
      addFile(entryPath, Buffer.from(JSON.stringify(value, null, 2), "utf8"), type);
    };
    const readRequired = async (absolutePath: string, archivePath: string): Promise<Buffer> => {
      const buffer = await readFile(absolutePath).catch(() => undefined);
      if (!buffer) {
        throw new Error(`Archive export blocked: referenced file is missing (${archivePath})`);
      }
      return buffer;
    };

    addJson("screen.json", data, "screen");
    for (const asset of data.assets) {
      const normalized = normalizeArchivePath(asset.storagePath);
      if (!normalized.ok) {
        throw new Error(`Archive export blocked: invalid asset path '${asset.storagePath}': ${normalized.reason}`);
      }
      const absolute = path.join(projectDir, ...normalized.value.split("/"));
      addFile(normalized.value, await readRequired(absolute, normalized.value), "asset");
    }
    for (const library of data.libraries) {
      const libraryDir = path.dirname(this.libraryService.libraryFilePath(library.id));
      addJson(`libraries/${library.id}/library.json`, library, "library");
      for (const asset of library.assets ?? []) {
        const normalized = normalizeArchivePath(asset.storagePath);
        if (!normalized.ok) {
          throw new Error(`Archive export blocked: invalid library asset path '${asset.storagePath}': ${normalized.reason}`);
        }
        const absolute = path.join(libraryDir, ...normalized.value.split("/"));
        addFile(`libraries/${library.id}/${normalized.value}`, await readRequired(absolute, `libraries/${library.id}/${normalized.value}`), "libraryAsset");
      }
      await this.addLooseLibraryFiles(libraryDir, `libraries/${library.id}`, zip, files);
    }

    const manifest: ScreenArchiveManifest = {
      format: SCREEN_FORMAT,
      formatVersion: FORMAT_VERSION,
      exportedAt: nowIso(),
      appName: "MyWebSCADA",
      screenId: screen.id,
      screenName: screen.name,
      counts: {
        assets: data.assets.length,
        libraries: data.libraries.length,
        tags: data.tags.length,
        macros: data.macros.length,
        events: data.events?.length ?? 0,
      },
      files,
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    addFile("manifest.json", manifestBytes, "metadata");
    this.addSignature(zip, manifestBytes);

    return {
      buffer: zip.toBuffer() as Buffer,
      fileName: `${slugifyFileName(screen.name)}.webscada-screen.zip`,
    };
  }

  public async validateProjectArchive(uploadedFile: UploadInput, options?: ProjectArchiveValidationOptions): Promise<ProjectArchiveValidationResult> {
    const parsedOptions = projectArchiveValidationOptionsSchema.parse(options ?? {});
    return this.inspectProjectArchive(uploadedFile.content, false, {
      requireSignature: parsedOptions.requireSignature ?? Boolean(archiveSecret()),
    });
  }

  public async validateScreenArchive(uploadedFile: UploadInput, options?: ScreenArchiveValidationOptions): Promise<ScreenArchiveValidationResult> {
    const parsedOptions = screenArchiveValidationOptionsSchema.parse(options ?? {});
    return this.inspectScreenArchive(uploadedFile.content, false, {
      requireSignature: parsedOptions.requireSignature ?? Boolean(archiveSecret()),
    });
  }

  public async importProjectArchive(uploadedFile: UploadInput, options?: ProjectArchiveImportOptions): Promise<ProjectArchiveImportResult> {
    const parsedOptions = projectArchiveImportOptionsSchema.parse(options ?? {});
    if (parsedOptions.mode !== "replace-current") {
      throw new Error("Project import mode 'import-as-copy' is not implemented yet");
    }

    const inspected = await this.inspectProjectArchive(uploadedFile.content, true, {
      requireSignature: parsedOptions.requireSignature ?? Boolean(archiveSecret()),
    });
    if (!inspected.valid || !inspected.parsed || inspected.parsed.kind !== "project") {
      throw new Error(inspected.errors[0]?.message ?? "Project archive is invalid");
    }

    const project = this.normalizeImportedProject(inspected.parsed.project);
    const backupPath = await this.createProjectBackup();
    const staged = await this.stageProjectImport(inspected.parsed, project);
    try {
      await this.swapStagedProjectImport(staged);
      const saved = await this.projectService.loadProject();
      return { ok: true, mode: parsedOptions.mode, backupPath, project: saved };
    } catch (error) {
      await this.rollbackProjectImport(staged).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Project import failed after backup was created at ${backupPath}. Rolled back previous project state. ${message}`);
    } finally {
      await rm(staged.stageRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(staged.rollbackRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  public async importScreenArchive(uploadedFile: UploadInput, options?: ScreenArchiveImportOptions): Promise<ScreenArchiveImportResult> {
    const parsedOptions = screenArchiveImportOptionsSchema.parse(options ?? {});
    const inspected = await this.inspectScreenArchive(uploadedFile.content, true, {
      requireSignature: parsedOptions.requireSignature ?? Boolean(archiveSecret()),
    });
    if (!inspected.valid || !inspected.parsed || inspected.parsed.kind !== "screen") {
      throw new Error(inspected.errors[0]?.message ?? "Screen archive is invalid");
    }

    return this.importScreenData(inspected.parsed, inspected.parsed.data, parsedOptions, [...inspected.warnings]);
  }

  public async inspectUploadedArchive(uploadedFile: UploadInput): Promise<ProjectArchiveInspectionResult> {
    const projectInspection = await this.inspectProjectArchive(uploadedFile.content, true, {
      requireSignature: Boolean(archiveSecret()),
    });
    if (projectInspection.parsed?.kind === "project") {
      return this.buildProjectInspection(projectInspection, projectInspection.parsed);
    }

    const screenInspection = await this.inspectScreenArchive(uploadedFile.content, true, {
      requireSignature: Boolean(archiveSecret()),
    });
    if (screenInspection.parsed?.kind === "screen") {
      return this.buildScreenInspection(screenInspection, screenInspection.parsed);
    }

    return {
      ...projectInspection,
      archiveType: undefined,
      screens: [],
      libraries: [],
      macros: [],
      assets: [],
      tags: [],
      events: [],
    };
  }

  public async importScreenFromProjectArchive(uploadedFile: UploadInput, options?: ProjectArchiveScreenImportOptions): Promise<ScreenArchiveImportResult> {
    const parsed = projectArchiveScreenImportOptionsSchema.safeParse(options ?? {});
    if (!parsed.success) {
      const hasScreenIdIssue = parsed.error.issues.some((issue) => issue.path[0] === "screenIds");
      throw new Error(hasScreenIdIssue ? "Select a source screen to import" : "Invalid screen import options");
    }
    const parsedOptions = parsed.data;
    const inspected = await this.inspectProjectArchive(uploadedFile.content, true, {
      requireSignature: parsedOptions.requireSignature ?? Boolean(archiveSecret()),
    });
    if (!inspected.valid || !inspected.parsed || inspected.parsed.kind !== "project") {
      throw new Error(inspected.errors[0]?.message ?? "Project archive is invalid");
    }

    const selectedScreens = inspected.parsed.project.screens.filter((screen) => parsedOptions.screenIds.includes(screen.id));
    if (selectedScreens.length === 0) {
      throw new Error("No matching screens were found in the project archive");
    }
    if (parsedOptions.mode === "replace" && selectedScreens.length !== 1) {
      throw new Error("Replacing a screen requires selecting exactly one archive screen");
    }

    let lastResult: ScreenArchiveImportResult | undefined;
    const importedScreens: Array<{ id: string; name: string }> = [];
    const totals = {
      importedAssets: 0,
      reusedAssets: 0,
      copiedAssets: 0,
      importedTags: 0,
      skippedTags: 0,
      importedVariables: 0,
      reusedVariables: 0,
      importedLw: 0,
      reusedLw: 0,
      importedMacros: 0,
      reusedMacros: 0,
      copiedMacros: 0,
      importedLibraries: 0,
      reusedLibraries: 0,
      copiedLibraries: 0,
    };
    const warnings: ProjectArchiveIssue[] = [];
    for (const screen of selectedScreens) {
      const dependencies = this.collectScreenArchiveDependencies(inspected.parsed.project, screen, parsedOptions.dependencyMode ?? "safe");
      const librarySet = new Set(dependencies.libraries);
      const data: ScreenArchiveData = {
        screen,
        assets: dependencies.assets,
        libraries: this.readProjectArchiveLibraries(inspected.parsed).filter((library) => librarySet.has(library.id)),
        tags: dependencies.tags,
        variables: dependencies.variables,
        lwStore: dependencies.lwStore,
        macros: dependencies.macros,
        events: dependencies.events,
      };
      lastResult = await this.importScreenData(inspected.parsed, data, {
        mode: parsedOptions.mode,
        replaceScreenId: parsedOptions.replaceScreenId,
        requireSignature: parsedOptions.requireSignature,
      }, [...inspected.warnings, ...dependencies.warnings]);
      importedScreens.push({ id: lastResult.screenId, name: lastResult.importedScreenName });
      totals.importedAssets += lastResult.importedAssets;
      totals.reusedAssets += lastResult.reusedAssets;
      totals.copiedAssets += lastResult.copiedAssets;
      totals.importedTags += lastResult.importedTags;
      totals.skippedTags += lastResult.skippedTags;
      totals.importedVariables += lastResult.importedVariables;
      totals.reusedVariables += lastResult.reusedVariables;
      totals.importedLw += lastResult.importedLw;
      totals.reusedLw += lastResult.reusedLw;
      totals.importedMacros += lastResult.importedMacros;
      totals.reusedMacros += lastResult.reusedMacros;
      totals.copiedMacros += lastResult.copiedMacros;
      totals.importedLibraries += lastResult.importedLibraries;
      totals.reusedLibraries += lastResult.reusedLibraries;
      totals.copiedLibraries += lastResult.copiedLibraries;
      warnings.push(...lastResult.warnings);
    }
    if (!lastResult || importedScreens.length === 0) {
      throw new Error("No screens were imported");
    }
    return {
      ...lastResult,
      ...totals,
      importedScreens,
      warnings,
    };
  }

  public async importLibraryFromProjectArchive(uploadedFile: UploadInput, options?: ProjectArchiveLibraryImportOptions): Promise<ProjectArchivePartialImportResult> {
    const parsedOptions = projectArchiveLibraryImportOptionsSchema.parse(options ?? {});
    const inspected = await this.inspectProjectArchive(uploadedFile.content, true, {
      requireSignature: parsedOptions.requireSignature ?? Boolean(archiveSecret()),
    });
    if (!inspected.valid || !inspected.parsed || inspected.parsed.kind !== "project") {
      throw new Error(inspected.errors[0]?.message ?? "Project archive is invalid");
    }

    const project = this.projectService.getProject();
    const warnings: ProjectArchiveIssue[] = [...inspected.warnings];
    const existingLibraries = await this.libraryService.listLibraries();
    const existingById = new Map(existingLibraries.map((library) => [library.id, library]));
    const takenLibraryIds = new Set(existingLibraries.map((library) => library.id));
    const sourceLibraries = this.readProjectArchiveLibraries(inspected.parsed).filter((library) => parsedOptions.libraryIds.includes(library.id));
    let imported = 0;
    let reused = 0;
    let copied = 0;
    const nextProjectLibraryRefs = [...(project.libraries ?? [])];

    for (const sourceLibrary of sourceLibraries) {
      const prefix = `libraries/${sourceLibrary.id}/`;
      const sourceHash = sha256(canonicalLibraryPayload(sourceLibrary, inspected.parsed.files, prefix));
      const existing = existingById.get(sourceLibrary.id);
      let targetId = sourceLibrary.id;
      if (existing) {
        const localFiles = await this.readLocalLibraryFiles(existing.id);
        const existingHash = sha256(canonicalLibraryPayload(existing, localFiles, ""));
        if (existingHash === sourceHash || parsedOptions.conflictMode === "keep-existing") {
          reused += 1;
          this.ensureProjectLibraryRef(nextProjectLibraryRefs, existing.id, existing);
          continue;
        }
        if (parsedOptions.conflictMode === "copy") {
          targetId = makeUniqueId(sourceLibrary.id, takenLibraryIds, "library");
          copied += 1;
          addIssue(warnings, "LIBRARY_IMPORTED_AS_COPY", `Library '${sourceLibrary.id}' already exists with different content; imported as '${targetId}'.`);
        }
      }
      takenLibraryIds.add(targetId);
      const library = normalizeImportedLibrary(sourceLibrary, targetId);
      await this.restoreLibrary(inspected.parsed, sourceLibrary.id, library);
      this.ensureProjectLibraryRef(nextProjectLibraryRefs, targetId, library);
      imported += 1;
    }

    const nextProject = await this.projectService.saveProject({
      ...project,
      libraries: nextProjectLibraryRefs,
    });
    return { ok: true, imported: { libraries: imported }, reused: { libraries: reused }, copied: { libraries: copied }, warnings, project: nextProject };
  }

  public async importMacroFromProjectArchive(uploadedFile: UploadInput, options?: ProjectArchiveMacroImportOptions): Promise<ProjectArchivePartialImportResult> {
    const parsedOptions = projectArchiveMacroImportOptionsSchema.parse(options ?? {});
    const inspected = await this.inspectProjectArchive(uploadedFile.content, true, {
      requireSignature: parsedOptions.requireSignature ?? Boolean(archiveSecret()),
    });
    if (!inspected.valid || !inspected.parsed || inspected.parsed.kind !== "project") {
      throw new Error(inspected.errors[0]?.message ?? "Project archive is invalid");
    }

    const project = this.projectService.getProject();
    const warnings: ProjectArchiveIssue[] = [...inspected.warnings];
    const selected = (inspected.parsed.project.macros ?? []).filter((macro) => parsedOptions.macroIds.includes(macro.id));
    const nextMacros = [...(project.macros ?? [])];
    const existingById = new Map(nextMacros.map((macro, index) => [macro.id, { macro, index }]));
    const takenIds = new Set(nextMacros.map((macro) => macro.id));
    let imported = 0;
    let reused = 0;
    let copied = 0;

    for (const macro of selected) {
      const existing = existingById.get(macro.id);
      if (!existing) {
        nextMacros.push(macro);
        takenIds.add(macro.id);
        imported += 1;
        continue;
      }
      if (existing.macro.code === macro.code && existing.macro.language === macro.language) {
        reused += 1;
        continue;
      }
      if (parsedOptions.conflictMode === "keep-existing" || parsedOptions.conflictMode === "add") {
        reused += 1;
        continue;
      }
      if (parsedOptions.conflictMode === "replace") {
        nextMacros[existing.index] = macro;
        imported += 1;
        continue;
      }
      const nextId = makeUniqueId(macro.id, takenIds, "macro");
      nextMacros.push({ ...macro, id: nextId, name: `${macro.name} (copy)` });
      takenIds.add(nextId);
      copied += 1;
      addIssue(warnings, "MACRO_IMPORTED_AS_COPY", `Macro '${macro.id}' already exists with different code; imported as '${nextId}'.`);
    }

    const nextProject = await this.projectService.saveProject({ ...project, macros: nextMacros });
    return { ok: true, imported: { macros: imported + copied }, reused: { macros: reused }, copied: { macros: copied }, warnings, project: nextProject };
  }

  public async importAssetsFromProjectArchive(uploadedFile: UploadInput, options?: ProjectArchiveAssetsImportOptions): Promise<ProjectArchivePartialImportResult> {
    const parsedOptions = projectArchiveAssetsImportOptionsSchema.parse(options ?? {});
    const inspected = await this.inspectProjectArchive(uploadedFile.content, true, {
      requireSignature: parsedOptions.requireSignature ?? Boolean(archiveSecret()),
    });
    if (!inspected.valid || !inspected.parsed || inspected.parsed.kind !== "project") {
      throw new Error(inspected.errors[0]?.message ?? "Project archive is invalid");
    }

    const project = this.projectService.getProject();
    const projectDir = path.dirname(this.projectService.getProjectFile());
    const warnings: ProjectArchiveIssue[] = [...inspected.warnings];
    const nextAssets = [...(project.assets ?? [])];
    const existingAssetsById = new Map(nextAssets.map((asset) => [asset.id, asset]));
    const takenAssetIds = new Set(nextAssets.map((asset) => asset.id));
    let imported = 0;
    let reused = 0;
    let copied = 0;

    for (const sourceAsset of (inspected.parsed.project.assets ?? []).filter((asset) => parsedOptions.assetIds.includes(asset.id))) {
      const normalized = normalizeArchivePath(sourceAsset.storagePath);
      if (!normalized.ok) {
        addIssue(warnings, "SKIPPED_ASSET", normalized.reason, sourceAsset.storagePath);
        continue;
      }
      const fileBytes = inspected.parsed.files.get(normalized.value);
      if (!fileBytes) {
        continue;
      }
      const existing = existingAssetsById.get(sourceAsset.id);
      let targetAsset = withProjectAssetPreview(sourceAsset);
      if (existing) {
        const existingPath = normalizeArchivePath(existing.storagePath);
        const existingBytes = existingPath.ok ? await readFile(path.join(projectDir, ...existingPath.value.split("/"))).catch(() => undefined) : undefined;
        if (existingBytes && sha256(existingBytes) === sha256(fileBytes)) {
          reused += 1;
          continue;
        }
        const nextId = makeUniqueId(sourceAsset.id, takenAssetIds, "asset");
        targetAsset = {
          ...targetAsset,
          id: nextId,
          name: `${targetAsset.name} (copy)`,
          fileName: `${nextId}${path.posix.extname(sourceAsset.fileName || sourceAsset.storagePath)}`,
          storagePath: `assets/${nextId}${path.posix.extname(sourceAsset.fileName || sourceAsset.storagePath)}`,
        };
        copied += 1;
      }
      takenAssetIds.add(targetAsset.id);
      nextAssets.push(withProjectAssetPreview(targetAsset));
      await this.writeArchiveFile(projectDir, targetAsset.storagePath, fileBytes);
      imported += 1;
    }

    const nextProject = await this.projectService.saveProject({ ...project, assets: nextAssets });
    return { ok: true, imported: { assets: imported }, reused: { assets: reused }, copied: { assets: copied }, warnings, project: nextProject };
  }

  private async resolveImportedAssets(
    parsed: ParsedZip,
    sourceAssets: Asset[],
    project: ScadaProject,
    projectDir: string,
    warnings: ProjectArchiveIssue[],
  ): Promise<ResolvedAssets> {
    const nextAssets = [...(project.assets ?? [])];
    const assetIdMap = new Map<string, string>();
    const existingById = new Map(nextAssets.map((asset) => [asset.id, asset]));
    const takenAssetIds = new Set(nextAssets.map((asset) => asset.id));
    const bySha = new Map<string, Asset[]>();
    const byFileNameAndSha = new Map<string, Asset[]>();
    const byNameAndSha = new Map<string, Asset[]>();
    let importedAssets = 0;
    let reusedAssets = 0;
    let copiedAssets = 0;

    const indexAsset = (asset: Asset, checksum: string): void => {
      const append = (index: Map<string, Asset[]>, key: string): void => {
        const items = index.get(key);
        if (items) {
          items.push(asset);
        } else {
          index.set(key, [asset]);
        }
      };
      append(bySha, checksum);
      const fileName = normalizedFileName(asset.fileName || asset.storagePath);
      if (fileName) {
        append(byFileNameAndSha, `${fileName}:${checksum}`);
      }
      const name = asset.name.trim().toLowerCase();
      if (name) {
        append(byNameAndSha, `${name}:${checksum}`);
      }
    };

    for (const asset of nextAssets) {
      const normalized = normalizeArchivePath(asset.storagePath);
      const bytes = normalized.ok ? await readFile(path.join(projectDir, ...normalized.value.split("/"))).catch(() => undefined) : undefined;
      if (bytes) {
        indexAsset(asset, sha256(bytes));
      }
    }

    for (const sourceAsset of sourceAssets) {
      const normalized = normalizeArchivePath(sourceAsset.storagePath);
      if (!normalized.ok) {
        addIssue(warnings, "SKIPPED_ASSET", normalized.reason, sourceAsset.storagePath);
        continue;
      }
      const fileBytes = parsed.files.get(normalized.value);
      if (!fileBytes) {
        continue;
      }
      const sourceSha = sha256(fileBytes);
      const sameId = existingById.get(sourceAsset.id);
      if (sameId && bySha.get(sourceSha)?.some((asset) => asset.id === sameId.id)) {
        assetIdMap.set(sourceAsset.id, sameId.id);
        reusedAssets += 1;
        continue;
      }

      const sameChecksum = bySha.get(sourceSha)?.[0];
      if (sameChecksum) {
        assetIdMap.set(sourceAsset.id, sameChecksum.id);
        reusedAssets += 1;
        continue;
      }

      const sameFileName = byFileNameAndSha.get(`${normalizedFileName(sourceAsset.fileName || sourceAsset.storagePath)}:${sourceSha}`)?.[0];
      if (sameFileName) {
        assetIdMap.set(sourceAsset.id, sameFileName.id);
        reusedAssets += 1;
        continue;
      }

      const sameName = byNameAndSha.get(`${sourceAsset.name.trim().toLowerCase()}:${sourceSha}`)?.[0];
      if (sameName) {
        assetIdMap.set(sourceAsset.id, sameName.id);
        reusedAssets += 1;
        continue;
      }

      const hasIdConflict = existingById.has(sourceAsset.id);
      const targetId = hasIdConflict ? makeUniqueId(sourceAsset.id, takenAssetIds, "asset") : sourceAsset.id;
      const targetAsset = withProjectAssetPreview({
        ...sourceAsset,
        id: targetId,
        name: hasIdConflict ? `${sourceAsset.name} (copy)` : sourceAsset.name,
        fileName: hasIdConflict ? `${targetId}${assetExtension(sourceAsset)}` : sourceAsset.fileName,
        storagePath: hasIdConflict ? `assets/${targetId}${assetExtension(sourceAsset)}` : sourceAsset.storagePath,
      });
      if (hasIdConflict) {
        copiedAssets += 1;
        addIssue(warnings, "ASSET_IMPORTED_AS_COPY", `Asset '${sourceAsset.id}' already exists with different content; imported as '${targetId}'.`);
      }
      takenAssetIds.add(targetAsset.id);
      existingById.set(targetAsset.id, targetAsset);
      assetIdMap.set(sourceAsset.id, targetAsset.id);
      nextAssets.push(targetAsset);
      indexAsset(targetAsset, sourceSha);
      await this.writeArchiveFile(projectDir, targetAsset.storagePath, fileBytes);
      importedAssets += 1;
    }

    return { nextAssets, assetIdMap, importedAssets, reusedAssets, copiedAssets };
  }

  private isGeneratedTagResolved(project: ScadaProject, tagName: string): boolean {
    if (project.tags.some((tag) => tag.name === tagName)) {
      return false;
    }
    return completeGeneratedSimulationTags(project, new Set([tagName])).some((tag) => tag.name === tagName);
  }

  private resolveImportedTags(project: ScadaProject, incoming: TagDefinition[], warnings: ProjectArchiveIssue[]): ResolvedTags {
    const tags = [...project.tags];
    const existingByName = new Map(tags.map((tag) => [tag.name, tag]));
    let importedTags = 0;
    let skippedTags = 0;

    for (const tag of incoming) {
      const existing = existingByName.get(tag.name);
      if (existing) {
        skippedTags += 1;
        if (stableJson(normalizedTagDefinition(existing)) !== stableJson(normalizedTagDefinition(tag))) {
          addIssue(warnings, "TAG_CONFLICT_KEEP_EXISTING", `Tag '${tag.name}' already exists with different definition; kept existing definition.`);
        }
        continue;
      }
      if (this.isGeneratedTagResolved(project, tag.name)) {
        skippedTags += 1;
        continue;
      }
      tags.push(tag);
      existingByName.set(tag.name, tag);
      importedTags += 1;
    }

    return { tags, importedTags, skippedTags };
  }

  private resolveImportedVariables(
    existing: InternalVariableDefinition[],
    incoming: InternalVariableDefinition[],
    warnings: ProjectArchiveIssue[],
  ): ResolvedVariables {
    const variables = [...existing];
    const byName = new Map(variables.map((variable) => [variable.name, variable]));
    const byId = new Map(variables.filter((variable) => variable.id).map((variable) => [variable.id!, variable]));
    const idMap = new Map<string, string>();
    let importedVariables = 0;
    let reusedVariables = 0;

    for (const variable of incoming) {
      const existingVariable = (variable.id ? byId.get(variable.id) : undefined) ?? byName.get(variable.name);
      if (existingVariable) {
        reusedVariables += 1;
        if (variable.id && existingVariable.id) {
          idMap.set(variable.id, existingVariable.id);
        }
        if (stableJson(normalizedVariableDefinition(existingVariable)) !== stableJson(normalizedVariableDefinition(variable))) {
          addIssue(warnings, "VARIABLE_CONFLICT_KEEP_EXISTING", `Internal variable '${variable.name}' already exists with different definition; kept existing definition.`);
        }
        continue;
      }
      variables.push(variable);
      byName.set(variable.name, variable);
      if (variable.id) {
        byId.set(variable.id, variable);
        idMap.set(variable.id, variable.id);
      }
      importedVariables += 1;
    }

    return { variables, idMap, importedVariables, reusedVariables };
  }

  private resolveImportedLwStore(existing: LwStoreConfig | undefined, incoming: LwStoreConfig | undefined, warnings: ProjectArchiveIssue[]): ResolvedLwStore {
    if (!incoming) {
      return { lwStore: existing, importedLw: 0, reusedLw: 0 };
    }
    const lwStore: LwStoreConfig = {
      mode: existing?.mode ?? incoming.mode,
      values: { ...(existing?.values ?? {}) },
    };
    let importedLw = 0;
    let reusedLw = 0;
    for (const [address, value] of Object.entries(incoming.values ?? {})) {
      const numericAddress = Number(address);
      if (!Number.isFinite(numericAddress)) {
        continue;
      }
      const current = lwStore.values?.[numericAddress];
      if (current === undefined) {
        lwStore.values![numericAddress] = value;
        importedLw += 1;
      } else {
        reusedLw += 1;
        if (current !== value) {
          addIssue(warnings, "LW_STORE_CONFLICT_KEEP_EXISTING", `LW address ${numericAddress} already exists with different value; kept existing value.`);
        }
      }
    }
    return { lwStore, importedLw, reusedLw };
  }

  private async resolveImportedLibraries(parsed: ParsedZip, sourceLibraries: ElementLibrary[], project: ScadaProject, warnings: ProjectArchiveIssue[]): Promise<ResolvedLibraries> {
    const existingLibraries = await this.libraryService.listLibraries();
    const byId = new Map(existingLibraries.map((library) => [library.id, library]));
    const byHash = new Map<string, ElementLibrary>();
    const takenLibraryIds = new Set(existingLibraries.map((library) => library.id));
    const libraryIdMap = new Map<string, string>();
    const nextProjectLibraryRefs = this.normalizeProjectLibraryRefs(project.libraries ?? []);
    let importedLibraries = 0;
    let reusedLibraries = 0;
    let copiedLibraries = 0;

    for (const library of existingLibraries) {
      const localFiles = await this.readLocalLibraryFiles(library.id);
      byHash.set(sha256(canonicalLibraryPayload(library, localFiles, "")), library);
    }

    for (const sourceLibrary of sourceLibraries) {
      const sourceHash = sha256(canonicalLibraryPayload(sourceLibrary, parsed.files, `libraries/${sourceLibrary.id}/`));
      const sameId = byId.get(sourceLibrary.id);
      if (sameId) {
        const sameIdFiles = await this.readLocalLibraryFiles(sameId.id);
        const sameIdHash = sha256(canonicalLibraryPayload(sameId, sameIdFiles, ""));
        if (sameIdHash === sourceHash) {
          libraryIdMap.set(sourceLibrary.id, sameId.id);
          this.ensureProjectLibraryRef(nextProjectLibraryRefs, sameId.id, sameId);
          reusedLibraries += 1;
          continue;
        }
      }

      const sameHash = byHash.get(sourceHash);
      if (sameHash) {
        libraryIdMap.set(sourceLibrary.id, sameHash.id);
        this.ensureProjectLibraryRef(nextProjectLibraryRefs, sameHash.id, sameHash);
        reusedLibraries += 1;
        continue;
      }

      const hasIdConflict = Boolean(sameId);
      const targetId = hasIdConflict ? makeUniqueId(sourceLibrary.id, takenLibraryIds, "library") : sourceLibrary.id;
      const library = normalizeImportedLibrary(sourceLibrary, targetId);
      await this.restoreLibrary(parsed, sourceLibrary.id, library);
      takenLibraryIds.add(targetId);
      byId.set(targetId, library);
      byHash.set(sourceHash, library);
      libraryIdMap.set(sourceLibrary.id, targetId);
      this.ensureProjectLibraryRef(nextProjectLibraryRefs, targetId, library);
      importedLibraries += 1;
      if (hasIdConflict) {
        copiedLibraries += 1;
        addIssue(warnings, "LIBRARY_IMPORTED_AS_COPY", `Library '${sourceLibrary.id}' already exists with different content; imported as '${targetId}'.`);
      }
    }

    return { libraryIdMap, nextProjectLibraryRefs, importedLibraries, reusedLibraries, copiedLibraries };
  }

  private resolveImportedMacros(existing: MacroDefinition[], incoming: MacroDefinition[], warnings: ProjectArchiveIssue[]): ResolvedMacros {
    const macros = [...existing];
    const byId = new Map(macros.map((macro) => [macro.id, macro]));
    const byContent = new Map(macros.map((macro) => [macroContentKey(macro), macro]));
    const takenIds = new Set(macros.map((macro) => macro.id));
    const idMap = new Map<string, string>();
    let importedMacros = 0;
    let reusedMacros = 0;
    let copiedMacros = 0;

    for (const macro of incoming) {
      const contentKey = macroContentKey(macro);
      const sameId = byId.get(macro.id);
      if (sameId && macroContentKey(sameId) === contentKey) {
        idMap.set(macro.id, sameId.id);
        reusedMacros += 1;
        continue;
      }

      const sameContent = byContent.get(contentKey);
      if (sameContent) {
        idMap.set(macro.id, sameContent.id);
        reusedMacros += 1;
        continue;
      }

      const hasIdConflict = Boolean(sameId);
      const targetId = hasIdConflict ? makeUniqueId(macro.id, takenIds, "macro") : macro.id;
      const targetMacro = hasIdConflict ? { ...macro, id: targetId, name: `${macro.name} (copy)` } : macro;
      macros.push(targetMacro);
      takenIds.add(targetId);
      byId.set(targetId, targetMacro);
      byContent.set(contentKey, targetMacro);
      idMap.set(macro.id, targetId);
      importedMacros += 1;
      if (hasIdConflict) {
        copiedMacros += 1;
        addIssue(warnings, "MACRO_IMPORTED_AS_COPY", `Macro '${macro.id}' already exists with different code; imported as '${targetId}'.`);
      }
    }

    return { macros, idMap, importedMacros, reusedMacros, copiedMacros };
  }

  private async importScreenData(
    parsed: ParsedZip,
    data: ScreenArchiveData,
    parsedOptions: ScreenArchiveImportOptions,
    initialWarnings: ProjectArchiveIssue[],
  ): Promise<ScreenArchiveImportResult> {
    const project = this.projectService.getProject();
    const projectDir = path.dirname(this.projectService.getProjectFile());
    const warnings: ProjectArchiveIssue[] = [...initialWarnings];
    const assetResolution = await this.resolveImportedAssets(parsed, data.assets, project, projectDir, warnings);
    const tagResolution = this.resolveImportedTags(project, data.tags, warnings);
    const variableResolution = this.resolveImportedVariables(project.variables ?? [], data.variables ?? [], warnings);
    const lwResolution = this.resolveImportedLwStore(project.lwStore, data.lwStore, warnings);
    const libraryResolution = await this.resolveImportedLibraries(parsed, data.libraries, project, warnings);
    const macroResolution = this.resolveImportedMacros(project.macros ?? [], data.macros, warnings);

    let importedScreen = replaceIdsInUnknown(data.screen, {
      assetIds: assetResolution.assetIdMap,
      libraryIds: libraryResolution.libraryIdMap,
      macroIds: macroResolution.idMap,
      variableIds: variableResolution.idMap,
    }) as HmiScreen;
    let nextScreens = [...project.screens];
    if (parsedOptions.mode === "replace") {
      const targetId = parsedOptions.replaceScreenId ?? importedScreen.id;
      const targetIndex = nextScreens.findIndex((screen) => screen.id === targetId);
      if (targetIndex < 0) {
        throw new Error("Screen to replace was not found");
      }
      importedScreen = { ...importedScreen, id: targetId };
      nextScreens[targetIndex] = importedScreen;
    } else {
      const takenScreenIds = new Set(nextScreens.map((screen) => screen.id));
      if (takenScreenIds.has(importedScreen.id)) {
        importedScreen = {
          ...importedScreen,
          id: makeUniqueId(importedScreen.id, takenScreenIds, importedScreen.kind),
          name: `${importedScreen.name} (imported)`,
        };
      }
      nextScreens.push(importedScreen);
    }

    const nextProject = await this.projectService.saveProject({
      ...project,
      assets: assetResolution.nextAssets,
      tags: tagResolution.tags,
      variables: variableResolution.variables,
      lwStore: lwResolution.lwStore,
      libraries: libraryResolution.nextProjectLibraryRefs,
      macros: macroResolution.macros,
      events: this.mergeEvents(project.events ?? [], data.events ?? [], warnings),
      screens: nextScreens,
      startScreenId: project.startScreenId ?? nextScreens[0]?.id,
    });

    return {
      ok: true,
      mode: parsedOptions.mode,
      screenId: importedScreen.id,
      importedScreenName: importedScreen.name,
      importedScreens: [{ id: importedScreen.id, name: importedScreen.name }],
      importedAssets: assetResolution.importedAssets,
      reusedAssets: assetResolution.reusedAssets,
      copiedAssets: assetResolution.copiedAssets,
      importedTags: tagResolution.importedTags,
      skippedTags: tagResolution.skippedTags,
      importedVariables: variableResolution.importedVariables,
      reusedVariables: variableResolution.reusedVariables,
      importedLw: lwResolution.importedLw,
      reusedLw: lwResolution.reusedLw,
      importedMacros: macroResolution.importedMacros,
      reusedMacros: macroResolution.reusedMacros,
      copiedMacros: macroResolution.copiedMacros,
      importedLibraries: libraryResolution.importedLibraries,
      reusedLibraries: libraryResolution.reusedLibraries,
      copiedLibraries: libraryResolution.copiedLibraries,
      warnings,
      project: nextProject,
    };
  }

  private async buildProjectInspection(
    inspection: ProjectArchiveValidationResult & { parsed?: AnyParsedArchive },
    parsed: ParsedProjectArchive,
  ): Promise<ProjectArchiveInspectionResult> {
    const project = parsed.project;
    const current = this.projectService.getProject();
    const existingScreenIds = new Set(current.screens.map((screen) => screen.id));
    const existingMacroIds = new Set((current.macros ?? []).map((macro) => macro.id));
    const existingTagNames = new Set(current.tags.map((tag) => tag.name));
    const libraries = this.readProjectArchiveLibraries(parsed);
    const assetConflicts = await this.buildAssetConflictPreviewItems(project.assets ?? [], parsed.files);
    const libraryConflicts = await this.buildLibraryConflictPreviewItems(libraries, parsed.files);
    return {
      ...this.stripParsed(inspection),
      archiveType: "project",
      screens: project.screens.map((screen) => ({ id: screen.id, name: screen.name, kind: screen.kind, count: screen.objects.length })),
      libraries: libraries.map((library) => ({ id: library.id, name: library.name, count: library.elements.length })),
      macros: (project.macros ?? []).map((macro) => ({ id: macro.id, name: macro.name, kind: macro.language })),
      assets: (project.assets ?? []).map((asset) => {
        const normalized = normalizeArchivePath(asset.storagePath);
        const bytes = normalized.ok ? parsed.files.get(normalized.value) : undefined;
        return { id: asset.id, name: asset.name, checksum: bytes ? sha256(bytes) : undefined, kind: asset.mimeType };
      }),
      tags: project.tags.map((tag) => ({ id: tag.name, name: tag.name, kind: tag.dataType })),
      events: (project.events ?? []).map((event) => ({ id: event.id, name: event.message ?? event.id, kind: event.conditionMode })),
      dependencies: {
        assets: (project.assets ?? []).length,
        libraries: libraries.length,
        macros: (project.macros ?? []).length,
        tags: project.tags.length,
        events: (project.events ?? []).length,
      },
      conflicts: {
        screens: project.screens.map((screen) => ({
          id: screen.id,
          name: screen.name,
          status: existingScreenIds.has(screen.id) ? "import-as-copy" : "new",
          message: existingScreenIds.has(screen.id)
            ? "A screen with this id exists. Import as new will create a copy; replace will overwrite the selected current screen."
            : "New screen.",
        })),
        assets: assetConflicts,
        libraries: libraryConflicts,
        macros: (project.macros ?? []).map((macro) => ({
          id: macro.id,
          name: macro.name,
          status: existingMacroIds.has(macro.id) ? "import-as-copy" : "new",
          message: existingMacroIds.has(macro.id)
            ? "A macro with this id exists. Choose keep existing, replace, or import as copy before import."
            : "New macro.",
        })),
        tags: project.tags.map((tag) => ({
          id: tag.name,
          name: tag.name,
          status: existingTagNames.has(tag.name) ? "keep-existing" : "new",
          message: existingTagNames.has(tag.name)
            ? "A tag with this name exists. Existing tag is kept by default."
            : "New tag.",
        })),
      },
    };
  }

  private async buildScreenInspection(
    inspection: ScreenArchiveValidationResult & { parsed?: AnyParsedArchive },
    parsed: ParsedScreenArchive,
  ): Promise<ProjectArchiveInspectionResult> {
    const data = parsed.data;
    const conflicts = inspection.conflicts;
    const assetConflicts = await this.buildAssetConflictPreviewItems(data.assets, parsed.files);
    const libraryConflicts = await this.buildLibraryConflictPreviewItems(data.libraries, parsed.files);
    return {
      ...this.stripParsed(inspection),
      archiveType: "screen",
      screens: [{ id: data.screen.id, name: data.screen.name, kind: data.screen.kind, count: data.screen.objects.length }],
      libraries: data.libraries.map((library) => ({ id: library.id, name: library.name, count: library.elements.length })),
      macros: data.macros.map((macro) => ({ id: macro.id, name: macro.name, kind: macro.language })),
      assets: data.assets.map((asset) => {
        const normalized = normalizeArchivePath(asset.storagePath);
        const bytes = normalized.ok ? parsed.files.get(normalized.value) : undefined;
        return { id: asset.id, name: asset.name, checksum: bytes ? sha256(bytes) : undefined, kind: asset.mimeType };
      }),
      tags: data.tags.map((tag) => ({ id: tag.name, name: tag.name, kind: tag.dataType })),
      events: (data.events ?? []).map((event) => ({ id: event.id, name: event.message ?? event.id, kind: event.conditionMode })),
      dependencies: {
        assets: data.assets.length,
        libraries: data.libraries.length,
        macros: data.macros.length,
        tags: data.tags.length,
        events: data.events?.length ?? 0,
      },
      conflicts: {
        screens: [{
          id: data.screen.id,
          name: data.screen.name,
          status: conflicts?.screenIdConflict ? "import-as-copy" : "new",
          message: conflicts?.screenIdConflict ? "A screen with this id exists. Add as new will create a copy; replace overwrites selected current screen." : "New screen.",
        }],
        assets: assetConflicts,
        libraries: libraryConflicts,
        macros: data.macros.map((macro) => ({
          id: macro.id,
          name: macro.name,
          status: "import-as-copy",
          message: "On conflict, different macro code is imported as a copy and references are rewritten.",
        })),
        tags: data.tags.map((tag) => ({
          id: tag.name,
          name: tag.name,
          status: conflicts?.tagConflicts.includes(tag.name) ? "keep-existing" : "new",
          message: conflicts?.tagConflicts.includes(tag.name) ? "Existing tag is kept by default." : "New tag.",
        })),
      },
    };
  }

  private readProjectArchiveLibraries(parsed: ParsedProjectArchive): ElementLibrary[] {
    const libraries: ElementLibrary[] = [];
    const ids = new Set((parsed.project.libraries ?? []).filter((ref) => ref.enabled !== false).map((ref) => ref.libraryId));
    for (const libraryId of ids) {
      const bytes = parsed.files.get(`libraries/${libraryId}/library.json`);
      if (!bytes) {
        continue;
      }
      try {
        libraries.push(JSON.parse(bytes.toString("utf8")) as ElementLibrary);
      } catch {
        // Validation already reports invalid library JSON; inspection can skip the broken item.
      }
    }
    return libraries;
  }

  private ensureProjectLibraryRef(projectRefs: NonNullable<ScadaProject["libraries"]>, libraryId: string, library: ElementLibrary): void {
    const existing = projectRefs.find((ref) => ref.libraryId === libraryId);
    if (existing) {
      existing.enabled = true;
      existing.name = library.name;
      existing.version = library.version;
      existing.path = path.dirname(this.libraryService.libraryFilePath(libraryId));
      return;
    }
    projectRefs.push({
      libraryId,
      name: library.name,
      version: library.version,
      path: path.dirname(this.libraryService.libraryFilePath(libraryId)),
      enabled: true,
    });
  }

  private normalizeProjectLibraryRefs(refs: NonNullable<ScadaProject["libraries"]>): NonNullable<ScadaProject["libraries"]> {
    const out: NonNullable<ScadaProject["libraries"]> = [];
    const seen = new Set<string>();
    for (const ref of refs) {
      if (seen.has(ref.libraryId)) {
        continue;
      }
      seen.add(ref.libraryId);
      out.push({ ...ref });
    }
    return out;
  }

  private async buildAssetConflictPreviewItems(sourceAssets: Asset[], files: Map<string, Buffer>): Promise<ArchiveConflictPreviewItem[]> {
    const project = this.projectService.getProject();
    const projectDir = path.dirname(this.projectService.getProjectFile());
    const existingById = new Map((project.assets ?? []).map((asset) => [asset.id, asset]));
    const existingBySha = new Set<string>();
    const existingIdSha = new Map<string, string>();

    for (const asset of project.assets ?? []) {
      const normalized = normalizeArchivePath(asset.storagePath);
      const bytes = normalized.ok ? await readFile(path.join(projectDir, ...normalized.value.split("/"))).catch(() => undefined) : undefined;
      if (!bytes) {
        continue;
      }
      const checksum = sha256(bytes);
      existingBySha.add(checksum);
      existingIdSha.set(asset.id, checksum);
    }

    return sourceAssets.map((asset) => {
      const normalized = normalizeArchivePath(asset.storagePath);
      const bytes = normalized.ok ? files.get(normalized.value) : undefined;
      const checksum = bytes ? sha256(bytes) : undefined;
      if (checksum && existingIdSha.get(asset.id) === checksum) {
        return { id: asset.id, name: asset.name, status: "reuse-same-checksum", message: "Will reuse existing asset with the same id and checksum." };
      }
      if (checksum && existingBySha.has(checksum)) {
        return { id: asset.id, name: asset.name, status: "reuse-same-checksum", message: "Will reuse existing asset with the same checksum." };
      }
      if (existingById.has(asset.id)) {
        return {
          id: asset.id,
          name: asset.name,
          status: "copy-different-checksum",
          message: "Will import as copy because an asset with this id exists with different content.",
        };
      }
      return { id: asset.id, name: asset.name, status: "new", message: "New asset." };
    });
  }

  private async buildLibraryConflictPreviewItems(sourceLibraries: ElementLibrary[], files: Map<string, Buffer>): Promise<ArchiveConflictPreviewItem[]> {
    const existingLibraries = await this.libraryService.listLibraries();
    const existingById = new Map(existingLibraries.map((library) => [library.id, library]));
    const existingByHash = new Set<string>();
    const existingIdHash = new Map<string, string>();

    for (const library of existingLibraries) {
      const localFiles = await this.readLocalLibraryFiles(library.id);
      const checksum = sha256(canonicalLibraryPayload(library, localFiles, ""));
      existingByHash.add(checksum);
      existingIdHash.set(library.id, checksum);
    }

    return sourceLibraries.map((library) => {
      const checksum = sha256(canonicalLibraryPayload(library, files, `libraries/${library.id}/`));
      if (existingIdHash.get(library.id) === checksum) {
        return { id: library.id, name: library.name, status: "reuse-same-checksum", message: "Will reuse existing library with the same id and canonical hash." };
      }
      if (existingByHash.has(checksum)) {
        return { id: library.id, name: library.name, status: "reuse-same-checksum", message: "Will reuse existing library with the same canonical hash." };
      }
      if (existingById.has(library.id)) {
        return {
          id: library.id,
          name: library.name,
          status: "copy-different-checksum",
          message: "Will import as copy because a library with this id exists with different content.",
        };
      }
      return { id: library.id, name: library.name, status: "new", message: "New library." };
    });
  }

  private async inspectProjectArchive(content: Buffer, withParsed?: false, options?: ProjectArchiveValidationOptions): Promise<ProjectArchiveValidationResult>;
  private async inspectProjectArchive(content: Buffer, withParsed: true, options?: ProjectArchiveValidationOptions): Promise<ProjectArchiveValidationResult & { parsed?: AnyParsedArchive }>;
  private async inspectProjectArchive(content: Buffer, withParsed = false, options?: ProjectArchiveValidationOptions): Promise<ProjectArchiveValidationResult & { parsed?: AnyParsedArchive }> {
    const inspected = await this.inspectArchive(content, "project", options);
    return withParsed ? inspected : this.stripParsed(inspected);
  }

  private async inspectScreenArchive(content: Buffer, withParsed?: false, options?: ScreenArchiveValidationOptions): Promise<ScreenArchiveValidationResult>;
  private async inspectScreenArchive(content: Buffer, withParsed: true, options?: ScreenArchiveValidationOptions): Promise<ScreenArchiveValidationResult & { parsed?: AnyParsedArchive }>;
  private async inspectScreenArchive(content: Buffer, withParsed = false, options?: ScreenArchiveValidationOptions): Promise<ScreenArchiveValidationResult & { parsed?: AnyParsedArchive }> {
    const inspected = await this.inspectArchive(content, "screen", options);
    const result = withParsed ? inspected : this.stripParsed(inspected);
    if (inspected.parsed?.kind === "screen") {
      const project = this.projectService.getProject();
      const existingAssetIds = new Set((project.assets ?? []).map((asset) => asset.id));
      const existingTagNames = new Set(project.tags.map((tag) => tag.name));
      const existingLibraryIds = new Set((await this.libraryService.listLibraries()).map((library) => library.id));
      const parsedScreen = inspected.parsed;
      return {
        ...result,
        conflicts: {
          screenIdConflict: project.screens.some((screen) => screen.id === parsedScreen.data.screen.id),
          assetConflicts: parsedScreen.data.assets.filter((asset) => existingAssetIds.has(asset.id)).map((asset) => asset.id),
          tagConflicts: parsedScreen.data.tags.filter((tag) => existingTagNames.has(tag.name)).map((tag) => tag.name),
          libraryConflicts: parsedScreen.data.libraries.filter((library) => existingLibraryIds.has(library.id)).map((library) => library.id),
        },
      };
    }
    return result;
  }

  private async inspectArchive(content: Buffer, expected: "project" | "screen", options?: ProjectArchiveValidationOptions | ScreenArchiveValidationOptions): Promise<ProjectArchiveValidationResult & { parsed?: AnyParsedArchive }> {
    const errors: ProjectArchiveIssue[] = [];
    const warnings: ProjectArchiveIssue[] = [];
    const base: ProjectArchiveValidationResult & { parsed?: AnyParsedArchive } = {
      valid: false,
      authenticity: {
        signed: false,
        required: Boolean(options?.requireSignature),
        verified: false,
      },
      checksum: {
        verified: false,
      },
      warnings,
      errors,
    };

    if (content.byteLength === 0) {
      addIssue(errors, "EMPTY_ARCHIVE", "Archive is empty");
      return base;
    }
    if (content.byteLength > MAX_ARCHIVE_SIZE_BYTES) {
      addIssue(errors, "ARCHIVE_TOO_LARGE", `Archive exceeds ${Math.floor(MAX_ARCHIVE_SIZE_BYTES / 1024 / 1024)} MB limit`);
    }
    if (!(content[0] === 0x50 && content[1] === 0x4b)) {
      addIssue(errors, "NOT_ZIP", "This is not a ZIP archive");
      return base;
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(content);
    } catch {
      addIssue(errors, "CORRUPTED_ZIP", "ZIP archive is corrupted or unreadable");
      return base;
    }

    const entries = zip.getEntries();
    if (entries.length > MAX_FILES) {
      addIssue(errors, "TOO_MANY_FILES", `Archive has too many files (max ${MAX_FILES})`);
    }

    const files = new Map<string, Buffer>();
    const sizes = new Map<string, number>();
    for (const entry of entries) {
      const rawName = entry.entryName;
      const normalized = normalizeArchivePath(rawName);
      if (!normalized.ok) {
        addIssue(errors, "UNSAFE_PATH", normalized.reason, rawName || undefined);
        continue;
      }
      const archivePath = normalized.value;
      if (entry.isDirectory) {
        continue;
      }
      if (entry.header.encripted) {
        addIssue(errors, "UNSUPPORTED_ENCRYPTED_ZIP", "Encrypted archives are not supported", archivePath);
        continue;
      }
      if (files.has(archivePath)) {
        addIssue(errors, "DUPLICATE_PATH", "Duplicate file path in archive", archivePath);
        continue;
      }
      if (!isSupportedArchiveFile(archivePath)) {
        addIssue(errors, "UNSUPPORTED_FILE_EXTENSION", "Unsupported file extension", archivePath);
        continue;
      }
      if (Number(entry.header.size || 0) > MAX_FILE_SIZE_BYTES) {
        addIssue(errors, "FILE_TOO_LARGE", `File exceeds ${Math.floor(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB limit`, archivePath);
      }
      const buffer = zip.readFile(entry);
      if (!buffer) {
        addIssue(errors, "ENTRY_READ_FAILED", "Unable to read archive entry", archivePath);
        continue;
      }
      files.set(archivePath, buffer);
      sizes.set(archivePath, buffer.byteLength);
    }

    const manifestBytes = files.get("manifest.json");
    if (!manifestBytes) {
      addIssue(errors, "MISSING_MANIFEST", "manifest.json was not found in archive", "manifest.json");
      return base;
    }

    const secret = archiveSecret();
    let signature: ProjectArchiveSignature | undefined;
    const signatureBytes = files.get("signature.json");
    if (signatureBytes) {
      let rawSignature: unknown;
      try {
        rawSignature = JSON.parse(signatureBytes.toString("utf8"));
      } catch {
        addIssue(errors, "INVALID_SIGNATURE_JSON", "signature.json is invalid", "signature.json");
      }
      const parsedSignature = rawSignature ? projectArchiveSignatureSchema.safeParse(rawSignature) : undefined;
      if (parsedSignature && !parsedSignature.success) {
        addIssue(errors, "INVALID_SIGNATURE", "signature.json does not match the expected signature format", "signature.json");
      }
      if (parsedSignature?.success) {
        signature = parsedSignature.data;
        base.authenticity = {
          signed: true,
          required: Boolean(options?.requireSignature),
          verified: false,
          algorithm: parsedSignature.data.algorithm,
        };
        if (!secret) {
          addIssue(warnings, "ARCHIVE_SIGNATURE_UNVERIFIED", "Archive is signed, but PROJECT_ARCHIVE_SECRET is not configured so the signature cannot be verified.", "signature.json");
        } else {
          const expectedSignature = hmacSha256(manifestBytes, secret);
          if (!timingSafeHexEqual(expectedSignature, parsedSignature.data.signature.toLowerCase())) {
            addIssue(errors, "ARCHIVE_SIGNATURE_MISMATCH", "Archive signature does not match manifest.json.", "signature.json");
          } else {
            base.authenticity.verified = true;
          }
        }
      }
    } else {
      addIssue(options?.requireSignature ? errors : warnings, "ARCHIVE_NOT_SIGNED", "Archive does not contain signature.json.", "signature.json");
      base.authenticity = {
        signed: false,
        required: Boolean(options?.requireSignature),
        verified: false,
      };
    }

    let rawManifest: unknown;
    try {
      rawManifest = JSON.parse(manifestBytes.toString("utf8"));
    } catch {
      addIssue(errors, "INVALID_MANIFEST_JSON", "manifest.json is invalid", "manifest.json");
      return base;
    }

    const manifest = expected === "project"
      ? projectArchiveManifestSchema.safeParse(rawManifest)
      : screenArchiveManifestSchema.safeParse(rawManifest);
    if (!manifest.success) {
      addIssue(errors, "INVALID_MANIFEST", "manifest.json does not match the expected archive format", "manifest.json");
      return base;
    }
    if (manifest.data.formatVersion !== FORMAT_VERSION) {
      addIssue(errors, "UNSUPPORTED_FORMAT_VERSION", `Unsupported formatVersion: ${manifest.data.formatVersion}`, "manifest.json");
    }

    const manifestPathSet = new Set<string>();
    for (const item of manifest.data.files) {
      const normalized = normalizeArchivePath(item.path);
      if (!normalized.ok) {
        addIssue(errors, "UNSAFE_MANIFEST_PATH", normalized.reason, item.path);
        continue;
      }
      const archivePath = normalized.value;
      if (manifestPathSet.has(archivePath)) {
        addIssue(errors, "DUPLICATE_MANIFEST_FILE", "Duplicate file path in manifest", archivePath);
        continue;
      }
      manifestPathSet.add(archivePath);
      const bytes = files.get(archivePath);
      if (!bytes) {
        addIssue(errors, "MANIFEST_FILE_MISSING", "File listed in manifest is missing from archive", archivePath);
        continue;
      }
      if (bytes.byteLength !== item.size) {
        addIssue(errors, "SIZE_MISMATCH", "File size does not match manifest", archivePath);
      }
      if (sha256(bytes) !== item.sha256.toLowerCase()) {
        addIssue(errors, "CHECKSUM_MISMATCH", "File checksum does not match manifest", archivePath);
      }
    }
    base.checksum = { verified: !errors.some((issue) => issue.code === "CHECKSUM_MISMATCH" || issue.code === "SIZE_MISMATCH" || issue.code === "MANIFEST_FILE_MISSING") };
    for (const archivePath of files.keys()) {
      if (archivePath === "manifest.json" || archivePath === "signature.json") {
        continue;
      }
      if (!manifestPathSet.has(archivePath)) {
        addIssue(warnings, "UNDECLARED_ARCHIVE_FILE", "Archive file is not listed in manifest", archivePath);
      }
    }

    if (expected === "project") {
      return this.inspectProjectPayload(files, sizes, manifest.data as ProjectArchiveManifest, base, signature);
    }
    return this.inspectScreenPayload(files, sizes, manifest.data as ScreenArchiveManifest, base, signature);
  }

  private inspectProjectPayload(
    files: Map<string, Buffer>,
    sizes: Map<string, number>,
    manifest: ProjectArchiveManifest,
    result: ProjectArchiveValidationResult & { parsed?: AnyParsedArchive },
    signature?: ProjectArchiveSignature,
  ): ProjectArchiveValidationResult & { parsed?: AnyParsedArchive } {
    const projectBytes = files.get("project.json");
    if (!projectBytes) {
      addIssue(result.errors, "MISSING_PROJECT_JSON", "project.json was not found in archive", "project.json");
      return result;
    }
    let project: ScadaProject | undefined;
    try {
      project = projectSchema.parse(JSON.parse(projectBytes.toString("utf8")));
    } catch (error) {
      addIssue(result.errors, "INVALID_PROJECT_JSON", error instanceof Error ? error.message : "project.json is invalid", "project.json");
      return result;
    }

    if (manifest.counts.screens !== project.screens.length) {
      addIssue(result.errors, "COUNT_MISMATCH_SCREENS", "manifest screen count does not match project.json", "manifest.json");
    }
    if (manifest.counts.assets !== (project.assets ?? []).length) {
      addIssue(result.errors, "COUNT_MISMATCH_ASSETS", "manifest asset count does not match project.json", "manifest.json");
    }
    if (manifest.counts.tags !== project.tags.length) {
      addIssue(result.errors, "COUNT_MISMATCH_TAGS", "manifest tag count does not match project.json", "manifest.json");
    }

    for (const asset of project.assets ?? []) {
      this.validateAssetFile(asset, files, sizes, result.errors);
    }
    for (const sound of project.eventSounds ?? []) {
      this.validateSoundFile(sound, files, sizes, result.errors);
    }
    for (const ref of project.libraries ?? []) {
      if (ref.enabled === false) {
        continue;
      }
      if (!files.has(`libraries/${ref.libraryId}/library.json`)) {
        addIssue(result.errors, "MISSING_LIBRARY_FILE", "Attached library file is missing", `libraries/${ref.libraryId}/library.json`);
      }
    }
    this.validateProjectReferences(project, files, result.errors, result.warnings);

    result.valid = result.errors.length === 0;
    result.summary = {
      format: PROJECT_FORMAT,
      name: project.name,
      screens: project.screens.length,
      tags: project.tags.length,
      assets: (project.assets ?? []).length,
      libraries: (project.libraries ?? []).filter((ref) => ref.enabled !== false).length,
      events: (project.events ?? []).length,
      macros: (project.macros ?? []).length,
      variables: (project.variables ?? []).length,
    };
    if (result.valid) {
      result.parsed = { kind: "project", manifest, project, files, sizes, signature };
    }
    return result;
  }

  private inspectScreenPayload(
    files: Map<string, Buffer>,
    sizes: Map<string, number>,
    manifest: ScreenArchiveManifest,
    result: ProjectArchiveValidationResult & { parsed?: AnyParsedArchive },
    signature?: ProjectArchiveSignature,
  ): ProjectArchiveValidationResult & { parsed?: AnyParsedArchive } {
    const screenBytes = files.get("screen.json");
    if (!screenBytes) {
      addIssue(result.errors, "MISSING_SCREEN_JSON", "screen.json was not found in archive", "screen.json");
      return result;
    }
    let data: ScreenArchiveData | undefined;
    try {
      data = screenArchiveDataSchema.parse(JSON.parse(screenBytes.toString("utf8")));
    } catch (error) {
      addIssue(result.errors, "INVALID_SCREEN_JSON", error instanceof Error ? error.message : "screen.json is invalid", "screen.json");
      return result;
    }

    if (manifest.screenId !== data.screen.id) {
      addIssue(result.errors, "MANIFEST_SCREEN_ID_MISMATCH", "manifest screenId does not match screen.json", "manifest.json");
    }
    if (manifest.counts.assets !== data.assets.length) {
      addIssue(result.errors, "COUNT_MISMATCH_ASSETS", "manifest asset count does not match screen.json", "manifest.json");
    }
    if (manifest.counts.libraries !== data.libraries.length) {
      addIssue(result.errors, "COUNT_MISMATCH_LIBRARIES", "manifest library count does not match screen.json", "manifest.json");
    }
    if (manifest.counts.tags !== data.tags.length) {
      addIssue(result.errors, "COUNT_MISMATCH_TAGS", "manifest tag count does not match screen.json", "manifest.json");
    }
    if (manifest.counts.macros !== data.macros.length) {
      addIssue(result.errors, "COUNT_MISMATCH_MACROS", "manifest macro count does not match screen.json", "manifest.json");
    }
    if (manifest.counts.events !== undefined && manifest.counts.events !== (data.events ?? []).length) {
      addIssue(result.errors, "COUNT_MISMATCH_EVENTS", "manifest event count does not match screen.json", "manifest.json");
    }

    for (const asset of data.assets) {
      this.validateAssetFile(asset, files, sizes, result.errors);
    }
    for (const library of data.libraries) {
      if (!files.has(`libraries/${library.id}/library.json`)) {
        addIssue(result.errors, "MISSING_LIBRARY_FILE", "Library file is missing", `libraries/${library.id}/library.json`);
      }
      for (const asset of library.assets ?? []) {
        const normalized = normalizeArchivePath(asset.storagePath);
        const archivePath = normalized.ok ? `libraries/${library.id}/${normalized.value}` : asset.storagePath;
        if (!normalized.ok) {
          addIssue(result.errors, "INVALID_LIBRARY_ASSET_PATH", normalized.reason, asset.storagePath);
          continue;
        }
        if (!files.has(archivePath)) {
          addIssue(result.errors, "MISSING_LIBRARY_ASSET_FILE", "Library asset file is missing", archivePath);
        }
      }
    }
    this.validateScreenReferences(data, result.errors, result.warnings);

    result.valid = result.errors.length === 0;
    result.summary = {
      format: SCREEN_FORMAT,
      name: data.screen.name,
      screens: 1,
      tags: data.tags.length,
      assets: data.assets.length,
      libraries: data.libraries.length,
      events: data.events?.length ?? 0,
      macros: data.macros.length,
      variables: 0,
    };
    if (result.valid) {
      result.parsed = { kind: "screen", manifest, data, files, sizes, signature };
    }
    return result;
  }

  private validateAssetFile(asset: Asset, files: Map<string, Buffer>, sizes: Map<string, number>, errors: ProjectArchiveIssue[]): void {
    const normalized = normalizeArchivePath(asset.storagePath);
    if (!normalized.ok) {
      addIssue(errors, "INVALID_ASSET_STORAGE_PATH", normalized.reason, asset.storagePath);
      return;
    }
    if (!ALLOWED_ASSET_MIME.has(asset.mimeType)) {
      addIssue(errors, "UNSUPPORTED_ASSET_MIME", `Unsupported asset mime type: ${asset.mimeType}`, normalized.value);
    }
    if (!files.has(normalized.value)) {
      addIssue(errors, "MISSING_ASSET_FILE", "Asset file referenced in project data is missing", normalized.value);
    }
    const size = sizes.get(normalized.value);
    if (size !== undefined && size > MAX_FILE_SIZE_BYTES) {
      addIssue(errors, "FILE_TOO_LARGE", "Asset file is too large", normalized.value);
    }
  }

  private validateSoundFile(sound: EventSound, files: Map<string, Buffer>, sizes: Map<string, number>, warnings: ProjectArchiveIssue[]): void {
    const storedFileName = parseStoredFileName(sound.filePath);
    if (!storedFileName) {
      return;
    }
    const archivePath = `data/event-sounds/${storedFileName}`;
    if (sound.mimeType && !ALLOWED_SOUND_MIME.has(sound.mimeType)) {
      addIssue(warnings, "UNSUPPORTED_SOUND_MIME", `Unsupported sound mime type: ${sound.mimeType}`, archivePath);
    }
    if (!files.has(archivePath)) {
      addIssue(warnings, "MISSING_EVENT_SOUND_FILE", "Custom event sound file is missing", archivePath);
    }
    const size = sizes.get(archivePath);
    if (size !== undefined && size > MAX_FILE_SIZE_BYTES) {
      addIssue(warnings, "FILE_TOO_LARGE", "Event sound file is too large", archivePath);
    }
  }

  private addSignature(zip: AdmZip, manifestBytes: Buffer): void {
    const secret = archiveSecret();
    if (!secret) {
      return;
    }
    const signature: ProjectArchiveSignature = {
      algorithm: "HMAC-SHA256",
      signedPayload: "manifest.json",
      signature: hmacSha256(manifestBytes, secret),
      createdAt: nowIso(),
    };
    zip.addFile("signature.json", Buffer.from(JSON.stringify(signature, null, 2), "utf8"));
  }

  private collectScreenArchiveDependencies(
    project: ScadaProject,
    screen: HmiScreen,
    mode: ScreenArchiveDependencyMode,
  ): {
    assets: Asset[];
    libraries: string[];
    tags: TagDefinition[];
    variables: InternalVariableDefinition[];
    lwStore?: LwStoreConfig;
    macros: MacroDefinition[];
    events: EventDefinition[];
    warnings: ProjectArchiveIssue[];
  } {
    const completedProject = completePortableProjectForArchive(project);
    if (mode === "safe") {
      return {
        assets: [...(completedProject.assets ?? [])],
        libraries: (completedProject.libraries ?? []).filter((ref) => ref.enabled !== false).map((ref) => ref.libraryId),
        tags: [...completedProject.tags],
        variables: [...(completedProject.variables ?? [])],
        lwStore: completedProject.lwStore ? { ...completedProject.lwStore, values: { ...(completedProject.lwStore.values ?? {}) } } : undefined,
        macros: [...(completedProject.macros ?? [])],
        events: [...(completedProject.events ?? [])],
        warnings: [],
      };
    }
    return collectDependencies(completedProject, screen);
  }

  private validateProjectReferences(project: ScadaProject, files: Map<string, Buffer>, errors: ProjectArchiveIssue[], warnings: ProjectArchiveIssue[]): void {
    const assetIds = new Set((project.assets ?? []).map((asset) => asset.id));
    const tagNames = buildBindableTagNames(project);
    const variableNames = new Set((project.variables ?? []).flatMap((variable) => [variable.name, toInternalTagName(variable.name)]));
    const lwAddresses = new Set<number>([
      ...Object.keys(project.lwStore?.values ?? {}).map((address) => Number(address)).filter((address) => Number.isFinite(address)),
      ...(project.variables ?? []).map((variable) => variable.lwAddress).filter((address): address is number => typeof address === "number" && Number.isFinite(address)),
    ]);
    const macroIds = new Set((project.macros ?? []).map((macro) => macro.id));
    const screenIds = new Set(project.screens.map((screen) => screen.id));
    const libraryElements = new Map<string, Set<string>>();

    for (const ref of project.libraries ?? []) {
      const bytes = files.get(`libraries/${ref.libraryId}/library.json`);
      if (!bytes) {
        continue;
      }
      try {
        const library = JSON.parse(bytes.toString("utf8")) as ElementLibrary;
        libraryElements.set(library.id, new Set(library.elements.flatMap((element) => [
          element.id,
          element.name,
          (element as { elementKey?: string }).elementKey,
        ].filter((value): value is string => Boolean(value)))));
      } catch {
        addIssue(errors, "INVALID_LIBRARY_JSON", "Attached library JSON is invalid.", `libraries/${ref.libraryId}/library.json`);
      }
    }

    for (const screen of project.screens) {
      const refs = makeScreenDependencyRefs();
      screen.objects.forEach((object) => collectKnownObjectRefs(object, refs));
      this.reportBrokenRefs(refs, { assetIds, tagNames, variableNames, lwAddresses, macroIds, screenIds, libraryElements }, warnings, warnings, `screen:${screen.id}`);
    }

    for (const macro of project.macros ?? []) {
      macroTagReferences(macro.code).forEach((tagName) => {
        if (!tagNames.has(tagName)) {
          addIssue(warnings, "BROKEN_TAG_REFERENCE", `Macro '${macro.id}' references missing tag '${tagName}'.`, `macro:${macro.id}`);
        }
      });
      macroVariableReferences(macro.code).forEach((variableName) => {
        if (!variableNames.has(variableName) && !variableNames.has(toInternalTagName(variableName))) {
          addIssue(warnings, "BROKEN_VARIABLE_REFERENCE", `Macro '${macro.id}' references missing variable '${variableName}'.`, `macro:${macro.id}`);
        }
      });
      macroLwReferences(macro.code).forEach((address) => {
        if (!lwAddresses.has(address)) {
          addIssue(warnings, "BROKEN_LW_REFERENCE", `Macro '${macro.id}' references missing LW address ${address}.`, `macro:${macro.id}`);
        }
      });
      for (const trigger of macro.triggers ?? []) {
        if ((trigger.type === "onScreenOpen" || trigger.type === "onScreenClose" || trigger.type === "onButtonClick") && trigger.screenKey && !screenIds.has(trigger.screenKey) && !project.screens.some((screen) => screen.name === trigger.screenKey)) {
          addIssue(warnings, "BROKEN_SCREEN_REFERENCE", `Macro '${macro.id}' references missing screen '${trigger.screenKey}'.`, `macro:${macro.id}`);
        }
        if (trigger.type === "onTagChange" && !tagNames.has(trigger.tag)) {
          addIssue(warnings, "BROKEN_TAG_REFERENCE", `Macro '${macro.id}' references missing tag '${trigger.tag}'.`, `macro:${macro.id}`);
        }
        if (trigger.type === "onCondition") {
          collectExpressionTagReferences(trigger.condition).forEach((tagName) => {
            if (!tagNames.has(tagName)) {
              addIssue(warnings, "BROKEN_TAG_REFERENCE", `Macro '${macro.id}' condition references missing tag '${tagName}'.`, `macro:${macro.id}`);
            }
          });
        }
      }
    }

    for (const event of project.events ?? []) {
      this.collectEventTagRefs(event).forEach((tagName) => {
        if (!tagNames.has(tagName)) {
          addIssue(warnings, "BROKEN_TAG_REFERENCE", `Event '${event.id}' references missing tag '${tagName}'.`, `event:${event.id}`);
        }
      });
    }
  }

  private validateScreenReferences(data: ScreenArchiveData, errors: ProjectArchiveIssue[], warnings: ProjectArchiveIssue[]): void {
    const assetIds = new Set(data.assets.map((asset) => asset.id));
    const tagNames = buildBindableTagNames({
      version: 1,
      name: "screen",
      drivers: [],
      tags: data.tags,
      variables: data.variables ?? [],
      lwStore: data.lwStore,
      screens: [data.screen],
    });
    const variableNames = new Set((data.variables ?? []).flatMap((variable) => [variable.name, toInternalTagName(variable.name)]));
    const lwAddresses = new Set<number>([
      ...Object.keys(data.lwStore?.values ?? {}).map((address) => Number(address)).filter((address) => Number.isFinite(address)),
      ...(data.variables ?? []).map((variable) => variable.lwAddress).filter((address): address is number => typeof address === "number" && Number.isFinite(address)),
    ]);
    const macroIds = new Set(data.macros.map((macro) => macro.id));
    const screenIds = new Set([data.screen.id]);
    const libraryElements = new Map(data.libraries.map((library) => [library.id, new Set(library.elements.map((element) => element.id))]));
    const refs = makeScreenDependencyRefs();

    data.screen.objects.forEach((object) => collectKnownObjectRefs(object, refs));
    this.reportBrokenRefs(refs, { assetIds, tagNames, variableNames, lwAddresses, macroIds, screenIds, libraryElements }, errors, warnings, `screen:${data.screen.id}`);
    for (const event of data.events ?? []) {
      this.collectEventTagRefs(event).forEach((tagName) => {
        if (!tagNames.has(tagName)) {
          addIssue(warnings, "BROKEN_TAG_REFERENCE", `Event '${event.id}' references missing tag '${tagName}'.`, `event:${event.id}`);
        }
      });
    }
  }

  private collectEventTagRefs(event: EventDefinition): string[] {
    const refs = new Set<string>();
    [
      event.sourceTagName,
      event.ackTagName,
      event.notificationTagName,
      event.elapsedTimeTagName,
      event.securityTagName,
    ].forEach((tagName) => {
      if (tagName && isStaticReferenceValue(tagName)) {
        refs.add(tagName);
      }
    });
    [...(event.onActiveActions ?? []), ...(event.onClearedActions ?? []), ...(event.onAckActions ?? [])].forEach((action) => {
      const actionRefs = makeScreenDependencyRefs();
      collectRuntimeActionRefs(action, actionRefs);
      actionRefs.tagNames.forEach((tagName) => refs.add(tagName));
    });
    return [...refs];
  }

  private reportBrokenRefs(
    refs: ScreenDependencyRefs,
    known: {
      assetIds: Set<string>;
      tagNames: Set<string>;
      variableNames: Set<string>;
      lwAddresses: Set<number>;
      macroIds: Set<string>;
      screenIds: Set<string>;
      libraryElements: Map<string, Set<string>>;
    },
    errors: ProjectArchiveIssue[],
    warnings: ProjectArchiveIssue[],
    scope: string,
  ): void {
    for (const assetId of refs.assetIds) {
      if (!known.assetIds.has(assetId)) {
        addIssue(errors, "BROKEN_ASSET_REFERENCE", `Missing asset reference '${assetId}'.`, scope);
      }
    }
    for (const tagName of refs.tagNames) {
      if (!known.tagNames.has(tagName)) {
        addIssue(warnings, "BROKEN_TAG_REFERENCE", `Missing statically detectable tag reference '${tagName}'.`, scope);
      }
    }
    for (const variableName of refs.variableNames) {
      if (!known.variableNames.has(variableName) && !known.variableNames.has(toInternalTagName(variableName))) {
        addIssue(warnings, "BROKEN_VARIABLE_REFERENCE", `Missing internal variable reference '${variableName}'.`, scope);
      }
    }
    for (const address of refs.lwAddresses) {
      if (!known.lwAddresses.has(address) && !known.tagNames.has(toLwTagName(address))) {
        addIssue(warnings, "BROKEN_LW_REFERENCE", `Missing LW address reference '${address}'.`, scope);
      }
    }
    for (const macroId of refs.macroIds) {
      if (!known.macroIds.has(macroId)) {
        addIssue(errors, "BROKEN_MACRO_REFERENCE", `Missing macro reference '${macroId}'.`, scope);
      }
    }
    for (const screenId of refs.screenIds) {
      if (!known.screenIds.has(screenId)) {
        addIssue(errors, "BROKEN_SCREEN_REFERENCE", `Missing screen reference '${screenId}'.`, scope);
      }
    }
    for (const [libraryId, elementIds] of refs.libraryElements) {
      const knownElements = known.libraryElements.get(libraryId);
      if (!knownElements) {
        addIssue(errors, "BROKEN_LIBRARY_REFERENCE", `Missing library reference '${libraryId}'.`, scope);
        continue;
      }
      for (const elementId of elementIds) {
        if (!knownElements.has(elementId)) {
          addIssue(errors, "BROKEN_LIBRARY_ELEMENT_REFERENCE", `Missing library element '${libraryId}/${elementId}'.`, scope);
        }
      }
    }
    warnings.push(...refs.dynamicWarnings);
  }

  private stripParsed<T extends ProjectArchiveValidationResult & { parsed?: AnyParsedArchive }>(input: T): ProjectArchiveValidationResult {
    const { parsed: _parsed, ...rest } = input;
    return rest;
  }

  private async addLooseLibraryFiles(
    libraryDir: string,
    archivePrefix: string,
    zip: AdmZip,
    files: ArchiveManifestFile[],
  ): Promise<void> {
    const addRecursive = async (absoluteDir: string, relativeDir: string): Promise<void> => {
      const entries = await readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const absolute = path.join(absoluteDir, entry.name);
        const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await addRecursive(absolute, relative);
          continue;
        }
        if (!entry.isFile() || relative === "library.json") {
          continue;
        }
        const archivePath = `${archivePrefix}/${relative}`;
        if (files.some((item) => item.path === archivePath) || !isSupportedArchiveFile(archivePath)) {
          continue;
        }
        const buffer = await readFile(absolute).catch(() => undefined);
        if (!buffer) {
          continue;
        }
        zip.addFile(archivePath, buffer);
        files.push({ path: archivePath, type: "libraryAsset", size: buffer.byteLength, sha256: sha256(buffer) });
      }
    };
    await addRecursive(libraryDir, "");
  }

  private normalizeImportedProject(project: ScadaProject): ScadaProject {
    return {
      ...project,
      assets: (project.assets ?? []).map(withProjectAssetPreview),
      eventSounds: project.eventSounds?.map((sound) => {
        if (!sound.filePath) {
          return sound;
        }
        return {
          ...sound,
          url: `/api/event-sounds/${encodeURIComponent(sound.id)}/file`,
        };
      }),
      libraries: project.libraries?.map((ref) => ({
        ...ref,
        path: path.dirname(this.libraryService.libraryFilePath(ref.libraryId)),
      })),
    };
  }

  private async stageProjectImport(parsed: ParsedProjectArchive, project: ScadaProject): Promise<StagedProjectImport> {
    const projectFile = this.projectService.getProjectFile();
    const projectDir = path.dirname(projectFile);
    const stageRoot = path.join(projectDir, `.import-stage-${randomUUID()}`);
    const rollbackRoot = path.join(projectDir, `.import-rollback-${randomUUID()}`);
    const stagedProjectDir = path.join(stageRoot, "project");
    const stagedProjectFile = path.join(stagedProjectDir, path.basename(projectFile));
    const stagedAssetsDir = path.join(stagedProjectDir, "assets");
    const stagedEventSoundsDir = path.join(stageRoot, "event-sounds");
    const librariesRoot = this.getLibrariesRoot();
    const stagedLibrariesRoot = path.join(stageRoot, "libraries");
    const libraryIds: string[] = [];

    await mkdir(stagedProjectDir, { recursive: true });
    await writeFile(stagedProjectFile, JSON.stringify(projectSchema.parse(project), null, 2), "utf8");

    for (const asset of parsed.project.assets ?? []) {
      const normalized = normalizeArchivePath(asset.storagePath);
      if (!normalized.ok) {
        throw new Error(normalized.reason);
      }
      const buffer = parsed.files.get(normalized.value);
      if (!buffer) {
        throw new Error(`Missing staged asset file: ${normalized.value}`);
      }
      await this.writeArchiveFile(stagedProjectDir, normalized.value, buffer);
    }

    for (const sound of parsed.project.eventSounds ?? []) {
      const storedFileName = parseStoredFileName(sound.filePath);
      if (!storedFileName) {
        continue;
      }
      const buffer = parsed.files.get(`data/event-sounds/${storedFileName}`);
      if (!buffer) {
        throw new Error(`Missing staged event sound file: data/event-sounds/${storedFileName}`);
      }
      await mkdir(stagedEventSoundsDir, { recursive: true });
      await writeFile(path.join(stagedEventSoundsDir, storedFileName), buffer);
    }

    for (const ref of parsed.project.libraries ?? []) {
      if (ref.enabled === false || !parsed.files.has(`libraries/${ref.libraryId}/library.json`)) {
        continue;
      }
      const libraryBytes = parsed.files.get(`libraries/${ref.libraryId}/library.json`)!;
      const library = normalizeImportedLibrary(JSON.parse(libraryBytes.toString("utf8")) as ElementLibrary, ref.libraryId);
      await this.restoreLibraryToRoot(parsed, ref.libraryId, library, stagedLibrariesRoot);
      libraryIds.push(ref.libraryId);
    }

    return {
      stageRoot,
      rollbackRoot,
      projectFile,
      projectDir,
      stagedProjectFile,
      stagedAssetsDir,
      stagedEventSoundsDir,
      librariesRoot,
      stagedLibrariesRoot,
      libraryIds,
    };
  }

  private getLibrariesRoot(): string {
    return path.dirname(path.dirname(this.libraryService.libraryFilePath("__archive_probe__")));
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    return readFile(targetPath).then(() => true).catch(async () => {
      const entries = await readdir(targetPath).catch(() => undefined);
      return entries !== undefined;
    });
  }

  private async moveIfExists(from: string, to: string): Promise<boolean> {
    if (!(await this.pathExists(from))) {
      return false;
    }
    await mkdir(path.dirname(to), { recursive: true });
    await rm(to, { recursive: true, force: true });
    await rename(from, to);
    return true;
  }

  private async swapStagedProjectImport(staged: StagedProjectImport): Promise<void> {
    await mkdir(staged.rollbackRoot, { recursive: true });
    await this.moveIfExists(staged.projectFile, path.join(staged.rollbackRoot, "project.json"));
    await this.moveIfExists(path.join(staged.projectDir, "assets"), path.join(staged.rollbackRoot, "assets"));
    await this.moveIfExists(this.eventSoundService.getStorageDir(), path.join(staged.rollbackRoot, "event-sounds"));

    for (const libraryId of staged.libraryIds) {
      await this.moveIfExists(
        path.dirname(this.libraryService.libraryFilePath(libraryId)),
        path.join(staged.rollbackRoot, "libraries", safeId(libraryId)),
      );
    }

    await mkdir(staged.projectDir, { recursive: true });
    await rename(staged.stagedProjectFile, staged.projectFile);
    if (await this.pathExists(staged.stagedAssetsDir)) {
      await rename(staged.stagedAssetsDir, path.join(staged.projectDir, "assets"));
    }
    if (await this.pathExists(staged.stagedEventSoundsDir)) {
      await mkdir(path.dirname(this.eventSoundService.getStorageDir()), { recursive: true });
      await rename(staged.stagedEventSoundsDir, this.eventSoundService.getStorageDir());
    }
    for (const libraryId of staged.libraryIds) {
      const stagedLibraryDir = path.join(staged.stagedLibrariesRoot, safeId(libraryId));
      if (await this.pathExists(stagedLibraryDir)) {
        await mkdir(staged.librariesRoot, { recursive: true });
        await rename(stagedLibraryDir, path.dirname(this.libraryService.libraryFilePath(libraryId)));
      }
    }
  }

  private async rollbackProjectImport(staged: StagedProjectImport): Promise<void> {
    const rollbackProjectFile = path.join(staged.rollbackRoot, "project.json");
    const rollbackAssetsDir = path.join(staged.rollbackRoot, "assets");
    const rollbackEventSoundsDir = path.join(staged.rollbackRoot, "event-sounds");

    if (await this.pathExists(rollbackProjectFile)) {
      await rm(staged.projectFile, { force: true }).catch(() => undefined);
      await this.moveIfExists(rollbackProjectFile, staged.projectFile);
    }
    if (await this.pathExists(rollbackAssetsDir)) {
      await rm(path.join(staged.projectDir, "assets"), { recursive: true, force: true }).catch(() => undefined);
      await this.moveIfExists(rollbackAssetsDir, path.join(staged.projectDir, "assets"));
    }
    if (await this.pathExists(rollbackEventSoundsDir)) {
      await rm(this.eventSoundService.getStorageDir(), { recursive: true, force: true }).catch(() => undefined);
      await this.moveIfExists(rollbackEventSoundsDir, this.eventSoundService.getStorageDir());
    }
    for (const libraryId of staged.libraryIds) {
      const rollbackLibraryDir = path.join(staged.rollbackRoot, "libraries", safeId(libraryId));
      if (await this.pathExists(rollbackLibraryDir)) {
        await rm(path.dirname(this.libraryService.libraryFilePath(libraryId)), { recursive: true, force: true }).catch(() => undefined);
        await this.moveIfExists(rollbackLibraryDir, path.dirname(this.libraryService.libraryFilePath(libraryId)));
      }
    }
    await this.projectService.loadProject().catch(() => undefined);
  }

  private async restoreProjectFiles(parsed: ParsedProjectArchive, projectDir: string): Promise<void> {
    await rm(path.join(projectDir, "assets"), { recursive: true, force: true });
    for (const asset of parsed.project.assets ?? []) {
      const normalized = normalizeArchivePath(asset.storagePath);
      if (!normalized.ok) {
        continue;
      }
      const buffer = parsed.files.get(normalized.value);
      if (buffer) {
        await this.writeArchiveFile(projectDir, normalized.value, buffer);
      }
    }

    for (const sound of parsed.project.eventSounds ?? []) {
      const storedFileName = parseStoredFileName(sound.filePath);
      if (!storedFileName) {
        continue;
      }
      const buffer = parsed.files.get(`data/event-sounds/${storedFileName}`);
      if (buffer) {
        await mkdir(this.eventSoundService.getStorageDir(), { recursive: true });
        await writeFile(path.join(this.eventSoundService.getStorageDir(), storedFileName), buffer);
      }
    }

    for (const ref of parsed.project.libraries ?? []) {
      if (ref.enabled === false || !parsed.files.has(`libraries/${ref.libraryId}/library.json`)) {
        continue;
      }
      const libraryBytes = parsed.files.get(`libraries/${ref.libraryId}/library.json`)!;
      const library = normalizeImportedLibrary(JSON.parse(libraryBytes.toString("utf8")) as ElementLibrary, ref.libraryId);
      await this.restoreLibrary(parsed, ref.libraryId, library);
    }
  }

  private async restoreLibrary(parsed: ParsedZip, sourceLibraryId: string, library: ElementLibrary): Promise<void> {
    const targetDir = path.dirname(this.libraryService.libraryFilePath(library.id));
    const tmpDir = `${targetDir}.import-${randomUUID()}`;
    const backupDir = `${targetDir}.backup-${Date.now()}`;
    await this.cleanupStaleLibraryImportDirs(targetDir);
    await mkdir(tmpDir, { recursive: true });
    await writeFile(path.join(tmpDir, "library.json"), JSON.stringify(library, null, 2), "utf8");

    const prefix = `libraries/${sourceLibraryId}/`;
    for (const [archivePath, buffer] of parsed.files.entries()) {
      if (!archivePath.startsWith(prefix) || archivePath === `${prefix}library.json`) {
        continue;
      }
      const relative = archivePath.slice(prefix.length);
      const normalized = normalizeArchivePath(relative);
      if (!normalized.ok || !isSupportedArchiveFile(normalized.value)) {
        continue;
      }
      await this.writeArchiveFile(tmpDir, normalized.value, buffer);
    }

    await mkdir(path.dirname(targetDir), { recursive: true });
    const existed = await this.pathExists(targetDir);
    if (existed) {
      await rename(targetDir, backupDir);
    }
    try {
      await rename(tmpDir, targetDir);
      if (existed) {
        await rm(backupDir, { recursive: true, force: true });
      }
    } catch (error) {
      if (existed) {
        await rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
        await rename(backupDir, targetDir).catch(() => undefined);
      }
      throw error;
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async cleanupStaleLibraryImportDirs(targetDir: string): Promise<void> {
    const parent = path.dirname(targetDir);
    const base = path.basename(targetDir);
    const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (!entry.name.startsWith(`${base}.import-`)) {
        continue;
      }
      await rm(path.join(parent, entry.name), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async restoreLibraryToRoot(parsed: ParsedZip, sourceLibraryId: string, library: ElementLibrary, librariesRoot: string): Promise<void> {
    const targetDir = path.join(librariesRoot, safeId(library.id));
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, "library.json"), JSON.stringify(library, null, 2), "utf8");

    const prefix = `libraries/${sourceLibraryId}/`;
    for (const [archivePath, buffer] of parsed.files.entries()) {
      if (!archivePath.startsWith(prefix) || archivePath === `${prefix}library.json`) {
        continue;
      }
      const relative = archivePath.slice(prefix.length);
      const normalized = normalizeArchivePath(relative);
      if (!normalized.ok || !isSupportedArchiveFile(normalized.value)) {
        continue;
      }
      await this.writeArchiveFile(targetDir, normalized.value, buffer);
    }
  }

  private async writeArchiveFile(root: string, relativePath: string, buffer: Buffer): Promise<void> {
    const normalized = normalizeArchivePath(relativePath);
    if (!normalized.ok) {
      throw new Error(normalized.reason);
    }
    const target = path.join(root, ...normalized.value.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);
  }

  public async createProjectBackup(): Promise<string> {
    const backupDir = path.join(path.dirname(this.projectService.getProjectFile()), "backups");
    await mkdir(backupDir, { recursive: true });
    const exported = await this.exportProjectArchive();
    const backupPath = path.join(backupDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${exported.fileName}`);
    await writeFile(backupPath, exported.buffer);
    return backupPath;
  }

  private mergeEvents(existing: EventDefinition[], incoming: EventDefinition[], warnings: ProjectArchiveIssue[]): EventDefinition[] {
    const next = [...existing];
    const existingIds = new Set(next.map((event) => event.id));
    for (const event of incoming) {
      if (existingIds.has(event.id)) {
        addIssue(warnings, "EVENT_SKIPPED", `Event '${event.id}' already exists and was skipped.`);
        continue;
      }
      next.push(event);
      existingIds.add(event.id);
    }
    return next;
  }

  private async readLocalLibraryFiles(libraryId: string): Promise<Map<string, Buffer>> {
    const root = path.dirname(this.libraryService.libraryFilePath(libraryId));
    const out = new Map<string, Buffer>();
    const readRecursive = async (absoluteDir: string, relativeDir: string): Promise<void> => {
      const entries = await readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const absolute = path.join(absoluteDir, entry.name);
        const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await readRecursive(absolute, relative);
          continue;
        }
        if (!entry.isFile() || relative === "library.json") {
          continue;
        }
        const bytes = await readFile(absolute).catch(() => undefined);
        if (bytes) {
          out.set(relative, bytes);
        }
      }
    };
    await readRecursive(root, "");
    return out;
  }
}
