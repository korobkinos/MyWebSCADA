export type ArchiveRuntimeSettings = {
  autoCleanupEnabled: boolean;
  archiveNewTagsByDefault: boolean;
  maxDbSizeMb: number | null;
  deleteBatchSize: number;
  maintenanceIntervalMs: number;
  maxMaintenanceTickMs: number;
  maxDeleteTransactionMs: number;
  updatedAt: string;
};
