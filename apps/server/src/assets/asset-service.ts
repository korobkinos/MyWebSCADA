import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Asset, AssetType, HmiObject, ScadaProject } from "@web-scada/shared";
import { ProjectService } from "../project/project-service.js";

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

function normalizeType(type: AssetType): AssetType {
  if (type === "jpeg") {
    return "jpg";
  }
  return type;
}

function assetExtension(type: AssetType): string {
  if (type === "jpeg") {
    return "jpg";
  }
  return type;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class AssetService {
  public constructor(private readonly projectService: ProjectService) {}

  public listProjectAssets(): Asset[] {
    return this.projectService.getProject().assets ?? [];
  }

  public getProjectAsset(assetId: string): Asset | undefined {
    return this.listProjectAssets().find((item) => item.id === assetId);
  }

  public async uploadProjectAsset(input: UploadInput): Promise<Asset> {
    const type = MIME_TO_TYPE[input.mimeType];
    if (!type) {
      throw new Error("Unsupported asset type. Only PNG, JPEG, SVG are allowed.");
    }

    const projectFile = this.projectService.getProjectFile();
    const projectDir = path.dirname(projectFile);
    const assetsDir = path.join(projectDir, "assets");
    await mkdir(assetsDir, { recursive: true });

    const id = randomUUID();
    const ext = assetExtension(type);
    const fileName = `${id}.${ext}`;
    const absolutePath = path.join(assetsDir, fileName);
    await writeFile(absolutePath, input.content);

    const timestamp = nowIso();
    const asset: Asset = {
      id,
      name: (input.name?.trim() || path.parse(input.fileName).name || id).slice(0, 120),
      type: normalizeType(type),
      mimeType: input.mimeType,
      fileName,
      size: input.size,
      createdAt: timestamp,
      updatedAt: timestamp,
      storagePath: path.posix.join("assets", fileName),
      previewUrl: `/api/assets/${id}/file`,
    };

    const project = this.projectService.getProject();
    const next: ScadaProject = {
      ...project,
      assets: [...(project.assets ?? []), asset],
    };
    await this.projectService.saveProject(next);
    return asset;
  }

  public async deleteProjectAsset(assetId: string): Promise<void> {
    const project = this.projectService.getProject();
    const assets = project.assets ?? [];
    const target = assets.find((item) => item.id === assetId);
    if (!target) {
      throw new Error("Asset not found");
    }

    if (isAssetUsedInProject(project, assetId)) {
      throw new Error("Asset is used in project objects and cannot be deleted");
    }

    const projectDir = path.dirname(this.projectService.getProjectFile());
    const absolutePath = path.join(projectDir, target.storagePath);
    await rm(absolutePath, { force: true });

    const next: ScadaProject = {
      ...project,
      assets: assets.filter((item) => item.id !== assetId),
    };
    await this.projectService.saveProject(next);
  }
}

function isAssetUsedInProject(project: ScadaProject, assetId: string): boolean {
  return project.screens.some((screen) => screen.objects.some((obj) => isAssetUsedInObject(obj, assetId)));
}

function isAssetUsedInObject(object: HmiObject, assetId: string): boolean {
  if (object.type === "image") {
    if (object.assetId === assetId) {
      return true;
    }
    return Boolean(object.stateImages?.some((item) => item.assetId === assetId));
  }

  if (object.type === "stateImage") {
    if (object.defaultAssetId === assetId || object.badQualityAssetId === assetId) {
      return true;
    }
    return object.states.some((state) => state.assetId === assetId);
  }

  if (object.type === "button") {
    return (
      object.backgroundAssetId === assetId ||
      object.pressedBackgroundAssetId === assetId ||
      object.disabledBackgroundAssetId === assetId
    );
  }

  return false;
}
