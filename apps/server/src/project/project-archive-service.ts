import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import type {
  ArchiveFileKind,
  ArchiveManifestFile,
  Asset,
  ElementLibrary,
  EventSound,
  HmiObject,
  HmiScreen,
  MacroDefinition,
  ProjectArchiveImportOptions,
  ProjectArchiveImportResult,
  ProjectArchiveIssue,
  ProjectArchiveManifest,
  ProjectArchiveValidationResult,
  ScadaProject,
  ScreenArchiveData,
  ScreenArchiveImportOptions,
  ScreenArchiveImportResult,
  ScreenArchiveManifest,
  ScreenArchiveValidationResult,
  TagDefinition,
} from "@web-scada/shared";
import {
  projectArchiveImportOptionsSchema,
  projectArchiveManifestSchema,
  projectSchema,
  screenArchiveDataSchema,
  screenArchiveImportOptionsSchema,
  screenArchiveManifestSchema,
} from "@web-scada/shared";
import { EventSoundService } from "../events/event-sound-service.js";
import { LibraryService } from "../libraries/library-service.js";
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

function collectObjectTagNames(object: HmiObject, out: Set<string>): void {
  const visit = (value: unknown, keyHint = ""): void => {
    if (typeof value === "string") {
      const key = keyHint.toLowerCase();
      if ((key.includes("tag") || key === "source") && value.trim() && !value.includes("${")) {
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
    if (tagName && !tagName.startsWith(".")) {
      refs.add(tagName);
    }
    match = pattern.exec(macroCode);
  }
  return [...refs];
}

function collectDependencies(project: ScadaProject, screen: HmiScreen): {
  assets: Asset[];
  libraries: string[];
  tags: TagDefinition[];
  macros: MacroDefinition[];
} {
  const assetIds = new Set<string>();
  const libraryIds = new Set<string>();
  const tagNames = new Set<string>();
  const macroIds = new Set<string>();

  for (const object of screen.objects) {
    collectObjectAssetIds(object, assetIds);
    collectObjectLibraryIds(object, libraryIds);
    collectObjectTagNames(object, tagNames);
    collectObjectMacroIds(object, macroIds);
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
      macroIds.add(macro.id);
    }
  }

  const macros = (project.macros ?? []).filter((macro) => macroIds.has(macro.id));
  for (const macro of macros) {
    macroTagReferences(macro.code).forEach((tagName) => tagNames.add(tagName));
  }

  return {
    assets: (project.assets ?? []).filter((asset) => assetIds.has(asset.id)),
    libraries: [...libraryIds],
    tags: project.tags.filter((tag) => tagNames.has(tag.name)),
    macros,
  };
}

function replaceIdsInUnknown(value: unknown, maps: { assetIds: Map<string, string>; libraryIds: Map<string, string> }): unknown {
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
    }
    next[key] = replaceIdsInUnknown(child, maps);
  }
  return next;
}

function canonicalLibraryPayload(library: ElementLibrary, files: Map<string, Buffer>, prefix: string): Buffer {
  const chunks: Uint8Array[] = [Buffer.from(JSON.stringify(library, null, 2), "utf8")];
  const paths = [...files.keys()].filter((item) => item.startsWith(prefix) && item !== `${prefix}library.json`).sort();
  for (const item of paths) {
    chunks.push(Buffer.from(`\n${item}\n`, "utf8"));
    chunks.push(files.get(item)!);
  }
  return Buffer.concat(chunks);
}

export class ProjectArchiveService {
  public constructor(
    private readonly projectService: ProjectService,
    private readonly libraryService: LibraryService,
    private readonly eventSoundService: EventSoundService,
  ) {}

