import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type {
  Asset,
  ElementLibrary,
  EventDefinition,
  HmiObject,
  InternalVariableDefinition,
  LwStoreConfig,
  MacroDefinition,
  ProjectCleanupAnalyzeRequest,
  ProjectCleanupAnalyzeResponse,
  ProjectCleanupApplyRequest,
  ProjectCleanupApplyResponse,
  ProjectCleanupCandidate,
  ProjectCleanupCategory,
  ScadaProject,
} from "@web-scada/shared";
import {
  projectCleanupAnalyzeRequestSchema,
  projectCleanupApplyRequestSchema,
  projectCleanupCandidateTypeSchema,
} from "@web-scada/shared";
import { LibraryService } from "../libraries/library-service.js";
import { ProjectArchiveService } from "./project-archive-service.js";
import { ProjectService } from "./project-service.js";

type CleanupAnalysisRecord = {
  token: string;
  fingerprint: string;
  createdAt: string;
  requestedCategories: ProjectCleanupCategory[];
  candidates: ProjectCleanupCandidate[];
};

type CleanupApplyReplay = {
  key: string;
  response: ProjectCleanupApplyResponse;
};

type ProjectRefs = {
  assetIds: Set<string>;
  libraryIds: Set<string>;
  macroIds: Set<string>;
  tagNames: Set<string>;
  variableNames: Set<string>;
  lwAddresses: Set<number>;
  screenIds: Set<string>;
  dynamicWarnings: string[];
};

type CollectObjectRefsOptions = {
  includeAssetRefs?: boolean;
};

type RewriteResult = {
  value: unknown;
  replacements: number;
};

type ApplyAccumulator = {
  rewrittenReferences: number;
  deletedAssets: Set<string>;
  deletedLibraries: Set<string>;
  deletedMacros: Set<string>;
  deletedVariables: Set<string>;
  deletedLwEntries: Set<number>;
  deletedTags: Set<string>;
  deletedEvents: Set<string>;
  deletedEventSounds: Set<string>;
  deletedFiles: Set<string>;
  skipped: Array<{ candidateId: string; reason: string }>;
  warnings: string[];
};

const DEFAULT_CLEANUP_CATEGORIES: ProjectCleanupCategory[] = [
  "assets",
  "libraries",
  "macros",
  "variables",
  "lw",
  "tags",
  "events",
  "event-sounds",
  "files",
  "drivers",
];

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
}

function normalizeArchiveRelativePath(input: string): string | null {
  const replaced = input.replace(/\\/g, "/").trim();
  if (!replaced || replaced.includes("\0") || replaced.startsWith("/") || /^[a-zA-Z]:/.test(replaced)) {
    return null;
  }
  const parts = replaced.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    return null;
  }
  return parts.join("/");
}

function isStaticRef(value: string): boolean {
  return value.trim().length > 0
    && !/[{}$]/.test(value)
    && !value.includes("[")
    && !value.includes("]")
    && !value.includes("${");
}

function makeRefs(): ProjectRefs {
  return {
    assetIds: new Set<string>(),
    libraryIds: new Set<string>(),
    macroIds: new Set<string>(),
    tagNames: new Set<string>(),
    variableNames: new Set<string>(),
    lwAddresses: new Set<number>(),
    screenIds: new Set<string>(),
    dynamicWarnings: [],
  };
}

function addDynamicWarning(refs: ProjectRefs, warning: string): void {
  if (!refs.dynamicWarnings.includes(warning)) {
    refs.dynamicWarnings.push(warning);
  }
}

