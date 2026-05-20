import { describe, expect, it } from "vitest";
import { resolveTrendTheme } from "./trendTheme";
import { appendLiveCarryForwardPoint, applyTrendVisualHolds, buildAxes, buildTrendDataMatrixWithGaps, createTrendAxisConfig, defaultTrendSettings, insertTrendGapBreaks, normalizeTrendAxes, normalizeTrendTableSettings } from "./trendUtils";
import type { TrendTagInfo, TrendTagSelection } from "./trendTypes";

describe("trend defaults", () => {
  it("uses raw aggregation by default", () => {
    expect(defaultTrendSettings().aggregation).toBe("raw");
  });
});

describe("resolveTrendTheme", () => {
  it("resolves all supported themes", () => {
    const workbench = resolveTrendTheme("workbench-dark");
    const echarts = resolveTrendTheme("echarts-dark");
    const custom = resolveTrendTheme("custom");

    expect(workbench.background).toBeTruthy();
    expect(echarts.background).toBeTruthy();
    expect(custom.background).toBeTruthy();
    expect(workbench.toolbarBg).toBeTruthy();
    expect(echarts.toolbarBg).toBeTruthy();
    expect(custom.toolbarBg).toBeTruthy();
    expect(workbench.background).not.toBe(echarts.background);
  });
});

describe("buildAxes", () => {
  it("maps auto tags to default axis and keeps manual assignment", () => {
    const settings = defaultTrendSettings();

    const tags: TrendTagSelection[] = [
      { tag: "t1", unit: "bar" },
      { tag: "t2", unit: "bar", axisMode: "manual", axisId: "axis:manual:1" },
      { tag: "t3", unit: "C" },
    ];
    const tagInfoMap = new Map<string, TrendTagInfo>([
      ["t1", { id: "1", name: "t1", unit: "bar" }],
      ["t2", { id: "2", name: "t2", unit: "bar" }],
      ["t3", { id: "3", name: "t3", unit: "C" }],
    ]);

    const result = buildAxes(tags, tagInfoMap, settings, [
      { id: "axis:default", name: "Default", position: "left" },
      { id: "axis:manual:1", name: "Pressure", position: "right" },
    ]);

    expect(result.axes).toHaveLength(2);
    expect(result.resolvedAxisIdByTag.get("t1")).toBe("axis:default");
    expect(result.resolvedAxisIdByTag.get("t2")).toBe("axis:manual:1");
    expect(result.resolvedAxisIdByTag.get("t3")).toBe("axis:default");
  });
});

describe("axis title mode defaults", () => {
  it("assigns verticalLabel for newly created axes", () => {
    const settings = defaultTrendSettings();
    const axis = createTrendAxisConfig(settings, "axis:test", 0);
    expect(axis.axisTitleMode).toBe("verticalLabel");
    expect(axis.verticalLabelOffsetX).toBe(0);
  });

  it("normalizes missing axisTitleMode to verticalLabel", () => {
    const settings = defaultTrendSettings();
    const axes = normalizeTrendAxes([{ id: "axis:default", name: "Default", position: "left" }], settings);
    expect(axes[0]?.axisTitleMode).toBe("verticalLabel");
  });

  it("normalizes removed modes to verticalLabel", () => {
    const settings = defaultTrendSettings();
    const axes = normalizeTrendAxes([
      { id: "axis:default", name: "Default", position: "left", axisTitleMode: "topBadge" as never },
      { id: "axis:manual:1", name: "Secondary", position: "right", axisTitleMode: "tooltipOnly" as never },
    ], settings);
    expect(axes[0]?.axisTitleMode).toBe("verticalLabel");
    expect(axes[1]?.axisTitleMode).toBe("verticalLabel");
  });

  it("keeps hidden mode when explicitly set", () => {
    const settings = defaultTrendSettings();
    const axes = normalizeTrendAxes([
      { id: "axis:default", name: "Default", position: "left", axisTitleMode: "hidden" },
    ], settings);
    expect(axes[0]?.axisTitleMode).toBe("hidden");
  });
});

describe("normalizeTrendTableSettings", () => {
  it("clamps numeric settings and normalizes colors", () => {
    const normalized = normalizeTrendTableSettings({
      background: "#ABC",
      textColor: "#112233",
      rowHeight: 999,
      headerHeight: 1,
      fontSize: 9,
      cellPaddingX: 33,
      cellPaddingY: 0,
    });

    expect(normalized).toMatchObject({
      background: "#aabbcc",
      textColor: "#112233",
      rowHeight: 48,
      headerHeight: 20,
      fontSize: 10,
      cellPaddingX: 16,
      cellPaddingY: 1,
    });
  });

  it("drops invalid color values", () => {
    const normalized = normalizeTrendTableSettings({
      background: "bad-value",
      borderColor: "#xyzxyz",
      mutedTextColor: "",
    });

    expect(normalized).toBeUndefined();
  });
});

