import type { Asset } from "@web-scada/shared";

export function normalizeAssetFolderPath(path: string | undefined): string {
  if (!path) {
    return "";
  }
  return path
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => Boolean(segment) && segment !== "." && segment !== "..")
    .join("/");
}

export function getAssetDisplayPath(asset: Asset): string {
  const folderPath = normalizeAssetFolderPath(asset.folderPath);
  return folderPath ? `${folderPath}/${asset.name}` : asset.name;
}

