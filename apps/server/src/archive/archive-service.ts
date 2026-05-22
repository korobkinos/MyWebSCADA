import type { DriverConfig, TagDefinition, TagValue } from "@web-scada/shared";
import { TagStore } from "../tags/tag-store.js";
import {
  ArchiveRepository,
  type ArchivePurgePreviewRow,
  type ArchivePurgeResultRow,
  type ArchiveLogger,
  type ArchivePolicyInput,
  type ArchivePolicyRow,
  type TrendAggregationMode,
  type TrendQueryRow,
  type TrendTagInfoRow,
  type ArchiveRuntimeSettingsRow,
  type ArchiveSampleRow,
  type ArchiveTagConfigRow,
  type ArchiveTagOverrideInput,
} from "./archive-repository.js";

type ArchiveServiceOptions = {
  connectionString: string;
  maxPoolSize?: number;
  batchSize?: number;
  flushIntervalMs?: number;
  maintenanceIntervalMs?: number;
  defaultArchiveEnabled?: boolean;
};

export function shouldRunArchiveMaintenanceAfterSettingsUpdate(
  _previous: ArchiveRuntimeSettingsRow,
  next: ArchiveRuntimeSettingsRow,
): boolean {
  if (!next.autoCleanupEnabled) {
    return false;
  }
  const nextMaxDbSizeMb = next.maxDbSizeMb ?? 0;
  return nextMaxDbSizeMb > 0;
}