function collectExpressionTagRefs(expression: string, refs: ProjectRefs): void {
  const pattern = /\b(?:tag|readTag|writeTag|pulseTag|toggleTag)\s*\(\s*(['"`])([^'"`]+)\1/g;
  let match = pattern.exec(expression);
  let foundStatic = false;
  while (match) {
    const candidate = match[2]?.trim();
    if (candidate && isStaticRef(candidate)) {
      refs.tagNames.add(candidate);
      foundStatic = true;
    }
    match = pattern.exec(expression);
  }
  if (!foundStatic && /\btag\s*\(/.test(expression)) {
    addDynamicWarning(refs, "Expression contains unresolved dynamic tag references.");
  }
}

function collectRuntimeActionRefs(action: unknown, refs: ProjectRefs): void {
  if (!action || typeof action !== "object") {
    return;
  }
  const source = action as Record<string, unknown>;
  switch (source.type) {
    case "openScreen":
      if (typeof source.screenId === "string") {
        refs.screenIds.add(source.screenId);
      }
      break;
    case "openPopup":
      if (typeof source.popupScreenId === "string") {
        refs.screenIds.add(source.popupScreenId);
      }
      if (typeof source.tagPrefix === "string" && source.tagPrefix.trim()) {
        addDynamicWarning(refs, "Popup tagPrefix can resolve tags dynamically.");
      }
      break;
    case "runMacro":
      if (typeof source.macroId === "string") {
        refs.macroIds.add(source.macroId);
      }
      break;
    case "write":
    case "pulse":
    case "toggle":
      if (typeof source.tag === "string" && isStaticRef(source.tag)) {
        refs.tagNames.add(source.tag);
      }
      break;
    case "writeConst":
    case "writeNumberPrompt":
      if (source.target === "tag" && typeof source.name === "string" && isStaticRef(source.name)) {
        refs.tagNames.add(source.name);
      }
      if (source.target === "variable" && typeof source.name === "string") {
        refs.variableNames.add(source.name);
      }
      break;
    case "setLW":
      if (typeof source.address === "number" && Number.isFinite(source.address)) {
        refs.lwAddresses.add(Math.max(0, Math.floor(source.address)));
      }
      break;
    case "setInternalVar":
      if (typeof source.name === "string") {
        refs.variableNames.add(source.name);
      }
      break;
    default:
      break;
  }
}

function collectMacroRefsFromCode(code: string, refs: ProjectRefs): void {
  const tagPattern = /\b(?:tag|readTag|writeTag|pulseTag|toggleTag)\s*\(\s*(['"`])([^'"`]+)\1/g;
  let tagMatch = tagPattern.exec(code);
  while (tagMatch) {
    const tag = tagMatch[2]?.trim();
    if (tag && isStaticRef(tag)) {
      refs.tagNames.add(tag);
    }
    tagMatch = tagPattern.exec(code);
  }

  const varPattern = /\b(?:getVar|setVar|readVariable|writeVariable)\s*\(\s*(['"`])([^'"`]+)\1/g;
  let varMatch = varPattern.exec(code);
  while (varMatch) {
    const variable = varMatch[2]?.trim();
    if (variable && isStaticRef(variable)) {
      refs.variableNames.add(variable);
    }
    varMatch = varPattern.exec(code);
  }

  const lwPattern = /\b(?:getLW|setLW)\s*\(\s*(\d+)/g;
  let lwMatch = lwPattern.exec(code);
  while (lwMatch) {
    const address = Number(lwMatch[1]);
    if (Number.isFinite(address)) {
      refs.lwAddresses.add(Math.max(0, Math.floor(address)));
    }
    lwMatch = lwPattern.exec(code);
  }

  if (/\b(resolveTag|getCurrentTagPrefix)\s*\(/.test(code) || /\b(readTag|writeTag|pulseTag|toggleTag)\s*\(\s*[^'"`\s]/.test(code)) {
    addDynamicWarning(refs, "Macro code includes dynamic tag access.");
  }
}

function collectBindingsRefs(bindings: unknown, refs: ProjectRefs): void {
  if (!bindings || typeof bindings !== "object") {
    return;
  }
  for (const binding of Object.values(bindings as Record<string, unknown>)) {
    if (!binding || typeof binding !== "object") {
      continue;
    }
    const source = binding as Record<string, unknown>;
    if (source.mode === "tag" && typeof source.source === "string" && isStaticRef(source.source)) {
      refs.tagNames.add(source.source);
    }
    if (source.mode === "expr" && typeof source.source === "string") {
      collectExpressionTagRefs(source.source, refs);
    }
  }
}

function collectObjectAssetRefs(object: HmiObject, refs: ProjectRefs): void {
  if (object.type === "image") {
    if (object.assetId) {
      refs.assetIds.add(object.assetId);
    }
    for (const state of object.stateImages ?? []) {
      if (state.assetId) {
        refs.assetIds.add(state.assetId);
      }
    }
  }
  if (object.type === "stateImage") {
    if (object.defaultAssetId) {
      refs.assetIds.add(object.defaultAssetId);
    }
    if (object.badQualityAssetId) {
      refs.assetIds.add(object.badQualityAssetId);
    }
    for (const state of object.states) {
      if (state.assetId) {
        refs.assetIds.add(state.assetId);
      }
    }
  }
  if (object.type === "numeric-image-indicator") {
    if (object.defaultAssetId) {
      refs.assetIds.add(object.defaultAssetId);
    }
    if (object.badQualityAssetId) {
      refs.assetIds.add(object.badQualityAssetId);
    }
    for (const state of object.states) {
      if (state.assetId) {
        refs.assetIds.add(state.assetId);
      }
    }
  }
  if (object.type === "button") {
    if (object.backgroundAssetId) {
      refs.assetIds.add(object.backgroundAssetId);
    }
    if (object.pressedBackgroundAssetId) {
      refs.assetIds.add(object.pressedBackgroundAssetId);
    }
    if (object.disabledBackgroundAssetId) {
      refs.assetIds.add(object.disabledBackgroundAssetId);
    }
  }
}

function collectKnownObjectRefs(object: HmiObject, refs: ProjectRefs, options?: CollectObjectRefsOptions): void {
  const includeAssetRefs = options?.includeAssetRefs !== false;
  collectBindingsRefs(object.bindings, refs);
  if (typeof object.visibleTag === "string" && isStaticRef(object.visibleTag)) {
    refs.tagNames.add(object.visibleTag);
  }
  if (typeof object.disabledTag === "string" && isStaticRef(object.disabledTag)) {
    refs.tagNames.add(object.disabledTag);
  }
  if (typeof object.onPressMacroId === "string") {
    refs.macroIds.add(object.onPressMacroId);
  }
  if (typeof object.onReleaseMacroId === "string") {
    refs.macroIds.add(object.onReleaseMacroId);
  }
  if (object.tagIndexing || object.tagIndexingByField) {
    addDynamicWarning(refs, `Object ${object.id} uses indexed tag addressing.`);
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
      for (const child of object.objects) {
        collectKnownObjectRefs(child, refs, options);
      }
      break;
    case "libraryElementInstance":
      refs.libraryIds.add(object.libraryId);
      if (object.tagPrefix) {
        addDynamicWarning(refs, `Library element instance ${object.id} uses tagPrefix.`);
      }
      for (const assignment of Object.values(object.bindingAssignments ?? {})) {
        if (assignment.baseTag && isStaticRef(assignment.baseTag)) {
          refs.tagNames.add(assignment.baseTag);
        }
        if (assignment.overrideTag && isStaticRef(assignment.overrideTag)) {
          refs.tagNames.add(assignment.overrideTag);
        }
        if (assignment.prefix || assignment.prefixMode?.type !== "none" || assignment.indexMode?.type !== "none") {
          addDynamicWarning(refs, `Library element instance ${object.id} derives tag names dynamically.`);
        }
      }
      break;
    case "frame":
      refs.screenIds.add(object.screenId);
      if (object.tagPrefix) {
        addDynamicWarning(refs, `Frame ${object.id} uses tagPrefix.`);
      }
      break;
    case "trendChart":
      for (const series of object.selectedTags) {
        if (series.tag && isStaticRef(series.tag)) {
          refs.tagNames.add(series.tag);
        }
      }
      break;
    case "eventTable":
      if (object.sourceTagFilter) {
        refs.tagNames.add(object.sourceTagFilter);
      }
      break;
    case "valueSelect":
      if (object.target.type === "tag" && isStaticRef(object.target.tag)) {
        refs.tagNames.add(object.target.tag);
      }
      if (object.target.type === "internal") {
        refs.variableNames.add(object.target.name);
      }
      if (object.target.type === "lw") {
        refs.lwAddresses.add(object.target.address);
      }
      break;
    default:
      break;
  }

  if (includeAssetRefs) {
    collectObjectAssetRefs(object, refs);
  }
}

function collectLibraryElementRefs(library: ElementLibrary, refs: ProjectRefs): void {
  for (const element of library.elements ?? []) {
    for (const object of element.objects ?? []) {
      // Library element assets are library-local, not project assets.
      collectKnownObjectRefs(object, refs, { includeAssetRefs: false });
    }
    for (const stateRule of element.stateRules ?? []) {
      if (stateRule.source.type === "tag" && isStaticRef(stateRule.source.value)) {
        refs.tagNames.add(stateRule.source.value);
      }
      if (stateRule.source.type === "expression") {
        collectExpressionTagRefs(stateRule.source.value, refs);
      }
      for (const stateCase of stateRule.cases ?? []) {
        for (const action of stateCase.actions ?? []) {
          if (action.type === "setProperty" && typeof action.value === "string" && action.property.toLowerCase().includes("tag") && isStaticRef(action.value)) {
            refs.tagNames.add(action.value);
          }
        }
      }
    }
  }
  for (const macro of library.macros ?? []) {
    collectMacroRefsFromCode(macro.code, refs);
    for (const trigger of macro.triggers ?? []) {
      if (trigger.type === "onTagChange" && isStaticRef(trigger.tag)) {
        refs.tagNames.add(trigger.tag);
      }
      if (trigger.type === "onCondition") {
        collectExpressionTagRefs(trigger.condition, refs);
      }
    }
  }
}

function collectProjectRefs(project: ScadaProject, libraries?: ElementLibrary[]): ProjectRefs {
  const refs = makeRefs();
  for (const screen of project.screens) {
    for (const object of screen.objects) {
      collectKnownObjectRefs(object, refs);
    }
  }

  for (const macro of project.macros ?? []) {
    collectMacroRefsFromCode(macro.code, refs);
    for (const trigger of macro.triggers ?? []) {
      if ((trigger.type === "onScreenOpen" || trigger.type === "onScreenClose") && trigger.screenKey) {
        refs.screenIds.add(trigger.screenKey);
      }
      if (trigger.type === "onButtonClick") {
        if (trigger.screenKey) {
          refs.screenIds.add(trigger.screenKey);
        }
      }
      if (trigger.type === "onTagChange" && isStaticRef(trigger.tag)) {
        refs.tagNames.add(trigger.tag);
      }
      if (trigger.type === "onCondition") {
        collectExpressionTagRefs(trigger.condition, refs);
      }
    }
  }

  for (const event of project.events ?? []) {
    if (event.sourceTagName && isStaticRef(event.sourceTagName)) {
      refs.tagNames.add(event.sourceTagName);
    }
    if (event.ackTagName && isStaticRef(event.ackTagName)) {
      refs.tagNames.add(event.ackTagName);
    }
    if (event.notificationTagName && isStaticRef(event.notificationTagName)) {
      refs.tagNames.add(event.notificationTagName);
    }
    if (event.elapsedTimeTagName && isStaticRef(event.elapsedTimeTagName)) {
      refs.tagNames.add(event.elapsedTimeTagName);
    }
    if (event.securityTagName && isStaticRef(event.securityTagName)) {
      refs.tagNames.add(event.securityTagName);
    }

    for (const action of [...(event.onActiveActions ?? []), ...(event.onClearedActions ?? []), ...(event.onAckActions ?? [])]) {
      collectRuntimeActionRefs(action, refs);
    }
  }

  for (const alwaysActiveTag of project.runtimeSettings?.alwaysActiveTags ?? []) {
    if (alwaysActiveTag && isStaticRef(alwaysActiveTag)) {
      refs.tagNames.add(alwaysActiveTag);
    }
  }

  for (const soundId of (project.events ?? []).map((event) => event.soundId).filter((item): item is string => typeof item === "string" && item.length > 0)) {
    refs.tagNames.size; // keep no-op for explicit exhaustiveness in current flow
    if (soundId.length > 0) {
      // sound references resolved in analyzer directly
    }
  }

  for (const attached of project.libraries ?? []) {
    if (attached.enabled !== false) {
      refs.libraryIds.add(attached.libraryId);
    }
  }

  const librariesToScan = (libraries ?? []).filter((library) => refs.libraryIds.has(library.id));
  for (const library of librariesToScan) {
    collectLibraryElementRefs(library, refs);
  }

  return refs;
}

function countIdKeyReferencesInUnknown(value: unknown, idKey: "assetid" | "libraryid" | "macroid", targetId: string): number {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countIdKeyReferencesInUnknown(item, idKey, targetId), 0);
  }
  if (!value || typeof value !== "object") {
    return 0;
  }
  let count = 0;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string") {
      const lower = key.toLowerCase();
      const matchesKey = idKey === "libraryid"
        ? lower === "libraryid"
        : lower === idKey || lower.endsWith(idKey);
      if (matchesKey && child === targetId) {
        count += 1;
      }
    }
    count += countIdKeyReferencesInUnknown(child, idKey, targetId);
  }
  return count;
}

function countAssetReferencesInObject(object: HmiObject, assetId: string): number {
  let count = 0;
  if (object.type === "image") {
    if (object.assetId === assetId) {
      count += 1;
    }
    count += (object.stateImages ?? []).filter((item) => item.assetId === assetId).length;
  }
  if (object.type === "stateImage") {
    if (object.defaultAssetId === assetId) {
      count += 1;
    }
    if (object.badQualityAssetId === assetId) {
      count += 1;
    }
    count += object.states.filter((state) => state.assetId === assetId).length;
  }
  if (object.type === "numeric-image-indicator") {
    if (object.defaultAssetId === assetId) {
      count += 1;
    }
    if (object.badQualityAssetId === assetId) {
      count += 1;
    }
    count += object.states.filter((state) => state.assetId === assetId).length;
  }
  if (object.type === "button") {
    if (object.backgroundAssetId === assetId) {
      count += 1;
    }
    if (object.pressedBackgroundAssetId === assetId) {
      count += 1;
    }
    if (object.disabledBackgroundAssetId === assetId) {
      count += 1;
    }
  }
  if (object.type === "group") {
    for (const child of object.objects) {
      count += countAssetReferencesInObject(child, assetId);
    }
  }
  return count;
}

function countAssetReferences(project: ScadaProject, assetId: string): number {
  let count = 0;
  for (const screen of project.screens) {
    for (const object of screen.objects) {
      count += countAssetReferencesInObject(object, assetId);
    }
  }
  for (const sound of project.eventSounds ?? []) {
    if (sound.assetId === assetId) {
      count += 1;
    }
  }
  return count;
}

function countLibraryReferencesInObject(object: HmiObject, libraryId: string): number {
  let count = 0;
  if (object.type === "libraryElementInstance" && object.libraryId === libraryId) {
    count += 1;
  }
  if (object.type === "group") {
    for (const child of object.objects) {
      count += countLibraryReferencesInObject(child, libraryId);
    }
  }
  return count;
}

function countLibraryReferences(project: ScadaProject, libraryId: string): number {
  let count = 0;
  for (const screen of project.screens) {
    for (const object of screen.objects) {
      count += countLibraryReferencesInObject(object, libraryId);
    }
  }
  count += (project.libraries ?? []).filter((item) => item.libraryId === libraryId).length;
  return count;
}

function countMacroReferencesInUnknown(value: unknown, macroId: string): number {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countMacroReferencesInUnknown(item, macroId), 0);
  }
  if (!value || typeof value !== "object") {
    return 0;
  }
  let count = 0;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string") {
      const normalizedKey = key.toLowerCase();
      if ((normalizedKey === "macroid" || normalizedKey.endsWith("macroid")) && child === macroId) {
        count += 1;
      }
    }
    count += countMacroReferencesInUnknown(child, macroId);
  }
  return count;
}

function countMacroReferences(project: ScadaProject, macroId: string): number {
  let count = countMacroReferencesInUnknown(project.screens, macroId);
  count += countMacroReferencesInUnknown(project.events, macroId);
  for (const macro of project.macros ?? []) {
    for (const trigger of macro.triggers ?? []) {
      if (trigger.type === "onButtonClick" && trigger.objectId === macroId) {
        // not a macro reference, keep strict explicit macroId fields only
      }
    }
  }
  return count;
}

function collectMacroUsageIds(project: ScadaProject, refs: ProjectRefs): Set<string> {
  const used = new Set<string>(refs.macroIds);
  for (const macro of project.macros ?? []) {
    if ((macro.triggers ?? []).length > 0) {
      used.add(macro.id);
    }
  }
  return used;
}

function collectVariableUsageNames(project: ScadaProject, refs: ProjectRefs): Set<string> {
  const names = new Set<string>(refs.variableNames);
  for (const variable of project.variables ?? []) {
    if (typeof variable.lwAddress === "number" && refs.lwAddresses.has(variable.lwAddress)) {
      names.add(variable.name);
    }
  }
  return names;
}

function rewriteIdsInUnknown(value: unknown, maps: {
  assetIds: Map<string, string>;
  libraryIds: Map<string, string>;
  macroIds: Map<string, string>;
}): RewriteResult {
  if (Array.isArray(value)) {
    let replacements = 0;
    const next = value.map((item) => {
      const result = rewriteIdsInUnknown(item, maps);
      replacements += result.replacements;
      return result.value;
    });
    return { value: next, replacements };
  }

  if (!value || typeof value !== "object") {
    return { value, replacements: 0 };
  }

  let replacements = 0;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string") {
      const lower = key.toLowerCase();
      if ((lower === "assetid" || lower.endsWith("assetid")) && maps.assetIds.has(child)) {
        out[key] = maps.assetIds.get(child)!;
        replacements += 1;
        continue;
      }
      if (lower === "libraryid" && maps.libraryIds.has(child)) {
        out[key] = maps.libraryIds.get(child)!;
        replacements += 1;
        continue;
      }
      if ((lower === "macroid" || lower.endsWith("macroid")) && maps.macroIds.has(child)) {
        out[key] = maps.macroIds.get(child)!;
        replacements += 1;
        continue;
      }
    }

    const nested = rewriteIdsInUnknown(child, maps);
    out[key] = nested.value;
    replacements += nested.replacements;
  }

  return { value: out, replacements };
}

function isAllowedOrphanExtension(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return new Set([".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".bmp"]).has(ext);
}

function isOrphanFileExcluded(fileName: string): boolean {
  const normalized = fileName.toLowerCase();
  return normalized.includes("backup") || normalized.includes("temp") || normalized.includes("import") || normalized.includes("staging");
}

function sortByStableId(a: { id: string; createdAt?: string }, b: { id: string; createdAt?: string }): number {
  const aCreated = a.createdAt ?? "";
  const bCreated = b.createdAt ?? "";
  if (aCreated !== bCreated) {
    return aCreated.localeCompare(bCreated);
  }
  return a.id.localeCompare(b.id);
}

async function readLibraryLocalFiles(libraryService: LibraryService, libraryId: string): Promise<Map<string, Buffer>> {
  const root = path.dirname(libraryService.libraryFilePath(libraryId));
  const out = new Map<string, Buffer>();

  const scan = async (absolute: string, relative: string): Promise<void> => {
    const entries = await readdir(absolute, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absoluteEntry = path.join(absolute, entry.name);
      const relativeEntry = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await scan(absoluteEntry, relativeEntry);
        continue;
      }
      if (!entry.isFile() || relativeEntry === "library.json") {
        continue;
      }
      const bytes = await readFile(absoluteEntry).catch(() => undefined);
      if (bytes) {
        out.set(relativeEntry.replace(/\\/g, "/"), bytes);
      }
    }
  };

  await scan(root, "");
  return out;
}

function canonicalLibraryPayload(library: ElementLibrary, files: Map<string, Buffer>): Buffer {
  const canonical = {
    ...library,
    id: "__library__",
    name: "__library__",
    description: undefined,
    assets: library.assets.map((asset) => ({
      ...asset,
      previewUrl: "",
    })),
    elements: library.elements.map((element) => ({
      ...element,
      libraryId: element.libraryId ? "__library__" : element.libraryId,
    })),
  };

  const chunks: Uint8Array[] = [Buffer.from(stableJson(canonical), "utf8")];
  const filePaths = [...files.keys()].sort();
  for (const entryPath of filePaths) {
    chunks.push(Buffer.from(`\n${entryPath}\n`, "utf8"));
    chunks.push(files.get(entryPath)!);
  }

  return Buffer.concat(chunks);
}

export class ProjectCleanupService {
  private readonly analysesByToken = new Map<string, CleanupAnalysisRecord>();

  private readonly applyReplayByKey = new Map<string, CleanupApplyReplay>();

  public constructor(
    private readonly projectService: ProjectService,
    private readonly libraryService: LibraryService,
    private readonly projectArchiveService: ProjectArchiveService,
  ) {}

  public async analyzeProjectCleanup(projectInput?: ScadaProject, rawRequest?: Partial<ProjectCleanupAnalyzeRequest>): Promise<ProjectCleanupAnalyzeResponse> {
    const request = projectCleanupAnalyzeRequestSchema.parse(rawRequest ?? {});
    const project = projectInput ?? this.projectService.getProject();
    const requestedCategories = request.requestedCategories ?? DEFAULT_CLEANUP_CATEGORIES;
    const libraries = await this.libraryService.listLibraries();
    const references = collectProjectRefs(project, libraries);
    const hasDynamicSafetyRisk = references.dynamicWarnings.length > 0;
    const projectDir = path.dirname(this.projectService.getProjectFile());
    const assetsDir = path.join(projectDir, "assets");
    const nowMs = Date.now();

    const candidates: ProjectCleanupCandidate[] = [];

    const addCandidate = (candidate: ProjectCleanupCandidate): void => {
      const next = { ...candidate };
      if (hasDynamicSafetyRisk) {
        if (next.type === "duplicate-library") {
          next.scope = "protected";
          next.selectedByDefault = false;
          next.plannedAction = "skip-protected";
          next.warnings = [...next.warnings, "Dynamic references detected; duplicate library cleanup is protected."];
        } else if ((next.type === "duplicate-asset" || next.type === "duplicate-macro") && next.referencesCount > 0) {
          next.scope = "protected";
          next.selectedByDefault = false;
          next.plannedAction = "skip-protected";
          next.warnings = [...next.warnings, "Dynamic references detected; cleanup is protected."];
        } else if (next.type === "unused-project-asset-record") {
          next.scope = "protected";
          next.selectedByDefault = false;
          next.plannedAction = "skip-protected";
          next.warnings = [...next.warnings, "Dynamic references detected; cleanup is protected."];
        }
      }
      if (!requestedCategories.includes(categoryForCandidate(candidate.type))) {
        return;
      }
      candidates.push(next);
    };

    const assets = project.assets ?? [];

    for (const asset of assets) {
      const referencesCount = countAssetReferences(project, asset.id);
      if (referencesCount === 0) {
        addCandidate({
          id: `unused-asset:${asset.id}`,
          type: "unused-project-asset-record",
          scope: "safe",
          name: asset.name,
          path: asset.storagePath,
          reason: "Asset record is not referenced by project objects or event sounds.",
          severity: "low",
          selectedByDefault: true,
          referencesCount,
          plannedAction: "delete-record",
          warnings: [],
        });
      }
    }

    const byAssetSha = new Map<string, Asset[]>();
    for (const asset of assets) {
      const normalized = normalizeArchiveRelativePath(asset.storagePath);
      if (!normalized) {
        continue;
      }
      const absolute = path.join(projectDir, ...normalized.split("/"));
      const bytes = await readFile(absolute).catch(() => undefined);
      if (!bytes) {
        continue;
      }
      const hash = sha256(bytes);
      const list = byAssetSha.get(hash) ?? [];
      list.push(asset);
      byAssetSha.set(hash, list);
    }

    for (const [hash, list] of byAssetSha.entries()) {
      if (list.length < 2) {
        continue;
      }
      const sorted = [...list].sort(sortByStableId);
      const canonical = sorted[0]!;
      for (const duplicate of sorted.slice(1)) {
        const referencesCount = countAssetReferences(project, duplicate.id);
        const rewriteCount = countIdKeyReferencesInUnknown(project, "assetid", duplicate.id);
        const rewriteSafe = rewriteCount >= referencesCount;
        addCandidate({
          id: `duplicate-asset:${duplicate.id}`,
          type: "duplicate-asset",
          scope: rewriteSafe ? "safe" : "review",
          name: duplicate.name,
          path: duplicate.storagePath,
          reason: `Asset duplicates content of '${canonical.id}'.`,
          severity: referencesCount > 0 ? "medium" : "low",
          selectedByDefault: rewriteSafe,
          referencesCount,
          plannedAction: rewriteSafe ? "rewrite-then-delete" : "review-only",
          warnings: [
            ...(referencesCount > 0 ? ["References will be rewritten before deletion."] : []),
            ...(rewriteSafe ? [] : ["Rewrite plan is not fully proven safe for all references."]),
          ],
          duplicateGroupId: `asset-sha:${hash}`,
          canonicalId: canonical.id,
          rewriteTargetId: canonical.id,
        });
      }
    }

    const orphanCandidates = await this.findOrphanAssetFiles({
      assetsDir,
      project,
      ageThresholdMs: request.orphanFileMinAgeMs,
      nowMs,
    });
    orphanCandidates.forEach((candidate) => addCandidate(candidate));

    const libraryHashToList = new Map<string, ElementLibrary[]>();
    for (const library of libraries) {
      const files = await readLibraryLocalFiles(this.libraryService, library.id).catch(() => new Map<string, Buffer>());
      const hash = sha256(canonicalLibraryPayload(library, files));
      const list = libraryHashToList.get(hash) ?? [];
      list.push(library);
      libraryHashToList.set(hash, list);
    }

    for (const [hash, list] of libraryHashToList.entries()) {
      if (list.length < 2) {
        continue;
      }
      const sorted = [...list].sort(sortByStableId);
      const canonical = sorted[0]!;
      for (const duplicate of sorted.slice(1)) {
        const referencesCount = countLibraryReferences(project, duplicate.id);
        const rewriteCount = countIdKeyReferencesInUnknown(project, "libraryid", duplicate.id);
        const rewriteSafe = rewriteCount >= referencesCount;
        addCandidate({
          id: `duplicate-library:${duplicate.id}`,
          type: "duplicate-library",
          scope: rewriteSafe ? "safe" : "review",
          name: duplicate.name,
          reason: `Library duplicates content of '${canonical.id}'.`,
          severity: referencesCount > 0 ? "medium" : "low",
          selectedByDefault: rewriteSafe,
          referencesCount,
          plannedAction: rewriteSafe ? "rewrite-then-delete" : "review-only",
          warnings: [
            ...(referencesCount > 0 ? ["References will be rewritten before deletion."] : []),
            ...(rewriteSafe ? [] : ["Library references cannot be fully proven rewrite-safe."]),
          ],
          duplicateGroupId: `library-sha:${hash}`,
          canonicalId: canonical.id,
          rewriteTargetId: canonical.id,
        });
      }
    }

    for (const library of libraries) {
      const referencesCount = countLibraryReferences(project, library.id);
      if (referencesCount === 0) {
        addCandidate({
          id: `unused-library:${library.id}`,
          type: "unused-library",
          scope: "review",
          name: library.name,
          reason: "Library has no project references.",
          severity: "low",
          selectedByDefault: false,
          referencesCount,
          plannedAction: "review-only",
          warnings: [],
        });
      }
    }

    const macros = project.macros ?? [];
    const macroHashToList = new Map<string, MacroDefinition[]>();
    for (const macro of macros) {
      const hash = sha256(Buffer.from(stableJson({ language: macro.language, code: macro.code }), "utf8"));
      const list = macroHashToList.get(hash) ?? [];
      list.push(macro);
      macroHashToList.set(hash, list);
    }

    for (const [hash, list] of macroHashToList.entries()) {
      if (list.length < 2) {
        continue;
      }
      const sorted = [...list].sort(sortByStableId);
      const canonical = sorted[0]!;
      for (const duplicate of sorted.slice(1)) {
        const referencesCount = countMacroReferences(project, duplicate.id);
        const rewriteCount = countIdKeyReferencesInUnknown(project, "macroid", duplicate.id);
        const rewriteSafe = rewriteCount >= referencesCount;
        addCandidate({
          id: `duplicate-macro:${duplicate.id}`,
          type: "duplicate-macro",
          scope: rewriteSafe ? "safe" : "review",
          name: duplicate.name,
          reason: `Macro duplicates code of '${canonical.id}'.`,
          severity: referencesCount > 0 ? "medium" : "low",
          selectedByDefault: rewriteSafe,
          referencesCount,
          plannedAction: rewriteSafe ? "rewrite-then-delete" : "review-only",
          warnings: [
            ...(referencesCount > 0 ? ["Explicit macroId references will be rewritten before deletion."] : []),
            ...(rewriteSafe ? [] : ["Macro rewrite plan is not fully proven safe."]),
          ],
          duplicateGroupId: `macro-sha:${hash}`,
          canonicalId: canonical.id,
          rewriteTargetId: canonical.id,
        });
      }
    }

    const usedMacroIds = collectMacroUsageIds(project, references);
    for (const macro of macros) {
      if (!usedMacroIds.has(macro.id)) {
        addCandidate({
          id: `unused-macro:${macro.id}`,
          type: "unused-macro",
          scope: "review",
          name: macro.name,
          reason: "Macro is not referenced and has no runtime triggers.",
          severity: "low",
          selectedByDefault: false,
          referencesCount: 0,
          plannedAction: "review-only",
          warnings: [],
        });
      }
    }

    const variableUsage = collectVariableUsageNames(project, references);
    for (const variable of project.variables ?? []) {
      if (!variableUsage.has(variable.name)) {
        addCandidate({
          id: `unused-variable:${variable.name}`,
          type: "unused-variable",
          scope: "review",
          name: variable.name,
          reason: "Internal variable is not referenced by screens, macros, actions, or bindings.",
          severity: "low",
          selectedByDefault: false,
          referencesCount: 0,
          plannedAction: "review-only",
          warnings: [],
        });
      }
    }

    const lwValues = project.lwStore?.values ?? {};
    for (const addressText of Object.keys(lwValues)) {
      const address = Number(addressText);
      if (!Number.isFinite(address)) {
        continue;
      }
      const usedByVariable = (project.variables ?? []).some((variable) => variable.lwAddress === address && variableUsage.has(variable.name));
      if (!references.lwAddresses.has(address) && !usedByVariable) {
        addCandidate({
          id: `unused-lw:${address}`,
          type: "unused-lw-entry",
          scope: "review",
          name: `LW${address}`,
          reason: "LW entry is not referenced by variables, macros, or actions.",
          severity: "low",
          selectedByDefault: false,
          referencesCount: 0,
          plannedAction: "review-only",
          warnings: [],
        });
      }
    }

    const tagNames = new Set((project.tags ?? []).map((tag) => tag.name));
    for (const tag of project.tags ?? []) {
      if (!references.tagNames.has(tag.name)) {
        const generatedLike = tag.sourceType === "simulated" || typeof tag.driverId === "string";
        addCandidate({
          id: `unused-tag:${tag.name}`,
          type: "unused-tag",
          scope: "review",
          name: tag.name,
          reason: "Tag is not referenced by current project resources.",
          severity: "medium",
          selectedByDefault: false,
          referencesCount: 0,
          plannedAction: "review-only",
          warnings: generatedLike ? ["Driver/simulation tag is protected from default cleanup selection."] : [],
        });
      }
    }

    for (const event of project.events ?? []) {
      const hasSource = typeof event.sourceTagName === "string" && event.sourceTagName.length > 0;
      const missingSource = hasSource && !tagNames.has(event.sourceTagName!);
      if (!hasSource || missingSource) {
        addCandidate({
          id: `unused-event:${event.id}`,
          type: "unused-event",
          scope: "review",
          name: event.id,
          reason: !hasSource ? "Event has no source tag." : "Event source tag does not exist.",
          severity: missingSource ? "medium" : "low",
          selectedByDefault: false,
          referencesCount: 0,
          plannedAction: "review-only",
          warnings: [],
        });
      }
    }

    const usedEventSoundIds = new Set((project.events ?? []).map((event) => event.soundId).filter((id): id is string => typeof id === "string" && id.length > 0));
    for (const sound of project.eventSounds ?? []) {
      if (!usedEventSoundIds.has(sound.id)) {
        addCandidate({
          id: `unused-event-sound:${sound.id}`,
          type: "unused-event-sound",
          scope: "review",
          name: sound.name,
          reason: "Event sound is not referenced by any event definition.",
          severity: "low",
          selectedByDefault: false,
          referencesCount: 0,
          plannedAction: "review-only",
          warnings: [],
        });
      }
    }

    for (const driver of project.drivers) {
      addCandidate({
        id: `protected-driver:${driver.id}`,
        type: "protected-driver",
        scope: "protected",
        name: driver.name ?? driver.id,
        reason: "Driver config is protected and never selected by default.",
        severity: "high",
        selectedByDefault: false,
        referencesCount: 0,
        plannedAction: "skip-protected",
        warnings: [],
      });
    }

    for (const category of project.eventCategories ?? []) {
      addCandidate({
        id: `protected-event-category:${category.id}`,
        type: "protected-event-category",
        scope: "protected",
        name: category.name,
        reason: "Event category resources are protected and require manual review.",
        severity: "medium",
        selectedByDefault: false,
        referencesCount: 0,
        plannedAction: "skip-protected",
        warnings: [],
      });
    }

    const fingerprint = await this.computeProjectFingerprint(project, libraries);
    const token = randomUUID();
    const createdAt = new Date().toISOString();
    const record: CleanupAnalysisRecord = {
      token,
      fingerprint,
      createdAt,
      requestedCategories,
      candidates,
    };
    this.analysesByToken.set(token, record);

    const byType: Record<string, number> = {};
    for (const candidate of candidates) {
      byType[candidate.type] = (byType[candidate.type] ?? 0) + 1;
    }

    return {
      analysisToken: token,
      analysisFingerprint: fingerprint,
      analyzedAt: createdAt,
      requestedCategories,
      summary: {
        totalCandidates: candidates.length,
        safeCandidates: candidates.filter((item) => item.scope === "safe").length,
        reviewCandidates: candidates.filter((item) => item.scope === "review").length,
        protectedCandidates: candidates.filter((item) => item.scope === "protected").length,
        selectedByDefaultCount: candidates.filter((item) => item.selectedByDefault).length,
        byType: byType as Record<(typeof projectCleanupCandidateTypeSchema)["_type"], number>,
      },
      candidates,
      warnings: references.dynamicWarnings,
    };
  }

  public async applyProjectCleanup(rawRequest: ProjectCleanupApplyRequest): Promise<ProjectCleanupApplyResponse> {
    const request = projectCleanupApplyRequestSchema.parse(rawRequest);
    const replayKey = this.makeReplayKey(request);
    const replay = this.applyReplayByKey.get(replayKey);
    if (replay) {
      return replay.response;
    }

    const analysis = this.analysesByToken.get(request.analysisToken);
    if (!analysis) {
      throw new Error("Cleanup analysis token was not found. Re-run analysis before apply.");
    }

    const project = this.projectService.getProject();
    const libraries = await this.libraryService.listLibraries();
    const currentFingerprint = await this.computeProjectFingerprint(project, libraries);

    if (request.analysisFingerprint !== analysis.fingerprint || request.analysisFingerprint !== currentFingerprint) {
      throw new Error("Cleanup analysis is stale. Re-run analysis before apply.");
    }

    const selected = new Set(request.selectedCandidateIds);
    const selectedCandidates = analysis.candidates.filter((candidate) => selected.has(candidate.id));
    const accumulator: ApplyAccumulator = {
      rewrittenReferences: 0,
      deletedAssets: new Set(),
      deletedLibraries: new Set(),
      deletedMacros: new Set(),
      deletedVariables: new Set(),
      deletedLwEntries: new Set(),
      deletedTags: new Set(),
      deletedEvents: new Set(),
      deletedEventSounds: new Set(),
      deletedFiles: new Set(),
      skipped: [],
      warnings: [],
    };

    let workingProject: ScadaProject = structuredClone(project);

    for (const candidate of selectedCandidates) {
      if (candidate.scope === "protected") {
        accumulator.skipped.push({ candidateId: candidate.id, reason: "Protected category." });
        continue;
      }
      if (candidate.scope === "review" && !request.options.deleteUnusedReviewItems) {
        accumulator.skipped.push({ candidateId: candidate.id, reason: "Review-only candidate is disabled by options." });
      }
      if (candidate.type === "orphan-physical-file" && !request.options.deleteOrphanFiles) {
        accumulator.skipped.push({ candidateId: candidate.id, reason: "Orphan physical file deletion is disabled." });
      }
      if ((candidate.type === "duplicate-asset" || candidate.type === "duplicate-library" || candidate.type === "duplicate-macro")
        && !request.options.rewriteDuplicateReferences
      ) {
        accumulator.skipped.push({ candidateId: candidate.id, reason: "Duplicate reference rewrite is disabled." });
      }
    }

    const actionable = selectedCandidates.filter((candidate) => !accumulator.skipped.some((item) => item.candidateId === candidate.id));

    const assetMap = new Map<string, string>();
    const libraryMap = new Map<string, string>();
    const macroMap = new Map<string, string>();

    for (const candidate of actionable) {
      if ((candidate.type === "duplicate-asset" || candidate.type === "duplicate-library" || candidate.type === "duplicate-macro") && candidate.rewriteTargetId) {
        const sourceId = candidate.id.split(":")[1] ?? "";
        if (!sourceId) {
          continue;
        }
        if (candidate.type === "duplicate-asset") {
          assetMap.set(sourceId, candidate.rewriteTargetId);
        }
        if (candidate.type === "duplicate-library") {
          libraryMap.set(sourceId, candidate.rewriteTargetId);
        }
        if (candidate.type === "duplicate-macro") {
          macroMap.set(sourceId, candidate.rewriteTargetId);
        }
      }
    }

    if (assetMap.size > 0 || libraryMap.size > 0 || macroMap.size > 0) {
      const rewriteResult = rewriteIdsInUnknown(workingProject, {
        assetIds: assetMap,
        libraryIds: libraryMap,
        macroIds: macroMap,
      });
      workingProject = rewriteResult.value as ScadaProject;
      accumulator.rewrittenReferences += rewriteResult.replacements;
    }

    const deleteAssetIds = new Set<string>();
    const deleteLibraryIds = new Set<string>();
    const deleteMacroIds = new Set<string>();
    const deleteVariableNames = new Set<string>();
    const deleteTagNames = new Set<string>();
    const deleteEventIds = new Set<string>();
    const deleteSoundIds = new Set<string>();
    const deleteLwAddresses = new Set<number>();
    const deleteFilePaths = new Set<string>();

    for (const candidate of actionable) {
      const payload = candidate.id.split(":")[1] ?? "";
      if (candidate.type === "unused-project-asset-record" || candidate.type === "duplicate-asset") {
        if (payload) {
          deleteAssetIds.add(payload);
        }
      }
      if (candidate.type === "unused-library" || candidate.type === "duplicate-library") {
        if (payload) {
          deleteLibraryIds.add(payload);
        }
      }
      if (candidate.type === "unused-macro" || candidate.type === "duplicate-macro") {
        if (payload) {
          deleteMacroIds.add(payload);
        }
      }
      if (candidate.type === "unused-variable" && payload) {
        deleteVariableNames.add(payload);
      }
      if (candidate.type === "unused-tag" && payload) {
        deleteTagNames.add(payload);
      }
      if (candidate.type === "unused-event" && payload) {
        deleteEventIds.add(payload);
      }
      if (candidate.type === "unused-event-sound" && payload) {
        deleteSoundIds.add(payload);
      }
      if (candidate.type === "unused-lw-entry" && payload) {
        const address = Number(payload);
        if (Number.isFinite(address)) {
          deleteLwAddresses.add(address);
        }
      }
      if (candidate.type === "orphan-physical-file" && candidate.path) {
        deleteFilePaths.add(candidate.path);
      }
    }

    const previousAssets = workingProject.assets ?? [];
    for (const asset of previousAssets) {
      if (!deleteAssetIds.has(asset.id)) {
        continue;
      }
      const normalized = normalizeArchiveRelativePath(asset.storagePath);
      if (normalized) {
        deleteFilePaths.add(normalized);
      }
      accumulator.deletedAssets.add(asset.id);
    }
    workingProject.assets = previousAssets.filter((asset) => !deleteAssetIds.has(asset.id));

    workingProject.libraries = (workingProject.libraries ?? []).filter((libraryRef) => {
      if (deleteLibraryIds.has(libraryRef.libraryId)) {
        return false;
      }
      return true;
    });
    for (const libraryId of deleteLibraryIds) {
      accumulator.deletedLibraries.add(libraryId);
    }

    workingProject.macros = (workingProject.macros ?? []).filter((macro) => {
      if (deleteMacroIds.has(macro.id)) {
        accumulator.deletedMacros.add(macro.id);
        return false;
      }
      return true;
    });

    workingProject.variables = (workingProject.variables ?? []).filter((variable) => {
      if (deleteVariableNames.has(variable.name)) {
        accumulator.deletedVariables.add(variable.name);
        return false;
      }
      return true;
    });

    workingProject.tags = (workingProject.tags ?? []).filter((tag) => {
      if (deleteTagNames.has(tag.name)) {
        accumulator.deletedTags.add(tag.name);
        return false;
      }
      return true;
    });

    workingProject.events = (workingProject.events ?? []).filter((event) => {
      if (deleteEventIds.has(event.id)) {
        accumulator.deletedEvents.add(event.id);
        return false;
      }
      return true;
    });

    workingProject.eventSounds = (workingProject.eventSounds ?? []).filter((sound) => {
      if (deleteSoundIds.has(sound.id)) {
        accumulator.deletedEventSounds.add(sound.id);
        return false;
      }
      return true;
    });

    const lwValues: Record<number, number> = {};
    const existingLwValues = workingProject.lwStore?.values ?? {};
    for (const [addressText, value] of Object.entries(existingLwValues)) {
      const address = Number(addressText);
      if (Number.isFinite(address) && deleteLwAddresses.has(address)) {
        accumulator.deletedLwEntries.add(address);
        continue;
      }
      if (Number.isFinite(address)) {
        lwValues[address] = value;
      }
    }
    if (workingProject.lwStore) {
      const nextLw: LwStoreConfig = {
        ...workingProject.lwStore,
        values: lwValues,
      };
      workingProject.lwStore = nextLw;
    }

    let backupPath: string | undefined;
    if (request.options.createBackup) {
      backupPath = await this.projectArchiveService.createProjectBackup();
    }

    await this.projectService.saveProject(workingProject);

    const projectDir = path.dirname(this.projectService.getProjectFile());
    for (const relative of deleteFilePaths) {
      const normalized = normalizeArchiveRelativePath(relative);
      if (!normalized) {
        continue;
      }
      const absolute = path.join(projectDir, ...normalized.split("/"));
      await rm(absolute, { force: true, recursive: false }).catch(() => undefined);
      accumulator.deletedFiles.add(normalized);
    }

    for (const libraryId of deleteLibraryIds) {
      const libraryRoot = path.dirname(this.libraryService.libraryFilePath(libraryId));
      await rm(libraryRoot, { recursive: true, force: true }).catch(() => undefined);
    }

    const response: ProjectCleanupApplyResponse = {
      ok: true,
      analysisToken: analysis.token,
      analysisFingerprint: analysis.fingerprint,
      appliedAt: new Date().toISOString(),
      backupPath,
      rewrittenReferences: accumulator.rewrittenReferences,
      deletedAssets: [...accumulator.deletedAssets],
      deletedLibraries: [...accumulator.deletedLibraries],
      deletedMacros: [...accumulator.deletedMacros],
      deletedVariables: [...accumulator.deletedVariables],
      deletedLwEntries: [...accumulator.deletedLwEntries],
      deletedTags: [...accumulator.deletedTags],
      deletedEvents: [...accumulator.deletedEvents],
      deletedEventSounds: [...accumulator.deletedEventSounds],
      deletedFiles: [...accumulator.deletedFiles],
      skipped: accumulator.skipped,
      warnings: accumulator.warnings,
    };

    this.applyReplayByKey.set(replayKey, { key: replayKey, response });
    return response;
  }

  private async findOrphanAssetFiles(input: {
    assetsDir: string;
    project: ScadaProject;
    ageThresholdMs: number;
    nowMs: number;
  }): Promise<ProjectCleanupCandidate[]> {
    const candidates: ProjectCleanupCandidate[] = [];
    const knownFiles = new Set(
      (input.project.assets ?? [])
        .map((asset) => normalizeArchiveRelativePath(asset.storagePath))
        .filter((item): item is string => typeof item === "string"),
    );

    const scan = async (absoluteDir: string, relativeDir: string): Promise<void> => {
      const entries = await readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const entryRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        const entryAbsolute = path.join(absoluteDir, entry.name);
        if (entry.isDirectory()) {
          await scan(entryAbsolute, entryRelative);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        if (!isAllowedOrphanExtension(entry.name) || isOrphanFileExcluded(entryRelative)) {
          continue;
        }
        const relative = normalizeArchiveRelativePath(path.posix.join("assets", entryRelative));
        if (!relative || knownFiles.has(relative)) {
          continue;
        }
        const info = await stat(entryAbsolute).catch(() => undefined);
        if (!info) {
          continue;
        }
        const ageMs = Math.max(0, input.nowMs - info.mtimeMs);
        if (ageMs < input.ageThresholdMs) {
          continue;
        }
        candidates.push({
          id: `orphan-file:${relative}`,
          type: "orphan-physical-file",
          scope: "safe",
          path: relative,
          reason: "Physical file is not referenced by any project asset record.",
          severity: "low",
          selectedByDefault: true,
          referencesCount: 0,
          plannedAction: "delete-file",
          warnings: [],
        });
      }
    };

    await scan(input.assetsDir, "");

    return candidates;
  }

  private async computeProjectFingerprint(project: ScadaProject, libraries?: ElementLibrary[]): Promise<string> {
    const projectDir = path.dirname(this.projectService.getProjectFile());
    const assetsDir = path.join(projectDir, "assets");
    const assetFingerprints: Array<{ file: string; size: number; mtimeMs: number }> = [];
    const entries = await readdir(assetsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const absolute = path.join(assetsDir, entry.name);
      const info = await stat(absolute).catch(() => undefined);
      if (!info) {
        continue;
      }
      assetFingerprints.push({ file: entry.name, size: info.size, mtimeMs: Math.round(info.mtimeMs) });
    }
    assetFingerprints.sort((a, b) => a.file.localeCompare(b.file));

    const loadedLibraries = libraries ?? await this.libraryService.listLibraries();
    const libraryHashes: Array<{ id: string; hash: string }> = [];
    for (const library of loadedLibraries) {
      const files = await readLibraryLocalFiles(this.libraryService, library.id).catch(() => new Map<string, Buffer>());
      libraryHashes.push({ id: library.id, hash: sha256(canonicalLibraryPayload(library, files)) });
    }
    libraryHashes.sort((a, b) => a.id.localeCompare(b.id));

    return sha256(Buffer.from(stableJson({ project, assetFingerprints, libraryHashes }), "utf8"));
  }

  private makeReplayKey(request: ProjectCleanupApplyRequest): string {
    const selected = [...request.selectedCandidateIds].sort();
    return `${request.analysisToken}:${request.analysisFingerprint}:${sha256(Buffer.from(stableJson({ selected, options: request.options }), "utf8"))}`;
  }
}

function categoryForCandidate(type: ProjectCleanupCandidate["type"]): ProjectCleanupCategory {
  switch (type) {
    case "orphan-physical-file":
      return "files";
    case "unused-project-asset-record":
    case "duplicate-asset":
      return "assets";
    case "duplicate-library":
    case "unused-library":
      return "libraries";
    case "duplicate-macro":
    case "unused-macro":
      return "macros";
    case "unused-variable":
      return "variables";
    case "unused-lw-entry":
      return "lw";
    case "unused-tag":
      return "tags";
    case "unused-event":
    case "protected-event-category":
      return "events";
    case "unused-event-sound":
      return "event-sounds";
    case "protected-driver":
      return "drivers";
    default:
      return "assets";
  }
}