  public async exportProjectArchive(): Promise<ExportArchiveResult> {
    const project = projectSchema.parse(this.projectService.getProject());
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

    addJson("project.json", project, "project");

    for (const asset of project.assets ?? []) {
      const normalized = normalizeArchivePath(asset.storagePath);
      if (!normalized.ok) {
        continue;
      }
      const absolute = path.join(projectDir, ...normalized.value.split("/"));
      const buffer = await readFile(absolute).catch(() => undefined);
      if (buffer) {
        addFile(normalized.value, buffer, "asset");
      }
    }

    for (const sound of project.eventSounds ?? []) {
      const storedFileName = parseStoredFileName(sound.filePath);
      if (!storedFileName) {
        continue;
      }
      const absolute = path.join(this.eventSoundService.getStorageDir(), storedFileName);
      const buffer = await readFile(absolute).catch(() => undefined);
      if (buffer) {
        addFile(`data/event-sounds/${storedFileName}`, buffer, "eventSound");
      }
    }

    const attachedIds = new Set((project.libraries ?? []).filter((ref) => ref.enabled !== false).map((ref) => ref.libraryId));
    const libraries = await this.libraryService.listLibraries();
    for (const library of libraries.filter((item) => attachedIds.has(item.id))) {
      const libraryDir = path.dirname(this.libraryService.libraryFilePath(library.id));
      addJson(`libraries/${library.id}/library.json`, library, "library");
      for (const asset of library.assets ?? []) {
        const normalized = normalizeArchivePath(asset.storagePath);
        if (!normalized.ok) {
          continue;
        }
        const absolute = path.join(libraryDir, ...normalized.value.split("/"));
        const buffer = await readFile(absolute).catch(() => undefined);
        if (buffer) {
          addFile(`libraries/${library.id}/${normalized.value}`, buffer, "libraryAsset");
        }
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
    addJson("manifest.json", manifest, "metadata");

    return {
      buffer: zip.toBuffer() as Buffer,
      fileName: `${slugifyFileName(project.name)}.webscada-project.zip`,
    };
  }

  public async exportScreenArchive(screenId: string): Promise<ExportArchiveResult> {
    const project = projectSchema.parse(this.projectService.getProject());
    const screen = project.screens.find((item) => item.id === screenId);
    if (!screen) {
      throw new Error("Screen not found");
    }

    const dependencies = collectDependencies(project, screen);
    const libraries = await this.libraryService.listLibraries();
    const librarySet = new Set(dependencies.libraries);
    const includedLibraries = libraries.filter((library) => librarySet.has(library.id));
    const data: ScreenArchiveData = {
      screen,
      assets: dependencies.assets,
      libraries: includedLibraries,
      tags: dependencies.tags,
      macros: dependencies.macros,
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

    addJson("screen.json", data, "screen");
    for (const asset of data.assets) {
      const normalized = normalizeArchivePath(asset.storagePath);
      if (!normalized.ok) {
        continue;
      }
      const absolute = path.join(projectDir, ...normalized.value.split("/"));
      const buffer = await readFile(absolute).catch(() => undefined);
      if (buffer) {
        addFile(normalized.value, buffer, "asset");
      }
    }
    for (const library of data.libraries) {
      const libraryDir = path.dirname(this.libraryService.libraryFilePath(library.id));
      addJson(`libraries/${library.id}/library.json`, library, "library");
      for (const asset of library.assets ?? []) {
        const normalized = normalizeArchivePath(asset.storagePath);
        if (!normalized.ok) {
          continue;
        }
        const absolute = path.join(libraryDir, ...normalized.value.split("/"));
        const buffer = await readFile(absolute).catch(() => undefined);
        if (buffer) {
          addFile(`libraries/${library.id}/${normalized.value}`, buffer, "libraryAsset");
        }
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
      },
      files,
    };
    addJson("manifest.json", manifest, "metadata");

    return {
      buffer: zip.toBuffer() as Buffer,
      fileName: `${slugifyFileName(screen.name)}.webscada-screen.zip`,
    };
  }

  public async validateProjectArchive(uploadedFile: UploadInput): Promise<ProjectArchiveValidationResult> {
    return this.inspectProjectArchive(uploadedFile.content);
  }

  public async validateScreenArchive(uploadedFile: UploadInput): Promise<ScreenArchiveValidationResult> {
    return this.inspectScreenArchive(uploadedFile.content);
  }

  public async importProjectArchive(uploadedFile: UploadInput, options?: ProjectArchiveImportOptions): Promise<ProjectArchiveImportResult> {
    const parsedOptions = projectArchiveImportOptionsSchema.parse(options ?? {});
    if (parsedOptions.mode !== "replace-current") {
      throw new Error("Project import mode 'import-as-copy' is not implemented yet");
    }

    const inspected = await this.inspectProjectArchive(uploadedFile.content, true);
    if (!inspected.valid || !inspected.parsed || inspected.parsed.kind !== "project") {
      throw new Error(inspected.errors[0]?.message ?? "Project archive is invalid");
    }

    const backupPath = await this.createProjectBackup();
    const projectDir = path.dirname(this.projectService.getProjectFile());
    const project = this.normalizeImportedProject(inspected.parsed.project);

    await this.restoreProjectFiles(inspected.parsed, projectDir);
    const saved = await this.projectService.saveProject(project);
    return { ok: true, mode: parsedOptions.mode, backupPath, project: saved };
  }

  public async importScreenArchive(uploadedFile: UploadInput, options?: ScreenArchiveImportOptions): Promise<ScreenArchiveImportResult> {
    const parsedOptions = screenArchiveImportOptionsSchema.parse(options ?? {});
    const inspected = await this.inspectScreenArchive(uploadedFile.content, true);
    if (!inspected.valid || !inspected.parsed || inspected.parsed.kind !== "screen") {
      throw new Error(inspected.errors[0]?.message ?? "Screen archive is invalid");
    }

    const project = this.projectService.getProject();
    const projectDir = path.dirname(this.projectService.getProjectFile());
    const warnings: ProjectArchiveIssue[] = [...inspected.warnings];
    const assetIdMap = new Map<string, string>();
    const libraryIdMap = new Map<string, string>();
    let reusedAssets = 0;
    let copiedAssets = 0;
    let importedTags = 0;
    let skippedTags = 0;
    let reusedLibraries = 0;
    let copiedLibraries = 0;

    const nextAssets = [...(project.assets ?? [])];
    const existingAssetsById = new Map(nextAssets.map((asset) => [asset.id, asset]));
    const takenAssetIds = new Set(nextAssets.map((asset) => asset.id));

    for (const sourceAsset of inspected.parsed.data.assets) {
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
          assetIdMap.set(sourceAsset.id, existing.id);
          reusedAssets += 1;
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
      }
      takenAssetIds.add(targetAsset.id);
      assetIdMap.set(sourceAsset.id, targetAsset.id);
      nextAssets.push(withProjectAssetPreview(targetAsset));
      await this.writeArchiveFile(projectDir, targetAsset.storagePath, fileBytes);
      copiedAssets += 1;
    }

    const nextTags = [...project.tags];
    const existingTagNames = new Set(nextTags.map((tag) => tag.name));
    for (const tag of inspected.parsed.data.tags) {
      if (existingTagNames.has(tag.name)) {
        skippedTags += 1;
        continue;
      }
      nextTags.push(tag);
      existingTagNames.add(tag.name);
      importedTags += 1;
    }

    const existingLibraries = await this.libraryService.listLibraries();
    const existingLibrariesById = new Map(existingLibraries.map((library) => [library.id, library]));
    const takenLibraryIds = new Set(existingLibraries.map((library) => library.id));
    const nextProjectLibraryRefs = [...(project.libraries ?? [])];

    for (const sourceLibrary of inspected.parsed.data.libraries) {
      const prefix = `libraries/${sourceLibrary.id}/`;
      const sourceHash = sha256(canonicalLibraryPayload(sourceLibrary, inspected.parsed.files, prefix));
      const existing = existingLibrariesById.get(sourceLibrary.id);
      let targetId = sourceLibrary.id;
      if (existing) {
        const localFiles = await this.readLocalLibraryFiles(existing.id);
        const existingHash = sha256(canonicalLibraryPayload(existing, localFiles, ""));
        if (existingHash === sourceHash) {
          libraryIdMap.set(sourceLibrary.id, existing.id);
          reusedLibraries += 1;
          continue;
        }
        targetId = makeUniqueId(sourceLibrary.id, takenLibraryIds, "library");
        copiedLibraries += 1;
        addIssue(warnings, "LIBRARY_IMPORTED_AS_COPY", `Library '${sourceLibrary.id}' already exists with different content; imported as '${targetId}'.`);
      }
      takenLibraryIds.add(targetId);
      libraryIdMap.set(sourceLibrary.id, targetId);
      const library = normalizeImportedLibrary(sourceLibrary, targetId);
      await this.restoreLibrary(inspected.parsed, sourceLibrary.id, library);
      if (!nextProjectLibraryRefs.some((ref) => ref.libraryId === targetId)) {
        nextProjectLibraryRefs.push({
          libraryId: targetId,
          name: library.name,
          version: library.version,
          path: path.dirname(this.libraryService.libraryFilePath(targetId)),
          enabled: true,
        });
      }
      if (!existing) {
        copiedLibraries += 1;
      }
    }

    let importedScreen = replaceIdsInUnknown(inspected.parsed.data.screen, { assetIds: assetIdMap, libraryIds: libraryIdMap }) as HmiScreen;
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
      assets: nextAssets,
      tags: nextTags,
      libraries: nextProjectLibraryRefs,
      macros: this.mergeMacros(project.macros ?? [], inspected.parsed.data.macros, warnings),
      screens: nextScreens,
      startScreenId: project.startScreenId ?? nextScreens[0]?.id,
    });

    return {
      ok: true,
      mode: parsedOptions.mode,
      screenId: importedScreen.id,
      importedScreenName: importedScreen.name,
      reusedAssets,
      copiedAssets,
      importedTags,
      skippedTags,
      reusedLibraries,
      copiedLibraries,
      warnings,
      project: nextProject,
    };
  }

