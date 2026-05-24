import { z } from "zod";
import type { Asset, ElementLibrary } from "./asset-library-types";
import type { HmiScreen, MacroDefinition, ScadaProject } from "./project-types";
import type { TagDefinition } from "./tag-types";
import { assetSchema, elementLibrarySchema, hmiScreenSchema, macroSchema, projectSchema, tagSchema } from "./validation";

export type ArchiveFileKind =
  | "metadata"
  | "project"
  | "screen"
  | "asset"
  | "library"
  | "libraryAsset"
  | "eventSound";

export type ArchiveManifestFile = {
  path: string;
  type: ArchiveFileKind;
  size: number;
  sha256: string;
};

export type ProjectArchiveManifest = {
  format: "mywebscada-project";
  formatVersion: number;
  exportedAt: string;
  appName?: string;
  appVersion?: string;
  projectName: string;
  counts: {
    screens: number;
    tags: number;
    assets: number;
    libraries: number;
    events: number;
    macros: number;
    variables: number;
  };
  files: ArchiveManifestFile[];
};

export type ScreenArchiveData = {
  screen: HmiScreen;
  assets: Asset[];
  libraries: ElementLibrary[];
  tags: TagDefinition[];
  macros: MacroDefinition[];
};

export type ScreenArchiveManifest = {
  format: "mywebscada-screen";
  formatVersion: number;
  exportedAt: string;
  appName?: string;
  appVersion?: string;
  screenId: string;
  screenName: string;
  counts: {
    assets: number;
    libraries: number;
    tags: number;
    macros: number;
  };
  files: ArchiveManifestFile[];
};

export type ProjectArchiveIssue = {
  code: string;
  message: string;
  path?: string;
};

export type ProjectArchiveValidationSummary = {
  format: "mywebscada-project" | "mywebscada-screen";
  name: string;
  screens: number;
  tags: number;
  assets: number;
  libraries: number;
  events: number;
  macros: number;
  variables: number;
};

export type ProjectArchiveValidationResult = {
  valid: boolean;
  summary?: ProjectArchiveValidationSummary;
  warnings: ProjectArchiveIssue[];
  errors: ProjectArchiveIssue[];
};

export type ScreenArchiveValidationResult = ProjectArchiveValidationResult & {
  conflicts?: {
    screenIdConflict: boolean;
    assetConflicts: string[];
    tagConflicts: string[];
    libraryConflicts: string[];
  };
};

export type ProjectArchiveImportMode = "replace-current" | "import-as-copy";
export type ScreenArchiveImportMode = "add" | "replace";

export type ProjectArchiveImportOptions = {
  mode: ProjectArchiveImportMode;
};

export type ScreenArchiveImportOptions = {
  mode: ScreenArchiveImportMode;
  replaceScreenId?: string;
};

export type ProjectArchiveImportResult = {
  ok: boolean;
  mode: ProjectArchiveImportMode;
  backupPath?: string;
  project: ScadaProject;
};

export type ScreenArchiveImportResult = {
  ok: boolean;
  mode: ScreenArchiveImportMode;
  screenId: string;
  importedScreenName: string;
  reusedAssets: number;
  copiedAssets: number;
  importedTags: number;
  skippedTags: number;
  reusedLibraries: number;
  copiedLibraries: number;
  warnings: ProjectArchiveIssue[];
  project: ScadaProject;
};

export const archiveManifestFileSchema = z.object({
  path: z.string().min(1),
  type: z.enum(["metadata", "project", "screen", "asset", "library", "libraryAsset", "eventSound"]),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const projectArchiveManifestSchema = z.object({
  format: z.literal("mywebscada-project"),
  formatVersion: z.number().int().positive(),
  exportedAt: z.string().min(1),
  appName: z.string().optional(),
  appVersion: z.string().optional(),
  projectName: z.string().min(1),
  counts: z.object({
    screens: z.number().int().nonnegative(),
    tags: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
    libraries: z.number().int().nonnegative(),
    events: z.number().int().nonnegative(),
    macros: z.number().int().nonnegative(),
    variables: z.number().int().nonnegative(),
  }),
  files: z.array(archiveManifestFileSchema),
});

export const screenArchiveDataSchema = z.object({
  screen: hmiScreenSchema,
  assets: z.array(assetSchema),
  libraries: z.array(elementLibrarySchema),
  tags: z.array(tagSchema),
  macros: z.array(macroSchema),
});

export const screenArchiveManifestSchema = z.object({
  format: z.literal("mywebscada-screen"),
  formatVersion: z.number().int().positive(),
  exportedAt: z.string().min(1),
  appName: z.string().optional(),
  appVersion: z.string().optional(),
  screenId: z.string().min(1),
  screenName: z.string().min(1),
  counts: z.object({
    assets: z.number().int().nonnegative(),
    libraries: z.number().int().nonnegative(),
    tags: z.number().int().nonnegative(),
    macros: z.number().int().nonnegative(),
  }),
  files: z.array(archiveManifestFileSchema),
});

export const projectArchiveImportOptionsSchema = z.object({
  mode: z.enum(["replace-current", "import-as-copy"]).default("replace-current"),
});

export const screenArchiveImportOptionsSchema = z.object({
  mode: z.enum(["add", "replace"]).default("add"),
  replaceScreenId: z.string().min(1).optional(),
});

export { projectSchema };
