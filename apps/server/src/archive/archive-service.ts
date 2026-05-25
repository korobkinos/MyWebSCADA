import type {
  DriverConfig,
  EventDefinition,
  EventArchiveCleanupMode,
  EventArchiveSettings,
  EventHistoryPage,
  EventHistoryQuery,
  EventOccurrence,
  EventOccurrenceState,
  OperatorActionArchiveSettings,
  OperatorActionHistoryPage,
  OperatorActionHistoryQuery,
  OperatorActionKind,
  OperatorActionRecord,
  OperatorActionResult,
  OperatorActionTargetType,
  TagDefinition,
  TagScalarValue,
  TagValue,
} from "@web-scada/shared";
import { TagStore } from "../tags/tag-store.js";
import {
  ArchiveRepository,
  type EventArchiveCleanupResultRow,
  type EventArchiveStatusRow,
  type OperatorActionArchiveCleanupResultRow,
  type OperatorActionArchiveStatusRow,
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
  maintenanceDeleteBatchSize?: number;
  maintenanceMaxTickMs?: number;
  maintenanceMaxDeleteTransactionMs?: number;
  defaultArchiveEnabled?: boolean;
};

type ArchiveMaintenanceState = "idle" | "scheduled" | "pruning" | "paused" | "cooling_down" | "compacting" | "error";

type ArchiveMaintenanceThresholds = {
  hysteresisMb: number;
  stopMarginMb: number;
  startThresholdMb: number | null;
  stopThresholdMb: number | null;
};

type ArchiveLoadGuardResult = {
  paused: boolean;
  reason?: string;
};

type MessageArchiveKind = "event" | "operator";

type NormalizedMessageArchiveSettings = {
  enabled: boolean;
  retentionDays: number;
  maxDatabaseSizeMb: number;
  cleanupMode: "byAge" | "bySize" | "byAgeAndSize";
  optimizeAfterCleanup: boolean;
  deleteBatchSize: number;
  maintenanceIntervalMs: number;
  maxMaintenanceTickMs: number;
  maxDeleteTransactionMs: number;
};

type MessageArchiveMaintenanceStateSnapshot = {
  status: ArchiveMaintenanceState;
  statusDetail: string | null;
  aggressivenessMode: "configured" | "fast_boost" | "emergency_boost";
  pruningActive: boolean;
  pauseReason: string | null;
  errorMessage: string | null;
  nextRunAt: number | null;
  dbSizeMb: number | null;
  recordsCount: number | null;
  oldestRecordAt: string | null;
  newestRecordAt: string | null;
  maxDatabaseSizeMb: number | null;
  startThresholdMb: number | null;
  stopThresholdMb: number | null;
  recordsDeletedInLastBatch: number;
  totalRecordsDeletedThisRun: number;
  lastBatchDurationMs: number;
  deletedRecordsPerSecond: number;
  deletedRecordsPerMinute: number;
  estimatedRemainingRecords: number | null;
  estimatedRemainingMb: number | null;
  cleanupProgressPercent: number | null;
  effectiveDeleteBatchSize: number;
  effectiveMaintenanceIntervalMs: number;
  effectiveMaxMaintenanceTickMs: number;
  effectiveMaxDeleteTransactionMs: number;
  lastRunAt: number | null;
};

const DEFAULT_MAINTENANCE_INTERVAL_MS = 3_000;
const DEFAULT_DELETE_BATCH_SIZE = 500;
const DEFAULT_MAX_MAINTENANCE_TICK_MS = 200;
const DEFAULT_MAX_DELETE_TRANSACTION_MS = 150;
const MIN_DELETE_BATCH_SIZE = 10;
const MAX_DELETE_BATCH_SIZE = 100_000;
const MIN_MAINTENANCE_INTERVAL_MS = 250;
const MAX_MAINTENANCE_INTERVAL_MS = 60_000;
const MIN_MAX_MAINTENANCE_TICK_MS = 50;
const MAX_MAX_MAINTENANCE_TICK_MS = 10_000;
const MIN_MAX_DELETE_TRANSACTION_MS = 50;
const MAX_MAX_DELETE_TRANSACTION_MS = 5_000;

type MaintenancePreset = {
  deleteBatchSize: number;
  maintenanceIntervalMs: number;
  maxMaintenanceTickMs: number;
  maxDeleteTransactionMs: number;
};

const MAINTENANCE_PRESETS: Record<"safe" | "balanced" | "fast" | "emergency", MaintenancePreset> = {
  safe: {
    deleteBatchSize: 10_000,
    maintenanceIntervalMs: 3_000,
    maxMaintenanceTickMs: 500,
    maxDeleteTransactionMs: 300,
  },
  balanced: {
    deleteBatchSize: 20_000,
    maintenanceIntervalMs: 1_500,
    maxMaintenanceTickMs: 1_500,
    maxDeleteTransactionMs: 800,
  },
  fast: {
    deleteBatchSize: 50_000,
    maintenanceIntervalMs: 750,
    maxMaintenanceTickMs: 3_000,
    maxDeleteTransactionMs: 1_500,
  },
  emergency: {
    deleteBatchSize: 100_000,
    maintenanceIntervalMs: 250,
    maxMaintenanceTickMs: 5_000,
    maxDeleteTransactionMs: 3_000,
  },
};

