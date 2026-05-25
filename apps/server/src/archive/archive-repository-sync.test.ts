import { describe, expect, it } from "vitest";
import type { TagDefinition, TagValue } from "@web-scada/shared";
import { ArchiveRepository } from "./archive-repository";

type QueryResult = {
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
};

type TagRecord = {
  id: number;
  name: string;
  archivePolicyId: number | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  lastSeenAt: Date | null;
};

class SyncMetadataPool {
  public readonly settings = { archiveNewTagsByDefault: false };
  private readonly tags = new Map<string, TagRecord>();
  private readonly samples: Array<{ tagId: number; time: number }> = [];
  private readonly policies = new Map<number, { id: number; name: string; enabled: boolean }>([
    [1, { id: 1, name: "Default archive", enabled: true }],
    [7, { id: 7, name: "Manual policy", enabled: true }],
  ]);
  private nextTagId = 1;

  public seedTag(input: { name: string; archivePolicyId: number | null; isDeleted?: boolean }): void {
    const now = new Date();
    this.tags.set(input.name, {
      id: this.nextTagId++,
      name: input.name,
      archivePolicyId: input.archivePolicyId,
      isDeleted: input.isDeleted === true,
      deletedAt: input.isDeleted ? now : null,
      lastSeenAt: input.isDeleted ? null : now,
    });
  }

  public seedSample(tagName: string, timestamp: number): void {
    const tag = this.tags.get(tagName);
    if (!tag) {
      throw new Error(`Tag ${tagName} not found`);
    }
    this.samples.push({ tagId: tag.id, time: timestamp });
  }

  public getTag(tagName: string): TagRecord | undefined {
    return this.tags.get(tagName);
  }

  public getSampleCount(tagName: string): number {
    const tag = this.tags.get(tagName);
    if (!tag) {
      return 0;
    }
    return this.samples.filter((sample) => sample.tagId === tag.id).length;
  }

