import { describe, expect, it } from "vitest";
import { shouldRunArchiveMaintenanceAfterSettingsUpdate } from "./archive-service";

const baseSettings = {
  autoCleanupEnabled: true,
  maxDbSizeMb: 5120,
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
