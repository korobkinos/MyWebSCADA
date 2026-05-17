
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import type {
  Asset,
  AssetType,
  ElementLibrary,
  HmiObject,
  LibraryArchiveManifest,
  LibraryElement,
  LibraryImportIssue,
  LibraryImportOptions,
  LibraryImportValidationResult,
  MacroDefinition,
  ProjectLibraryRef,
  ScadaProject,
} from "@web-scada/shared";
import {
  elementLibrarySchema,
  libraryArchiveManifestSchema,
  libraryElementSchema,
  macroSchema,
} from "@web-scada/shared";
import { ProjectService } from "../project/project-service.js";

type CreateLibraryPayload = {
  id: string;
  name: string;
  description?: string;
  version?: string;
};

type UpdateLibraryPayload = {
  name?: string;
  description?: string;
  version?: string;
};

type DeleteLibraryOptions = {
  force?: boolean;
};

type DeleteLibraryMacroOptions = {
  force?: boolean;
};

type UploadInput = {
  fileName: string;
  mimeType: string;
  size: number;
  content: Buffer;
  name?: string;
};

type ExportLibraryArchiveResult = {
  buffer: Buffer;
  fileName: string;
};

type ParsedArchive = {
  manifest: LibraryArchiveManifest;
  library: ElementLibrary;
  files: Map<string, Buffer>;
  fileSizes: Map<string, number>;
};

type ImportLibraryMacroOptions = {
  overwrite?: boolean;
  importAsCopy?: boolean;
};

const MIME_TO_TYPE: Record<string, AssetType> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/svg+xml": "svg",
};

const ALLOWED_ASSET_MIME = new Set(["image/png", "image/jpeg", "image/svg+xml"]);
const ARCHIVE_FORMAT = "mywebscada-library";
const ARCHIVE_FORMAT_VERSION = 1;
const MAX_ARCHIVE_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 1000;
const MAX_ELEMENTS = 1000;
const MAX_MACROS = 500;

function nowIso(): string {
  return new Date().toISOString();
}

function safeId(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
}

function fileExtension(type: AssetType): string {
  if (type === "jpeg") {
    return "jpg";
  }
  return type;
}

function slugifyFileName(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "library";
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
  const segments = replaced.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { ok: false, reason: "Path is empty" };
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return { ok: false, reason: "Path traversal is not allowed" };
  }
  return { ok: true, value: segments.join("/") };
}

function addIssue(out: LibraryImportIssue[], code: string, message: string, filePath?: string): void {
  out.push(filePath ? { code, message, path: filePath } : { code, message });
}

function collectObjectAssetIds(object: HmiObject, out: Set<string>): void {
  if (object.type === "image") {
    if (object.assetId) {
      out.add(object.assetId);
    }
    for (const state of object.stateImages ?? []) {
      if (state.assetId) {
        out.add(state.assetId);
      }
    }
  }
  if (object.type === "stateImage") {
    if (object.defaultAssetId) {
      out.add(object.defaultAssetId);
    }
    if (object.badQualityAssetId) {
      out.add(object.badQualityAssetId);
    }
    for (const state of object.states) {
      if (state.assetId) {
        out.add(state.assetId);
      }
    }
  }
  if (object.type === "numeric-image-indicator") {
    if (object.defaultAssetId) {
      out.add(object.defaultAssetId);
    }
    if (object.badQualityAssetId) {
      out.add(object.badQualityAssetId);
    }
    for (const state of object.states) {
      if (state.assetId) {
        out.add(state.assetId);
      }
    }
  }
  if (object.type === "button") {
    if (object.backgroundAssetId) {
      out.add(object.backgroundAssetId);
    }
    if (object.pressedBackgroundAssetId) {
      out.add(object.pressedBackgroundAssetId);
    }
    if (object.disabledBackgroundAssetId) {
      out.add(object.disabledBackgroundAssetId);
    }
  }
  if (object.type === "group") {
    for (const child of object.objects) {
      collectObjectAssetIds(child, out);
    }
  }
}

function collectObjectMacroIds(object: HmiObject, out: Set<string>): void {
  if ((object.type === "button" || object.type === "image" || object.type === "stateImage" || object.type === "libraryElementInstance")
    && object.action?.type === "runMacro"
    && object.action.macroId
  ) {
    out.add(object.action.macroId);
  }
  if (object.type === "group") {
    for (const child of object.objects) {
      collectObjectMacroIds(child, out);
    }
  }
}

function collectElementAssetIds(element: LibraryElement): Set<string> {
  const out = new Set<string>();
  if (element.previewAssetId) {
    out.add(element.previewAssetId);
  }
  for (const object of element.objects) {
    collectObjectAssetIds(object, out);
  }
  for (const rule of element.stateRules ?? []) {
    for (const item of rule.cases) {
      for (const action of item.actions) {
        if (action.type === "setAsset") {
          out.add(action.assetId);
        }
      }
    }
  }
  return out;
}

function collectElementMacroIds(element: LibraryElement): Set<string> {
  const out = new Set<string>();
  for (const object of element.objects) {
    collectObjectMacroIds(object, out);
  }
  return out;
}