export function resolveArchiveMaintenanceThresholds(maxDbSizeMb: number | null | undefined): ArchiveMaintenanceThresholds {
  const max = typeof maxDbSizeMb === "number" && Number.isFinite(maxDbSizeMb) && maxDbSizeMb > 0
    ? maxDbSizeMb
    : 0;
  const hysteresisMb = Math.max(100, max * 0.10);
  const stopMarginMb = Math.max(50, max * 0.05);
  if (max <= 0) {
    return {
      hysteresisMb,
      stopMarginMb,
      startThresholdMb: null,
      stopThresholdMb: null,
    };
  }
  return {
    hysteresisMb,
    stopMarginMb,
    startThresholdMb: max + hysteresisMb,
    stopThresholdMb: Math.max(0, max - stopMarginMb),
  };
}

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
  private readonly defaultMaintenanceIntervalMs: number;
  private readonly defaultDeleteBatchSize: number;
  private readonly defaultMaxMaintenanceTickMs: number;
  private readonly defaultMaxDeleteTransactionMs: number;
  private readonly queue: TagValue[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private maintenanceTimer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private flushing = false;
  private maintenanceRunning = false;
  private maintenanceRequested = false;
  private maintenanceInterruptRequested = false;
  private initialized = false;
  private pruningActive = false;
  private maintenanceState: ArchiveMaintenanceState = "idle";
  private maintenancePauseReason: string | null = null;
  private maintenanceErrorMessage: string | null = null;
  private maintenanceStatusDetail: string | null = null;
  private maintenanceLastPruneReason: string | null = null;
  private maintenanceLastPruneError: string | null = null;
  private maintenanceLastRetentionDeleted = 0;
  private maintenanceLastSizeDeleted = 0;
  private maintenanceLastDeleteAttemptAt: number | null = null;
  private maintenanceEstimatedSamplesCount: number | null = null;
  private maintenanceActualSamplesCount: number | null = null;
  private maintenanceOldestSampleTime: string | null = null;
  private maintenanceNewestSampleTime: string | null = null;
  private maintenanceArchiveSamplesRelationSizeMb: number | null = null;
  private maintenanceArchiveSamplesTotalSizeMb: number | null = null;
  private maintenanceHypertableChunksCount: number | null = null;
  private maintenanceCompressedChunksCount: number | null = null;
  private maintenanceNextRunAt: number | null = null;
  private maintenanceDbSizeMb: number | null = null;
  private maintenanceRecordsTotal: number | null = null;
  private maintenanceMaxDbSizeMb: number | null = null;
  private maintenanceStartThresholdMb: number | null = null;
  private maintenanceStopThresholdMb: number | null = null;
  private maintenanceAggressivenessMode: "configured" | "fast_boost" | "emergency_boost" = "configured";
  private maintenanceEffectiveDeleteBatchSize = MAINTENANCE_PRESETS.safe.deleteBatchSize;
  private maintenanceEffectiveMaintenanceIntervalMs = MAINTENANCE_PRESETS.safe.maintenanceIntervalMs;
  private maintenanceEffectiveMaxMaintenanceTickMs = MAINTENANCE_PRESETS.safe.maxMaintenanceTickMs;
  private maintenanceEffectiveMaxDeleteTransactionMs = MAINTENANCE_PRESETS.safe.maxDeleteTransactionMs;
  private maintenanceDeletedRecordsPerSecond = 0;
  private maintenanceDeletedRecordsPerMinute = 0;
  private maintenanceEstimatedRemainingRecords: number | null = null;
  private maintenanceEstimatedRemainingMb: number | null = null;
  private maintenanceCleanupProgressPercent: number | null = null;
  private recordsDeletedInLastBatch = 0;
  private totalRecordsDeletedThisRun = 0;
  private lastBatchDurationMs = 0;
  private readonly snapshotIntervalMs = 1000;
  private lastSnapshotAt = 0;
  private operatorActionArchiveSettings: OperatorActionArchiveSettings = {
    enabled: true,
    retentionDays: 90,
    maxDatabaseSizeMb: 2048,
    cleanupMode: "byAgeAndSize",
    cleanupIntervalMinutes: 60,
    optimizeAfterCleanup: false,
    deleteBatchSize: DEFAULT_DELETE_BATCH_SIZE,
    maintenanceIntervalMs: DEFAULT_MAINTENANCE_INTERVAL_MS,
    maxMaintenanceTickMs: DEFAULT_MAX_MAINTENANCE_TICK_MS,
    maxDeleteTransactionMs: DEFAULT_MAX_DELETE_TRANSACTION_MS,
  };
  private readonly eventArchiveMaintenance: MessageArchiveMaintenanceStateSnapshot = {
    status: "scheduled",
    statusDetail: null,
    aggressivenessMode: "configured",
    pruningActive: false,
    pauseReason: null,
    errorMessage: null,
    nextRunAt: null,
    dbSizeMb: null,
    recordsCount: null,
    oldestRecordAt: null,
    newestRecordAt: null,
    maxDatabaseSizeMb: null,
    startThresholdMb: null,
    stopThresholdMb: null,
    recordsDeletedInLastBatch: 0,
    totalRecordsDeletedThisRun: 0,
    lastBatchDurationMs: 0,
    deletedRecordsPerSecond: 0,
    deletedRecordsPerMinute: 0,
    estimatedRemainingRecords: null,
    estimatedRemainingMb: null,
    cleanupProgressPercent: null,
    effectiveDeleteBatchSize: MAINTENANCE_PRESETS.safe.deleteBatchSize,
    effectiveMaintenanceIntervalMs: MAINTENANCE_PRESETS.safe.maintenanceIntervalMs,
    effectiveMaxMaintenanceTickMs: MAINTENANCE_PRESETS.safe.maxMaintenanceTickMs,
    effectiveMaxDeleteTransactionMs: MAINTENANCE_PRESETS.safe.maxDeleteTransactionMs,
    lastRunAt: null,
  };
  private readonly operatorArchiveMaintenance: MessageArchiveMaintenanceStateSnapshot = {
    status: "scheduled",
    statusDetail: null,
    aggressivenessMode: "configured",
    pruningActive: false,
    pauseReason: null,
    errorMessage: null,
    nextRunAt: null,
    dbSizeMb: null,
    recordsCount: null,
    oldestRecordAt: null,
    newestRecordAt: null,
    maxDatabaseSizeMb: null,
    startThresholdMb: null,
    stopThresholdMb: null,
    recordsDeletedInLastBatch: 0,
    totalRecordsDeletedThisRun: 0,
    lastBatchDurationMs: 0,
    deletedRecordsPerSecond: 0,
    deletedRecordsPerMinute: 0,
    estimatedRemainingRecords: null,
    estimatedRemainingMb: null,
    cleanupProgressPercent: null,
    effectiveDeleteBatchSize: MAINTENANCE_PRESETS.safe.deleteBatchSize,
    effectiveMaintenanceIntervalMs: MAINTENANCE_PRESETS.safe.maintenanceIntervalMs,
    effectiveMaxMaintenanceTickMs: MAINTENANCE_PRESETS.safe.maxMaintenanceTickMs,
    effectiveMaxDeleteTransactionMs: MAINTENANCE_PRESETS.safe.maxDeleteTransactionMs,
    lastRunAt: null,
  };

  public constructor(
    options: ArchiveServiceOptions,
    private readonly tagStore: TagStore,
    private readonly logger: ArchiveLogger,
  ) {
    this.defaultMaintenanceIntervalMs = this.normalizePositiveInteger(
      options.maintenanceIntervalMs,
      DEFAULT_MAINTENANCE_INTERVAL_MS,
    );
    this.defaultDeleteBatchSize = this.normalizePositiveInteger(
      options.maintenanceDeleteBatchSize,
      DEFAULT_DELETE_BATCH_SIZE,
    );
    this.defaultMaxMaintenanceTickMs = this.normalizePositiveInteger(
      options.maintenanceMaxTickMs,
      DEFAULT_MAX_MAINTENANCE_TICK_MS,
    );
    this.defaultMaxDeleteTransactionMs = this.normalizePositiveInteger(
      options.maintenanceMaxDeleteTransactionMs,
      DEFAULT_MAX_DELETE_TRANSACTION_MS,
    );

    this.repository = new ArchiveRepository(
      {
        connectionString: options.connectionString,
        maxPoolSize: options.maxPoolSize,
        defaultArchiveEnabled: options.defaultArchiveEnabled,
        defaultDeleteBatchSize: this.defaultDeleteBatchSize,
        defaultMaintenanceIntervalMs: this.defaultMaintenanceIntervalMs,
        defaultMaxMaintenanceTickMs: this.defaultMaxMaintenanceTickMs,
        defaultMaxDeleteTransactionMs: this.defaultMaxDeleteTransactionMs,
      },
      logger,
    );
    this.batchSize = options.batchSize ?? 500;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
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
        maintenanceIntervalMs: Number(process.env.ARCHIVE_MAINTENANCE_INTERVAL_MS ?? DEFAULT_MAINTENANCE_INTERVAL_MS),
        maintenanceDeleteBatchSize: Number(process.env.ARCHIVE_MAINTENANCE_DELETE_BATCH_SIZE ?? DEFAULT_DELETE_BATCH_SIZE),
        maintenanceMaxTickMs: Number(process.env.ARCHIVE_MAINTENANCE_MAX_TICK_MS ?? DEFAULT_MAX_MAINTENANCE_TICK_MS),
        maintenanceMaxDeleteTransactionMs: Number(process.env.ARCHIVE_MAINTENANCE_MAX_DELETE_TX_MS ?? DEFAULT_MAX_DELETE_TRANSACTION_MS),
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
    this.initialized = true;
    this.scheduleNextMaintenance(0, "scheduled");
  }

  public async syncMetadata(tags: TagDefinition[], drivers: DriverConfig[]): Promise<void> {
    await this.repository.syncMetadata(tags, drivers);
  }

  public async syncOnlineEventDefinitionSnapshots(definitions: EventDefinition[]): Promise<EventOccurrence[]> {
    return this.repository.syncOnlineEventDefinitionSnapshots(definitions);
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
    return {
      deletedSamples: await this.runMaintenanceCycle(true),
    };
  }

  public async getStatus(): Promise<{
    enabled: boolean;
    queuedSamples: number;
    reason: string;
    dbSizeMb: number | null;
    maxDbSizeMb: number | null;
    startThresholdMb: number | null;
    stopThresholdMb: number | null;
    recordsCount: number | null;
    recordsTotal: number | null;
    maintenanceRunning: boolean;
    status: ArchiveMaintenanceState;
    statusDetail?: string;
    lastPruneReason?: string;
    lastPruneError?: string;
    lastRetentionDeleted?: number;
    lastSizeDeleted?: number;
    lastDeleteAttemptAt?: string | null;
    estimatedSamplesCount?: number | null;
    actualSamplesCount?: number | null;
    oldestSampleTime?: string | null;
    newestSampleTime?: string | null;
    archiveSamplesRelationSizeMb?: number | null;
    archiveSamplesTotalSizeMb?: number | null;
    hypertableChunksCount?: number | null;
    compressedChunksCount?: number | null;
    aggressivenessMode?: "configured" | "fast_boost" | "emergency_boost";
    effectiveDeleteBatchSize?: number;
    effectiveMaintenanceIntervalMs?: number;
    effectiveMaxMaintenanceTickMs?: number;
    effectiveMaxDeleteTransactionMs?: number;
    deletedRecordsPerSecond?: number;
    deletedRecordsPerMinute?: number;
    estimatedRemainingRecords?: number | null;
    estimatedRemainingMb?: number | null;
    cleanupProgressPercent?: number | null;
    recordsDeletedInLastBatch: number;
    totalRecordsDeletedThisRun: number;
    lastBatchDurationMs: number;
    nextRunAt: string | null;
    pauseReason?: string;
  }> {
    if (!this.initialized) {
      return {
        enabled: false,
        queuedSamples: this.queue.length,
        reason: process.env.ARCHIVE_STATUS_REASON ?? "Archive service is not initialized",
        dbSizeMb: null,
        maxDbSizeMb: null,
        startThresholdMb: null,
        stopThresholdMb: null,
        recordsCount: null,
        recordsTotal: null,
        maintenanceRunning: false,
        status: "idle",
        statusDetail: undefined,
        lastPruneReason: undefined,
        lastPruneError: undefined,
        lastRetentionDeleted: 0,
        lastSizeDeleted: 0,
        lastDeleteAttemptAt: null,
        estimatedSamplesCount: null,
        actualSamplesCount: null,
        oldestSampleTime: null,
        newestSampleTime: null,
        archiveSamplesRelationSizeMb: null,
        archiveSamplesTotalSizeMb: null,
        hypertableChunksCount: null,
        compressedChunksCount: null,
        aggressivenessMode: "configured",
        effectiveDeleteBatchSize: MAINTENANCE_PRESETS.safe.deleteBatchSize,
        effectiveMaintenanceIntervalMs: MAINTENANCE_PRESETS.safe.maintenanceIntervalMs,
        effectiveMaxMaintenanceTickMs: MAINTENANCE_PRESETS.safe.maxMaintenanceTickMs,
        effectiveMaxDeleteTransactionMs: MAINTENANCE_PRESETS.safe.maxDeleteTransactionMs,
        deletedRecordsPerSecond: 0,
        deletedRecordsPerMinute: 0,
        estimatedRemainingRecords: null,
        estimatedRemainingMb: null,
        cleanupProgressPercent: null,
        recordsDeletedInLastBatch: 0,
        totalRecordsDeletedThisRun: 0,
        lastBatchDurationMs: 0,
        nextRunAt: null,
      };
    }

    if (this.maintenanceDbSizeMb === null || this.maintenanceRecordsTotal === null) {
      const stats = await this.repository.getStorageStats({ includeActualCount: true });
      this.maintenanceDbSizeMb = stats.dbSizeMb;
      this.maintenanceRecordsTotal = stats.recordsCount;
      this.maintenanceEstimatedSamplesCount = stats.estimatedSamplesCount;
      this.maintenanceActualSamplesCount = stats.actualSamplesCount;
      this.maintenanceOldestSampleTime = stats.oldestSampleTime;
      this.maintenanceNewestSampleTime = stats.newestSampleTime;
      this.maintenanceArchiveSamplesRelationSizeMb = stats.archiveSamplesRelationSizeMb;
      this.maintenanceArchiveSamplesTotalSizeMb = stats.archiveSamplesTotalSizeMb;
      this.maintenanceHypertableChunksCount = stats.hypertableChunksCount;
      this.maintenanceCompressedChunksCount = stats.compressedChunksCount;
    }

    return {
      enabled: true,
      queuedSamples: this.queue.length,
      reason: this.maintenanceErrorMessage
        ? `Archive maintenance error: ${this.maintenanceErrorMessage}`
        : process.env.ARCHIVE_STATUS_REASON ?? "Archive service is initialized",
      dbSizeMb: this.maintenanceDbSizeMb,
      maxDbSizeMb: this.maintenanceMaxDbSizeMb,
      startThresholdMb: this.maintenanceStartThresholdMb,
      stopThresholdMb: this.maintenanceStopThresholdMb,
      recordsCount: this.maintenanceRecordsTotal,
      recordsTotal: this.maintenanceRecordsTotal,
      maintenanceRunning: this.maintenanceState === "pruning" || this.maintenanceState === "compacting",
      status: this.maintenanceState,
      statusDetail: this.maintenanceStatusDetail ?? undefined,
      lastPruneReason: this.maintenanceLastPruneReason ?? undefined,
      lastPruneError: this.maintenanceLastPruneError ?? undefined,
      lastRetentionDeleted: this.maintenanceLastRetentionDeleted,
      lastSizeDeleted: this.maintenanceLastSizeDeleted,
      lastDeleteAttemptAt: this.maintenanceLastDeleteAttemptAt ? new Date(this.maintenanceLastDeleteAttemptAt).toISOString() : null,
      estimatedSamplesCount: this.maintenanceEstimatedSamplesCount,
      actualSamplesCount: this.maintenanceActualSamplesCount,
      oldestSampleTime: this.maintenanceOldestSampleTime,
      newestSampleTime: this.maintenanceNewestSampleTime,
      archiveSamplesRelationSizeMb: this.maintenanceArchiveSamplesRelationSizeMb,
      archiveSamplesTotalSizeMb: this.maintenanceArchiveSamplesTotalSizeMb,
      hypertableChunksCount: this.maintenanceHypertableChunksCount,
      compressedChunksCount: this.maintenanceCompressedChunksCount,
      aggressivenessMode: this.maintenanceAggressivenessMode,
      effectiveDeleteBatchSize: this.maintenanceEffectiveDeleteBatchSize,
      effectiveMaintenanceIntervalMs: this.maintenanceEffectiveMaintenanceIntervalMs,
      effectiveMaxMaintenanceTickMs: this.maintenanceEffectiveMaxMaintenanceTickMs,
      effectiveMaxDeleteTransactionMs: this.maintenanceEffectiveMaxDeleteTransactionMs,
      deletedRecordsPerSecond: this.maintenanceDeletedRecordsPerSecond,
      deletedRecordsPerMinute: this.maintenanceDeletedRecordsPerMinute,
      estimatedRemainingRecords: this.maintenanceEstimatedRemainingRecords,
      estimatedRemainingMb: this.maintenanceEstimatedRemainingMb,
      cleanupProgressPercent: this.maintenanceCleanupProgressPercent,
      recordsDeletedInLastBatch: this.recordsDeletedInLastBatch,
      totalRecordsDeletedThisRun: this.totalRecordsDeletedThisRun,
      lastBatchDurationMs: this.lastBatchDurationMs,
      nextRunAt: this.maintenanceNextRunAt ? new Date(this.maintenanceNextRunAt).toISOString() : null,
      pauseReason: this.maintenancePauseReason ?? undefined,
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
    deleteBatchSize?: number | null;
    maintenanceIntervalMs?: number | null;
    maxMaintenanceTickMs?: number | null;
    maxDeleteTransactionMs?: number | null;
  }): Promise<ArchiveRuntimeSettingsRow> {
    const previous = await this.repository.getRuntimeSettings();
    const boundedDeleteBatchSize = this.normalizeBoundedInteger(
      settings.deleteBatchSize ?? previous.deleteBatchSize,
      previous.deleteBatchSize,
      MIN_DELETE_BATCH_SIZE,
      MAX_DELETE_BATCH_SIZE,
    );
    const boundedMaintenanceIntervalMs = this.normalizeBoundedInteger(
      settings.maintenanceIntervalMs ?? previous.maintenanceIntervalMs,
      previous.maintenanceIntervalMs,
      MIN_MAINTENANCE_INTERVAL_MS,
      MAX_MAINTENANCE_INTERVAL_MS,
    );
    const boundedMaxDeleteTransactionMs = this.normalizeBoundedInteger(
      settings.maxDeleteTransactionMs ?? previous.maxDeleteTransactionMs,
      previous.maxDeleteTransactionMs,
      MIN_MAX_DELETE_TRANSACTION_MS,
      MAX_MAX_DELETE_TRANSACTION_MS,
    );
    const boundedMaxMaintenanceTickMsRaw = this.normalizeBoundedInteger(
      settings.maxMaintenanceTickMs ?? previous.maxMaintenanceTickMs,
      previous.maxMaintenanceTickMs,
      MIN_MAX_MAINTENANCE_TICK_MS,
      MAX_MAX_MAINTENANCE_TICK_MS,
    );
    const boundedMaxMaintenanceTickMs = Math.max(boundedMaxMaintenanceTickMsRaw, boundedMaxDeleteTransactionMs);

    const merged: ArchiveRuntimeSettingsRow = {
      ...previous,
      autoCleanupEnabled: settings.autoCleanupEnabled,
      maxDbSizeMb: settings.maxDbSizeMb,
      deleteBatchSize: boundedDeleteBatchSize,
      maintenanceIntervalMs: boundedMaintenanceIntervalMs,
      maxMaintenanceTickMs: boundedMaxMaintenanceTickMs,
      maxDeleteTransactionMs: boundedMaxDeleteTransactionMs,
    };
    const saved = await this.repository.updateRuntimeSettings({
      autoCleanupEnabled: merged.autoCleanupEnabled,
      maxDbSizeMb: merged.maxDbSizeMb,
      deleteBatchSize: merged.deleteBatchSize,
      maintenanceIntervalMs: merged.maintenanceIntervalMs,
      maxMaintenanceTickMs: merged.maxMaintenanceTickMs,
      maxDeleteTransactionMs: merged.maxDeleteTransactionMs,
    });

    this.maintenanceInterruptRequested = true;
    this.scheduleNextMaintenance(0, "scheduled");
    if (shouldRunArchiveMaintenanceAfterSettingsUpdate(previous, saved)) {
      void this.runMaintenanceCycle(false).catch((error) => this.logger.error(`Archive maintenance failed: ${this.errorText(error)}`));
    }
    return saved;
  }

  public async previewArchiveDataPurge(): Promise<ArchivePurgePreviewRow> {
    return this.repository.previewArchiveDataPurge();
  }

  public async clearArchiveData(): Promise<ArchivePurgeResultRow> {
    return this.repository.clearArchiveData();
  }

  public async listActiveEvents(limit?: number): Promise<EventOccurrence[]> {
    return this.repository.listActiveEventOccurrences(limit);
  }

  public async listOnlineEvents(
    limit?: number,
    includeClearedUnacknowledged = false,
  ): Promise<EventOccurrence[]> {
    return this.repository.listOnlineEventOccurrences(limit, includeClearedUnacknowledged);
  }

  public async createEventOccurrence(input: {
    eventDefinitionId: string;
    occurredAt: Date;
    clearedAt?: Date | null;
    acknowledgedAt?: Date | null;
    acknowledgedBy?: string | null;
    state: EventOccurrenceState;
    sourceTagNameSnapshot?: string | null;
    categoryIdSnapshot?: string | null;
    categoryNameSnapshot?: string | null;
    prioritySnapshot?: number | null;
    messageTextSnapshot?: string | null;
    valueAtTrigger?: TagScalarValue;
    valueAtClear?: TagScalarValue;
    quality?: string | null;
    runtimeSource?: string | null;
    serviceData?: Record<string, unknown> | null;
  }): Promise<EventOccurrence> {
    return this.repository.createEventOccurrence(input);
  }

  public async clearEventOccurrence(
    id: string | number,
    clearedAt: Date,
    valueAtClear?: TagScalarValue,
  ): Promise<EventOccurrence | null> {
    return this.repository.clearEventOccurrence(id, clearedAt, valueAtClear);
  }

  public async acknowledgeEventOccurrence(
    id: string | number,
    acknowledgedAt: Date,
    acknowledgedBy?: string | null,
  ): Promise<EventOccurrence | null> {
    return this.repository.acknowledgeEventOccurrence(id, acknowledgedAt, acknowledgedBy);
  }

  public async getEventOccurrencesByIds(ids: Array<string | number>): Promise<EventOccurrence[]> {
    return this.repository.getEventOccurrencesByIds(ids);
  }

  public async queryEventHistory(query: EventHistoryQuery): Promise<EventHistoryPage> {
    return this.repository.queryEventOccurrences(query);
  }

  public async getEventArchiveSettings(): Promise<EventArchiveSettings> {
    return this.repository.getEventArchiveSettings();
  }

  public async updateEventArchiveSettings(settings: EventArchiveSettings): Promise<EventArchiveSettings> {
    const saved = await this.repository.updateEventArchiveSettings(settings);
    this.scheduleNextMaintenance(0, "scheduled");
    return saved;
  }

  public async getEventArchiveStatus(): Promise<EventArchiveStatusRow> {
    const status = await this.repository.getEventArchiveStatus();
    const state = this.eventArchiveMaintenance;
    return {
      ...status,
      status: state.status,
      statusDetail: state.statusDetail ?? undefined,
      aggressivenessMode: state.aggressivenessMode,
      maxDatabaseSizeMb: state.maxDatabaseSizeMb,
      startThresholdMb: state.startThresholdMb,
      stopThresholdMb: state.stopThresholdMb,
      recordsDeletedInLastBatch: state.recordsDeletedInLastBatch,
      totalRecordsDeletedThisRun: state.totalRecordsDeletedThisRun,
      lastBatchDurationMs: state.lastBatchDurationMs,
      deletedRecordsPerSecond: state.deletedRecordsPerSecond,
      deletedRecordsPerMinute: state.deletedRecordsPerMinute,
      estimatedRemainingRecords: state.estimatedRemainingRecords,
      estimatedRemainingMb: state.estimatedRemainingMb,
      cleanupProgressPercent: state.cleanupProgressPercent,
      effectiveDeleteBatchSize: state.effectiveDeleteBatchSize,
      effectiveMaintenanceIntervalMs: state.effectiveMaintenanceIntervalMs,
      effectiveMaxMaintenanceTickMs: state.effectiveMaxMaintenanceTickMs,
      effectiveMaxDeleteTransactionMs: state.effectiveMaxDeleteTransactionMs,
      nextRunAt: state.nextRunAt ? new Date(state.nextRunAt).toISOString() : null,
      pauseReason: state.pauseReason ?? undefined,
      oldestRecordAt: state.oldestRecordAt ?? status.oldestRecordAt,
      newestRecordAt: state.newestRecordAt ?? status.newestRecordAt,
    };
  }

  public async cleanupEventArchive(options?: {
    retentionDays?: number;
    maxDatabaseSizeMb?: number;
    cleanupMode?: EventArchiveCleanupMode;
    optimizeAfterCleanup?: boolean;
  }): Promise<EventArchiveCleanupResultRow> {
    return this.repository.cleanupEventArchive(options);
  }

  public async optimizeEventArchive(): Promise<{ ok: boolean }> {
    await this.repository.optimizeEventArchive();
    return { ok: true };
  }

  public async createOperatorAction(input: {
    occurredAt?: string;
    userId?: string | null;
    username?: string | null;
    userRole?: string | null;
    ip?: string | null;
    screenId?: string | null;
    screenName?: string | null;
    objectId: string;
    objectName?: string | null;
    objectDescription?: string | null;
    objectType: string;
    actionKind: OperatorActionKind;
    targetType?: OperatorActionTargetType | null;
    targetName?: string | null;
    oldValue?: string | number | boolean | null;
    newValue?: string | number | boolean | null;
    unit?: string | null;
    messageTemplate?: string | null;
    messageText: string;
    result?: OperatorActionResult;
    errorText?: string | null;
    details?: Record<string, unknown> | null;
  }): Promise<OperatorActionRecord> {
    return this.repository.createOperatorAction(input);
  }

  public async queryOperatorActions(query: OperatorActionHistoryQuery): Promise<OperatorActionHistoryPage> {
    return this.repository.queryOperatorActions(query);
  }

  public setOperatorActionArchiveSettings(settings: OperatorActionArchiveSettings): void {
    this.operatorActionArchiveSettings = {
      ...settings,
      deleteBatchSize: this.normalizeBoundedInteger(
        settings.deleteBatchSize,
        DEFAULT_DELETE_BATCH_SIZE,
        MIN_DELETE_BATCH_SIZE,
        MAX_DELETE_BATCH_SIZE,
      ),
      maintenanceIntervalMs: this.normalizeBoundedInteger(
        settings.maintenanceIntervalMs,
        DEFAULT_MAINTENANCE_INTERVAL_MS,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      ),
      maxDeleteTransactionMs: this.normalizeBoundedInteger(
        settings.maxDeleteTransactionMs,
        DEFAULT_MAX_DELETE_TRANSACTION_MS,
        MIN_MAX_DELETE_TRANSACTION_MS,
        MAX_MAX_DELETE_TRANSACTION_MS,
      ),
      maxMaintenanceTickMs: Math.max(
        this.normalizeBoundedInteger(
          settings.maxMaintenanceTickMs,
          DEFAULT_MAX_MAINTENANCE_TICK_MS,
          MIN_MAX_MAINTENANCE_TICK_MS,
          MAX_MAX_MAINTENANCE_TICK_MS,
        ),
        this.normalizeBoundedInteger(
          settings.maxDeleteTransactionMs,
          DEFAULT_MAX_DELETE_TRANSACTION_MS,
          MIN_MAX_DELETE_TRANSACTION_MS,
          MAX_MAX_DELETE_TRANSACTION_MS,
        ),
      ),
    };
    this.scheduleNextMaintenance(0, "scheduled");
  }

  public async getOperatorActionArchiveStatus(settings?: OperatorActionArchiveSettings): Promise<OperatorActionArchiveStatusRow> {
    const status = await this.repository.getOperatorActionArchiveStatus(settings ?? this.operatorActionArchiveSettings);
    const state = this.operatorArchiveMaintenance;
    return {
      ...status,
      status: state.status,
      statusDetail: state.statusDetail ?? undefined,
      aggressivenessMode: state.aggressivenessMode,
      maxDatabaseSizeMb: state.maxDatabaseSizeMb,
      startThresholdMb: state.startThresholdMb,
      stopThresholdMb: state.stopThresholdMb,
      recordsDeletedInLastBatch: state.recordsDeletedInLastBatch,
      totalRecordsDeletedThisRun: state.totalRecordsDeletedThisRun,
      lastBatchDurationMs: state.lastBatchDurationMs,
      deletedRecordsPerSecond: state.deletedRecordsPerSecond,
      deletedRecordsPerMinute: state.deletedRecordsPerMinute,
      estimatedRemainingRecords: state.estimatedRemainingRecords,
      estimatedRemainingMb: state.estimatedRemainingMb,
      cleanupProgressPercent: state.cleanupProgressPercent,
      effectiveDeleteBatchSize: state.effectiveDeleteBatchSize,
      effectiveMaintenanceIntervalMs: state.effectiveMaintenanceIntervalMs,
      effectiveMaxMaintenanceTickMs: state.effectiveMaxMaintenanceTickMs,
      effectiveMaxDeleteTransactionMs: state.effectiveMaxDeleteTransactionMs,
      nextRunAt: state.nextRunAt ? new Date(state.nextRunAt).toISOString() : null,
      pauseReason: state.pauseReason ?? undefined,
      oldestRecordAt: state.oldestRecordAt ?? status.oldestRecordAt,
      newestRecordAt: state.newestRecordAt ?? status.newestRecordAt,
    };
  }

  public async cleanupOperatorActionArchive(options?: {
    enabled?: boolean;
    retentionDays?: number;
    maxDatabaseSizeMb?: number;
    cleanupMode?: OperatorActionArchiveSettings["cleanupMode"];
    optimizeAfterCleanup?: boolean;
    deleteBatchSize?: number;
    maintenanceIntervalMs?: number;
    maxMaintenanceTickMs?: number;
    maxDeleteTransactionMs?: number;
  }): Promise<OperatorActionArchiveCleanupResultRow> {
    return this.repository.cleanupOperatorActionArchive({
      ...this.operatorActionArchiveSettings,
      ...options,
    });
  }

  public async optimizeOperatorActionArchive(): Promise<{ ok: boolean }> {
    await this.repository.optimizeOperatorActionArchive();
    return { ok: true };
  }

  public async close(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.maintenanceTimer) {
      clearTimeout(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }
    this.maintenanceNextRunAt = null;
    this.maintenanceState = "idle";
    this.maintenanceStatusDetail = null;
    this.maintenanceLastPruneReason = null;
    this.maintenanceLastPruneError = null;
    this.maintenanceLastRetentionDeleted = 0;
    this.maintenanceLastSizeDeleted = 0;
    this.maintenanceLastDeleteAttemptAt = null;
    this.maintenanceEstimatedSamplesCount = null;
    this.maintenanceActualSamplesCount = null;
    this.maintenanceOldestSampleTime = null;
    this.maintenanceNewestSampleTime = null;
    this.maintenanceArchiveSamplesRelationSizeMb = null;
    this.maintenanceArchiveSamplesTotalSizeMb = null;
    this.maintenanceHypertableChunksCount = null;
    this.maintenanceCompressedChunksCount = null;
    this.maintenanceAggressivenessMode = "configured";
    this.maintenanceEffectiveDeleteBatchSize = MAINTENANCE_PRESETS.safe.deleteBatchSize;
    this.maintenanceEffectiveMaintenanceIntervalMs = MAINTENANCE_PRESETS.safe.maintenanceIntervalMs;
    this.maintenanceEffectiveMaxMaintenanceTickMs = MAINTENANCE_PRESETS.safe.maxMaintenanceTickMs;
    this.maintenanceEffectiveMaxDeleteTransactionMs = MAINTENANCE_PRESETS.safe.maxDeleteTransactionMs;
    this.maintenanceDeletedRecordsPerSecond = 0;
    this.maintenanceDeletedRecordsPerMinute = 0;
    this.maintenanceEstimatedRemainingRecords = null;
    this.maintenanceEstimatedRemainingMb = null;
    this.maintenanceCleanupProgressPercent = null;
    this.eventArchiveMaintenance.status = "idle";
    this.eventArchiveMaintenance.statusDetail = null;
    this.eventArchiveMaintenance.nextRunAt = null;
    this.operatorArchiveMaintenance.status = "idle";
    this.operatorArchiveMaintenance.statusDetail = null;
    this.operatorArchiveMaintenance.nextRunAt = null;
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

  private async runMaintenanceCycle(manual: boolean): Promise<number> {
    if (!this.initialized) {
      return 0;
    }
    if (this.maintenanceRunning) {
      this.maintenanceRequested = true;
      this.maintenanceInterruptRequested = true;
      return 0;
    }

    this.maintenanceRunning = true;
    this.maintenanceRequested = false;
    this.maintenanceInterruptRequested = false;

    let deletedInTick = 0;
    try {
      deletedInTick = await this.performMaintenanceTick();
      this.maintenanceErrorMessage = null;
    } catch (error) {
      const message = this.errorText(error);
      this.maintenanceErrorMessage = message;
      this.maintenanceState = "error";
      this.logger.error(`Archive maintenance failed: ${message}`);
    } finally {
      this.maintenanceRunning = false;
      if (!manual && this.initialized) {
        const interval = await this.resolveNextInterval().catch(() => this.defaultMaintenanceIntervalMs);
        const nextState = this.maintenanceState === "paused" || this.maintenanceState === "idle" || this.maintenanceState === "error"
          ? this.maintenanceState
          : this.pruningActive
            ? "cooling_down"
            : "scheduled";
        this.scheduleNextMaintenance(interval, nextState);
      }
      if (this.maintenanceRequested && this.initialized) {
        this.maintenanceRequested = false;
        void this.runMaintenanceCycle(false).catch((error) => this.logger.error(`Archive maintenance failed: ${this.errorText(error)}`));
      }
    }

    return deletedInTick;
  }

  private async performMaintenanceTick(): Promise<number> {
    await this.flush();
    const settings = await this.repository.getRuntimeSettings();
    const boundedDeleteBatchSize = this.normalizeBoundedInteger(
      settings.deleteBatchSize,
      this.defaultDeleteBatchSize,
      MIN_DELETE_BATCH_SIZE,
      MAX_DELETE_BATCH_SIZE,
    );
    const boundedMaintenanceIntervalMs = this.normalizeBoundedInteger(
      settings.maintenanceIntervalMs,
      this.defaultMaintenanceIntervalMs,
      MIN_MAINTENANCE_INTERVAL_MS,
      MAX_MAINTENANCE_INTERVAL_MS,
    );
    const boundedMaxDeleteTransactionMs = this.normalizeBoundedInteger(
      settings.maxDeleteTransactionMs,
      this.defaultMaxDeleteTransactionMs,
      MIN_MAX_DELETE_TRANSACTION_MS,
      MAX_MAX_DELETE_TRANSACTION_MS,
    );
    const boundedMaxMaintenanceTickMsRaw = this.normalizeBoundedInteger(
      settings.maxMaintenanceTickMs,
      this.defaultMaxMaintenanceTickMs,
      MIN_MAX_MAINTENANCE_TICK_MS,
      MAX_MAX_MAINTENANCE_TICK_MS,
    );
    const boundedMaxMaintenanceTickMs = Math.max(boundedMaxMaintenanceTickMsRaw, boundedMaxDeleteTransactionMs);

    const normalizedSettings = {
      ...settings,
      deleteBatchSize: boundedDeleteBatchSize,
      maintenanceIntervalMs: boundedMaintenanceIntervalMs,
      maxMaintenanceTickMs: boundedMaxMaintenanceTickMs,
      maxDeleteTransactionMs: boundedMaxDeleteTransactionMs,
    };
    const thresholds = resolveArchiveMaintenanceThresholds(normalizedSettings.maxDbSizeMb);
    const stats = await this.repository.getStorageStats({ includeActualCount: true });

    this.maintenanceDbSizeMb = stats.dbSizeMb;
    this.maintenanceRecordsTotal = stats.recordsCount;
    this.maintenanceEstimatedSamplesCount = stats.estimatedSamplesCount;
    this.maintenanceActualSamplesCount = stats.actualSamplesCount;
    this.maintenanceOldestSampleTime = stats.oldestSampleTime;
    this.maintenanceNewestSampleTime = stats.newestSampleTime;
    this.maintenanceArchiveSamplesRelationSizeMb = stats.archiveSamplesRelationSizeMb;
    this.maintenanceArchiveSamplesTotalSizeMb = stats.archiveSamplesTotalSizeMb;
    this.maintenanceHypertableChunksCount = stats.hypertableChunksCount;
    this.maintenanceCompressedChunksCount = stats.compressedChunksCount;
    this.maintenanceMaxDbSizeMb = normalizedSettings.maxDbSizeMb;
    this.maintenanceStartThresholdMb = thresholds.startThresholdMb;
    this.maintenanceStopThresholdMb = thresholds.stopThresholdMb;
    const effectiveSettings = this.resolveEffectiveMaintenanceSettings(
      normalizedSettings,
      stats.dbSizeMb,
      normalizedSettings.maxDbSizeMb,
    );
    this.maintenanceAggressivenessMode = effectiveSettings.mode;
    this.maintenanceEffectiveDeleteBatchSize = effectiveSettings.deleteBatchSize;
    this.maintenanceEffectiveMaintenanceIntervalMs = effectiveSettings.maintenanceIntervalMs;
    this.maintenanceEffectiveMaxMaintenanceTickMs = effectiveSettings.maxMaintenanceTickMs;
    this.maintenanceEffectiveMaxDeleteTransactionMs = effectiveSettings.maxDeleteTransactionMs;
    this.maintenanceEstimatedRemainingMb = this.computeEstimatedRemainingMb(stats.dbSizeMb, thresholds.stopThresholdMb);
    this.maintenanceEstimatedRemainingRecords = this.computeEstimatedRemainingRecords(
      this.maintenanceActualSamplesCount ?? this.maintenanceRecordsTotal,
      stats.dbSizeMb,
      thresholds.stopThresholdMb,
    );
    this.maintenanceCleanupProgressPercent = this.computeCleanupProgressPercent(
      stats.dbSizeMb,
      thresholds.startThresholdMb,
      thresholds.stopThresholdMb,
    );

    if (!normalizedSettings.autoCleanupEnabled || (normalizedSettings.maxDbSizeMb ?? 0) <= 0) {
      this.pruningActive = false;
      this.recordsDeletedInLastBatch = 0;
      this.totalRecordsDeletedThisRun = 0;
      this.lastBatchDurationMs = 0;
      this.maintenanceStatusDetail = null;
      this.maintenancePauseReason = null;
      this.maintenanceLastPruneReason = null;
      this.maintenanceLastPruneError = null;
      this.maintenanceLastRetentionDeleted = 0;
      this.maintenanceLastSizeDeleted = 0;
      this.maintenanceLastDeleteAttemptAt = null;
      this.maintenanceArchiveSamplesRelationSizeMb = stats.archiveSamplesRelationSizeMb;
      this.maintenanceArchiveSamplesTotalSizeMb = stats.archiveSamplesTotalSizeMb;
      this.maintenanceHypertableChunksCount = stats.hypertableChunksCount;
      this.maintenanceCompressedChunksCount = stats.compressedChunksCount;
      this.maintenanceDeletedRecordsPerSecond = 0;
      this.maintenanceDeletedRecordsPerMinute = 0;
      this.maintenanceState = "idle";
      await this.runMessageArchiveMaintenanceTick("event");
      await this.runMessageArchiveMaintenanceTick("operator");
      return 0;
    }

    const startThreshold = thresholds.startThresholdMb;
    const stopThreshold = thresholds.stopThresholdMb;

    if (startThreshold !== null && stopThreshold !== null) {
      if (!this.pruningActive && stats.dbSizeMb > startThreshold) {
        this.pruningActive = true;
        this.totalRecordsDeletedThisRun = 0;
      } else if (this.pruningActive && stats.dbSizeMb < stopThreshold) {
        this.pruningActive = false;
      }
    }

    if (!this.pruningActive) {
      this.recordsDeletedInLastBatch = 0;
      this.lastBatchDurationMs = 0;
      this.maintenanceStatusDetail = null;
      this.maintenancePauseReason = null;
      this.maintenanceLastPruneError = null;
      this.maintenanceLastPruneReason = null;
      this.maintenanceLastRetentionDeleted = 0;
      this.maintenanceLastSizeDeleted = 0;
      this.maintenanceArchiveSamplesRelationSizeMb = stats.archiveSamplesRelationSizeMb;
      this.maintenanceArchiveSamplesTotalSizeMb = stats.archiveSamplesTotalSizeMb;
      this.maintenanceHypertableChunksCount = stats.hypertableChunksCount;
      this.maintenanceCompressedChunksCount = stats.compressedChunksCount;
      this.maintenanceDeletedRecordsPerSecond = 0;
      this.maintenanceDeletedRecordsPerMinute = 0;
      this.maintenanceState = "scheduled";
      await this.runMessageArchiveMaintenanceTick("event");
      await this.runMessageArchiveMaintenanceTick("operator");
      return 0;
    }

    const deadline = Date.now() + effectiveSettings.maxMaintenanceTickMs;
    let totalDeletedInTick = 0;
    let currentDbSizeMb = stats.dbSizeMb;

    while (Date.now() < deadline) {
      if (this.maintenanceInterruptRequested) {
        this.maintenancePauseReason = "settings_changed";
        this.maintenanceStatusDetail = null;
        this.maintenanceState = "scheduled";
        break;
      }

      const loadGuard = this.loadGuard({ deleteBatchSize: effectiveSettings.deleteBatchSize });
      if (loadGuard.paused) {
        this.maintenancePauseReason = loadGuard.reason ?? "runtime_load_high";
        this.maintenanceStatusDetail = "waiting_due_to_load_guard";
        this.maintenanceLastPruneReason = this.maintenancePauseReason;
        this.maintenanceLastPruneError = null;
        this.maintenanceState = "paused";
        this.maintenanceDeletedRecordsPerSecond = 0;
        this.maintenanceDeletedRecordsPerMinute = 0;
        this.logTrendPruningTick({
          dbSizeMb: currentDbSizeMb,
          startThresholdMb: startThreshold,
          stopThresholdMb: stopThreshold,
          deleteBatchSize: effectiveSettings.deleteBatchSize,
          maxDeleteTransactionMs: effectiveSettings.maxDeleteTransactionMs,
          retentionDeleted: 0,
          sizeDeleted: 0,
          lastBatchDurationMs: this.lastBatchDurationMs,
          statusDetail: this.maintenanceStatusDetail,
        });
        break;
      }

      this.maintenancePauseReason = null;
      this.maintenanceState = "pruning";
      this.maintenanceStatusDetail = null;
      this.maintenanceLastPruneError = null;

      let deletedInBatch = 0;
      let batchDurationMs = 0;
      let deletedByRetention = 0;
      let deletedBySize = 0;

      try {
        this.maintenanceLastDeleteAttemptAt = Date.now();
        const retentionStart = Date.now();
        deletedByRetention = await this.repository.applyRetentionBatch(effectiveSettings.deleteBatchSize);
        if (deletedByRetention > 0) {
          deletedInBatch = deletedByRetention;
          batchDurationMs = Math.max(0, Date.now() - retentionStart);
          this.maintenanceStatusDetail = "pruning_by_retention";
          this.maintenanceLastPruneReason = "deleted expired samples by retention policy";
        } else {
          this.maintenanceStatusDetail = "no_expired_records";
          const sizeDeleteResult = await this.repository.deleteOldestSamplesBatch({
            limit: effectiveSettings.deleteBatchSize,
            maxTransactionMs: effectiveSettings.maxDeleteTransactionMs,
          });
          deletedBySize = sizeDeleteResult.deletedRecords;
          deletedInBatch = sizeDeleteResult.deletedRecords;
          batchDurationMs = sizeDeleteResult.durationMs;

          if (sizeDeleteResult.diagnostics) {
            this.maintenanceLastPruneReason = sizeDeleteResult.diagnostics.reason;
            this.maintenanceEstimatedSamplesCount = sizeDeleteResult.diagnostics.estimatedSamplesCount;
            this.maintenanceActualSamplesCount = sizeDeleteResult.diagnostics.actualSamplesCount;
            this.maintenanceOldestSampleTime = sizeDeleteResult.diagnostics.oldestTimeBeforeDelete;
            this.maintenanceNewestSampleTime = sizeDeleteResult.diagnostics.newestTimeBeforeDelete;
            this.maintenanceArchiveSamplesRelationSizeMb = sizeDeleteResult.diagnostics.archiveSamplesRelationSizeMb;
            this.maintenanceArchiveSamplesTotalSizeMb = sizeDeleteResult.diagnostics.archiveSamplesTotalSizeMb;
            this.maintenanceHypertableChunksCount = sizeDeleteResult.diagnostics.hypertableChunksCount;
            this.maintenanceCompressedChunksCount = sizeDeleteResult.diagnostics.compressedChunksCount;
            this.maintenanceLastDeleteAttemptAt = Date.parse(sizeDeleteResult.diagnostics.deleteAttemptAt);
          }

          if (sizeDeleteResult.errorMessage) {
            this.recordsDeletedInLastBatch = 0;
            this.lastBatchDurationMs = batchDurationMs;
            this.maintenanceDeletedRecordsPerSecond = 0;
            this.maintenanceDeletedRecordsPerMinute = 0;
            this.maintenanceLastRetentionDeleted = deletedByRetention;
            this.maintenanceLastSizeDeleted = deletedBySize;
            this.maintenanceLastPruneError = sizeDeleteResult.errorMessage;
            this.maintenanceStatusDetail = this.isStatementTimeoutError({
              code: sizeDeleteResult.errorCode,
              message: sizeDeleteResult.errorMessage,
            })
              ? "delete_timed_out"
              : "delete_failed";
            this.maintenanceLastPruneReason = this.maintenanceStatusDetail === "delete_timed_out"
              ? `size pruning timed out after ${effectiveSettings.maxDeleteTransactionMs} ms`
              : `size pruning delete failed (code=${sizeDeleteResult.errorCode ?? "unknown"})`;
            this.pruningActive = false;
            this.maintenanceState = this.maintenanceStatusDetail === "delete_timed_out" ? "paused" : "error";
            this.logTrendPruningTick({
              dbSizeMb: currentDbSizeMb,
              startThresholdMb: startThreshold,
              stopThresholdMb: stopThreshold,
              deleteBatchSize: effectiveSettings.deleteBatchSize,
              maxDeleteTransactionMs: effectiveSettings.maxDeleteTransactionMs,
              retentionDeleted: deletedByRetention,
              sizeDeleted: deletedBySize,
              lastBatchDurationMs: this.lastBatchDurationMs,
              statusDetail: this.maintenanceStatusDetail,
            });
            if (this.maintenanceStatusDetail === "delete_failed") {
              this.logger.error(`Trend archive size pruning failed: code=${sizeDeleteResult.errorCode ?? "-"} message=${sizeDeleteResult.errorMessage}`);
            } else {
              this.logger.warn(`Trend archive size pruning timed out: code=${sizeDeleteResult.errorCode ?? "-"} message=${sizeDeleteResult.errorMessage}`);
            }
            break;
          }

          if (deletedBySize > 0) {
            this.maintenanceStatusDetail = "pruning_by_size";
            this.maintenanceLastPruneReason = "deleted oldest samples due to size threshold";
          } else {
            const selectedRowsBeforeDelete = sizeDeleteResult.diagnostics?.selectedRowsBeforeDelete ?? 0;
            const compressedChunksCount = sizeDeleteResult.diagnostics?.compressedChunksCount ?? 0;
            const isHypertable = sizeDeleteResult.diagnostics?.isHypertable === true;
            if (isHypertable && compressedChunksCount > 0 && selectedRowsBeforeDelete === 0) {
              this.maintenanceStatusDetail = "timescale_chunk_cleanup_required";
              this.maintenanceLastPruneReason = "size is above threshold, no row candidates were selected, and compressed chunks exist";
            } else if (selectedRowsBeforeDelete > 0) {
              this.maintenanceStatusDetail = "delete_returned_zero";
              this.maintenanceLastPruneReason = this.maintenanceLastPruneReason
                ?? "size above threshold but DELETE returned 0";
            } else {
              this.maintenanceStatusDetail = "no_deletable_records";
              this.maintenanceLastPruneReason = this.maintenanceLastPruneReason
                ?? "size above threshold but no rows matched the delete batch";
            }
          }
        }
      } catch (error) {
        this.recordsDeletedInLastBatch = 0;
        this.lastBatchDurationMs = 0;
        this.maintenanceDeletedRecordsPerSecond = 0;
        this.maintenanceDeletedRecordsPerMinute = 0;
        this.maintenanceLastRetentionDeleted = deletedByRetention;
        this.maintenanceLastSizeDeleted = deletedBySize;
        this.maintenanceLastPruneError = this.errorText(error);
        this.maintenanceStatusDetail = this.isStatementTimeoutError(error) ? "delete_timed_out" : "delete_failed";
        this.maintenanceLastPruneReason = this.maintenanceStatusDetail === "delete_timed_out"
          ? `size pruning timed out after ${effectiveSettings.maxDeleteTransactionMs} ms`
          : "size pruning delete failed";
        this.pruningActive = false;
        this.maintenanceState = this.maintenanceStatusDetail === "delete_timed_out" ? "paused" : "error";
        this.logTrendPruningTick({
          dbSizeMb: currentDbSizeMb,
          startThresholdMb: startThreshold,
          stopThresholdMb: stopThreshold,
          deleteBatchSize: effectiveSettings.deleteBatchSize,
          maxDeleteTransactionMs: effectiveSettings.maxDeleteTransactionMs,
          retentionDeleted: deletedByRetention,
          sizeDeleted: deletedBySize,
          lastBatchDurationMs: this.lastBatchDurationMs,
          statusDetail: this.maintenanceStatusDetail,
        });
        if (this.maintenanceStatusDetail === "delete_failed") {
          this.logger.error(`Trend archive size pruning failed: error=${this.maintenanceLastPruneError} dbSizeMb=${currentDbSizeMb.toFixed(2)} batch=${effectiveSettings.deleteBatchSize} timeoutMs=${effectiveSettings.maxDeleteTransactionMs}`);
        } else {
          this.logger.warn(`Trend archive size pruning timed out: error=${this.maintenanceLastPruneError} dbSizeMb=${currentDbSizeMb.toFixed(2)} batch=${effectiveSettings.deleteBatchSize} timeoutMs=${effectiveSettings.maxDeleteTransactionMs}`);
        }
        break;
      }

      this.recordsDeletedInLastBatch = deletedInBatch;
      this.lastBatchDurationMs = batchDurationMs;
      this.maintenanceDeletedRecordsPerSecond = this.computeDeletedRecordsPerSecond(deletedInBatch, batchDurationMs);
      this.maintenanceDeletedRecordsPerMinute = this.maintenanceDeletedRecordsPerSecond * 60;
      this.maintenanceLastRetentionDeleted = deletedByRetention;
      this.maintenanceLastSizeDeleted = deletedBySize;
      totalDeletedInTick += deletedInBatch;
      this.totalRecordsDeletedThisRun += deletedInBatch;

      const previousDbSizeMb = currentDbSizeMb;
      const refreshedStats = await this.repository.getStorageStats({ includeActualCount: false });
      this.maintenanceDbSizeMb = refreshedStats.dbSizeMb;
      this.maintenanceRecordsTotal = refreshedStats.recordsCount;
      this.maintenanceEstimatedSamplesCount = refreshedStats.estimatedSamplesCount;
      if (refreshedStats.actualSamplesCount !== null) {
        this.maintenanceActualSamplesCount = refreshedStats.actualSamplesCount;
      }
      this.maintenanceOldestSampleTime = refreshedStats.oldestSampleTime;
      this.maintenanceNewestSampleTime = refreshedStats.newestSampleTime;
      this.maintenanceArchiveSamplesRelationSizeMb = refreshedStats.archiveSamplesRelationSizeMb;
      this.maintenanceArchiveSamplesTotalSizeMb = refreshedStats.archiveSamplesTotalSizeMb;
      this.maintenanceHypertableChunksCount = refreshedStats.hypertableChunksCount;
      this.maintenanceCompressedChunksCount = refreshedStats.compressedChunksCount;
      currentDbSizeMb = refreshedStats.dbSizeMb;
      this.maintenanceEstimatedRemainingMb = this.computeEstimatedRemainingMb(currentDbSizeMb, stopThreshold);
      this.maintenanceEstimatedRemainingRecords = this.computeEstimatedRemainingRecords(
        this.maintenanceActualSamplesCount ?? this.maintenanceRecordsTotal,
        currentDbSizeMb,
        stopThreshold,
      );
      this.maintenanceCleanupProgressPercent = this.computeCleanupProgressPercent(
        currentDbSizeMb,
        startThreshold,
        stopThreshold,
      );
      if (deletedBySize > 0 && currentDbSizeMb >= previousDbSizeMb - 0.25) {
        this.maintenanceLastPruneReason = "rows deleted; physical size may lag until PostgreSQL reuses or compacts free pages";
      }

      this.logTrendPruningTick({
        dbSizeMb: currentDbSizeMb,
        startThresholdMb: startThreshold,
        stopThresholdMb: stopThreshold,
        deleteBatchSize: effectiveSettings.deleteBatchSize,
        maxDeleteTransactionMs: effectiveSettings.maxDeleteTransactionMs,
        retentionDeleted: deletedByRetention,
        sizeDeleted: deletedBySize,
        lastBatchDurationMs: batchDurationMs,
        statusDetail: this.maintenanceStatusDetail,
      });

      if (stopThreshold !== null && currentDbSizeMb < stopThreshold) {
        this.pruningActive = false;
        this.maintenanceState = "scheduled";
        break;
      }

      if (deletedInBatch === 0) {
        this.pruningActive = false;
        this.maintenanceState = "paused";
        if (!this.maintenanceStatusDetail) {
          this.maintenanceStatusDetail = "no_deletable_records";
        }
        this.maintenanceDeletedRecordsPerSecond = 0;
        this.maintenanceDeletedRecordsPerMinute = 0;
        this.maintenanceLastPruneReason = this.maintenanceLastPruneReason ?? "size above threshold but DELETE returned 0";
        break;
      }

      if (Date.now() >= deadline) {
        this.maintenanceState = "cooling_down";
        break;
      }

      await this.sleep(this.pauseBetweenBatchesMs(effectiveSettings.maintenanceIntervalMs));
    }

    if (this.pruningActive && this.maintenanceState === "pruning") {
      this.maintenanceState = "cooling_down";
    }
    if (this.pruningActive && stopThreshold !== null && currentDbSizeMb < stopThreshold) {
      this.pruningActive = false;
    }
    if (this.maintenanceState !== "pruning"
      && this.maintenanceState !== "cooling_down"
      && this.maintenanceState !== "paused"
      && this.maintenanceState !== "error"
      && this.recordsDeletedInLastBatch === 0) {
      this.maintenanceStatusDetail = null;
    }

    await this.runMessageArchiveMaintenanceTick("event");
    await this.runMessageArchiveMaintenanceTick("operator");

    return totalDeletedInTick;
  }

  private loadGuard(settings: Pick<ArchiveRuntimeSettingsRow, "deleteBatchSize">): ArchiveLoadGuardResult {
    const activeTrendQueries = this.repository.getActiveTrendQueries();
    if (activeTrendQueries > 0) {
      return {
        paused: true,
        reason: `trend_queries_active:${activeTrendQueries}`,
      };
    }
    const activeEventQueries = this.repository.getActiveEventQueries();
    if (activeEventQueries > 0) {
      return {
        paused: true,
        reason: `event_queries_active:${activeEventQueries}`,
      };
    }
    const activeOperatorActionQueries = this.repository.getActiveOperatorActionQueries();
    if (activeOperatorActionQueries > 0) {
      return {
        paused: true,
        reason: `operator_action_queries_active:${activeOperatorActionQueries}`,
      };
    }
    const activeOperatorActionWrites = this.repository.getActiveOperatorActionWrites();
    if (activeOperatorActionWrites > 0) {
      return {
        paused: true,
        reason: `operator_action_writes_active:${activeOperatorActionWrites}`,
      };
    }
    const runtimeLoadThreshold = Math.max(this.batchSize * 8, settings.deleteBatchSize * 4);
    if (this.queue.length >= runtimeLoadThreshold) {
      return {
        paused: true,
        reason: `runtime_load_high:queue_${this.queue.length}`,
      };
    }
    const writeQueueThreshold = Math.max(this.batchSize * 4, settings.deleteBatchSize * 2);
    if (this.flushing || this.queue.length >= writeQueueThreshold) {
      return {
        paused: true,
        reason: this.flushing ? "archive_flush_in_progress" : `write_queue_high:${this.queue.length}`,
      };
    }
    return { paused: false };
  }

  private maintenanceStateFor(kind: MessageArchiveKind): MessageArchiveMaintenanceStateSnapshot {
    return kind === "event" ? this.eventArchiveMaintenance : this.operatorArchiveMaintenance;
  }

  private async runMessageArchiveMaintenanceTick(kind: MessageArchiveKind): Promise<number> {
    const state = this.maintenanceStateFor(kind);
    const settings = kind === "event"
      ? this.normalizeMessageArchiveSettings(await this.repository.getEventArchiveSettings())
      : this.normalizeMessageArchiveSettings(this.operatorActionArchiveSettings);
    const status = kind === "event"
      ? await this.repository.getEventArchiveStatus()
      : await this.repository.getOperatorActionArchiveStatus(this.operatorActionArchiveSettings);

    state.dbSizeMb = status.dbSizeMb;
    state.recordsCount = status.recordsCount;
    state.oldestRecordAt = status.oldestRecordAt;
    state.newestRecordAt = status.newestRecordAt;
    state.maxDatabaseSizeMb = settings.maxDatabaseSizeMb;
    const now = Date.now();

    if (!settings.enabled || settings.maxDatabaseSizeMb <= 0) {
      state.lastRunAt = now;
      state.nextRunAt = state.lastRunAt + settings.maintenanceIntervalMs;
      state.pruningActive = false;
      state.status = "idle";
      state.statusDetail = null;
      state.aggressivenessMode = "configured";
      state.pauseReason = null;
      state.recordsDeletedInLastBatch = 0;
      state.totalRecordsDeletedThisRun = 0;
      state.lastBatchDurationMs = 0;
      state.deletedRecordsPerSecond = 0;
      state.deletedRecordsPerMinute = 0;
      state.estimatedRemainingRecords = null;
      state.estimatedRemainingMb = null;
      state.cleanupProgressPercent = null;
      state.effectiveDeleteBatchSize = settings.deleteBatchSize;
      state.effectiveMaintenanceIntervalMs = settings.maintenanceIntervalMs;
      state.effectiveMaxMaintenanceTickMs = settings.maxMaintenanceTickMs;
      state.effectiveMaxDeleteTransactionMs = settings.maxDeleteTransactionMs;
      state.startThresholdMb = null;
      state.stopThresholdMb = null;
      return 0;
    }

    const thresholds = resolveArchiveMaintenanceThresholds(settings.maxDatabaseSizeMb);
    state.startThresholdMb = thresholds.startThresholdMb;
    state.stopThresholdMb = thresholds.stopThresholdMb;
    const effectiveSettings = this.resolveEffectiveMaintenanceSettings(
      settings,
      status.dbSizeMb,
      settings.maxDatabaseSizeMb,
    );
    state.aggressivenessMode = effectiveSettings.mode;
    state.effectiveDeleteBatchSize = effectiveSettings.deleteBatchSize;
    state.effectiveMaintenanceIntervalMs = effectiveSettings.maintenanceIntervalMs;
    state.effectiveMaxMaintenanceTickMs = effectiveSettings.maxMaintenanceTickMs;
    state.effectiveMaxDeleteTransactionMs = effectiveSettings.maxDeleteTransactionMs;
    state.estimatedRemainingMb = this.computeEstimatedRemainingMb(status.dbSizeMb, state.stopThresholdMb);
    state.estimatedRemainingRecords = this.computeEstimatedRemainingRecords(
      status.recordsCount,
      status.dbSizeMb,
      state.stopThresholdMb,
    );
    state.cleanupProgressPercent = this.computeCleanupProgressPercent(
      status.dbSizeMb,
      state.startThresholdMb,
      state.stopThresholdMb,
    );
    if (state.lastRunAt !== null && (now - state.lastRunAt) < effectiveSettings.maintenanceIntervalMs) {
      state.nextRunAt = state.lastRunAt + effectiveSettings.maintenanceIntervalMs;
      return 0;
    }
    state.lastRunAt = now;
    state.nextRunAt = state.lastRunAt + effectiveSettings.maintenanceIntervalMs;

    const ageEnabled = settings.cleanupMode === "byAge" || settings.cleanupMode === "byAgeAndSize";
    const sizeEnabled = settings.cleanupMode === "bySize" || settings.cleanupMode === "byAgeAndSize";

    if (sizeEnabled) {
      if (!state.pruningActive && thresholds.startThresholdMb !== null && status.dbSizeMb > thresholds.startThresholdMb) {
        state.pruningActive = true;
        state.totalRecordsDeletedThisRun = 0;
      } else if (state.pruningActive && thresholds.stopThresholdMb !== null && status.dbSizeMb < thresholds.stopThresholdMb) {
        state.pruningActive = false;
      }
    } else {
      state.pruningActive = false;
    }

    if (!ageEnabled && !state.pruningActive) {
      state.status = "scheduled";
      state.statusDetail = null;
      state.pauseReason = null;
      state.recordsDeletedInLastBatch = 0;
      state.lastBatchDurationMs = 0;
      state.deletedRecordsPerSecond = 0;
      state.deletedRecordsPerMinute = 0;
      return 0;
    }

    const loadGuard = this.loadGuard({ deleteBatchSize: effectiveSettings.deleteBatchSize });
    if (loadGuard.paused) {
      state.status = "paused";
      state.statusDetail = null;
      state.pauseReason = loadGuard.reason ?? "runtime_load_high";
      state.recordsDeletedInLastBatch = 0;
      state.lastBatchDurationMs = 0;
      state.deletedRecordsPerSecond = 0;
      state.deletedRecordsPerMinute = 0;
      return 0;
    }

    state.status = "pruning";
    state.statusDetail = null;
    state.pauseReason = null;

    const deadline = Date.now() + effectiveSettings.maxMaintenanceTickMs;
    let deletedTotal = 0;
    while (Date.now() < deadline) {
      let batchResult: { deletedRecords: number; durationMs: number } = { deletedRecords: 0, durationMs: 0 };
      let workReason: "pruning_by_age" | "pruning_by_size" | null = null;

      if (ageEnabled) {
        const byAge = kind === "event"
          ? await this.repository.deleteEventOccurrencesByRetentionBatch({
            retentionDays: settings.retentionDays,
            limit: effectiveSettings.deleteBatchSize,
            maxTransactionMs: effectiveSettings.maxDeleteTransactionMs,
          })
          : await this.repository.deleteOperatorActionsByRetentionBatch({
            retentionDays: settings.retentionDays,
            limit: effectiveSettings.deleteBatchSize,
            maxTransactionMs: effectiveSettings.maxDeleteTransactionMs,
          });
        if (byAge.deletedRecords > 0) {
          batchResult = byAge;
          workReason = "pruning_by_age";
        }
      }

      if (workReason === null && sizeEnabled && state.pruningActive) {
        const bySize = kind === "event"
          ? await this.repository.deleteOldestEventOccurrencesBatch({
            limit: effectiveSettings.deleteBatchSize,
            maxTransactionMs: effectiveSettings.maxDeleteTransactionMs,
          })
          : await this.repository.deleteOldestOperatorActionsBatch({
            limit: effectiveSettings.deleteBatchSize,
            maxTransactionMs: effectiveSettings.maxDeleteTransactionMs,
          });
        batchResult = bySize;
        if (bySize.deletedRecords > 0) {
          workReason = "pruning_by_size";
        }
      }

      state.recordsDeletedInLastBatch = batchResult.deletedRecords;
      state.lastBatchDurationMs = batchResult.durationMs;
      state.deletedRecordsPerSecond = this.computeDeletedRecordsPerSecond(batchResult.deletedRecords, batchResult.durationMs);
      state.deletedRecordsPerMinute = state.deletedRecordsPerSecond * 60;
      state.totalRecordsDeletedThisRun += batchResult.deletedRecords;
      deletedTotal += batchResult.deletedRecords;
      state.statusDetail = workReason;

      const refreshedStatus = kind === "event"
        ? await this.repository.getEventArchiveStatus()
        : await this.repository.getOperatorActionArchiveStatus(this.operatorActionArchiveSettings);
      state.dbSizeMb = refreshedStatus.dbSizeMb;
      state.recordsCount = refreshedStatus.recordsCount;
      state.oldestRecordAt = refreshedStatus.oldestRecordAt;
      state.newestRecordAt = refreshedStatus.newestRecordAt;
      state.estimatedRemainingMb = this.computeEstimatedRemainingMb(refreshedStatus.dbSizeMb, state.stopThresholdMb);
      state.estimatedRemainingRecords = this.computeEstimatedRemainingRecords(
        refreshedStatus.recordsCount,
        refreshedStatus.dbSizeMb,
        state.stopThresholdMb,
      );
      state.cleanupProgressPercent = this.computeCleanupProgressPercent(
        refreshedStatus.dbSizeMb,
        state.startThresholdMb,
        state.stopThresholdMb,
      );

      if (sizeEnabled) {
        if (!state.pruningActive && state.startThresholdMb !== null && refreshedStatus.dbSizeMb > state.startThresholdMb) {
          state.pruningActive = true;
        } else if (state.pruningActive && state.stopThresholdMb !== null && refreshedStatus.dbSizeMb < state.stopThresholdMb) {
          state.pruningActive = false;
        }
      }

      if (batchResult.deletedRecords === 0) {
        state.pruningActive = false;
        state.status = "scheduled";
        state.statusDetail = null;
        state.pauseReason = null;
        state.deletedRecordsPerSecond = 0;
        state.deletedRecordsPerMinute = 0;
        break;
      }
      if (Date.now() >= deadline) {
        state.status = "cooling_down";
        break;
      }
      await this.sleep(this.pauseBetweenBatchesMs(effectiveSettings.maintenanceIntervalMs));
    }

    if (state.pruningActive && state.status === "pruning") {
      state.status = "cooling_down";
    }
    if (state.status !== "pruning" && state.status !== "cooling_down") {
      state.statusDetail = null;
      state.pauseReason = null;
    }
    return deletedTotal;
  }

  private resolveEffectiveMaintenanceSettings(
    settings: {
      deleteBatchSize: number;
      maintenanceIntervalMs: number;
      maxMaintenanceTickMs: number;
      maxDeleteTransactionMs: number;
    },
    dbSizeMb: number,
    maxDbSizeMb: number | null | undefined,
  ): MaintenancePreset & { mode: "configured" | "fast_boost" | "emergency_boost" } {
    const maxDb = typeof maxDbSizeMb === "number" && Number.isFinite(maxDbSizeMb) ? maxDbSizeMb : 0;
    let mode: "configured" | "fast_boost" | "emergency_boost" = "configured";
    let base: MaintenancePreset = {
      deleteBatchSize: settings.deleteBatchSize,
      maintenanceIntervalMs: settings.maintenanceIntervalMs,
      maxMaintenanceTickMs: settings.maxMaintenanceTickMs,
      maxDeleteTransactionMs: settings.maxDeleteTransactionMs,
    };

    if (maxDb > 0 && dbSizeMb > maxDb * 1.5) {
      mode = "emergency_boost";
      base = MAINTENANCE_PRESETS.emergency;
    } else if (maxDb > 0 && dbSizeMb > maxDb * 1.25) {
      mode = "fast_boost";
      base = MAINTENANCE_PRESETS.fast;
    }

    const deleteBatchSize = this.normalizeBoundedInteger(
      base.deleteBatchSize,
      settings.deleteBatchSize,
      MIN_DELETE_BATCH_SIZE,
      MAX_DELETE_BATCH_SIZE,
    );
    const maintenanceIntervalMs = this.normalizeBoundedInteger(
      base.maintenanceIntervalMs,
      settings.maintenanceIntervalMs,
      MIN_MAINTENANCE_INTERVAL_MS,
      MAX_MAINTENANCE_INTERVAL_MS,
    );
    const maxDeleteTransactionMs = this.normalizeBoundedInteger(
      base.maxDeleteTransactionMs,
      settings.maxDeleteTransactionMs,
      MIN_MAX_DELETE_TRANSACTION_MS,
      MAX_MAX_DELETE_TRANSACTION_MS,
    );
    const maxMaintenanceTickMs = Math.max(
      this.normalizeBoundedInteger(
        base.maxMaintenanceTickMs,
        settings.maxMaintenanceTickMs,
        MIN_MAX_MAINTENANCE_TICK_MS,
        MAX_MAX_MAINTENANCE_TICK_MS,
      ),
      maxDeleteTransactionMs,
    );
    return {
      mode,
      deleteBatchSize,
      maintenanceIntervalMs,
      maxMaintenanceTickMs,
      maxDeleteTransactionMs,
    };
  }

  private computeDeletedRecordsPerSecond(deletedRecords: number, durationMs: number): number {
    const deleted = Number.isFinite(deletedRecords) ? Math.max(0, deletedRecords) : 0;
    const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    if (deleted <= 0 || duration <= 0) {
      return 0;
    }
    return deleted / (duration / 1000);
  }

  private computeEstimatedRemainingMb(dbSizeMb: number | null | undefined, stopThresholdMb: number | null | undefined): number | null {
    if (typeof dbSizeMb !== "number" || !Number.isFinite(dbSizeMb)) {
      return null;
    }
    if (typeof stopThresholdMb !== "number" || !Number.isFinite(stopThresholdMb)) {
      return null;
    }
    return Math.max(0, dbSizeMb - stopThresholdMb);
  }

  private computeEstimatedRemainingRecords(
    recordsCount: number | null | undefined,
    dbSizeMb: number | null | undefined,
    stopThresholdMb: number | null | undefined,
  ): number | null {
    if (typeof recordsCount !== "number" || !Number.isFinite(recordsCount) || recordsCount <= 0) {
      return null;
    }
    if (typeof dbSizeMb !== "number" || !Number.isFinite(dbSizeMb) || dbSizeMb <= 0) {
      return null;
    }
    if (typeof stopThresholdMb !== "number" || !Number.isFinite(stopThresholdMb)) {
      return null;
    }
    if (dbSizeMb <= stopThresholdMb) {
      return 0;
    }
    const estimated = recordsCount * ((dbSizeMb - stopThresholdMb) / dbSizeMb);
    return Number.isFinite(estimated) ? Math.max(0, Math.round(estimated)) : null;
  }

  private computeCleanupProgressPercent(
    dbSizeMb: number | null | undefined,
    startThresholdMb: number | null | undefined,
    stopThresholdMb: number | null | undefined,
  ): number | null {
    if (typeof dbSizeMb !== "number" || !Number.isFinite(dbSizeMb)) {
      return null;
    }
    if (typeof startThresholdMb !== "number" || !Number.isFinite(startThresholdMb)) {
      return null;
    }
    if (typeof stopThresholdMb !== "number" || !Number.isFinite(stopThresholdMb)) {
      return null;
    }
    if (startThresholdMb <= stopThresholdMb) {
      return dbSizeMb <= stopThresholdMb ? 100 : 0;
    }
    if (dbSizeMb >= startThresholdMb) {
      return 0;
    }
    if (dbSizeMb <= stopThresholdMb) {
      return 100;
    }
    const span = startThresholdMb - stopThresholdMb;
    const progress = ((startThresholdMb - dbSizeMb) / span) * 100;
    return Math.max(0, Math.min(100, progress));
  }

  private scheduleNextMaintenance(delayMs: number, state: ArchiveMaintenanceState): void {
    if (!this.initialized) {
      return;
    }
    if (this.maintenanceTimer) {
      clearTimeout(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }
    const safeDelay = Math.max(0, Math.round(delayMs));
    this.maintenanceNextRunAt = Date.now() + safeDelay;
    if (!this.maintenanceRunning) {
      this.maintenanceState = state;
    }
    this.maintenanceTimer = setTimeout(() => {
      this.maintenanceTimer = undefined;
      void this.runMaintenanceCycle(false).catch((error) => this.logger.error(`Archive maintenance failed: ${this.errorText(error)}`));
    }, safeDelay);
  }

  private async resolveNextInterval(): Promise<number> {
    try {
      const settings = await this.repository.getRuntimeSettings();
      const trendInterval = this.normalizeBoundedInteger(
        settings.maintenanceIntervalMs,
        this.defaultMaintenanceIntervalMs,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      );
      const eventSettings = await this.repository.getEventArchiveSettings();
      const eventInterval = this.normalizeBoundedInteger(
        eventSettings.maintenanceIntervalMs,
        this.defaultMaintenanceIntervalMs,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      );
      const operatorInterval = this.normalizeBoundedInteger(
        this.operatorActionArchiveSettings.maintenanceIntervalMs,
        this.defaultMaintenanceIntervalMs,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      );
      const effectiveTrendInterval = this.normalizeBoundedInteger(
        this.maintenanceEffectiveMaintenanceIntervalMs,
        trendInterval,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      );
      const effectiveEventInterval = this.normalizeBoundedInteger(
        this.eventArchiveMaintenance.effectiveMaintenanceIntervalMs,
        eventInterval,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      );
      const effectiveOperatorInterval = this.normalizeBoundedInteger(
        this.operatorArchiveMaintenance.effectiveMaintenanceIntervalMs,
        operatorInterval,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      );
      return Math.max(250, Math.min(
        trendInterval,
        eventInterval,
        operatorInterval,
        effectiveTrendInterval,
        effectiveEventInterval,
        effectiveOperatorInterval,
      ));
    } catch {
      return this.defaultMaintenanceIntervalMs;
    }
  }

  private normalizeMessageArchiveSettings(settings: EventArchiveSettings | OperatorActionArchiveSettings): NormalizedMessageArchiveSettings {
    const maxDeleteTransactionMs = this.normalizeBoundedInteger(
      settings.maxDeleteTransactionMs,
      this.defaultMaxDeleteTransactionMs,
      MIN_MAX_DELETE_TRANSACTION_MS,
      MAX_MAX_DELETE_TRANSACTION_MS,
    );
    return {
      enabled: settings.enabled !== false,
      retentionDays: this.normalizeBoundedInteger(settings.retentionDays, 90, 1, 365_000),
      maxDatabaseSizeMb: this.normalizeBoundedInteger(settings.maxDatabaseSizeMb, 2048, 1, 1024 * 1024),
      cleanupMode: settings.cleanupMode ?? "byAgeAndSize",
      optimizeAfterCleanup: settings.optimizeAfterCleanup === true,
      deleteBatchSize: this.normalizeBoundedInteger(
        settings.deleteBatchSize,
        this.defaultDeleteBatchSize,
        MIN_DELETE_BATCH_SIZE,
        MAX_DELETE_BATCH_SIZE,
      ),
      maintenanceIntervalMs: this.normalizeBoundedInteger(
        settings.maintenanceIntervalMs,
        this.defaultMaintenanceIntervalMs,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      ),
      maxMaintenanceTickMs: Math.max(
        this.normalizeBoundedInteger(
          settings.maxMaintenanceTickMs,
          this.defaultMaxMaintenanceTickMs,
          MIN_MAX_MAINTENANCE_TICK_MS,
          MAX_MAX_MAINTENANCE_TICK_MS,
        ),
        maxDeleteTransactionMs,
      ),
      maxDeleteTransactionMs,
    };
  }

  private logTrendPruningTick(input: {
    dbSizeMb: number;
    startThresholdMb: number | null;
    stopThresholdMb: number | null;
    deleteBatchSize: number;
    maxDeleteTransactionMs: number;
    retentionDeleted: number;
    sizeDeleted: number;
    lastBatchDurationMs: number;
    statusDetail: string | null;
  }): void {
    this.logger.info(`trend:pruning-tick ${JSON.stringify({
      dbSizeMb: input.dbSizeMb,
      startThresholdMb: input.startThresholdMb,
      stopThresholdMb: input.stopThresholdMb,
      deleteBatchSize: input.deleteBatchSize,
      maxDeleteTransactionMs: input.maxDeleteTransactionMs,
      retentionDeleted: input.retentionDeleted,
      sizeDeleted: input.sizeDeleted,
      lastBatchDurationMs: input.lastBatchDurationMs,
      statusDetail: input.statusDetail,
      oldestSampleTime: this.maintenanceOldestSampleTime,
      newestSampleTime: this.maintenanceNewestSampleTime,
      actualSamplesCount: this.maintenanceActualSamplesCount,
      estimatedSamplesCount: this.maintenanceEstimatedSamplesCount,
      archiveSamplesRelationSizeMb: this.maintenanceArchiveSamplesRelationSizeMb,
      archiveSamplesTotalSizeMb: this.maintenanceArchiveSamplesTotalSizeMb,
      hypertableChunksCount: this.maintenanceHypertableChunksCount,
      compressedChunksCount: this.maintenanceCompressedChunksCount,
    })}`);
  }

  private isStatementTimeoutError(error: unknown): boolean {
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code?: unknown }).code;
      if (code === "57014") {
        return true;
      }
    }
    const message = this.errorText(error).toLowerCase();
    return message.includes("statement timeout") || message.includes("canceling statement");
  }

  private pauseBetweenBatchesMs(intervalMs: number): number {
    const safeInterval = this.normalizePositiveInteger(intervalMs, this.defaultMaintenanceIntervalMs);
    return Math.max(50, Math.min(500, Math.floor(safeInterval / 2)));
  }

  private normalizePositiveInteger(value: unknown, fallback: number): number {
    const fallbackValue = Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : 1;
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return fallbackValue;
    }
    return Math.max(1, Math.round(numeric));
  }

  private normalizeBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
    const normalized = this.normalizePositiveInteger(value, fallback);
    return Math.min(max, Math.max(min, normalized));
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
