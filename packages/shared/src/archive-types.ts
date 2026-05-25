import { z } from "zod";
import type { Asset, ElementLibrary } from "./asset-library-types";
import type { EventDefinition } from "./event-types";
import type { HmiScreen, InternalVariableDefinition, LwStoreConfig, MacroDefinition, ScadaProject } from "./project-types";
import type { TagDefinition } from "./tag-types";
import { assetSchema, elementLibrarySchema, eventDefinitionSchema, hmiScreenSchema, macroSchema, projectSchema, tagSchema, variableSchema } from "./validation";

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

export type ProjectArchiveSignature = {
  algorithm: "HMAC-SHA256";
  signedPayload: "manifest.json";
  signature: string;
  createdAt: string;
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
  variables?: InternalVariableDefinition[];
  lwStore?: LwStoreConfig;
  macros: MacroDefinition[];
  events?: EventDefinition[];
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
    events?: number;
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
  authenticity?: {
    signed: boolean;
    required: boolean;
    verified: boolean;
    algorithm?: "HMAC-SHA256";
  };
  checksum?: {
    verified: boolean;
  };
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
export type ArchiveResourceImportMode = "add" | "replace" | "copy" | "keep-existing";

export type ProjectArchiveImportOptions = {
  mode: ProjectArchiveImportMode;
  requireSignature?: boolean;
};

export type ScreenArchiveImportOptions = {
  mode: ScreenArchiveImportMode;
  replaceScreenId?: string;
  requireSignature?: boolean;
};

export type ProjectArchiveScreenImportOptions = ScreenArchiveImportOptions & {
  screenIds: string[];
  dependencyMode?: ScreenArchiveDependencyMode;
};

export type ProjectArchiveLibraryImportOptions = {
  libraryIds: string[];
  conflictMode?: Extract<ArchiveResourceImportMode, "copy" | "replace" | "keep-existing">;
  requireSignature?: boolean;
};

export type ProjectArchiveMacroImportOptions = {
  macroIds: string[];
  conflictMode?: ArchiveResourceImportMode;
  requireSignature?: boolean;
};

export type ProjectArchiveAssetsImportOptions = {
  assetIds: string[];
  requireSignature?: boolean;
};

export type ProjectArchiveValidationOptions = {
  requireSignature?: boolean;
};

export type ScreenArchiveValidationOptions = {
  requireSignature?: boolean;
};

export type ScreenArchiveDependencyMode = "minimal" | "safe";

export type ScreenArchiveExportOptions = {
  dependencyMode?: ScreenArchiveDependencyMode;
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
  importedScreens: Array<{ id: string; name: string }>;
  importedAssets: number;
  reusedAssets: number;
  copiedAssets: number;
  importedTags: number;
  skippedTags: number;
  importedVariables: number;
  reusedVariables: number;
  importedLw: number;
  reusedLw: number;
  importedMacros: number;
  reusedMacros: number;
  copiedMacros: number;
  importedLibraries: number;
  reusedLibraries: number;
  copiedLibraries: number;
  warnings: ProjectArchiveIssue[];
  project: ScadaProject;
};

export type ArchiveInspectionItem = {
  id: string;
  name: string;
  checksum?: string;
  kind?: string;
  count?: number;
};

export type ArchiveConflictPreviewItem = {
  id: string;
  name: string;
  status:
    | "new"
    | "reuse-same-checksum"
    | "copy-different-checksum"
    | "keep-existing"
    | "replace"
    | "import-as-copy";
  message: string;
};

export type ArchiveDependencySummary = {
  assets: number;
  libraries: number;
  macros: number;
  tags: number;
  events: number;
};

export type ProjectArchiveInspectionResult = ProjectArchiveValidationResult & {
  archiveType?: "project" | "screen";
  screens: ArchiveInspectionItem[];
  libraries: ArchiveInspectionItem[];
  macros: ArchiveInspectionItem[];
  assets: ArchiveInspectionItem[];
  tags: ArchiveInspectionItem[];
  events: ArchiveInspectionItem[];
  dependencies?: ArchiveDependencySummary;
  conflicts?: {
    assets: ArchiveConflictPreviewItem[];
    libraries: ArchiveConflictPreviewItem[];
    macros: ArchiveConflictPreviewItem[];
    tags: ArchiveConflictPreviewItem[];
    screens: ArchiveConflictPreviewItem[];
  };
};

export type ProjectArchivePartialImportResult = {
  ok: boolean;
  imported: {
    screens?: number;
    libraries?: number;
    macros?: number;
    assets?: number;
  };
  reused: {
    assets?: number;
    libraries?: number;
    macros?: number;
  };
  copied: {
    assets?: number;
    libraries?: number;
    macros?: number;
  };
  warnings: ProjectArchiveIssue[];
  project: ScadaProject;
};

export const archiveManifestFileSchema = z.object({
  path: z.string().min(1),
  type: z.enum(["metadata", "project", "screen", "asset", "library", "libraryAsset", "eventSound"]),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const projectArchiveSignatureSchema = z.object({
  algorithm: z.literal("HMAC-SHA256"),
  signedPayload: z.literal("manifest.json"),
  signature: z.string().regex(/^[a-f0-9]{64}$/i),
  createdAt: z.string().min(1),
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
  variables: z.array(variableSchema).optional(),
  lwStore: z
    .object({
      mode: z.enum(["volatile", "persistent"]).optional(),
      values: z.record(z.coerce.number()).optional(),
    })
    .optional(),
  macros: z.array(macroSchema),
  events: z.array(eventDefinitionSchema).optional(),
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
    events: z.number().int().nonnegative().optional(),
  }),
  files: z.array(archiveManifestFileSchema),
});

export const projectArchiveImportOptionsSchema = z.object({
  mode: z.enum(["replace-current", "import-as-copy"]).default("replace-current"),
  requireSignature: z.boolean().optional(),
});

export const screenArchiveImportOptionsSchema = z.object({
  mode: z.enum(["add", "replace"]).default("add"),
  replaceScreenId: z.string().min(1).optional(),
  requireSignature: z.boolean().optional(),
});

export const projectArchiveScreenImportOptionsSchema = screenArchiveImportOptionsSchema.extend({
  screenIds: z.array(z.string().min(1)).min(1),
  dependencyMode: z.enum(["minimal", "safe"]).default("safe"),
});

export const projectArchiveLibraryImportOptionsSchema = z.object({
  libraryIds: z.array(z.string().min(1)).min(1),
  conflictMode: z.enum(["copy", "replace", "keep-existing"]).default("copy"),
  requireSignature: z.boolean().optional(),
});

export const projectArchiveMacroImportOptionsSchema = z.object({
  macroIds: z.array(z.string().min(1)).min(1),
  conflictMode: z.enum(["add", "replace", "copy", "keep-existing"]).default("copy"),
  requireSignature: z.boolean().optional(),
});

export const projectArchiveAssetsImportOptionsSchema = z.object({
  assetIds: z.array(z.string().min(1)).min(1),
  requireSignature: z.boolean().optional(),
});

export const projectArchiveValidationOptionsSchema = z.object({
  requireSignature: z.boolean().optional(),
});

export const screenArchiveValidationOptionsSchema = z.object({
  requireSignature: z.boolean().optional(),
});

export const screenArchiveExportOptionsSchema = z.object({
  dependencyMode: z.enum(["minimal", "safe"]).default("safe"),
});

export { projectSchema };
