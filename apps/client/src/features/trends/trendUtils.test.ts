import { describe, expect, it } from "vitest";
import { resolveTrendTheme } from "./trendTheme";
import { buildAxes, defaultTrendSettings } from "./trendUtils";
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
  it("keeps axis grouping behavior", () => {
    const settings = defaultTrendSettings();
    settings.groupByUnit = true;
    settings.separateAxisPerTag = false;

    const tags: TrendTagSelection[] = [
      { tag: "t1", unit: "bar" },
      { tag: "t2", unit: "bar" },
      { tag: "t3", unit: "C" },
    ];
    const tagInfoMap = new Map<string, TrendTagInfo>([
      ["t1", { id: "1", name: "t1", unit: "bar" }],
      ["t2", { id: "2", name: "t2", unit: "bar" }],
      ["t3", { id: "3", name: "t3", unit: "C" }],
    ]);

    const result = buildAxes(tags, tagInfoMap, settings, []);

    expect(result.axes).toHaveLength(2);
    expect(result.resolvedAxisIdByTag.get("t1")).toBe(result.resolvedAxisIdByTag.get("t2"));
    expect(result.resolvedAxisIdByTag.get("t3")).not.toBe(result.resolvedAxisIdByTag.get("t1"));
  });
});
