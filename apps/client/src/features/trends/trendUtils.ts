import type { TrendAxisConfig, TrendPoint, TrendSettings, TrendTableSettings, TrendTagSelection, TrendTagInfo, TrendVisibleRange } from "./trendTypes";
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

export function normalizeTrendTableSettings(value: TrendTableSettings | undefined): TrendTableSettings | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const normalized: TrendTableSettings = {};
  const background = normalizeOptionalHexColor(value.background);
  const headerBackground = normalizeOptionalHexColor(value.headerBackground);
  const textColor = normalizeOptionalHexColor(value.textColor);
  const mutedTextColor = normalizeOptionalHexColor(value.mutedTextColor);
  const borderColor = normalizeOptionalHexColor(value.borderColor);
  const hoverBackground = normalizeOptionalHexColor(value.hoverBackground);
  const valueTextColor = normalizeOptionalHexColor(value.valueTextColor);
  if (background) {
    normalized.background = background;
  }
  if (headerBackground) {
    normalized.headerBackground = headerBackground;
  }
  if (textColor) {
    normalized.textColor = textColor;
  }
  if (mutedTextColor) {
    normalized.mutedTextColor = mutedTextColor;
  }
  if (borderColor) {
    normalized.borderColor = borderColor;
  }
  if (hoverBackground) {
    normalized.hoverBackground = hoverBackground;
  }
  if (valueTextColor) {
    normalized.valueTextColor = valueTextColor;
  }

  const rowHeight = Number(value.rowHeight);
  const headerHeight = Number(value.headerHeight);
  const fontSize = Number(value.fontSize);
  const cellPaddingX = Number(value.cellPaddingX);
  const cellPaddingY = Number(value.cellPaddingY);
  if (Number.isFinite(rowHeight)) {
    normalized.rowHeight = clamp(Math.round(rowHeight), 20, 48);
  }
  if (Number.isFinite(headerHeight)) {
    normalized.headerHeight = clamp(Math.round(headerHeight), 20, 48);
  }
  if (Number.isFinite(fontSize)) {
    normalized.fontSize = clamp(Math.round(fontSize), 10, 16);
  }
  if (Number.isFinite(cellPaddingX)) {
    normalized.cellPaddingX = clamp(Math.round(cellPaddingX), 2, 16);
  }
  if (Number.isFinite(cellPaddingY)) {
    normalized.cellPaddingY = clamp(Math.round(cellPaddingY), 1, 10);
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function defaultTrendSettings(): TrendSettings {
  return {
    renderer: "echarts",
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
    maxVisiblePointsPerSeries: 4000,
    maxLivePointsPerTag: 5000,
    maxCachedRanges: 48,
    // Legacy aliases.
    maxPointsPerSeries: 4000,
    aggregation: "raw",
    zoomDebounceMs: 350,
    refreshIntervalMs: 1000,
    progressive: true,
    disableAnimationsLargeData: true,
    cacheEnabled: true,
    // Legacy alias.
    cacheSize: 48,
    // Legacy alias.
    liveBufferLimit: 5000,
    liveDataSource: "archivePolling",
    liveResyncEnabled: true,
    liveResyncIntervalSec: 15,
    realtimeAppendSnapshotAggregation: "auto",
    realtimeAppendSnapshotMaxPoints: 8000,
    realtimeAppendFlushMs: 300,
    autoScale: true,
    defaultAxisMin: "auto",
    defaultAxisMax: "auto",
    groupByUnit: true,
    separateAxisPerTag: false,
    axisPlacement: "split",
    axisOffsetStep: 46,
    axisScaleGap: 6,
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
    const maxVisiblePointsPerSeries = clamp(
      Number(parsed.maxVisiblePointsPerSeries ?? parsed.maxPointsPerSeries ?? fallback.maxVisiblePointsPerSeries),
      1000,
      8000,
    );
    const maxCachedRanges = clamp(
      Number(parsed.maxCachedRanges ?? parsed.cacheSize ?? fallback.maxCachedRanges),
      8,
      256,
    );
    const maxLivePointsPerTag = clamp(
      Number(parsed.maxLivePointsPerTag ?? parsed.liveBufferLimit ?? fallback.maxLivePointsPerTag),
      200,
      20000,
    );
    return {
      ...fallback,
      ...parsed,
      renderer: "echarts",
      maxVisiblePointsPerSeries,
      maxLivePointsPerTag,
      maxCachedRanges,
      // Legacy aliases.
      maxPointsPerSeries: maxVisiblePointsPerSeries,
      cacheSize: maxCachedRanges,
      liveBufferLimit: maxLivePointsPerTag,
      liveDataSource: parsed.liveDataSource === "realtimeAppend" ? "realtimeAppend" : "archivePolling",
      liveResyncEnabled: parsed.liveResyncEnabled ?? fallback.liveResyncEnabled,
      liveResyncIntervalSec: clamp(Number(parsed.liveResyncIntervalSec ?? fallback.liveResyncIntervalSec), 10, 30),
      realtimeAppendSnapshotAggregation:
        parsed.realtimeAppendSnapshotAggregation === "raw" || parsed.realtimeAppendSnapshotAggregation === "minmax"
          ? parsed.realtimeAppendSnapshotAggregation
          : "auto",
      realtimeAppendSnapshotMaxPoints: clamp(Number(parsed.realtimeAppendSnapshotMaxPoints ?? fallback.realtimeAppendSnapshotMaxPoints), 1000, 8000),
      realtimeAppendFlushMs: clamp(Number(parsed.realtimeAppendFlushMs ?? fallback.realtimeAppendFlushMs), 50, 1000),
      zoomDebounceMs: clamp(Number(parsed.zoomDebounceMs ?? fallback.zoomDebounceMs), 100, 1200),
      refreshIntervalMs: clamp(Number(parsed.refreshIntervalMs ?? fallback.refreshIntervalMs), 500, 60000),
      defaultLineWidth: clamp(Number(parsed.defaultLineWidth ?? fallback.defaultLineWidth), 1, 5),
      axisOffsetStep: clamp(Number(parsed.axisOffsetStep ?? fallback.axisOffsetStep), 8, 220),
      axisScaleGap: clamp(Number(parsed.axisScaleGap ?? fallback.axisScaleGap), 0, 64),
      seriesTableRows: clamp(Number(parsed.seriesTableRows ?? fallback.seriesTableRows), 2, 24),
      table: normalizeTrendTableSettings(parsed.table),
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

export function normalizeTrendRange(range: TrendVisibleRange): TrendVisibleRange {
  return {
    from: Math.min(range.from, range.to),
    to: Math.max(range.from, range.to),
  };
}

export function isRangeCovered(
  loadedRange: TrendVisibleRange | null | undefined,
  visibleRange: TrendVisibleRange,
  toleranceMs = 1000,
): boolean {
  if (!loadedRange) {
    return false;
  }
  const loaded = normalizeTrendRange(loadedRange);
  const visible = normalizeTrendRange(visibleRange);
  return visible.from >= loaded.from - toleranceMs && visible.to <= loaded.to + toleranceMs;
}

export function unionTrendRanges(
  first: TrendVisibleRange | null | undefined,
  second: TrendVisibleRange,
): TrendVisibleRange {
  const normalizedSecond = normalizeTrendRange(second);
  if (!first) {
    return normalizedSecond;
  }
  const normalizedFirst = normalizeTrendRange(first);
  return {
    from: Math.min(normalizedFirst.from, normalizedSecond.from),
    to: Math.max(normalizedFirst.to, normalizedSecond.to),
  };
}

export function resolveQuickPresetFromRangeSpan(range: TrendVisibleRange): "5m" | "15m" | "1h" | "custom" {
  const span = Math.abs(range.to - range.from);
  const toleranceMs = 1_000;
  if (Math.abs(span - 5 * 60 * 1000) <= toleranceMs) {
    return "5m";
  }
  if (Math.abs(span - 15 * 60 * 1000) <= toleranceMs) {
    return "15m";
  }
  if (Math.abs(span - 60 * 60 * 1000) <= toleranceMs) {
    return "1h";
  }
  return "custom";
}

type TrendGapBreakInfo = {
  previousTs: number;
  currentTs: number;
  deltaMs: number;
  gapBreakMs: number;
};

export function resolveTrendGapBreakMs(points: TrendPoint[]): number {
  if (points.length < 3) {
    return 5000;
  }
  const diffs: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1];
    if (!current || !previous) {
      continue;
    }
    const diff = current.t - previous.t;
    if (Number.isFinite(diff) && diff > 0) {
      diffs.push(diff);
    }
  }
  if (diffs.length === 0) {
    return 5000;
  }
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)] ?? 1000;
  return Math.max(3000, Math.min(180000, Math.round(median * 4)));
}

