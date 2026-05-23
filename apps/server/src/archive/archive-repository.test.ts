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

describe("ArchiveRepository.applyTrendCarryForward", () => {
  it("returns a two-point flat span when the range has no real points", () => {
    const repository = new ArchiveRepository(
      { connectionString: "postgres://unused" },
      {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    );
    const result = (repository as unknown as {
      applyTrendCarryForward(
        points: Array<{ t: number; v: number | null; q?: "good" | "bad" | "uncertain" }>,
        carryForwardPoint: { t: number; v: number | null; q?: "good" | "bad" | "uncertain" } | null,
        from: Date,
        to: Date,
      ): Array<{ t: number; v: number | null; q?: "good" | "bad" | "uncertain" }>;
    }).applyTrendCarryForward(
      [],
      { t: 500, v: 250, q: "good" },
      new Date(1_000),
      new Date(61_000),
    );

    expect(result).toEqual([
      { t: 1_000, v: 250, q: "good" },
      { t: 61_000, v: 250, q: "good" },
    ]);
  });

  it("only inserts a left-edge point when real points exist later in the range", () => {
    const repository = new ArchiveRepository(
      { connectionString: "postgres://unused" },
      {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    );
    const result = (repository as unknown as {
      applyTrendCarryForward(
        points: Array<{ t: number; v: number | null; q?: "good" | "bad" | "uncertain" }>,
        carryForwardPoint: { t: number; v: number | null; q?: "good" | "bad" | "uncertain" } | null,
        from: Date,
        to: Date,
      ): Array<{ t: number; v: number | null; q?: "good" | "bad" | "uncertain" }>;
    }).applyTrendCarryForward(
      [{ t: 2_000, v: 251, q: "good" }],
      { t: 500, v: 250, q: "good" },
      new Date(1_000),
      new Date(61_000),
    );

    expect(result).toEqual([
      { t: 1_000, v: 250, q: "good" },
      { t: 2_000, v: 251, q: "good" },
    ]);
  });
});
