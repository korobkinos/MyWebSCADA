import { describe, expect, it } from "vitest";
import { ArchiveRepository } from "./archive-repository";

type QueryResult = {
  rows?: Array<Record<string, string | number>>;
  rowCount?: number;
};

class FakePool {
  public readonly calls: string[] = [];
  private sizeCalls = 0;

  public async query(sql: string, _params?: unknown[]): Promise<QueryResult> {
    this.calls.push(sql);
    if (sql.includes("pg_total_relation_size")) {
      this.sizeCalls += 1;
      if (this.sizeCalls === 1) {
        return { rows: [{ size_bytes: 3892 * 1024 * 1024, records_count: 8_461_183 }] };
      }
      return { rows: [{ size_bytes: 875 * 1024 * 1024, records_count: 8_461_183 }] };
    }
    if (sql.includes("VACUUM")) {
      return { rows: [] };
    }
    if (sql.includes("DELETE FROM archive_samples")) {
      return { rowCount: 100_000, rows: [] };
    }
    return { rows: [] };
  }
}

describe("ArchiveRepository.enforceRuntimeLimits", () => {
  it("compacts before deleting samples when physical compaction can satisfy the size limit", async () => {
    const repository = new ArchiveRepository(
      { connectionString: "postgres://unused" },
      {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    );
    const pool = new FakePool();
    (repository as unknown as { pool: FakePool }).pool = pool;

    const result = await repository.enforceRuntimeLimits({
      autoCleanupEnabled: true,
      maxDbSizeMb: 3000,
    });

    expect(result.deletedBySize).toBe(0);
    expect(pool.calls.some((call) => call.includes("VACUUM (FULL, ANALYZE) archive_samples"))).toBe(true);
    expect(pool.calls.some((call) => call.includes("DELETE FROM archive_samples"))).toBe(false);
  });
});