export function normalizeTrendPoints(points: TrendPoint[]): TrendPoint[] {
  const finitePoints = points.filter((point) => Number.isFinite(point?.t));
  if (finitePoints.length <= 1) {
    return [...finitePoints];
  }
  const sorted = [...finitePoints].sort((a, b) => a.t - b.t);
  const normalized: TrendPoint[] = [];
  for (const point of sorted) {
    const last = normalized[normalized.length - 1];
    if (last && last.t === point.t) {
      normalized[normalized.length - 1] = point;
    } else {
      normalized.push(point);
    }
  }
  return normalized;
}

export function appendLiveCarryForwardPoint(points: TrendPoint[], liveNowTs: number): TrendPoint[] {
  if (!Number.isFinite(liveNowTs) || points.length === 0) {
    return points;
  }

  const virtualTs = Math.round(liveNowTs);
  if (!Number.isFinite(virtualTs)) {
    return points;
  }

  let lastKnownValue: number | null = null;
  let lastKnownQuality: TrendPoint["q"] = "good";
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (!point) {
      continue;
    }
    if (typeof point.v === "number" && Number.isFinite(point.v)) {
      lastKnownValue = point.v;
      lastKnownQuality = point.q ?? "good";
      break;
    }
  }

  if (lastKnownValue === null) {
    return points;
  }

  const lastPointTs = points[points.length - 1]?.t ?? Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(lastPointTs) || virtualTs <= lastPointTs) {
    return points;
  }

  return [...points, { t: virtualTs, v: lastKnownValue, q: lastKnownQuality }];
}

