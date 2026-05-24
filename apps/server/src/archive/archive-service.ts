import type {
  DriverConfig,
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
  lastRunAt: number | null;
};

const DEFAULT_MAINTENANCE_INTERVAL_MS = 3_000;
const DEFAULT_DELETE_BATCH_SIZE = 500;
const DEFAULT_MAX_MAINTENANCE_TICK_MS = 200;
const DEFAULT_MAX_DELETE_TRANSACTION_MS = 150;
const MIN_DELETE_BATCH_SIZE = 10;
const MAX_DELETE_BATCH_SIZE = 10_000;
const MIN_MAINTENANCE_INTERVAL_MS = 500;
const MAX_MAINTENANCE_INTERVAL_MS = 60_000;
const MIN_MAX_MAINTENANCE_TICK_MS = 50;
const MAX_MAX_MAINTENANCE_TICK_MS = 2_000;
const MIN_MAX_DELETE_TRANSACTION_MS = 50;
const MAX_MAX_DELETE_TRANSACTION_MS = 1_000;

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
  private maintenanceNextRunAt: number | null = null;
  private maintenanceDbSizeMb: number | null = null;
  private maintenanceRecordsTotal: number | null = null;
  private maintenanceMaxDbSizeMb: number | null = null;
  private maintenanceStartThresholdMb: number | null = null;
  private maintenanceStopThresholdMb: number | null = null;
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
    lastRunAt: null,
  };
  private readonly operatorArchiveMaintenance: MessageArchiveMaintenanceStateSnapshot = {
    status: "scheduled",
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
        recordsDeletedInLastBatch: 0,
        totalRecordsDeletedThisRun: 0,
        lastBatchDurationMs: 0,
        nextRunAt: null,
      };
    }

    if (this.maintenanceDbSizeMb === null || this.maintenanceRecordsTotal === null) {
      const stats = await this.repository.getStorageStats();
      this.maintenanceDbSizeMb = stats.dbSizeMb;
      this.maintenanceRecordsTotal = stats.recordsCount;
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
      maxDatabaseSizeMb: state.maxDatabaseSizeMb,
      startThresholdMb: state.startThresholdMb,
      stopThresholdMb: state.stopThresholdMb,
      recordsDeletedInLastBatch: state.recordsDeletedInLastBatch,
      totalRecordsDeletedThisRun: state.totalRecordsDeletedThisRun,
      lastBatchDurationMs: state.lastBatchDurationMs,
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
      maxDatabaseSizeMb: state.maxDatabaseSizeMb,
      startThresholdMb: state.startThresholdMb,
      stopThresholdMb: state.stopThresholdMb,
      recordsDeletedInLastBatch: state.recordsDeletedInLastBatch,
      totalRecordsDeletedThisRun: state.totalRecordsDeletedThisRun,
      lastBatchDurationMs: state.lastBatchDurationMs,
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
    this.eventArchiveMaintenance.status = "idle";
    this.eventArchiveMaintenance.nextRunAt = null;
    this.operatorArchiveMaintenance.status = "idle";
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
    const stats = await this.repository.getStorageStats();

    this.maintenanceDbSizeMb = stats.dbSizeMb;
    this.maintenanceRecordsTotal = stats.recordsCount;
    this.maintenanceMaxDbSizeMb = normalizedSettings.maxDbSizeMb;
    this.maintenanceStartThresholdMb = thresholds.startThresholdMb;
    this.maintenanceStopThresholdMb = thresholds.stopThresholdMb;

    if (!normalizedSettings.autoCleanupEnabled || (normalizedSettings.maxDbSizeMb ?? 0) <= 0) {
      this.pruningActive = false;
      this.recordsDeletedInLastBatch = 0;
      this.totalRecordsDeletedThisRun = 0;
      this.lastBatchDurationMs = 0;
      this.maintenancePauseReason = null;
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
      this.maintenancePauseReason = null;
      this.maintenanceState = "scheduled";
      await this.runMessageArchiveMaintenanceTick("event");
      await this.runMessageArchiveMaintenanceTick("operator");
      return 0;
    }

    const deadline = Date.now() + normalizedSettings.maxMaintenanceTickMs;
    let totalDeletedInTick = 0;
    let currentDbSizeMb = stats.dbSizeMb;

    while (Date.now() < deadline) {
      if (this.maintenanceInterruptRequested) {
        this.maintenancePauseReason = "settings_changed";
        this.maintenanceState = "scheduled";
        break;
      }

      const loadGuard = this.loadGuard(normalizedSettings);
      if (loadGuard.paused) {
        this.maintenancePauseReason = loadGuard.reason ?? "runtime_load_high";
        this.maintenanceState = "paused";
        break;
      }

      this.maintenancePauseReason = null;
      this.maintenanceState = "pruning";

      let deletedInBatch = 0;
      let batchDurationMs = 0;

      const retentionStart = Date.now();
      const deletedByRetention = await this.repository.applyRetentionBatch(normalizedSettings.deleteBatchSize);
      if (deletedByRetention > 0) {
        deletedInBatch = deletedByRetention;
        batchDurationMs = Math.max(0, Date.now() - retentionStart);
      } else {
        const sizeDeleteResult = await this.repository.deleteOldestSamplesBatch({
          limit: normalizedSettings.deleteBatchSize,
          maxTransactionMs: normalizedSettings.maxDeleteTransactionMs,
        });
        deletedInBatch = sizeDeleteResult.deletedRecords;
        batchDurationMs = sizeDeleteResult.durationMs;
      }

      this.recordsDeletedInLastBatch = deletedInBatch;
      this.lastBatchDurationMs = batchDurationMs;
      totalDeletedInTick += deletedInBatch;
      this.totalRecordsDeletedThisRun += deletedInBatch;

      const refreshedStats = await this.repository.getStorageStats();
      this.maintenanceDbSizeMb = refreshedStats.dbSizeMb;
      this.maintenanceRecordsTotal = refreshedStats.recordsCount;
      currentDbSizeMb = refreshedStats.dbSizeMb;

      if (stopThreshold !== null && currentDbSizeMb < stopThreshold) {
        this.pruningActive = false;
        this.maintenanceState = "scheduled";
        break;
      }

      if (deletedInBatch === 0) {
        this.pruningActive = false;
        this.maintenanceState = "scheduled";
        break;
      }

      if (Date.now() >= deadline) {
        this.maintenanceState = "cooling_down";
        break;
      }

      await this.sleep(this.pauseBetweenBatchesMs(normalizedSettings.maintenanceIntervalMs));
    }

    if (this.pruningActive && this.maintenanceState === "pruning") {
      this.maintenanceState = "cooling_down";
    }
    if (this.pruningActive && stopThreshold !== null && currentDbSizeMb < stopThreshold) {
      this.pruningActive = false;
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
    const now = Date.now();
    if (state.lastRunAt !== null && (now - state.lastRunAt) < settings.maintenanceIntervalMs) {
      state.nextRunAt = state.lastRunAt + settings.maintenanceIntervalMs;
      return 0;
    }
    const status = kind === "event"
      ? await this.repository.getEventArchiveStatus()
      : await this.repository.getOperatorActionArchiveStatus(this.operatorActionArchiveSettings);

    state.dbSizeMb = status.dbSizeMb;
    state.recordsCount = status.recordsCount;
    state.oldestRecordAt = status.oldestRecordAt;
    state.newestRecordAt = status.newestRecordAt;
    state.maxDatabaseSizeMb = settings.maxDatabaseSizeMb;
    state.lastRunAt = now;
    state.nextRunAt = state.lastRunAt + settings.maintenanceIntervalMs;

    if (!settings.enabled || settings.maxDatabaseSizeMb <= 0) {
      state.pruningActive = false;
      state.status = "idle";
      state.pauseReason = null;
      state.recordsDeletedInLastBatch = 0;
      state.totalRecordsDeletedThisRun = 0;
      state.lastBatchDurationMs = 0;
      state.startThresholdMb = null;
      state.stopThresholdMb = null;
      return 0;
    }

    const thresholds = resolveArchiveMaintenanceThresholds(settings.maxDatabaseSizeMb);
    state.startThresholdMb = thresholds.startThresholdMb;
    state.stopThresholdMb = thresholds.stopThresholdMb;
    if (!state.pruningActive && thresholds.startThresholdMb !== null && status.dbSizeMb > thresholds.startThresholdMb) {
      state.pruningActive = true;
      state.totalRecordsDeletedThisRun = 0;
    } else if (state.pruningActive && thresholds.stopThresholdMb !== null && status.dbSizeMb < thresholds.stopThresholdMb) {
      state.pruningActive = false;
    }

    if (!state.pruningActive) {
      state.status = "scheduled";
      state.pauseReason = null;
      state.recordsDeletedInLastBatch = 0;
      state.lastBatchDurationMs = 0;
      return 0;
    }

    const loadGuard = this.loadGuard({ deleteBatchSize: settings.deleteBatchSize });
    if (loadGuard.paused) {
      state.status = "paused";
      state.pauseReason = loadGuard.reason ?? "runtime_load_high";
      state.recordsDeletedInLastBatch = 0;
      state.lastBatchDurationMs = 0;
      return 0;
    }

    state.status = "pruning";
    state.pauseReason = null;

    const deadline = Date.now() + settings.maxMaintenanceTickMs;
    let deletedTotal = 0;
    while (Date.now() < deadline) {
      let batchResult: { deletedRecords: number; durationMs: number };
      if (settings.cleanupMode === "byAge") {
        batchResult = kind === "event"
          ? await this.repository.deleteEventOccurrencesByRetentionBatch({
            retentionDays: settings.retentionDays,
            limit: settings.deleteBatchSize,
            maxTransactionMs: settings.maxDeleteTransactionMs,
          })
          : await this.repository.deleteOperatorActionsByRetentionBatch({
            retentionDays: settings.retentionDays,
            limit: settings.deleteBatchSize,
            maxTransactionMs: settings.maxDeleteTransactionMs,
          });
      } else if (settings.cleanupMode === "bySize") {
        batchResult = kind === "event"
          ? await this.repository.deleteOldestEventOccurrencesBatch({
            limit: settings.deleteBatchSize,
            maxTransactionMs: settings.maxDeleteTransactionMs,
          })
          : await this.repository.deleteOldestOperatorActionsBatch({
            limit: settings.deleteBatchSize,
            maxTransactionMs: settings.maxDeleteTransactionMs,
          });
      } else {
        const byAge = kind === "event"
          ? await this.repository.deleteEventOccurrencesByRetentionBatch({
            retentionDays: settings.retentionDays,
            limit: settings.deleteBatchSize,
            maxTransactionMs: settings.maxDeleteTransactionMs,
          })
          : await this.repository.deleteOperatorActionsByRetentionBatch({
            retentionDays: settings.retentionDays,
            limit: settings.deleteBatchSize,
            maxTransactionMs: settings.maxDeleteTransactionMs,
          });
        if (byAge.deletedRecords > 0) {
          batchResult = byAge;
        } else {
          batchResult = kind === "event"
            ? await this.repository.deleteOldestEventOccurrencesBatch({
              limit: settings.deleteBatchSize,
              maxTransactionMs: settings.maxDeleteTransactionMs,
            })
            : await this.repository.deleteOldestOperatorActionsBatch({
              limit: settings.deleteBatchSize,
              maxTransactionMs: settings.maxDeleteTransactionMs,
            });
        }
      }

      state.recordsDeletedInLastBatch = batchResult.deletedRecords;
      state.lastBatchDurationMs = batchResult.durationMs;
      state.totalRecordsDeletedThisRun += batchResult.deletedRecords;
      deletedTotal += batchResult.deletedRecords;

      const refreshedStatus = kind === "event"
        ? await this.repository.getEventArchiveStatus()
        : await this.repository.getOperatorActionArchiveStatus(this.operatorActionArchiveSettings);
      state.dbSizeMb = refreshedStatus.dbSizeMb;
      state.recordsCount = refreshedStatus.recordsCount;
      state.oldestRecordAt = refreshedStatus.oldestRecordAt;
      state.newestRecordAt = refreshedStatus.newestRecordAt;

      if (state.stopThresholdMb !== null && refreshedStatus.dbSizeMb < state.stopThresholdMb) {
        state.pruningActive = false;
        state.status = "scheduled";
        break;
      }
      if (batchResult.deletedRecords === 0) {
        state.pruningActive = false;
        state.status = "scheduled";
        break;
      }
      if (Date.now() >= deadline) {
        state.status = "cooling_down";
        break;
      }
      await this.sleep(this.pauseBetweenBatchesMs(settings.maintenanceIntervalMs));
    }

    if (state.pruningActive && state.status === "pruning") {
      state.status = "cooling_down";
    }
    return deletedTotal;
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
      return Math.max(200, Math.min(trendInterval, eventInterval, operatorInterval));
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
