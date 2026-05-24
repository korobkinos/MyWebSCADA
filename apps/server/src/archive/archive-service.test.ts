import { describe, expect, it } from "vitest";
import type { EventArchiveSettings, OperatorActionArchiveSettings } from "@web-scada/shared";
import {
  ArchiveService,
  resolveArchiveMaintenanceThresholds,
  shouldRunArchiveMaintenanceAfterSettingsUpdate,
} from "./archive-service";

const baseRuntimeSettings = {
  autoCleanupEnabled: true,
  maxDbSizeMb: 5120,
  deleteBatchSize: 500,
  maintenanceIntervalMs: 3000,
  maxMaintenanceTickMs: 200,
  maxDeleteTransactionMs: 150,
  updatedAt: "2026-05-22T00:00:00.000Z",
};

const baseEventSettings: EventArchiveSettings = {
  enabled: true,
  retentionDays: 90,
  maxDatabaseSizeMb: 1000,
  cleanupMode: "byAgeAndSize",
  cleanupIntervalMinutes: 60,
  optimizeAfterCleanup: false,
  deleteBatchSize: 500,
  maintenanceIntervalMs: 3000,
  maxMaintenanceTickMs: 200,
  maxDeleteTransactionMs: 150,
};

const baseOperatorSettings: OperatorActionArchiveSettings = {
  enabled: true,
  retentionDays: 90,
  maxDatabaseSizeMb: 1000,
  cleanupMode: "byAgeAndSize",
  cleanupIntervalMinutes: 60,
  optimizeAfterCleanup: false,
  deleteBatchSize: 500,
  maintenanceIntervalMs: 3000,
  maxMaintenanceTickMs: 200,
  maxDeleteTransactionMs: 150,
};

