import type { HmiObject } from "./hmi-object-types";

export type AssetType = "png" | "jpg" | "jpeg" | "svg";

export type Asset = {
  id: string;
  name: string;
  type: AssetType;
  mimeType: string;
  fileName: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
  updatedAt: string;
  storagePath: string;
  previewUrl: string;
};

export type ProjectLibraryRef = {
  libraryId: string;
  name: string;
  version?: string;
  path?: string;
  enabled: boolean;
};

export type LibraryParameter = {
  name: string;
  type: "string" | "number" | "boolean" | "color" | "tag";
  defaultValue?: unknown;
  description?: string;
};

export type LibraryElement = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  width: number;
  height: number;
  previewAssetId?: string;
  objects: HmiObject[];
  parameters?: LibraryParameter[];
  createdAt: string;
  updatedAt: string;
};

export type ElementLibrary = {
  id: string;
  name: string;
  description?: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  assets: Asset[];
  elements: LibraryElement[];
};

