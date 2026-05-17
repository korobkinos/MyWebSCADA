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
