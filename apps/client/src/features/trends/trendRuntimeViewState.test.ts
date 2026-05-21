import { describe, expect, it } from "vitest";
import { resolveRuntimeViewState } from "./trendRuntimeViewState";
import type { TrendSeriesColumnWidths, TrendTagPickerFilters } from "./trendTypes";

const defaultFilters: TrendTagPickerFilters = {
  search: "",
  groupFilter: "all",
  driverFilter: "all",
  selectionFilter: "all",
};

const defaultWidths: TrendSeriesColumnWidths = {
  visible: 72,
  tag: 340,
  displayName: 240,
  description: 280,
  color: 270,
  value: 120,
};

describe("trend runtime state persistence", () => {
  it("returns null for corrupted localStorage payload", () => {
    const result = resolveRuntimeViewState({
      raw: "{not-json",
      defaultTagPickerFilters: defaultFilters,
      defaultSeriesColumnWidths: defaultWidths,
    });
    expect(result).toBeNull();
  });

  it("migrates legacy payload and fills defaults", () => {
    const legacyRaw = JSON.stringify({
      rangePreset: "1h",
      visibleRange: { from: 1000, to: 2000 },
      liveMode: false,
      customFrom: "2026-01-01T12:00",
      customTo: "2026-01-01T13:00",
      settings: { aggregation: "raw" },
      selectedTags: [{ tag: "tag.a" }],
      manualAxes: [{ id: "axis:default", position: "left", axisTitleMode: "topBadge" }],
    });

    const result = resolveRuntimeViewState({
      raw: legacyRaw,
      defaultTagPickerFilters: defaultFilters,
      defaultSeriesColumnWidths: defaultWidths,
    });

    expect(result).not.toBeNull();
    expect(result?.rangePreset).toBe("1h");
    expect(result?.settings.aggregation).toBe("raw");
    expect(result?.tagPickerFilters.selectionFilter).toBe("all");
    expect(result?.seriesColumnWidths.tag).toBe(defaultWidths.tag);
    expect(result?.manualAxes[0]?.axisTitleMode).toBe("hidden");
    expect(result?.settings.maxVisiblePointsPerSeries).toBe(result?.settings.maxPointsPerSeries);
    expect(result?.settings.maxLivePointsPerTag).toBe(result?.settings.liveBufferLimit);
    expect(result?.settings.maxCachedRanges).toBe(result?.settings.cacheSize);
    expect(result?.settings.realtimeAppendSnapshotAggregation).toBe("auto");
    expect(result?.settings.realtimeAppendSnapshotMaxPoints).toBe(8000);
    expect(result?.settings.realtimeAppendFlushMs).toBe(300);
  });

  it("maps legacy limits into new bounded settings fields", () => {
    const raw = JSON.stringify({
      rangePreset: "1h",
      visibleRange: { from: 1000, to: 2000 },
      liveMode: false,
      customFrom: "2026-01-01T12:00",
      customTo: "2026-01-01T13:00",
      selectedTags: [],
      settings: {
        maxPointsPerSeries: 6000,
        liveBufferLimit: 12000,
        cacheSize: 80,
      },
    });

    const result = resolveRuntimeViewState({
      raw,
      defaultTagPickerFilters: defaultFilters,
      defaultSeriesColumnWidths: defaultWidths,
    });

    expect(result).not.toBeNull();
    expect(result?.settings.maxVisiblePointsPerSeries).toBe(6000);
    expect(result?.settings.maxLivePointsPerTag).toBe(12000);
    expect(result?.settings.maxCachedRanges).toBe(80);
  });

  it("clamps realtime append tuning fields", () => {
    const raw = JSON.stringify({
      rangePreset: "1h",
      visibleRange: { from: 1000, to: 2000 },
      liveMode: false,
      customFrom: "2026-01-01T12:00",
      customTo: "2026-01-01T13:00",
      selectedTags: [],
      settings: {
        liveDataSource: "realtimeAppend",
        realtimeAppendSnapshotAggregation: "bad-value",
        realtimeAppendSnapshotMaxPoints: 999999,
        realtimeAppendFlushMs: 1,
      },
    });

    const result = resolveRuntimeViewState({
      raw,
      defaultTagPickerFilters: defaultFilters,
      defaultSeriesColumnWidths: defaultWidths,
    });

    expect(result).not.toBeNull();
    expect(result?.settings.realtimeAppendSnapshotAggregation).toBe("auto");
    expect(result?.settings.realtimeAppendSnapshotMaxPoints).toBe(8000);
    expect(result?.settings.realtimeAppendFlushMs).toBe(50);
  });
});