  public async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (sql.includes("SELECT id, code FROM archive_qualities")) {
      return { rows: [{ id: 1, code: "Good" }, { id: 2, code: "Bad" }, { id: 3, code: "Uncertain" }] };
    }
    if (sql.includes("SELECT id, code FROM archive_sources")) {
      return { rows: [{ id: 1, code: "manual" }, { id: 2, code: "internal" }] };
    }
    if (sql.includes("COALESCE(o.enabled, p.enabled, false) AS enabled") && sql.includes("WHERE t.is_deleted = false")) {
      const rows = [...this.tags.values()]
        .filter((tag) => !tag.isDeleted)
        .map((tag) => {
          const policy = tag.archivePolicyId ? this.policies.get(tag.archivePolicyId) : null;
          return {
            id: tag.id,
            name: tag.name,
            enabled: policy?.enabled ?? false,
            mode: "periodic",
            period_ms: 1000,
            deadband: 0,
          };
        });
      return { rows };
    }
    if (sql.includes("INSERT INTO archive_samples (")) {
      const values = params ?? [];
      for (let index = 0; index < values.length; index += 7) {
        const time = values[index] as Date;
        const tagId = values[index + 1] as number;
        if (!this.samples.some((sample) => sample.tagId === tagId && sample.time === time.getTime())) {
          this.samples.push({ tagId, time: time.getTime() });
        }
      }
      return { rowCount: Math.floor(values.length / 7), rows: [] };
    }
    if (sql.includes("SELECT id") && sql.includes("FROM tags") && sql.includes("WHERE is_deleted = true")) {
      const selectedIds = (params?.[0] as number[] | undefined) ?? null;
      const rows = [...this.tags.values()]
        .filter((tag) => tag.isDeleted)
        .filter((tag) => !selectedIds || selectedIds.includes(tag.id))
        .map((tag) => ({ id: tag.id }));
      return { rows };
    }
    if (sql.includes("WITH target AS (") && sql.includes("DELETE FROM archive_samples s")) {
      const targetIds = (params?.[0] as number[]) ?? [];
      const limit = Number(params?.[1] ?? 0);
      const targetIndexes: number[] = [];
      for (let index = 0; index < this.samples.length; index += 1) {
        if (targetIndexes.length >= limit) {
          break;
        }
        if (targetIds.includes(this.samples[index]!.tagId)) {
          targetIndexes.push(index);
        }
      }
      for (let index = targetIndexes.length - 1; index >= 0; index -= 1) {
        this.samples.splice(targetIndexes[index]!, 1);
      }
      return { rows: [{ deleted_rows: String(targetIndexes.length) }], rowCount: 1 };
    }
    if (sql.includes("DELETE FROM archive_aggregates_1m")) {
      return { rowCount: 0, rows: [] };
    }
    return { rows: [] };
  }

  public async connect(): Promise<{
    query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
    release: () => void;
  }> {
    return {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK")) {
          return { rows: [] };
        }
        if (sql.includes("SELECT archive_new_tags_by_default")) {
          return { rows: [{ archive_new_tags_by_default: this.settings.archiveNewTagsByDefault }] };
        }
        if (sql.includes("INSERT INTO drivers")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO tags (")) {
          const [
            name,
            _description,
            _dataTypeId,
            _sourceTypeId,
            _unitId,
            _driverId,
            defaultPolicyId,
          ] = params as [string, unknown, unknown, unknown, unknown, unknown, number | null];
          const now = new Date();
          const existing = this.tags.get(name);
          if (existing) {
            existing.archivePolicyId = existing.archivePolicyId ?? defaultPolicyId ?? null;
            existing.isDeleted = false;
            existing.deletedAt = null;
            existing.lastSeenAt = now;
          } else {
            this.tags.set(name, {
              id: this.nextTagId++,
              name,
              archivePolicyId: defaultPolicyId ?? null,
              isDeleted: false,
              deletedAt: null,
              lastSeenAt: now,
            });
          }
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("UPDATE tags") && sql.includes("SET is_deleted = true")) {
          const names = (params?.[0] as string[] | undefined) ?? null;
          const allowedNames = names ? new Set(names) : null;
          const now = new Date();
          for (const tag of this.tags.values()) {
            if (allowedNames && allowedNames.has(tag.name)) {
              continue;
            }
            tag.isDeleted = true;
            tag.deletedAt = tag.deletedAt ?? now;
          }
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("DELETE FROM tag_group_members")) {
          return { rowCount: 0, rows: [] };
        }
        return this.query(sql, params);
      },
      release: () => undefined,
    };
  }
}

function createRepository(pool: SyncMetadataPool): ArchiveRepository {
  const repository = new ArchiveRepository(
    { connectionString: "postgres://unused" },
    { info: () => undefined, warn: () => undefined, error: () => undefined },
  );
  (repository as unknown as { pool: SyncMetadataPool }).pool = pool;
  (repository as unknown as {
    syncReferences: () => Promise<{
      dataTypes: Map<string, number>;
      sourceTypes: Map<string, number>;
      units: Map<string, number>;
      drivers: Map<string, number>;
      policies: Map<string, number>;
    }>;
  }).syncReferences = async () => ({
    dataTypes: new Map([["REAL", 1], ["BOOL", 2]]),
    sourceTypes: new Map(),
    units: new Map(),
    drivers: new Map(),
    policies: new Map([["Default archive", 1]]),
  });
  return repository;
}

function realTag(name: string): TagDefinition {
  return { name, dataType: "REAL" };
}

function sample(name: string, timestamp: number): TagValue {
  return { name, value: 1, quality: "Good", timestamp, source: "manual" };
}