export function insertTrendGapBreaks(
  points: TrendPoint[],
  gapBreakMs: number,
): { points: TrendPoint[]; gaps: TrendGapBreakInfo[] } {
  const normalized = normalizeTrendPoints(points);
  const gaps: TrendGapBreakInfo[] = [];
  if (normalized.length < 2) {
    return { points: normalized, gaps };
  }
  const safeGapBreakMs = Number.isFinite(gapBreakMs) && gapBreakMs > 0 ? Math.round(gapBreakMs) : 5000;
  const result: TrendPoint[] = [normalized[0]!];
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (!previous || !current) {
      continue;
    }
    const deltaMs = current.t - previous.t;
    if (
      Number.isFinite(deltaMs)
      && deltaMs > safeGapBreakMs
      && previous.v !== null
      && current.v !== null
    ) {
      const leftGapTs = previous.t + 1;
      const rightGapTs = current.t - 1;
      if (leftGapTs < current.t && leftGapTs <= rightGapTs) {
        result.push({ t: leftGapTs, v: null, q: "uncertain" });
        if (rightGapTs > leftGapTs) {
          result.push({ t: rightGapTs, v: null, q: "uncertain" });
        }
      } else {
        const middleGapTs = Math.floor((previous.t + current.t) / 2);
        if (middleGapTs > previous.t && middleGapTs < current.t) {
          result.push({ t: middleGapTs, v: null, q: "uncertain" });
        }
      }
      gaps.push({
        previousTs: previous.t,
        currentTs: current.t,
        deltaMs,
        gapBreakMs: safeGapBreakMs,
      });
    }
    result.push(current);
  }
  return { points: result, gaps };
}

type BuildTrendDataMatrixInput = {
  tag: string;
  points: TrendPoint[];
};

type BuildTrendDataMatrixOptions = {
  showBadQualityGaps: boolean;
  gapBreakMsByTag?: Map<string, number>;
};

export type TrendDataMatrix = {
  xValues: number[];
  valuesByTag: Map<string, Array<number | null | undefined>>;
  realGapsByTag: Map<string, TrendGapBreakInfo[]>;
  pointCount: number;
  gapBreakCount: number;
  diagnostics: {
    xUnit: "ms";
    sourcePointCount: number;
    duplicateTimestampCountBeforeDedupe: number;
    duplicateTimestampCountRemoved: number;
    unsortedPairCount: number;
    invalidTimestampCount: number;
    xCount: number;
    firstTs: number | null;
    lastTs: number | null;
    lengthMismatchCount: number;
    series: Array<{
      tag: string;
      nonNullCount: number;
      nullCount: number;
      alignmentNullCount: number;
      realGapCount: number;
      gapBreakMs: number;
      firstTs: number | null;
      lastTs: number | null;
    }>;
  };
};