describe("insertTrendGapBreaks", () => {
  it("inserts null break points for large gaps", () => {
    const result = insertTrendGapBreaks([
      { t: 1_000, v: 10, q: "good" },
      { t: 11_500, v: 11, q: "good" },
    ], 5_000);

    expect(result.points.map((item) => [item.t, item.v])).toEqual([
      [1_000, 10],
      [1_001, null],
      [11_499, null],
      [11_500, 11],
    ]);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({
      previousTs: 1_000,
      currentTs: 11_500,
      deltaMs: 10_500,
      gapBreakMs: 5_000,
    });
  });

  it("does not insert duplicate breaks around existing null markers", () => {
    const result = insertTrendGapBreaks([
      { t: 1_000, v: 10, q: "good" },
      { t: 1_001, v: null, q: "uncertain" },
      { t: 11_499, v: null, q: "uncertain" },
      { t: 11_500, v: 11, q: "good" },
    ], 5_000);

    expect(result.points.map((item) => [item.t, item.v])).toEqual([
      [1_000, 10],
      [1_001, null],
      [11_499, null],
      [11_500, 11],
    ]);
    expect(result.gaps).toHaveLength(0);
  });
});

describe("appendLiveCarryForwardPoint", () => {
  it("adds one virtual point at liveNow using the last known numeric value", () => {
    const result = appendLiveCarryForwardPoint([
      { t: 1_000, v: 4, q: "good" },
      { t: 2_000, v: 6, q: "good" },
    ], 3_000);

    expect(result.map((item) => [item.t, item.v])).toEqual([
      [1_000, 4],
      [2_000, 6],
      [3_000, 6],
    ]);
  });

  it("does not add a point when series has no known numeric value", () => {
    const source = [
      { t: 1_000, v: null, q: "uncertain" as const },
      { t: 2_000, v: null, q: "bad" as const },
    ];
    const result = appendLiveCarryForwardPoint(source, 3_000);

    expect(result).toBe(source);
  });

  it("does not add duplicates when liveNow is not newer than the last timestamp", () => {
    const source = [
      { t: 1_000, v: 10, q: "good" as const },
      { t: 2_000, v: 11, q: "good" as const },
    ];

    expect(appendLiveCarryForwardPoint(source, 2_000)).toBe(source);
    expect(appendLiveCarryForwardPoint(source, 1_900)).toBe(source);
  });
});

