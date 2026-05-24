import { describe, expect, it } from "vitest";
import {
  ArchiveService,
  resolveArchiveMaintenanceThresholds,
  shouldRunArchiveMaintenanceAfterSettingsUpdate,
} from "./archive-service";

const baseSettings = {
  autoCleanupEnabled: true,
  maxDbSizeMb: 5120,
  deleteBatchSize: 1000,
  maintenanceIntervalMs: 2000,
  maxMaintenanceTickMs: 1500,
  maxDeleteTransactionMs: 500,
  updatedAt: "2026-05-22T00:00:00.000Z",
};

describe("archive runtime settings maintenance trigger", () => {
  it("runs maintenance when max database size is lowered", () => {
    expect(shouldRunArchiveMaintenanceAfterSettingsUpdate(baseSettings, {
      ...baseSettings,
      maxDbSizeMb: 3000,
    })).toBe(true);
  });

  it("runs maintenance when saving an active size limit again", () => {
    expect(shouldRunArchiveMaintenanceAfterSettingsUpdate(baseSettings, {
      ...baseSettings,
    })).toBe(true);
  });

  it("runs maintenance when cleanup is enabled", () => {
    expect(shouldRunArchiveMaintenanceAfterSettingsUpdate({
      ...baseSettings,
      autoCleanupEnabled: false,
    }, baseSettings)).toBe(true);
  });

  it("ignores legacy max data age and still runs for active size limit", () => {
    const settingsWithLegacyAge = {
      ...baseSettings,
      maxDataAgeMonths: 6,
    };
    expect(shouldRunArchiveMaintenanceAfterSettingsUpdate(baseSettings, settingsWithLegacyAge)).toBe(true);
  });

  it("does not run maintenance when there is no active size limit", () => {
    expect(shouldRunArchiveMaintenanceAfterSettingsUpdate(baseSettings, {
      ...baseSettings,
      maxDbSizeMb: null,
    })).toBe(false);
  });

  it("does not run maintenance when cleanup is disabled", () => {
    expect(shouldRunArchiveMaintenanceAfterSettingsUpdate(baseSettings, {
      ...baseSettings,
      autoCleanupEnabled: false,
      maxDbSizeMb: 3000,
    })).toBe(false);
  });
});

describe("resolveArchiveMaintenanceThresholds", () => {
  it("does not start pruning when size is below hysteresis start threshold", () => {
    const thresholds = resolveArchiveMaintenanceThresholds(2000);
    expect(thresholds.startThresholdMb).toBe(2200);
    expect(2150).toBeLessThan(thresholds.startThresholdMb ?? 0);
  });

  it("stops pruning below stop threshold", () => {
    const thresholds = resolveArchiveMaintenanceThresholds(2000);
    expect(thresholds.stopThresholdMb).toBe(1900);
    expect(1890).toBeLessThan(thresholds.stopThresholdMb ?? 0);
  });
});