function findLibraryScreenUsage(project: ScadaProject, libraryId: string): number {
  let used = 0;
  const scan = (objects: HmiObject[]): void => {
    for (const object of objects) {
      if (object.type === "libraryElementInstance" && object.libraryId === libraryId) {
        used += 1;
      }
      if (object.type === "group") {
        scan(object.objects);
      }
    }
  };
  for (const screen of project.screens) {
    scan(screen.objects);
  }
  return used;
}

function normalizeLibraryForStorage(library: ElementLibrary): ElementLibrary {
  return {
    ...library,
    macros: library.macros ?? [],
  };
}

function makeUniqueLibraryId(sourceId: string, taken: Set<string>): string {
  const base = safeId(sourceId) || "library";
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

function makeUniqueMacroId(sourceId: string, taken: Set<string>): string {
  const base = safeId(sourceId) || "macro";
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

function validateMacroWithProjectTags(macro: MacroDefinition, project: ScadaProject): MacroDefinition {
  const existingTags = new Set(project.tags.map((tag) => tag.name));
  const missing = macroTagReferences(macro.code).filter((tagName) => !existingTags.has(tagName));
  if (missing.length === 0) {
    return {
      ...macro,
      validation: {
        status: "ok",
        errors: [],
        updatedAt: nowIso(),
      },
    };
  }
  return {
    ...macro,
    validation: {
      status: "error",
      errors: [...new Set(missing.map((tagName) => `References missing tag: ${tagName}`))],
      updatedAt: nowIso(),
    },
  };
}

export class LibraryService {
  public constructor(
    private readonly librariesRoot: string,
    private readonly projectService: ProjectService,
  ) {}

  public async listLibraries(): Promise<ElementLibrary[]> {
    await mkdir(this.librariesRoot, { recursive: true });
    const entries = await readdir(this.librariesRoot, { withFileTypes: true });
    const libraries: ElementLibrary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const library = await this.tryLoadLibrary(entry.name);
      if (library) {
        libraries.push(library);
      }
    }

    return libraries.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }

  public async getLibrary(libraryId: string): Promise<ElementLibrary | undefined> {
    return this.tryLoadLibrary(libraryId);
  }

  public async createLibrary(payload: CreateLibraryPayload): Promise<ElementLibrary> {
    const id = safeId(payload.id);
    if (!id) {
      throw new Error("Library id is required");
    }

    if (await this.existsLibrary(id)) {
      throw new Error(`Library \"${id}\" already exists`);
    }

    const dir = this.libraryDir(id);
    await mkdir(path.join(dir, "assets"), { recursive: true });
    await mkdir(path.join(dir, "previews"), { recursive: true });

    const timestamp = nowIso();
    const library: ElementLibrary = {
      id,
      name: payload.name.trim() || id,
      description: payload.description?.trim() || undefined,
      version: payload.version?.trim() || "1.0.0",
      createdAt: timestamp,
      updatedAt: timestamp,
      assets: [],
      elements: [],
      macros: [],
    };

    await this.saveLibrary(library);
    return library;
  }

  public async updateLibrary(libraryId: string, patch: UpdateLibraryPayload): Promise<ElementLibrary> {
    const library = await this.requireLibrary(libraryId);
    const updated: ElementLibrary = {
      ...library,
      name: patch.name?.trim() ? patch.name.trim() : library.name,
      description: patch.description !== undefined ? (patch.description.trim() || undefined) : library.description,
      version: patch.version?.trim() ? patch.version.trim() : library.version,
      updatedAt: nowIso(),
    };
    await this.saveLibrary(updated);
    return updated;
  }

  public async deleteLibrary(libraryId: string, options?: DeleteLibraryOptions): Promise<{ deleted: boolean; detached: boolean }> {
    const normalizedId = safeId(libraryId);
    if (!normalizedId) {
      throw new Error("Library id is required");
    }
    const library = await this.getLibrary(libraryId);
    const libraryDir = this.libraryDir(libraryId);
    const dirExists = await this.existsPath(libraryDir);
    if (!library && !dirExists) {
      throw new Error(`Library \"${libraryId}\" not found`);
    }
    const project = this.projectService.getProject();
    const sameLibrary = (value: string): boolean => value === libraryId || safeId(value) === normalizedId;
    const attached = (project.libraries ?? []).some((ref) => ref.enabled && sameLibrary(ref.libraryId));
    const usageCount = (() => {
      let used = 0;
      const scan = (objects: HmiObject[]): void => {
        for (const object of objects) {
          if (object.type === "libraryElementInstance" && sameLibrary(object.libraryId)) {
            used += 1;
          }
          if (object.type === "group") {
            scan(object.objects);
          }
        }
      };
      for (const screen of project.screens) {
        scan(screen.objects);
      }
      return used;
    })();

    if (usageCount > 0) {
      throw new Error(`Library \"${normalizedId}\" is used on screens (${usageCount} instance(s))`);
    }

    if (attached && !options?.force) {
      throw new Error(`Library \"${normalizedId}\" is attached to project`);
    }

    let detached = false;
    if (attached && options?.force) {
      const refs = project.libraries ?? [];
      const next: ScadaProject = {
        ...project,
        libraries: refs.filter((ref) => !sameLibrary(ref.libraryId)),
      };
      await this.projectService.saveProject(next);
      detached = true;
    }

    await rm(libraryDir, { recursive: true, force: true });
    return { deleted: true, detached };
  }

  public async uploadLibraryAsset(libraryId: string, input: UploadInput): Promise<Asset> {
    const library = await this.requireLibrary(libraryId);
    const type = MIME_TO_TYPE[input.mimeType];
    if (!type) {
      throw new Error("Unsupported asset type. Only PNG, JPEG, SVG are allowed.");
    }

    const id = randomUUID();
    const ext = fileExtension(type);
    const fileName = `${id}.${ext}`;
    const dir = this.libraryDir(library.id);
    const assetsDir = path.join(dir, "assets");
    await mkdir(assetsDir, { recursive: true });
    await writeFile(path.join(assetsDir, fileName), input.content);

    const timestamp = nowIso();
    const asset: Asset = {
      id,
      name: (input.name?.trim() || path.parse(input.fileName).name || id).slice(0, 120),
      type: ext === "jpg" ? "jpg" : type,
      mimeType: input.mimeType,
      fileName,
      size: input.size,
      createdAt: timestamp,
      updatedAt: timestamp,
      storagePath: path.posix.join("assets", fileName),
      previewUrl: `/api/libraries/${encodeURIComponent(library.id)}/assets/${id}/file`,
    };

    const next = {
      ...library,
      assets: [...library.assets, asset],
      updatedAt: timestamp,
    };
    await this.saveLibrary(next);
    return asset;
  }

  public async createElement(libraryId: string, element: LibraryElement): Promise<LibraryElement> {
    const library = await this.requireLibrary(libraryId);
    const now = nowIso();
    const normalized = libraryElementSchema.parse({
      ...element,
      id: element.id?.trim() || safeId(element.name) || `element-${randomUUID().slice(0, 8)}`,
      libraryId: library.id,
      elementKey: element.elementKey?.trim() || safeId(element.name) || `element_${randomUUID().slice(0, 6)}`,
      createdAt: element.createdAt || now,
      updatedAt: now,
    });

    if (library.elements.some((item) => item.id === normalized.id)) {
      throw new Error(`Element with id \"${normalized.id}\" already exists`);
    }

    const next = {
      ...library,
      elements: [...library.elements, normalized],
      updatedAt: now,
    };
    await this.saveLibrary(next);
    return normalized;
  }

  public async updateElement(libraryId: string, elementId: string, patch: Partial<LibraryElement>): Promise<LibraryElement> {
    const library = await this.requireLibrary(libraryId);
    const existing = library.elements.find((item) => item.id === elementId);
    if (!existing) {
      throw new Error("Element not found");
    }

    const merged = libraryElementSchema.parse({
      ...existing,
      ...patch,
      id: existing.id,
      libraryId: existing.libraryId ?? library.id,
      elementKey: patch.elementKey?.trim() || existing.elementKey || safeId(existing.name),
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
    });

    const next = {
      ...library,
      elements: library.elements.map((item) => (item.id === elementId ? merged : item)),
      updatedAt: nowIso(),
    };
    await this.saveLibrary(next);
    return merged;
  }

  public async deleteElement(libraryId: string, elementId: string): Promise<void> {
    const library = await this.requireLibrary(libraryId);
    const exists = library.elements.some((item) => item.id === elementId);
    if (!exists) {
      throw new Error("Element not found");
    }
    const next = {
      ...library,
      elements: library.elements.filter((item) => item.id !== elementId),
      updatedAt: nowIso(),
    };
    await this.saveLibrary(next);
  }

  public async createLibraryMacro(libraryId: string, macro: MacroDefinition): Promise<MacroDefinition> {
    const library = await this.requireLibrary(libraryId);
    const parsed = macroSchema.parse(macro);
    const macros = library.macros ?? [];
    if (macros.some((item) => item.id === parsed.id)) {
      throw new Error(`Macro with id \"${parsed.id}\" already exists in library`);
    }

    const next = {
      ...library,
      macros: [...macros, parsed],
      updatedAt: nowIso(),
    };
    await this.saveLibrary(next);
    return parsed;
  }

  public async updateLibraryMacro(
    libraryId: string,
    macroId: string,
    patch: Partial<MacroDefinition>,
  ): Promise<MacroDefinition> {
    const library = await this.requireLibrary(libraryId);
    const macros = library.macros ?? [];
    const existing = macros.find((item) => item.id === macroId);
    if (!existing) {
      throw new Error("Macro not found");
    }
    const merged = macroSchema.parse({
      ...existing,
      ...patch,
      id: existing.id,
    });
    const next = {
      ...library,
      macros: macros.map((item) => (item.id === macroId ? merged : item)),
      updatedAt: nowIso(),
    };
    await this.saveLibrary(next);
    return merged;
  }

  public async deleteLibraryMacro(libraryId: string, macroId: string, options?: DeleteLibraryMacroOptions): Promise<void> {
    const library = await this.requireLibrary(libraryId);
    const macros = library.macros ?? [];
    if (!macros.some((item) => item.id === macroId)) {
      throw new Error("Macro not found");
    }

    const referenced = (library.elements ?? []).some((element) => collectElementMacroIds(element).has(macroId));
    if (referenced && !options?.force) {
      throw new Error("Macro is referenced by library elements");
    }

    const next = {
      ...library,
      macros: macros.filter((item) => item.id !== macroId),
      updatedAt: nowIso(),
    };
    await this.saveLibrary(next);
  }

  public async importLibraryMacroToProject(
    libraryId: string,
    macroId: string,
    options?: ImportLibraryMacroOptions,
  ): Promise<MacroDefinition> {
    const library = await this.requireLibrary(libraryId);
    const macro = (library.macros ?? []).find((item) => item.id === macroId);
    if (!macro) {
      throw new Error("Macro not found in library");
    }

    const project = this.projectService.getProject();
    const source = project.macros ?? [];
    const existing = source.find((item) => item.id === macro.id);

    let imported: MacroDefinition = structuredClone(macro);

    if (existing) {
      if (options?.importAsCopy) {
        const taken = new Set(source.map((item) => item.id));
        imported = {
          ...imported,
          id: makeUniqueMacroId(imported.id, taken),
          name: `${imported.name} (copy)`,
        };
      } else if (!options?.overwrite) {
        throw new Error(`Macro \"${macro.id}\" already exists in project`);
      }
    }

    imported = validateMacroWithProjectTags(imported, project);

    const nextMacros = (() => {
      if (existing && options?.overwrite && !options?.importAsCopy) {
        return source.map((item) => (item.id === imported.id ? imported : item));
      }
      return [...source, imported];
    })();

    const next: ScadaProject = {
      ...project,
      macros: nextMacros,
    };

    await this.projectService.saveProject(next);
    return imported;
  }

  public async importLibraryMacrosToProject(
    libraryId: string,
    options?: { overwrite?: boolean; importAsCopy?: boolean },
  ): Promise<{ imported: number; updated: number; skipped: number }> {
    const library = await this.requireLibrary(libraryId);
    const macros = library.macros ?? [];
    if (macros.length === 0) {
      return { imported: 0, updated: 0, skipped: 0 };
    }

    let importedCount = 0;
    let updatedCount = 0;
    let skipped = 0;

    const project = this.projectService.getProject();
    const source = project.macros ?? [];
    const byId = new Map(source.map((item) => [item.id, item]));
    const nextMacros = [...source];

    for (const sourceMacro of macros) {
      let macro = structuredClone(sourceMacro);
      const existing = byId.get(macro.id);
      if (existing) {
        if (options?.importAsCopy) {
          const taken = new Set(nextMacros.map((item) => item.id));
          macro = {
            ...macro,
            id: makeUniqueMacroId(macro.id, taken),
            name: `${macro.name} (copy)`,
          };
          macro = validateMacroWithProjectTags(macro, project);
          nextMacros.push(macro);
          importedCount += 1;
          continue;
        }
        if (!options?.overwrite) {
          skipped += 1;
          continue;
        }
        macro = validateMacroWithProjectTags(macro, project);
        const index = nextMacros.findIndex((item) => item.id === macro.id);
        if (index >= 0) {
          nextMacros[index] = macro;
          updatedCount += 1;
        }
        continue;
      }
      macro = validateMacroWithProjectTags(macro, project);
      nextMacros.push(macro);
      importedCount += 1;
    }

    const next: ScadaProject = {
      ...project,
      macros: nextMacros,
    };

    await this.projectService.saveProject(next);
    return { imported: importedCount, updated: updatedCount, skipped };
  }

  public async validateLibraryArchive(uploadedFile: UploadInput): Promise<LibraryImportValidationResult> {
    const inspected = await this.inspectArchive(uploadedFile.content);
    return inspected.result;
  }

  public async importLibraryArchive(uploadedFile: UploadInput, options?: LibraryImportOptions): Promise<ElementLibrary> {
    const inspected = await this.inspectArchive(uploadedFile.content);
    const { result, parsed } = inspected;
    if (!parsed || !result.valid) {
      const first = result.errors[0]?.message || "Library archive is invalid";
      throw new Error(first);
    }

    const importOptions = {
      replace: Boolean(options?.replace),
      importAsCopy: Boolean(options?.importAsCopy),
      importMacrosToProject: Boolean(options?.importMacrosToProject),
      macroConflictMode: options?.macroConflictMode ?? "skip",
    } as const;

    const existingLibrary = await this.getLibrary(parsed.library.id);
    if (existingLibrary && !importOptions.replace && !importOptions.importAsCopy) {
      throw new Error(`Library id \"${parsed.library.id}\" already exists`);
    }

    const allLibraries = await this.listLibraries();
    const takenLibraryIds = new Set(allLibraries.map((item) => item.id));
    const targetLibraryId = importOptions.importAsCopy
      ? makeUniqueLibraryId(parsed.library.id, takenLibraryIds)
      : parsed.library.id;

    const importedLibrary = this.prepareImportedLibrary(parsed.library, targetLibraryId);

    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "mywebscada-library-import-"));
    const stageDir = path.join(tmpRoot, "library");
    const backupDir = path.join(tmpRoot, "backup");
    const targetDir = this.libraryDir(targetLibraryId);

    try {
      await mkdir(stageDir, { recursive: true });
      await mkdir(path.join(stageDir, "assets"), { recursive: true });
      await mkdir(path.join(stageDir, "previews"), { recursive: true });

      for (const [entryPath, buffer] of parsed.files.entries()) {
        if (!this.isSupportedArchiveFile(entryPath)) {
          continue;
        }
        if (entryPath === "library.json" || entryPath === "manifest.json") {
          continue;
        }
        const targetPath = path.join(stageDir, ...entryPath.split("/"));
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, buffer);
      }

      await writeFile(path.join(stageDir, "library.json"), JSON.stringify(importedLibrary, null, 2), "utf8");

      const hasTarget = await this.existsPath(targetDir);
      if (hasTarget) {
        if (!importOptions.replace && !importOptions.importAsCopy) {
          throw new Error(`Library \"${targetLibraryId}\" already exists`);
        }
        await rename(targetDir, backupDir);
      }

      await mkdir(path.dirname(targetDir), { recursive: true });
      await rename(stageDir, targetDir);

      if (await this.existsPath(backupDir)) {
        await rm(backupDir, { recursive: true, force: true });
      }

      if (importOptions.importMacrosToProject && (importedLibrary.macros ?? []).length > 0) {
        const mode = importOptions.macroConflictMode;
        await this.importLibraryMacrosToProject(importedLibrary.id, {
          overwrite: mode === "overwrite",
          importAsCopy: mode === "copy",
        });
      }

      const loaded = await this.requireLibrary(importedLibrary.id);
      return loaded;
    } catch (error) {
      const hasTarget = await this.existsPath(targetDir);
      const hasBackup = await this.existsPath(backupDir);
      if (!hasTarget && hasBackup) {
        await rename(backupDir, targetDir).catch(() => undefined);
      }
      throw error;
    } finally {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  public async exportLibraryArchive(libraryId: string): Promise<ExportLibraryArchiveResult> {
    const library = await this.requireLibrary(libraryId);
    const normalized = normalizeLibraryForStorage(library);
    const zip = new AdmZip();
    const rootDir = this.libraryDir(library.id);

    const manifestFiles: LibraryArchiveManifest["files"] = [];

    const addTextFile = (entryPath: string, text: string, type: LibraryArchiveManifest["files"][number]["type"]): void => {
      const buffer = Buffer.from(text, "utf8");
      zip.addFile(entryPath, buffer);
      manifestFiles.push({
        path: entryPath,
        type,
        size: buffer.byteLength,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      });
    };

    const addBinaryFile = async (entryPath: string, sourceAbsolutePath: string, type: LibraryArchiveManifest["files"][number]["type"]): Promise<void> => {
      const buffer = await readFile(sourceAbsolutePath);
      zip.addFile(entryPath, buffer);
      manifestFiles.push({
        path: entryPath,
        type,
        size: buffer.byteLength,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      });
    };

    addTextFile("library.json", JSON.stringify(normalized, null, 2), "library");

    for (const asset of normalized.assets) {
      const normalizedPathResult = normalizeArchivePath(asset.storagePath);
      if (!normalizedPathResult.ok) {
        continue;
      }
      const storagePath = normalizedPathResult.value;
      const abs = path.join(rootDir, ...storagePath.split("/"));
      if (!(await this.existsPath(abs))) {
        continue;
      }
      const type = storagePath.startsWith("previews/") ? "preview" : "asset";
      await addBinaryFile(storagePath, abs, type);
    }

    if (await this.existsPath(path.join(rootDir, "previews"))) {
      const previewEntries = await readdir(path.join(rootDir, "previews"), { withFileTypes: true });
      for (const entry of previewEntries) {
        if (!entry.isFile()) {
          continue;
        }
        const entryPath = `previews/${entry.name}`;
        if (manifestFiles.some((item) => item.path === entryPath)) {
          continue;
        }
        await addBinaryFile(entryPath, path.join(rootDir, "previews", entry.name), "preview");
      }
    }

    const manifest: LibraryArchiveManifest = {
      format: ARCHIVE_FORMAT,
      formatVersion: ARCHIVE_FORMAT_VERSION,
      exportedAt: nowIso(),
      appName: "MyWebSCADA",
      libraryId: normalized.id,
      libraryName: normalized.name,
      libraryVersion: normalized.version,
      counts: {
        elements: normalized.elements.length,
        assets: normalized.assets.length,
        macros: (normalized.macros ?? []).length,
      },
      files: manifestFiles,
    };

    addTextFile("manifest.json", JSON.stringify(manifest, null, 2), "metadata");

    const safeFileName = `${slugifyFileName(normalized.id)}.webscada-library.zip`;
    return {
      buffer: zip.toBuffer() as Buffer,
      fileName: safeFileName,
    };
  }

  public async getLibraryAsset(libraryId: string, assetId: string): Promise<Asset | undefined> {
    const library = await this.getLibrary(libraryId);
    return library?.assets.find((item) => item.id === assetId);
  }

  public async attachLibraryToProject(libraryId: string): Promise<ScadaProject> {
    const library = await this.requireLibrary(libraryId);
    const project = this.projectService.getProject();
    const refs = project.libraries ?? [];
    const existing = refs.find((item) => item.libraryId === library.id);
    const nextRef: ProjectLibraryRef = {
      libraryId: library.id,
      name: library.name,
      version: library.version,
      path: this.libraryDir(library.id),
      enabled: true,
    };

    const nextLibraries = existing
      ? refs.map((item) => (item.libraryId === library.id ? { ...item, ...nextRef, enabled: true } : item))
      : [...refs, nextRef];

    const next: ScadaProject = {
      ...project,
      libraries: nextLibraries,
    };
    return this.projectService.saveProject(next);
  }

  public async detachLibraryFromProject(libraryId: string): Promise<ScadaProject> {
    const project = this.projectService.getProject();
    const refs = project.libraries ?? [];
    const nextLibraries = refs.map((item) => (item.libraryId === libraryId ? { ...item, enabled: false } : item));
    const next: ScadaProject = {
      ...project,
      libraries: nextLibraries,
    };
    return this.projectService.saveProject(next);
  }

  public libraryFilePath(libraryId: string): string {
    return path.join(this.libraryDir(libraryId), "library.json");
  }

  public async deleteLibraryAssetFile(libraryId: string, assetId: string): Promise<void> {
    const library = await this.requireLibrary(libraryId);
    const asset = library.assets.find((item) => item.id === assetId);
    if (!asset) {
      return;
    }
    const absolute = path.join(this.libraryDir(library.id), ...asset.storagePath.split("/"));
    await rm(absolute, { force: true });
  }

  private async inspectArchive(content: Buffer): Promise<{ result: LibraryImportValidationResult; parsed?: ParsedArchive }> {
    const errors: LibraryImportIssue[] = [];
    const warnings: LibraryImportIssue[] = [];

    const resultBase: LibraryImportValidationResult = {
      valid: false,
      conflicts: {
        libraryExists: false,
        elementConflicts: [],
        assetConflicts: [],
        projectMacroConflicts: [],
      },
      warnings,
      errors,
    };

    if (content.byteLength === 0) {
      addIssue(errors, "EMPTY_ARCHIVE", "Archive is empty");
      return { result: resultBase };
    }

    if (content.byteLength > MAX_ARCHIVE_SIZE_BYTES) {
      addIssue(errors, "ARCHIVE_TOO_LARGE", `Archive exceeds ${Math.floor(MAX_ARCHIVE_SIZE_BYTES / 1024 / 1024)} MB limit`);
    }

    if (!(content[0] === 0x50 && content[1] === 0x4b)) {
      addIssue(errors, "NOT_ZIP", "This is not a ZIP archive");
      return { result: resultBase };
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(content);
    } catch {
      addIssue(errors, "CORRUPTED_ZIP", "ZIP archive is corrupted or unreadable");
      return { result: resultBase };
    }

    const entries = zip.getEntries();
    if (entries.length > MAX_FILES) {
      addIssue(errors, "TOO_MANY_FILES", `Archive has too many files (max ${MAX_FILES})`);
    }

    const files = new Map<string, Buffer>();
    const fileSizes = new Map<string, number>();

    for (const entry of entries) {
      const rawName = entry.entryName;
      const normalized = normalizeArchivePath(rawName);
      if (!normalized.ok) {
        addIssue(errors, "UNSAFE_PATH", normalized.reason, rawName || undefined);
        continue;
      }

      const normalizedPath = normalized.value;
      if (entry.isDirectory) {
        continue;
      }

      if (entry.header.encripted) {
        addIssue(errors, "UNSUPPORTED_ENCRYPTED_ZIP", "Encrypted archives are not supported", normalizedPath);
        continue;
      }

      if (files.has(normalizedPath)) {
        addIssue(errors, "DUPLICATE_PATH", "Duplicate file path in archive", normalizedPath);
        continue;
      }

      const declaredSize = Number(entry.header.size || 0);
      if (normalizedPath.startsWith("assets/") && declaredSize > MAX_FILE_SIZE_BYTES) {
        addIssue(errors, "ASSET_TOO_LARGE", `Asset exceeds ${Math.floor(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB limit`, normalizedPath);
      }

      const buffer = zip.readFile(entry);
      if (!buffer) {
        addIssue(errors, "ENTRY_READ_FAILED", "Unable to read archive entry", normalizedPath);
        continue;
      }

      files.set(normalizedPath, buffer);
      fileSizes.set(normalizedPath, buffer.byteLength);
    }

    const manifestBytes = files.get("manifest.json");
    if (!manifestBytes) {
      addIssue(errors, "MISSING_MANIFEST", "manifest.json was not found in archive", "manifest.json");
    }

    const libraryBytes = files.get("library.json");
    if (!libraryBytes) {
      addIssue(errors, "MISSING_LIBRARY_JSON", "library.json was not found in archive", "library.json");
    }

    if (errors.length > 0 && (!manifestBytes || !libraryBytes)) {
      return { result: resultBase };
    }

    let manifest: LibraryArchiveManifest | undefined;
    if (manifestBytes) {
      try {
        manifest = libraryArchiveManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
      } catch {
        addIssue(errors, "INVALID_MANIFEST_JSON", "manifest.json is invalid", "manifest.json");
      }
    }

    let library: ElementLibrary | undefined;
    if (libraryBytes) {
      try {
        const parsed = elementLibrarySchema.parse(JSON.parse(libraryBytes.toString("utf8")));
        library = normalizeLibraryForStorage(parsed);
      } catch {
        addIssue(errors, "INVALID_LIBRARY_JSON", "library.json is invalid", "library.json");
      }
    }

    if (!manifest || !library) {
      return { result: resultBase };
    }

    if (manifest.format !== ARCHIVE_FORMAT) {
      addIssue(errors, "WRONG_FORMAT", "This is not a MyWebSCADA library archive", "manifest.json");
    }
    if (manifest.formatVersion !== ARCHIVE_FORMAT_VERSION) {
      addIssue(errors, "UNSUPPORTED_FORMAT_VERSION", `Unsupported formatVersion: ${manifest.formatVersion}`, "manifest.json");
    }

    if (library.elements.length > MAX_ELEMENTS) {
      addIssue(errors, "TOO_MANY_ELEMENTS", `Library has too many elements (max ${MAX_ELEMENTS})`, "library.json");
    }
    if ((library.macros ?? []).length > MAX_MACROS) {
      addIssue(errors, "TOO_MANY_MACROS", `Library has too many macros (max ${MAX_MACROS})`, "library.json");
    }

    if (manifest.libraryId !== library.id) {
      addIssue(errors, "MANIFEST_LIBRARY_ID_MISMATCH", "manifest libraryId does not match library.json id", "manifest.json");
    }
    if (manifest.libraryVersion !== library.version) {
      addIssue(warnings, "MANIFEST_LIBRARY_VERSION_MISMATCH", "manifest libraryVersion differs from library.json", "manifest.json");
    }

    if (manifest.counts.elements !== library.elements.length) {
      addIssue(errors, "COUNT_MISMATCH_ELEMENTS", "manifest element count does not match library.json", "manifest.json");
    }
    if (manifest.counts.assets !== library.assets.length) {
      addIssue(errors, "COUNT_MISMATCH_ASSETS", "manifest asset count does not match library.json", "manifest.json");
    }
    if (manifest.counts.macros !== (library.macros ?? []).length) {
      addIssue(errors, "COUNT_MISMATCH_MACROS", "manifest macro count does not match library.json", "manifest.json");
    }

    const manifestPathSet = new Set<string>();
    for (const item of manifest.files) {
      const normalized = normalizeArchivePath(item.path);
      if (!normalized.ok) {
        addIssue(errors, "UNSAFE_MANIFEST_PATH", normalized.reason, item.path);
        continue;
      }
      manifestPathSet.add(normalized.value);
      if (!files.has(normalized.value)) {
        addIssue(errors, "MANIFEST_FILE_MISSING", "File listed in manifest is missing from archive", normalized.value);
      }
    }

    for (const archivePath of files.keys()) {
      if (!manifestPathSet.has(archivePath)) {
        addIssue(warnings, "UNDECLARED_ARCHIVE_FILE", "Archive file is not listed in manifest", archivePath);
      }
      if (!this.isSupportedArchiveFile(archivePath)) {
        addIssue(warnings, "UNSUPPORTED_ARCHIVE_FILE", "Unsupported file type was ignored", archivePath);
      }
    }

    const assetIds = new Set(library.assets.map((asset) => asset.id));
    const assetStoragePaths = new Set<string>();

    for (const asset of library.assets) {
      const normalizedStorage = normalizeArchivePath(asset.storagePath);
      if (!normalizedStorage.ok) {
        addIssue(errors, "INVALID_ASSET_STORAGE_PATH", normalizedStorage.reason, asset.storagePath);
        continue;
      }
      const storagePath = normalizedStorage.value;
      assetStoragePaths.add(storagePath);
      if (!files.has(storagePath)) {
        addIssue(errors, "MISSING_ASSET_FILE", "Asset file referenced in library.json is missing", storagePath);
      }
      if (!ALLOWED_ASSET_MIME.has(asset.mimeType)) {
        addIssue(errors, "UNSUPPORTED_ASSET_MIME", `Unsupported asset mime type: ${asset.mimeType}`, storagePath);
      }
      const size = fileSizes.get(storagePath);
      if (size !== undefined && size > MAX_FILE_SIZE_BYTES) {
        addIssue(errors, "ASSET_TOO_LARGE", `Asset exceeds ${Math.floor(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB limit`, storagePath);
      }
    }

    for (const archivePath of files.keys()) {
      if (archivePath.startsWith("assets/") && !assetStoragePaths.has(archivePath)) {
        addIssue(warnings, "EXTRA_ASSET_FILE", "Asset exists in archive but is not listed in library.json", archivePath);
      }
    }

    for (const element of library.elements) {
      const refs = collectElementAssetIds(element);
      for (const ref of refs) {
        if (!assetIds.has(ref)) {
          addIssue(errors, "BROKEN_ASSET_REFERENCE", `Element references missing asset: ${ref}`, `element:${element.id}`);
        }
      }
    }

    const macroIds = new Set((library.macros ?? []).map((macro) => macro.id));
    for (const macro of library.macros ?? []) {
      if (macro.language !== "javascript-lite") {
        addIssue(errors, "UNSUPPORTED_MACRO_LANGUAGE", `Unsupported macro language: ${macro.language}`, `macro:${macro.id}`);
      }
    }

    for (const element of library.elements) {
      const refs = collectElementMacroIds(element);
      for (const macroId of refs) {
        if (!macroIds.has(macroId)) {
          addIssue(warnings, "BROKEN_MACRO_REFERENCE", `Element references missing macro: ${macroId}`, `element:${element.id}`);
        }
      }
    }

    const existing = await this.getLibrary(library.id);
    if (existing) {
      resultBase.conflicts.libraryExists = true;
      const existingElementIds = new Set(existing.elements.map((item) => item.id));
      const existingAssetIds = new Set(existing.assets.map((item) => item.id));
      resultBase.conflicts.elementConflicts = library.elements.filter((item) => existingElementIds.has(item.id)).map((item) => item.id);
      resultBase.conflicts.assetConflicts = library.assets.filter((item) => existingAssetIds.has(item.id)).map((item) => item.id);
    }

    const projectMacroIds = new Set((this.projectService.getProject().macros ?? []).map((item) => item.id));
    resultBase.conflicts.projectMacroConflicts = (library.macros ?? [])
      .filter((macro) => projectMacroIds.has(macro.id))
      .map((macro) => macro.id);

    const valid = errors.length === 0;

    const result: LibraryImportValidationResult = {
      ...resultBase,
      valid,
      summary: valid
        ? {
            libraryId: library.id,
            name: library.name,
            version: library.version,
            elements: library.elements.length,
            assets: library.assets.length,
            macros: (library.macros ?? []).length,
          }
        : undefined,
    };

    if (!valid) {
      return { result };
    }

    return {
      result,
      parsed: {
        manifest,
        library,
        files,
        fileSizes,
      },
    };
  }

  private prepareImportedLibrary(source: ElementLibrary, targetLibraryId: string): ElementLibrary {
    const now = nowIso();
    const macros = (source.macros ?? []).map((macro) => macroSchema.parse(macro));
    const next: ElementLibrary = {
      ...source,
      id: targetLibraryId,
      updatedAt: now,
      assets: source.assets.map((asset) => {
        const normalizedStorage = normalizeArchivePath(asset.storagePath);
        const storagePath = normalizedStorage.ok ? normalizedStorage.value : `assets/${asset.fileName}`;
        return {
          ...asset,
          storagePath,
          previewUrl: `/api/libraries/${encodeURIComponent(targetLibraryId)}/assets/${asset.id}/file`,
          updatedAt: now,
        };
      }),
      elements: source.elements.map((element) => ({
        ...element,
        libraryId: targetLibraryId,
        updatedAt: now,
      })),
      macros,
    };
    return elementLibrarySchema.parse(next);
  }

  private isSupportedArchiveFile(entryPath: string): boolean {
    return entryPath === "manifest.json"
      || entryPath === "library.json"
      || entryPath.startsWith("assets/")
      || entryPath.startsWith("previews/");
  }

  private async requireLibrary(libraryId: string): Promise<ElementLibrary> {
    const library = await this.getLibrary(libraryId);
    if (!library) {
      throw new Error(`Library \"${libraryId}\" not found`);
    }
    return library;
  }

  private async tryLoadLibrary(libraryId: string): Promise<ElementLibrary | undefined> {
    const file = this.libraryFilePath(libraryId);
    try {
      const raw = await readFile(file, "utf8");
      const parsed = elementLibrarySchema.parse(JSON.parse(raw));
      return normalizeLibraryForStorage(parsed);
    } catch {
      return undefined;
    }
  }

  private async saveLibrary(library: ElementLibrary): Promise<void> {
    const parsed = elementLibrarySchema.parse(normalizeLibraryForStorage(library));
    const file = this.libraryFilePath(parsed.id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(parsed, null, 2), "utf8");
  }

  private libraryDir(libraryId: string): string {
    return path.join(this.librariesRoot, safeId(libraryId));
  }

  private async existsPath(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async existsLibrary(libraryId: string): Promise<boolean> {
    return this.existsPath(this.libraryFilePath(libraryId));
  }
}
