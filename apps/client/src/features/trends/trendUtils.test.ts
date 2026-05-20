import { describe, expect, it } from "vitest";
import { resolveTrendTheme } from "./trendTheme";
import { buildAxes, createTrendAxisConfig, defaultTrendSettings, insertTrendGapBreaks, normalizeTrendAxes, normalizeTrendTableSettings } from "./trendUtils";
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
