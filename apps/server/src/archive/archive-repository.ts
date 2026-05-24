import pg, { type Pool as PgPool, type PoolClient } from "pg";
import type {
  DriverConfig,
  EventArchiveCleanupMode,
  EventArchiveSettings,
  EventHistoryPage,
  EventHistoryQuery,
  EventHistoryRecord,
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
import { ARCHIVE_SCHEMA_SQL, ARCHIVE_TIMESCALE_SQL } from "./archive-schema.js";

const { Pool } = pg;
const ARCHIVE_SIZE_DELETE_MIN_ROWS = 100_000;
const ARCHIVE_SIZE_DELETE_MAX_ROWS = 500_000;
const ARCHIVE_SIZE_DELETE_HEADROOM = 1.15;
const DEFAULT_DELETE_BATCH_SIZE = 500;
const DEFAULT_MAINTENANCE_INTERVAL_MS = 3_000;
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
const DEFAULT_MANUAL_CLEANUP_MAX_BATCHES = 20;
const DEFAULT_MANUAL_CLEANUP_MAX_DURATION_MS = 2_000;

export type ArchiveLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

type ReferenceCache = {
  dataTypes: Map<string, number>;
  sourceTypes: Map<string, number>;
  units: Map<string, number>;
  drivers: Map<string, number>;
  policies: Map<string, number>;
};

type TagArchiveCacheItem = {
  id: number;
  enabled: boolean;
  mode: string;
  periodMs: number;
  deadband: number;
};

type ArchivedValueState = {
  timestamp: number;
  value: number | boolean | string | null;
  quality: string;
  source: string;
};

export type ArchiveSampleRow = {
  time: string;
  tagName: string;
  valueDouble: number | null;
  valueBool: boolean | null;
  valueText: string | null;
  quality: string;
  source: string | null;
};

export type ArchivePolicyInput = {
  name: string;
  enabled: boolean;
  mode: string;
  periodMs: number;
  deadband: number;
  retentionDays: number;
  aggregateEnabled: boolean;
  compressionAfterDays: number | null;
};

export type ArchivePolicyRow = ArchivePolicyInput & {
  id: number;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveTagOverrideInput = {
  enabled?: boolean | null;
  mode?: string | null;
  periodMs?: number | null;
  deadband?: number | null;
  retentionDays?: number | null;
  aggregateEnabled?: boolean | null;
  compressionAfterDays?: number | null;
};

export type ArchiveTagConfigRow = {
  tagId: number;
  tagName: string;
  sourceType?: string;
  driverType?: string;
  policyId: number | null;
  policyName: string | null;
  enabled: boolean;
  mode: string | null;
  periodMs: number | null;
  deadband: number | null;
  retentionDays: number | null;
  aggregateEnabled: boolean | null;
  compressionAfterDays: number | null;
  override: ArchiveTagOverrideInput | null;
};

export type ArchiveStorageStatsRow = {
  recordsCount: number;
  dbSizeMb: number;
  estimatedSamplesCount: number | null;
  actualSamplesCount: number | null;
  oldestSampleTime: string | null;
  newestSampleTime: string | null;
  isHypertable: boolean;
  hypertableChunks: number | null;
};

export type ArchiveRuntimeSettingsRow = {
  autoCleanupEnabled: boolean;
  maxDbSizeMb: number | null;
  deleteBatchSize: number;
  maintenanceIntervalMs: number;
  maxMaintenanceTickMs: number;
  maxDeleteTransactionMs: number;
  updatedAt: string;
};

export type ArchivePruneBatchResultRow = {
  deletedRecords: number;
  durationMs: number;
  diagnostics?: TrendDeleteBatchDiagnosticsRow;
};

export type TrendDeleteBatchDiagnosticsRow = {
  deleteAttemptAt: string;
  reason: string;
  actualSamplesCount: number | null;
  estimatedSamplesCount: number | null;
  oldestSampleTime: string | null;
  newestSampleTime: string | null;
  candidateRows: number;
  oldestCandidateTime: string | null;
  newestCandidateTime: string | null;
  isHypertable: boolean;
  hypertableChunks: number | null;
};

export type EventArchiveStatusRow = {
  status?: "idle" | "scheduled" | "pruning" | "paused" | "cooling_down" | "compacting" | "error";
  statusDetail?: string;
  dbSizeMb: number;
  maxDatabaseSizeMb?: number | null;
  startThresholdMb?: number | null;
  stopThresholdMb?: number | null;
  recordsCount: number;
  recordsDeletedInLastBatch?: number;
  totalRecordsDeletedThisRun?: number;
  lastBatchDurationMs?: number;
  nextRunAt?: string | null;
  pauseReason?: string;
  oldestRecordAt: string | null;
  newestRecordAt: string | null;
  settings: EventArchiveSettings;
};

export type EventArchiveCleanupResultRow = {
  deletedByAge: number;
  deletedBySize: number;
  optimized: boolean;
};

export type OperatorActionArchiveStatusRow = {
  status?: "idle" | "scheduled" | "pruning" | "paused" | "cooling_down" | "compacting" | "error";
  statusDetail?: string;
  dbSizeMb: number;
  maxDatabaseSizeMb?: number | null;
  startThresholdMb?: number | null;
  stopThresholdMb?: number | null;
  recordsCount: number;
  recordsDeletedInLastBatch?: number;
  totalRecordsDeletedThisRun?: number;
  lastBatchDurationMs?: number;
  nextRunAt?: string | null;
  pauseReason?: string;
  oldestRecordAt: string | null;
  newestRecordAt: string | null;
  settings: OperatorActionArchiveSettings;
};

export type OperatorActionArchiveCleanupResultRow = {
  deletedByAge: number;
  deletedBySize: number;
  optimized: boolean;
};

export type ArchivePurgePreviewRow = {
  scope: "archive_data";
  tables: string[];
  samplesCount: number;
  samplesSizeMb: number;
  totalSizeMb: number;
  oldestSampleTime: string | null;
  newestSampleTime: string | null;
};

export type ArchivePurgeResultRow = {
  scope: "archive_data";
  clearedSamples: number;
  clearedTotalSizeMb: number;
  tables: string[];
};

export type TrendAggregationMode = "auto" | "raw" | "minmax" | "avg" | "lttb";
export type TrendResolvedAggregation = "raw" | "minmax" | "avg" | "lttb";
export type TrendDataType = "number" | "boolean" | "string" | "enum";
export type TrendQuality = "good" | "bad" | "uncertain";

export type TrendTagInfoRow = {
  id: string;
  name: string;
  displayName?: string;
  unit?: string;
  dataType?: TrendDataType;
  description?: string;
  group?: string;
  min?: number;
  max?: number;
  sourceType?: string;
  driverType?: string;
  archiveMode?: string;
  archivePeriodMs?: number;
};

export type TrendPointRow = {
  t: number;
  v: number | null;
  q?: TrendQuality;
};

export type TrendSeriesDiagnosticsRow = {
  tag: string;
  policyMode: string;
  policyPeriodMs: number;
  policyRequiresIncomingSamples: boolean;
  archiveHeartbeatEnabled: boolean;
  policyGuidance: string | null;
  rangeFrom: string;
  rangeTo: string;
  pointsInRange: number;
  firstPointTs: number | null;
  lastPointTs: number | null;
  previousPointBeforeRangeTs: number | null;
  hasPreviousBeforeRange: boolean;
  missingHistoryBeforeRange: boolean;
};

export type TrendSeriesRow = {
  tag: string;
  displayName?: string;
  unit?: string;
  points: TrendPointRow[];
  diagnostics?: TrendSeriesDiagnosticsRow;
};

export type TrendQueryRow = {
  from: string;
  to: string;
  aggregation: TrendResolvedAggregation;
  series: TrendSeriesRow[];
};

type TrendTagMetaRow = {
  id: number;
  name: string;
  displayName: string;
  unit: string | null;
  dataTypeCode: string;
  description: string | null;
  group: string | null;
  min: number | null;
  max: number | null;
  sourceTypeCode: string | null;
  driverType: string | null;
  archiveEnabled: boolean;
  policyMode: string;
  policyPeriodMs: number;
};

type TrendQueryParams = {
  tags: string[];
  from: Date;
  to: Date;
  maxPoints: number;
  aggregation: TrendAggregationMode;
  hardLimitPerSeries: number;
};

type ArchiveRepositoryOptions = {
  connectionString: string;
  maxPoolSize?: number;
  defaultArchiveEnabled?: boolean;
  defaultDeleteBatchSize?: number;
  defaultMaintenanceIntervalMs?: number;
  defaultMaxMaintenanceTickMs?: number;
  defaultMaxDeleteTransactionMs?: number;
};

export class ArchiveRepository {
  private readonly pool: PgPool;
  private readonly defaultArchiveEnabled: boolean;
  private readonly defaultDeleteBatchSize: number;
  private readonly defaultMaintenanceIntervalMs: number;
  private readonly defaultMaxMaintenanceTickMs: number;
  private readonly defaultMaxDeleteTransactionMs: number;
  private activeTrendQueries = 0;
  private activeEventQueries = 0;
  private activeOperatorActionQueries = 0;
  private activeOperatorActionWrites = 0;
  private readonly tags = new Map<string, TagArchiveCacheItem>();
  private readonly qualities = new Map<string, number>();
  private readonly sources = new Map<string, number>();
  private readonly lastArchivedByTagId = new Map<number, ArchivedValueState>();

  public constructor(
    options: ArchiveRepositoryOptions,
    private readonly logger: ArchiveLogger,
  ) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxPoolSize ?? 5,
    });
    this.defaultArchiveEnabled = options.defaultArchiveEnabled ?? false;
    this.defaultDeleteBatchSize = this.normalizePositiveInteger(options.defaultDeleteBatchSize, DEFAULT_DELETE_BATCH_SIZE);
    this.defaultMaintenanceIntervalMs = this.normalizePositiveInteger(options.defaultMaintenanceIntervalMs, DEFAULT_MAINTENANCE_INTERVAL_MS);
    this.defaultMaxMaintenanceTickMs = this.normalizePositiveInteger(options.defaultMaxMaintenanceTickMs, DEFAULT_MAX_MAINTENANCE_TICK_MS);
    this.defaultMaxDeleteTransactionMs = this.normalizePositiveInteger(options.defaultMaxDeleteTransactionMs, DEFAULT_MAX_DELETE_TRANSACTION_MS);
  }

  public async initialize(): Promise<void> {
    await this.pool.query(ARCHIVE_SCHEMA_SQL);
    await this.ensureDefaultPolicy();
    await this.tryEnableTimescale();
    await this.loadInsertCaches();
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public async syncMetadata(tags: TagDefinition[], drivers: DriverConfig[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const refs = await this.syncReferences(client, tags, drivers);
      const defaultPolicyId = refs.policies.get("Default archive") ?? null;

      for (const driver of drivers) {
        await client.query(
          `
          INSERT INTO drivers (external_id, name, type, updated_at)
          VALUES ($1, $2, $3, now())
          ON CONFLICT (external_id) DO UPDATE
          SET name = EXCLUDED.name,
              type = EXCLUDED.type,
              updated_at = now()
          `,
          [driver.id, driver.name?.trim() || driver.id, driver.type],
        );
      }

      for (const tag of tags) {
        const dataTypeId = refs.dataTypes.get(tag.dataType);
        if (!dataTypeId) {
          continue;
        }
        const sourceTypeId = tag.sourceType ? refs.sourceTypes.get(tag.sourceType) ?? null : null;
        const unitId = tag.unit?.trim() ? refs.units.get(tag.unit.trim()) ?? null : null;
        const driverId = tag.driverId ? refs.drivers.get(tag.driverId) ?? null : null;
        await client.query(
          `
          INSERT INTO tags (
              name,
              description,
              data_type_id,
              source_type_id,
              unit_id,
              driver_id,
              archive_policy_id,
              updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, now())
          ON CONFLICT (name) DO UPDATE
          SET description = EXCLUDED.description,
              data_type_id = EXCLUDED.data_type_id,
              source_type_id = EXCLUDED.source_type_id,
              unit_id = EXCLUDED.unit_id,
              driver_id = EXCLUDED.driver_id,
              archive_policy_id = COALESCE(tags.archive_policy_id, EXCLUDED.archive_policy_id),
              updated_at = now()
          `,
          [tag.name, tag.description ?? null, dataTypeId, sourceTypeId, unitId, driverId, defaultPolicyId],
        );
      }

      const names = tags.map((tag) => tag.name);
      if (names.length > 0) {
        await client.query("DELETE FROM tag_group_members WHERE tag_id IN (SELECT id FROM tags WHERE name = ANY($1))", [names]);
      }

      for (const tag of tags) {
        const groupName = tag.group?.trim();
        if (!groupName) {
          continue;
        }
        const tagId = await this.getIdByCode(client, "tags", "name", tag.name);
        const groupId = await this.getIdByCode(client, "tag_groups", "name", groupName);
        if (!tagId || !groupId) {
          continue;
        }
        await client.query(
          `
          INSERT INTO tag_group_members (tag_id, group_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
          `,
          [tagId, groupId],
        );
      }

      await client.query("COMMIT");
      await this.loadInsertCaches();
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public canArchive(tagName: string): boolean {
    return this.tags.get(tagName)?.enabled ?? false;
  }

  public async insertSamples(values: TagValue[]): Promise<void> {
    const rows = await this.toRows(values);
    if (rows.length === 0) {
      return;
    }

    const params: unknown[] = [];
    const placeholders = rows.map((row, index) => {
      const offset = index * 7;
      params.push(row.time, row.tagId, row.valueDouble, row.valueBool, row.valueText, row.qualityId, row.sourceId);
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
    });

    await this.pool.query(
      `
      INSERT INTO archive_samples (
          time,
          tag_id,
          value_double,
          value_bool,
          value_text,
          quality_id,
          source_id
      )
      VALUES ${placeholders.join(",")}
      ON CONFLICT (tag_id, time) DO NOTHING
      `,
      params,
    );
  }

  public async querySamples(tagName: string, from: Date, to: Date, limit: number): Promise<ArchiveSampleRow[]> {
    return this.withTrendQueryActivity(async () => {
      const result = await this.pool.query<{
        time: Date;
        tag_name: string;
        value_double: number | null;
        value_bool: boolean | null;
        value_text: string | null;
        quality: string;
        source: string | null;
      }>(
        `
        SELECT
            s.time,
            t.name AS tag_name,
            s.value_double,
            s.value_bool,
            s.value_text,
            q.code AS quality,
            src.code AS source
        FROM archive_samples s
        JOIN tags t ON t.id = s.tag_id
        JOIN archive_qualities q ON q.id = s.quality_id
        LEFT JOIN archive_sources src ON src.id = s.source_id
        WHERE t.name = $1
          AND s.time >= $2
          AND s.time <= $3
        ORDER BY s.time ASC
        LIMIT $4
        `,
        [tagName, from, to, limit],
      );

      return result.rows.map((row) => ({
        time: row.time.toISOString(),
        tagName: row.tag_name,
        valueDouble: row.value_double,
        valueBool: row.value_bool,
        valueText: row.value_text,
        quality: row.quality,
        source: row.source,
      }));
    });
  }

  public async listTrendTags(): Promise<TrendTagInfoRow[]> {
    const rows = await this.loadTrendTagMeta();
    return rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      displayName: row.displayName || row.name,
      unit: row.unit ?? undefined,
      dataType: this.mapTrendDataType(row.dataTypeCode),
      description: row.description ?? undefined,
      group: row.group ?? undefined,
      min: row.min ?? undefined,
      max: row.max ?? undefined,
      sourceType: row.sourceTypeCode ?? undefined,
      driverType: row.driverType ?? undefined,
      archiveMode: row.policyMode,
      archivePeriodMs: row.policyPeriodMs,
    }));
  }

  public async queryTrendsRange(tags: string[]): Promise<{ from: string | null; to: string | null }> {
    return this.withTrendQueryActivity(async () => {
      if (tags.length > 0) {
        const rows = await this.loadTrendTagMeta(tags);
        if (rows.length === 0) {
          return { from: null, to: null };
        }
        const result = await this.pool.query<{
          min_time: Date | null;
          max_time: Date | null;
        }>(
          `
          SELECT MIN(s.time) AS min_time, MAX(s.time) AS max_time
          FROM archive_samples s
          WHERE s.tag_id = ANY($1::bigint[])
          `,
          [rows.map((row) => row.id)],
        );
        const range = result.rows[0];
        return {
          from: range?.min_time ? range.min_time.toISOString() : null,
          to: range?.max_time ? range.max_time.toISOString() : null,
        };
      }

      const result = await this.pool.query<{
        min_time: Date | null;
        max_time: Date | null;
      }>(
        `
        SELECT MIN(s.time) AS min_time, MAX(s.time) AS max_time
        FROM archive_samples s
        JOIN tags t ON t.id = s.tag_id
        LEFT JOIN archive_policies p ON p.id = t.archive_policy_id
        LEFT JOIN tag_archive_overrides o ON o.tag_id = t.id
        WHERE COALESCE(o.enabled, p.enabled, false) = true
        `,
      );
      const range = result.rows[0];
      return {
        from: range?.min_time ? range.min_time.toISOString() : null,
        to: range?.max_time ? range.max_time.toISOString() : null,
      };
    });
  }

  public async queryTrends(params: TrendQueryParams): Promise<TrendQueryRow> {
    return this.withTrendQueryActivity(async () => {
      const requestedFrom = params.from;
      const requestedTo = params.to;
      const maxPoints = Math.max(100, params.maxPoints);
      const hardLimit = Math.max(200, params.hardLimitPerSeries);
      const rangeMs = Math.max(1, requestedTo.getTime() - requestedFrom.getTime());

      const metaRows = await this.loadTrendTagMeta(params.tags);
      const series: TrendSeriesRow[] = [];
      let resolvedAggregation: TrendResolvedAggregation = "raw";

      for (const meta of metaRows) {
        const dataType = this.mapTrendDataType(meta.dataTypeCode);
        const rangeStats = await this.queryTrendRangeStats(meta.id, requestedFrom, requestedTo, dataType);
        const rawCount = rangeStats.pointsInRange;
        const effectiveAggregation = this.resolveTrendAggregation({
          requested: params.aggregation,
          dataType,
          rawCount,
          maxPoints,
        });
        resolvedAggregation = this.pickWiderAggregation(resolvedAggregation, effectiveAggregation);
        const targetBuckets = effectiveAggregation === "minmax"
          ? Math.max(1, Math.floor(maxPoints / 2))
          : maxPoints;
        const bucketMs = Math.max(1, Math.ceil(rangeMs / targetBuckets));

        let points: TrendPointRow[] = [];
        if (effectiveAggregation === "raw") {
          points = await this.queryRawTrendPoints(meta.id, requestedFrom, requestedTo, hardLimit, dataType);
        } else if (dataType === "boolean" || dataType === "enum") {
          points = await this.queryBucketedDiscreteTrendPoints(meta.id, requestedFrom, requestedTo, bucketMs, hardLimit);
        } else if (effectiveAggregation === "minmax") {
          points = await this.queryBucketedMinMaxTrendPoints(meta.id, requestedFrom, requestedTo, bucketMs, hardLimit);
        } else {
          points = await this.queryBucketedAvgTrendPoints(meta.id, requestedFrom, requestedTo, bucketMs, hardLimit);
        }
        const carryForwardPoint = await this.queryTrendPointAtOrBefore(meta.id, requestedFrom, dataType);
        const fromTs = requestedFrom.getTime();
        const previousPointBeforeRangeTs = carryForwardPoint?.t ?? null;
        const missingHistoryBeforeRange = rangeStats.firstPointTs !== null && previousPointBeforeRangeTs === null && rangeStats.firstPointTs > fromTs;
        const seriesDiagnostics: TrendSeriesDiagnosticsRow = {
          tag: meta.name,
          policyMode: meta.policyMode,
          policyPeriodMs: meta.policyPeriodMs,
          policyRequiresIncomingSamples: this.archivePolicyRequiresIncomingSamples(meta.policyMode),
          archiveHeartbeatEnabled: false,
          policyGuidance: this.archivePolicyGuidance(meta.policyMode),
          rangeFrom: requestedFrom.toISOString(),
          rangeTo: requestedTo.toISOString(),
          pointsInRange: rangeStats.pointsInRange,
          firstPointTs: rangeStats.firstPointTs,
          lastPointTs: rangeStats.lastPointTs,
          previousPointBeforeRangeTs,
          hasPreviousBeforeRange: previousPointBeforeRangeTs !== null,
          missingHistoryBeforeRange,
        };
        if (missingHistoryBeforeRange) {
          this.logger.info(`trend:series-missing-history ${JSON.stringify(seriesDiagnostics)}`);
        }
        const normalizedBeforeCarryForward = this.normalizeTrendPointRows(points)
          .filter((point) => point.t >= fromTs && point.t <= requestedTo.getTime());
        const insertsCarryForwardFromBeforeRange = Boolean(
          carryForwardPoint
          && carryForwardPoint.t < fromTs
          && normalizedBeforeCarryForward.length > 0
          && normalizedBeforeCarryForward[0]!.t > fromTs,
        );
        const pointsWithCarryForward = this.applyTrendCarryForward(points, carryForwardPoint, requestedFrom, requestedTo);
        const insertsConstantCarryForwardSeries = Boolean(
          carryForwardPoint
          && normalizedBeforeCarryForward.length === 0
          && pointsWithCarryForward.length === 2
          && pointsWithCarryForward[0]?.t === fromTs
          && pointsWithCarryForward[1]?.t === requestedTo.getTime(),
        );
        if (insertsConstantCarryForwardSeries && carryForwardPoint) {
          this.logger.info(`trend:carry-forward-constant-series ${JSON.stringify({
            tag: meta.name,
            from: requestedFrom.toISOString(),
            to: requestedTo.toISOString(),
            previousPointTimestamp: carryForwardPoint.t,
            insertedPointCount: 2,
          })}`);
        }
        if (insertsCarryForwardFromBeforeRange && carryForwardPoint) {
          this.logger.info(`trend:carry-forward-from-before-range ${JSON.stringify({
            tag: meta.name,
            from: requestedFrom.toISOString(),
            to: requestedTo.toISOString(),
            previousPointTimestamp: carryForwardPoint.t,
            insertedPointCount: 1,
          })}`);
        }

        series.push({
          tag: meta.name,
          displayName: meta.displayName || meta.name,
          unit: meta.unit ?? undefined,
          points: this.enforceTrendPointLimit(pointsWithCarryForward, hardLimit),
          diagnostics: seriesDiagnostics,
        });
      }

      return {
        from: requestedFrom.toISOString(),
        to: requestedTo.toISOString(),
        aggregation: resolvedAggregation,
        series,
      };
    });
  }

  public async listPolicies(): Promise<ArchivePolicyRow[]> {
    const result = await this.pool.query<{
      id: number;
      name: string;
      enabled: boolean;
      mode: string;
      period_ms: number;
      deadband: number;
      retention_days: number;
      aggregate_enabled: boolean;
      compression_after_days: number | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `
      SELECT id, name, enabled, mode, period_ms, deadband, retention_days, aggregate_enabled,
             compression_after_days, created_at, updated_at
      FROM archive_policies
      ORDER BY name ASC
      `,
    );
    return result.rows.map((row) => this.mapPolicy(row));
  }

  public async upsertPolicy(id: number | undefined, policy: ArchivePolicyInput): Promise<ArchivePolicyRow> {
    const params = [
      policy.name,
      policy.enabled,
      policy.mode,
      policy.periodMs,
      policy.deadband,
      policy.retentionDays,
      policy.aggregateEnabled,
      policy.compressionAfterDays,
    ];
    const result = await this.pool.query<{
      id: number;
      name: string;
      enabled: boolean;
      mode: string;
      period_ms: number;
      deadband: number;
      retention_days: number;
      aggregate_enabled: boolean;
      compression_after_days: number | null;
      created_at: Date;
      updated_at: Date;
    }>(
      id
        ? `
          UPDATE archive_policies
          SET name = $1,
              enabled = $2,
              mode = $3,
              period_ms = $4,
              deadband = $5,
              retention_days = $6,
              aggregate_enabled = $7,
              compression_after_days = $8,
              updated_at = now()
          WHERE id = $9
          RETURNING id, name, enabled, mode, period_ms, deadband, retention_days, aggregate_enabled,
                    compression_after_days, created_at, updated_at
          `
        : `
          INSERT INTO archive_policies (
              name,
              enabled,
              mode,
              period_ms,
              deadband,
              retention_days,
              aggregate_enabled,
              compression_after_days
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, name, enabled, mode, period_ms, deadband, retention_days, aggregate_enabled,
                    compression_after_days, created_at, updated_at
          `,
      id ? [...params, id] : params,
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(id ? `Archive policy ${id} not found` : "Archive policy was not created");
    }
    await this.loadInsertCaches();
    return this.mapPolicy(row);
  }

  public async deletePolicy(id: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE tags SET archive_policy_id = NULL WHERE archive_policy_id = $1", [id]);
      const result = await client.query("DELETE FROM archive_policies WHERE id = $1", [id]);
      await client.query("COMMIT");
      await this.loadInsertCaches();
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async listTagConfigs(): Promise<ArchiveTagConfigRow[]> {
    const result = await this.pool.query<{
      tag_id: number;
      tag_name: string;
      source_type_code: string | null;
      driver_type: string | null;
      policy_id: number | null;
      policy_name: string | null;
      enabled: boolean;
      mode: string | null;
      period_ms: number | null;
      deadband: number | null;
      retention_days: number | null;
      aggregate_enabled: boolean | null;
      compression_after_days: number | null;
      override_enabled: boolean | null;
      override_mode: string | null;
      override_period_ms: number | null;
      override_deadband: number | null;
      override_retention_days: number | null;
      override_aggregate_enabled: boolean | null;
      override_compression_after_days: number | null;
      has_override: boolean;
    }>(
      `
      SELECT
          t.id AS tag_id,
          t.name AS tag_name,
          st.code AS source_type_code,
          d.type AS driver_type,
          p.id AS policy_id,
          p.name AS policy_name,
          COALESCE(o.enabled, p.enabled, false) AS enabled,
          COALESCE(o.mode, p.mode) AS mode,
          COALESCE(o.period_ms, p.period_ms) AS period_ms,
          COALESCE(o.deadband, p.deadband) AS deadband,
          COALESCE(o.retention_days, p.retention_days) AS retention_days,
          COALESCE(o.aggregate_enabled, p.aggregate_enabled) AS aggregate_enabled,
          COALESCE(o.compression_after_days, p.compression_after_days) AS compression_after_days,
          o.enabled AS override_enabled,
          o.mode AS override_mode,
          o.period_ms AS override_period_ms,
          o.deadband AS override_deadband,
          o.retention_days AS override_retention_days,
          o.aggregate_enabled AS override_aggregate_enabled,
          o.compression_after_days AS override_compression_after_days,
          o.tag_id IS NOT NULL AS has_override
      FROM tags t
      LEFT JOIN tag_source_types st ON st.id = t.source_type_id
      LEFT JOIN drivers d ON d.id = t.driver_id
      LEFT JOIN archive_policies p ON p.id = t.archive_policy_id
      LEFT JOIN tag_archive_overrides o ON o.tag_id = t.id
      ORDER BY t.name ASC
      `,
    );

    return result.rows.map((row) => ({
      tagId: row.tag_id,
      tagName: row.tag_name,
      sourceType: row.source_type_code ?? undefined,
      driverType: row.driver_type ?? undefined,
      policyId: row.policy_id,
      policyName: row.policy_name,
      enabled: row.enabled,
      mode: row.mode,
      periodMs: row.period_ms,
      deadband: row.deadband,
      retentionDays: row.retention_days,
      aggregateEnabled: row.aggregate_enabled,
      compressionAfterDays: row.compression_after_days,
      override: row.has_override
        ? {
            enabled: row.override_enabled,
            mode: row.override_mode,
            periodMs: row.override_period_ms,
            deadband: row.override_deadband,
            retentionDays: row.override_retention_days,
            aggregateEnabled: row.override_aggregate_enabled,
            compressionAfterDays: row.override_compression_after_days,
          }
        : null,
    }));
  }

  public async assignTagPolicy(tagName: string, policyId: number | null): Promise<boolean> {
    const result = await this.pool.query(
      `
      UPDATE tags
      SET archive_policy_id = $2,
          updated_at = now()
      WHERE name = $1
      `,
      [tagName, policyId],
    );
    await this.loadInsertCaches();
    return (result.rowCount ?? 0) > 0;
  }

  public async upsertTagOverride(tagName: string, override: ArchiveTagOverrideInput): Promise<boolean> {
    const result = await this.pool.query(
      `
      INSERT INTO tag_archive_overrides (
          tag_id,
          enabled,
          mode,
          period_ms,
          deadband,
          retention_days,
          aggregate_enabled,
          compression_after_days,
          updated_at
      )
      SELECT id, $2, $3, $4, $5, $6, $7, $8, now()
      FROM tags
      WHERE name = $1
      ON CONFLICT (tag_id) DO UPDATE
      SET enabled = EXCLUDED.enabled,
          mode = EXCLUDED.mode,
          period_ms = EXCLUDED.period_ms,
          deadband = EXCLUDED.deadband,
          retention_days = EXCLUDED.retention_days,
          aggregate_enabled = EXCLUDED.aggregate_enabled,
          compression_after_days = EXCLUDED.compression_after_days,
          updated_at = now()
      `,
      [
        tagName,
        override.enabled ?? null,
        override.mode ?? null,
        override.periodMs ?? null,
        override.deadband ?? null,
        override.retentionDays ?? null,
        override.aggregateEnabled ?? null,
        override.compressionAfterDays ?? null,
      ],
    );
    await this.loadInsertCaches();
    return (result.rowCount ?? 0) > 0;
  }

  public async deleteTagOverride(tagName: string): Promise<boolean> {
    const result = await this.pool.query(
      `
      DELETE FROM tag_archive_overrides
      WHERE tag_id = (SELECT id FROM tags WHERE name = $1)
      `,
      [tagName],
    );
    await this.loadInsertCaches();
    return (result.rowCount ?? 0) > 0;
  }

  public async applyRetentionBatch(limit: number): Promise<number> {
    const safeLimit = this.normalizePositiveInteger(limit, this.defaultDeleteBatchSize);
    const result = await this.pool.query(
      `
      WITH overdue AS (
        SELECT s.tag_id, s.time
        FROM archive_samples s
        JOIN tags t ON t.id = s.tag_id
        LEFT JOIN archive_policies p ON p.id = t.archive_policy_id
        LEFT JOIN tag_archive_overrides o ON o.tag_id = t.id
        WHERE COALESCE(o.retention_days, p.retention_days) IS NOT NULL
          AND s.time < now() - make_interval(days => COALESCE(o.retention_days, p.retention_days))
        ORDER BY s.time ASC
        LIMIT $1
      )
      DELETE FROM archive_samples s
      USING overdue
      WHERE s.tag_id = overdue.tag_id
        AND s.time = overdue.time
      `,
      [safeLimit],
    );
    return result.rowCount ?? 0;
  }

  public async configureCompressionPolicy(): Promise<void> {
    try {
      await this.pool.query(
        `
        DO $$
        DECLARE
            after_days INTEGER;
        BEGIN
            IF to_regproc('add_compression_policy') IS NOT NULL THEN
                SELECT MIN(COALESCE(o.compression_after_days, p.compression_after_days))
                INTO after_days
                FROM tags t
                LEFT JOIN archive_policies p ON p.id = t.archive_policy_id
                LEFT JOIN tag_archive_overrides o ON o.tag_id = t.id
                WHERE COALESCE(o.compression_after_days, p.compression_after_days) IS NOT NULL
                  AND COALESCE(o.compression_after_days, p.compression_after_days) > 0;

                IF after_days IS NOT NULL THEN
                    ALTER TABLE archive_samples SET (
                        timescaledb.compress,
                        timescaledb.compress_segmentby = 'tag_id'
                    );
                    PERFORM add_compression_policy('archive_samples', make_interval(days => after_days), if_not_exists => TRUE);
                END IF;
            END IF;
        END $$;
        `,
      );
    } catch (error) {
      this.logger.warn(`TimescaleDB compression policy was not applied: ${this.errorText(error)}`);
    }
  }

  public async getStorageStats(options?: { includeActualCount?: boolean }): Promise<ArchiveStorageStatsRow> {
    const includeActualCount = options?.includeActualCount === true;
    const result = await this.pool.query<{
      estimated_count: string | number | null;
      db_size_bytes: string | number | null;
      oldest_sample_time: Date | null;
      newest_sample_time: Date | null;
      is_hypertable: boolean | null;
      hypertable_chunks: string | number | null;
    }>(
      `
      WITH meta AS (
        SELECT
          CASE
            WHEN to_regclass('timescaledb_information.hypertables') IS NULL THEN FALSE
            ELSE EXISTS (
              SELECT 1
              FROM timescaledb_information.hypertables h
              WHERE h.hypertable_schema = current_schema()
                AND h.hypertable_name = 'archive_samples'
            )
          END AS is_hypertable,
          CASE
            WHEN to_regclass('timescaledb_information.chunks') IS NULL THEN NULL::bigint
            ELSE (
              SELECT COUNT(*)::bigint
              FROM timescaledb_information.chunks c
              WHERE c.hypertable_schema = current_schema()
                AND c.hypertable_name = 'archive_samples'
            )
          END AS hypertable_chunks
      )
      SELECT
          COALESCE((SELECT n_live_tup::bigint FROM pg_stat_user_tables WHERE relname = 'archive_samples'), 0) AS estimated_count,
          CASE
            WHEN meta.is_hypertable
            THEN COALESCE(pg_total_relation_size('archive_samples'), 0)
            ELSE COALESCE(pg_total_relation_size('archive_samples'), 0)
          END AS db_size_bytes,
          (SELECT MIN(time) FROM archive_samples) AS oldest_sample_time,
          (SELECT MAX(time) FROM archive_samples) AS newest_sample_time,
          meta.is_hypertable,
          meta.hypertable_chunks
      FROM meta
      `,
    );
    const row = result.rows[0];
    const estimatedCountRaw = row?.estimated_count ?? 0;
    const dbSizeBytesRaw = row?.db_size_bytes ?? 0;
    const estimatedCount = typeof estimatedCountRaw === "string" ? Number.parseInt(estimatedCountRaw, 10) : Number(estimatedCountRaw);
    const dbSizeBytes = typeof dbSizeBytesRaw === "string" ? Number.parseInt(dbSizeBytesRaw, 10) : Number(dbSizeBytesRaw);
    const chunkCountRaw = row?.hypertable_chunks ?? null;
    const hypertableChunks = chunkCountRaw === null
      ? null
      : (typeof chunkCountRaw === "string" ? Number.parseInt(chunkCountRaw, 10) : Number(chunkCountRaw));

    let actualSamplesCount: number | null = null;
    if (includeActualCount) {
      const actualResult = await this.pool.query<{ actual_count: string | number | null }>(
        "SELECT COUNT(*)::bigint AS actual_count FROM archive_samples",
      );
      const actualRaw = actualResult.rows[0]?.actual_count ?? null;
      if (actualRaw !== null) {
        const parsed = typeof actualRaw === "string" ? Number.parseInt(actualRaw, 10) : Number(actualRaw);
        actualSamplesCount = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
      }
    }

    const normalizedEstimated = Number.isFinite(estimatedCount) ? Math.max(0, Math.round(estimatedCount)) : 0;
    return {
      recordsCount: normalizedEstimated,
      dbSizeMb: Number.isFinite(dbSizeBytes) ? Math.max(0, dbSizeBytes / (1024 * 1024)) : 0,
      estimatedSamplesCount: normalizedEstimated,
      actualSamplesCount,
      oldestSampleTime: row?.oldest_sample_time ? row.oldest_sample_time.toISOString() : null,
      newestSampleTime: row?.newest_sample_time ? row.newest_sample_time.toISOString() : null,
      isHypertable: row?.is_hypertable === true,
      hypertableChunks: Number.isFinite(hypertableChunks as number) ? Math.max(0, Math.round(hypertableChunks as number)) : null,
    };
  }

  public async getRuntimeSettings(): Promise<ArchiveRuntimeSettingsRow> {
    const result = await this.pool.query<{
      auto_cleanup_enabled: boolean;
      max_db_size_mb: number | null;
      delete_batch_size: number | null;
      maintenance_interval_ms: number | null;
      max_maintenance_tick_ms: number | null;
      max_delete_transaction_ms: number | null;
      updated_at: Date;
    }>(
      `
      SELECT
          auto_cleanup_enabled,
          max_db_size_mb,
          delete_batch_size,
          maintenance_interval_ms,
          max_maintenance_tick_ms,
          max_delete_transaction_ms,
          updated_at
      FROM archive_runtime_settings
      WHERE id = 1
      `,
    );
    const row = result.rows[0];
    if (!row) {
      return {
        autoCleanupEnabled: true,
        maxDbSizeMb: 5120,
        deleteBatchSize: this.defaultDeleteBatchSize,
        maintenanceIntervalMs: this.defaultMaintenanceIntervalMs,
        maxMaintenanceTickMs: this.defaultMaxMaintenanceTickMs,
        maxDeleteTransactionMs: this.defaultMaxDeleteTransactionMs,
        updatedAt: new Date(0).toISOString(),
      };
    }
    return {
      autoCleanupEnabled: row.auto_cleanup_enabled,
      maxDbSizeMb: row.max_db_size_mb,
      deleteBatchSize: this.normalizeBoundedInteger(
        row.delete_batch_size,
        this.defaultDeleteBatchSize,
        MIN_DELETE_BATCH_SIZE,
        MAX_DELETE_BATCH_SIZE,
      ),
      maintenanceIntervalMs: this.normalizeBoundedInteger(
        row.maintenance_interval_ms,
        this.defaultMaintenanceIntervalMs,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      ),
      maxMaintenanceTickMs: Math.max(
        this.normalizeBoundedInteger(
          row.max_maintenance_tick_ms,
          this.defaultMaxMaintenanceTickMs,
          MIN_MAX_MAINTENANCE_TICK_MS,
          MAX_MAX_MAINTENANCE_TICK_MS,
        ),
        this.normalizeBoundedInteger(
          row.max_delete_transaction_ms,
          this.defaultMaxDeleteTransactionMs,
          MIN_MAX_DELETE_TRANSACTION_MS,
          MAX_MAX_DELETE_TRANSACTION_MS,
        ),
      ),
      maxDeleteTransactionMs: this.normalizeBoundedInteger(
        row.max_delete_transaction_ms,
        this.defaultMaxDeleteTransactionMs,
        MIN_MAX_DELETE_TRANSACTION_MS,
        MAX_MAX_DELETE_TRANSACTION_MS,
      ),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  public async updateRuntimeSettings(settings: {
    autoCleanupEnabled: boolean;
    maxDbSizeMb: number | null;
    deleteBatchSize: number;
    maintenanceIntervalMs: number;
    maxMaintenanceTickMs: number;
    maxDeleteTransactionMs: number;
  }): Promise<ArchiveRuntimeSettingsRow> {
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
    const boundedMaxMaintenanceTickMs = Math.max(
      this.normalizeBoundedInteger(
        settings.maxMaintenanceTickMs,
        this.defaultMaxMaintenanceTickMs,
        MIN_MAX_MAINTENANCE_TICK_MS,
        MAX_MAX_MAINTENANCE_TICK_MS,
      ),
      boundedMaxDeleteTransactionMs,
    );

    const result = await this.pool.query<{
      auto_cleanup_enabled: boolean;
      max_db_size_mb: number | null;
      delete_batch_size: number | null;
      maintenance_interval_ms: number | null;
      max_maintenance_tick_ms: number | null;
      max_delete_transaction_ms: number | null;
      updated_at: Date;
    }>(
      `
      INSERT INTO archive_runtime_settings (
          id,
          auto_cleanup_enabled,
          max_db_size_mb,
          max_data_age_months,
          delete_batch_size,
          maintenance_interval_ms,
          max_maintenance_tick_ms,
          max_delete_transaction_ms,
          updated_at
      )
      VALUES (1, $1, $2, NULL, $3, $4, $5, $6, now())
      ON CONFLICT (id) DO UPDATE
      SET auto_cleanup_enabled = EXCLUDED.auto_cleanup_enabled,
          max_db_size_mb = EXCLUDED.max_db_size_mb,
          max_data_age_months = NULL,
          delete_batch_size = EXCLUDED.delete_batch_size,
          maintenance_interval_ms = EXCLUDED.maintenance_interval_ms,
          max_maintenance_tick_ms = EXCLUDED.max_maintenance_tick_ms,
          max_delete_transaction_ms = EXCLUDED.max_delete_transaction_ms,
          updated_at = now()
      RETURNING
          auto_cleanup_enabled,
          max_db_size_mb,
          delete_batch_size,
          maintenance_interval_ms,
          max_maintenance_tick_ms,
          max_delete_transaction_ms,
          updated_at
      `,
      [
        settings.autoCleanupEnabled,
        settings.maxDbSizeMb,
        boundedDeleteBatchSize,
        boundedMaintenanceIntervalMs,
        boundedMaxMaintenanceTickMs,
        boundedMaxDeleteTransactionMs,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to update archive runtime settings");
    }
    return {
      autoCleanupEnabled: row.auto_cleanup_enabled,
      maxDbSizeMb: row.max_db_size_mb,
      deleteBatchSize: this.normalizeBoundedInteger(
        row.delete_batch_size,
        this.defaultDeleteBatchSize,
        MIN_DELETE_BATCH_SIZE,
        MAX_DELETE_BATCH_SIZE,
      ),
      maintenanceIntervalMs: this.normalizeBoundedInteger(
        row.maintenance_interval_ms,
        this.defaultMaintenanceIntervalMs,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      ),
      maxMaintenanceTickMs: Math.max(
        this.normalizeBoundedInteger(
          row.max_maintenance_tick_ms,
          this.defaultMaxMaintenanceTickMs,
          MIN_MAX_MAINTENANCE_TICK_MS,
          MAX_MAX_MAINTENANCE_TICK_MS,
        ),
        this.normalizeBoundedInteger(
          row.max_delete_transaction_ms,
          this.defaultMaxDeleteTransactionMs,
          MIN_MAX_DELETE_TRANSACTION_MS,
          MAX_MAX_DELETE_TRANSACTION_MS,
        ),
      ),
      maxDeleteTransactionMs: this.normalizeBoundedInteger(
        row.max_delete_transaction_ms,
        this.defaultMaxDeleteTransactionMs,
        MIN_MAX_DELETE_TRANSACTION_MS,
        MAX_MAX_DELETE_TRANSACTION_MS,
      ),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  public async previewArchiveDataPurge(): Promise<ArchivePurgePreviewRow> {
    const result = await this.pool.query<{
      samples_count: string | number;
      samples_size_bytes: string | number;
      total_size_bytes: string | number;
      oldest_sample_time: Date | null;
      newest_sample_time: Date | null;
    }>(
      `
      SELECT
          (SELECT COUNT(*)::bigint FROM archive_samples) AS samples_count,
          COALESCE(pg_total_relation_size('archive_samples'), 0) AS samples_size_bytes,
          (
            COALESCE(pg_total_relation_size('archive_samples'), 0)
            + COALESCE(pg_total_relation_size('archive_aggregates_1m'), 0)
            + COALESCE(pg_total_relation_size('archive_events'), 0)
            + COALESCE(pg_total_relation_size('archive_alarms'), 0)
          ) AS total_size_bytes,
          (SELECT MIN(time) FROM archive_samples) AS oldest_sample_time,
          (SELECT MAX(time) FROM archive_samples) AS newest_sample_time
      `,
    );
    const row = result.rows[0];
    const samplesCountRaw = row?.samples_count ?? 0;
    const samplesSizeBytesRaw = row?.samples_size_bytes ?? 0;
    const totalSizeBytesRaw = row?.total_size_bytes ?? 0;
    const samplesCount = typeof samplesCountRaw === "string" ? Number.parseInt(samplesCountRaw, 10) : Number(samplesCountRaw);
    const samplesSizeBytes = typeof samplesSizeBytesRaw === "string" ? Number.parseInt(samplesSizeBytesRaw, 10) : Number(samplesSizeBytesRaw);
    const totalSizeBytes = typeof totalSizeBytesRaw === "string" ? Number.parseInt(totalSizeBytesRaw, 10) : Number(totalSizeBytesRaw);
    return {
      scope: "archive_data",
      tables: ["archive_samples", "archive_aggregates_1m", "archive_events", "archive_alarms"],
      samplesCount: Number.isFinite(samplesCount) ? Math.max(0, Math.round(samplesCount)) : 0,
      samplesSizeMb: Number.isFinite(samplesSizeBytes) ? Math.max(0, samplesSizeBytes / (1024 * 1024)) : 0,
      totalSizeMb: Number.isFinite(totalSizeBytes) ? Math.max(0, totalSizeBytes / (1024 * 1024)) : 0,
      oldestSampleTime: row?.oldest_sample_time ? row.oldest_sample_time.toISOString() : null,
      newestSampleTime: row?.newest_sample_time ? row.newest_sample_time.toISOString() : null,
    };
  }

  public async clearArchiveData(): Promise<ArchivePurgeResultRow> {
    const preview = await this.previewArchiveDataPurge();
    await this.pool.query(
      "TRUNCATE TABLE archive_samples, archive_aggregates_1m, archive_events, archive_alarms RESTART IDENTITY",
    );
    return {
      scope: "archive_data",
      clearedSamples: preview.samplesCount,
      clearedTotalSizeMb: preview.totalSizeMb,
      tables: preview.tables,
    };
  }

  public async listActiveEventOccurrences(limit = 200): Promise<EventOccurrence[]> {
    return this.withEventQueryActivity(async () => this.listEventOccurrencesByClause("cleared_at IS NULL", limit));
  }

  public async listOnlineEventOccurrences(
    limit = 200,
    includeClearedUnacknowledged = false,
  ): Promise<EventOccurrence[]> {
    return this.withEventQueryActivity(async () => {
      const whereClause = includeClearedUnacknowledged
        ? "(cleared_at IS NULL OR (cleared_at IS NOT NULL AND acknowledged_at IS NULL))"
        : "cleared_at IS NULL";
      return this.listEventOccurrencesByClause(whereClause, limit);
    });
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
    const row = await this.pool.query<{
      id: number;
      event_definition_id: string;
      occurred_at: Date;
      cleared_at: Date | null;
      acknowledged_at: Date | null;
      acknowledged_by: string | null;
      state: string;
      source_tag_name_snapshot: string | null;
      category_id_snapshot: string | null;
      category_name_snapshot: string | null;
      priority_snapshot: number | null;
      message_text_snapshot: string | null;
      value_at_trigger: string | null;
      value_at_clear: string | null;
      quality: string | null;
      runtime_source: string | null;
      service_data: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `
      INSERT INTO event_occurrences (
          event_definition_id,
          occurred_at,
          cleared_at,
          acknowledged_at,
          acknowledged_by,
          state,
          source_tag_name_snapshot,
          category_id_snapshot,
          category_name_snapshot,
          priority_snapshot,
          message_text_snapshot,
          value_at_trigger,
          value_at_clear,
          quality,
          runtime_source,
          service_data,
          created_at,
          updated_at
      )
      VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), now()
      )
      RETURNING
          id,
          event_definition_id,
          occurred_at,
          cleared_at,
          acknowledged_at,
          acknowledged_by,
          state,
          source_tag_name_snapshot,
          category_id_snapshot,
          category_name_snapshot,
          priority_snapshot,
          message_text_snapshot,
          value_at_trigger,
          value_at_clear,
          quality,
          runtime_source,
          service_data,
          created_at,
          updated_at
      `,
      [
        input.eventDefinitionId,
        input.occurredAt,
        input.clearedAt ?? null,
        input.acknowledgedAt ?? null,
        input.acknowledgedBy ?? null,
        input.state,
        input.sourceTagNameSnapshot ?? null,
        input.categoryIdSnapshot ?? null,
        input.categoryNameSnapshot ?? null,
        input.prioritySnapshot ?? null,
        input.messageTextSnapshot ?? null,
        this.serializeEventValue(input.valueAtTrigger),
        this.serializeEventValue(input.valueAtClear),
        input.quality ?? null,
        input.runtimeSource ?? null,
        input.serviceData ?? null,
      ],
    );

    const created = row.rows[0];
    if (!created) {
      throw new Error("Failed to create event occurrence");
    }
    return this.mapEventOccurrenceRow(created);
  }

  public async clearEventOccurrence(
    id: string | number,
    clearedAt: Date,
    valueAtClear?: TagScalarValue,
  ): Promise<EventOccurrence | null> {
    const result = await this.pool.query<{
      id: number;
      event_definition_id: string;
      occurred_at: Date;
      cleared_at: Date | null;
      acknowledged_at: Date | null;
      acknowledged_by: string | null;
      state: string;
      source_tag_name_snapshot: string | null;
      category_id_snapshot: string | null;
      category_name_snapshot: string | null;
      priority_snapshot: number | null;
      message_text_snapshot: string | null;
      value_at_trigger: string | null;
      value_at_clear: string | null;
      quality: string | null;
      runtime_source: string | null;
      service_data: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `
      UPDATE event_occurrences
      SET
          cleared_at = COALESCE(cleared_at, $2),
          value_at_clear = COALESCE(value_at_clear, $3),
          state = CASE
              WHEN acknowledged_at IS NOT NULL THEN 'acknowledged'
              ELSE 'cleared'
          END,
          updated_at = now()
      WHERE id = $1::bigint
      RETURNING
          id,
          event_definition_id,
          occurred_at,
          cleared_at,
          acknowledged_at,
          acknowledged_by,
          state,
          source_tag_name_snapshot,
          category_id_snapshot,
          category_name_snapshot,
          priority_snapshot,
          message_text_snapshot,
          value_at_trigger,
          value_at_clear,
          quality,
          runtime_source,
          service_data,
          created_at,
          updated_at
      `,
      [id, clearedAt, this.serializeEventValue(valueAtClear)],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return this.mapEventOccurrenceRow(row);
  }

  public async acknowledgeEventOccurrence(
    id: string | number,
    acknowledgedAt: Date,
    acknowledgedBy?: string | null,
  ): Promise<EventOccurrence | null> {
    const result = await this.pool.query<{
      id: number;
      event_definition_id: string;
      occurred_at: Date;
      cleared_at: Date | null;
      acknowledged_at: Date | null;
      acknowledged_by: string | null;
      state: string;
      source_tag_name_snapshot: string | null;
      category_id_snapshot: string | null;
      category_name_snapshot: string | null;
      priority_snapshot: number | null;
      message_text_snapshot: string | null;
      value_at_trigger: string | null;
      value_at_clear: string | null;
      quality: string | null;
      runtime_source: string | null;
      service_data: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `
      UPDATE event_occurrences
      SET
          acknowledged_at = COALESCE(acknowledged_at, $2),
          acknowledged_by = COALESCE(acknowledged_by, $3),
          state = CASE
              WHEN cleared_at IS NULL THEN 'active'
              ELSE 'acknowledged'
          END,
          updated_at = now()
      WHERE id = $1::bigint
      RETURNING
          id,
          event_definition_id,
          occurred_at,
          cleared_at,
          acknowledged_at,
          acknowledged_by,
          state,
          source_tag_name_snapshot,
          category_id_snapshot,
          category_name_snapshot,
          priority_snapshot,
          message_text_snapshot,
          value_at_trigger,
          value_at_clear,
          quality,
          runtime_source,
          service_data,
          created_at,
          updated_at
      `,
      [id, acknowledgedAt, acknowledgedBy ?? null],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return this.mapEventOccurrenceRow(row);
  }

  public async getEventOccurrencesByIds(ids: Array<string | number>): Promise<EventOccurrence[]> {
    return this.withEventQueryActivity(async () => {
      if (ids.length === 0) {
        return [];
      }
      const rows = await this.pool.query<{
      id: number;
      event_definition_id: string;
      occurred_at: Date;
      cleared_at: Date | null;
      acknowledged_at: Date | null;
      acknowledged_by: string | null;
      state: string;
      source_tag_name_snapshot: string | null;
      category_id_snapshot: string | null;
      category_name_snapshot: string | null;
      priority_snapshot: number | null;
      message_text_snapshot: string | null;
      value_at_trigger: string | null;
      value_at_clear: string | null;
      quality: string | null;
      runtime_source: string | null;
      service_data: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `
      SELECT
          id,
          event_definition_id,
          occurred_at,
          cleared_at,
          acknowledged_at,
          acknowledged_by,
          state,
          source_tag_name_snapshot,
          category_id_snapshot,
          category_name_snapshot,
          priority_snapshot,
          message_text_snapshot,
          value_at_trigger,
          value_at_clear,
          quality,
          runtime_source,
          service_data,
          created_at,
          updated_at
      FROM event_occurrences
      WHERE id = ANY($1::bigint[])
      ORDER BY id ASC
      `,
      [ids.map((item) => String(item))],
    );
      return rows.rows.map((row) => this.mapEventOccurrenceRow(row));
    });
  }

  public async queryEventOccurrences(filters: EventHistoryQuery): Promise<EventHistoryPage> {
    return this.withEventQueryActivity(async () => {
      const whereParts: string[] = [];
      const params: unknown[] = [];

    const addParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    if (filters.from) {
      whereParts.push(`occurred_at >= ${addParam(new Date(filters.from))}`);
    }
    if (filters.to) {
      whereParts.push(`occurred_at <= ${addParam(new Date(filters.to))}`);
    }
    if (filters.category) {
      const categoryParam = addParam(filters.category);
      whereParts.push(
        `(COALESCE(category_name_snapshot, '') = ${categoryParam} OR COALESCE(category_id_snapshot, '') = ${categoryParam})`,
      );
    }
    if (typeof filters.priority === "number") {
      whereParts.push(`priority_snapshot = ${addParam(filters.priority)}`);
    }
    if (filters.sourceTagName) {
      whereParts.push(`source_tag_name_snapshot = ${addParam(filters.sourceTagName)}`);
    }
    if (filters.state) {
      whereParts.push(`state = ${addParam(filters.state)}`);
    }
    if (filters.search?.trim()) {
      const pattern = `%${filters.search.trim()}%`;
      whereParts.push(`(
        COALESCE(message_text_snapshot, '') ILIKE ${addParam(pattern)}
        OR COALESCE(source_tag_name_snapshot, '') ILIKE ${addParam(pattern)}
        OR COALESCE(category_name_snapshot, '') ILIKE ${addParam(pattern)}
        OR COALESCE(event_definition_id, '') ILIKE ${addParam(pattern)}
      )`);
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(5000, filters.limit ?? 200));
    const offset = Math.max(0, filters.offset ?? 0);

    const countQuery = await this.pool.query<{ total: string | number }>(
      `SELECT COUNT(*)::bigint AS total FROM event_occurrences ${whereSql}`,
      params,
    );
    const totalRaw = countQuery.rows[0]?.total ?? 0;
    const total = typeof totalRaw === "string" ? Number.parseInt(totalRaw, 10) : Number(totalRaw);

    const queryParams = [...params, limit, offset];
    const rows = await this.pool.query<{
      id: number;
      event_definition_id: string;
      occurred_at: Date;
      cleared_at: Date | null;
      acknowledged_at: Date | null;
      acknowledged_by: string | null;
      state: string;
      source_tag_name_snapshot: string | null;
      category_id_snapshot: string | null;
      category_name_snapshot: string | null;
      priority_snapshot: number | null;
      message_text_snapshot: string | null;
      value_at_trigger: string | null;
      value_at_clear: string | null;
      quality: string | null;
      runtime_source: string | null;
      service_data: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `
      SELECT
          id,
          event_definition_id,
          occurred_at,
          cleared_at,
          acknowledged_at,
          acknowledged_by,
          state,
          source_tag_name_snapshot,
          category_id_snapshot,
          category_name_snapshot,
          priority_snapshot,
          message_text_snapshot,
          value_at_trigger,
          value_at_clear,
          quality,
          runtime_source,
          service_data,
          created_at,
          updated_at
      FROM event_occurrences
      ${whereSql}
      ORDER BY occurred_at DESC, id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      queryParams,
    );

    const items: EventHistoryRecord[] = rows.rows.map((row) => this.mapEventOccurrenceRow(row));

      return {
        items,
        total: Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0,
        limit,
        offset,
      };
    });
  }

  public async getEventArchiveSettings(): Promise<EventArchiveSettings> {
    const result = await this.pool.query<{
      enabled: boolean;
      retention_days: number;
      max_database_size_mb: number;
      cleanup_mode: string;
      cleanup_interval_minutes: number;
      optimize_after_cleanup: boolean;
      delete_batch_size: number | null;
      maintenance_interval_ms: number | null;
      max_maintenance_tick_ms: number | null;
      max_delete_transaction_ms: number | null;
      updated_at: Date;
    }>(
      `
      SELECT
          enabled,
          retention_days,
          max_database_size_mb,
          cleanup_mode,
          cleanup_interval_minutes,
          optimize_after_cleanup,
          delete_batch_size,
          maintenance_interval_ms,
          max_maintenance_tick_ms,
          max_delete_transaction_ms,
          updated_at
      FROM event_archive_settings
      WHERE id = 1
      `,
    );
    const row = result.rows[0];
    if (!row) {
      return {
        enabled: true,
        retentionDays: 90,
        maxDatabaseSizeMb: 2048,
        cleanupMode: "byAgeAndSize",
        cleanupIntervalMinutes: 60,
        optimizeAfterCleanup: false,
        deleteBatchSize: this.defaultDeleteBatchSize,
        maintenanceIntervalMs: this.defaultMaintenanceIntervalMs,
        maxMaintenanceTickMs: this.defaultMaxMaintenanceTickMs,
        maxDeleteTransactionMs: this.defaultMaxDeleteTransactionMs,
        updatedAt: new Date(0).toISOString(),
      };
    }
    const maxDeleteTransactionMs = this.normalizeBoundedInteger(
      row.max_delete_transaction_ms,
      this.defaultMaxDeleteTransactionMs,
      MIN_MAX_DELETE_TRANSACTION_MS,
      MAX_MAX_DELETE_TRANSACTION_MS,
    );
    return {
      enabled: row.enabled,
      retentionDays: row.retention_days,
      maxDatabaseSizeMb: row.max_database_size_mb,
      cleanupMode: (row.cleanup_mode as EventArchiveCleanupMode) ?? "byAgeAndSize",
      cleanupIntervalMinutes: row.cleanup_interval_minutes,
      optimizeAfterCleanup: row.optimize_after_cleanup,
      deleteBatchSize: this.normalizeBoundedInteger(
        row.delete_batch_size,
        this.defaultDeleteBatchSize,
        MIN_DELETE_BATCH_SIZE,
        MAX_DELETE_BATCH_SIZE,
      ),
      maintenanceIntervalMs: this.normalizeBoundedInteger(
        row.maintenance_interval_ms,
        this.defaultMaintenanceIntervalMs,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      ),
      maxMaintenanceTickMs: Math.max(
        this.normalizeBoundedInteger(
          row.max_maintenance_tick_ms,
          this.defaultMaxMaintenanceTickMs,
          MIN_MAX_MAINTENANCE_TICK_MS,
          MAX_MAX_MAINTENANCE_TICK_MS,
        ),
        maxDeleteTransactionMs,
      ),
      maxDeleteTransactionMs,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  public async updateEventArchiveSettings(settings: EventArchiveSettings): Promise<EventArchiveSettings> {
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
    const boundedMaxMaintenanceTickMs = Math.max(
      this.normalizeBoundedInteger(
        settings.maxMaintenanceTickMs,
        this.defaultMaxMaintenanceTickMs,
        MIN_MAX_MAINTENANCE_TICK_MS,
        MAX_MAX_MAINTENANCE_TICK_MS,
      ),
      boundedMaxDeleteTransactionMs,
    );
    const result = await this.pool.query<{
      enabled: boolean;
      retention_days: number;
      max_database_size_mb: number;
      cleanup_mode: string;
      cleanup_interval_minutes: number;
      optimize_after_cleanup: boolean;
      delete_batch_size: number | null;
      maintenance_interval_ms: number | null;
      max_maintenance_tick_ms: number | null;
      max_delete_transaction_ms: number | null;
      updated_at: Date;
    }>(
      `
      INSERT INTO event_archive_settings (
        id,
        enabled,
        retention_days,
        max_database_size_mb,
        cleanup_mode,
        cleanup_interval_minutes,
        optimize_after_cleanup,
        delete_batch_size,
        maintenance_interval_ms,
        max_maintenance_tick_ms,
        max_delete_transaction_ms,
        updated_at
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
      ON CONFLICT (id) DO UPDATE
      SET enabled = EXCLUDED.enabled,
          retention_days = EXCLUDED.retention_days,
          max_database_size_mb = EXCLUDED.max_database_size_mb,
          cleanup_mode = EXCLUDED.cleanup_mode,
          cleanup_interval_minutes = EXCLUDED.cleanup_interval_minutes,
          optimize_after_cleanup = EXCLUDED.optimize_after_cleanup,
          delete_batch_size = EXCLUDED.delete_batch_size,
          maintenance_interval_ms = EXCLUDED.maintenance_interval_ms,
          max_maintenance_tick_ms = EXCLUDED.max_maintenance_tick_ms,
          max_delete_transaction_ms = EXCLUDED.max_delete_transaction_ms,
          updated_at = now()
      RETURNING
          enabled,
          retention_days,
          max_database_size_mb,
          cleanup_mode,
          cleanup_interval_minutes,
          optimize_after_cleanup,
          delete_batch_size,
          maintenance_interval_ms,
          max_maintenance_tick_ms,
          max_delete_transaction_ms,
          updated_at
      `,
      [
        settings.enabled,
        settings.retentionDays,
        settings.maxDatabaseSizeMb,
        settings.cleanupMode,
        settings.cleanupIntervalMinutes,
        settings.optimizeAfterCleanup,
        boundedDeleteBatchSize,
        boundedMaintenanceIntervalMs,
        boundedMaxMaintenanceTickMs,
        boundedMaxDeleteTransactionMs,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to update event archive settings");
    }
    return {
      enabled: row.enabled,
      retentionDays: row.retention_days,
      maxDatabaseSizeMb: row.max_database_size_mb,
      cleanupMode: (row.cleanup_mode as EventArchiveCleanupMode) ?? "byAgeAndSize",
      cleanupIntervalMinutes: row.cleanup_interval_minutes,
      optimizeAfterCleanup: row.optimize_after_cleanup,
      deleteBatchSize: this.normalizeBoundedInteger(
        row.delete_batch_size,
        this.defaultDeleteBatchSize,
        MIN_DELETE_BATCH_SIZE,
        MAX_DELETE_BATCH_SIZE,
      ),
      maintenanceIntervalMs: this.normalizeBoundedInteger(
        row.maintenance_interval_ms,
        this.defaultMaintenanceIntervalMs,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      ),
      maxMaintenanceTickMs: Math.max(
        this.normalizeBoundedInteger(
          row.max_maintenance_tick_ms,
          this.defaultMaxMaintenanceTickMs,
          MIN_MAX_MAINTENANCE_TICK_MS,
          MAX_MAX_MAINTENANCE_TICK_MS,
        ),
        this.normalizeBoundedInteger(
          row.max_delete_transaction_ms,
          this.defaultMaxDeleteTransactionMs,
          MIN_MAX_DELETE_TRANSACTION_MS,
          MAX_MAX_DELETE_TRANSACTION_MS,
        ),
      ),
      maxDeleteTransactionMs: this.normalizeBoundedInteger(
        row.max_delete_transaction_ms,
        this.defaultMaxDeleteTransactionMs,
        MIN_MAX_DELETE_TRANSACTION_MS,
        MAX_MAX_DELETE_TRANSACTION_MS,
      ),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  public async getEventArchiveStatus(): Promise<EventArchiveStatusRow> {
    const settings = await this.getEventArchiveSettings();
    const result = await this.pool.query<{
      records_count: string | number;
      db_size_bytes: string | number;
      oldest_record_at: Date | null;
      newest_record_at: Date | null;
    }>(
      `
      SELECT
          (SELECT COUNT(*)::bigint FROM event_occurrences) AS records_count,
          COALESCE(pg_total_relation_size('event_occurrences'), 0) AS db_size_bytes,
          (SELECT MIN(occurred_at) FROM event_occurrences) AS oldest_record_at,
          (SELECT MAX(occurred_at) FROM event_occurrences) AS newest_record_at
      `,
    );
    const row = result.rows[0];
    const recordsCountRaw = row?.records_count ?? 0;
    const dbSizeBytesRaw = row?.db_size_bytes ?? 0;
    const recordsCount = typeof recordsCountRaw === "string" ? Number.parseInt(recordsCountRaw, 10) : Number(recordsCountRaw);
    const dbSizeBytes = typeof dbSizeBytesRaw === "string" ? Number.parseInt(dbSizeBytesRaw, 10) : Number(dbSizeBytesRaw);
    return {
      dbSizeMb: Number.isFinite(dbSizeBytes) ? Math.max(0, dbSizeBytes / (1024 * 1024)) : 0,
      recordsCount: Number.isFinite(recordsCount) ? Math.max(0, Math.round(recordsCount)) : 0,
      oldestRecordAt: row?.oldest_record_at ? row.oldest_record_at.toISOString() : null,
      newestRecordAt: row?.newest_record_at ? row.newest_record_at.toISOString() : null,
      settings,
    };
  }

  public async cleanupEventArchive(options?: {
    retentionDays?: number;
    maxDatabaseSizeMb?: number;
    cleanupMode?: EventArchiveCleanupMode;
    optimizeAfterCleanup?: boolean;
    maxBatches?: number;
    maxManualCleanupMs?: number;
  }): Promise<EventArchiveCleanupResultRow> {
    const settings = await this.getEventArchiveSettings();
    if (!settings.enabled) {
      return {
        deletedByAge: 0,
        deletedBySize: 0,
        optimized: false,
      };
    }

    const cleanupMode = options?.cleanupMode ?? settings.cleanupMode;
    const retentionDays = Math.max(1, Math.round(options?.retentionDays ?? settings.retentionDays));
    const maxDatabaseSizeMb = Math.max(1, Math.round(options?.maxDatabaseSizeMb ?? settings.maxDatabaseSizeMb));
    const optimizeAfterCleanup = options?.optimizeAfterCleanup ?? settings.optimizeAfterCleanup;
    const deleteBatchSize = this.normalizeBoundedInteger(
      settings.deleteBatchSize,
      this.defaultDeleteBatchSize,
      MIN_DELETE_BATCH_SIZE,
      MAX_DELETE_BATCH_SIZE,
    );
    const maxDeleteTransactionMs = this.normalizeBoundedInteger(
      settings.maxDeleteTransactionMs,
      this.defaultMaxDeleteTransactionMs,
      MIN_MAX_DELETE_TRANSACTION_MS,
      MAX_MAX_DELETE_TRANSACTION_MS,
    );
    const maxBatches = this.normalizeBoundedInteger(
      options?.maxBatches,
      DEFAULT_MANUAL_CLEANUP_MAX_BATCHES,
      1,
      1_000,
    );
    const maxManualCleanupMs = this.normalizeBoundedInteger(
      options?.maxManualCleanupMs,
      DEFAULT_MANUAL_CLEANUP_MAX_DURATION_MS,
      100,
      60_000,
    );
    const startedAt = Date.now();

    let deletedByAge = 0;
    let deletedBySize = 0;

    if (cleanupMode === "byAge" || cleanupMode === "byAgeAndSize") {
      let safetyCounter = 0;
      while (safetyCounter < maxBatches && (Date.now() - startedAt) < maxManualCleanupMs) {
        safetyCounter += 1;
        const deleted = await this.deleteEventOccurrencesByRetentionBatch({
          retentionDays,
          limit: deleteBatchSize,
          maxTransactionMs: maxDeleteTransactionMs,
        });
        deletedByAge += deleted.deletedRecords;
        if (deleted.deletedRecords < deleteBatchSize) {
          break;
        }
      }
    }

    if (cleanupMode === "bySize" || cleanupMode === "byAgeAndSize") {
      const sizeLimitBytes = maxDatabaseSizeMb * 1024 * 1024;
      let safetyCounter = 0;
      while (safetyCounter < maxBatches && (Date.now() - startedAt) < maxManualCleanupMs) {
        safetyCounter += 1;
        const sizeState = await this.readSizedTableStats("event_occurrences", "occurred_at");
        if (!Number.isFinite(sizeState.currentBytes) || sizeState.currentBytes <= sizeLimitBytes) {
          break;
        }
        if (!Number.isFinite(sizeState.recordsCount) || sizeState.recordsCount <= 0) {
          break;
        }
        const deleted = await this.deleteOldestEventOccurrencesBatch({
          limit: deleteBatchSize,
          maxTransactionMs: maxDeleteTransactionMs,
        });
        deletedBySize += deleted.deletedRecords;
        if (deleted.deletedRecords === 0) {
          break;
        }
      }
    }

    let optimized = false;
    if (optimizeAfterCleanup) {
      await this.optimizeEventArchive();
      optimized = true;
    }

    return {
      deletedByAge,
      deletedBySize,
      optimized,
    };
  }

  public async optimizeEventArchive(): Promise<void> {
    try {
      await this.pool.query("VACUUM (ANALYZE) event_occurrences");
    } catch (error) {
      this.logger.warn(`Event archive analyze failed: ${this.errorText(error)}`);
    }
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
    return this.withOperatorActionWriteActivity(async () => {
      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
      const result = await this.pool.query<{
      id: number;
      occurred_at: Date;
      user_id: string | null;
      username: string | null;
      user_role: string | null;
      ip: string | null;
      screen_id: string | null;
      screen_name: string | null;
      object_id: string;
      object_name: string | null;
      object_description: string | null;
      object_type: string;
      action_kind: string;
      target_type: string | null;
      target_name: string | null;
      old_value: string | null;
      new_value: string | null;
      unit: string | null;
      message_template: string | null;
      message_text: string;
      result: string;
      error_text: string | null;
      details: Record<string, unknown> | null;
      created_at: Date;
    }>(
      `
      INSERT INTO operator_actions (
        occurred_at,
        user_id,
        username,
        user_role,
        ip,
        screen_id,
        screen_name,
        object_id,
        object_name,
        object_description,
        object_type,
        action_kind,
        target_type,
        target_name,
        old_value,
        new_value,
        unit,
        message_template,
        message_text,
        result,
        error_text,
        details
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19,
        $20,
        $21,
        $22
      )
      RETURNING
        id,
        occurred_at,
        user_id,
        username,
        user_role,
        ip,
        screen_id,
        screen_name,
        object_id,
        object_name,
        object_description,
        object_type,
        action_kind,
        target_type,
        target_name,
        old_value,
        new_value,
        unit,
        message_template,
        message_text,
        result,
        error_text,
        details,
        created_at
      `,
      [
        occurredAt,
        input.userId ?? null,
        input.username ?? null,
        input.userRole ?? null,
        input.ip ?? null,
        input.screenId ?? null,
        input.screenName ?? null,
        input.objectId,
        input.objectName ?? null,
        input.objectDescription ?? null,
        input.objectType,
        input.actionKind,
        input.targetType ?? null,
        input.targetName ?? null,
        this.serializeOperatorActionValue(input.oldValue),
        this.serializeOperatorActionValue(input.newValue),
        input.unit ?? null,
        input.messageTemplate ?? null,
        input.messageText,
        input.result ?? "success",
        input.errorText ?? null,
        input.details ?? null,
      ],
    );
      const row = result.rows[0];
      if (!row) {
        throw new Error("Failed to create operator action record");
      }
      return this.mapOperatorActionRow(row);
    });
  }

  public async queryOperatorActions(filters: OperatorActionHistoryQuery): Promise<OperatorActionHistoryPage> {
    return this.withOperatorActionQueryActivity(async () => {
      const whereParts: string[] = [];
      const params: unknown[] = [];

    const addParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    if (filters.from) {
      whereParts.push(`occurred_at >= ${addParam(new Date(filters.from))}`);
    }
    if (filters.to) {
      whereParts.push(`occurred_at <= ${addParam(new Date(filters.to))}`);
    }
    if (filters.user?.trim()) {
      const pattern = `%${filters.user.trim()}%`;
      whereParts.push(`(
        COALESCE(username, '') ILIKE ${addParam(pattern)}
        OR COALESCE(user_id, '') ILIKE ${addParam(pattern)}
      )`);
    }
    if (filters.objectId) {
      whereParts.push(`object_id = ${addParam(filters.objectId)}`);
    }
    if (filters.objectType) {
      whereParts.push(`object_type = ${addParam(filters.objectType)}`);
    }
    if (filters.targetName) {
      whereParts.push(`target_name = ${addParam(filters.targetName)}`);
    }
    if (filters.result) {
      whereParts.push(`result = ${addParam(filters.result)}`);
    }
    if (filters.search?.trim()) {
      const pattern = `%${filters.search.trim()}%`;
      whereParts.push(`(
        COALESCE(message_text, '') ILIKE ${addParam(pattern)}
        OR COALESCE(object_description, '') ILIKE ${addParam(pattern)}
        OR COALESCE(object_name, '') ILIKE ${addParam(pattern)}
        OR COALESCE(target_name, '') ILIKE ${addParam(pattern)}
        OR COALESCE(username, '') ILIKE ${addParam(pattern)}
      )`);
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(1000, filters.limit ?? 200));
    const offset = Math.max(0, filters.offset ?? 0);

    const countQuery = await this.pool.query<{ total: string | number }>(
      `SELECT COUNT(*)::bigint AS total FROM operator_actions ${whereSql}`,
      params,
    );
    const totalRaw = countQuery.rows[0]?.total ?? 0;
    const total = typeof totalRaw === "string" ? Number.parseInt(totalRaw, 10) : Number(totalRaw);

    const queryParams = [...params, limit, offset];
    const rows = await this.pool.query<{
      id: number;
      occurred_at: Date;
      user_id: string | null;
      username: string | null;
      user_role: string | null;
      ip: string | null;
      screen_id: string | null;
      screen_name: string | null;
      object_id: string;
      object_name: string | null;
      object_description: string | null;
      object_type: string;
      action_kind: string;
      target_type: string | null;
      target_name: string | null;
      old_value: string | null;
      new_value: string | null;
      unit: string | null;
      message_template: string | null;
      message_text: string;
      result: string;
      error_text: string | null;
      details: Record<string, unknown> | null;
      created_at: Date;
    }>(
      `
      SELECT
        id,
        occurred_at,
        user_id,
        username,
        user_role,
        ip,
        screen_id,
        screen_name,
        object_id,
        object_name,
        object_description,
        object_type,
        action_kind,
        target_type,
        target_name,
        old_value,
        new_value,
        unit,
        message_template,
        message_text,
        result,
        error_text,
        details,
        created_at
      FROM operator_actions
      ${whereSql}
      ORDER BY occurred_at DESC, id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      queryParams,
    );

      return {
        items: rows.rows.map((row) => this.mapOperatorActionRow(row)),
        total: Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0,
        limit,
        offset,
      };
    });
  }

  public async getOperatorActionArchiveStatus(settings?: OperatorActionArchiveSettings): Promise<OperatorActionArchiveStatusRow> {
    const resolvedSettingsSource = settings ?? this.defaultOperatorActionArchiveSettings();
    const resolvedMaxDeleteTransactionMs = this.normalizeBoundedInteger(
      resolvedSettingsSource.maxDeleteTransactionMs,
      this.defaultMaxDeleteTransactionMs,
      MIN_MAX_DELETE_TRANSACTION_MS,
      MAX_MAX_DELETE_TRANSACTION_MS,
    );
    const resolvedSettings: OperatorActionArchiveSettings = {
      ...resolvedSettingsSource,
      deleteBatchSize: this.normalizeBoundedInteger(
        resolvedSettingsSource.deleteBatchSize,
        this.defaultDeleteBatchSize,
        MIN_DELETE_BATCH_SIZE,
        MAX_DELETE_BATCH_SIZE,
      ),
      maintenanceIntervalMs: this.normalizeBoundedInteger(
        resolvedSettingsSource.maintenanceIntervalMs,
        this.defaultMaintenanceIntervalMs,
        MIN_MAINTENANCE_INTERVAL_MS,
        MAX_MAINTENANCE_INTERVAL_MS,
      ),
      maxMaintenanceTickMs: Math.max(
        this.normalizeBoundedInteger(
          resolvedSettingsSource.maxMaintenanceTickMs,
          this.defaultMaxMaintenanceTickMs,
          MIN_MAX_MAINTENANCE_TICK_MS,
          MAX_MAX_MAINTENANCE_TICK_MS,
        ),
        resolvedMaxDeleteTransactionMs,
      ),
      maxDeleteTransactionMs: resolvedMaxDeleteTransactionMs,
    };
    const result = await this.pool.query<{
      records_count: string | number;
      db_size_bytes: string | number;
      oldest_record_at: Date | null;
      newest_record_at: Date | null;
    }>(
      `
      SELECT
          (SELECT COUNT(*)::bigint FROM operator_actions) AS records_count,
          COALESCE(pg_total_relation_size('operator_actions'), 0) AS db_size_bytes,
          (SELECT MIN(occurred_at) FROM operator_actions) AS oldest_record_at,
          (SELECT MAX(occurred_at) FROM operator_actions) AS newest_record_at
      `,
    );
    const row = result.rows[0];
    const recordsCountRaw = row?.records_count ?? 0;
    const dbSizeBytesRaw = row?.db_size_bytes ?? 0;
    const recordsCount = typeof recordsCountRaw === "string" ? Number.parseInt(recordsCountRaw, 10) : Number(recordsCountRaw);
    const dbSizeBytes = typeof dbSizeBytesRaw === "string" ? Number.parseInt(dbSizeBytesRaw, 10) : Number(dbSizeBytesRaw);
    return {
      dbSizeMb: Number.isFinite(dbSizeBytes) ? Math.max(0, dbSizeBytes / (1024 * 1024)) : 0,
      recordsCount: Number.isFinite(recordsCount) ? Math.max(0, Math.round(recordsCount)) : 0,
      oldestRecordAt: row?.oldest_record_at ? row.oldest_record_at.toISOString() : null,
      newestRecordAt: row?.newest_record_at ? row.newest_record_at.toISOString() : null,
      settings: resolvedSettings,
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
    maxBatches?: number;
    maxManualCleanupMs?: number;
  }): Promise<OperatorActionArchiveCleanupResultRow> {
    const settings = {
      ...this.defaultOperatorActionArchiveSettings(),
      ...options,
    };
    if (!settings.enabled) {
      return {
        deletedByAge: 0,
        deletedBySize: 0,
        optimized: false,
      };
    }

    const cleanupMode = settings.cleanupMode;
    const retentionDays = Math.max(1, Math.round(settings.retentionDays));
    const maxDatabaseSizeMb = Math.max(1, Math.round(settings.maxDatabaseSizeMb));
    const deleteBatchSize = this.normalizeBoundedInteger(
      settings.deleteBatchSize,
      this.defaultDeleteBatchSize,
      MIN_DELETE_BATCH_SIZE,
      MAX_DELETE_BATCH_SIZE,
    );
    const maxDeleteTransactionMs = this.normalizeBoundedInteger(
      settings.maxDeleteTransactionMs,
      this.defaultMaxDeleteTransactionMs,
      MIN_MAX_DELETE_TRANSACTION_MS,
      MAX_MAX_DELETE_TRANSACTION_MS,
    );
    const maxBatches = this.normalizeBoundedInteger(
      options?.maxBatches,
      DEFAULT_MANUAL_CLEANUP_MAX_BATCHES,
      1,
      1_000,
    );
    const maxManualCleanupMs = this.normalizeBoundedInteger(
      options?.maxManualCleanupMs,
      DEFAULT_MANUAL_CLEANUP_MAX_DURATION_MS,
      100,
      60_000,
    );
    const startedAt = Date.now();

    let deletedByAge = 0;
    let deletedBySize = 0;

    if (cleanupMode === "byAge" || cleanupMode === "byAgeAndSize") {
      let safetyCounter = 0;
      while (safetyCounter < maxBatches && (Date.now() - startedAt) < maxManualCleanupMs) {
        safetyCounter += 1;
        const deleted = await this.deleteOperatorActionsByRetentionBatch({
          retentionDays,
          limit: deleteBatchSize,
          maxTransactionMs: maxDeleteTransactionMs,
        });
        deletedByAge += deleted.deletedRecords;
        if (deleted.deletedRecords < deleteBatchSize) {
          break;
        }
      }
    }

    if (cleanupMode === "bySize" || cleanupMode === "byAgeAndSize") {
      const sizeLimitBytes = maxDatabaseSizeMb * 1024 * 1024;
      let safetyCounter = 0;
      while (safetyCounter < maxBatches && (Date.now() - startedAt) < maxManualCleanupMs) {
        safetyCounter += 1;
        const sizeState = await this.readSizedTableStats("operator_actions", "occurred_at");
        if (!Number.isFinite(sizeState.currentBytes) || sizeState.currentBytes <= sizeLimitBytes) {
          break;
        }
        if (!Number.isFinite(sizeState.recordsCount) || sizeState.recordsCount <= 0) {
          break;
        }
        const deleted = await this.deleteOldestOperatorActionsBatch({
          limit: deleteBatchSize,
          maxTransactionMs: maxDeleteTransactionMs,
        });
        deletedBySize += deleted.deletedRecords;
        if (deleted.deletedRecords === 0) {
          break;
        }
      }
    }

    let optimized = false;
    if (settings.optimizeAfterCleanup) {
      await this.optimizeOperatorActionArchive();
      optimized = true;
    }

    return {
      deletedByAge,
      deletedBySize,
      optimized,
    };
  }

  public async optimizeOperatorActionArchive(): Promise<void> {
    try {
      await this.pool.query("VACUUM (ANALYZE) operator_actions");
    } catch (error) {
      this.logger.warn(`Operator action archive analyze failed: ${this.errorText(error)}`);
    }
  }

  public getActiveTrendQueries(): number {
    return this.activeTrendQueries;
  }

  public getActiveEventQueries(): number {
    return this.activeEventQueries;
  }

  public getActiveOperatorActionQueries(): number {
    return this.activeOperatorActionQueries;
  }

  public getActiveOperatorActionWrites(): number {
    return this.activeOperatorActionWrites;
  }

  public async deleteOldestSamplesBatch(options: {
    limit: number;
    maxTransactionMs: number;
  }): Promise<ArchivePruneBatchResultRow> {
    const limit = this.normalizePositiveInteger(options.limit, this.defaultDeleteBatchSize);
    const maxTransactionMs = this.normalizePositiveInteger(options.maxTransactionMs, this.defaultMaxDeleteTransactionMs);
    const client = await this.pool.connect();
    const startedAt = Date.now();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [`${maxTransactionMs}ms`]);
      const diagnostics = await this.readTrendDeleteDiagnostics(client, limit);
      const result = await client.query(
        `
        WITH oldest AS (
          SELECT tag_id, time
          FROM archive_samples
          ORDER BY time ASC
          LIMIT $1
        )
        DELETE FROM archive_samples s
        USING oldest
        WHERE s.tag_id = oldest.tag_id
          AND s.time = oldest.time
        `,
        [limit],
      );
      await client.query("COMMIT");
      const deletedRecords = result.rowCount ?? 0;
      return {
        deletedRecords,
        durationMs: Math.max(0, Date.now() - startedAt),
        diagnostics: deletedRecords === 0
          ? {
            ...diagnostics,
            reason: diagnostics.candidateRows > 0
              ? "size above threshold but DELETE returned 0 despite available candidates"
              : "size above threshold but no oldest candidates were selected",
          }
          : undefined,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      if (this.isStatementTimeoutError(error)) {
        this.logger.warn(`Trend size-delete timed out after ${maxTransactionMs} ms (limit=${limit})`);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async deleteEventOccurrencesByRetentionBatch(options: {
    retentionDays: number;
    limit: number;
    maxTransactionMs: number;
  }): Promise<ArchivePruneBatchResultRow> {
    const retentionDays = Math.max(1, Math.round(options.retentionDays));
    const limit = this.normalizeBoundedInteger(
      options.limit,
      this.defaultDeleteBatchSize,
      MIN_DELETE_BATCH_SIZE,
      MAX_DELETE_BATCH_SIZE,
    );
    const maxTransactionMs = this.normalizeBoundedInteger(
      options.maxTransactionMs,
      this.defaultMaxDeleteTransactionMs,
      MIN_MAX_DELETE_TRANSACTION_MS,
      MAX_MAX_DELETE_TRANSACTION_MS,
    );
    const client = await this.pool.connect();
    const startedAt = Date.now();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [`${maxTransactionMs}ms`]);
      const result = await client.query(
        `
        WITH overdue AS (
          SELECT id
          FROM event_occurrences
          WHERE occurred_at < now() - make_interval(days => $1::int)
          ORDER BY occurred_at ASC, id ASC
          LIMIT $2
        )
        DELETE FROM event_occurrences e
        USING overdue
        WHERE e.id = overdue.id
        `,
        [retentionDays, limit],
      );
      await client.query("COMMIT");
      return {
        deletedRecords: result.rowCount ?? 0,
        durationMs: Math.max(0, Date.now() - startedAt),
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async deleteOldestEventOccurrencesBatch(options: {
    limit: number;
    maxTransactionMs: number;
  }): Promise<ArchivePruneBatchResultRow> {
    const limit = this.normalizeBoundedInteger(
      options.limit,
      this.defaultDeleteBatchSize,
      MIN_DELETE_BATCH_SIZE,
      MAX_DELETE_BATCH_SIZE,
    );
    const maxTransactionMs = this.normalizeBoundedInteger(
      options.maxTransactionMs,
      this.defaultMaxDeleteTransactionMs,
      MIN_MAX_DELETE_TRANSACTION_MS,
      MAX_MAX_DELETE_TRANSACTION_MS,
    );
    const client = await this.pool.connect();
    const startedAt = Date.now();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [`${maxTransactionMs}ms`]);
      const result = await client.query(
        `
        WITH oldest AS (
          SELECT id
          FROM event_occurrences
          ORDER BY occurred_at ASC, id ASC
          LIMIT $1
        )
        DELETE FROM event_occurrences e
        USING oldest
        WHERE e.id = oldest.id
        `,
        [limit],
      );
      await client.query("COMMIT");
      return {
        deletedRecords: result.rowCount ?? 0,
        durationMs: Math.max(0, Date.now() - startedAt),
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async deleteOperatorActionsByRetentionBatch(options: {
    retentionDays: number;
    limit: number;
    maxTransactionMs: number;
  }): Promise<ArchivePruneBatchResultRow> {
    const retentionDays = Math.max(1, Math.round(options.retentionDays));
    const limit = this.normalizeBoundedInteger(
      options.limit,
      this.defaultDeleteBatchSize,
      MIN_DELETE_BATCH_SIZE,
      MAX_DELETE_BATCH_SIZE,
    );
    const maxTransactionMs = this.normalizeBoundedInteger(
      options.maxTransactionMs,
      this.defaultMaxDeleteTransactionMs,
      MIN_MAX_DELETE_TRANSACTION_MS,
      MAX_MAX_DELETE_TRANSACTION_MS,
    );
    const client = await this.pool.connect();
    const startedAt = Date.now();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [`${maxTransactionMs}ms`]);
      const result = await client.query(
        `
        WITH overdue AS (
          SELECT id
          FROM operator_actions
          WHERE occurred_at < now() - make_interval(days => $1::int)
          ORDER BY occurred_at ASC, id ASC
          LIMIT $2
        )
        DELETE FROM operator_actions oa
        USING overdue
        WHERE oa.id = overdue.id
        `,
        [retentionDays, limit],
      );
      await client.query("COMMIT");
      return {
        deletedRecords: result.rowCount ?? 0,
        durationMs: Math.max(0, Date.now() - startedAt),
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async deleteOldestOperatorActionsBatch(options: {
    limit: number;
    maxTransactionMs: number;
  }): Promise<ArchivePruneBatchResultRow> {
    const limit = this.normalizeBoundedInteger(
      options.limit,
      this.defaultDeleteBatchSize,
      MIN_DELETE_BATCH_SIZE,
      MAX_DELETE_BATCH_SIZE,
    );
    const maxTransactionMs = this.normalizeBoundedInteger(
      options.maxTransactionMs,
      this.defaultMaxDeleteTransactionMs,
      MIN_MAX_DELETE_TRANSACTION_MS,
      MAX_MAX_DELETE_TRANSACTION_MS,
    );
    const client = await this.pool.connect();
    const startedAt = Date.now();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [`${maxTransactionMs}ms`]);
      const result = await client.query(
        `
        WITH oldest AS (
          SELECT id
          FROM operator_actions
          ORDER BY occurred_at ASC, id ASC
          LIMIT $1
        )
        DELETE FROM operator_actions oa
        USING oldest
        WHERE oa.id = oldest.id
        `,
        [limit],
      );
      await client.query("COMMIT");
      return {
        deletedRecords: result.rowCount ?? 0,
        durationMs: Math.max(0, Date.now() - startedAt),
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async enforceRuntimeLimits(settings: {
    autoCleanupEnabled: boolean;
    maxDbSizeMb: number | null;
  }): Promise<{ deletedByAge: number; deletedBySize: number }> {
    if (!settings.autoCleanupEnabled) {
      return { deletedByAge: 0, deletedBySize: 0 };
    }
    let deletedBySize = 0;

    if ((settings.maxDbSizeMb ?? 0) > 0) {
      const maxBytes = (settings.maxDbSizeMb ?? 0) * 1024 * 1024;
      const { currentBytes, recordsCount } = await this.readArchiveSamplesSize();
      if (Number.isFinite(currentBytes) && currentBytes > maxBytes && Number.isFinite(recordsCount) && recordsCount > 0) {
        const overflowRatio = Math.min(1, Math.max(0, (currentBytes - maxBytes) / currentBytes));
        const deleteLimit = Math.min(
          recordsCount,
          ARCHIVE_SIZE_DELETE_MAX_ROWS,
          Math.max(ARCHIVE_SIZE_DELETE_MIN_ROWS, Math.ceil(recordsCount * overflowRatio * ARCHIVE_SIZE_DELETE_HEADROOM)),
        );
        const deleted = await this.deleteOldestSamplesBatch({
          limit: deleteLimit,
          maxTransactionMs: this.defaultMaxDeleteTransactionMs,
        });
        deletedBySize += deleted.deletedRecords;
      }
    }

    return { deletedByAge: 0, deletedBySize };
  }

  private async readArchiveSamplesSize(): Promise<{ currentBytes: number; recordsCount: number }> {
    return this.readSizedTableStats("archive_samples", "time");
  }

  private async readSizedTableStats(
    tableName: "archive_samples" | "event_occurrences" | "operator_actions",
    orderColumn: "time" | "occurred_at",
  ): Promise<{ currentBytes: number; recordsCount: number }> {
    const allowedTableNames = new Set(["archive_samples", "event_occurrences", "operator_actions"]);
    const allowedColumns = new Set(["time", "occurred_at"]);
    if (!allowedTableNames.has(tableName) || !allowedColumns.has(orderColumn)) {
      throw new Error(`Unsupported table stats request: ${tableName}.${orderColumn}`);
    }
    const sizeExpression = tableName === "archive_samples"
      ? `
        CASE
          WHEN to_regclass('timescaledb_information.hypertables') IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM timescaledb_information.hypertables h
              WHERE h.hypertable_schema = current_schema()
                AND h.hypertable_name = 'archive_samples'
            )
          THEN COALESCE(pg_total_relation_size('archive_samples'), 0)
          ELSE COALESCE(pg_total_relation_size('archive_samples'), 0)
        END
      `
      : `COALESCE(pg_total_relation_size('${tableName}'), 0)`;
    const sizeResult = await this.pool.query<{ size_bytes: string | number; records_count: string | number }>(
      `
      SELECT
        ${sizeExpression} AS size_bytes,
        (SELECT COUNT(*)::bigint FROM ${tableName}) AS records_count
      `,
    );
    const sizeRaw = sizeResult.rows[0]?.size_bytes ?? 0;
    const recordsRaw = sizeResult.rows[0]?.records_count ?? 0;
    const currentBytes = typeof sizeRaw === "string" ? Number.parseInt(sizeRaw, 10) : Number(sizeRaw);
    const recordsCount = typeof recordsRaw === "string" ? Number.parseInt(recordsRaw, 10) : Number(recordsRaw);
    return { currentBytes, recordsCount };
  }

  private async loadTrendTagMeta(tagNames?: string[]): Promise<TrendTagMetaRow[]> {
    const hasFilter = Array.isArray(tagNames) && tagNames.length > 0;
    const result = await this.pool.query<{
      id: number;
      name: string;
      display_name: string;
      unit: string | null;
      data_type_code: string;
      description: string | null;
      group_name: string | null;
      min_value: number | null;
      max_value: number | null;
      source_type_code: string | null;
      driver_type: string | null;
      archive_enabled: boolean;
      policy_mode: string | null;
      policy_period_ms: number | null;
    }>(
      `
      SELECT
          t.id,
          t.name,
          t.name AS display_name,
          u.code AS unit,
          dt.code AS data_type_code,
          t.description,
          grp.group_name,
          NULL::double precision AS min_value,
          NULL::double precision AS max_value,
          st.code AS source_type_code,
          drv.type AS driver_type,
          COALESCE(o.enabled, p.enabled, false) AS archive_enabled,
          COALESCE(o.mode, p.mode, 'on_change_with_periodic') AS policy_mode,
          COALESCE(o.period_ms, p.period_ms, 1000) AS policy_period_ms
      FROM tags t
      JOIN tag_data_types dt ON dt.id = t.data_type_id
      LEFT JOIN tag_source_types st ON st.id = t.source_type_id
      LEFT JOIN drivers drv ON drv.id = t.driver_id
      LEFT JOIN units u ON u.id = t.unit_id
      LEFT JOIN archive_policies p ON p.id = t.archive_policy_id
      LEFT JOIN tag_archive_overrides o ON o.tag_id = t.id
      LEFT JOIN LATERAL (
          SELECT g.name AS group_name
          FROM tag_group_members gm
          JOIN tag_groups g ON g.id = gm.group_id
          WHERE gm.tag_id = t.id
          ORDER BY g.name ASC
          LIMIT 1
      ) grp ON true
      WHERE COALESCE(o.enabled, p.enabled, false) = true
        AND ($1::bool = false OR t.name = ANY($2::text[]))
      ORDER BY t.name ASC
      `,
      [hasFilter, hasFilter ? tagNames : []],
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      unit: row.unit,
      dataTypeCode: row.data_type_code,
      description: row.description,
      group: row.group_name,
      min: row.min_value,
      max: row.max_value,
      sourceTypeCode: row.source_type_code,
      driverType: row.driver_type,
      archiveEnabled: row.archive_enabled,
      policyMode: row.policy_mode ?? "on_change_with_periodic",
      policyPeriodMs: Math.max(1, Number(row.policy_period_ms ?? 1000)),
    }));
  }

  private trendValueSql(dataType: TrendDataType): { numericTextExpr: string; valueExpr: string; valueFilter: string } {
    const numericTextExpr = "CASE WHEN s.value_text ~ '^\\s*[-+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][-+]?\\d+)?\\s*$' THEN s.value_text::double precision ELSE NULL END";
    const valueExpr = dataType === "boolean"
      ? "CASE WHEN s.value_bool IS NULL THEN NULL WHEN s.value_bool THEN 1::double precision ELSE 0::double precision END"
      : dataType === "string"
        ? `COALESCE(${numericTextExpr}, s.value_double)`
        : `COALESCE(s.value_double, ${numericTextExpr})`;
    const valueFilter = dataType === "boolean"
      ? "s.value_bool IS NOT NULL"
      : dataType === "string"
        ? `(${numericTextExpr} IS NOT NULL OR s.value_double IS NOT NULL)`
        : `(s.value_double IS NOT NULL OR ${numericTextExpr} IS NOT NULL)`;
    return { numericTextExpr, valueExpr, valueFilter };
  }

  private async queryTrendRangeStats(
    tagId: number,
    from: Date,
    to: Date,
    dataType: TrendDataType,
  ): Promise<{ pointsInRange: number; firstPointTs: number | null; lastPointTs: number | null }> {
    const { valueFilter } = this.trendValueSql(dataType);
    const result = await this.pool.query<{ cnt: string | number; first_time: Date | null; last_time: Date | null }>(
      `
      SELECT
          COUNT(*)::bigint AS cnt,
          MIN(s.time) AS first_time,
          MAX(s.time) AS last_time
      FROM archive_samples s
      WHERE s.tag_id = $1
        AND s.time >= $2
        AND s.time <= $3
        AND ${valueFilter}
      `,
      [tagId, from, to],
    );
    const raw = result.rows[0]?.cnt ?? 0;
    const numeric = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
    const row = result.rows[0];
    return {
      pointsInRange: Number.isFinite(numeric) ? Math.max(0, numeric) : 0,
      firstPointTs: row?.first_time ? row.first_time.getTime() : null,
      lastPointTs: row?.last_time ? row.last_time.getTime() : null,
    };
  }

  private archivePolicyRequiresIncomingSamples(mode: string): boolean {
    const normalized = mode.trim().toLowerCase();
    return normalized === "periodic" || normalized === "on_change" || normalized === "on_change_with_periodic";
  }

  private archivePolicyGuidance(mode: string): string | null {
    const normalized = mode.trim().toLowerCase();
    if (normalized === "on_change_with_periodic") {
      return "on_change_with_periodic writes periodic rows only when new TagValue samples arrive; no archive heartbeat is active.";
    }
    if (normalized === "periodic") {
      return "periodic archive policy still depends on incoming TagValue samples; no archive heartbeat is active.";
    }
    if (normalized === "on_change") {
      return "on_change writes only incoming changes; continuous trend history requires periodic source samples or a source heartbeat.";
    }
    return null;
  }

  private resolveTrendAggregation(input: {
    requested: TrendAggregationMode;
    dataType: TrendDataType;
    rawCount: number;
    maxPoints: number;
  }): TrendResolvedAggregation {
    if (input.dataType === "string") {
      return "raw";
    }
    if (input.requested === "raw") {
      return input.rawCount <= input.maxPoints ? "raw" : "minmax";
    }
    if (input.requested !== "auto") {
      return input.requested;
    }
    if (input.rawCount <= input.maxPoints) {
      return "raw";
    }
    if (input.dataType === "boolean" || input.dataType === "enum") {
      return "avg";
    }
    return "minmax";
  }

  private pickWiderAggregation(a: TrendResolvedAggregation, b: TrendResolvedAggregation): TrendResolvedAggregation {
    const order: TrendResolvedAggregation[] = ["raw", "avg", "lttb", "minmax"];
    const aIndex = order.indexOf(a);
    const bIndex = order.indexOf(b);
    return order[Math.max(aIndex, bIndex)] ?? b;
  }

  private mapTrendQuality(value: string | null | undefined): TrendQuality {
    const normalized = (value ?? "").toLowerCase();
    if (normalized === "bad") {
      return "bad";
    }
    if (normalized === "uncertain") {
      return "uncertain";
    }
    return "good";
  }

  private mapTrendDataType(code: string): TrendDataType {
    const normalized = code.trim().toUpperCase();
    if (normalized === "BOOL") {
      return "boolean";
    }
    if (normalized === "STRING") {
      return "string";
    }
    return "number";
  }

  private enforceTrendPointLimit(points: TrendPointRow[], hardLimit: number): TrendPointRow[] {
    if (points.length <= hardLimit) {
      return points;
    }
    const step = Math.ceil(points.length / hardLimit);
    const compact: TrendPointRow[] = [];
    for (let index = 0; index < points.length; index += step) {
      const point = points[index];
      if (point) {
        compact.push(point);
      }
    }
    const last = points[points.length - 1];
    if (last && compact[compact.length - 1]?.t !== last.t) {
      compact.push(last);
    }
    return compact.slice(0, hardLimit);
  }

  private normalizeTrendPointRows(points: TrendPointRow[]): TrendPointRow[] {
    const sorted = [...points]
      .filter((point) => Number.isFinite(point.t))
      .sort((a, b) => a.t - b.t);
    const deduped: TrendPointRow[] = [];
    for (const point of sorted) {
      const last = deduped[deduped.length - 1];
      if (last && last.t === point.t) {
        deduped[deduped.length - 1] = point;
      } else {
        deduped.push(point);
      }
    }
    return deduped;
  }

  private applyTrendCarryForward(
    points: TrendPointRow[],
    carryForwardPoint: TrendPointRow | null,
    from: Date,
    to: Date,
  ): TrendPointRow[] {
    const fromTs = from.getTime();
    const toTs = to.getTime();
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || toTs <= fromTs) {
      return this.normalizeTrendPointRows(points);
    }
    const normalized = this.normalizeTrendPointRows(points)
      .filter((point) => point.t >= fromTs && point.t <= toTs);
    if (normalized.length === 0) {
      if (!carryForwardPoint) {
        return normalized;
      }
      return this.normalizeTrendPointRows([
        { t: fromTs, v: carryForwardPoint.v, q: carryForwardPoint.q },
        { t: toTs, v: carryForwardPoint.v, q: carryForwardPoint.q },
      ]);
    }
    if (carryForwardPoint && normalized[0]!.t > fromTs) {
      normalized.unshift({ t: fromTs, v: carryForwardPoint.v, q: carryForwardPoint.q });
    }
    return this.normalizeTrendPointRows(normalized);
  }

  private async queryTrendPointAtOrBefore(tagId: number, at: Date, dataType: TrendDataType): Promise<TrendPointRow | null> {
    const { valueExpr, valueFilter } = this.trendValueSql(dataType);
    const result = await this.pool.query<{
      time: Date;
      value: number | null;
      quality: string;
    }>(
      `
      SELECT
          s.time,
          ${valueExpr} AS value,
          LOWER(q.code) AS quality
      FROM archive_samples s
      JOIN archive_qualities q ON q.id = s.quality_id
      WHERE s.tag_id = $1
        AND s.time <= $2
        AND ${valueFilter}
      ORDER BY s.time DESC
      LIMIT 1
      `,
      [tagId, at],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      t: row.time.getTime(),
      v: row.value,
      q: this.mapTrendQuality(row.quality),
    };
  }

  private async queryRawTrendPoints(
    tagId: number,
    from: Date,
    to: Date,
    limit: number,
    dataType: TrendDataType,
  ): Promise<TrendPointRow[]> {
    const { valueExpr, valueFilter } = this.trendValueSql(dataType);

    const result = await this.pool.query<{
      time: Date;
      value: number | null;
      quality: string;
    }>(
      `
      SELECT
          s.time,
          ${valueExpr} AS value,
          LOWER(q.code) AS quality
      FROM archive_samples s
      JOIN archive_qualities q ON q.id = s.quality_id
      WHERE s.tag_id = $1
        AND s.time >= $2
        AND s.time <= $3
        AND ${valueFilter}
      ORDER BY s.time ASC
      LIMIT $4
      `,
      [tagId, from, to, limit],
    );

    return result.rows.map((row) => ({
      t: row.time.getTime(),
      v: row.value,
      q: this.mapTrendQuality(row.quality),
    }));
  }

  private async queryBucketedMinMaxTrendPoints(
    tagId: number,
    from: Date,
    to: Date,
    bucketMs: number,
    hardLimit: number,
  ): Promise<TrendPointRow[]> {
    void hardLimit;
    const result = await this.pool.query<{
      time: Date;
      value: number;
      quality: string;
    }>(
      `
      WITH points AS (
        SELECT
          FLOOR(EXTRACT(EPOCH FROM s.time) * 1000 / $4)::bigint AS bucket_id,
          s.time,
          s.value_double AS value,
          LOWER(q.code) AS quality
        FROM archive_samples s
        JOIN archive_qualities q ON q.id = s.quality_id
        WHERE s.tag_id = $1
          AND s.time >= $2
          AND s.time <= $3
          AND s.value_double IS NOT NULL
      ),
      quality_by_bucket AS (
        SELECT
          p.bucket_id,
          CASE
            WHEN BOOL_OR(p.quality = 'bad') THEN 'bad'
            WHEN BOOL_OR(p.quality = 'uncertain') THEN 'uncertain'
            ELSE 'good'
          END AS quality
        FROM points p
        GROUP BY p.bucket_id
      ),
      ranked AS (
        SELECT
          p.bucket_id,
          p.time,
          p.value,
          ROW_NUMBER() OVER (PARTITION BY p.bucket_id ORDER BY p.value ASC, p.time ASC) AS rn_min,
          ROW_NUMBER() OVER (PARTITION BY p.bucket_id ORDER BY p.value DESC, p.time ASC) AS rn_max
        FROM points p
      ),
      picked AS (
        SELECT bucket_id, time, value
        FROM ranked
        WHERE rn_min = 1 OR rn_max = 1
      )
      SELECT p.time, p.value, q.quality
      FROM picked p
      JOIN quality_by_bucket q ON q.bucket_id = p.bucket_id
      ORDER BY p.time ASC, p.value ASC
      `,
      [tagId, from, to, bucketMs],
    );

    const points: TrendPointRow[] = result.rows.map((row) => ({
      t: row.time.getTime(),
      v: row.value,
      q: this.mapTrendQuality(row.quality),
    }));
    if (points.length <= 1) {
      return points;
    }
    const deduped: TrendPointRow[] = [];
    for (const point of points) {
      const last = deduped[deduped.length - 1];
      if (last && last.t === point.t && last.v === point.v) {
        continue;
      }
      deduped.push(point);
    }
    return deduped;
  }

  private async queryBucketedAvgTrendPoints(
    tagId: number,
    from: Date,
    to: Date,
    bucketMs: number,
    hardLimit: number,
  ): Promise<TrendPointRow[]> {
    const result = await this.pool.query<{
      bucket_time: Date;
      avg_value: number;
      quality: string;
    }>(
      `
      WITH points AS (
        SELECT
          s.time,
          s.value_double AS value,
          LOWER(q.code) AS quality
        FROM archive_samples s
        JOIN archive_qualities q ON q.id = s.quality_id
        WHERE s.tag_id = $1
          AND s.time >= $2
          AND s.time <= $3
          AND s.value_double IS NOT NULL
      ),
      bucketed AS (
        SELECT
          FLOOR(EXTRACT(EPOCH FROM time) * 1000 / $4)::bigint AS bucket_id,
          MIN(time) + (MAX(time) - MIN(time)) / 2 AS bucket_time,
          AVG(value) AS avg_value,
          CASE
            WHEN BOOL_OR(quality = 'bad') THEN 'bad'
            WHEN BOOL_OR(quality = 'uncertain') THEN 'uncertain'
            ELSE 'good'
          END AS quality
        FROM points
        GROUP BY bucket_id
        ORDER BY bucket_id ASC
        LIMIT $5
      )
      SELECT bucket_time, avg_value, quality
      FROM bucketed
      ORDER BY bucket_time ASC
      `,
      [tagId, from, to, bucketMs, hardLimit],
    );

    return result.rows.map((row) => ({
      t: row.bucket_time.getTime(),
      v: row.avg_value,
      q: this.mapTrendQuality(row.quality),
    }));
  }

  private async queryBucketedDiscreteTrendPoints(
    tagId: number,
    from: Date,
    to: Date,
    bucketMs: number,
    hardLimit: number,
  ): Promise<TrendPointRow[]> {
    const result = await this.pool.query<{
      bucket_time: Date;
      value: number | null;
      quality: string;
    }>(
      `
      WITH points AS (
        SELECT
          s.time,
          CASE
            WHEN s.value_bool IS NULL THEN NULL
            WHEN s.value_bool THEN 1::double precision
            ELSE 0::double precision
          END AS value,
          LOWER(q.code) AS quality
        FROM archive_samples s
        JOIN archive_qualities q ON q.id = s.quality_id
        WHERE s.tag_id = $1
          AND s.time >= $2
          AND s.time <= $3
          AND s.value_bool IS NOT NULL
      ),
      bucketed AS (
        SELECT
          FLOOR(EXTRACT(EPOCH FROM time) * 1000 / $4)::bigint AS bucket_id,
          MAX(time) AS bucket_time,
          (ARRAY_AGG(value ORDER BY time DESC))[1] AS value,
          (ARRAY_AGG(quality ORDER BY time DESC))[1] AS quality
        FROM points
        GROUP BY bucket_id
        ORDER BY bucket_id ASC
        LIMIT $5
      )
      SELECT bucket_time, value, quality
      FROM bucketed
      ORDER BY bucket_time ASC
      `,
      [tagId, from, to, bucketMs, hardLimit],
    );

    const points: TrendPointRow[] = [];
    let previousValue: number | null | undefined;
    for (const row of result.rows) {
      if (row.value === previousValue && points.length > 0) {
        continue;
      }
      previousValue = row.value;
      points.push({
        t: row.bucket_time.getTime(),
        v: row.value,
        q: this.mapTrendQuality(row.quality),
      });
    }
    return points;
  }

  private async tryEnableTimescale(): Promise<void> {
    try {
      await this.pool.query("CREATE EXTENSION IF NOT EXISTS timescaledb");
    } catch (error) {
      this.logger.warn(`TimescaleDB extension is unavailable; archive will use plain PostgreSQL tables: ${this.errorText(error)}`);
    }

    try {
      await this.pool.query(ARCHIVE_TIMESCALE_SQL);
    } catch (error) {
      this.logger.warn(`TimescaleDB hypertable setup was skipped: ${this.errorText(error)}`);
    }
  }

  private async ensureDefaultPolicy(): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO archive_policies (name, enabled, mode, period_ms, deadband, retention_days, aggregate_enabled, compression_after_days)
      VALUES ('Default archive', $1, 'on_change_with_periodic', 5000, 0, 365, true, 7)
      ON CONFLICT (name) DO NOTHING
      `,
      [this.defaultArchiveEnabled],
    );
  }

  private mapPolicy(row: {
    id: number;
    name: string;
    enabled: boolean;
    mode: string;
    period_ms: number;
    deadband: number;
    retention_days: number;
    aggregate_enabled: boolean;
    compression_after_days: number | null;
    created_at: Date;
    updated_at: Date;
  }): ArchivePolicyRow {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      mode: row.mode,
      periodMs: row.period_ms,
      deadband: row.deadband,
      retentionDays: row.retention_days,
      aggregateEnabled: row.aggregate_enabled,
      compressionAfterDays: row.compression_after_days,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async syncReferences(client: PoolClient, tags: TagDefinition[], drivers: DriverConfig[]): Promise<ReferenceCache> {
    const units = [...new Set(tags.map((tag) => tag.unit?.trim()).filter((unit): unit is string => Boolean(unit)))];
    for (const unit of units) {
      await client.query("INSERT INTO units (code) VALUES ($1) ON CONFLICT (code) DO NOTHING", [unit]);
    }
    for (const tag of tags) {
      const groupName = tag.group?.trim();
      if (groupName) {
        await client.query("INSERT INTO tag_groups (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [groupName]);
      }
    }
    for (const driver of drivers) {
      await client.query(
        `
        INSERT INTO drivers (external_id, name, type)
        VALUES ($1, $2, $3)
        ON CONFLICT (external_id) DO NOTHING
        `,
        [driver.id, driver.name?.trim() || driver.id, driver.type],
      );
    }

    return {
      dataTypes: await this.loadCodeMap(client, "tag_data_types"),
      sourceTypes: await this.loadCodeMap(client, "tag_source_types"),
      units: await this.loadCodeMap(client, "units"),
      drivers: await this.loadCodeMap(client, "drivers", "external_id"),
      policies: await this.loadCodeMap(client, "archive_policies", "name"),
    };
  }

  private async loadInsertCaches(): Promise<void> {
    this.qualities.clear();
    this.sources.clear();
    this.tags.clear();

    const [qualityRows, sourceRows, tagRows] = await Promise.all([
      this.pool.query<{ id: number; code: string }>("SELECT id, code FROM archive_qualities"),
      this.pool.query<{ id: number; code: string }>("SELECT id, code FROM archive_sources"),
      this.pool.query<{ id: number; name: string; enabled: boolean | null; mode: string | null; period_ms: number | null; deadband: number | null }>(
        `
        SELECT
            t.id,
            t.name,
            COALESCE(o.enabled, p.enabled, false) AS enabled,
            COALESCE(o.mode, p.mode, 'on_change_with_periodic') AS mode,
            COALESCE(o.period_ms, p.period_ms, 1000) AS period_ms,
            COALESCE(o.deadband, p.deadband, 0) AS deadband
        FROM tags t
        LEFT JOIN archive_policies p ON p.id = t.archive_policy_id
        LEFT JOIN tag_archive_overrides o ON o.tag_id = t.id
        `,
      ),
    ]);

    for (const row of qualityRows.rows) {
      this.qualities.set(row.code, row.id);
    }
    for (const row of sourceRows.rows) {
      this.sources.set(row.code, row.id);
    }
    for (const row of tagRows.rows) {
      this.tags.set(row.name, {
        id: row.id,
        enabled: row.enabled ?? false,
        mode: row.mode ?? "on_change_with_periodic",
        periodMs: Math.max(1, row.period_ms ?? 1000),
        deadband: Math.max(0, row.deadband ?? 0),
      });
    }
  }

  private async toRows(values: TagValue[]): Promise<
    Array<{
      time: Date;
      tagId: number;
      valueDouble: number | null;
      valueBool: boolean | null;
      valueText: string | null;
      qualityId: number;
      sourceId: number | null;
    }>
  > {
    const rows = [];
    for (const value of values) {
      const tag = this.tags.get(value.name);
      const qualityId = this.qualities.get(value.quality);
      if (!tag?.enabled || !qualityId) {
        continue;
      }
      if (!this.shouldArchiveSample(tag, value)) {
        continue;
      }
      const sourceId = value.source ? await this.getSourceId(value.source) : null;
      const normalizedValue = this.normalizeArchiveValue(value.value);
      const numericFromString = typeof value.value === "string" ? this.tryParseNumericString(value.value) : null;
      rows.push({
        time: new Date(value.timestamp),
        tagId: tag.id,
        valueDouble: typeof value.value === "number" ? value.value : numericFromString,
        valueBool: typeof value.value === "boolean" ? value.value : null,
        valueText: typeof value.value === "string" ? value.value : null,
        qualityId,
        sourceId,
      });
      this.lastArchivedByTagId.set(tag.id, {
        timestamp: value.timestamp,
        value: normalizedValue,
        quality: value.quality,
        source: value.source ?? "",
      });
    }
    return rows;
  }

  private shouldArchiveSample(tag: TagArchiveCacheItem, sample: TagValue): boolean {
    const currentValue = this.normalizeArchiveValue(sample.value);
    const previous = this.lastArchivedByTagId.get(tag.id);
    if (!previous) {
      return true;
    }
    if (!Number.isFinite(sample.timestamp) || sample.timestamp <= previous.timestamp) {
      return false;
    }
    const elapsedMs = sample.timestamp - previous.timestamp;
    const periodicDue = elapsedMs >= tag.periodMs;
    const changed = this.hasValueOrMetaChange(previous, currentValue, sample, tag.deadband);
    if (tag.mode === "periodic") {
      // The archive repository does not own an independent heartbeat timer.
      // Even strictly periodic policies are evaluated only when a fresh
      // TagValue arrives from the runtime source.
      return periodicDue;
    }
    if (tag.mode === "on_change_with_periodic") {
      // This mode can only write the periodic leg when fresh TagValue samples
      // keep arriving. It does not create archive rows from a server-side clock
      // by itself, so quiet runtime sources can still produce sparse history.
      return changed || periodicDue;
    }
    return changed || periodicDue;
  }

  private normalizeArchiveValue(value: TagValue["value"]): number | boolean | string | null {
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string" || value === null) {
      return value;
    }
    return value == null ? null : String(value);
  }

  private tryParseNumericString(value: string): number | null {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private hasValueOrMetaChange(
    previous: ArchivedValueState,
    currentValue: number | boolean | string | null,
    sample: TagValue,
    deadband: number,
  ): boolean {
    if (previous.quality !== sample.quality || previous.source !== (sample.source ?? "")) {
      return true;
    }
    const previousValue = previous.value;
    if (typeof previousValue === "number" && typeof currentValue === "number") {
      if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue)) {
        return previousValue !== currentValue;
      }
      const threshold = Math.max(0, deadband);
      if (threshold <= 0) {
        return previousValue !== currentValue;
      }
      return Math.abs(currentValue - previousValue) >= threshold;
    }
    return previousValue !== currentValue;
  }

  private async getSourceId(code: string): Promise<number> {
    const cached = this.sources.get(code);
    if (cached) {
      return cached;
    }
    const result = await this.pool.query<{ id: number }>(
      `
      INSERT INTO archive_sources (code)
      VALUES ($1)
      ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
      RETURNING id
      `,
      [code],
    );
    const id = result.rows[0]?.id;
    if (!id) {
      throw new Error(`Archive source was not created: ${code}`);
    }
    this.sources.set(code, id);
    return id;
  }

  private async loadCodeMap(client: PoolClient, table: string, codeColumn = "code"): Promise<Map<string, number>> {
    const result = await client.query<{ id: number; code: string }>(`SELECT id, ${codeColumn} AS code FROM ${table}`);
    return new Map(result.rows.map((row) => [row.code, row.id]));
  }

  private async getIdByCode(client: PoolClient, table: string, codeColumn: string, code: string): Promise<number | undefined> {
    const result = await client.query<{ id: number }>(`SELECT id FROM ${table} WHERE ${codeColumn} = $1`, [code]);
    return result.rows[0]?.id;
  }

  private async withTrendQueryActivity<T>(operation: () => Promise<T>): Promise<T> {
    this.activeTrendQueries += 1;
    try {
      return await operation();
    } finally {
      this.activeTrendQueries = Math.max(0, this.activeTrendQueries - 1);
    }
  }

  private async withEventQueryActivity<T>(operation: () => Promise<T>): Promise<T> {
    this.activeEventQueries += 1;
    try {
      return await operation();
    } finally {
      this.activeEventQueries = Math.max(0, this.activeEventQueries - 1);
    }
  }

  private async withOperatorActionQueryActivity<T>(operation: () => Promise<T>): Promise<T> {
    this.activeOperatorActionQueries += 1;
    try {
      return await operation();
    } finally {
      this.activeOperatorActionQueries = Math.max(0, this.activeOperatorActionQueries - 1);
    }
  }

  private async withOperatorActionWriteActivity<T>(operation: () => Promise<T>): Promise<T> {
    this.activeOperatorActionWrites += 1;
    try {
      return await operation();
    } finally {
      this.activeOperatorActionWrites = Math.max(0, this.activeOperatorActionWrites - 1);
    }
  }

  private async readTrendDeleteDiagnostics(client: PoolClient, limit: number): Promise<Omit<TrendDeleteBatchDiagnosticsRow, "reason">> {
    const summaryResult = await client.query<{
      actual_count: string | number | null;
      estimated_count: string | number | null;
      oldest_sample_time: Date | null;
      newest_sample_time: Date | null;
      is_hypertable: boolean | null;
      hypertable_chunks: string | number | null;
    }>(
      `
      WITH meta AS (
        SELECT
          CASE
            WHEN to_regclass('timescaledb_information.hypertables') IS NULL THEN FALSE
            ELSE EXISTS (
              SELECT 1
              FROM timescaledb_information.hypertables h
              WHERE h.hypertable_schema = current_schema()
                AND h.hypertable_name = 'archive_samples'
            )
          END AS is_hypertable,
          CASE
            WHEN to_regclass('timescaledb_information.chunks') IS NULL THEN NULL::bigint
            ELSE (
              SELECT COUNT(*)::bigint
              FROM timescaledb_information.chunks c
              WHERE c.hypertable_schema = current_schema()
                AND c.hypertable_name = 'archive_samples'
            )
          END AS hypertable_chunks
      )
      SELECT
          (SELECT COUNT(*)::bigint FROM archive_samples) AS actual_count,
          COALESCE((SELECT n_live_tup::bigint FROM pg_stat_user_tables WHERE relname = 'archive_samples'), 0) AS estimated_count,
          (SELECT MIN(time) FROM archive_samples) AS oldest_sample_time,
          (SELECT MAX(time) FROM archive_samples) AS newest_sample_time,
          meta.is_hypertable,
          meta.hypertable_chunks
      FROM meta
      `,
    );
    const candidateResult = await client.query<{
      candidate_rows: string | number | null;
      oldest_candidate_time: Date | null;
      newest_candidate_time: Date | null;
    }>(
      `
      WITH oldest AS (
        SELECT time
        FROM archive_samples
        ORDER BY time ASC
        LIMIT $1
      )
      SELECT
        COUNT(*)::bigint AS candidate_rows,
        MIN(time) AS oldest_candidate_time,
        MAX(time) AS newest_candidate_time
      FROM oldest
      `,
      [limit],
    );

    const summary = summaryResult.rows[0];
    const candidates = candidateResult.rows[0];
    const actualCountRaw = summary?.actual_count ?? null;
    const estimatedCountRaw = summary?.estimated_count ?? null;
    const chunkCountRaw = summary?.hypertable_chunks ?? null;
    const candidateRowsRaw = candidates?.candidate_rows ?? 0;
    const actualSamplesCount = actualCountRaw === null
      ? null
      : (typeof actualCountRaw === "string" ? Number.parseInt(actualCountRaw, 10) : Number(actualCountRaw));
    const estimatedSamplesCount = estimatedCountRaw === null
      ? null
      : (typeof estimatedCountRaw === "string" ? Number.parseInt(estimatedCountRaw, 10) : Number(estimatedCountRaw));
    const hypertableChunks = chunkCountRaw === null
      ? null
      : (typeof chunkCountRaw === "string" ? Number.parseInt(chunkCountRaw, 10) : Number(chunkCountRaw));
    const candidateRowsParsed = typeof candidateRowsRaw === "string"
      ? Number.parseInt(candidateRowsRaw, 10)
      : Number(candidateRowsRaw);

    return {
      deleteAttemptAt: new Date().toISOString(),
      actualSamplesCount: Number.isFinite(actualSamplesCount as number) ? Math.max(0, Math.round(actualSamplesCount as number)) : null,
      estimatedSamplesCount: Number.isFinite(estimatedSamplesCount as number) ? Math.max(0, Math.round(estimatedSamplesCount as number)) : null,
      oldestSampleTime: summary?.oldest_sample_time ? summary.oldest_sample_time.toISOString() : null,
      newestSampleTime: summary?.newest_sample_time ? summary.newest_sample_time.toISOString() : null,
      candidateRows: Number.isFinite(candidateRowsParsed) ? Math.max(0, Math.round(candidateRowsParsed)) : 0,
      oldestCandidateTime: candidates?.oldest_candidate_time ? candidates.oldest_candidate_time.toISOString() : null,
      newestCandidateTime: candidates?.newest_candidate_time ? candidates.newest_candidate_time.toISOString() : null,
      isHypertable: summary?.is_hypertable === true,
      hypertableChunks: Number.isFinite(hypertableChunks as number) ? Math.max(0, Math.round(hypertableChunks as number)) : null,
    };
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

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private serializeEventValue(value: TagScalarValue | undefined): string | null {
    if (value === undefined) {
      return null;
    }
    return JSON.stringify(value);
  }

  private deserializeEventValue(value: string | null): TagScalarValue {
    if (value === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed === null || typeof parsed === "boolean" || typeof parsed === "number" || typeof parsed === "string") {
        return parsed;
      }
      return value;
    } catch {
      return value;
    }
  }

  private defaultOperatorActionArchiveSettings(): OperatorActionArchiveSettings {
    return {
      enabled: true,
      retentionDays: 90,
      maxDatabaseSizeMb: 2048,
      cleanupMode: "byAgeAndSize",
      cleanupIntervalMinutes: 60,
      optimizeAfterCleanup: false,
      deleteBatchSize: this.defaultDeleteBatchSize,
      maintenanceIntervalMs: this.defaultMaintenanceIntervalMs,
      maxMaintenanceTickMs: this.defaultMaxMaintenanceTickMs,
      maxDeleteTransactionMs: this.defaultMaxDeleteTransactionMs,
    };
  }

  private serializeOperatorActionValue(value: string | number | boolean | null | undefined): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    return JSON.stringify(value);
  }

  private deserializeOperatorActionValue(value: string | null): string | number | boolean | null {
    if (value === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed === null || typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean") {
        return parsed;
      }
      return value;
    } catch {
      return value;
    }
  }

  private mapOperatorActionRow(row: {
    id: number;
    occurred_at: Date;
    user_id: string | null;
    username: string | null;
    user_role: string | null;
    ip: string | null;
    screen_id: string | null;
    screen_name: string | null;
    object_id: string;
    object_name: string | null;
    object_description: string | null;
    object_type: string;
    action_kind: string;
    target_type: string | null;
    target_name: string | null;
    old_value: string | null;
    new_value: string | null;
    unit: string | null;
    message_template: string | null;
    message_text: string;
    result: string;
    error_text: string | null;
    details: Record<string, unknown> | null;
    created_at: Date;
  }): OperatorActionRecord {
    const details = row.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details : null;
    return {
      id: String(row.id),
      occurredAt: row.occurred_at.toISOString(),
      userId: row.user_id,
      username: row.username,
      userRole: row.user_role,
      ip: row.ip,
      screenId: row.screen_id,
      screenName: row.screen_name,
      objectId: row.object_id,
      objectName: row.object_name,
      objectDescription: row.object_description,
      objectType: row.object_type,
      actionKind: row.action_kind as OperatorActionKind,
      targetType: (row.target_type as OperatorActionTargetType | null) ?? null,
      targetName: row.target_name,
      oldValue: this.deserializeOperatorActionValue(row.old_value),
      newValue: this.deserializeOperatorActionValue(row.new_value),
      unit: row.unit,
      messageTemplate: row.message_template,
      messageText: row.message_text,
      result: row.result as OperatorActionResult,
      errorText: row.error_text,
      details,
      createdAt: row.created_at.toISOString(),
    };
  }

  private mapEventOccurrenceRow(row: {
    id: number;
    event_definition_id: string;
    occurred_at: Date;
    cleared_at: Date | null;
    acknowledged_at: Date | null;
    acknowledged_by: string | null;
    state: string;
    source_tag_name_snapshot: string | null;
    category_id_snapshot: string | null;
    category_name_snapshot: string | null;
    priority_snapshot: number | null;
    message_text_snapshot: string | null;
    value_at_trigger: string | null;
    value_at_clear: string | null;
    quality: string | null;
    runtime_source: string | null;
    service_data: Record<string, unknown> | null;
    created_at: Date;
    updated_at: Date;
  }): EventOccurrence {
    const serviceData = row.service_data ?? null;
    const soundId = typeof serviceData?.soundId === "string" ? serviceData.soundId : null;
    const requireAck = typeof serviceData?.requireAck === "boolean" ? serviceData.requireAck : undefined;
    return {
      id: String(row.id),
      eventDefinitionId: row.event_definition_id,
      occurredAt: row.occurred_at.toISOString(),
      clearedAt: row.cleared_at ? row.cleared_at.toISOString() : null,
      acknowledgedAt: row.acknowledged_at ? row.acknowledged_at.toISOString() : null,
      acknowledgedBy: row.acknowledged_by,
      state: (row.state as EventOccurrenceState) ?? "active",
      sourceTagNameSnapshot: row.source_tag_name_snapshot,
      categoryIdSnapshot: row.category_id_snapshot,
      categoryNameSnapshot: row.category_name_snapshot,
      prioritySnapshot: row.priority_snapshot,
      messageTextSnapshot: row.message_text_snapshot,
      valueAtTrigger: this.deserializeEventValue(row.value_at_trigger),
      valueAtClear: this.deserializeEventValue(row.value_at_clear),
      quality: row.quality,
      runtimeSource: row.runtime_source,
      soundId,
      requireAck,
      serviceData,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async listEventOccurrencesByClause(whereClause: string, limit = 200): Promise<EventOccurrence[]> {
    const boundedLimit = Math.max(1, Math.min(5000, limit));
    const rows = await this.pool.query<{
      id: number;
      event_definition_id: string;
      occurred_at: Date;
      cleared_at: Date | null;
      acknowledged_at: Date | null;
      acknowledged_by: string | null;
      state: string;
      source_tag_name_snapshot: string | null;
      category_id_snapshot: string | null;
      category_name_snapshot: string | null;
      priority_snapshot: number | null;
      message_text_snapshot: string | null;
      value_at_trigger: string | null;
      value_at_clear: string | null;
      quality: string | null;
      runtime_source: string | null;
      service_data: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `
      SELECT
          id,
          event_definition_id,
          occurred_at,
          cleared_at,
          acknowledged_at,
          acknowledged_by,
          state,
          source_tag_name_snapshot,
          category_id_snapshot,
          category_name_snapshot,
          priority_snapshot,
          message_text_snapshot,
          value_at_trigger,
          value_at_clear,
          quality,
          runtime_source,
          service_data,
          created_at,
          updated_at
      FROM event_occurrences
      WHERE ${whereClause}
      ORDER BY occurred_at DESC, id DESC
      LIMIT $1
      `,
      [boundedLimit],
    );
    return rows.rows.map((row) => this.mapEventOccurrenceRow(row));
  }
}
