import { z } from "zod";

export const projectCleanupCandidateTypeSchema = z.enum([
  "orphan-physical-file",
  "unused-project-asset-record",
  "duplicate-asset",
  "duplicate-library",
  "duplicate-macro",
  "unused-library",
  "unused-macro",
  "unused-variable",
  "unused-lw-entry",
  "unused-tag",
  "unused-event",
  "unused-event-sound",
  "protected-driver",
  "protected-event-category",
]);

export type ProjectCleanupCandidateType = z.infer<typeof projectCleanupCandidateTypeSchema>;

export const projectCleanupSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type ProjectCleanupSeverity = z.infer<typeof projectCleanupSeveritySchema>;

export const projectCleanupPlannedActionSchema = z.enum([
  "delete-file",
  "delete-record",
  "rewrite-then-delete",
  "review-only",
  "skip-protected",
]);
export type ProjectCleanupPlannedAction = z.infer<typeof projectCleanupPlannedActionSchema>;

export const projectCleanupScopeSchema = z.enum(["safe", "review", "protected"]);
export type ProjectCleanupScope = z.infer<typeof projectCleanupScopeSchema>;

export const projectCleanupCategorySchema = z.enum([
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
]);
export type ProjectCleanupCategory = z.infer<typeof projectCleanupCategorySchema>;

export const projectCleanupCandidateSchema = z.object({
  id: z.string().min(1),
  type: projectCleanupCandidateTypeSchema,
  scope: projectCleanupScopeSchema,
  name: z.string().optional(),
  path: z.string().optional(),
  reason: z.string().min(1),
  severity: projectCleanupSeveritySchema,
  selectedByDefault: z.boolean(),
  referencesCount: z.number().int().nonnegative(),
  plannedAction: projectCleanupPlannedActionSchema,
  warnings: z.array(z.string()).default([]),
  duplicateGroupId: z.string().optional(),
  canonicalId: z.string().optional(),
  rewriteTargetId: z.string().optional(),
});
export type ProjectCleanupCandidate = z.infer<typeof projectCleanupCandidateSchema>;

export const projectCleanupAnalyzeRequestSchema = z.object({
  requestedCategories: z.array(projectCleanupCategorySchema).min(1).optional(),
  includeReviewCandidates: z.boolean().default(true),
  orphanFileMinAgeMs: z.number().int().min(0).default(60 * 60 * 1000),
});
export type ProjectCleanupAnalyzeRequest = z.infer<typeof projectCleanupAnalyzeRequestSchema>;

export const projectCleanupSummarySchema = z.object({
  totalCandidates: z.number().int().nonnegative(),
  safeCandidates: z.number().int().nonnegative(),
  reviewCandidates: z.number().int().nonnegative(),
  protectedCandidates: z.number().int().nonnegative(),
  selectedByDefaultCount: z.number().int().nonnegative(),
  byType: z.record(projectCleanupCandidateTypeSchema, z.number().int().nonnegative()).default({}),
});
export type ProjectCleanupSummary = z.infer<typeof projectCleanupSummarySchema>;

export const projectCleanupAnalyzeResponseSchema = z.object({
  analysisToken: z.string().min(1),
  analysisFingerprint: z.string().min(1),
  analyzedAt: z.string().datetime(),
  requestedCategories: z.array(projectCleanupCategorySchema),
  summary: projectCleanupSummarySchema,
  candidates: z.array(projectCleanupCandidateSchema),
  warnings: z.array(z.string()).default([]),
});
export type ProjectCleanupAnalyzeResponse = z.infer<typeof projectCleanupAnalyzeResponseSchema>;

export const projectCleanupApplyOptionsSchema = z.object({
  createBackup: z.boolean().default(true),
  rewriteDuplicateReferences: z.boolean().default(true),
  deleteOrphanFiles: z.boolean().default(true),
  deleteUnusedReviewItems: z.boolean().default(false),
});
export type ProjectCleanupApplyOptions = z.infer<typeof projectCleanupApplyOptionsSchema>;

export const projectCleanupApplyRequestSchema = z.object({
  analysisToken: z.string().min(1),
  analysisFingerprint: z.string().min(1),
  selectedCandidateIds: z.array(z.string().min(1)).default([]),
  options: projectCleanupApplyOptionsSchema.default({
    createBackup: true,
    rewriteDuplicateReferences: true,
    deleteOrphanFiles: true,
    deleteUnusedReviewItems: false,
  }),
});
export type ProjectCleanupApplyRequest = z.infer<typeof projectCleanupApplyRequestSchema>;

export const projectCleanupSkippedItemSchema = z.object({
  candidateId: z.string().min(1),
  reason: z.string().min(1),
});
export type ProjectCleanupSkippedItem = z.infer<typeof projectCleanupSkippedItemSchema>;

export const projectCleanupApplyResponseSchema = z.object({
  ok: z.literal(true),
  analysisToken: z.string().min(1),
  analysisFingerprint: z.string().min(1),
  appliedAt: z.string().datetime(),
  backupPath: z.string().optional(),
  rewrittenReferences: z.number().int().nonnegative(),
  deletedAssets: z.array(z.string()),
  deletedLibraries: z.array(z.string()),
  deletedMacros: z.array(z.string()),
  deletedVariables: z.array(z.string()),
  deletedLwEntries: z.array(z.number().int().nonnegative()),
  deletedTags: z.array(z.string()),
  deletedEvents: z.array(z.string()),
  deletedEventSounds: z.array(z.string()),
  deletedFiles: z.array(z.string()),
  skipped: z.array(projectCleanupSkippedItemSchema),
  warnings: z.array(z.string()),
});
export type ProjectCleanupApplyResponse = z.infer<typeof projectCleanupApplyResponseSchema>;