describe("ArchiveService soft maintenance behavior", () => {
  it("respects delete batch size and reports detailed status", async () => {
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

    const deleteLimits: number[] = [];
    let statsCall = 0;
    (service as unknown as {
      initialized: boolean;
      repository: {
        getRuntimeSettings: () => Promise<typeof baseSettings>;
        getStorageStats: () => Promise<{ dbSizeMb: number; recordsCount: number }>;
        getActiveTrendQueries: () => number;
        applyRetentionBatch: (limit: number) => Promise<number>;
        deleteOldestSamplesBatch: (options: { limit: number; maxTransactionMs: number }) => Promise<{ deletedRecords: number; durationMs: number }>;
        getEventArchiveSettings: () => Promise<{ enabled: boolean; cleanupIntervalMinutes: number }>;
        cleanupEventArchive: () => Promise<void>;
      };
    }).initialized = true;

    (service as unknown as {
      repository: {
        getRuntimeSettings: () => Promise<typeof baseSettings>;
        getStorageStats: () => Promise<{ dbSizeMb: number; recordsCount: number }>;
        getActiveTrendQueries: () => number;
        applyRetentionBatch: (limit: number) => Promise<number>;
        deleteOldestSamplesBatch: (options: { limit: number; maxTransactionMs: number }) => Promise<{ deletedRecords: number; durationMs: number }>;
        getEventArchiveSettings: () => Promise<{ enabled: boolean; cleanupIntervalMinutes: number }>;
        cleanupEventArchive: () => Promise<void>;
      };
    }).repository = {
      getRuntimeSettings: async () => ({
        ...baseSettings,
        maxDbSizeMb: 1000,
        deleteBatchSize: 321,
        maintenanceIntervalMs: 200,
        maxMaintenanceTickMs: 100,
        maxDeleteTransactionMs: 50,
      }),
      getStorageStats: async () => {
        statsCall += 1;
        if (statsCall === 1) {
          return { dbSizeMb: 1300, recordsCount: 5000 };
        }
        return { dbSizeMb: 900, recordsCount: 4800 };
      },
      getActiveTrendQueries: () => 0,
      applyRetentionBatch: async () => 0,
      deleteOldestSamplesBatch: async (options) => {
        deleteLimits.push(options.limit);
        return { deletedRecords: 321, durationMs: 12 };
      },
      getEventArchiveSettings: async () => ({ enabled: false, cleanupIntervalMinutes: 60 }),
      cleanupEventArchive: async () => undefined,
    };

    const result = await service.runMaintenance();
    const status = await service.getStatus();

    expect(result.deletedSamples).toBe(321);
    expect(deleteLimits).toEqual([321]);
    expect(status.status).toBe("scheduled");
    expect(status.recordsDeletedInLastBatch).toBe(321);
    expect(status.totalRecordsDeletedThisRun).toBe(321);
    expect(status.startThresholdMb).toBe(1100);
    expect(status.stopThresholdMb).toBe(950);
  });

  it("pauses maintenance when trend load is active", async () => {
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

    (service as unknown as {
      initialized: boolean;
      repository: {
        getRuntimeSettings: () => Promise<typeof baseSettings>;
        getStorageStats: () => Promise<{ dbSizeMb: number; recordsCount: number }>;
        getActiveTrendQueries: () => number;
        applyRetentionBatch: (limit: number) => Promise<number>;
        deleteOldestSamplesBatch: (options: { limit: number; maxTransactionMs: number }) => Promise<{ deletedRecords: number; durationMs: number }>;
        getEventArchiveSettings: () => Promise<{ enabled: boolean; cleanupIntervalMinutes: number }>;
        cleanupEventArchive: () => Promise<void>;
      };
    }).initialized = true;

    (service as unknown as {
      repository: {
        getRuntimeSettings: () => Promise<typeof baseSettings>;
        getStorageStats: () => Promise<{ dbSizeMb: number; recordsCount: number }>;
        getActiveTrendQueries: () => number;
        applyRetentionBatch: (limit: number) => Promise<number>;
        deleteOldestSamplesBatch: (options: { limit: number; maxTransactionMs: number }) => Promise<{ deletedRecords: number; durationMs: number }>;
        getEventArchiveSettings: () => Promise<{ enabled: boolean; cleanupIntervalMinutes: number }>;
        cleanupEventArchive: () => Promise<void>;
      };
    }).repository = {
      getRuntimeSettings: async () => ({
        ...baseSettings,
        maxDbSizeMb: 1000,
      }),
      getStorageStats: async () => ({ dbSizeMb: 1300, recordsCount: 5000 }),
      getActiveTrendQueries: () => 2,
      applyRetentionBatch: async () => 0,
      deleteOldestSamplesBatch: async () => ({ deletedRecords: 1000, durationMs: 12 }),
      getEventArchiveSettings: async () => ({ enabled: false, cleanupIntervalMinutes: 60 }),
      cleanupEventArchive: async () => undefined,
    };

    await service.runMaintenance();
    const status = await service.getStatus();

    expect(status.status).toBe("paused");
    expect(status.pauseReason).toContain("trend_queries_active");
    expect(status.recordsDeletedInLastBatch).toBe(0);
  });
});