describe("buildTrendDataMatrixWithGaps", () => {
  it("builds sorted unique x-values and keeps alignment holes as undefined", () => {
    const matrix = buildTrendDataMatrixWithGaps([
      {
        tag: "tag.a",
        points: [
          { t: 3_000, v: 30, q: "good" },
          { t: 1_000, v: 10, q: "good" },
          { t: 1_000, v: 11, q: "good" },
        ],
      },
      {
        tag: "tag.b",
        points: [
          { t: 2_000, v: 20, q: "good" },
        ],
      },
    ], { showBadQualityGaps: true });

    expect(matrix.xValues).toEqual([1_000, 2_000, 3_000]);
    expect(matrix.valuesByTag.get("tag.a")).toEqual([11, undefined, 30]);
    expect(matrix.valuesByTag.get("tag.b")).toEqual([undefined, 20, undefined]);
    expect(matrix.diagnostics.duplicateTimestampCountBeforeDedupe).toBe(1);
    expect(matrix.diagnostics.unsortedPairCount).toBe(1);
    expect(matrix.diagnostics.xUnit).toBe("ms");
  });

  it("treats interleaved timestamps as alignment holes, not real gaps", () => {
    const matrix = buildTrendDataMatrixWithGaps([
      {
        tag: "tag.a",
        points: [
          { t: 0, v: 10, q: "good" },
          { t: 2, v: 20, q: "good" },
          { t: 4, v: 30, q: "good" },
        ],
      },
      {
        tag: "tag.b",
        points: [
          { t: 1, v: 100, q: "good" },
          { t: 3, v: 200, q: "good" },
        ],
      },
    ], { showBadQualityGaps: true });

    expect(matrix.xValues).toEqual([0, 1, 2, 3, 4]);
    expect(matrix.valuesByTag.get("tag.a")).toEqual([10, undefined, 20, undefined, 30]);
    expect(matrix.valuesByTag.get("tag.b")).toEqual([undefined, 100, undefined, 200, undefined]);
    expect(matrix.diagnostics.series.find((item) => item.tag === "tag.a")?.alignmentNullCount).toBe(2);
    expect(matrix.diagnostics.series.find((item) => item.tag === "tag.a")?.realGapCount).toBe(0);
    expect(matrix.diagnostics.series.find((item) => item.tag === "tag.b")?.realGapCount).toBe(0);
  });

  it("keeps a real downtime gap as explicit null marker", () => {
    const matrix = buildTrendDataMatrixWithGaps([
      {
        tag: "tag.a",
        points: [
          { t: 0, v: 10, q: "good" },
          { t: 2, v: 20, q: "good" },
          { t: 600, v: 30, q: "good" },
        ],
      },
    ], {
      showBadQualityGaps: true,
      gapBreakMsByTag: new Map([["tag.a", 100]]),
    });

    expect(matrix.xValues).toEqual([0, 2, 301, 600]);
    expect(matrix.valuesByTag.get("tag.a")).toEqual([10, 20, null, 30]);
    expect(matrix.realGapsByTag.get("tag.a")).toEqual([
      { previousTs: 2, currentTs: 600, deltaMs: 598, gapBreakMs: 100 },
    ]);
    expect(matrix.diagnostics.series.find((item) => item.tag === "tag.a")?.realGapCount).toBe(1);
  });

  it("keeps matrix unit consistency in milliseconds", () => {
    const matrix = buildTrendDataMatrixWithGaps([
      {
        tag: "tag.a",
        points: [
          { t: 1_000, v: 1, q: "good" },
          { t: 2_000, v: 2, q: "good" },
        ],
      },
    ], {
      showBadQualityGaps: true,
      gapBreakMsByTag: new Map([["tag.a", 5_000]]),
    });

    expect(matrix.diagnostics.xUnit).toBe("ms");
    expect(matrix.diagnostics.series[0]?.gapBreakMs).toBe(5_000);
  });
});

describe("applyTrendVisualHolds", () => {
  it("extends a constant series to live right edge when tag is alive", () => {
    const matrix = buildTrendDataMatrixWithGaps([
      {
        tag: "tag.const",
        points: [
          { t: 1_000, v: 7, q: "good" },
          { t: 2_000, v: 7, q: "good" },
        ],
      },
    ], { showBadQualityGaps: true });

    const result = applyTrendVisualHolds(matrix, [
      { tag: "tag.const", value: 7, holdTs: 3_000, stale: false },
    ]);

    expect(result.xValues).toEqual([1_000, 2_000, 3_000]);
    expect(result.valuesByTag.get("tag.const")).toEqual([7, 7, 7]);
    expect(result.diagnostics.heldTagCount).toBe(1);
  });

  it("fills trailing alignment holes while extending a held series", () => {
    const matrix = buildTrendDataMatrixWithGaps([
      {
        tag: "tag.const",
        points: [
          { t: 1_000, v: 7, q: "good" },
        ],
      },
      {
        tag: "tag.ramp",
        points: [
          { t: 1_500, v: 1, q: "good" },
          { t: 2_000, v: 2, q: "good" },
        ],
      },
    ], { showBadQualityGaps: true });

    const result = applyTrendVisualHolds(matrix, [
      { tag: "tag.const", value: 7, holdTs: 2_500, stale: false },
    ]);

    expect(result.xValues).toEqual([1_000, 1_500, 2_000, 2_500]);
    expect(result.valuesByTag.get("tag.const")).toEqual([7, 7, 7, 7]);
    expect(result.diagnostics.heldTagCount).toBe(3);
  });

  it("does not extend stale tags", () => {
    const matrix = buildTrendDataMatrixWithGaps([
      {
        tag: "tag.stale",
        points: [
          { t: 1_000, v: 10, q: "good" },
          { t: 2_000, v: 10, q: "good" },
        ],
      },
    ], { showBadQualityGaps: true });

    const result = applyTrendVisualHolds(matrix, [
      { tag: "tag.stale", value: 10, holdTs: 3_000, stale: true },
    ]);

    expect(result.xValues).toEqual([1_000, 2_000]);
    expect(result.valuesByTag.get("tag.stale")).toEqual([10, 10]);
    expect(result.diagnostics.heldTagCount).toBe(0);
    expect(result.diagnostics.staleTagCount).toBe(1);
  });
});