export type TrendVisualHoldSpec = {
  tag: string;
  value: number;
  holdTs: number;
  stale?: boolean;
};

export type TrendVisualHoldResult = {
  xValues: number[];
  valuesByTag: Map<string, Array<number | null | undefined>>;
  diagnostics: {
    holdTs: number | null;
    heldTagCount: number;
    staleTagCount: number;
    xExtended: boolean;
    pointCountBefore: number;
    pointCountAfter: number;
  };
};

function pickGapMarkerTimestamp(
  leftTs: number,
  rightTs: number,
  occupied: Set<number>,
): number | null {
  if (!Number.isFinite(leftTs) || !Number.isFinite(rightTs)) {
    return null;
  }
  if (rightTs - leftTs <= 1) {
    return null;
  }
  const mid = Math.floor((leftTs + rightTs) / 2);
  if (mid > leftTs && mid < rightTs && !occupied.has(mid)) {
    return mid;
  }
  const nearLeft = leftTs + 1;
  if (nearLeft < rightTs && !occupied.has(nearLeft)) {
    return nearLeft;
  }
  const nearRight = rightTs - 1;
  if (nearRight > leftTs && !occupied.has(nearRight)) {
    return nearRight;
  }
  return null;
}

export function buildTrendDataMatrixWithGaps(
  seriesList: BuildTrendDataMatrixInput[],
  options: BuildTrendDataMatrixOptions,
): TrendDataMatrix {
  const timestampSet = new Set<number>();
  const valueMapsByTag = new Map<string, Map<number, number | null>>();
  const realGapsByTag = new Map<string, TrendGapBreakInfo[]>();
  const seriesDiagnostics: Array<{
    tag: string;
    nonNullCount: number;
    nullCount: number;
    alignmentNullCount: number;
    realGapCount: number;
    gapBreakMs: number;
    firstTs: number | null;
    lastTs: number | null;
  }> = [];
  let pointCount = 0;
  let gapBreakCount = 0;
  let sourcePointCount = 0;
  let duplicateTimestampCountBeforeDedupe = 0;
  let duplicateTimestampCountRemoved = 0;
  let unsortedPairCount = 0;
  let invalidTimestampCount = 0;

  for (const series of seriesList) {
    sourcePointCount += series.points.length;
    const seenTimestamps = new Set<number>();
    let finitePointCount = 0;
    for (let index = 0; index < series.points.length; index += 1) {
      const point = series.points[index];
      if (!point || !Number.isFinite(point.t)) {
        invalidTimestampCount += 1;
        continue;
      }
      finitePointCount += 1;
      if (seenTimestamps.has(point.t)) {
        duplicateTimestampCountBeforeDedupe += 1;
      } else {
        seenTimestamps.add(point.t);
      }
      if (index > 0) {
        const prev = series.points[index - 1];
        if (prev && Number.isFinite(prev.t) && point.t < prev.t) {
          unsortedPairCount += 1;
        }
      }
    }

    const normalized = normalizeTrendPoints(series.points);
    duplicateTimestampCountRemoved += Math.max(0, finitePointCount - normalized.length);
    const gapBreakMs = options.gapBreakMsByTag?.get(series.tag) ?? resolveTrendGapBreakMs(normalized);
    const pointsWithGaps: TrendPoint[] = [];
    const seriesGaps: TrendGapBreakInfo[] = [];
    const occupied = new Set<number>(normalized.map((point) => point.t));
    for (let index = 0; index < normalized.length; index += 1) {
      const current = normalized[index];
      const previous = normalized[index - 1];
      if (!current) {
        continue;
      }
      if (index > 0 && previous && previous.v !== null && current.v !== null && current.t - previous.t > gapBreakMs) {
        const gapTs = pickGapMarkerTimestamp(previous.t, current.t, occupied);
        if (gapTs !== null) {
          occupied.add(gapTs);
          pointsWithGaps.push({ t: gapTs, v: null, q: "uncertain" });
          gapBreakCount += 1;
          seriesGaps.push({
            previousTs: previous.t,
            currentTs: current.t,
            deltaMs: current.t - previous.t,
            gapBreakMs,
          });
        }
      }
      pointsWithGaps.push(current);
    }

    const valuesByTs = new Map<number, number | null>();
    let nonNullCount = 0;
    let nullCount = 0;
    for (const point of pointsWithGaps) {
      if (!Number.isFinite(point.t)) {
        continue;
      }
      const quality = (point.q ?? "good").toLowerCase();
      const isGapByQuality = options.showBadQualityGaps && (quality === "bad" || quality === "uncertain");
      const numericValue = typeof point.v === "number" && Number.isFinite(point.v) ? point.v : null;
      const value = isGapByQuality ? null : numericValue;
      valuesByTs.set(point.t, value);
      timestampSet.add(point.t);
      if (value === null) {
        nullCount += 1;
      } else {
        nonNullCount += 1;
      }
    }
    pointCount += pointsWithGaps.length;
    valueMapsByTag.set(series.tag, valuesByTs);
    realGapsByTag.set(series.tag, seriesGaps);
    seriesDiagnostics.push({
      tag: series.tag,
      nonNullCount,
      nullCount,
      alignmentNullCount: 0,
      realGapCount: seriesGaps.length,
      gapBreakMs,
      firstTs: normalized[0]?.t ?? null,
      lastTs: normalized[normalized.length - 1]?.t ?? null,
    });
  }

  const xValues = [...timestampSet].sort((a, b) => a - b);
  const valuesByTag = new Map<string, Array<number | null | undefined>>();
  let lengthMismatchCount = 0;
  for (let seriesIndex = 0; seriesIndex < seriesList.length; seriesIndex += 1) {
    const series = seriesList[seriesIndex];
    if (!series) {
      continue;
    }
    const valuesByTs = valueMapsByTag.get(series.tag) ?? new Map<number, number | null>();
    // Undefined values preserve cross-series alignment holes without drawing real gaps.
    // and reserve null for explicit real gaps.
    const yValues = xValues.map((timestamp) => (valuesByTs.has(timestamp) ? valuesByTs.get(timestamp) : undefined));
    if (yValues.length !== xValues.length) {
      lengthMismatchCount += 1;
    }
    let alignmentNullCount = 0;
    let explicitNullCount = 0;
    for (const value of yValues) {
      if (value === undefined) {
        alignmentNullCount += 1;
      } else if (value === null) {
        explicitNullCount += 1;
      }
    }
    const seriesDiagnostic = seriesDiagnostics[seriesIndex];
    if (seriesDiagnostic) {
      seriesDiagnostic.alignmentNullCount = alignmentNullCount;
      seriesDiagnostic.nullCount = explicitNullCount;
    }
    valuesByTag.set(series.tag, yValues);
  }
  return {
    xValues,
    valuesByTag,
    realGapsByTag,
    pointCount,
    gapBreakCount,
    diagnostics: {
      xUnit: "ms",
      sourcePointCount,
      duplicateTimestampCountBeforeDedupe,
      duplicateTimestampCountRemoved,
      unsortedPairCount,
      invalidTimestampCount,
      xCount: xValues.length,
      firstTs: xValues[0] ?? null,
      lastTs: xValues[xValues.length - 1] ?? null,
      lengthMismatchCount,
      series: seriesDiagnostics,
    },
  };
}