export class ArchiveService {
  private readonly repository: ArchiveRepository;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maintenanceIntervalMs: number;
  private readonly queue: TagValue[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private maintenanceTimer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private flushing = false;
  private maintenanceRunning = false;
  private maintenanceRequested = false;
  private initialized = false;
  private readonly snapshotIntervalMs = 1000;
  private lastSnapshotAt = 0;

  public constructor(
    options: ArchiveServiceOptions,
    private readonly tagStore: TagStore,
    private readonly logger: ArchiveLogger,
  ) {
    this.repository = new ArchiveRepository(options, logger);
    this.batchSize = options.batchSize ?? 500;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.maintenanceIntervalMs = options.maintenanceIntervalMs ?? 60 * 60 * 1000;
  }

  public static fromEnvironment(tagStore: TagStore, logger: ArchiveLogger): ArchiveService | undefined {
    const connectionString = process.env.ARCHIVE_DATABASE_URL ?? process.env.DATABASE_URL;
    const enabled = process.env.ARCHIVE_ENABLED === "1" || Boolean(process.env.ARCHIVE_DATABASE_URL);
    if (!enabled || !connectionString) {
      return undefined;
    }
    return new ArchiveService(
      {
        connectionString,
        maxPoolSize: Number(process.env.ARCHIVE_DB_POOL_SIZE ?? 5),
        batchSize: Number(process.env.ARCHIVE_BATCH_SIZE ?? 500),
        flushIntervalMs: Number(process.env.ARCHIVE_FLUSH_INTERVAL_MS ?? 1000),
        maintenanceIntervalMs: Number(process.env.ARCHIVE_MAINTENANCE_INTERVAL_MS ?? 60 * 60 * 1000),
        defaultArchiveEnabled: process.env.ARCHIVE_DEFAULT_ENABLED === "1",
      },
      tagStore,
      logger,
    );
  }

  public async initialize(tags: TagDefinition[], drivers: DriverConfig[]): Promise<void> {
    await this.repository.initialize();
    await this.syncMetadata(tags, drivers);
    await this.repository.configureCompressionPolicy();
    this.unsubscribe = this.tagStore.subscribeUpdates((value) => {
      this.enqueue(value);
    });
    this.enqueuePeriodicSnapshot();
    this.flushTimer = setInterval(() => {
      this.enqueuePeriodicSnapshot();
      void this.flush().catch((error) => this.logger.error(`Archive flush failed: ${this.errorText(error)}`));
    }, this.flushIntervalMs);
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenance().catch((error) => this.logger.error(`Archive maintenance failed: ${this.errorText(error)}`));
    }, this.maintenanceIntervalMs);
    this.initialized = true;
  }

  public async syncMetadata(tags: TagDefinition[], drivers: DriverConfig[]): Promise<void> {
    await this.repository.syncMetadata(tags, drivers);
  }

  public async querySamples(tagName: string, from: Date, to: Date, limit: number): Promise<ArchiveSampleRow[]> {
    return this.repository.querySamples(tagName, from, to, limit);
  }

  public async listTrendTags(): Promise<TrendTagInfoRow[]> {
    return this.repository.listTrendTags();
  }

  public async queryTrendsRange(tags: string[]): Promise<{ from: string | null; to: string | null }> {
    return this.repository.queryTrendsRange(tags);
  }

  public async queryTrends(request: {
    tags: string[];
    from: Date;
    to: Date;
    maxPoints: number;
    aggregation: TrendAggregationMode;
    hardLimitPerSeries: number;
  }): Promise<TrendQueryRow> {
    return this.repository.queryTrends(request);
  }

  public async listPolicies(): Promise<ArchivePolicyRow[]> {
    return this.repository.listPolicies();
  }

  public async upsertPolicy(id: number | undefined, policy: ArchivePolicyInput): Promise<ArchivePolicyRow> {
    const saved = await this.repository.upsertPolicy(id, policy);
    await this.repository.configureCompressionPolicy();
    return saved;
  }

  public async deletePolicy(id: number): Promise<boolean> {
    const deleted = await this.repository.deletePolicy(id);
    await this.repository.configureCompressionPolicy();
    return deleted;
  }

  public async listTagConfigs(): Promise<ArchiveTagConfigRow[]> {
    return this.repository.listTagConfigs();
  }

  public async assignTagPolicy(tagName: string, policyId: number | null): Promise<boolean> {
    const assigned = await this.repository.assignTagPolicy(tagName, policyId);
    await this.repository.configureCompressionPolicy();
    return assigned;
  }

  public async upsertTagOverride(tagName: string, override: ArchiveTagOverrideInput): Promise<boolean> {
    const saved = await this.repository.upsertTagOverride(tagName, override);
    await this.repository.configureCompressionPolicy();
    return saved;
  }

  public async deleteTagOverride(tagName: string): Promise<boolean> {
    const deleted = await this.repository.deleteTagOverride(tagName);
    await this.repository.configureCompressionPolicy();
    return deleted;
  }

  public async runMaintenance(): Promise<{ deletedSamples: number }> {
    if (this.maintenanceRunning) {
      this.maintenanceRequested = true;
      return { deletedSamples: 0 };
    }
    this.maintenanceRunning = true;
    try {
      await this.flush();
      const runtimeSettings = await this.repository.getRuntimeSettings();
      const runtimeCleanup = await this.repository.enforceRuntimeLimits(runtimeSettings);
      const deletedByRetention = await this.repository.applyRetention();
      return {
        deletedSamples: deletedByRetention + runtimeCleanup.deletedByAge + runtimeCleanup.deletedBySize,
      };
    } finally {
      this.maintenanceRunning = false;
      if (this.maintenanceRequested) {
        this.maintenanceRequested = false;
        void this.runMaintenance().catch((error) => this.logger.error(`Archive maintenance failed: ${this.errorText(error)}`));
      }
    }
  }

  public async getStatus(): Promise<{ enabled: boolean; queuedSamples: number; reason: string; dbSizeMb: number | null; recordsCount: number | null; maintenanceRunning: boolean }> {
    if (!this.initialized) {
      return {
        enabled: false,
        queuedSamples: this.queue.length,
        reason: process.env.ARCHIVE_STATUS_REASON ?? "Archive service is not initialized",
        dbSizeMb: null,
        recordsCount: null,
        maintenanceRunning: false,
      };
    }
    const stats = await this.repository.getStorageStats();
    return {
      enabled: true,
      queuedSamples: this.queue.length,
      reason: process.env.ARCHIVE_STATUS_REASON ?? "Archive service is initialized",
      dbSizeMb: stats.dbSizeMb,
      recordsCount: stats.recordsCount,
      maintenanceRunning: this.maintenanceRunning,
    };
  }

  public isEnabled(): boolean {
    return this.initialized;
  }

  public async getRuntimeSettings(): Promise<ArchiveRuntimeSettingsRow> {
    return this.repository.getRuntimeSettings();
  }

  public async updateRuntimeSettings(settings: {
    autoCleanupEnabled: boolean;
    maxDbSizeMb: number | null;
  }): Promise<ArchiveRuntimeSettingsRow> {
    const previous = await this.repository.getRuntimeSettings();
    const saved = await this.repository.updateRuntimeSettings(settings);
    if (shouldRunArchiveMaintenanceAfterSettingsUpdate(previous, saved)) {
      void this.runMaintenance().catch((error) => this.logger.error(`Archive maintenance failed: ${this.errorText(error)}`));
    }
    return saved;
  }

  public async previewArchiveDataPurge(): Promise<ArchivePurgePreviewRow> {
    return this.repository.previewArchiveDataPurge();
  }

  public async clearArchiveData(): Promise<ArchivePurgeResultRow> {
    return this.repository.clearArchiveData();
  }

  public async close(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }
    await this.flush().catch((error) => this.logger.error(`Archive final flush failed: ${this.errorText(error)}`));
    await this.repository.close();
    this.initialized = false;
  }

  private enqueue(value: TagValue): void {
    if (!this.repository.canArchive(value.name)) {
      return;
    }
    this.queue.push(value);
    if (this.queue.length >= this.batchSize) {
      void this.flush().catch((error) => this.logger.error(`Archive flush failed: ${this.errorText(error)}`));
    }
  }

  private enqueuePeriodicSnapshot(): void {
    const now = Date.now();
    if (now - this.lastSnapshotAt < this.snapshotIntervalMs) {
      return;
    }
    if (this.queue.length > this.batchSize * 10) {
      return;
    }
    this.lastSnapshotAt = now;
    const snapshots = this.tagStore.getSnapshots();
    for (const snapshot of snapshots) {
      if (!this.repository.canArchive(snapshot.definition.name)) {
        continue;
      }
      this.queue.push({
        name: snapshot.value.name,
        value: snapshot.value.value,
        quality: snapshot.value.quality,
        timestamp: now,
        source: snapshot.value.source,
      });
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) {
      return;
    }
    this.flushing = true;
    const batch = this.queue.splice(0, this.batchSize);
    try {
      await this.repository.insertSamples(batch);
    } finally {
      this.flushing = false;
    }
    if (this.queue.length >= this.batchSize) {
      void this.flush().catch((error) => this.logger.error(`Archive flush failed: ${this.errorText(error)}`));
    }
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
