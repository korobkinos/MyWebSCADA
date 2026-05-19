import type { TrendAxisConfig, TrendSettings, TrendTagSelection, TrendTagInfo, TrendVisibleRange } from "./trendTypes";
import { TREND_COLORS, TREND_WORKBENCH_THEME } from "./trendTheme";

export const TREND_SETTINGS_STORAGE_KEY = "mywebscada.trends.settings";
export const TREND_SELECTED_TAGS_STORAGE_KEY = "mywebscada.trends.selectedTags";
export const TREND_DEFAULT_AXIS_ID = "axis:default";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeOptionalHexColor(value: string | undefined): string | undefined {
  const token = (value ?? "").trim();
  if (!token) {
    return undefined;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(token)) {
    return token.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(token)) {
    return `#${token.slice(1).split("").map((ch) => ch + ch).join("").toLowerCase()}`;
  }
  return undefined;
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
    seriesTableRows: 6,
    showToolbarMenuButton: true,
    showToolbarTagsButton: true,
    showToolbarLiveButton: true,
    showToolbarTimeRangeButton: true,
    showToolbarQuickRangeButtons: true,
    showToolbarPanButtons: true,
    showToolbarZoomButtons: true,
    showToolbarRefreshButton: true,
    showToolbarScaleButton: true,
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
      seriesTableRows: clamp(Number(parsed.seriesTableRows ?? fallback.seriesTableRows), 2, 24),
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
  _tagInfoMap: Map<string, TrendTagInfo>,
  settings: TrendSettings,
  existingAxes: TrendAxisConfig[] = [],
): { axes: TrendAxisConfig[]; resolvedAxisIdByTag: Map<string, string> } {
  void _tagInfoMap;
  const resolvedAxisIdByTag = new Map<string, string>();
  const normalizedAxes = normalizeTrendAxes(existingAxes, settings);
  const axisById = new Map(normalizedAxes.map((axis) => [axis.id, axis]));

  for (const tag of tags) {
    const requestedAxisId = tag.axisMode === "manual" && tag.axisId ? tag.axisId : TREND_DEFAULT_AXIS_ID;
    resolvedAxisIdByTag.set(tag.tag, axisById.has(requestedAxisId) ? requestedAxisId : TREND_DEFAULT_AXIS_ID);
  }

  const usedAxisIds = new Set(resolvedAxisIdByTag.values());
  const axes = normalizedAxes.filter((axis) => usedAxisIds.has(axis.id));
  return { axes, resolvedAxisIdByTag };
}

export function createTrendAxisConfig(settings: TrendSettings, id: string, index = 0): TrendAxisConfig {
  const placement = settings.axisPlacement === "split"
    ? (index % 2 === 0 ? "left" : "right")
    : settings.axisPlacement === "right"
      ? "right"
      : "left";
  return {
    id,
    name: id === TREND_DEFAULT_AXIS_ID ? "Default" : id,
    position: placement,
    offset: Math.floor(index / 2) * settings.axisOffsetStep,
    min: settings.defaultAxisMin ?? "auto",
    max: settings.defaultAxisMax ?? "auto",
    axisLabelFontSize: 12,
    axisLabelMargin: 6,
    axisNameFontSize: 12,
    axisNameGap: 30,
    axisNamePaddingX: 6,
    axisNamePaddingY: 3,
  };
}

export function normalizeTrendAxes(existingAxes: TrendAxisConfig[], settings: TrendSettings): TrendAxisConfig[] {
  const nextAxesById = new Map<string, TrendAxisConfig>();
  for (const axis of existingAxes) {
    if (!axis || typeof axis.id !== "string" || axis.id.trim().length === 0) {
      continue;
    }
    if (axis.position !== "left" && axis.position !== "right") {
      continue;
    }
    nextAxesById.set(axis.id, { ...axis });
  }
  if (!nextAxesById.has(TREND_DEFAULT_AXIS_ID)) {
    nextAxesById.set(TREND_DEFAULT_AXIS_ID, createTrendAxisConfig(settings, TREND_DEFAULT_AXIS_ID, 0));
  }

  const axes = [...nextAxesById.values()];
  const positionIndex: Record<"left" | "right", number> = { left: 0, right: 0 };
  const minAxisSeparation = clamp(Math.round(settings.axisOffsetStep * 0.6), 10, 140);
  for (const axis of axes) {
    const idx = positionIndex[axis.position];
    axis.offset = clamp(Number(axis.offset ?? idx * settings.axisOffsetStep), 0, 2400);
    axis.name = (axis.name ?? axis.id).trim() || axis.id;
    axis.min = typeof axis.min === "number" ? roundToOneDecimal(axis.min) : (axis.min ?? "auto");
    axis.max = typeof axis.max === "number" ? roundToOneDecimal(axis.max) : (axis.max ?? "auto");
    axis.axisLabelFontSize = clamp(Number(axis.axisLabelFontSize ?? 12), 9, 24);
    axis.axisLabelMargin = clamp(Number(axis.axisLabelMargin ?? 6), 0, 24);
    axis.axisNameFontSize = clamp(Number(axis.axisNameFontSize ?? 12), 9, 24);
    axis.axisNameGap = clamp(Number(axis.axisNameGap ?? 30), 12, 80);
    axis.axisNamePaddingX = clamp(Number(axis.axisNamePaddingX ?? 6), 0, 24);
    axis.axisNamePaddingY = clamp(Number(axis.axisNamePaddingY ?? 3), 0, 16);
    axis.axisTextColor = normalizeOptionalHexColor(axis.axisTextColor ?? axis.color);
    axis.axisGridLineColor = normalizeOptionalHexColor(axis.axisGridLineColor);
    axis.axisPointerLabelBackgroundColor = normalizeOptionalHexColor(axis.axisPointerLabelBackgroundColor);
    axis.color = axis.axisTextColor;
    positionIndex[axis.position] += 1;
  }

  for (const side of ["left", "right"] as const) {
    const sideAxes = axes
      .filter((axis) => axis.position === side)
      .sort((a, b) => (Number(a.offset ?? 0) - Number(b.offset ?? 0)) || a.id.localeCompare(b.id));
    let previousOffset = Number.NEGATIVE_INFINITY;
    for (const axis of sideAxes) {
      const requestedOffset = clamp(Number(axis.offset ?? 0), 0, 2400);
      if (!Number.isFinite(previousOffset)) {
        axis.offset = requestedOffset;
      } else {
        axis.offset = Math.max(requestedOffset, previousOffset + minAxisSeparation);
      }
      previousOffset = Number(axis.offset ?? requestedOffset);
    }
  }

  axes.sort((a, b) => (a.id === TREND_DEFAULT_AXIS_ID ? -1 : b.id === TREND_DEFAULT_AXIS_ID ? 1 : a.id.localeCompare(b.id)));
  return axes;
}

export function formatRangeLabel(from: number, to: number): string {
  return `${new Date(from).toLocaleString()} - ${new Date(to).toLocaleString()}`;
}

