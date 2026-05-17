import pg, { type Pool as PgPool, type PoolClient } from "pg";
import type { DriverConfig, TagDefinition, TagValue } from "@web-scada/shared";
import { ARCHIVE_SCHEMA_SQL, ARCHIVE_TIMESCALE_SQL } from "./archive-schema.js";

const { Pool } = pg;

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
};

export type ArchiveRuntimeSettingsRow = {
  autoCleanupEnabled: boolean;
  maxDbSizeMb: number | null;
  maxDataAgeMonths: number | null;
  updatedAt: string;
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

type ArchiveRepositoryOptions = {
  connectionString: string;
  maxPoolSize?: number;
  defaultArchiveEnabled?: boolean;
};

export class ArchiveRepository {
  private readonly pool: PgPool;
  private readonly defaultArchiveEnabled: boolean;
  private readonly tags = new Map<string, TagArchiveCacheItem>();
  private readonly qualities = new Map<string, number>();
  private readonly sources = new Map<string, number>();

  public constructor(
    options: ArchiveRepositoryOptions,
    private readonly logger: ArchiveLogger,
  ) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxPoolSize ?? 5,
    });
    this.defaultArchiveEnabled = options.defaultArchiveEnabled ?? false;
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
      LEFT JOIN archive_policies p ON p.id = t.archive_policy_id
      LEFT JOIN tag_archive_overrides o ON o.tag_id = t.id
      ORDER BY t.name ASC
      `,
    );

    return result.rows.map((row) => ({
      tagId: row.tag_id,
      tagName: row.tag_name,
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

  public async applyRetention(): Promise<number> {
    const result = await this.pool.query(
      `
      DELETE FROM archive_samples s
      USING tags t
      LEFT JOIN archive_policies p ON p.id = t.archive_policy_id
      LEFT JOIN tag_archive_overrides o ON o.tag_id = t.id
      WHERE s.tag_id = t.id
        AND COALESCE(o.retention_days, p.retention_days) IS NOT NULL
        AND s.time < now() - make_interval(days => COALESCE(o.retention_days, p.retention_days))
      `,
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

  public async getStorageStats(): Promise<ArchiveStorageStatsRow> {
    const result = await this.pool.query<{
      records_count: string | number | null;
      db_size_bytes: string | number | null;
    }>(
      `
      SELECT
          COALESCE((SELECT n_live_tup::bigint FROM pg_stat_user_tables WHERE relname = 'archive_samples'), 0) AS records_count,
          COALESCE(pg_total_relation_size('archive_samples'), 0) AS db_size_bytes
      `,
    );
    const row = result.rows[0];
    const recordsCountRaw = row?.records_count ?? 0;
    const dbSizeBytesRaw = row?.db_size_bytes ?? 0;
    const recordsCount = typeof recordsCountRaw === "string" ? Number.parseInt(recordsCountRaw, 10) : Number(recordsCountRaw);
    const dbSizeBytes = typeof dbSizeBytesRaw === "string" ? Number.parseInt(dbSizeBytesRaw, 10) : Number(dbSizeBytesRaw);

    return {
      recordsCount: Number.isFinite(recordsCount) ? Math.max(0, Math.round(recordsCount)) : 0,
      dbSizeMb: Number.isFinite(dbSizeBytes) ? Math.max(0, dbSizeBytes / (1024 * 1024)) : 0,
    };
  }

  public async getRuntimeSettings(): Promise<ArchiveRuntimeSettingsRow> {
    const result = await this.pool.query<{
      auto_cleanup_enabled: boolean;
      max_db_size_mb: number | null;
      max_data_age_months: number | null;
      updated_at: Date;
    }>(
      `
      SELECT auto_cleanup_enabled, max_db_size_mb, max_data_age_months, updated_at
      FROM archive_runtime_settings
      WHERE id = 1
      `,
    );
    const row = result.rows[0];
    if (!row) {
      return {
        autoCleanupEnabled: true,
        maxDbSizeMb: 5120,
        maxDataAgeMonths: 12,
        updatedAt: new Date(0).toISOString(),
      };
    }
    return {
      autoCleanupEnabled: row.auto_cleanup_enabled,
      maxDbSizeMb: row.max_db_size_mb,
      maxDataAgeMonths: row.max_data_age_months,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  public async updateRuntimeSettings(settings: {
    autoCleanupEnabled: boolean;
    maxDbSizeMb: number | null;
    maxDataAgeMonths: number | null;
  }): Promise<ArchiveRuntimeSettingsRow> {
    const result = await this.pool.query<{
      auto_cleanup_enabled: boolean;
      max_db_size_mb: number | null;
      max_data_age_months: number | null;
      updated_at: Date;
    }>(
      `
      INSERT INTO archive_runtime_settings (id, auto_cleanup_enabled, max_db_size_mb, max_data_age_months, updated_at)
      VALUES (1, $1, $2, $3, now())
      ON CONFLICT (id) DO UPDATE
      SET auto_cleanup_enabled = EXCLUDED.auto_cleanup_enabled,
          max_db_size_mb = EXCLUDED.max_db_size_mb,
          max_data_age_months = EXCLUDED.max_data_age_months,
          updated_at = now()
      RETURNING auto_cleanup_enabled, max_db_size_mb, max_data_age_months, updated_at
      `,
      [settings.autoCleanupEnabled, settings.maxDbSizeMb, settings.maxDataAgeMonths],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to update archive runtime settings");
    }
    return {
      autoCleanupEnabled: row.auto_cleanup_enabled,
      maxDbSizeMb: row.max_db_size_mb,
      maxDataAgeMonths: row.max_data_age_months,
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

  public async enforceRuntimeLimits(settings: {
    autoCleanupEnabled: boolean;
    maxDbSizeMb: number | null;
    maxDataAgeMonths: number | null;
  }): Promise<{ deletedByAge: number; deletedBySize: number }> {
    if (!settings.autoCleanupEnabled) {
      return { deletedByAge: 0, deletedBySize: 0 };
    }
    let deletedByAge = 0;
    let deletedBySize = 0;

    if ((settings.maxDataAgeMonths ?? 0) > 0) {
      const result = await this.pool.query(
        `
        DELETE FROM archive_samples
        WHERE time < now() - make_interval(months => $1)
        `,
        [settings.maxDataAgeMonths],
      );
      deletedByAge = result.rowCount ?? 0;
    }

    if ((settings.maxDbSizeMb ?? 0) > 0) {
      const maxBytes = (settings.maxDbSizeMb ?? 0) * 1024 * 1024;
      let safetyCounter = 0;
      while (safetyCounter < 100) {
        safetyCounter += 1;
        const sizeResult = await this.pool.query<{ size_bytes: string | number }>(
          "SELECT COALESCE(pg_total_relation_size('archive_samples'), 0) AS size_bytes",
        );
        const sizeRaw = sizeResult.rows[0]?.size_bytes ?? 0;
        const currentBytes = typeof sizeRaw === "string" ? Number.parseInt(sizeRaw, 10) : Number(sizeRaw);
        if (!Number.isFinite(currentBytes) || currentBytes <= maxBytes) {
          break;
        }
        const deleteResult = await this.pool.query(
          `
          DELETE FROM archive_samples
          WHERE ctid IN (
            SELECT ctid
            FROM archive_samples
            ORDER BY time ASC
            LIMIT 100000
          )
          `,
        );
        const chunkDeleted = deleteResult.rowCount ?? 0;
        deletedBySize += chunkDeleted;
        if (chunkDeleted === 0) {
          break;
        }
      }
    }

    return { deletedByAge, deletedBySize };
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
      this.pool.query<{ id: number; name: string; enabled: boolean | null }>(
        `
        SELECT
            t.id,
            t.name,
            COALESCE(o.enabled, p.enabled, false) AS enabled
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
      this.tags.set(row.name, { id: row.id, enabled: row.enabled ?? false });
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
      const sourceId = value.source ? await this.getSourceId(value.source) : null;
      rows.push({
        time: new Date(value.timestamp),
        tagId: tag.id,
        valueDouble: typeof value.value === "number" ? value.value : null,
        valueBool: typeof value.value === "boolean" ? value.value : null,
        valueText: typeof value.value === "string" ? value.value : null,
        qualityId,
        sourceId,
      });
    }
    return rows;
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

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
