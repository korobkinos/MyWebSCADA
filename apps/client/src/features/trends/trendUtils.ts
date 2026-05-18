import type { TrendAxisConfig, TrendSettings, TrendTagSelection, TrendTagInfo, TrendVisibleRange } from "./trendTypes";
import { TREND_COLORS, TREND_WORKBENCH_THEME } from "./trendTheme";

export const TREND_SETTINGS_STORAGE_KEY = "mywebscada.trends.settings";
export const TREND_SELECTED_TAGS_STORAGE_KEY = "mywebscada.trends.selectedTags";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function defaultTrendSettings(): TrendSettings {
  return {
    theme: "workbench-dark",
    background: TREND_WORKBENCH_THEME.background,
    gridLines: true,
    axisLabels: true,
    legend: true,
    tooltip: true,
    dataZoomSlider: true,
    defaultLineWidth: 1,
    showSymbols: false,
    showUnitsInTooltip: true,
    showBadQualityGaps: true,
    maxPointsPerSeries: 4000,
    aggregation: "raw",
    zoomDebounceMs: 350,
    progressive: true,
    disableAnimationsLargeData: true,
    cacheEnabled: true,
    cacheSize: 48,
    liveBufferLimit: 5000,
    autoScale: true,
    defaultAxisMin: "auto",
    defaultAxisMax: "auto",
    groupByUnit: true,
    separateAxisPerTag: false,
    axisPlacement: "split",
    axisOffsetStep: 46,
    showSeriesTable: true,
    showToolbarMenuButton: true,
    showToolbarTagsButton: true,
    showToolbarLiveButton: true,
    showToolbarTimeRangeButton: true,
    showToolbarQuickRangeButtons: true,
    showToolbarPanButtons: true,
    showToolbarZoomButtons: true,
    showToolbarRefreshButton: true,
    showToolbarSettingsButton: true,
  };
}

export function loadTrendSettings(): TrendSettings {
  if (typeof window === "undefined") {
    return defaultTrendSettings();
  }
  const fallback = defaultTrendSettings();
  const raw = window.localStorage.getItem(TREND_SETTINGS_STORAGE_KEY);
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<TrendSettings>;
    return {
      ...fallback,
      ...parsed,
      maxPointsPerSeries: clamp(Number(parsed.maxPointsPerSeries ?? fallback.maxPointsPerSeries), 1000, 8000),
      cacheSize: clamp(Number(parsed.cacheSize ?? fallback.cacheSize), 8, 256),
      liveBufferLimit: clamp(Number(parsed.liveBufferLimit ?? fallback.liveBufferLimit), 200, 20000),
      zoomDebounceMs: clamp(Number(parsed.zoomDebounceMs ?? fallback.zoomDebounceMs), 100, 1200),
      defaultLineWidth: clamp(Number(parsed.defaultLineWidth ?? fallback.defaultLineWidth), 1, 5),
      axisOffsetStep: clamp(Number(parsed.axisOffsetStep ?? fallback.axisOffsetStep), 8, 220),
    };
  } catch {
    return fallback;
  }
}

export function saveTrendSettings(settings: TrendSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(TREND_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function loadTrendSelectedTags(): TrendTagSelection[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(TREND_SELECTED_TAGS_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as TrendTagSelection[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item) => typeof item?.tag === "string" && item.tag.trim().length > 0);
  } catch {
    return [];
  }
}

export function saveTrendSelectedTags(tags: TrendTagSelection[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(TREND_SELECTED_TAGS_STORAGE_KEY, JSON.stringify(tags));
}

export function pickSeriesColor(index: number): string {
  return TREND_COLORS[index % TREND_COLORS.length] ?? "#4FC3F7";
}

export function computeMaxPointsFromWidth(chartWidthPx: number, maxPointsSetting: number): number {
  const fromWidth = clamp(Math.round(chartWidthPx * 2), 1000, 8000);
  return clamp(Math.min(fromWidth, maxPointsSetting), 1000, 8000);
}

export function parseQuickRange(preset: "5m" | "15m" | "1h" | "8h" | "24h", now = Date.now()): TrendVisibleRange {
  const ms = preset === "5m"
    ? 5 * 60 * 1000
    : preset === "15m"
      ? 15 * 60 * 1000
      : preset === "1h"
        ? 60 * 60 * 1000
        : preset === "8h"
          ? 8 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;
  return {
    from: now - ms,
    to: now,
  };
}

export function buildAxes(
  tags: TrendTagSelection[],
  tagInfoMap: Map<string, TrendTagInfo>,
  settings: TrendSettings,
  existingAxes: TrendAxisConfig[] = [],
): { axes: TrendAxisConfig[]; resolvedAxisIdByTag: Map<string, string> } {
  const resolvedAxisIdByTag = new Map<string, string>();
  const nextAxesById = new Map(existingAxes.map((axis) => [axis.id, { ...axis }]));

  const createAxis = (id: string, unit: string | undefined, index: number): TrendAxisConfig => {
    const placement = settings.axisPlacement === "split"
      ? (index % 2 === 0 ? "left" : "right")
      : settings.axisPlacement === "right"
        ? "right"
        : "left";
    return {
      id,
      unit,
      name: unit || id,
      position: placement,
      offset: Math.floor(index / 2) * settings.axisOffsetStep,
      min: settings.defaultAxisMin ?? "auto",
      max: settings.defaultAxisMax ?? "auto",
    };
  };

  const unitAxisByUnit = new Map<string, string>();
  let generatedIndex = 0;

  for (const tag of tags) {
    const info = tagInfoMap.get(tag.tag);
    const unit = tag.unit ?? info?.unit;
    if (tag.axisMode === "manual" && tag.axisId) {
      if (!nextAxesById.has(tag.axisId)) {
        nextAxesById.set(tag.axisId, createAxis(tag.axisId, unit, generatedIndex));
        generatedIndex += 1;
      }
      resolvedAxisIdByTag.set(tag.tag, tag.axisId);
      continue;
    }

    const groupKey = settings.groupByUnit ? (unit || "__no_unit") : `${tag.tag}__${unit || ""}`;
    let axisId = unitAxisByUnit.get(groupKey);
    if (!axisId || settings.separateAxisPerTag) {
      axisId = settings.separateAxisPerTag
        ? `axis:${tag.tag}`
        : unit
          ? `axis:unit:${unit}`
          : "axis:default";
      unitAxisByUnit.set(groupKey, axisId);
      if (!nextAxesById.has(axisId)) {
        nextAxesById.set(axisId, createAxis(axisId, unit, generatedIndex));
        generatedIndex += 1;
      }
    }
    resolvedAxisIdByTag.set(tag.tag, axisId);
  }

  const usedAxisIds = new Set(resolvedAxisIdByTag.values());
  const axes = [...nextAxesById.values()].filter((axis) => usedAxisIds.has(axis.id));
  const positionIndex: Record<"left" | "right", number> = { left: 0, right: 0 };
  for (const axis of axes) {
    const idx = positionIndex[axis.position];
    axis.offset = idx * settings.axisOffsetStep;
    positionIndex[axis.position] += 1;
  }

  return { axes, resolvedAxisIdByTag };
}

export function formatRangeLabel(from: number, to: number): string {
  return `${new Date(from).toLocaleString()} - ${new Date(to).toLocaleString()}`;
}