  private async inspectProjectArchive(content: Buffer, withParsed?: false): Promise<ProjectArchiveValidationResult>;
  private async inspectProjectArchive(content: Buffer, withParsed: true): Promise<ProjectArchiveValidationResult & { parsed?: AnyParsedArchive }>;
  private async inspectProjectArchive(content: Buffer, withParsed = false): Promise<ProjectArchiveValidationResult & { parsed?: AnyParsedArchive }> {
    const inspected = await this.inspectArchive(content, "project");
    return withParsed ? inspected : this.stripParsed(inspected);
  }

  private async inspectScreenArchive(content: Buffer, withParsed?: false): Promise<ScreenArchiveValidationResult>;
  private async inspectScreenArchive(content: Buffer, withParsed: true): Promise<ScreenArchiveValidationResult & { parsed?: AnyParsedArchive }>;
  private async inspectScreenArchive(content: Buffer, withParsed = false): Promise<ScreenArchiveValidationResult & { parsed?: AnyParsedArchive }> {
    const inspected = await this.inspectArchive(content, "screen");
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

  private async inspectArchive(content: Buffer, expected: "project" | "screen"): Promise<ProjectArchiveValidationResult & { parsed?: AnyParsedArchive }> {
    const errors: ProjectArchiveIssue[] = [];
    const warnings: ProjectArchiveIssue[] = [];
    const base: ProjectArchiveValidationResult & { parsed?: AnyParsedArchive } = {
      valid: false,
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
    for (const archivePath of files.keys()) {
      if (archivePath === "manifest.json") {
        continue;
      }
      if (!manifestPathSet.has(archivePath)) {
        addIssue(warnings, "UNDECLARED_ARCHIVE_FILE", "Archive file is not listed in manifest", archivePath);
      }
    }

    if (expected === "project") {
      return this.inspectProjectPayload(files, sizes, manifest.data as ProjectArchiveManifest, base);
    }
    return this.inspectScreenPayload(files, sizes, manifest.data as ScreenArchiveManifest, base);
  }

  private inspectProjectPayload(
    files: Map<string, Buffer>,
    sizes: Map<string, number>,
    manifest: ProjectArchiveManifest,
    result: ProjectArchiveValidationResult & { parsed?: AnyParsedArchive },
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
      this.validateSoundFile(sound, files, sizes, result.warnings);
    }
    for (const ref of project.libraries ?? []) {
      if (ref.enabled === false) {
        continue;
      }
      if (!files.has(`libraries/${ref.libraryId}/library.json`)) {
        addIssue(result.errors, "MISSING_LIBRARY_FILE", "Attached library file is missing", `libraries/${ref.libraryId}/library.json`);
      }
    }

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
      result.parsed = { kind: "project", manifest, project, files, sizes };
    }
    return result;
  }

