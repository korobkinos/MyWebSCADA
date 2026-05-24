import { describe, expect, it } from "vitest";
import { ArchiveRepository } from "./archive-repository";

type QueryResult = {
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
};

class FakePool {
  public readonly calls: string[] = [];
  private sizeCalls = 0;
  private transactionCalls = 0;

  public async query(sql: string, _params?: unknown[]): Promise<QueryResult> {
    this.calls.push(sql);
    if (sql.includes("pg_total_relation_size")) {
      this.sizeCalls += 1;
      return { rows: [{ size_bytes: 3892 * 1024 * 1024, records_count: 8_461_183 }] };
    }
    return { rows: [] };
  }

  public async connect(): Promise<{
    query: (sql: string, _params?: unknown[]) => Promise<QueryResult>;
    release: () => void;
  }> {
    return {
      query: async (sql: string, _params?: unknown[]) => {
        this.calls.push(sql);
        if (sql.includes("DELETE FROM archive_samples")) {
          this.transactionCalls += 1;
          return { rowCount: this.transactionCalls === 1 ? 100_000 : 0, rows: [] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    };
  }
}

class TrendQueryFakePool {
  public async query(sql: string, _params?: unknown[]): Promise<QueryResult> {
    if (sql.includes("FROM tags t") && sql.includes("archive_enabled")) {
      return {
        rows: [{
          id: 1,
          name: "speed",
          display_name: "speed",
          unit: null,
          data_type_code: "NUMBER",
          description: null,
          group_name: null,
          min_value: null,
          max_value: null,
          source_type_code: null,
          driver_type: null,
          archive_enabled: true,
          policy_mode: "on_change_with_periodic",
          policy_period_ms: 5000,
        }],
      };
    }
    if (sql.includes("COUNT(*)::bigint AS cnt") && sql.includes("MIN(s.time) AS first_time")) {
      return {
        rows: [{
          cnt: "1",
          first_time: new Date(2_000),
          last_time: new Date(2_000),
        }],
      };
    }
    if (sql.includes("s.time <= $2") && sql.includes("ORDER BY s.time DESC")) {
      return { rows: [] };
    }
    if (sql.includes("ORDER BY s.time ASC") && sql.includes("LIMIT $4")) {
      return {
        rows: [{
          time: new Date(2_000),
          value: 390,
          quality: "good",
        }],
      };
    }
    return { rows: [] };
  }
}

describe("ArchiveRepository.enforceRuntimeLimits", () => {
  it("deletes old samples in a limited transaction without running vacuum", async () => {
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

    expect(result.deletedBySize).toBeGreaterThan(0);
    expect(pool.calls.some((call) => call.includes("VACUUM"))).toBe(false);
    expect(pool.calls.some((call) => call.includes("DELETE FROM archive_samples"))).toBe(true);
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

describe("ArchiveRepository.queryTrends diagnostics", () => {
  it("reports missing history when a tag has no archived point before the query range", async () => {
    const infoMessages: string[] = [];
    const repository = new ArchiveRepository(
      { connectionString: "postgres://unused" },
      {
        info: (message) => infoMessages.push(message),
        warn: () => undefined,
        error: () => undefined,
      },
    );
    (repository as unknown as { pool: TrendQueryFakePool }).pool = new TrendQueryFakePool();

    const result = await repository.queryTrends({
      tags: ["speed"],
      from: new Date(1_000),
      to: new Date(3_000),
      maxPoints: 1000,
      aggregation: "raw",
      hardLimitPerSeries: 10_000,
    });

    expect(result.series[0]?.diagnostics).toMatchObject({
      tag: "speed",
      policyMode: "on_change_with_periodic",
      policyPeriodMs: 5000,
      policyRequiresIncomingSamples: true,
      archiveHeartbeatEnabled: false,
      pointsInRange: 1,
      firstPointTs: 2_000,
      lastPointTs: 2_000,
      previousPointBeforeRangeTs: null,
      hasPreviousBeforeRange: false,
      missingHistoryBeforeRange: true,
    });
    expect(infoMessages.some((message) => message.startsWith("trend:series-missing-history "))).toBe(true);
  });
});