function createServiceWithRepository(repository: Record<string, unknown>): ArchiveService {
  const service = new ArchiveService(
    {
      connectionString: "postgres://unused",
    },
    {
      subscribeUpdates: () => () => undefined,
      getSnapshots: () => [],
    } as never,
    {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  );

  (service as unknown as { initialized: boolean }).initialized = true;
  (service as unknown as { repository: Record<string, unknown> }).repository = {
    getRuntimeSettings: async () => ({ ...baseRuntimeSettings }),
    getStorageStats: async () => ({ dbSizeMb: 900, recordsCount: 1000 }),
    getActiveTrendQueries: () => 0,
    getActiveEventQueries: () => 0,
    getActiveOperatorActionQueries: () => 0,
    getActiveOperatorActionWrites: () => 0,
    applyRetentionBatch: async () => 0,
    deleteOldestSamplesBatch: async () => ({ deletedRecords: 0, durationMs: 1 }),
    getEventArchiveSettings: async () => ({ ...baseEventSettings }),
    getEventArchiveStatus: async () => ({
      dbSizeMb: 900,
      recordsCount: 1000,
      oldestRecordAt: "2026-01-01T00:00:00.000Z",
      newestRecordAt: "2026-01-02T00:00:00.000Z",
      settings: { ...baseEventSettings },
    }),
    getOperatorActionArchiveStatus: async () => ({
      dbSizeMb: 900,
      recordsCount: 1000,
      oldestRecordAt: "2026-01-01T00:00:00.000Z",
      newestRecordAt: "2026-01-02T00:00:00.000Z",
      settings: { ...baseOperatorSettings },
    }),
    deleteEventOccurrencesByRetentionBatch: async () => ({ deletedRecords: 0, durationMs: 1 }),
    deleteOldestEventOccurrencesBatch: async () => ({ deletedRecords: 0, durationMs: 1 }),
    deleteOperatorActionsByRetentionBatch: async () => ({ deletedRecords: 0, durationMs: 1 }),
    deleteOldestOperatorActionsBatch: async () => ({ deletedRecords: 0, durationMs: 1 }),
    ...repository,
  };

  service.setOperatorActionArchiveSettings({ ...baseOperatorSettings, enabled: false });
  return service;
}

describe("archive runtime settings maintenance trigger", () => {
  it("runs maintenance when max database size is lowered", () => {
    expect(shouldRunArchiveMaintenanceAfterSettingsUpdate(baseRuntimeSettings, {
      ...baseRuntimeSettings,
      maxDbSizeMb: 3000,
    })).toBe(true);
  });

  it("does not run maintenance when there is no active size limit", () => {
    expect(shouldRunArchiveMaintenanceAfterSettingsUpdate(baseRuntimeSettings, {
      ...baseRuntimeSettings,
      maxDbSizeMb: null,
    })).toBe(false);
  });
});

describe("resolveArchiveMaintenanceThresholds", () => {
  it("does not start pruning when size is below hysteresis start threshold", () => {
    const thresholds = resolveArchiveMaintenanceThresholds(2000);
    expect(thresholds.startThresholdMb).toBe(2200);
  });

  it("stops pruning below stop threshold", () => {
    const thresholds = resolveArchiveMaintenanceThresholds(2000);
    expect(thresholds.stopThresholdMb).toBe(1900);
  });
});

describe("ArchiveService soft maintenance behavior", () => {
  it("respects trend delete batch size and reports detailed status", async () => {
    const deleteLimits: number[] = [];
    let trendStatsCall = 0;
    const service = createServiceWithRepository({
      getRuntimeSettings: async () => ({
        ...baseRuntimeSettings,
        maxDbSizeMb: 1000,
        deleteBatchSize: 321,
        maintenanceIntervalMs: 200,
        maxMaintenanceTickMs: 100,
        maxDeleteTransactionMs: 50,
      }),
      getStorageStats: async () => {
        trendStatsCall += 1;
        if (trendStatsCall === 1) {
          return { dbSizeMb: 1300, recordsCount: 5000 };
        }
        return { dbSizeMb: 900, recordsCount: 4500 };
      },
      deleteOldestSamplesBatch: async (options: { limit: number; maxTransactionMs: number }) => {
        deleteLimits.push(options.limit);
        return { deletedRecords: 321, durationMs: 12 };
      },
    });

    const result = await service.runMaintenance();
    const status = await service.getStatus();

    expect(result.deletedSamples).toBe(321);
    expect(deleteLimits).toEqual([321]);
    expect(status.recordsDeletedInLastBatch).toBe(321);
    expect(status.totalRecordsDeletedThisRun).toBe(321);
    expect(status.startThresholdMb).toBe(1100);
    expect(status.stopThresholdMb).toBe(950);
  });

  it("pauses trend maintenance when trend load is active", async () => {
    const service = createServiceWithRepository({
      getRuntimeSettings: async () => ({ ...baseRuntimeSettings, maxDbSizeMb: 1000 }),
      getStorageStats: async () => ({ dbSizeMb: 1300, recordsCount: 5000 }),
      getActiveTrendQueries: () => 2,
      deleteOldestSamplesBatch: async () => ({ deletedRecords: 500, durationMs: 10 }),
    });

    await service.runMaintenance();
    const status = await service.getStatus();

    expect(status.status).toBe("paused");
    expect(status.pauseReason).toContain("trend_queries_active");
  });

  it("clamps trend tick budget so it is never below delete transaction timeout", async () => {
    const deleteOptions: Array<{ limit: number; maxTransactionMs: number }> = [];
    let trendStatsCall = 0;
    const service = createServiceWithRepository({
      getRuntimeSettings: async () => ({
        ...baseRuntimeSettings,
        maxDbSizeMb: 1000,
        maxMaintenanceTickMs: 80,
        maxDeleteTransactionMs: 150,
      }),
      getStorageStats: async () => {
        trendStatsCall += 1;
        if (trendStatsCall === 1) {
          return { dbSizeMb: 1300, recordsCount: 5000 };
        }
        return { dbSizeMb: 900, recordsCount: 4500 };
      },
      deleteOldestSamplesBatch: async (options: { limit: number; maxTransactionMs: number }) => {
        deleteOptions.push(options);
        return { deletedRecords: 500, durationMs: 12 };
      },
    });

    await service.runMaintenance();
    expect(deleteOptions[0]?.maxTransactionMs).toBe(150);
  });

  it("event maintenance does not start below hysteresis threshold", async () => {
    const eventDeleteCalls: string[] = [];
    const service = createServiceWithRepository({
      getEventArchiveSettings: async () => ({
        ...baseEventSettings,
        maxDatabaseSizeMb: 1000,
        deleteBatchSize: 250,
      }),
      getEventArchiveStatus: async () => ({
        dbSizeMb: 1090,
        recordsCount: 5000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseEventSettings, maxDatabaseSizeMb: 1000, deleteBatchSize: 250 },
      }),
      deleteEventOccurrencesByRetentionBatch: async () => {
        eventDeleteCalls.push("age");
        return { deletedRecords: 0, durationMs: 2 };
      },
      deleteOldestEventOccurrencesBatch: async () => {
        eventDeleteCalls.push("size");
        return { deletedRecords: 0, durationMs: 2 };
      },
    });

    await service.runMaintenance();
    const eventStatus = await service.getEventArchiveStatus();
    expect(eventDeleteCalls).toHaveLength(0);
    expect(eventStatus.status).toBe("scheduled");
    expect(eventStatus.startThresholdMb).toBe(1100);
  });

  it("event maintenance starts above start threshold and stops below stop threshold", async () => {
    let eventDbSize = 1300;
    let eventRecords = 5000;
    const service = createServiceWithRepository({
      getEventArchiveSettings: async () => ({
        ...baseEventSettings,
        maxDatabaseSizeMb: 1000,
        deleteBatchSize: 500,
        maintenanceIntervalMs: 500,
      }),
      getEventArchiveStatus: async () => ({
        dbSizeMb: eventDbSize,
        recordsCount: eventRecords,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseEventSettings, maxDatabaseSizeMb: 1000, deleteBatchSize: 500 },
      }),
      deleteEventOccurrencesByRetentionBatch: async () => ({ deletedRecords: 0, durationMs: 3 }),
      deleteOldestEventOccurrencesBatch: async () => {
        eventDbSize = 900;
        eventRecords = 4500;
        return { deletedRecords: 500, durationMs: 9 };
      },
    });

    await service.runMaintenance();
    const eventStatus = await service.getEventArchiveStatus();

    expect(eventStatus.status).toBe("scheduled");
    expect(eventStatus.recordsDeletedInLastBatch).toBe(500);
    expect(eventStatus.totalRecordsDeletedThisRun).toBe(500);
    expect(eventStatus.lastBatchDurationMs).toBe(9);
    expect(eventStatus.stopThresholdMb).toBe(950);
  });

  it("event maintenance respects maxDeleteTransactionMs in bounded batch", async () => {
    const txLimits: number[] = [];
    const service = createServiceWithRepository({
      getEventArchiveSettings: async () => ({
        ...baseEventSettings,
        maxDatabaseSizeMb: 1000,
        maxDeleteTransactionMs: 120,
      }),
      getEventArchiveStatus: async () => ({
        dbSizeMb: 1300,
        recordsCount: 5000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseEventSettings, maxDatabaseSizeMb: 1000, maxDeleteTransactionMs: 120 },
      }),
      deleteEventOccurrencesByRetentionBatch: async () => ({ deletedRecords: 0, durationMs: 2 }),
      deleteOldestEventOccurrencesBatch: async (options: { maxTransactionMs: number }) => {
        txLimits.push(options.maxTransactionMs);
        return { deletedRecords: 0, durationMs: 2 };
      },
    });

    await service.runMaintenance();
    expect(txLimits[0]).toBe(120);
  });

  it("event maintenance pauses under simulated runtime load", async () => {
    const service = createServiceWithRepository({
      getEventArchiveSettings: async () => ({
        ...baseEventSettings,
        maxDatabaseSizeMb: 1000,
      }),
      getEventArchiveStatus: async () => ({
        dbSizeMb: 1300,
        recordsCount: 5000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseEventSettings, maxDatabaseSizeMb: 1000 },
      }),
      getActiveEventQueries: () => 3,
    });

    await service.runMaintenance();
    const eventStatus = await service.getEventArchiveStatus();
    expect(eventStatus.status).toBe("paused");
    expect(eventStatus.pauseReason).toContain("event_queries_active");
  });

  it("operator maintenance supports the same status fields", async () => {
    let operatorDbSize = 1300;
    let operatorRecords = 4000;
    const service = createServiceWithRepository({
      getOperatorActionArchiveStatus: async () => ({
        dbSizeMb: operatorDbSize,
        recordsCount: operatorRecords,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseOperatorSettings, maxDatabaseSizeMb: 1000 },
      }),
      deleteOperatorActionsByRetentionBatch: async () => ({ deletedRecords: 0, durationMs: 2 }),
      deleteOldestOperatorActionsBatch: async () => {
        operatorDbSize = 900;
        operatorRecords = 3500;
        return { deletedRecords: 500, durationMs: 7 };
      },
    });
    service.setOperatorActionArchiveSettings({
      ...baseOperatorSettings,
      enabled: true,
      maxDatabaseSizeMb: 1000,
      deleteBatchSize: 500,
      maintenanceIntervalMs: 500,
    });

    await service.runMaintenance();
    const operatorStatus = await service.getOperatorActionArchiveStatus();

    expect(operatorStatus.status).toBe("scheduled");
    expect(operatorStatus.recordsDeletedInLastBatch).toBe(500);
    expect(operatorStatus.totalRecordsDeletedThisRun).toBe(500);
    expect(operatorStatus.lastBatchDurationMs).toBe(7);
    expect(operatorStatus.startThresholdMb).toBe(1100);
    expect(operatorStatus.stopThresholdMb).toBe(950);
  });
});
