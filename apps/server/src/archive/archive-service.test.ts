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
    getStorageStats: async () => ({
      dbSizeMb: 900,
      recordsCount: 1000,
      estimatedSamplesCount: 1000,
      actualSamplesCount: 1000,
      oldestSampleTime: "2026-01-01T00:00:00.000Z",
      newestSampleTime: "2026-01-02T00:00:00.000Z",
      isHypertable: false,
      hypertableChunksCount: null,
      compressedChunksCount: null,
      archiveSamplesRelationSizeMb: 200,
      archiveSamplesTotalSizeMb: 220,
    }),
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
          return { dbSizeMb: 1200, recordsCount: 5000 };
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
    expect(status.statusDetail).toBe("pruning_by_size");
    expect(status.lastSizeDeleted).toBe(321);
    expect(status.startThresholdMb).toBe(1100);
    expect(status.stopThresholdMb).toBe(950);
  });

  it("marks trend maintenance as delete_returned_zero when size pruning deletes zero rows with selected candidates", async () => {
    const service = createServiceWithRepository({
      getRuntimeSettings: async () => ({ ...baseRuntimeSettings, maxDbSizeMb: 1000 }),
      getStorageStats: async () => ({ dbSizeMb: 1300, recordsCount: 5000 }),
      deleteOldestSamplesBatch: async () => ({
        deletedRecords: 0,
        durationMs: 7,
        diagnostics: {
          deleteAttemptAt: "2026-05-24T10:00:00.000Z",
          reason: "size above threshold but DELETE returned 0 despite available candidates",
          actualSamplesCount: 5_000,
          estimatedSamplesCount: 4_900,
          oldestTimeBeforeDelete: "2026-01-01T00:00:00.000Z",
          newestTimeBeforeDelete: "2026-05-24T09:59:59.000Z",
          selectedRowsBeforeDelete: 500,
          oldestSelectedTimeBeforeDelete: "2026-01-01T00:00:00.000Z",
          newestSelectedTimeBeforeDelete: "2026-01-02T00:00:00.000Z",
          isHypertable: true,
          hypertableChunksCount: 42,
          compressedChunksCount: 12,
          archiveSamplesRelationSizeMb: 10,
          archiveSamplesTotalSizeMb: 1500,
        },
      }),
    });

    await service.runMaintenance();
    const status = await service.getStatus();

    expect(status.status).toBe("paused");
    expect(status.statusDetail).toBe("delete_returned_zero");
    expect(status.recordsDeletedInLastBatch).toBe(0);
    expect(status.lastBatchDurationMs).toBe(7);
    expect(status.lastPruneReason).toContain("DELETE returned 0");
    expect(status.status).not.toBe("pruning");
  });

  it("marks trend maintenance as timescale_chunk_cleanup_required when zero delete has only compressed hypertable chunks", async () => {
    const service = createServiceWithRepository({
      getRuntimeSettings: async () => ({ ...baseRuntimeSettings, maxDbSizeMb: 1000 }),
      getStorageStats: async () => ({ dbSizeMb: 1300, recordsCount: 5000 }),
      deleteOldestSamplesBatch: async () => ({
        deletedRecords: 0,
        durationMs: 8,
        diagnostics: {
          deleteAttemptAt: "2026-05-24T10:00:00.000Z",
          reason: "size above threshold but no oldest candidates were selected",
          actualSamplesCount: 5_000,
          estimatedSamplesCount: 4_900,
          oldestTimeBeforeDelete: "2026-01-01T00:00:00.000Z",
          newestTimeBeforeDelete: "2026-05-24T09:59:59.000Z",
          selectedRowsBeforeDelete: 0,
          oldestSelectedTimeBeforeDelete: null,
          newestSelectedTimeBeforeDelete: null,
          isHypertable: true,
          hypertableChunksCount: 42,
          compressedChunksCount: 42,
          archiveSamplesRelationSizeMb: 10,
          archiveSamplesTotalSizeMb: 1500,
        },
      }),
    });

    await service.runMaintenance();
    const status = await service.getStatus();

    expect(status.status).toBe("paused");
    expect(status.statusDetail).toBe("timescale_chunk_cleanup_required");
  });

  it("reports delete_timed_out when trend size delete hits statement timeout", async () => {
    const timeoutError = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    const service = createServiceWithRepository({
      getRuntimeSettings: async () => ({ ...baseRuntimeSettings, maxDbSizeMb: 1000, maxDeleteTransactionMs: 50 }),
      getStorageStats: async () => ({ dbSizeMb: 1300, recordsCount: 5000 }),
      deleteOldestSamplesBatch: async () => {
        throw timeoutError;
      },
    });

    await service.runMaintenance();
    const status = await service.getStatus();

    expect(status.status).toBe("paused");
    expect(status.statusDetail).toBe("delete_timed_out");
    expect(status.lastPruneError).toContain("statement timeout");
  });

  it("surfaces delete_failed when repository returns structured delete error", async () => {
    const service = createServiceWithRepository({
      getRuntimeSettings: async () => ({ ...baseRuntimeSettings, maxDbSizeMb: 1000, maxDeleteTransactionMs: 50 }),
      getStorageStats: async () => ({ dbSizeMb: 1300, recordsCount: 5000 }),
      deleteOldestSamplesBatch: async () => ({
        deletedRecords: 0,
        durationMs: 9,
        errorCode: "XX000",
        errorMessage: "delete execution failed",
        diagnostics: {
          deleteAttemptAt: "2026-05-24T10:00:00.000Z",
          reason: "size delete failed",
          actualSamplesCount: null,
          estimatedSamplesCount: null,
          oldestTimeBeforeDelete: null,
          newestTimeBeforeDelete: null,
          selectedRowsBeforeDelete: 0,
          oldestSelectedTimeBeforeDelete: null,
          newestSelectedTimeBeforeDelete: null,
          isHypertable: false,
          hypertableChunksCount: null,
          compressedChunksCount: null,
          archiveSamplesRelationSizeMb: null,
          archiveSamplesTotalSizeMb: null,
          errorCode: "XX000",
          errorMessage: "delete execution failed",
        },
      }),
    });

    await service.runMaintenance();
    const status = await service.getStatus();

    expect(status.status).toBe("error");
    expect(status.statusDetail).toBe("delete_failed");
    expect(status.lastPruneError).toContain("delete execution failed");
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
    expect(status.statusDetail).toBe("waiting_due_to_load_guard");
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
          return { dbSizeMb: 1150, recordsCount: 5000 };
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

  it("uses emergency effective settings when trend db is above 1.5x max limit", async () => {
    const deleteOptions: Array<{ limit: number; maxTransactionMs: number }> = [];
    let trendStatsCall = 0;
    const service = createServiceWithRepository({
      getRuntimeSettings: async () => ({
        ...baseRuntimeSettings,
        maxDbSizeMb: 1000,
        deleteBatchSize: 12000,
        maintenanceIntervalMs: 3000,
        maxMaintenanceTickMs: 500,
        maxDeleteTransactionMs: 300,
      }),
      getStorageStats: async () => {
        trendStatsCall += 1;
        if (trendStatsCall === 1) {
          return { dbSizeMb: 1700, recordsCount: 5000 };
        }
        return { dbSizeMb: 900, recordsCount: 4500 };
      },
      deleteOldestSamplesBatch: async (options: { limit: number; maxTransactionMs: number }) => {
        deleteOptions.push(options);
        return { deletedRecords: 1000, durationMs: 20 };
      },
    });

    await service.runMaintenance();
    const status = await service.getStatus();

    expect(deleteOptions[0]).toEqual({ limit: 100_000, maxTransactionMs: 3000 });
    expect(status.aggressivenessMode).toBe("emergency_boost");
    expect(status.effectiveDeleteBatchSize).toBe(100_000);
  });

  it("uses fast effective settings when trend db is above 1.25x max limit", async () => {
    const deleteOptions: Array<{ limit: number; maxTransactionMs: number }> = [];
    let trendStatsCall = 0;
    const service = createServiceWithRepository({
      getRuntimeSettings: async () => ({ ...baseRuntimeSettings, maxDbSizeMb: 1000 }),
      getStorageStats: async () => {
        trendStatsCall += 1;
        if (trendStatsCall === 1) {
          return { dbSizeMb: 1300, recordsCount: 5000 };
        }
        return { dbSizeMb: 900, recordsCount: 4500 };
      },
      deleteOldestSamplesBatch: async (options: { limit: number; maxTransactionMs: number }) => {
        deleteOptions.push(options);
        return { deletedRecords: 1000, durationMs: 20 };
      },
    });

    await service.runMaintenance();
    const status = await service.getStatus();

    expect(deleteOptions[0]).toEqual({ limit: 50_000, maxTransactionMs: 1500 });
    expect(status.aggressivenessMode).toBe("fast_boost");
    expect(status.effectiveDeleteBatchSize).toBe(50_000);
  });

  it("uses configured settings when trend db is between start threshold and 1.25x limit", async () => {
    const deleteOptions: Array<{ limit: number; maxTransactionMs: number }> = [];
    let trendStatsCall = 0;
    const service = createServiceWithRepository({
      getRuntimeSettings: async () => ({
        ...baseRuntimeSettings,
        maxDbSizeMb: 1000,
        deleteBatchSize: 12345,
        maintenanceIntervalMs: 2100,
        maxMaintenanceTickMs: 900,
        maxDeleteTransactionMs: 700,
      }),
      getStorageStats: async () => {
        trendStatsCall += 1;
        if (trendStatsCall === 1) {
          return { dbSizeMb: 1150, recordsCount: 5000 };
        }
        return { dbSizeMb: 900, recordsCount: 4500 };
      },
      deleteOldestSamplesBatch: async (options: { limit: number; maxTransactionMs: number }) => {
        deleteOptions.push(options);
        return { deletedRecords: 1000, durationMs: 20 };
      },
    });

    await service.runMaintenance();
    const status = await service.getStatus();

    expect(deleteOptions[0]).toEqual({ limit: 12345, maxTransactionMs: 700 });
    expect(status.aggressivenessMode).toBe("configured");
    expect(status.effectiveDeleteBatchSize).toBe(12345);
  });

  it("still respects load guard when emergency boost would otherwise apply", async () => {
    const deleteOptions: Array<{ limit: number; maxTransactionMs: number }> = [];
    const service = createServiceWithRepository({
      getRuntimeSettings: async () => ({ ...baseRuntimeSettings, maxDbSizeMb: 1000 }),
      getStorageStats: async () => ({ dbSizeMb: 1700, recordsCount: 5000 }),
      getActiveTrendQueries: () => 2,
      deleteOldestSamplesBatch: async (options: { limit: number; maxTransactionMs: number }) => {
        deleteOptions.push(options);
        return { deletedRecords: 1000, durationMs: 20 };
      },
    });

    await service.runMaintenance();
    const status = await service.getStatus();

    expect(status.status).toBe("paused");
    expect(status.statusDetail).toBe("waiting_due_to_load_guard");
    expect(status.aggressivenessMode).toBe("emergency_boost");
    expect(deleteOptions).toEqual([]);
  });

  it("applies emergency effective settings to event and operator archives when db is above 1.5x limit", async () => {
    const eventDeleteOptions: Array<{ limit: number; maxTransactionMs: number }> = [];
    const operatorDeleteOptions: Array<{ limit: number; maxTransactionMs: number }> = [];
    const service = createServiceWithRepository({
      getRuntimeSettings: async () => ({ ...baseRuntimeSettings, maxDbSizeMb: 2000 }),
      getStorageStats: async () => ({ dbSizeMb: 1000, recordsCount: 5000 }),
      getEventArchiveSettings: async () => ({
        ...baseEventSettings,
        cleanupMode: "byAge",
        maxDatabaseSizeMb: 1000,
      }),
      getEventArchiveStatus: async () => ({
        dbSizeMb: 1700,
        recordsCount: 5000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseEventSettings, cleanupMode: "byAge", maxDatabaseSizeMb: 1000 },
      }),
      deleteEventOccurrencesByRetentionBatch: async (options: { limit: number; maxTransactionMs: number }) => {
        eventDeleteOptions.push({ limit: options.limit, maxTransactionMs: options.maxTransactionMs });
        return { deletedRecords: 0, durationMs: 1 };
      },
      getOperatorActionArchiveStatus: async () => ({
        dbSizeMb: 1700,
        recordsCount: 5000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseOperatorSettings, cleanupMode: "byAge", maxDatabaseSizeMb: 1000 },
      }),
      deleteOperatorActionsByRetentionBatch: async (options: { limit: number; maxTransactionMs: number }) => {
        operatorDeleteOptions.push({ limit: options.limit, maxTransactionMs: options.maxTransactionMs });
        return { deletedRecords: 0, durationMs: 1 };
      },
    });
    service.setOperatorActionArchiveSettings({
      ...baseOperatorSettings,
      enabled: true,
      cleanupMode: "byAge",
      maxDatabaseSizeMb: 1000,
    });

    await service.runMaintenance();
    const eventStatus = await service.getEventArchiveStatus();
    const operatorStatus = await service.getOperatorActionArchiveStatus();

    expect(eventDeleteOptions[0]).toEqual({ limit: 100_000, maxTransactionMs: 3000 });
    expect(operatorDeleteOptions[0]).toEqual({ limit: 100_000, maxTransactionMs: 3000 });
    expect(eventStatus.aggressivenessMode).toBe("emergency_boost");
    expect(operatorStatus.aggressivenessMode).toBe("emergency_boost");
  });

  it("applies fast effective settings to event and operator archives when db is above 1.25x limit", async () => {
    const eventDeleteOptions: Array<{ limit: number; maxTransactionMs: number }> = [];
    const operatorDeleteOptions: Array<{ limit: number; maxTransactionMs: number }> = [];
    const service = createServiceWithRepository({
      getRuntimeSettings: async () => ({ ...baseRuntimeSettings, maxDbSizeMb: 2000 }),
      getStorageStats: async () => ({ dbSizeMb: 1000, recordsCount: 5000 }),
      getEventArchiveSettings: async () => ({
        ...baseEventSettings,
        cleanupMode: "byAge",
        maxDatabaseSizeMb: 1000,
      }),
      getEventArchiveStatus: async () => ({
        dbSizeMb: 1300,
        recordsCount: 5000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseEventSettings, cleanupMode: "byAge", maxDatabaseSizeMb: 1000 },
      }),
      deleteEventOccurrencesByRetentionBatch: async (options: { limit: number; maxTransactionMs: number }) => {
        eventDeleteOptions.push({ limit: options.limit, maxTransactionMs: options.maxTransactionMs });
        return { deletedRecords: 0, durationMs: 1 };
      },
      getOperatorActionArchiveStatus: async () => ({
        dbSizeMb: 1300,
        recordsCount: 5000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseOperatorSettings, cleanupMode: "byAge", maxDatabaseSizeMb: 1000 },
      }),
      deleteOperatorActionsByRetentionBatch: async (options: { limit: number; maxTransactionMs: number }) => {
        operatorDeleteOptions.push({ limit: options.limit, maxTransactionMs: options.maxTransactionMs });
        return { deletedRecords: 0, durationMs: 1 };
      },
    });
    service.setOperatorActionArchiveSettings({
      ...baseOperatorSettings,
      enabled: true,
      cleanupMode: "byAge",
      maxDatabaseSizeMb: 1000,
    });

    await service.runMaintenance();
    const eventStatus = await service.getEventArchiveStatus();
    const operatorStatus = await service.getOperatorActionArchiveStatus();

    expect(eventDeleteOptions[0]).toEqual({ limit: 50_000, maxTransactionMs: 1500 });
    expect(operatorDeleteOptions[0]).toEqual({ limit: 50_000, maxTransactionMs: 1500 });
    expect(eventStatus.aggressivenessMode).toBe("fast_boost");
    expect(operatorStatus.aggressivenessMode).toBe("fast_boost");
  });

  it("event byAge deletes expired rows even below start threshold", async () => {
    let ageCalls = 0;
    const service = createServiceWithRepository({
      getEventArchiveSettings: async () => ({
        ...baseEventSettings,
        cleanupMode: "byAge",
        maxDatabaseSizeMb: 1000,
        deleteBatchSize: 250,
      }),
      getEventArchiveStatus: async () => ({
        dbSizeMb: 900,
        recordsCount: 5000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseEventSettings, cleanupMode: "byAge", maxDatabaseSizeMb: 1000, deleteBatchSize: 250 },
      }),
      deleteEventOccurrencesByRetentionBatch: async () => {
        ageCalls += 1;
        return ageCalls === 1 ? { deletedRecords: 120, durationMs: 2 } : { deletedRecords: 0, durationMs: 1 };
      },
      deleteOldestEventOccurrencesBatch: async () => {
        return { deletedRecords: 0, durationMs: 2 };
      },
    });

    await service.runMaintenance();
    const eventStatus = await service.getEventArchiveStatus();

    expect(ageCalls).toBeGreaterThan(0);
    expect(["pruning", "cooling_down", "scheduled"]).toContain(eventStatus.status);
    expect(eventStatus.startThresholdMb).toBe(1100);
    expect(
      eventStatus.statusDetail === "pruning_by_age" || eventStatus.statusDetail === undefined,
    ).toBe(true);
    expect(eventStatus.pauseReason).toBeUndefined();
  });

  it("event bySize does not start below hysteresis threshold", async () => {
    let sizeCalls = 0;
    const service = createServiceWithRepository({
      getEventArchiveSettings: async () => ({
        ...baseEventSettings,
        cleanupMode: "bySize",
        maxDatabaseSizeMb: 1000,
        deleteBatchSize: 250,
      }),
      getEventArchiveStatus: async () => ({
        dbSizeMb: 900,
        recordsCount: 5000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseEventSettings, cleanupMode: "bySize", maxDatabaseSizeMb: 1000, deleteBatchSize: 250 },
      }),
      deleteEventOccurrencesByRetentionBatch: async () => ({ deletedRecords: 0, durationMs: 3 }),
      deleteOldestEventOccurrencesBatch: async () => {
        sizeCalls += 1;
        return { deletedRecords: 250, durationMs: 9 };
      },
    });

    await service.runMaintenance();
    const eventStatus = await service.getEventArchiveStatus();

    expect(sizeCalls).toBe(0);
    expect(eventStatus.status).toBe("scheduled");
    expect(eventStatus.recordsDeletedInLastBatch).toBe(0);
    expect(eventStatus.stopThresholdMb).toBe(950);
  });

  it("event byAgeAndSize runs age cleanup below threshold but skips size cleanup", async () => {
    let ageCalls = 0;
    let sizeCalls = 0;
    const service = createServiceWithRepository({
      getEventArchiveSettings: async () => ({
        ...baseEventSettings,
        cleanupMode: "byAgeAndSize",
        maxDatabaseSizeMb: 1000,
      }),
      getEventArchiveStatus: async () => ({
        dbSizeMb: 900,
        recordsCount: 5000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseEventSettings, cleanupMode: "byAgeAndSize", maxDatabaseSizeMb: 1000 },
      }),
      deleteEventOccurrencesByRetentionBatch: async () => {
        ageCalls += 1;
        return ageCalls === 1 ? { deletedRecords: 40, durationMs: 2 } : { deletedRecords: 0, durationMs: 1 };
      },
      deleteOldestEventOccurrencesBatch: async () => {
        sizeCalls += 1;
        return { deletedRecords: 10, durationMs: 2 };
      },
    });

    await service.runMaintenance();
    const eventStatus = await service.getEventArchiveStatus();

    expect(ageCalls).toBeGreaterThan(0);
    expect(sizeCalls).toBe(0);
    expect(["pruning", "cooling_down", "scheduled"]).toContain(eventStatus.status);
  });

  it("event maintenance respects maxDeleteTransactionMs in byAge path", async () => {
    const txLimits: number[] = [];
    const service = createServiceWithRepository({
      getEventArchiveSettings: async () => ({
        ...baseEventSettings,
        cleanupMode: "byAge",
        maxDatabaseSizeMb: 1000,
        maxDeleteTransactionMs: 120,
      }),
      getEventArchiveStatus: async () => ({
        dbSizeMb: 900,
        recordsCount: 5000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseEventSettings, cleanupMode: "byAge", maxDatabaseSizeMb: 1000, maxDeleteTransactionMs: 120 },
      }),
      deleteEventOccurrencesByRetentionBatch: async (options: { maxTransactionMs: number }) => {
        txLimits.push(options.maxTransactionMs);
        return { deletedRecords: 0, durationMs: 2 };
      },
      deleteOldestEventOccurrencesBatch: async () => ({ deletedRecords: 0, durationMs: 2 }),
    });

    await service.runMaintenance();
    expect(txLimits[0]).toBe(120);
  });

  it("event byAge path still respects load guard", async () => {
    let ageCalls = 0;
    const service = createServiceWithRepository({
      getEventArchiveSettings: async () => ({
        ...baseEventSettings,
        cleanupMode: "byAge",
        maxDatabaseSizeMb: 1000,
      }),
      getEventArchiveStatus: async () => ({
        dbSizeMb: 900,
        recordsCount: 5000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseEventSettings, cleanupMode: "byAge", maxDatabaseSizeMb: 1000 },
      }),
      getActiveEventQueries: () => 3,
      deleteEventOccurrencesByRetentionBatch: async () => {
        ageCalls += 1;
        return { deletedRecords: 10, durationMs: 2 };
      },
    });

    await service.runMaintenance();
    const eventStatus = await service.getEventArchiveStatus();
    expect(ageCalls).toBe(0);
    expect(eventStatus.status).toBe("paused");
    expect(eventStatus.pauseReason).toContain("event_queries_active");
  });

  it("event emergency boost still respects load guard", async () => {
    let ageCalls = 0;
    const service = createServiceWithRepository({
      getEventArchiveSettings: async () => ({
        ...baseEventSettings,
        cleanupMode: "byAge",
        maxDatabaseSizeMb: 1000,
      }),
      getEventArchiveStatus: async () => ({
        dbSizeMb: 1700,
        recordsCount: 5000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseEventSettings, cleanupMode: "byAge", maxDatabaseSizeMb: 1000 },
      }),
      getActiveEventQueries: () => 2,
      deleteEventOccurrencesByRetentionBatch: async () => {
        ageCalls += 1;
        return { deletedRecords: 10, durationMs: 2 };
      },
    });

    await service.runMaintenance();
    const eventStatus = await service.getEventArchiveStatus();
    expect(ageCalls).toBe(0);
    expect(eventStatus.status).toBe("paused");
    expect(eventStatus.pauseReason).toContain("event_queries_active");
    expect(eventStatus.aggressivenessMode).toBe("emergency_boost");
  });

  it("operator byAge deletes expired rows even below start threshold", async () => {
    let ageCalls = 0;
    const service = createServiceWithRepository({
      getOperatorActionArchiveStatus: async () => ({
        dbSizeMb: 900,
        recordsCount: 4000,
        oldestRecordAt: "2025-01-01T00:00:00.000Z",
        newestRecordAt: "2026-01-01T00:00:00.000Z",
        settings: { ...baseOperatorSettings, cleanupMode: "byAge", maxDatabaseSizeMb: 1000 },
      }),
      deleteOperatorActionsByRetentionBatch: async () => {
        ageCalls += 1;
        return ageCalls === 1 ? { deletedRecords: 30, durationMs: 2 } : { deletedRecords: 0, durationMs: 1 };
      },
      deleteOldestOperatorActionsBatch: async () => ({ deletedRecords: 0, durationMs: 2 }),
    });
    service.setOperatorActionArchiveSettings({
      ...baseOperatorSettings,
      enabled: true,
      cleanupMode: "byAge",
      maxDatabaseSizeMb: 1000,
      deleteBatchSize: 500,
      maintenanceIntervalMs: 500,
    });

    await service.runMaintenance();
    const operatorStatus = await service.getOperatorActionArchiveStatus();

    expect(ageCalls).toBeGreaterThan(0);
    expect(["pruning", "cooling_down", "scheduled"]).toContain(operatorStatus.status);
    expect(operatorStatus.startThresholdMb).toBe(1100);
    expect(operatorStatus.stopThresholdMb).toBe(950);
    expect(operatorStatus.pauseReason).toBeUndefined();
  });
});