describe("ArchiveRepository sync metadata behavior", () => {
  it("new synced tag has archive_policy_id = null when archiveNewTagsByDefault is false", async () => {
    const pool = new SyncMetadataPool();
    pool.settings.archiveNewTagsByDefault = false;
    const repository = createRepository(pool);

    await repository.syncMetadata([realTag("T1")], []);

    expect(pool.getTag("T1")?.archivePolicyId).toBeNull();
  });

  it("new synced tag gets Default archive policy when archiveNewTagsByDefault is true", async () => {
    const pool = new SyncMetadataPool();
    pool.settings.archiveNewTagsByDefault = true;
    const repository = createRepository(pool);

    await repository.syncMetadata([realTag("T1")], []);

    expect(pool.getTag("T1")?.archivePolicyId).toBe(1);
  });

  it("preserves existing tag archive policy during sync", async () => {
    const pool = new SyncMetadataPool();
    pool.settings.archiveNewTagsByDefault = true;
    pool.seedTag({ name: "T1", archivePolicyId: 7 });
    const repository = createRepository(pool);

    await repository.syncMetadata([realTag("T1")], []);

    expect(pool.getTag("T1")?.archivePolicyId).toBe(7);
  });

  it("marks removed project tags as deleted", async () => {
    const pool = new SyncMetadataPool();
    pool.settings.archiveNewTagsByDefault = true;
    const repository = createRepository(pool);
    await repository.syncMetadata([realTag("T1"), realTag("T2")], []);

    await repository.syncMetadata([realTag("T1")], []);

    expect(pool.getTag("T2")?.isDeleted).toBe(true);
    expect(pool.getTag("T2")?.deletedAt).not.toBeNull();
  });

  it("preserves removed tag historical samples after sync", async () => {
    const pool = new SyncMetadataPool();
    pool.settings.archiveNewTagsByDefault = true;
    const repository = createRepository(pool);
    await repository.syncMetadata([realTag("T1"), realTag("T2")], []);
    pool.seedSample("T2", 1_000);

    await repository.syncMetadata([realTag("T1")], []);

    expect(pool.getSampleCount("T2")).toBe(1);
  });

  it("re-activates a previously deleted tag when it is re-added", async () => {
    const pool = new SyncMetadataPool();
    pool.settings.archiveNewTagsByDefault = true;
    const repository = createRepository(pool);
    await repository.syncMetadata([realTag("T1"), realTag("T2")], []);
    await repository.syncMetadata([realTag("T1")], []);

    await repository.syncMetadata([realTag("T1"), realTag("T2")], []);

    expect(pool.getTag("T2")?.isDeleted).toBe(false);
    expect(pool.getTag("T2")?.deletedAt).toBeNull();
    expect(pool.getTag("T2")?.lastSeenAt).not.toBeNull();
  });

  it("does not archive new samples for deleted/orphan tags", async () => {
    const pool = new SyncMetadataPool();
    pool.settings.archiveNewTagsByDefault = true;
    const repository = createRepository(pool);
    await repository.syncMetadata([realTag("T1"), realTag("T2")], []);
    await repository.syncMetadata([realTag("T1")], []);
    const deletedBefore = pool.getSampleCount("T2");
    const activeBefore = pool.getSampleCount("T1");

    await repository.insertSamples([sample("T1", 2_000), sample("T2", 2_000)]);

    expect(pool.getSampleCount("T2")).toBe(deletedBefore);
    expect(pool.getSampleCount("T1")).toBe(activeBefore + 1);
  });

  it("purges deleted tags archive samples in batches without touching active tags", async () => {
    const pool = new SyncMetadataPool();
    pool.seedTag({ name: "active", archivePolicyId: 1, isDeleted: false });
    pool.seedTag({ name: "deleted", archivePolicyId: 1, isDeleted: true });
    pool.seedSample("active", 1_000);
    pool.seedSample("active", 2_000);
    pool.seedSample("deleted", 1_000);
    pool.seedSample("deleted", 2_000);
    pool.seedSample("deleted", 3_000);
    pool.seedSample("deleted", 4_000);
    pool.seedSample("deleted", 5_000);
    const repository = createRepository(pool);

    const result = await repository.purgeDeletedTagsArchiveData({ mode: "all", batchSize: 2 });

    expect(result.deletedSamples).toBe(5);
    expect(result.batches).toBe(3);
    expect(pool.getSampleCount("deleted")).toBe(0);
    expect(pool.getSampleCount("active")).toBe(2);
  });
});
