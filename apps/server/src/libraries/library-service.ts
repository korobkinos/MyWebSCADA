import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Asset,
  AssetType,
  ElementLibrary,
  LibraryElement,
  ProjectLibraryRef,
  ScadaProject,
} from "@web-scada/shared";
import { elementLibrarySchema, libraryElementSchema } from "@web-scada/shared";
import { ProjectService } from "../project/project-service.js";

type CreateLibraryPayload = {
  id: string;
  name: string;
  description?: string;
  version?: string;
};

type UploadInput = {
  fileName: string;
  mimeType: string;
  size: number;
  content: Buffer;
  name?: string;
};

const MIME_TO_TYPE: Record<string, AssetType> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/svg+xml": "svg",
};

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
    };

    await this.saveLibrary(library);
    return library;
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

    library.assets = [...library.assets, asset];
    library.updatedAt = timestamp;
    await this.saveLibrary(library);
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
      throw new Error(`Element with id "${normalized.id}" already exists`);
    }

    library.elements = [...library.elements, normalized];
    library.updatedAt = now;
    await this.saveLibrary(library);
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

    library.elements = library.elements.map((item) => (item.id === elementId ? merged : item));
    library.updatedAt = nowIso();
    await this.saveLibrary(library);
    return merged;
  }

  public async deleteElement(libraryId: string, elementId: string): Promise<void> {
    const library = await this.requireLibrary(libraryId);
    const exists = library.elements.some((item) => item.id === elementId);
    if (!exists) {
      throw new Error("Element not found");
    }
    library.elements = library.elements.filter((item) => item.id !== elementId);
    library.updatedAt = nowIso();
    await this.saveLibrary(library);
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

  private async requireLibrary(libraryId: string): Promise<ElementLibrary> {
    const library = await this.getLibrary(libraryId);
    if (!library) {
      throw new Error(`Library "${libraryId}" not found`);
    }
    return library;
  }

  private async tryLoadLibrary(libraryId: string): Promise<ElementLibrary | undefined> {
    const file = this.libraryFilePath(libraryId);
    try {
      const raw = await readFile(file, "utf8");
      const parsed = elementLibrarySchema.parse(JSON.parse(raw));
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async saveLibrary(library: ElementLibrary): Promise<void> {
    const parsed = elementLibrarySchema.parse(library);
    const file = this.libraryFilePath(library.id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(parsed, null, 2), "utf8");
  }

  private libraryDir(libraryId: string): string {
    return path.join(this.librariesRoot, safeId(libraryId));
  }

  public async deleteLibraryAssetFile(libraryId: string, assetId: string): Promise<void> {
    const library = await this.requireLibrary(libraryId);
    const asset = library.assets.find((item) => item.id === assetId);
    if (!asset) {
      return;
    }
    const absolute = path.join(this.libraryDir(library.id), asset.storagePath);
    await rm(absolute, { force: true });
  }
}