  private inspectScreenPayload(
    files: Map<string, Buffer>,
    sizes: Map<string, number>,
    manifest: ScreenArchiveManifest,
    result: ProjectArchiveValidationResult & { parsed?: AnyParsedArchive },
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

    result.valid = result.errors.length === 0;
    result.summary = {
      format: SCREEN_FORMAT,
      name: data.screen.name,
      screens: 1,
      tags: data.tags.length,
      assets: data.assets.length,
      libraries: data.libraries.length,
      events: 0,
      macros: data.macros.length,
      variables: 0,
    };
    if (result.valid) {
      result.parsed = { kind: "screen", manifest, data, files, sizes };
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
    const existed = await readFile(this.libraryService.libraryFilePath(library.id)).then(() => true).catch(() => false);
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
        await rename(backupDir, targetDir).catch(() => undefined);
      }
      throw error;
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
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

  private async createProjectBackup(): Promise<string> {
    const backupDir = path.join(path.dirname(this.projectService.getProjectFile()), "backups");
    await mkdir(backupDir, { recursive: true });
    const exported = await this.exportProjectArchive();
    const backupPath = path.join(backupDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${exported.fileName}`);
    await writeFile(backupPath, exported.buffer);
    return backupPath;
  }

  private mergeMacros(existing: MacroDefinition[], incoming: MacroDefinition[], warnings: ProjectArchiveIssue[]): MacroDefinition[] {
    const next = [...existing];
    const existingIds = new Set(next.map((macro) => macro.id));
    for (const macro of incoming) {
      if (existingIds.has(macro.id)) {
        addIssue(warnings, "MACRO_SKIPPED", `Macro '${macro.id}' already exists and was skipped.`);
        continue;
      }
      next.push(macro);
      existingIds.add(macro.id);
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