function findTimestampIndex(xValues: number[], timestamp: number): number {
  let left = 0;
  let right = xValues.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const value = xValues[mid];
    if (value === timestamp) {
      return mid;
    }
    if ((value ?? Number.NEGATIVE_INFINITY) < timestamp) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return -1;
}

function findTimestampInsertIndex(xValues: number[], timestamp: number): number {
  let left = 0;
  let right = xValues.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    const value = xValues[mid];
    if ((value ?? Number.NEGATIVE_INFINITY) < timestamp) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  return left;
}

export function applyTrendVisualHolds(
  matrix: TrendDataMatrix,
  holds: TrendVisualHoldSpec[],
): TrendVisualHoldResult {
  const holdCandidates = holds.filter((item) => Number.isFinite(item.holdTs) && Number.isFinite(item.value));
  const staleTagCount = holds.filter((item) => item.stale === true).length;
  if (holdCandidates.length === 0) {
    return {
      xValues: matrix.xValues,
      valuesByTag: matrix.valuesByTag,
      diagnostics: {
        holdTs: null,
        heldTagCount: 0,
        staleTagCount,
        xExtended: false,
        pointCountBefore: matrix.pointCount,
        pointCountAfter: matrix.pointCount,
      },
    };
  }

  const holdTs = Math.max(...holdCandidates.map((item) => item.holdTs));
  if (!Number.isFinite(holdTs)) {
    return {
      xValues: matrix.xValues,
      valuesByTag: matrix.valuesByTag,
      diagnostics: {
        holdTs: null,
        heldTagCount: 0,
        staleTagCount,
        xExtended: false,
        pointCountBefore: matrix.pointCount,
        pointCountAfter: matrix.pointCount,
      },
    };
  }

  const xValues = [...matrix.xValues];
  const existingHoldIndex = findTimestampIndex(xValues, holdTs);
  const holdIndex = existingHoldIndex >= 0 ? existingHoldIndex : findTimestampInsertIndex(xValues, holdTs);
  const xExtended = existingHoldIndex < 0;
  if (xExtended) {
    xValues.splice(holdIndex, 0, holdTs);
  }

  const valuesByTag = new Map<string, Array<number | null | undefined>>();
  for (const [tagName, values] of matrix.valuesByTag) {
    const nextValues = [...values];
    if (xExtended) {
      nextValues.splice(holdIndex, 0, undefined);
    }
    valuesByTag.set(tagName, nextValues);
  }

  let heldTagCount = 0;
  for (const hold of holdCandidates) {
    const current = valuesByTag.get(hold.tag) ?? new Array<number | null | undefined>(xValues.length).fill(undefined);
    if (current.length < xValues.length) {
      current.push(...new Array<number | null | undefined>(xValues.length - current.length).fill(undefined));
    }
    let firstHoldIndex = holdIndex;
    for (let index = holdIndex; index >= 0; index -= 1) {
      const ts = xValues[index];
      if (typeof ts !== "number" || !Number.isFinite(ts) || ts > hold.holdTs) {
        continue;
      }
      const value = current[index];
      if (typeof value === "number" && Number.isFinite(value)) {
        firstHoldIndex = index + 1;
        break;
      }
      if (value === null) {
        firstHoldIndex = index + 1;
        break;
      }
      firstHoldIndex = index;
    }
    for (let index = firstHoldIndex; index <= holdIndex; index += 1) {
      if (current[index] === undefined) {
        current[index] = hold.value;
        heldTagCount += 1;
      }
    }
    valuesByTag.set(hold.tag, current);
  }

  return {
    xValues,
    valuesByTag,
    diagnostics: {
      holdTs,
      heldTagCount,
      staleTagCount,
      xExtended,
      pointCountBefore: matrix.pointCount,
      pointCountAfter: matrix.pointCount + heldTagCount,
    },
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
    axisNameGap: 6,
    axisNamePaddingX: 6,
    axisNamePaddingY: 4,
    verticalLabelOffsetX: 0,
    axisTitleMode: "verticalLabel",
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
  const minAxisSeparation = clamp(Math.round(settings.axisScaleGap), 0, 140);
  for (const axis of axes) {
    const idx = positionIndex[axis.position];
    axis.offset = clamp(Number(axis.offset ?? idx * settings.axisOffsetStep), 0, 2400);
    axis.name = (axis.name ?? axis.id).trim() || axis.id;
    axis.min = typeof axis.min === "number" ? roundToOneDecimal(axis.min) : (axis.min ?? "auto");
    axis.max = typeof axis.max === "number" ? roundToOneDecimal(axis.max) : (axis.max ?? "auto");
    axis.axisLabelFontSize = clamp(Number(axis.axisLabelFontSize ?? 12), 9, 24);
    axis.axisLabelMargin = clamp(Number(axis.axisLabelMargin ?? 6), 0, 24);
    axis.axisNameFontSize = clamp(Number(axis.axisNameFontSize ?? 12), 9, 24);
    axis.axisNameGap = clamp(Number(axis.axisNameGap ?? 6), 0, 80);
    axis.axisNamePaddingX = clamp(Number(axis.axisNamePaddingX ?? 6), 0, 24);
    axis.axisNamePaddingY = clamp(Number(axis.axisNamePaddingY ?? 4), 0, 16);
    axis.verticalLabelOffsetX = clamp(Math.round(Number(axis.verticalLabelOffsetX ?? 0)), -160, 160);
    axis.axisTitleMode = axis.axisTitleMode === "hidden"
      || axis.axisTitleMode === "compactLabel"
      || axis.axisTitleMode === "verticalLabel"
      ? axis.axisTitleMode
      : "verticalLabel";
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
