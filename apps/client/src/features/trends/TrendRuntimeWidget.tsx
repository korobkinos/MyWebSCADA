import { type CSSProperties, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColorPicker, Spin } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { hasRoleAccess, type TagValue, type TrendChartObject } from "@web-scada/shared";
import { canRequestEndpoint, getConnectionSnapshot, getEndpointBackoffDelay, subscribeConnectionState, type ConnectionState } from "../../services/connection-state";
import { clearTrendWidgetDiagnostics, getRuntimeDiagnosticsSnapshot, registerPollingLoop, setRuntimeDiagnosticMetric, setTrendWidgetDiagnostics } from "../../services/runtime-diagnostics";
import { createRuntimeSocket } from "../../services/ws";
import type { TrendTagInfo } from "../../services/api";
import { WorkbenchButton, WorkbenchIconButton } from "../../components/workbench";
import { fetchTrendTags, queryTrendData } from "./trendApi";
import { TrendChart } from "./TrendChart";
import { TrendSettingsPanel } from "./TrendSettingsPanel";
import { TrendTagPickerDialog } from "./TrendTagPickerDialog";
import { TrendWorkbenchDialog } from "./TrendWorkbenchDialog";
import { exportTrendDiagnostics, logTrendDiagnostics } from "./trendDiagnostics";
import { TrendQueryCache, buildTrendCacheKey } from "./trendStore";
import type { TrendAxisConfig, TrendChartApi, TrendLiveDataSource, TrendPoint, TrendQueryResponse, TrendQuickPreset, TrendRangePreset, TrendSeriesColumnId, TrendSeriesColumnWidths, TrendSettings, TrendTagPickerFilters, TrendTagSelection, TrendVisibleRange } from "./trendTypes";
import { TREND_DEFAULT_AXIS_ID, buildAxes, clamp, decimateTrendPoints, defaultTrendSettings, formatRangeLabel, formatTrendArchivePolicy, getSparseTrendArchivePolicyWarning, isRangeCovered, normalizeTrendAxes, normalizeTrendPoints, normalizeTrendRange, normalizeTrendTableSettings, parseQuickRange, resolveQuickPresetFromRangeSpan, unionTrendRanges } from "./trendUtils";
import { readRuntimeViewState, type TrendRuntimeViewStateData, writeRuntimeViewState } from "./trendRuntimeViewState";
import { resolveTrendTheme } from "./trendTheme";
import { TrendQueryRateLimiter } from "./trendQueryRateLimiter";

const LIVE_REALTIME_FLUSH_MIN_MS = 50;
const LIVE_REALTIME_FLUSH_MAX_MS = 1000;
const LIVE_HEARTBEAT_MS = 1000;
const LIVE_HEARTBEAT_STALE_SOURCE_MS = 1200;
const LIVE_POLL_INTERVAL_FAST_MS = 1000;
const LIVE_POLL_INTERVAL_MEDIUM_MS = 2000;
const LIVE_POLL_INTERVAL_SLOW_MS = 5000;
const LIVE_ARCHIVE_POLL_MAX_POINTS = 3000;
const LIVE_REALTIME_RESYNC_MIN_SEC = 10;
const LIVE_REALTIME_RESYNC_MAX_SEC = 30;
const LIVE_PENDING_BUFFER_MULTIPLIER = 2;
const LIVE_PENDING_BUFFER_MIN = 2000;
const LIVE_PENDING_BUFFER_MAX = 120_000;
const LIVE_RETENTION_MIN_MS = 60 * 60 * 1000;
const RUNTIME_VIEW_STATE_SAVE_DEBOUNCE_MS = 800;
const TOO_MANY_TAGS_LIMIT = 40;
const TREND_ZOOM_MIN_SPAN_MS = 15_000;
const TREND_ZOOM_MAX_SPAN_MS = 24 * 60 * 60 * 1000;
const TREND_CACHE_POINTS_PER_ENTRY = 8000;
const TREND_CACHE_POINTS_MIN = 120_000;
const MIN_TRENDS_QUERY_INTERVAL_MS = 2000;
const TRENDS_DISABLE_ARCHIVE_POLLING_KEY = "scada.trends.disableArchivePolling";
const ONLINE_RECOVERY_REFRESH_DEBOUNCE_MS = 3000;
const TREND_INITIAL_BUFFER_MS = 60 * 60 * 1000;
const TREND_PREFETCH_MIN_MS = 15 * 60 * 1000;
const TREND_PREFETCH_MAX_MS = 60 * 60 * 1000;
const TREND_PREFETCH_EDGE_RATIO = 0.2;
const TREND_PREFETCH_DEBOUNCE_MS = 220;
const TREND_BUFFER_QUERY_MAX_POINTS = 8000;
const MAX_OFFLINE_BUFFER_POINTS_PER_SERIES = 40_000;
const MAX_OFFLINE_BUFFER_POINTS_TOTAL = 240_000;
const MAX_OFFLINE_BUFFER_TIME_SPAN_MS = 24 * 60 * 60 * 1000;
const MAX_LIVE_BUFFER_POINTS_TOTAL = 120_000;
const TREND_BUFFER_POINTS_PER_SERIES_MAX = MAX_OFFLINE_BUFFER_POINTS_PER_SERIES;
const TREND_CACHE_POINTS_MAX = 600_000;
const TREND_SERIES_TABLE_HEADER_PX = 30;
const TREND_SERIES_TABLE_ROW_PX = 30;
const TREND_CARRY_FORWARD_COLLAPSE_MAX_GAP_MS = 2000;

type TrendSeriesColumnState = {
  id: TrendSeriesColumnId;
  label: string;
  visible: boolean;
};

const DEFAULT_SERIES_COLUMNS: TrendSeriesColumnState[] = [
  { id: "visible", label: "Visible", visible: true },
  { id: "color", label: "Color", visible: true },
  { id: "tag", label: "Tag", visible: true },
  { id: "displayName", label: "Display name", visible: true },
  { id: "description", label: "Description", visible: true },
  { id: "axis", label: "Scale", visible: true },
  { id: "value", label: "Value", visible: true },
];

const DEFAULT_SERIES_COLUMN_WIDTHS: TrendSeriesColumnWidths = {
  visible: 54,
  tag: 180,
  displayName: 200,
  description: 260,
  axis: 120,
  color: 94,
  value: 96,
};

const MIN_SERIES_COLUMN_WIDTHS: Record<TrendSeriesColumnId, number> = {
  visible: 28,
  tag: 72,
  displayName: 92,
  description: 120,
  axis: 72,
  color: 56,
  value: 64,
};

function toLocalDateTimeInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromLocalDateTimeInputValue(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeHexColor(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const body = trimmed.slice(1);
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  return fallback;
}

type ResolvedSeriesTableTheme = {
  background: string;
  headerBackground: string;
  textColor: string;
  mutedTextColor: string;
  borderColor: string;
  hoverBackground: string;
  valueTextColor: string;
  rowHeight: number;
  headerHeight: number;
  fontSize: number;
  cellPaddingX: number;
  cellPaddingY: number;
};

function resolveSeriesTableTheme(settings: TrendSettings, uiTheme: ReturnType<typeof resolveTrendTheme>): ResolvedSeriesTableTheme {
  const table = normalizeTrendTableSettings(settings.table);
  const useTableColorOverrides = settings.theme === "custom";
  const rowHeight = clamp(Math.round(table?.rowHeight ?? TREND_SERIES_TABLE_ROW_PX), 20, 48);
  const headerHeight = clamp(Math.round(table?.headerHeight ?? TREND_SERIES_TABLE_HEADER_PX), 20, 48);
  const fontSize = clamp(Math.round(table?.fontSize ?? 12), 10, 16);
  const cellPaddingX = clamp(Math.round(table?.cellPaddingX ?? 6), 2, 16);
  const cellPaddingY = clamp(Math.round(table?.cellPaddingY ?? 3), 1, 10);

  return {
    background: normalizeHexColor(useTableColorOverrides ? table?.background : undefined, uiTheme.tableBg),
    headerBackground: normalizeHexColor(useTableColorOverrides ? table?.headerBackground : undefined, uiTheme.panel),
    textColor: normalizeHexColor(useTableColorOverrides ? table?.textColor : undefined, uiTheme.text),
    mutedTextColor: normalizeHexColor(useTableColorOverrides ? table?.mutedTextColor : undefined, uiTheme.mutedText),
    borderColor: normalizeHexColor(useTableColorOverrides ? table?.borderColor : undefined, uiTheme.tableBorder),
    hoverBackground: normalizeHexColor(useTableColorOverrides ? table?.hoverBackground : undefined, uiTheme.buttonHoverBg),
    valueTextColor: normalizeHexColor(useTableColorOverrides ? table?.valueTextColor : undefined, normalizeHexColor(useTableColorOverrides ? table?.textColor : undefined, uiTheme.text)),
    rowHeight,
    headerHeight,
    fontSize,
    cellPaddingX,
    cellPaddingY,
  };
}

function formatTrendValue(value: number | boolean | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "-";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function resolveLivePendingBufferCap(tagCount: number, maxLivePointsPerTag: number): number {
  const safeTagCount = Math.max(1, tagCount);
  const safeSeriesLimit = clamp(Math.round(maxLivePointsPerTag), 200, 20_000);
  const desired = safeTagCount * safeSeriesLimit * LIVE_PENDING_BUFFER_MULTIPLIER;
  return clamp(desired, LIVE_PENDING_BUFFER_MIN, LIVE_PENDING_BUFFER_MAX);
}

function resolveTrendCachePointLimit(maxCachedRanges: number): number {
  const safeCacheSize = clamp(Math.round(maxCachedRanges), 8, 256);
  return clamp(safeCacheSize * TREND_CACHE_POINTS_PER_ENTRY, TREND_CACHE_POINTS_MIN, TREND_CACHE_POINTS_MAX);
}

function resolveLiveRetentionMs(): number {
  return LIVE_RETENTION_MIN_MS;
}

function resolveLiveBufferedPointLimitPerSeries(maxLivePointsPerTag: number, tagCount: number): number {
  const configuredLimit = Number.isFinite(maxLivePointsPerTag)
    ? clamp(Math.round(maxLivePointsPerTag), 1, 20_000)
    : 5000;
  const totalLimited = Math.max(1, Math.floor(MAX_LIVE_BUFFER_POINTS_TOTAL / Math.max(1, tagCount)));
  return Math.max(1, Math.min(configuredLimit, totalLimited));
}

function resolveLiveTailToleranceMs(range: TrendVisibleRange): number {
  const span = Math.max(1, range.to - range.from);
  return clamp(Math.round(span * 0.02), 2000, 15_000);
}

function isRangeAtLiveTail(range: TrendVisibleRange, latestTs: number, toleranceMs: number): boolean {
  if (!Number.isFinite(latestTs) || !Number.isFinite(toleranceMs)) {
    return false;
  }
  return Math.abs(range.to - latestTs) <= Math.max(0, toleranceMs);
}

function isAuthenticationRequiredErrorMessage(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes("authentication required") || text.includes("unauthorized");
}

function isAbortError(error: unknown): boolean {
  if (typeof error === "string") {
    const text = error.toLowerCase().trim();
    return text === "aborted"
      || text.includes("the operation was aborted")
      || text.includes("the user aborted a request")
      || text.includes("aborterror");
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  const source = error as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
  const name = typeof source.name === "string" ? source.name.toLowerCase() : "";
  if (name === "aborterror") {
    return true;
  }
  if (source.code === 20) {
    return true;
  }
  const message = typeof source.message === "string" ? source.message.toLowerCase().trim() : "";
  return message === "aborted"
    || message.includes("the operation was aborted")
    || message.includes("the user aborted a request")
    || message.includes("aborterror")
    || (source.cause !== error && isAbortError(source.cause));
}

function mergeTrendSeriesPoints(
  base: TrendQueryResponse["series"],
  overlay: TrendQueryResponse["series"],
): TrendQueryResponse["series"] {
  const mergedByTag = new Map<string, TrendQueryResponse["series"][number]>();
  for (const series of base) {
    mergedByTag.set(series.tag, { ...series, points: [...series.points] });
  }
  for (const series of overlay) {
    const existing = mergedByTag.get(series.tag);
    if (!existing) {
      mergedByTag.set(series.tag, { ...series, points: [...series.points] });
      continue;
    }
    const byTs = new Map<number, (typeof series.points)[number]>();
    for (const point of existing.points) {
      byTs.set(point.t, point);
    }
    for (const point of series.points) {
      byTs.set(point.t, point);
    }
    existing.points = [...byTs.values()].sort((a, b) => a.t - b.t);
    if (series.displayName) {
      existing.displayName = series.displayName;
    }
    if (series.diagnostics) {
      existing.diagnostics = series.diagnostics;
    }
  }
  return [...mergedByTag.values()];
}

function buildLiveOverlaySeries(
  updates: LiveIncomingPoint[],
  selectedTags: TrendTagSelection[],
): TrendQueryResponse["series"] {
  const selectedByTag = new Map(selectedTags.map((item) => [item.tag, item]));
  const byTag = new Map<string, Map<number, TrendQueryResponse["series"][number]["points"][number]>>();
  for (const update of updates) {
    if (!selectedByTag.has(update.tag) || !Number.isFinite(update.timestamp)) {
      continue;
    }
    let numericValue: number | null;
    if (typeof update.value === "number") {
      if (!Number.isFinite(update.value)) {
        continue;
      }
      numericValue = update.value;
    } else if (typeof update.value === "boolean") {
      numericValue = update.value ? 1 : 0;
    } else if (update.value === null) {
      numericValue = null;
    } else {
      continue;
    }
    const quality = update.quality?.toLowerCase() === "bad"
      ? "bad"
      : update.quality?.toLowerCase() === "uncertain"
        ? "uncertain"
        : "good";
    const tagMap = byTag.get(update.tag) ?? new Map<number, TrendQueryResponse["series"][number]["points"][number]>();
    tagMap.set(update.timestamp, {
      t: update.timestamp,
      v: numericValue,
      q: quality,
    });
    byTag.set(update.tag, tagMap);
  }
  const result: TrendQueryResponse["series"] = [];
  for (const [tagName, pointsByTs] of byTag) {
    const selection = selectedByTag.get(tagName);
    result.push({
      tag: tagName,
      displayName: selection?.displayName || tagName,
      unit: selection?.unit,
      color: selection?.color,
      axisId: selection?.axisId,
      points: [...pointsByTs.values()].sort((a, b) => a.t - b.t),
    });
  }
  return result;
}

function getSeriesBounds(series: TrendQueryResponse["series"]): { firstTs: number | null; lastTs: number | null } {
  let firstTs = Number.POSITIVE_INFINITY;
  let lastTs = Number.NEGATIVE_INFINITY;
  for (const item of series) {
    for (const point of item.points) {
      if (point.t < firstTs) {
        firstTs = point.t;
      }
      if (point.t > lastTs) {
        lastTs = point.t;
      }
    }
  }
  return {
    firstTs: Number.isFinite(firstTs) ? firstTs : null,
    lastTs: Number.isFinite(lastTs) ? lastTs : null,
  };
}

function countTrendResponsePoints(response: TrendQueryResponse | null | undefined): number {
  return response?.series.reduce((acc, series) => acc + series.points.length, 0) ?? 0;
}

function formatTrendHistoryTimestamp(timestamp: number | null | undefined): string {
  if (!Number.isFinite(timestamp ?? Number.NaN)) {
    return "-";
  }
  return new Date(timestamp as number).toLocaleString();
}

function lowerBoundTrendPointIndex(points: TrendPoint[], timestamp: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((points[mid]?.t ?? Number.NEGATIVE_INFINITY) < timestamp) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function upperBoundTrendPointIndex(points: TrendPoint[], timestamp: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((points[mid]?.t ?? Number.NEGATIVE_INFINITY) <= timestamp) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function resolveOfflineRetentionRange(visibleRange: TrendVisibleRange, loadedRange: TrendVisibleRange): TrendVisibleRange {
  const visible = normalizeTrendRange(visibleRange);
  const loaded = normalizeTrendRange(loadedRange);
  const visibleSpan = Math.max(TREND_ZOOM_MIN_SPAN_MS, visible.to - visible.from);
  const desiredSpan = clamp(Math.round(visibleSpan * 3), TREND_INITIAL_BUFFER_MS, MAX_OFFLINE_BUFFER_TIME_SPAN_MS);
  if (desiredSpan <= visibleSpan) {
    return visible;
  }
  const padding = Math.max(0, Math.floor((desiredSpan - visibleSpan) / 2));
  let from = visible.from - padding;
  let to = visible.to + padding;
  if (from < loaded.from) {
    to += loaded.from - from;
    from = loaded.from;
  }
  if (to > loaded.to) {
    from -= to - loaded.to;
    to = loaded.to;
  }
  from = Math.max(from, loaded.from);
  to = Math.min(Math.max(to, visible.to), loaded.to);
  if (to <= from) {
    return visible;
  }
  return { from, to };
}

function trimTrendPointsForMemoryRange(
  points: TrendPoint[],
  retentionRange: TrendVisibleRange,
  visibleRange: TrendVisibleRange,
  pointLimit: number,
): TrendPoint[] {
  const safeLimit = Math.max(1, Math.round(pointLimit));
  const start = lowerBoundTrendPointIndex(points, retentionRange.from);
  const end = upperBoundTrendPointIndex(points, retentionRange.to);
  const retained = points.slice(start, end);
  if (retained.length <= safeLimit) {
    return retained;
  }
  const visible = normalizeTrendRange(visibleRange);
  const visibleStart = lowerBoundTrendPointIndex(retained, visible.from);
  const visibleEnd = upperBoundTrendPointIndex(retained, visible.to);
  const visibleCount = Math.max(0, visibleEnd - visibleStart);
  if (visibleCount >= safeLimit) {
    const centerIndex = lowerBoundTrendPointIndex(retained, visible.from + (visible.to - visible.from) / 2);
    const from = clamp(centerIndex - Math.floor(safeLimit / 2), 0, Math.max(0, retained.length - safeLimit));
    return retained.slice(from, from + safeLimit);
  }
  const remaining = safeLimit - visibleCount;
  const before = Math.min(visibleStart, Math.floor(remaining / 2));
  const after = Math.min(retained.length - visibleEnd, remaining - before);
  const extraBefore = Math.min(visibleStart - before, remaining - before - after);
  const from = visibleStart - before - extraBefore;
  const to = Math.min(retained.length, from + safeLimit);
  return retained.slice(from, to);
}

function limitOfflineTrendResponse(
  response: TrendQueryResponse,
  loadedRange: TrendVisibleRange,
  visibleRange: TrendVisibleRange,
): { response: TrendQueryResponse; loadedRange: TrendVisibleRange; trimmedPointCount: number } {
  const retentionRange = resolveOfflineRetentionRange(visibleRange, loadedRange);
  const perSeriesLimit = Math.max(
    1,
    Math.min(
      MAX_OFFLINE_BUFFER_POINTS_PER_SERIES,
      Math.floor(MAX_OFFLINE_BUFFER_POINTS_TOTAL / Math.max(1, response.series.length)),
    ),
  );
  let trimmedPointCount = 0;
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  const series = response.series.map((item) => {
    const beforeCount = item.points.length;
    const points = trimTrendPointsForMemoryRange(item.points, retentionRange, visibleRange, perSeriesLimit);
    trimmedPointCount += Math.max(0, beforeCount - points.length);
    const first = points[0];
    const last = points[points.length - 1];
    if (first && first.t < minTs) {
      minTs = first.t;
    }
    if (last && last.t > maxTs) {
      maxTs = last.t;
    }
    return points === item.points ? item : { ...item, points };
  });
  const nextRange = Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs > minTs
    ? { from: Math.min(retentionRange.from, minTs), to: Math.max(retentionRange.to, maxTs) }
    : retentionRange;
  return {
    response: {
      ...response,
      from: new Date(nextRange.from).toISOString(),
      to: new Date(nextRange.to).toISOString(),
      series,
    },
    loadedRange: nextRange,
    trimmedPointCount,
  };
}

function normalizeTimestampMs(timestamp: unknown): number | null {
  let numeric = Number.NaN;
  if (typeof timestamp === "number") {
    numeric = timestamp;
  } else if (typeof timestamp === "string" && timestamp.trim().length > 0) {
    numeric = Number(timestamp);
  }
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (Math.abs(numeric) < 1_000_000_000_000) {
    numeric *= 1000;
  }
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Math.round(numeric);
}

function buildEmptyTrendResponse(range: TrendVisibleRange, selectedTags: TrendTagSelection[]): TrendQueryResponse {
  const safeFrom = Math.min(range.from, range.to);
  const safeTo = Math.max(range.from, range.to);
  return {
    from: new Date(safeFrom).toISOString(),
    to: new Date(safeTo).toISOString(),
    aggregation: "raw",
    series: selectedTags.map((tag) => ({
      tag: tag.tag,
      displayName: tag.displayName || tag.tag,
      unit: tag.unit,
      color: tag.color,
      axisId: tag.axisId,
      points: [],
    })),
  };
}

function normalizeTrendResponseForRange(
  response: TrendQueryResponse,
  range: TrendVisibleRange,
  selectedTags: TrendTagSelection[],
  options?: { carryForwardToRangeEnd?: boolean },
): TrendQueryResponse {
  const safeFrom = Math.min(range.from, range.to);
  const safeTo = Math.max(range.from, range.to);
  const carryForwardToRangeEnd = options?.carryForwardToRangeEnd !== false;
  const sourceByTag = new Map(response.series.map((series) => [series.tag, series]));
  const normalizedSeries = selectedTags.map((selection) => {
    const source = sourceByTag.get(selection.tag);
    const sourcePoints = normalizeTrendPoints(
      (source?.points ?? [])
        .map((point): TrendPoint | null => {
          const timestamp = normalizeTimestampMs(point?.t);
          if (timestamp === null) {
            return null;
          }
          return {
            t: timestamp,
            v: point.v,
            q: point.q,
          };
        })
        .filter((point): point is TrendPoint => point !== null),
    );
    const normalizedPoints = sourcePoints.filter((point) => point.t >= safeFrom && point.t <= safeTo);
    const hadNoPointsInRange = normalizedPoints.length === 0;
    let insertedFromBeforeRangeCount = 0;
    let previousPoint: TrendPoint | undefined;
    for (let index = sourcePoints.length - 1; index >= 0; index -= 1) {
      const candidate = sourcePoints[index];
      if (candidate && candidate.t < safeFrom) {
        previousPoint = candidate;
        break;
      }
    }
    if (previousPoint && (normalizedPoints.length === 0 || normalizedPoints[0]!.t > safeFrom)) {
      normalizedPoints.unshift({ t: safeFrom, v: previousPoint.v, q: previousPoint.q });
      insertedFromBeforeRangeCount += 1;
    }
    if (carryForwardToRangeEnd && normalizedPoints.length > 0) {
      const last = normalizedPoints[normalizedPoints.length - 1];
      if (last && last.t < safeTo) {
        normalizedPoints.push({ t: safeTo, v: last.v, q: last.q });
        if (hadNoPointsInRange && previousPoint) {
          insertedFromBeforeRangeCount += 1;
        }
      }
    }
    if (carryForwardToRangeEnd && normalizedPoints.length >= 2) {
      const last = normalizedPoints[normalizedPoints.length - 1];
      const previous = normalizedPoints[normalizedPoints.length - 2];
      if (
        last
        && previous
        && last.t === safeTo
        && previous.v === last.v
        && (previous.q ?? "good") === (last.q ?? "good")
        && (last.t - previous.t) <= TREND_CARRY_FORWARD_COLLAPSE_MAX_GAP_MS
      ) {
        normalizedPoints.pop();
      }
    }
    if (hadNoPointsInRange && insertedFromBeforeRangeCount === 2) {
      logTrendDiagnostics("trend:carry-forward-constant-series", {
        tag: selection.tag,
        from: safeFrom,
        to: safeTo,
        previousPointTimestamp: previousPoint?.t ?? null,
        insertedPointCount: insertedFromBeforeRangeCount,
      });
    } else if (insertedFromBeforeRangeCount > 0) {
      logTrendDiagnostics("trend:carry-forward-from-before-range", {
        tag: selection.tag,
        from: safeFrom,
        to: safeTo,
        previousPointTimestamp: previousPoint?.t ?? null,
        insertedPointCount: insertedFromBeforeRangeCount,
      });
    }
    const normalizedSeriesItem: TrendQueryResponse["series"][number] = {
      tag: selection.tag,
      displayName: source?.displayName || selection.displayName || selection.tag,
      unit: source?.unit ?? selection.unit,
      color: source?.color ?? selection.color,
      axisId: source?.axisId ?? selection.axisId,
      points: normalizeTrendPoints(normalizedPoints),
    };
    if (source?.diagnostics) {
      normalizedSeriesItem.diagnostics = source.diagnostics;
    }
    return normalizedSeriesItem;
  });
  return {
    from: new Date(safeFrom).toISOString(),
    to: new Date(safeTo).toISOString(),
    aggregation: response.aggregation,
    series: normalizedSeries,
  };
}

function boundResponseSeriesPoints(
  response: TrendQueryResponse,
  maxPointsPerSeries: number,
  options?: { minLimit?: number; maxLimit?: number },
): TrendQueryResponse {
  const safeLimit = clamp(
    Math.round(maxPointsPerSeries),
    options?.minLimit ?? 200,
    options?.maxLimit ?? TREND_BUFFER_POINTS_PER_SERIES_MAX,
  );
  const boundedSeries = response.series.map((series) => {
    if (series.points.length <= safeLimit) {
      return series;
    }
    const trimmed = series.points.slice(series.points.length - safeLimit);
    return {
      ...series,
      points: trimmed,
    };
  });
  return {
    ...response,
    series: boundedSeries,
  };
}

function buildBufferedTrendResponse(
  base: TrendQueryResponse | null,
  overlay: TrendQueryResponse,
  range: TrendVisibleRange,
  selectedTags: TrendTagSelection[],
  options?: { carryForwardToRangeEnd?: boolean },
): TrendQueryResponse {
  if (!base) {
    return normalizeTrendResponseForRange(overlay, range, selectedTags, options);
  }
  return normalizeTrendResponseForRange({
    ...overlay,
    from: new Date(range.from).toISOString(),
    to: new Date(range.to).toISOString(),
    series: mergeTrendSeriesPoints(base.series, overlay.series),
  }, range, selectedTags, options);
}

function resolveInitialLoadedRange(visibleRange: TrendVisibleRange): TrendVisibleRange {
  const normalized = normalizeTrendRange(visibleRange);
  const visibleSpan = Math.max(1, normalized.to - normalized.from);
  const bufferSpan = Math.max(TREND_INITIAL_BUFFER_MS, visibleSpan);
  return {
    from: normalized.to - bufferSpan,
    to: normalized.to,
  };
}

function resolveRangeForPresetInBuffer(
  preset: Exclude<TrendRangePreset, "custom">,
  loadedRange: TrendVisibleRange | null,
): TrendVisibleRange {
  if (!loadedRange) {
    return parseQuickRange(preset);
  }
  return parseQuickRange(preset, normalizeTrendRange(loadedRange).to);
}

function requestPrefetchIfNeeded(
  visibleRange: TrendVisibleRange,
  loadedRange: TrendVisibleRange | null,
): TrendVisibleRange[] {
  const visible = normalizeTrendRange(visibleRange);
  if (!loadedRange) {
    return [resolveInitialLoadedRange(visible)];
  }
  const loaded = normalizeTrendRange(loadedRange);
  const span = Math.max(TREND_ZOOM_MIN_SPAN_MS, visible.to - visible.from);
  const edgeThreshold = Math.max(60_000, Math.round(span * TREND_PREFETCH_EDGE_RATIO));
  const prefetchSpan = clamp(Math.round(span * 2), TREND_PREFETCH_MIN_MS, TREND_PREFETCH_MAX_MS);
  const requests: TrendVisibleRange[] = [];

  if (visible.from < loaded.from) {
    requests.push({
      from: visible.from - prefetchSpan,
      to: loaded.from,
    });
  } else if (visible.from - loaded.from <= edgeThreshold) {
    requests.push({
      from: loaded.from - prefetchSpan,
      to: loaded.from,
    });
  }

  if (visible.to > loaded.to) {
    requests.push({
      from: loaded.to,
      to: visible.to + prefetchSpan,
    });
  } else if (loaded.to - visible.to <= edgeThreshold) {
    requests.push({
      from: loaded.to,
      to: loaded.to + prefetchSpan,
    });
  }

  return requests
    .map(normalizeTrendRange)
    .filter((range) => range.to - range.from >= 1000);
}

function downloadTextFile(filename: string, content: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

type ToolbarGlyphProps = {
  path: string;
  viewBox?: string;
};

function ToolbarGlyph({ path, viewBox = "0 0 24 24" }: ToolbarGlyphProps) {
  return (
    <svg width="15" height="15" viewBox={viewBox} fill="none" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function resolveRangeFromObject(object: TrendChartObject): { preset: TrendRangePreset; range: TrendVisibleRange } {
  const preset = object.rangePreset ?? "5m";
  if (preset === "custom" && typeof object.customFrom === "number" && typeof object.customTo === "number" && object.customTo > object.customFrom) {
    return {
      preset,
      range: { from: object.customFrom, to: object.customTo },
    };
  }
  return {
    preset,
    range: parseQuickRange(preset === "custom" ? "1h" : preset),
  };
}

function resolveSettingsFromObject(object: TrendChartObject): TrendSettings {
  const defaults = defaultTrendSettings();
  const source = (object.settings ?? {}) as Partial<TrendSettings>;
  const maxVisiblePointsPerSeries = clamp(
    Number(source.maxVisiblePointsPerSeries ?? source.maxPointsPerSeries ?? defaults.maxVisiblePointsPerSeries),
    1000,
    8000,
  );
  const maxCachedRanges = clamp(
    Number(source.maxCachedRanges ?? source.cacheSize ?? defaults.maxCachedRanges),
    8,
    256,
  );
  const maxLivePointsPerTag = clamp(
    Number(source.maxLivePointsPerTag ?? source.liveBufferLimit ?? defaults.maxLivePointsPerTag),
    200,
    20000,
  );
  return {
    ...defaults,
    ...source,
    renderer: "echarts",
    liveDataSource: source.liveDataSource === "realtimeAppend" ? "realtimeAppend" : defaults.liveDataSource ?? DEFAULT_LIVE_DATA_SOURCE,
    liveResyncEnabled: source.liveResyncEnabled ?? defaults.liveResyncEnabled,
    liveResyncIntervalSec: clamp(Number(source.liveResyncIntervalSec ?? defaults.liveResyncIntervalSec), LIVE_REALTIME_RESYNC_MIN_SEC, LIVE_REALTIME_RESYNC_MAX_SEC),
    realtimeAppendSnapshotAggregation:
      source.realtimeAppendSnapshotAggregation === "raw" || source.realtimeAppendSnapshotAggregation === "minmax"
        ? source.realtimeAppendSnapshotAggregation
        : defaults.realtimeAppendSnapshotAggregation,
    realtimeAppendSnapshotMaxPoints: clamp(Number(source.realtimeAppendSnapshotMaxPoints ?? defaults.realtimeAppendSnapshotMaxPoints), 1000, 8000),
    realtimeAppendFlushMs: clamp(Number(source.realtimeAppendFlushMs ?? defaults.realtimeAppendFlushMs), LIVE_REALTIME_FLUSH_MIN_MS, LIVE_REALTIME_FLUSH_MAX_MS),
    maxVisiblePointsPerSeries,
    maxLivePointsPerTag,
    maxCachedRanges,
    // Legacy aliases.
    maxPointsPerSeries: maxVisiblePointsPerSeries,
    cacheSize: maxCachedRanges,
    liveBufferLimit: maxLivePointsPerTag,
    zoomDebounceMs: clamp(Number(source.zoomDebounceMs ?? defaults.zoomDebounceMs), 100, 1200),
    refreshIntervalMs: clamp(Number(source.refreshIntervalMs ?? defaults.refreshIntervalMs), 500, 60000),
    defaultLineWidth: clamp(Number(source.defaultLineWidth ?? defaults.defaultLineWidth), 1, 5),
    axisOffsetStep: clamp(Number(source.axisOffsetStep ?? defaults.axisOffsetStep), 8, 220),
    axisScaleGap: clamp(Number(source.axisScaleGap ?? defaults.axisScaleGap), 0, 64),
    seriesTableRows: clamp(Number(source.seriesTableRows ?? defaults.seriesTableRows), 2, 24),
    table: normalizeTrendTableSettings(source.table),
  };
}

function buildObjectDefaultsSignature(object: TrendChartObject): string {
  const payload = {
    selectedTags: object.selectedTags ?? [],
    axes: object.axes ?? [],
    settings: resolveSettingsFromObject(object),
    rangePreset: object.rangePreset ?? "5m",
    customFrom: object.customFrom ?? null,
    customTo: object.customTo ?? null,
    liveMode: Boolean(object.liveMode),
    showToolbar: object.showToolbar ?? true,
    showStatusBar: object.showStatusBar ?? true,
  };
  return JSON.stringify(payload);
}

type TrendRuntimeWidgetProps = {
  object: TrendChartObject;
  userRoleLevel?: number;
};

type TrendContextMenuState = {
  x: number;
  y: number;
};

type LiveSocketState = "idle" | "connecting" | "open" | "closed" | "error";
type LiveHistoryState = "idle" | "loading" | "loaded" | "empty" | "error";
type OfflineLoadState = "idle" | "loading" | "loaded" | "empty" | "error";
type TrendMode = "live" | "offline";
type LiveIncomingPoint = { tag: string; value: number | boolean | string | null; quality?: string; timestamp: number; sessionId: number };
type BackoffError = Error & { reason?: string; retryAfterMs?: number };
type ExecuteQueryResult =
  | { ok: true; response: TrendQueryResponse }
  | { ok: false; reason: "backoff"; retryAfterMs: number }
  | { ok: false; reason: "aborted" }
  | { ok: false; reason: "error" };
const DEFAULT_LIVE_DATA_SOURCE: TrendLiveDataSource = "archivePolling";

function resolveLivePollingIntervalMs(windowMs: number): number {
  const safeWindowMs = Math.max(60_000, Math.round(windowMs));
  if (safeWindowMs <= 15 * 60 * 1000) {
    return LIVE_POLL_INTERVAL_FAST_MS;
  }
  if (safeWindowMs <= 60 * 60 * 1000) {
    return LIVE_POLL_INTERVAL_MEDIUM_MS;
  }
  return LIVE_POLL_INTERVAL_SLOW_MS;
}

function resolveLiveResyncIntervalMs(valueSec: number): number {
  const seconds = clamp(Math.round(valueSec), LIVE_REALTIME_RESYNC_MIN_SEC, LIVE_REALTIME_RESYNC_MAX_SEC);
  return seconds * 1000;
}

function computeNextMetronomeDelay(now: number, intervalMs: number): number {
  const safeIntervalMs = Math.max(1, Math.round(intervalMs));
  const nextAt = Math.ceil((now + 1) / safeIntervalMs) * safeIntervalMs;
  return Math.max(0, nextAt - now);
}

function isArchivePollingDisabled(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(TRENDS_DISABLE_ARCHIVE_POLLING_KEY) === "1";
}

function resolveRetryDelayFromError(error: unknown, fallbackEndpoint: "trendTags" | "trendsQuery"): number | null {
  if ((error as BackoffError | null)?.reason === "backoff") {
    const retryAfterMs = Number((error as BackoffError).retryAfterMs);
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return retryAfterMs;
    }
  }
  const endpointDelay = getEndpointBackoffDelay(fallbackEndpoint);
  return endpointDelay > 0 ? endpointDelay : null;
}

const DEFAULT_TAG_PICKER_FILTERS: TrendTagPickerFilters = {
  search: "",
  groupFilter: "all",
  driverFilter: "all",
  selectionFilter: "all",
};
function resolveInitialRuntimeViewState(object: TrendChartObject): TrendRuntimeViewStateData {
  const objectRange = resolveRangeFromObject(object);
  const resolvedSettings = resolveSettingsFromObject(object);
  const normalizedAxes = normalizeTrendAxes(object.axes ?? [], resolvedSettings);
  const objectDefaultsSignature = buildObjectDefaultsSignature(object);
  const restored = readRuntimeViewState({
    objectId: object.id,
    defaultTagPickerFilters: DEFAULT_TAG_PICKER_FILTERS,
    defaultSeriesColumnWidths: DEFAULT_SERIES_COLUMN_WIDTHS,
    objectDefaultsSignature,
  });
  if (restored && restored.defaultsSignature === objectDefaultsSignature) {
    const restoredSettings = restored.settings ?? resolvedSettings;
    const normalizedRestoredAxes = normalizeTrendAxes(restored.manualAxes ?? object.axes ?? [], restoredSettings);
    if (restored.liveMode) {
      const presetSpan = restored.toolbarQuickPreset
        ? parseQuickRange(restored.toolbarQuickPreset).to - parseQuickRange(restored.toolbarQuickPreset).from
        : null;
      const span = presetSpan ?? Math.max(60_000, restored.visibleRange.to - restored.visibleRange.from);
      const right = Date.now();
      const nextRange: TrendVisibleRange = {
        from: right - span,
        to: right,
      };
      return {
        ...restored,
        settings: restoredSettings,
        manualAxes: normalizedRestoredAxes,
        defaultsSignature: objectDefaultsSignature,
        visibleRange: nextRange,
        customFrom: toLocalDateTimeInputValue(nextRange.from),
        customTo: toLocalDateTimeInputValue(nextRange.to),
      };
    }
    const restoredVisibleRange = restored.toolbarQuickPreset
      ? parseQuickRange(restored.toolbarQuickPreset)
      : restored.visibleRange;
    return {
      ...restored,
      settings: restoredSettings,
      manualAxes: normalizedRestoredAxes,
      defaultsSignature: objectDefaultsSignature,
      visibleRange: restoredVisibleRange,
      customFrom: toLocalDateTimeInputValue(restoredVisibleRange.from),
      customTo: toLocalDateTimeInputValue(restoredVisibleRange.to),
    };
  }
  return {
    rangePreset: objectRange.preset,
    visibleRange: objectRange.range,
    liveMode: Boolean(object.liveMode),
    customFrom: toLocalDateTimeInputValue(objectRange.range.from),
    customTo: toLocalDateTimeInputValue(objectRange.range.to),
    settings: resolvedSettings,
    selectedTags: object.selectedTags ?? [],
    manualAxes: normalizedAxes,
    tagPickerFilters: DEFAULT_TAG_PICKER_FILTERS,
    seriesColumnWidths: DEFAULT_SERIES_COLUMN_WIDTHS,
    seriesTableCollapsed: false,
    defaultsSignature: objectDefaultsSignature,
    toolbarQuickPreset: objectRange.preset === "5m" || objectRange.preset === "15m" || objectRange.preset === "1h"
      ? objectRange.preset
      : null,
  };
}

export function TrendRuntimeWidget({ object, userRoleLevel = 0 }: TrendRuntimeWidgetProps) {
  const objectDefaultsSignature = useMemo(() => buildObjectDefaultsSignature(object), [object]);
  const initialViewState = useMemo(() => resolveInitialRuntimeViewState(object), [object.id, objectDefaultsSignature]);
  const [allTags, setAllTags] = useState<TrendTagInfo[]>([]);
  const [selectedTags, setSelectedTags] = useState<TrendTagSelection[]>(initialViewState.selectedTags ?? object.selectedTags ?? []);
  const [manualAxes, setManualAxes] = useState<TrendAxisConfig[]>(
    initialViewState.manualAxes ?? normalizeTrendAxes(object.axes ?? [], initialViewState.settings ?? resolveSettingsFromObject(object)),
  );
  const [tagPickerFilters, setTagPickerFilters] = useState<TrendTagPickerFilters>(initialViewState.tagPickerFilters ?? DEFAULT_TAG_PICKER_FILTERS);
  const [settings, setSettings] = useState<TrendSettings>(() => initialViewState.settings ?? resolveSettingsFromObject(object));
  const [offlineResponse, setOfflineResponse] = useState<TrendQueryResponse | null>(null);
  const [offlineLoadedRange, setOfflineLoadedRange] = useState<TrendVisibleRange | null>(null);
  const [liveResponse, setLiveResponse] = useState<TrendQueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState(initialViewState.liveMode);
  const [liveFollow, setLiveFollow] = useState(initialViewState.liveMode);
  const [offlineLoadState, setOfflineLoadState] = useState<OfflineLoadState>("idle");
  const [lastLoadAt, setLastLoadAt] = useState<number | undefined>(undefined);
  const [statusAggregation, setStatusAggregation] = useState<TrendQueryResponse["aggregation"]>("raw");
  const [rangePreset, setRangePreset] = useState<TrendRangePreset>(initialViewState.rangePreset);
  const [visibleRange, setVisibleRange] = useState<TrendVisibleRange>(initialViewState.visibleRange);
  const [customFrom, setCustomFrom] = useState(initialViewState.customFrom);
  const [customTo, setCustomTo] = useState(initialViewState.customTo);
  const [toolbarQuickPreset, setToolbarQuickPreset] = useState<TrendRangePreset | null>(
    initialViewState.toolbarQuickPreset !== undefined
      ? initialViewState.toolbarQuickPreset
      : initialViewState.rangePreset === "5m" || initialViewState.rangePreset === "15m" || initialViewState.rangePreset === "1h"
        ? initialViewState.rangePreset
        : null
  );
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"appearance" | "performance" | "axes" | "series" | "table" | "toolbar">("appearance");
  const [contextMenu, setContextMenu] = useState<TrendContextMenuState | null>(null);
  const [liveSocketState, setLiveSocketState] = useState<LiveSocketState>("idle");
  const [liveBatchCount, setLiveBatchCount] = useState(0);
  const [livePointCount, setLivePointCount] = useState(0);
  const [liveLastBatchAt, setLiveLastBatchAt] = useState<number | null>(null);
  const [liveLastPointTs, setLiveLastPointTs] = useState<number | null>(null);
  const [liveAutoStopReason, setLiveAutoStopReason] = useState<string | null>(null);
  const [liveHistoryState, setLiveHistoryState] = useState<LiveHistoryState>("idle");
  const [liveHistoryPointCount, setLiveHistoryPointCount] = useState(0);
  const [liveBootstrapReady, setLiveBootstrapReady] = useState(false);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [screenRevision, setScreenRevision] = useState(0);
  const [seriesLatestValues, setSeriesLatestValues] = useState<Record<string, string>>({});
  const [hoverSeriesValues, setHoverSeriesValues] = useState<Record<string, string> | null>(null);
  const [hoverTimestamp, setHoverTimestamp] = useState<number | null>(null);
  const [seriesColumnWidths, setSeriesColumnWidths] = useState<TrendSeriesColumnWidths>(initialViewState.seriesColumnWidths ?? DEFAULT_SERIES_COLUMN_WIDTHS);
  const [seriesTableCollapsed, setSeriesTableCollapsed] = useState(Boolean(initialViewState.seriesTableCollapsed));
  const [timeRangeDialogOpen, setTimeRangeDialogOpen] = useState(false);
  const [timeRangeDraftFrom, setTimeRangeDraftFrom] = useState(initialViewState.customFrom);
  const [timeRangeDraftTo, setTimeRangeDraftTo] = useState(initialViewState.customTo);
  const [connectionState, setConnectionState] = useState<ConnectionState>(() => getConnectionSnapshot().state);
  const mode: TrendMode = liveMode ? "live" : "offline";
  const liveDataSource: TrendLiveDataSource = settings.liveDataSource === "realtimeAppend" ? "realtimeAppend" : DEFAULT_LIVE_DATA_SOURCE;
  const chartLiveMode = liveMode && liveDataSource === "realtimeAppend";
  const chartResponse = mode === "live" ? liveResponse : offlineResponse;
  const liveRetentionMs = resolveLiveRetentionMs();

  const requestIdRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestTargetModeRef = useRef<TrendMode | null>(null);
  const trendQueryRateLimiterRef = useRef(new TrendQueryRateLimiter<ExecuteQueryResult>(MIN_TRENDS_QUERY_INTERVAL_MS));
  const trendQueryInFlightCountRef = useRef(0);
  const trendQueryLastStartedAtRef = useRef<number | null>(null);
  const trendQueryStartedAtRef = useRef<number[]>([]);
  const onlineRecoveryTimerRef = useRef<number | null>(null);
  const cacheRef = useRef(new TrendQueryCache(settings.maxCachedRanges, resolveTrendCachePointLimit(settings.maxCachedRanges)));
  const chartApiRef = useRef<TrendChartApi | null>(null);
  const liveBufferRef = useRef<LiveIncomingPoint[]>([]);
  const liveBootstrapBufferRef = useRef<LiveIncomingPoint[]>([]);
  const liveBootstrapRangeRef = useRef<TrendVisibleRange | null>(null);
  const liveBootstrapReadyRef = useRef(liveBootstrapReady);
  const liveFirstWsPointLoggedRef = useRef(false);
  const livePendingBufferCapRef = useRef(resolveLivePendingBufferCap(selectedTags.length, settings.maxLivePointsPerTag));
  const sourcePointCountRef = useRef(0);
  const liveLatestByTagRef = useRef<Map<string, { value: number | boolean | string | null; quality?: string; sourceTs: number; lastIncomingAt: number }>>(new Map());
  const liveSocketRef = useRef<ReturnType<typeof createRuntimeSocket> | null>(null);
  const liveSocketStateRef = useRef<LiveSocketState>(liveSocketState);
  const liveModeRef = useRef(liveMode);
  const previousLiveModeForCleanupRef = useRef(liveMode);
  const liveFollowRef = useRef(liveFollow);
  const liveSessionIdRef = useRef(0);
  const liveHistoryLoadedToRef = useRef<number | null>(null);
  const liveHistorySnapshotRef = useRef<TrendQueryResponse | null>(null);
  const liveRealtimeEnabledSessionIdRef = useRef<number | null>(null);
  const liveRealtimeReceivedSinceLastLogRef = useRef(0);
  const liveRealtimeAppendedSinceLastLogRef = useRef(0);
  const liveLastTimestampByTagRef = useRef<Map<string, number>>(new Map());
  const historyLoadTimerRef = useRef<number | null>(null);
  const offlineLoadedRangeRef = useRef<TrendVisibleRange | null>(null);
  const offlineResponseRef = useRef<TrendQueryResponse | null>(null);
  const offlineFrozenRangeRef = useRef<TrendVisibleRange | null>(null);
  const offlineLoadSeqRef = useRef(0);
  const liveResponseRef = useRef<TrendQueryResponse | null>(null);
  const bufferedRequestKeyRef = useRef<string | null>(null);
  const toolbarRangeRef = useRef<{ preset: TrendRangePreset; range: TrendVisibleRange; expiresAt: number } | null>(null);
  const pendingToolbarPresetRef = useRef<Exclude<TrendRangePreset, "custom"> | null>(null);
  const viewStateSaveTimerRef = useRef<number | null>(null);
  const visibleRangeRef = useRef<TrendVisibleRange>(initialViewState.visibleRange);
  const liveFollowWindowMsRef = useRef(Math.max(60_000, initialViewState.visibleRange.to - initialViewState.visibleRange.from));
  const lastStableVisibleRangeRef = useRef<TrendVisibleRange>(initialViewState.visibleRange);
  const hoverSnapshotKeyRef = useRef<string>("");
  const hoverTimestampRef = useRef<number | null>(null);
  const lastConnectionStateRef = useRef<ConnectionState>(connectionState);
  const columnResizeStateRef = useRef<{ id: TrendSeriesColumnId | null; startX: number; startWidth: number }>({
    id: null,
    startX: 0,
    startWidth: 0,
  });

  const invalidateOfflineLoadState = useCallback((nextState: OfflineLoadState = "idle") => {
    offlineLoadSeqRef.current += 1;
    setOfflineLoadState(nextState);
  }, []);

  const buildWidgetDiagnostics = () => {
    const runtimeDiagnostics = getRuntimeDiagnosticsSnapshot();
    const cacheStats = cacheRef.current.getStats();
    const offlineBufferedPointCount = countTrendResponsePoints(offlineResponseRef.current);
    const liveBufferedPointCount = countTrendResponsePoints(liveResponseRef.current);
    const livePendingPointCount = liveBufferRef.current.length;
    const liveBootstrapPendingPointCount = liveBootstrapBufferRef.current.length;
    const echartsBufferedPointCount = chartApiRef.current?.getPointCount() ?? 0;
    const echartsRenderedPointCount = chartApiRef.current?.getRenderedPointCount?.() ?? echartsBufferedPointCount;
    return {
      objectId: object.id,
      activeLoopCount: runtimeDiagnostics.activePollingLoopIds
        .filter((loopId) => loopId.endsWith(`:${object.id}`)).length,
      lastQueryTime: trendQueryLastStartedAtRef.current,
      queryCountPerMinute: trendQueryStartedAtRef.current.length,
      inFlightQueryCount: trendQueryInFlightCountRef.current,
      pointsInState: offlineBufferedPointCount + liveBufferedPointCount + livePendingPointCount + liveBootstrapPendingPointCount,
      pointsInChart: echartsBufferedPointCount,
      offlineBufferedPointCount,
      liveBufferedPointCount,
      cachePointCount: cacheStats.pointCount,
      cacheEntryCount: cacheStats.entryCount,
      echartsRenderedPointCount,
      livePendingPointCount,
      liveBootstrapPendingPointCount,
    };
  };

  const resolveLatestLiveRightEdge = (): number => {
    const liveBounds = getSeriesBounds(liveResponseRef.current?.series ?? []);
    if (liveBounds.lastTs !== null) {
      return liveBounds.lastTs;
    }
    if (liveLastPointTs !== null && Number.isFinite(liveLastPointTs)) {
      return liveLastPointTs;
    }
    let latestByTag = Number.NEGATIVE_INFINITY;
    for (const timestamp of liveLastTimestampByTagRef.current.values()) {
      if (Number.isFinite(timestamp)) {
        latestByTag = Math.max(latestByTag, timestamp);
      }
    }
    return Number.isFinite(latestByTag) ? latestByTag : Date.now();
  };

  const tagInfoMap = useMemo(() => new Map(allTags.map((tag) => [tag.name, tag])), [allTags]);

  const { axes, resolvedAxisIdByTag } = useMemo(
    () => buildAxes(selectedTags, tagInfoMap, settings, manualAxes),
    [manualAxes, selectedTags, settings, tagInfoMap],
  );
  const axisLabelById = useMemo(
    () => new Map(axes.map((axis) => [axis.id, axis.name?.trim() || axis.id])),
    [axes],
  );

  const visibleSpanMs = Math.max(60_000, visibleRange.to - visibleRange.from);
  const liveWindowMs = liveFollow ? visibleSpanMs : liveFollowWindowMsRef.current;
  const livePollingIntervalMs = useMemo(() => resolveLivePollingIntervalMs(liveWindowMs), [liveWindowMs]);
  const liveResyncIntervalMs = useMemo(() => resolveLiveResyncIntervalMs(settings.liveResyncIntervalSec), [settings.liveResyncIntervalSec]);
  const realtimeAppendFlushMs = useMemo(
    () => clamp(Math.round(settings.realtimeAppendFlushMs), LIVE_REALTIME_FLUSH_MIN_MS, LIVE_REALTIME_FLUSH_MAX_MS),
    [settings.realtimeAppendFlushMs],
  );

  const pointCount = useMemo(
    () => chartResponse?.series.reduce((acc, series) => acc + series.points.length, 0) ?? 0,
    [chartResponse],
  );
  const renderResponse = useMemo(() => {
    if (!chartResponse) {
      return chartResponse;
    }
    if (mode === "offline") {
      return chartResponse;
    }
    const maxVisiblePoints = clamp(
      Math.round(settings.maxVisiblePointsPerSeries ?? settings.maxPointsPerSeries),
      1000,
      8000,
    );
    const series = chartResponse.series.map((item) => ({
      ...item,
      points: decimateTrendPoints(item.points, maxVisiblePoints),
    }));
    return {
      ...chartResponse,
      series,
    };
  }, [chartResponse, mode, settings.maxPointsPerSeries, settings.maxVisiblePointsPerSeries]);

  useEffect(() => {
    liveSocketStateRef.current = liveSocketState;
  }, [liveSocketState]);
  useEffect(() => {
    liveModeRef.current = liveMode;
  }, [liveMode]);

  useEffect(() => {
    liveFollowRef.current = liveFollow;
  }, [liveFollow]);
  const selectedTagNames = useMemo(() => selectedTags.map((tag) => tag.tag), [selectedTags]);
  const selectedTagNamesKey = useMemo(() => selectedTagNames.join("|"), [selectedTagNames]);
  const selectedTagsRef = useRef<TrendTagSelection[]>(selectedTags);
  const selectedTagNamesRef = useRef<string[]>(selectedTagNames);
  const runtimeSettingsButtonVisible = object.showRuntimeSettingsButton !== false;
  const runtimeSettingsAllowed = object.allowRuntimeSettings !== false;
  const runtimeSettingsRoleAllowed = hasRoleAccess(userRoleLevel, object.runtimeSettingsRequiredRole);
  const canOpenRuntimeSettings = runtimeSettingsButtonVisible && runtimeSettingsAllowed && runtimeSettingsRoleAllowed;
  const canShowSettingsEntry = settings.showToolbarSettingsButton && runtimeSettingsButtonVisible;
  const canShowScaleEntry = settings.showToolbarScaleButton && runtimeSettingsButtonVisible;

  useEffect(() => {
    livePendingBufferCapRef.current = resolveLivePendingBufferCap(selectedTagNames.length, settings.maxLivePointsPerTag);
  }, [selectedTagNames.length, settings.maxLivePointsPerTag]);

  useEffect(() => {
    selectedTagsRef.current = selectedTags;
    selectedTagNamesRef.current = selectedTagNames;
  }, [selectedTagNamesKey, selectedTags]);

  useEffect(() => {
    sourcePointCountRef.current = pointCount;
  }, [pointCount]);

  useEffect(() => {
    liveBootstrapReadyRef.current = liveBootstrapReady;
  }, [liveBootstrapReady]);

  useEffect(() => subscribeConnectionState((snapshot) => {
    setConnectionState(snapshot.state);
  }), []);

  useEffect(() => {
    const previous = lastConnectionStateRef.current;
    lastConnectionStateRef.current = connectionState;
    if (previous === connectionState || connectionState !== "online") {
      return;
    }
    if (selectedTagNames.length === 0) {
      return;
    }
    if (onlineRecoveryTimerRef.current !== null) {
      window.clearTimeout(onlineRecoveryTimerRef.current);
    }
    onlineRecoveryTimerRef.current = window.setTimeout(() => {
      onlineRecoveryTimerRef.current = null;
      setScreenRevision((value) => value + 1);
    }, ONLINE_RECOVERY_REFRESH_DEBOUNCE_MS);
  }, [connectionState, selectedTagNames.length]);

  useEffect(() => {
    const diagnostics = buildWidgetDiagnostics();
    setRuntimeDiagnosticMetric("trendPointsInMemory", diagnostics.pointsInState + diagnostics.cachePointCount);
    setRuntimeDiagnosticMetric("cachedTrendRanges", diagnostics.cacheEntryCount);
  }, [pointCount, screenRevision, settings.maxCachedRanges]);

  useEffect(() => {
    const now = Date.now();
    trendQueryStartedAtRef.current = trendQueryStartedAtRef.current.filter((item) => now - item < 60_000);
    setTrendWidgetDiagnostics(object.id, buildWidgetDiagnostics());
  }, [liveDataSource, liveMode, object.id, pointCount, screenRevision, selectedTagNamesKey, settings.maxCachedRanges]);

  useEffect(() => {
    const selectedSet = new Set(selectedTagNames);
    for (const tagName of [...liveLatestByTagRef.current.keys()]) {
      if (!selectedSet.has(tagName)) {
        liveLatestByTagRef.current.delete(tagName);
      }
    }
    for (const tagName of [...liveLastTimestampByTagRef.current.keys()]) {
      if (!selectedSet.has(tagName)) {
        liveLastTimestampByTagRef.current.delete(tagName);
      }
    }
    setSeriesLatestValues((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [tagName, value] of Object.entries(prev)) {
        if (selectedSet.has(tagName)) {
          next[tagName] = value;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectedTagNamesKey]);

  useEffect(() => {
    const nextViewState = resolveInitialRuntimeViewState(object);
    logTrendDiagnostics("widget:init", {
      objectId: object.id,
      restoredRangePreset: nextViewState.rangePreset,
      restoredLiveMode: nextViewState.liveMode,
      restoredTags: nextViewState.selectedTags.length,
    });
    setOfflineResponse(null);
    setOfflineLoadedRange(null);
    invalidateOfflineLoadState();
    offlineLoadedRangeRef.current = null;
    offlineResponseRef.current = null;
    offlineFrozenRangeRef.current = null;
    bufferedRequestKeyRef.current = null;
    setLiveResponse(null);
    liveResponseRef.current = null;
    setError(null);
    setLastLoadAt(undefined);
    setSelectedTags(nextViewState.selectedTags ?? object.selectedTags ?? []);
    setManualAxes(nextViewState.manualAxes ?? normalizeTrendAxes(object.axes ?? [], nextViewState.settings ?? resolveSettingsFromObject(object)));
    setTagPickerFilters(nextViewState.tagPickerFilters ?? DEFAULT_TAG_PICKER_FILTERS);
    setSettings(nextViewState.settings ?? resolveSettingsFromObject(object));
    setLiveMode(nextViewState.liveMode);
    liveFollowRef.current = nextViewState.liveMode;
    setLiveFollow(nextViewState.liveMode);
    setToolbarQuickPreset(nextViewState.toolbarQuickPreset ?? null);
    setRangePreset(nextViewState.rangePreset);
    setVisibleRange(nextViewState.visibleRange);
    liveFollowWindowMsRef.current = Math.max(60_000, nextViewState.visibleRange.to - nextViewState.visibleRange.from);
    lastStableVisibleRangeRef.current = nextViewState.visibleRange;
    setCustomFrom(nextViewState.customFrom);
    setCustomTo(nextViewState.customTo);
    setTimeRangeDraftFrom(nextViewState.customFrom);
    setTimeRangeDraftTo(nextViewState.customTo);
    setSeriesColumnWidths(nextViewState.seriesColumnWidths ?? DEFAULT_SERIES_COLUMN_WIDTHS);
    setSeriesTableCollapsed(Boolean(nextViewState.seriesTableCollapsed));
    setSettingsInitialTab("appearance");
    setSeriesLatestValues({});
    liveBufferRef.current = [];
    liveBootstrapBufferRef.current = [];
    liveBootstrapRangeRef.current = null;
    liveFirstWsPointLoggedRef.current = false;
    liveLatestByTagRef.current.clear();
    liveHistoryLoadedToRef.current = null;
    liveHistorySnapshotRef.current = null;
    liveRealtimeEnabledSessionIdRef.current = null;
    liveRealtimeReceivedSinceLastLogRef.current = 0;
    liveRealtimeAppendedSinceLastLogRef.current = 0;
    liveLastTimestampByTagRef.current.clear();
    liveSessionIdRef.current += 1;
    offlineFrozenRangeRef.current = null;
    setHoverSeriesValues(null);
    setHoverTimestamp(null);
    hoverSnapshotKeyRef.current = "";
    hoverTimestampRef.current = null;
    setHistoryWarning(null);
    setScreenRevision((prev) => prev + 1);
  }, [invalidateOfflineLoadState, object.id, objectDefaultsSignature]);

  const persistRuntimeViewState = useCallback((rangeForStorage: TrendVisibleRange) => {
    writeRuntimeViewState({
      objectId: object.id,
      state: {
        rangePreset,
        visibleRange: rangeForStorage,
        liveMode,
        customFrom,
        customTo,
        settings,
        selectedTags,
        manualAxes,
        tagPickerFilters,
        seriesColumnWidths,
        seriesTableCollapsed,
        toolbarQuickPreset: (toolbarQuickPreset === "5m" || toolbarQuickPreset === "15m" || toolbarQuickPreset === "1h" ? toolbarQuickPreset : null) as TrendQuickPreset | null,
        defaultsSignature: objectDefaultsSignature,
      },
    });
  }, [customFrom, customTo, liveMode, manualAxes, object.id, objectDefaultsSignature, rangePreset, selectedTags, seriesColumnWidths, seriesTableCollapsed, settings, tagPickerFilters, toolbarQuickPreset]);

  useEffect(() => {
    visibleRangeRef.current = visibleRange;
  }, [visibleRange.from, visibleRange.to]);

  useEffect(() => {
    offlineLoadedRangeRef.current = offlineLoadedRange;
  }, [offlineLoadedRange?.from, offlineLoadedRange?.to]);

  useEffect(() => {
    offlineResponseRef.current = offlineResponse;
  }, [offlineResponse]);

  useEffect(() => {
    liveResponseRef.current = liveResponse;
  }, [liveResponse]);

  useEffect(() => {
    if (!liveMode) {
      lastStableVisibleRangeRef.current = visibleRange;
    }
  }, [liveMode, visibleRange.from, visibleRange.to]);

  useEffect(() => {
    persistRuntimeViewState(liveMode ? lastStableVisibleRangeRef.current : visibleRange);
  }, [liveMode, persistRuntimeViewState]);

  useEffect(() => {
    if (liveMode) {
      if (viewStateSaveTimerRef.current) {
        window.clearTimeout(viewStateSaveTimerRef.current);
        viewStateSaveTimerRef.current = null;
      }
      return;
    }
    if (viewStateSaveTimerRef.current) {
      window.clearTimeout(viewStateSaveTimerRef.current);
    }
    viewStateSaveTimerRef.current = window.setTimeout(() => {
      persistRuntimeViewState(visibleRange);
      viewStateSaveTimerRef.current = null;
    }, RUNTIME_VIEW_STATE_SAVE_DEBOUNCE_MS);
    return () => {
      if (viewStateSaveTimerRef.current) {
        window.clearTimeout(viewStateSaveTimerRef.current);
        viewStateSaveTimerRef.current = null;
      }
    };
  }, [liveMode, persistRuntimeViewState, visibleRange.from, visibleRange.to]);

  const computeLiveBootstrapRange = useCallback((baseRange: TrendVisibleRange): TrendVisibleRange => {
    const span = Math.max(60_000, baseRange.to - baseRange.from);
    const right = Date.now();
    return {
      from: right - span,
      to: right,
    };
  }, []);

  const drainLiveBootstrapPointsForMerge = useCallback((
    minTimestamp: number,
    historyLoadedTo: number,
    mergeUpperTimestamp: number,
    sessionId: number,
  ): LiveIncomingPoint[] => {
    const combined = [...liveBootstrapBufferRef.current, ...liveBufferRef.current];
    if (combined.length === 0) {
      return combined;
    }
    const byKey = new Map<string, LiveIncomingPoint>();
    const deferred: LiveIncomingPoint[] = [];
    for (const item of combined) {
      if (
        item.sessionId !== sessionId
      ) {
        continue;
      }
      if (!Number.isFinite(item.timestamp)) {
        continue;
      }
      if (item.timestamp > mergeUpperTimestamp) {
        deferred.push(item);
        continue;
      }
      if (item.timestamp < minTimestamp || item.timestamp <= historyLoadedTo) {
        continue;
      }
      byKey.set(`${item.tag}|${item.timestamp}`, item);
    }
    liveBootstrapBufferRef.current = [];
    liveBufferRef.current = deferred;
    return [...byKey.values()].sort((a, b) => a.timestamp - b.timestamp);
  }, []);

  const buildRetainedLiveResponse = useCallback((
    nextResponse: TrendQueryResponse,
    range: TrendVisibleRange,
    options?: { mergeWithPrevious?: boolean },
  ): TrendQueryResponse => {
    const bounds = getSeriesBounds(nextResponse.series);
    const right = Math.max(
      range.to,
      bounds.lastTs ?? Number.NEGATIVE_INFINITY,
    );
    const retentionRange = {
      from: right - liveRetentionMs,
      to: right,
    };
    const base = options?.mergeWithPrevious ? liveResponseRef.current : null;
    const selectedForDisplay = selectedTagsRef.current;
    const perSeriesLimit = resolveLiveBufferedPointLimitPerSeries(settings.maxLivePointsPerTag, selectedForDisplay.length);
    const bounded = boundResponseSeriesPoints(
      buildBufferedTrendResponse(base, nextResponse, retentionRange, selectedForDisplay, { carryForwardToRangeEnd: false }),
      perSeriesLimit,
      { minLimit: 1, maxLimit: 20_000 },
    );
    const rawPointCount = countTrendResponsePoints(nextResponse) + (base ? countTrendResponsePoints(base) : 0);
    const retainedPointCount = countTrendResponsePoints(bounded);
    if (rawPointCount > retainedPointCount) {
      logTrendDiagnostics("trend:memory-trim-live", {
        rawPointCount,
        retainedPointCount,
        trimmedPointCount: rawPointCount - retainedPointCount,
        liveRetentionMs,
        perSeriesLimit,
        totalPointCap: MAX_LIVE_BUFFER_POINTS_TOTAL,
        mergeWithPrevious: options?.mergeWithPrevious === true,
      });
    }
    return bounded;
  }, [liveRetentionMs, selectedTagNamesKey, settings.maxLivePointsPerTag]);

  const executeQuery = useCallback(async (
    range: TrendVisibleRange,
    options?: {
      force?: boolean;
      mode?: "history" | "liveBootstrap";
      context?: "auto" | "live" | "history";
      targetMode?: TrendMode;
      liveSessionId?: number;
      skipLoadingState?: boolean;
      skipLiveLoadingState?: boolean;
      skipRateLimit?: boolean;
      mergeWithExisting?: boolean;
    },
  ): Promise<ExecuteQueryResult> => {
    const tagNames = selectedTagNamesRef.current;
    const selectedForDisplay = selectedTagsRef.current;
    if (tagNames.length === 0) {
      setOfflineResponse(null);
      setOfflineLoadedRange(null);
      invalidateOfflineLoadState();
      offlineLoadedRangeRef.current = null;
      offlineResponseRef.current = null;
      offlineFrozenRangeRef.current = null;
      setLiveResponse(null);
      liveResponseRef.current = null;
      return { ok: false, reason: "error" };
    }
    if (tagNames.length > TOO_MANY_TAGS_LIMIT) {
      setError(`Too many tags selected (${tagNames.length}). Limit is ${TOO_MANY_TAGS_LIMIT}.`);
      return { ok: false, reason: "error" };
    }
    if (range.to <= range.from) {
      setError("Invalid range");
      return { ok: false, reason: "error" };
    }

    const mode = options?.mode ?? "history";
    const isLiveBootstrapQuery = mode === "liveBootstrap";
    const queryContext = options?.context ?? "auto";
    const isLiveQuery = isLiveBootstrapQuery || queryContext === "live" || (queryContext === "auto" && liveModeRef.current);
    const targetMode = options?.targetMode ?? (isLiveQuery ? "live" : "offline");
    const isArchivePollingLiveQuery = targetMode === "live" && liveDataSource === "archivePolling";
    const isRealtimeAppendLiveSnapshot = targetMode === "live" && liveDataSource === "realtimeAppend" && isLiveBootstrapQuery;
    const effectiveMaxPointsSetting = isArchivePollingLiveQuery
      ? LIVE_ARCHIVE_POLL_MAX_POINTS
      : isRealtimeAppendLiveSnapshot
        ? settings.realtimeAppendSnapshotMaxPoints
        : isLiveQuery
        ? 8000
        : TREND_BUFFER_QUERY_MAX_POINTS;
    const maxPoints = clamp(Math.round(effectiveMaxPointsSetting), 1000, 8000);
    const requestAggregation = isLiveBootstrapQuery
      ? settings.realtimeAppendSnapshotAggregation
      : settings.aggregation;
    const liveSessionId = options?.liveSessionId ?? liveSessionIdRef.current;
    const key = buildTrendCacheKey({
      tags: tagNames,
      from: range.from,
      to: range.to,
      maxPoints,
      aggregation: requestAggregation,
    });
    logTrendDiagnostics("query:start", {
      mode,
      liveMode,
      liveFollow: liveFollowRef.current,
      liveRetentionMs,
      aggregation: requestAggregation,
      tagCount: tagNames.length,
      rangeFrom: range.from,
      rangeTo: range.to,
      maxPoints,
      effectiveMaxPoints: maxPoints,
      pointCount: null,
      cacheEnabled: settings.cacheEnabled,
      snapshotAggregationPolicy: settings.realtimeAppendSnapshotAggregation,
      snapshotMaxPointsPolicy: settings.realtimeAppendSnapshotMaxPoints,
      flushMsPolicy: realtimeAppendFlushMs,
    });
    if (isLiveQuery && requestAggregation === "raw") {
      logTrendDiagnostics("query:live-raw-requested", {
        mode,
        rangeFrom: range.from,
        rangeTo: range.to,
        maxPoints,
      });
    }

    if (!options?.force && settings.cacheEnabled) {
      const cached = cacheRef.current.get(key);
      if (cached) {
        logTrendDiagnostics("query:cache-hit", {
          aggregation: cached.aggregation,
          seriesCount: cached.series.length,
          cache: cacheRef.current.getStats(),
        });
        const normalizedCached = normalizeTrendResponseForRange(cached, range, selectedForDisplay, {
          carryForwardToRangeEnd: targetMode !== "live",
        });
        const targetPointLimit = targetMode === "live"
          ? resolveLiveBufferedPointLimitPerSeries(settings.maxLivePointsPerTag, selectedForDisplay.length)
          : TREND_BUFFER_POINTS_PER_SERIES_MAX;
        const boundedCached = boundResponseSeriesPoints(
          normalizedCached,
          targetPointLimit,
          targetMode === "live" ? { minLimit: 1, maxLimit: 20_000 } : undefined,
        );
        if (targetMode === "live") {
          if (!liveModeRef.current || liveSessionId !== liveSessionIdRef.current) {
            return { ok: false, reason: "aborted" };
          }
          const nextLiveResponse = liveDataSource === "archivePolling"
            ? buildRetainedLiveResponse(boundedCached, range, { mergeWithPrevious: !liveFollowRef.current })
            : boundedCached;
          liveResponseRef.current = nextLiveResponse;
          setLiveResponse(nextLiveResponse);
          if (pendingToolbarPresetRef.current) {
            setToolbarQuickPreset(pendingToolbarPresetRef.current);
            pendingToolbarPresetRef.current = null;
          }
          const cachedPointCount = nextLiveResponse.series.reduce((acc, series) => acc + series.points.length, 0);
          setLiveHistoryPointCount(cachedPointCount);
          setLiveHistoryState(cachedPointCount > 0 ? "loaded" : "empty");
          let cachedLatestTs = Number.NEGATIVE_INFINITY;
          for (const series of nextLiveResponse.series) {
            const tail = series.points[series.points.length - 1];
            if (tail && Number.isFinite(tail.t)) {
              cachedLatestTs = Math.max(cachedLatestTs, tail.t);
              liveLastTimestampByTagRef.current.set(series.tag, tail.t);
            }
          }
          liveHistoryLoadedToRef.current = Number.isFinite(cachedLatestTs) ? Math.max(range.to, cachedLatestTs) : range.to;
        } else {
          const targetLoadedRange = options?.mergeWithExisting
            ? unionTrendRanges(offlineLoadedRangeRef.current, range)
            : range;
          if (options?.mergeWithExisting) {
            const mergedCachedRaw = boundResponseSeriesPoints(
              buildBufferedTrendResponse(offlineResponseRef.current, boundedCached, targetLoadedRange, selectedForDisplay),
              TREND_BUFFER_POINTS_PER_SERIES_MAX,
            );
            const limited = limitOfflineTrendResponse(mergedCachedRaw, targetLoadedRange, visibleRangeRef.current);
            if (limited.trimmedPointCount > 0) {
              logTrendDiagnostics("trend:memory-trim-offline", {
                trimmedPointCount: limited.trimmedPointCount,
                loadedRange: targetLoadedRange,
                retainedRange: limited.loadedRange,
                visibleRange: visibleRangeRef.current,
                pointCount: countTrendResponsePoints(limited.response),
                maxPointsPerSeries: MAX_OFFLINE_BUFFER_POINTS_PER_SERIES,
                maxTotalPoints: MAX_OFFLINE_BUFFER_POINTS_TOTAL,
                maxTimeSpanMs: MAX_OFFLINE_BUFFER_TIME_SPAN_MS,
              });
            }
            offlineLoadedRangeRef.current = limited.loadedRange;
            setOfflineLoadedRange(limited.loadedRange);
            offlineResponseRef.current = limited.response;
            setOfflineResponse(limited.response);
          } else {
            const limited = limitOfflineTrendResponse(boundedCached, targetLoadedRange, visibleRangeRef.current);
            if (limited.trimmedPointCount > 0) {
              logTrendDiagnostics("trend:memory-trim-offline", {
                trimmedPointCount: limited.trimmedPointCount,
                loadedRange: targetLoadedRange,
                retainedRange: limited.loadedRange,
                visibleRange: visibleRangeRef.current,
                pointCount: countTrendResponsePoints(limited.response),
                maxPointsPerSeries: MAX_OFFLINE_BUFFER_POINTS_PER_SERIES,
                maxTotalPoints: MAX_OFFLINE_BUFFER_POINTS_TOTAL,
                maxTimeSpanMs: MAX_OFFLINE_BUFFER_TIME_SPAN_MS,
              });
            }
            offlineLoadedRangeRef.current = limited.loadedRange;
            setOfflineLoadedRange(limited.loadedRange);
            offlineResponseRef.current = limited.response;
            setOfflineResponse(limited.response);
          }
          if (pendingToolbarPresetRef.current) {
            setToolbarQuickPreset(pendingToolbarPresetRef.current);
            pendingToolbarPresetRef.current = null;
          }
        }
        setStatusAggregation(boundedCached.aggregation);
        setLastLoadAt(Date.now());
        return { ok: true, response: targetMode === "live" ? (liveResponseRef.current ?? boundedCached) : boundedCached };
      }
    }

    if (!options?.skipRateLimit) {
      return trendQueryRateLimiterRef.current.schedule(() => executeQuery(range, {
        ...options,
        skipRateLimit: true,
      }));
    }

    const ownsGlobalRequest = !options?.skipLoadingState;
    if (ownsGlobalRequest) {
      requestIdRef.current += 1;
      requestControllerRef.current?.abort();
    }
    const requestId = requestIdRef.current;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    requestTargetModeRef.current = targetMode;

    if (!options?.skipLoadingState) {
      setLoading(true);
    }
    setError(null);
    setHistoryWarning(null);
    if (isLiveQuery && !options?.skipLiveLoadingState) {
      setLiveHistoryState("loading");
      setLiveHistoryPointCount(0);
    }

    try {
      const queryStartedAt = Date.now();
      trendQueryLastStartedAtRef.current = queryStartedAt;
      trendQueryStartedAtRef.current = [...trendQueryStartedAtRef.current.filter((item) => queryStartedAt - item < 60_000), queryStartedAt];
      trendQueryInFlightCountRef.current += 1;
      setTrendWidgetDiagnostics(object.id, buildWidgetDiagnostics());
      let next = await queryTrendData({
        tags: tagNames,
        from: new Date(range.from).toISOString(),
        to: new Date(range.to).toISOString(),
        maxPoints,
        aggregation: requestAggregation,
      }, {
        signal: controller.signal,
        inFlightKey: `trendsQuery:${object.id}`,
      });
      if (ownsGlobalRequest && requestId !== requestIdRef.current) {
        return { ok: false, reason: "aborted" };
      }
      if (targetMode === "live" && liveSessionId !== liveSessionIdRef.current) {
        return { ok: false, reason: "aborted" };
      }
      logTrendDiagnostics("query:success", {
        mode,
        liveMode,
        liveFollow: liveFollowRef.current,
        liveRetentionMs,
        requestedAggregation: requestAggregation,
        aggregation: next.aggregation,
        maxPoints,
        effectiveMaxPoints: maxPoints,
        snapshotAggregationPolicy: settings.realtimeAppendSnapshotAggregation,
        snapshotMaxPointsPolicy: settings.realtimeAppendSnapshotMaxPoints,
        flushMsPolicy: realtimeAppendFlushMs,
        seriesCount: next.series.length,
        pointCount: next.series.reduce((acc, series) => acc + series.points.length, 0),
        firstSeries: next.series[0]?.tag,
        firstTs: next.series[0]?.points[0]?.t ?? null,
        lastTs: next.series[0]?.points[next.series[0]?.points.length - 1]?.t ?? null,
        cache: cacheRef.current.getStats(),
      });
      let latestTs = Number.NEGATIVE_INFINITY;
      if (isLiveQuery) {
        latestTs = next.series.reduce((maxTs, series) => {
          const tailTs = series.points[series.points.length - 1]?.t ?? Number.NEGATIVE_INFINITY;
          return Math.max(maxTs, tailTs);
        }, Number.NEGATIVE_INFINITY);
        const lagMs = Number.isFinite(latestTs) ? Date.now() - latestTs : Number.POSITIVE_INFINITY;
        if (lagMs > 45_000) {
          const tailFrom = Math.max(range.from, range.to - 10 * 60 * 1000);
          logTrendDiagnostics("query:tail-raw-start", {
            lagMs: Math.round(lagMs),
            tailFrom,
            tailTo: range.to,
          });
          logTrendDiagnostics("query:tail-raw-skipped-rate-limit", {
            reason: "single-query-per-widget-interval",
            minIntervalMs: MIN_TRENDS_QUERY_INTERVAL_MS,
            tailFrom,
            tailTo: range.to,
          });
          latestTs = next.series.reduce((maxTs, series) => {
            const tailTs = series.points[series.points.length - 1]?.t ?? Number.NEGATIVE_INFINITY;
            return Math.max(maxTs, tailTs);
          }, Number.NEGATIVE_INFINITY);
        }
      }
      if (isLiveQuery && next.aggregation !== "raw") {
        logTrendDiagnostics("query:live-non-raw-accepted", {
          mode,
          requestedAggregation: requestAggregation,
          returnedAggregation: next.aggregation,
          seriesCount: next.series.length,
        });
      }
      let liveBootstrapMergeUpperTs = range.to;
      if (isLiveBootstrapQuery) {
        liveBootstrapMergeUpperTs = Date.now();
        const bufferedLivePoints = drainLiveBootstrapPointsForMerge(range.from, range.to, liveBootstrapMergeUpperTs, liveSessionId);
        const historyBounds = getSeriesBounds(next.series);
        const liveOverlaySeries = buildLiveOverlaySeries(bufferedLivePoints, selectedForDisplay);
        const liveBounds = getSeriesBounds(liveOverlaySeries);
        if (liveOverlaySeries.length > 0) {
          next = {
            ...next,
            series: mergeTrendSeriesPoints(next.series, liveOverlaySeries),
          };
        }
        logTrendDiagnostics("live:bootstrap:merge", {
          historyFirstTs: historyBounds.firstTs,
          historyLastTs: historyBounds.lastTs,
          liveFirstTs: liveBounds.firstTs,
          liveLastTs: liveBounds.lastTs,
          mergedLivePointCount: bufferedLivePoints.length,
          mergedTagCount: liveOverlaySeries.length,
          mergeUpperTs: liveBootstrapMergeUpperTs,
        });
        if (historyBounds.lastTs !== null && liveBounds.firstTs !== null) {
          const gapMs = liveBounds.firstTs - historyBounds.lastTs;
          if (gapMs > 1_000) {
            logTrendDiagnostics("live:bootstrap:gap", {
              gapMs,
              historyLastTs: historyBounds.lastTs,
              liveFirstTs: liveBounds.firstTs,
            });
          }
        }
      }
      const normalizedRange = isLiveBootstrapQuery
        ? { from: range.from, to: Math.max(range.to, liveBootstrapMergeUpperTs) }
        : range;
      next = normalizeTrendResponseForRange(next, normalizedRange, selectedForDisplay, {
        carryForwardToRangeEnd: targetMode !== "live",
      });
      const targetPointLimit = targetMode === "live"
        ? resolveLiveBufferedPointLimitPerSeries(settings.maxLivePointsPerTag, selectedForDisplay.length)
        : TREND_BUFFER_POINTS_PER_SERIES_MAX;
      const boundedNext = boundResponseSeriesPoints(
        next,
        targetPointLimit,
        targetMode === "live" ? { minLimit: 1, maxLimit: 20_000 } : undefined,
      );
      const totalPointCount = boundedNext.series.reduce((acc, series) => acc + series.points.length, 0);
      if (isLiveBootstrapQuery) {
        const bounds = getSeriesBounds(boundedNext.series);
        logTrendDiagnostics("live:bootstrap:success", {
          rangeFrom: range.from,
          rangeTo: range.to,
          nowAtComplete: Date.now(),
          firstTs: bounds.firstTs,
          lastTs: bounds.lastTs,
          pointCount: totalPointCount,
          selectedTags: selectedForDisplay.length,
        });
        if (totalPointCount === 0) {
          logTrendDiagnostics("live:bootstrap:empty", {
            rangeFrom: range.from,
            rangeTo: range.to,
            selectedTags: selectedForDisplay.length,
          });
        }
      }
      if (isLiveQuery) {
        setLiveHistoryPointCount(totalPointCount);
        setLiveHistoryState(totalPointCount > 0 ? "loaded" : "empty");
        if (requestAggregation === "raw") {
          logTrendDiagnostics("query:live-raw-result", {
            mode,
            requestedAggregation: requestAggregation,
            returnedAggregation: next.aggregation,
            pointCount: totalPointCount,
          });
        }
      }
      if (settings.cacheEnabled && !isLiveBootstrapQuery) {
        const cacheResult = cacheRef.current.set(key, boundedNext);
        setRuntimeDiagnosticMetric("cachedTrendRanges", cacheResult.stats.entryCount);
        if (cacheResult.evictedEntryCount > 0 && cacheResult.limitReason) {
          logTrendDiagnostics("trend:cache-evict-memory-limit", {
            evictedEntryCount: cacheResult.evictedEntryCount,
            evictedPointCount: cacheResult.evictedPointCount,
            limitReason: cacheResult.limitReason,
            cache: cacheResult.stats,
          });
        }
      }
      if (targetMode === "live") {
        if (!liveModeRef.current || liveSessionId !== liveSessionIdRef.current) {
          return { ok: false, reason: "aborted" };
        }
        const nextLiveResponse = liveDataSource === "archivePolling"
          ? buildRetainedLiveResponse(boundedNext, normalizedRange, { mergeWithPrevious: !liveFollowRef.current })
          : boundedNext;
        liveResponseRef.current = nextLiveResponse;
        setLiveResponse(nextLiveResponse);
        if (liveDataSource === "archivePolling") {
          const retainedPointCount = nextLiveResponse.series.reduce((acc, series) => acc + series.points.length, 0);
          setLiveHistoryPointCount(retainedPointCount);
          setLiveHistoryState(retainedPointCount > 0 ? "loaded" : "empty");
        }
        if (pendingToolbarPresetRef.current) {
          setToolbarQuickPreset(pendingToolbarPresetRef.current);
          pendingToolbarPresetRef.current = null;
        }
      } else {
        const targetLoadedRange = options?.mergeWithExisting
          ? unionTrendRanges(offlineLoadedRangeRef.current, range)
          : range;
        if (options?.mergeWithExisting) {
          const mergedNextRaw = boundResponseSeriesPoints(
            buildBufferedTrendResponse(offlineResponseRef.current, boundedNext, targetLoadedRange, selectedForDisplay),
            TREND_BUFFER_POINTS_PER_SERIES_MAX,
          );
          const limited = limitOfflineTrendResponse(mergedNextRaw, targetLoadedRange, visibleRangeRef.current);
          if (limited.trimmedPointCount > 0) {
            logTrendDiagnostics("trend:memory-trim-offline", {
              trimmedPointCount: limited.trimmedPointCount,
              loadedRange: targetLoadedRange,
              retainedRange: limited.loadedRange,
              visibleRange: visibleRangeRef.current,
              pointCount: countTrendResponsePoints(limited.response),
              maxPointsPerSeries: MAX_OFFLINE_BUFFER_POINTS_PER_SERIES,
              maxTotalPoints: MAX_OFFLINE_BUFFER_POINTS_TOTAL,
              maxTimeSpanMs: MAX_OFFLINE_BUFFER_TIME_SPAN_MS,
            });
          }
          offlineLoadedRangeRef.current = limited.loadedRange;
          setOfflineLoadedRange(limited.loadedRange);
          offlineResponseRef.current = limited.response;
          setOfflineResponse(limited.response);
        } else {
          const limited = limitOfflineTrendResponse(boundedNext, targetLoadedRange, visibleRangeRef.current);
          if (limited.trimmedPointCount > 0) {
            logTrendDiagnostics("trend:memory-trim-offline", {
              trimmedPointCount: limited.trimmedPointCount,
              loadedRange: targetLoadedRange,
              retainedRange: limited.loadedRange,
              visibleRange: visibleRangeRef.current,
              pointCount: countTrendResponsePoints(limited.response),
              maxPointsPerSeries: MAX_OFFLINE_BUFFER_POINTS_PER_SERIES,
              maxTotalPoints: MAX_OFFLINE_BUFFER_POINTS_TOTAL,
              maxTimeSpanMs: MAX_OFFLINE_BUFFER_TIME_SPAN_MS,
            });
          }
          offlineLoadedRangeRef.current = limited.loadedRange;
          setOfflineLoadedRange(limited.loadedRange);
          offlineResponseRef.current = limited.response;
          setOfflineResponse(limited.response);
        }
        if (pendingToolbarPresetRef.current) {
          setToolbarQuickPreset(pendingToolbarPresetRef.current);
          pendingToolbarPresetRef.current = null;
        }
      }
      setStatusAggregation(boundedNext.aggregation);
      if (isLiveQuery) {
        logTrendDiagnostics("live:status", {
          mode,
          statusAggregation: boundedNext.aggregation,
          requestedAggregation: requestAggregation,
        });
      }
      setLastLoadAt(Date.now());
      const nextLatest: Record<string, string> = {};
      const latestSource = targetMode === "live" && liveDataSource === "archivePolling"
        ? (liveResponseRef.current ?? boundedNext)
        : boundedNext;
      for (const series of latestSource.series) {
        const lastPoint = series.points[series.points.length - 1];
        nextLatest[series.tag] = formatTrendValue(lastPoint?.v);
        if (lastPoint) {
          liveLastTimestampByTagRef.current.set(series.tag, lastPoint.t);
          liveLatestByTagRef.current.set(series.tag, {
            value: lastPoint.v,
            quality: lastPoint.q,
            sourceTs: lastPoint.t,
            // Mark as stale until the first real live value arrives from the runtime stream.
            lastIncomingAt: 0,
          });
        }
      }
      setSeriesLatestValues(nextLatest);
      return { ok: true, response: latestSource };
    } catch (queryError) {
      if (controller.signal.aborted || isAbortError(queryError)) {
        logTrendDiagnostics("query:aborted", {
          mode,
          liveMode,
          liveFollow: liveFollowRef.current,
          rangeFrom: range.from,
          rangeTo: range.to,
          targetMode,
          ownsGlobalRequest,
          message: queryError instanceof Error ? queryError.message : String(queryError),
        });
        return { ok: false, reason: "aborted" };
      }
      const retryAfterMs = resolveRetryDelayFromError(queryError, "trendsQuery");
      if ((queryError as BackoffError | null)?.reason === "backoff" || retryAfterMs !== null) {
        return {
          ok: false,
          reason: "backoff",
          retryAfterMs: Math.max(250, retryAfterMs ?? 1000),
        };
      }
      const text = queryError instanceof Error ? queryError.message : "Trends query failed";
      if (isAuthenticationRequiredErrorMessage(text) && liveModeRef.current) {
        setError(null);
        setHistoryWarning("History loading requires authentication");
      } else {
        setError(text);
      }
      if (isLiveQuery) {
        setLiveHistoryState("error");
        setLiveHistoryPointCount(0);
      }
      logTrendDiagnostics("query:error", {
        mode,
        liveMode,
        aggregation: requestAggregation,
        rangeFrom: range.from,
        rangeTo: range.to,
        pointCount: 0,
        message: text,
      });
      if (isLiveBootstrapQuery) {
        logTrendDiagnostics("live:bootstrap:error", {
          rangeFrom: range.from,
          rangeTo: range.to,
          message: text,
        });
      }
      return { ok: false, reason: "error" };
    } finally {
      trendQueryInFlightCountRef.current = Math.max(0, trendQueryInFlightCountRef.current - 1);
      setTrendWidgetDiagnostics(object.id, buildWidgetDiagnostics());
      if (ownsGlobalRequest && requestId === requestIdRef.current) {
        setLoading(false);
      }
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        requestTargetModeRef.current = null;
      }
    }
  }, [
    buildRetainedLiveResponse,
    drainLiveBootstrapPointsForMerge,
    invalidateOfflineLoadState,
    liveMode,
    liveRetentionMs,
    object.id,
    selectedTagNamesKey,
    liveDataSource,
    settings.aggregation,
    settings.cacheEnabled,
    settings.maxLivePointsPerTag,
    settings.maxVisiblePointsPerSeries,
    settings.realtimeAppendSnapshotAggregation,
    settings.realtimeAppendSnapshotMaxPoints,
    realtimeAppendFlushMs,
  ]);

  const requestBufferedRange = useCallback(async (
    range: TrendVisibleRange,
    options?: { force?: boolean; replace?: boolean; skipLoadingState?: boolean },
  ): Promise<ExecuteQueryResult> => {
    const normalized = normalizeTrendRange(range);
    if (normalized.to <= normalized.from || selectedTagNames.length === 0) {
      return { ok: false, reason: "error" };
    }
    const requestKey = `${normalized.from}:${normalized.to}:${options?.replace ? "replace" : "merge"}`;
    if (!options?.force && bufferedRequestKeyRef.current === requestKey) {
      return { ok: false, reason: "error" };
    }
    bufferedRequestKeyRef.current = requestKey;
    const tracksOfflineLoadState = options?.skipLoadingState !== true;
    const offlineLoadSeq = tracksOfflineLoadState ? offlineLoadSeqRef.current + 1 : null;
    if (offlineLoadSeq !== null) {
      offlineLoadSeqRef.current = offlineLoadSeq;
      setOfflineLoadState("loading");
    }
    const result = await executeQuery(normalized, {
      force: options?.force,
      context: "history",
      targetMode: "offline",
      mergeWithExisting: options?.replace !== true,
      skipLoadingState: options?.skipLoadingState,
    });
    if (bufferedRequestKeyRef.current === requestKey) {
      bufferedRequestKeyRef.current = null;
    }
    if (offlineLoadSeq !== null && offlineLoadSeqRef.current === offlineLoadSeq) {
      if (result.ok) {
        const totalPointCount = countTrendResponsePoints(offlineResponseRef.current);
        setOfflineLoadState(totalPointCount > 0 ? "loaded" : "empty");
      } else if (result.reason === "aborted") {
        setOfflineLoadState("idle");
      } else {
        setOfflineLoadState("error");
      }
    }
    return result;
  }, [executeQuery, selectedTagNames.length]);

  const maybeRequestPrefetchIfNeeded = useCallback((range: TrendVisibleRange, options?: { immediate?: boolean }) => {
    if (selectedTagNames.length === 0 || liveModeRef.current) {
      return;
    }
    const requests = requestPrefetchIfNeeded(range, offlineLoadedRangeRef.current);
    if (requests.length === 0) {
      return;
    }
    if (historyLoadTimerRef.current) {
      window.clearTimeout(historyLoadTimerRef.current);
      historyLoadTimerRef.current = null;
    }
    const load = () => {
      void (async () => {
        for (const requestRange of requests) {
          await requestBufferedRange(requestRange, { skipLoadingState: true });
        }
      })();
    };
    if (options?.immediate || !isRangeCovered(offlineLoadedRangeRef.current, range)) {
      load();
      return;
    }
    historyLoadTimerRef.current = window.setTimeout(() => {
      historyLoadTimerRef.current = null;
      load();
    }, TREND_PREFETCH_DEBOUNCE_MS);
  }, [requestBufferedRange, selectedTagNames.length]);

  const executeLiveBootstrapQuery = useCallback(async (nextRange: TrendVisibleRange): Promise<boolean> => {
    const sessionId = liveSessionIdRef.current;
    const startedAt = Date.now();
    const span = Math.max(60_000, nextRange.to - nextRange.from);
    const right = Date.now();
    const anchoredRange: TrendVisibleRange = {
      from: right - span,
      to: right,
    };
    liveHistoryLoadedToRef.current = anchoredRange.to;
    liveRealtimeEnabledSessionIdRef.current = null;
    liveLastTimestampByTagRef.current.clear();
    liveBufferRef.current = [];
    liveBootstrapBufferRef.current = [];
    const selectedForDisplay = selectedTagsRef.current;
    const emptyResponse = buildEmptyTrendResponse(anchoredRange, selectedForDisplay);
    liveResponseRef.current = emptyResponse;
    setLiveResponse(emptyResponse);
    liveBootstrapRangeRef.current = anchoredRange;
    setRangePreset("custom");
    setVisibleRange(anchoredRange);
    setCustomFrom(toLocalDateTimeInputValue(anchoredRange.from));
    setCustomTo(toLocalDateTimeInputValue(anchoredRange.to));
    logTrendDiagnostics("live:status", {
      mode: "liveBootstrap",
      statusAggregation: settings.realtimeAppendSnapshotAggregation,
      requestedAggregation: settings.realtimeAppendSnapshotAggregation,
    });
    logTrendDiagnostics("live:bootstrap:range", {
      requestedFrom: anchoredRange.from,
      requestedTo: anchoredRange.to,
      nowAtStart: Date.now(),
      spanMs: anchoredRange.to - anchoredRange.from,
      previousVisibleFrom: visibleRangeRef.current.from,
      previousVisibleTo: visibleRangeRef.current.to,
      selectedTags: selectedTagNamesRef.current.length,
      snapshotAggregationPolicy: settings.realtimeAppendSnapshotAggregation,
      snapshotMaxPointsPolicy: settings.realtimeAppendSnapshotMaxPoints,
      flushMsPolicy: realtimeAppendFlushMs,
    });
    const loadedResult = await executeQuery(anchoredRange, {
      force: true,
      mode: "liveBootstrap",
      context: "live",
      targetMode: "live",
      liveSessionId: sessionId,
      skipRateLimit: true,
    });
    if (!loadedResult.ok || sessionId !== liveSessionIdRef.current || !liveModeRef.current) {
      logTrendDiagnostics("liveRealtime:snapshot-load-error", {
        sessionId,
        durationMs: Date.now() - startedAt,
        rangeFrom: anchoredRange.from,
        rangeTo: anchoredRange.to,
        reason: loadedResult.ok ? "stale-session" : loadedResult.reason,
        retryAfterMs: loadedResult.ok || loadedResult.reason !== "backoff" ? null : loadedResult.retryAfterMs,
      });
      return false;
    }
    const loaded = loadedResult.response;
    let latestTs = Number.NEGATIVE_INFINITY;
    for (const series of loaded.series) {
      const tail = series.points[series.points.length - 1];
      if (tail && Number.isFinite(tail.t)) {
        latestTs = Math.max(latestTs, tail.t);
        liveLastTimestampByTagRef.current.set(series.tag, tail.t);
      }
    }
    liveHistoryLoadedToRef.current = Number.isFinite(latestTs) ? Math.max(anchoredRange.to, latestTs) : anchoredRange.to;
    liveHistorySnapshotRef.current = loaded;
    liveRealtimeEnabledSessionIdRef.current = sessionId;
    logTrendDiagnostics("liveRealtime:snapshot-load-success", {
      sessionId,
      durationMs: Date.now() - startedAt,
      rangeFrom: anchoredRange.from,
      rangeTo: anchoredRange.to,
      historyLoadedTo: liveHistoryLoadedToRef.current,
      pointCount: loaded.series.reduce((acc, series) => acc + series.points.length, 0),
    });
    return true;
  }, [
    executeQuery,
    realtimeAppendFlushMs,
    selectedTagNamesKey,
    settings.realtimeAppendSnapshotAggregation,
    settings.realtimeAppendSnapshotMaxPoints,
  ]);

  useEffect(() => {
    cacheRef.current = new TrendQueryCache(settings.maxCachedRanges, resolveTrendCachePointLimit(settings.maxCachedRanges));
    setRuntimeDiagnosticMetric("cachedTrendRanges", cacheRef.current.getStats().entryCount);
  }, [
    selectedTagNamesKey,
    settings.aggregation,
    settings.cacheEnabled,
    settings.maxCachedRanges,
    settings.maxLivePointsPerTag,
    settings.realtimeAppendSnapshotAggregation,
    settings.realtimeAppendSnapshotMaxPoints,
  ]);

  useEffect(() => {
    if (allTags.length > 0) {
      return;
    }
    const unregister = registerPollingLoop(`trend-tags:${object.id}`);
    let disposed = false;
    let timerId: number | null = null;
    let controller: AbortController | null = null;
    const scheduleRetry = (delayMs: number) => {
      if (disposed) {
        return;
      }
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      timerId = window.setTimeout(() => {
        timerId = null;
        void load();
      }, Math.max(250, delayMs));
    };
    const load = async () => {
      if (disposed) {
        return;
      }
      const gate = canRequestEndpoint("trendTags");
      if (!gate.allowed) {
        scheduleRetry(gate.delayMs);
        return;
      }
      controller?.abort();
      controller = new AbortController();
      try {
        const tags = await fetchTrendTags(controller.signal);
        if (disposed) {
          return;
        }
        setAllTags(tags);
        if (selectedTags.length > 0) {
          const existing = new Set(tags.map((item) => item.name));
          setSelectedTags((prev) => prev.filter((item) => existing.has(item.tag)));
        }
      } catch (loadError) {
        if (disposed || controller?.signal.aborted) {
          return;
        }
        const text = loadError instanceof Error ? loadError.message : "Failed to load trend tags";
        if (isAuthenticationRequiredErrorMessage(text)) {
          setHistoryWarning("History loading requires authentication");
          return;
        }
        setError(text);
        const retryDelayMs = resolveRetryDelayFromError(loadError, "trendTags") ?? 2000;
        scheduleRetry(retryDelayMs);
      }
    };
    void load();
    return () => {
      disposed = true;
      unregister();
      controller?.abort();
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [allTags.length, object.id, selectedTags.length]);

  useEffect(() => () => {
    requestControllerRef.current?.abort();
    trendQueryRateLimiterRef.current.cancel({ ok: false, reason: "aborted" });
    liveSocketRef.current?.close();
    if (historyLoadTimerRef.current) {
      window.clearTimeout(historyLoadTimerRef.current);
    }
    if (onlineRecoveryTimerRef.current !== null) {
      window.clearTimeout(onlineRecoveryTimerRef.current);
      onlineRecoveryTimerRef.current = null;
    }
    if (viewStateSaveTimerRef.current) {
      window.clearTimeout(viewStateSaveTimerRef.current);
      viewStateSaveTimerRef.current = null;
    }
    clearTrendWidgetDiagnostics(object.id);
  }, []);

  useEffect(() => {
    if (selectedTagNames.length === 0 || liveMode) {
      return;
    }
    const frozenRange = offlineFrozenRangeRef.current;
    const initialLoadedRange = resolveInitialLoadedRange(frozenRange ?? visibleRangeRef.current);
    offlineFrozenRangeRef.current = null;
    offlineLoadedRangeRef.current = initialLoadedRange;
    offlineResponseRef.current = buildEmptyTrendResponse(initialLoadedRange, selectedTagsRef.current);
    setOfflineLoadedRange(initialLoadedRange);
    setOfflineResponse(offlineResponseRef.current);
    setOfflineLoadState("loading");
    void requestBufferedRange(initialLoadedRange, { force: true, replace: true });
  }, [liveMode, requestBufferedRange, screenRevision, selectedTagNamesKey]);

  useEffect(() => {
    const wasLive = previousLiveModeForCleanupRef.current;
    previousLiveModeForCleanupRef.current = liveMode;
    if (!liveMode || selectedTagNames.length === 0) {
      setLoading(false);
      setLiveHistoryState("idle");
      setLiveHistoryPointCount(0);
      setLiveBootstrapReady(false);
      liveBootstrapRangeRef.current = null;
      liveBufferRef.current = [];
      liveBootstrapBufferRef.current = [];
      liveFirstWsPointLoggedRef.current = false;
      liveHistoryLoadedToRef.current = null;
      liveHistorySnapshotRef.current = null;
      liveRealtimeEnabledSessionIdRef.current = null;
      liveRealtimeReceivedSinceLastLogRef.current = 0;
      liveRealtimeAppendedSinceLastLogRef.current = 0;
      liveLastTimestampByTagRef.current.clear();
      liveSessionIdRef.current += 1;
      if (wasLive) {
        trendQueryRateLimiterRef.current.cancel({ ok: false, reason: "aborted" });
        if (requestTargetModeRef.current === "live") {
          requestControllerRef.current?.abort();
        }
      }
      setLiveResponse(null);
      liveResponseRef.current = null;
      return;
    }

    if (liveDataSource !== "realtimeAppend") {
      setLiveBootstrapReady(true);
      return;
    }

    liveSessionIdRef.current += 1;
    liveBootstrapBufferRef.current = [];
    liveBufferRef.current = [];
    liveFirstWsPointLoggedRef.current = false;
    setLiveBootstrapReady(false);
    const bootstrapRange = computeLiveBootstrapRange(lastStableVisibleRangeRef.current);
    logTrendDiagnostics("live:bootstrap:start", {
      requestedFrom: bootstrapRange.from,
      requestedTo: bootstrapRange.to,
      nowAtStart: Date.now(),
      currentVisibleFrom: visibleRangeRef.current.from,
      currentVisibleTo: visibleRangeRef.current.to,
      stableVisibleFrom: lastStableVisibleRangeRef.current.from,
      stableVisibleTo: lastStableVisibleRangeRef.current.to,
      selectedTags: selectedTagNames.length,
      snapshotAggregationPolicy: settings.realtimeAppendSnapshotAggregation,
      snapshotMaxPointsPolicy: settings.realtimeAppendSnapshotMaxPoints,
      flushMsPolicy: realtimeAppendFlushMs,
    });
    let disposed = false;
    void (async () => {
      const success = await executeLiveBootstrapQuery(bootstrapRange);
      if (!disposed && success && liveSessionIdRef.current > 0) {
        setLiveBootstrapReady(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [
    computeLiveBootstrapRange,
    executeLiveBootstrapQuery,
    liveDataSource,
    liveMode,
    realtimeAppendFlushMs,
    selectedTagNames.length,
    selectedTagNamesKey,
    settings.realtimeAppendSnapshotAggregation,
    settings.realtimeAppendSnapshotMaxPoints,
  ]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("mousedown", closeMenu);
    return () => window.removeEventListener("mousedown", closeMenu);
  }, [contextMenu]);

  useEffect(() => {
    if (liveDataSource !== "archivePolling" || !liveMode || selectedTagNames.length === 0) {
      return;
    }
    if (isArchivePollingDisabled()) {
      logTrendDiagnostics("livePolling:disabled", {
        objectId: object.id,
        localStorageKey: TRENDS_DISABLE_ARCHIVE_POLLING_KEY,
      });
      setLiveBootstrapReady(true);
      setLiveHistoryState("idle");
      return;
    }

    const sessionId = ++liveSessionIdRef.current;
    const unregisterPollingLoop = registerPollingLoop(`trend-live-archive:${object.id}`);
    let disposed = false;
    let inFlight = false;
    let timerId: number | null = null;
    setLoading(false);
    setLiveBootstrapReady(true);
    setLiveHistoryState("loading");
    setLiveHistoryPointCount(0);
    setRangePreset("custom");

    const scheduleNext = (overrideDelayMs?: number) => {
      if (disposed) {
        return;
      }
      const now = Date.now();
      const delay = overrideDelayMs !== undefined
        ? Math.max(250, Math.round(overrideDelayMs))
        : computeNextMetronomeDelay(now, livePollingIntervalMs);
      const plannedAt = now + delay;
      logTrendDiagnostics("livePolling:schedule-next", {
        sessionId,
        intervalMs: livePollingIntervalMs,
        now,
        delayMs: delay,
        plannedAt,
      });
      timerId = window.setTimeout(() => {
        timerId = null;
        void tick(plannedAt);
      }, delay);
    };

    const tick = async (plannedAt: number) => {
      if (disposed) {
        return;
      }
      if (inFlight) {
        const now = Date.now();
        logTrendDiagnostics("livePolling:tick-skip-inflight", {
          sessionId,
          intervalMs: livePollingIntervalMs,
          plannedAt,
          startedAt: now,
          driftMs: now - plannedAt,
        });
        scheduleNext();
        return;
      }
      const gate = canRequestEndpoint("trendsQuery");
      if (!gate.allowed) {
        scheduleNext(gate.delayMs);
        return;
      }
      inFlight = true;
      const now = Date.now();
      const followSpan = Math.max(60_000, liveWindowMs);
      const querySpan = Math.max(followSpan, liveRetentionMs);
      const queryRange: TrendVisibleRange = {
        from: now - querySpan,
        to: now,
      };
      const nextRange: TrendVisibleRange = {
        from: now - followSpan,
        to: now,
      };
      logTrendDiagnostics("livePolling:tick-start", {
        sessionId,
        intervalMs: livePollingIntervalMs,
        plannedAt,
        startedAt: now,
        driftMs: now - plannedAt,
        rangeFrom: queryRange.from,
        rangeTo: queryRange.to,
        followRangeFrom: nextRange.from,
        followRangeTo: nextRange.to,
        liveRetentionMs,
      });
      const requestStartedAt = now;
      let nextDelayOverride: number | undefined;
      try {
        const loadedResult = await executeQuery(queryRange, {
          force: true,
          context: "live",
          targetMode: "live",
          liveSessionId: sessionId,
          skipLoadingState: true,
          skipLiveLoadingState: true,
          skipRateLimit: true,
        });
        const finishedAt = Date.now();
        if (!loadedResult.ok && loadedResult.reason === "backoff") {
          logTrendDiagnostics("livePolling:tick-backoff", {
            sessionId,
            retryAfterMs: loadedResult.retryAfterMs,
          });
          nextDelayOverride = loadedResult.retryAfterMs;
          return;
        }
        const loaded = loadedResult.ok ? loadedResult.response : null;
        const pointCount = loaded?.series.reduce((acc, series) => acc + series.points.length, 0) ?? 0;
        if (!disposed && sessionId === liveSessionIdRef.current && loaded) {
          if (liveFollowRef.current) {
            setVisibleRange(nextRange);
            setCustomFrom(toLocalDateTimeInputValue(nextRange.from));
            setCustomTo(toLocalDateTimeInputValue(nextRange.to));
          }
          chartApiRef.current?.notifyLiveHeartbeat?.(nextRange.to);
          logTrendDiagnostics("livePolling:tick-success", {
            sessionId,
            liveFollow: liveFollowRef.current,
            liveRetentionMs,
            intervalMs: livePollingIntervalMs,
            plannedAt,
            startedAt: requestStartedAt,
            finishedAt,
            durationMs: finishedAt - requestStartedAt,
            pointCount,
            rangeFrom: queryRange.from,
            rangeTo: queryRange.to,
            followRangeFrom: nextRange.from,
            followRangeTo: nextRange.to,
          });
        } else {
          logTrendDiagnostics("livePolling:tick-error", {
            sessionId,
            intervalMs: livePollingIntervalMs,
            plannedAt,
            startedAt: requestStartedAt,
            finishedAt,
            durationMs: finishedAt - requestStartedAt,
            pointCount,
            reason: "stale-or-empty-response",
          });
        }
      } catch (tickError) {
        const finishedAt = Date.now();
        const message = tickError instanceof Error ? tickError.message : "Unknown live polling error";
        logTrendDiagnostics("livePolling:tick-error", {
          sessionId,
          intervalMs: livePollingIntervalMs,
          plannedAt,
          startedAt: requestStartedAt,
          finishedAt,
          durationMs: finishedAt - requestStartedAt,
          reason: "exception",
          message,
        });
      } finally {
        inFlight = false;
        scheduleNext(nextDelayOverride);
      }
    };

    void tick(Date.now());

    return () => {
      disposed = true;
      unregisterPollingLoop();
      ++liveSessionIdRef.current;
      if (requestTargetModeRef.current === "live") {
        requestControllerRef.current?.abort();
      }
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [executeQuery, liveDataSource, liveMode, livePollingIntervalMs, liveWindowMs, object.id, selectedTagNames.length, selectedTagNamesKey]);

  useEffect(() => {
    if (canOpenRuntimeSettings) {
      return;
    }
    if (settingsOpen) {
      setSettingsOpen(false);
    }
  }, [canOpenRuntimeSettings, settingsOpen]);

  useEffect(() => {
    if (liveDataSource !== "realtimeAppend" || !liveMode || selectedTagNames.length === 0) {
      liveSocketRef.current?.close();
      liveSocketRef.current = null;
      setLiveSocketState("idle");
      return;
    }

    const selected = new Set(selectedTagNames);
    const activeLiveSessionId = liveSessionIdRef.current;
    liveBufferRef.current = [];
    const socket = createRuntimeSocket({
      onTagValues: (values: TagValue[]) => {
        let dropped = 0;
        for (const value of values) {
          if (!selected.has(value.name)) {
            continue;
          }
          const normalizedTs = normalizeTimestampMs(value.timestamp);
          if (normalizedTs === null) {
            continue;
          }
          if (
            liveRealtimeEnabledSessionIdRef.current === activeLiveSessionId
            && liveHistoryLoadedToRef.current !== null
            && normalizedTs <= liveHistoryLoadedToRef.current
          ) {
            continue;
          }
          const lastKnownTs = liveLastTimestampByTagRef.current.get(value.name) ?? Number.NEGATIVE_INFINITY;
          if (normalizedTs <= lastKnownTs) {
            continue;
          }
          liveLastTimestampByTagRef.current.set(value.name, normalizedTs);
          liveBufferRef.current.push({
            tag: value.name,
            value: value.value,
            quality: value.quality,
            timestamp: normalizedTs,
            sessionId: activeLiveSessionId,
          });
          liveRealtimeReceivedSinceLastLogRef.current += 1;
          if (!liveFirstWsPointLoggedRef.current) {
            liveFirstWsPointLoggedRef.current = true;
            logTrendDiagnostics("live:first-ws-point", {
              tag: value.name,
              timestamp: normalizedTs,
              bootstrapReady: liveBootstrapReadyRef.current,
              bootstrapFrom: liveBootstrapRangeRef.current?.from ?? null,
              bootstrapTo: liveBootstrapRangeRef.current?.to ?? null,
            });
          }
        }
        const pendingBufferCap = livePendingBufferCapRef.current;
        if (liveBufferRef.current.length > pendingBufferCap) {
          dropped = liveBufferRef.current.length - pendingBufferCap;
          liveBufferRef.current.splice(0, dropped);
        }
        if (dropped > 0) {
          logTrendDiagnostics("live:pending-buffer-drop", {
            dropped,
            cap: pendingBufferCap,
            pendingAfterDrop: liveBufferRef.current.length,
          });
        }
      },
      onSocketStateChange: (state) => {
        setLiveSocketState(state);
      },
    }, { participateInGlobalSubscriptions: false });
    socket.subscribeTags(selectedTagNames);
    liveSocketRef.current = socket;

    const flushTimer = window.setInterval(() => {
      const pendingBeforeFlush = liveBufferRef.current.length;
      let batch = liveBufferRef.current.splice(0, pendingBeforeFlush);
      if (batch.length === 0) {
        return;
      }
      liveRealtimeAppendedSinceLastLogRef.current += batch.length;
      batch = batch.filter((item) => item.sessionId === activeLiveSessionId);
      if (batch.length === 0) {
        return;
      }
      if (!liveBootstrapReadyRef.current) {
        liveBootstrapBufferRef.current.push(...batch);
        const pendingBufferCap = livePendingBufferCapRef.current;
        if (liveBootstrapBufferRef.current.length > pendingBufferCap) {
          liveBootstrapBufferRef.current.splice(0, liveBootstrapBufferRef.current.length - pendingBufferCap);
        }
      } else if (liveBootstrapBufferRef.current.length > 0) {
        batch = [...liveBootstrapBufferRef.current.splice(0, liveBootstrapBufferRef.current.length), ...batch];
      }
      const historyLoadedTo = liveHistoryLoadedToRef.current;
      if (historyLoadedTo !== null) {
        batch = batch.filter((item) => item.timestamp > historyLoadedTo);
      }
      if (batch.length === 0) {
        return;
      }
      const activeTagCount = selected.size;
      const sourcePointCount = sourcePointCountRef.current;
      const echartsPointCount = chartApiRef.current?.getPointCount() ?? 0;
      logTrendDiagnostics("live:batch", {
        batchSize: batch.length,
        pendingBeforeFlush,
        pendingCap: livePendingBufferCapRef.current,
        activeTagCount,
        sourcePointCount,
        echartsPointCount,
        minTs: Math.min(...batch.map((item) => item.timestamp)),
        maxTs: Math.max(...batch.map((item) => item.timestamp)),
        flushMsPolicy: realtimeAppendFlushMs,
      });
      setLiveBatchCount((prev) => prev + 1);
      setLivePointCount((prev) => prev + batch.length);
      setLiveLastBatchAt(Date.now());
      let batchMaxTs: number | null = null;
      for (const item of batch) {
        if (!Number.isFinite(item.timestamp)) {
          continue;
        }
        batchMaxTs = batchMaxTs === null ? item.timestamp : Math.max(batchMaxTs, item.timestamp);
      }
      if (batchMaxTs !== null) {
        setLiveLastPointTs(batchMaxTs);
      }
      const receivedAt = Date.now();
      const latestByTagInBatch = new Map<string, { formatted: string }>();
      for (const item of batch) {
        latestByTagInBatch.set(item.tag, {
          formatted: formatTrendValue(item.value),
        });
        liveLatestByTagRef.current.set(item.tag, {
          value: item.value,
          quality: item.quality,
          sourceTs: item.timestamp,
          lastIncomingAt: receivedAt,
        });
      }
      setSeriesLatestValues((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [tagName, latest] of latestByTagInBatch) {
          if (next[tagName] !== latest.formatted) {
            next[tagName] = latest.formatted;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      if (!liveBootstrapReadyRef.current) {
        return;
      }
      chartApiRef.current?.notifyLiveHeartbeat?.(receivedAt);
      chartApiRef.current?.appendLivePoints(batch);
      logTrendDiagnostics("liveRealtime:append-batch", {
        sessionId: activeLiveSessionId,
        batchSize: batch.length,
        pointCountAfterAppend: chartApiRef.current?.getPointCount() ?? 0,
      });
    }, realtimeAppendFlushMs);

    const heartbeatTimer = window.setInterval(() => {
      if (!liveBootstrapReadyRef.current) {
        return;
      }
      const now = Date.now();
      if (liveSocketStateRef.current === "open") {
        chartApiRef.current?.notifyLiveHeartbeat?.(now);
      }
      const staleTags: string[] = [];
      for (const tagName of selectedTagNames) {
        const latest = liveLatestByTagRef.current.get(tagName);
        if (!latest) {
          continue;
        }
        if (now - latest.lastIncomingAt < LIVE_HEARTBEAT_STALE_SOURCE_MS) {
          continue;
        }
        staleTags.push(tagName);
      }
      if (staleTags.length === 0) {
        return;
      }
      logTrendDiagnostics("live:heartbeat-suppressed", {
        staleTagCount: staleTags.length,
        tags: staleTags,
        at: now,
      });
      for (const tagName of staleTags) {
        const latest = liveLatestByTagRef.current.get(tagName);
        if (!latest) {
          continue;
        }
        logTrendDiagnostics("live:stale-source-gap", {
          tag: tagName,
          previousTs: latest.sourceTs,
          currentTs: now,
          deltaMs: now - latest.sourceTs,
          staleTimeoutMs: LIVE_HEARTBEAT_STALE_SOURCE_MS,
          source: "heartbeat",
        });
      }
    }, LIVE_HEARTBEAT_MS);

    const statsTimer = window.setInterval(() => {
      const receivedPerSecond = liveRealtimeReceivedSinceLastLogRef.current;
      const appendedPerSecond = liveRealtimeAppendedSinceLastLogRef.current;
      liveRealtimeReceivedSinceLastLogRef.current = 0;
      liveRealtimeAppendedSinceLastLogRef.current = 0;
      logTrendDiagnostics("liveRealtime:points-per-second", {
        sessionId: activeLiveSessionId,
        receivedPerSecond,
        appendedPerSecond,
        pendingBuffer: liveBufferRef.current.length,
        bootstrapBuffer: liveBootstrapBufferRef.current.length,
      });
    }, 1000);

    return () => {
      window.clearInterval(flushTimer);
      window.clearInterval(heartbeatTimer);
      window.clearInterval(statsTimer);
      socket.close();
      setLiveSocketState("closed");
      if (liveSocketRef.current === socket) {
        liveSocketRef.current = null;
      }
    };
  }, [liveDataSource, liveMode, realtimeAppendFlushMs, selectedTagNamesKey]);

  useEffect(() => {
    if (
      liveDataSource !== "realtimeAppend"
      || !liveMode
      || !settings.liveResyncEnabled
      || selectedTagNames.length === 0
    ) {
      return;
    }
    // TODO(trends): Next optimization stage can combine snapshot+append with a longer resync cadence and smarter diffing.

    let disposed = false;
    let inFlight = false;
    let timerId: number | null = null;
    const unregisterPollingLoop = registerPollingLoop(`trend-live-resync:${object.id}`);
    const sessionId = liveSessionIdRef.current;

    const scheduleNext = (overrideDelayMs?: number) => {
      if (disposed) {
        return;
      }
      const delay = overrideDelayMs !== undefined
        ? Math.max(250, Math.round(overrideDelayMs))
        : liveResyncIntervalMs;
      timerId = window.setTimeout(() => {
        timerId = null;
        void tick();
      }, delay);
    };

    const tick = async () => {
      if (disposed || inFlight || !liveBootstrapReadyRef.current || sessionId !== liveSessionIdRef.current) {
        scheduleNext();
        return;
      }
      const gate = canRequestEndpoint("trendsQuery");
      if (!gate.allowed) {
        scheduleNext(gate.delayMs);
        return;
      }
      inFlight = true;
      let nextDelayOverride: number | undefined;
      const startedAt = Date.now();
      const span = Math.max(60_000, liveWindowMs, liveRetentionMs);
      const range: TrendVisibleRange = {
        from: startedAt - span,
        to: startedAt,
      };
      logTrendDiagnostics("liveRealtime:resync-start", {
        sessionId,
        intervalMs: liveResyncIntervalMs,
        rangeFrom: range.from,
        rangeTo: range.to,
        snapshotAggregationPolicy: settings.realtimeAppendSnapshotAggregation,
        snapshotMaxPointsPolicy: settings.realtimeAppendSnapshotMaxPoints,
        flushMsPolicy: realtimeAppendFlushMs,
      });
      try {
        const loadedResult = await executeQuery(range, {
          force: true,
          mode: "liveBootstrap",
          context: "live",
          targetMode: "live",
          liveSessionId: sessionId,
          skipLoadingState: true,
          skipLiveLoadingState: true,
          skipRateLimit: true,
        });
        if (!loadedResult.ok && loadedResult.reason === "backoff") {
          nextDelayOverride = loadedResult.retryAfterMs;
          return;
        }
        const loaded = loadedResult.ok ? loadedResult.response : null;
        const finishedAt = Date.now();
        if (!disposed && sessionId === liveSessionIdRef.current && loaded) {
          let latestTs = Number.NEGATIVE_INFINITY;
          for (const series of loaded.series) {
            const tail = series.points[series.points.length - 1];
            if (tail && Number.isFinite(tail.t)) {
              latestTs = Math.max(latestTs, tail.t);
            }
          }
          liveHistoryLoadedToRef.current = Number.isFinite(latestTs) ? Math.max(range.to, latestTs) : range.to;
          liveHistorySnapshotRef.current = loaded;
          liveRealtimeEnabledSessionIdRef.current = sessionId;
          logTrendDiagnostics("liveRealtime:resync-success", {
            sessionId,
            durationMs: finishedAt - startedAt,
            historyLoadedTo: liveHistoryLoadedToRef.current,
            pointCount: loaded.series.reduce((acc, series) => acc + series.points.length, 0),
          });
        } else {
          logTrendDiagnostics("liveRealtime:resync-error", {
            sessionId,
            durationMs: finishedAt - startedAt,
            reason: "stale-or-empty-response",
          });
        }
      } catch (resyncError) {
        const finishedAt = Date.now();
        const message = resyncError instanceof Error ? resyncError.message : "Unknown realtime resync error";
        logTrendDiagnostics("liveRealtime:resync-error", {
          sessionId,
          durationMs: finishedAt - startedAt,
          reason: "exception",
          message,
        });
      } finally {
        inFlight = false;
        scheduleNext(nextDelayOverride);
      }
    };

    scheduleNext();

    return () => {
      disposed = true;
      unregisterPollingLoop();
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    executeQuery,
    liveDataSource,
    liveMode,
    liveResyncIntervalMs,
    liveWindowMs,
    object.id,
    realtimeAppendFlushMs,
    selectedTagNames.length,
    selectedTagNamesKey,
    settings.liveResyncEnabled,
    settings.realtimeAppendSnapshotAggregation,
    settings.realtimeAppendSnapshotMaxPoints,
  ]);

  useEffect(() => {
    if (!liveMode) {
      liveFollowRef.current = false;
      setLiveFollow(false);
      return;
    }
    liveFollowRef.current = true;
    setLiveFollow(true);
    liveFollowWindowMsRef.current = Math.max(60_000, visibleRangeRef.current.to - visibleRangeRef.current.from);
    setLiveAutoStopReason(null);
    setLiveBatchCount(0);
    setLivePointCount(0);
    setLiveLastBatchAt(null);
    setLiveLastPointTs(null);
  }, [liveMode]);

  const rememberToolbarRange = (preset: TrendRangePreset, range: TrendVisibleRange) => {
    toolbarRangeRef.current = { preset, range, expiresAt: Date.now() + 650 };
  };

  const resolveToolbarRangeEchoPreset = (range: TrendVisibleRange): TrendRangePreset | null => {
    const pending = toolbarRangeRef.current;
    if (!pending || pending.expiresAt < Date.now()) {
      return null;
    }
    const pendingQuickPreset = pending.preset === "5m" || pending.preset === "15m" || pending.preset === "1h"
      ? pending.preset
      : null;
    if (pendingQuickPreset && resolveQuickPresetFromRangeSpan(range) === pendingQuickPreset) {
      return pendingQuickPreset;
    }
    return null;
  };

  const applyRangeAndQuery = (next: TrendVisibleRange, options?: { keepLive?: boolean; preset?: TrendRangePreset; followLive?: boolean }) => {
    const normalized = normalizeTrendRange(next);
    const nextPreset = options?.preset ?? "custom";
    rememberToolbarRange(nextPreset, normalized);
    setToolbarQuickPreset(nextPreset === "5m" || nextPreset === "15m" || nextPreset === "1h" ? nextPreset : null);
    pendingToolbarPresetRef.current = null;
    if (!liveMode) {
      offlineFrozenRangeRef.current = null;
    }
    if (liveMode && options?.keepLive) {
      setLiveAutoStopReason(null);
      if (options.followLive) {
        liveFollowRef.current = true;
        setLiveFollow(true);
        liveFollowWindowMsRef.current = Math.max(60_000, normalized.to - normalized.from);
      }
      setRangePreset(nextPreset);
      setVisibleRange(normalized);
      setCustomFrom(toLocalDateTimeInputValue(normalized.from));
      setCustomTo(toLocalDateTimeInputValue(normalized.to));
      if (liveDataSource === "realtimeAppend") {
        void executeLiveBootstrapQuery(normalized);
      }
      return;
    }
    if (!options?.keepLive && liveMode) {
      offlineFrozenRangeRef.current = normalized;
      visibleRangeRef.current = normalized;
      lastStableVisibleRangeRef.current = normalized;
      invalidateOfflineLoadState("loading");
      setLiveMode(false);
      setLiveAutoStopReason("Stopped by toolbar history navigation");
    }
    setRangePreset(nextPreset);
    setVisibleRange(normalized);
    setCustomFrom(toLocalDateTimeInputValue(normalized.from));
    setCustomTo(toLocalDateTimeInputValue(normalized.to));
    if (selectedTags.length > 0 && !isRangeCovered(offlineLoadedRangeRef.current, normalized)) {
      const missingRanges = requestPrefetchIfNeeded(normalized, offlineLoadedRangeRef.current);
      const rangesToLoad = missingRanges.length > 0 ? missingRanges : [normalized];
      void (async () => {
        for (const requestRange of rangesToLoad) {
          await requestBufferedRange(requestRange, { force: true, skipLoadingState: false });
        }
      })();
    }
  };

  const applyPreset = (preset: Exclude<TrendRangePreset, "custom">) => {
    const next = resolveRangeForPresetInBuffer(preset, liveMode ? null : offlineLoadedRangeRef.current);
    setRangePreset(preset);
    logTrendDiagnostics("range:preset", {
      preset,
      from: next.from,
      to: next.to,
      liveMode,
    });
    setTimeRangeDraftFrom(toLocalDateTimeInputValue(next.from));
    setTimeRangeDraftTo(toLocalDateTimeInputValue(next.to));
    applyRangeAndQuery(next, { preset, keepLive: liveMode, followLive: liveMode });
  };

  const openTimeRangeDialog = () => {
    setTimeRangeDraftFrom(customFrom);
    setTimeRangeDraftTo(customTo);
    setTimeRangeDialogOpen(true);
  };

  const applyDialogPreset = (preset: Exclude<TrendRangePreset, "custom">) => {
    const next = resolveRangeForPresetInBuffer(preset, liveMode ? null : offlineLoadedRangeRef.current);
    setTimeRangeDraftFrom(toLocalDateTimeInputValue(next.from));
    setTimeRangeDraftTo(toLocalDateTimeInputValue(next.to));
    applyRangeAndQuery(next, { preset, keepLive: liveMode, followLive: liveMode });
    setTimeRangeDialogOpen(false);
  };

  const applyDialogCustomRange = () => {
    const from = fromLocalDateTimeInputValue(timeRangeDraftFrom);
    const to = fromLocalDateTimeInputValue(timeRangeDraftTo);
    setTimeRangeDialogOpen(false);
    applyRangeAndQuery({ from, to }, { preset: "custom", keepLive: liveMode });
  };

  const zoomBy = (factor: number) => {
    const currentSpan = Math.max(TREND_ZOOM_MIN_SPAN_MS, visibleRange.to - visibleRange.from);
    const nextSpan = clamp(Math.round(currentSpan * factor), TREND_ZOOM_MIN_SPAN_MS, TREND_ZOOM_MAX_SPAN_MS);
    const nextRange = {
      from: Math.round(visibleRange.to - nextSpan),
      to: Math.round(visibleRange.to),
    };
    applyRangeAndQuery(nextRange);
  };

  const panBy = (direction: -1 | 1) => {
    const span = Math.max(TREND_ZOOM_MIN_SPAN_MS, visibleRange.to - visibleRange.from);
    const shift = Math.round(span * 0.25 * direction);
    const nextRange = {
      from: visibleRange.from + shift,
      to: visibleRange.to + shift,
    };
    applyRangeAndQuery(nextRange);
  };

  const handleChartRangeChange = (range: TrendVisibleRange, source: "interaction" | "live") => {
    const normalized = normalizeTrendRange(range);
    if (source === "live" && !liveMode) {
      return;
    }
    if (source === "live" && liveMode && !liveFollowRef.current) {
      return;
    }
    setVisibleRange(normalized);
    setCustomFrom(toLocalDateTimeInputValue(normalized.from));
    setCustomTo(toLocalDateTimeInputValue(normalized.to));
    if (source === "live" && liveMode) {
      liveFollowWindowMsRef.current = Math.max(60_000, normalized.to - normalized.from);
    }
    if (source === "interaction") {
      const echoPreset = resolveToolbarRangeEchoPreset(normalized);
      if (echoPreset) {
        setRangePreset(echoPreset);
        setToolbarQuickPreset(echoPreset === "5m" || echoPreset === "15m" || echoPreset === "1h" ? echoPreset : null);
        return;
      }
      if (liveMode) {
        const toleranceMs = resolveLiveTailToleranceMs(normalized);
        const latestRightEdge = resolveLatestLiveRightEdge();
        const atLiveTail = isRangeAtLiveTail(normalized, latestRightEdge, toleranceMs);
        liveFollowRef.current = atLiveTail;
        setLiveFollow(atLiveTail);
        if (atLiveTail) {
          liveFollowWindowMsRef.current = Math.max(60_000, normalized.to - normalized.from);
          logTrendDiagnostics("live:follow-auto-resume", {
            reason: "interaction-at-tail",
            rangeFrom: normalized.from,
            rangeTo: normalized.to,
            latestRightEdge,
            toleranceMs,
            spanMs: normalized.to - normalized.from,
          });
        }
      }
      toolbarRangeRef.current = null;
      setRangePreset("custom");
      setToolbarQuickPreset(null);
      pendingToolbarPresetRef.current = null;
    }
    if (source === "interaction" && liveMode) {
      setLiveAutoStopReason(null);
      return;
    }
    if (source === "interaction" && !liveMode && selectedTags.length > 0) {
      maybeRequestPrefetchIfNeeded(normalized);
    }
  };

  const refresh = () => {
    if (liveMode) {
      const span = Math.max(60_000, visibleRange.to - visibleRange.from);
      const now = Date.now();
      const nextRange: TrendVisibleRange = {
        from: now - span,
        to: now,
      };
      liveFollowRef.current = true;
      setLiveFollow(true);
      liveFollowWindowMsRef.current = span;
      setRangePreset(resolveQuickPresetFromRangeSpan(nextRange));
      setVisibleRange(nextRange);
      setCustomFrom(toLocalDateTimeInputValue(nextRange.from));
      setCustomTo(toLocalDateTimeInputValue(nextRange.to));
      if (liveDataSource === "realtimeAppend") {
        void executeLiveBootstrapQuery(nextRange);
      } else {
        void executeQuery(nextRange, {
          force: true,
          context: "live",
          targetMode: "live",
          liveSessionId: liveSessionIdRef.current,
          skipLoadingState: true,
          skipLiveLoadingState: true,
          skipRateLimit: true,
        });
      }
      return;
    }
    const refreshRange = offlineLoadedRangeRef.current ?? resolveInitialLoadedRange(visibleRange);
    offlineLoadedRangeRef.current = refreshRange;
    setOfflineLoadedRange(refreshRange);
    setOfflineResponse(buildEmptyTrendResponse(refreshRange, selectedTags));
    offlineResponseRef.current = buildEmptyTrendResponse(refreshRange, selectedTags);
    setOfflineLoadState("loading");
    void requestBufferedRange(refreshRange, { force: true, replace: true });
  };

  const toggleLiveMode = () => {
    if (!hasSelection) {
      return;
    }
    if (liveMode) {
      if (!liveFollow) {
        const span = Math.max(60_000, visibleRange.to - visibleRange.from);
        const right = Date.now();
        const nextRange: TrendVisibleRange = {
          from: right - span,
          to: right,
        };
        liveFollowWindowMsRef.current = span;
        liveFollowRef.current = true;
        setLiveFollow(true);
        setLiveAutoStopReason(null);
        setVisibleRange(nextRange);
        setCustomFrom(toLocalDateTimeInputValue(nextRange.from));
        setCustomTo(toLocalDateTimeInputValue(nextRange.to));
        logTrendDiagnostics("live:follow-resume", {
          reason: "toolbar",
          from: nextRange.from,
          to: nextRange.to,
          spanMs: span,
        });
        return;
      }
      logTrendDiagnostics("live:toggle-off", {
        reason: "toolbar",
      });
      const frozenRange = normalizeTrendRange(visibleRangeRef.current);
      offlineFrozenRangeRef.current = frozenRange;
      visibleRangeRef.current = frozenRange;
      lastStableVisibleRangeRef.current = frozenRange;
      setError(null);
      setLoading(false);
      invalidateOfflineLoadState("loading");
      setVisibleRange(frozenRange);
      setCustomFrom(toLocalDateTimeInputValue(frozenRange.from));
      setCustomTo(toLocalDateTimeInputValue(frozenRange.to));
      setLiveMode(false);
      liveFollowRef.current = false;
      setLiveFollow(false);
      return;
    }
    const span = Math.max(60_000, visibleRange.to - visibleRange.from);
    const right = Date.now();
    const nextRange: TrendVisibleRange = {
      from: right - span,
      to: right,
    };
    setLiveAutoStopReason(null);
    setError(null);
    setLoading(false);
    offlineFrozenRangeRef.current = null;
    invalidateOfflineLoadState();
    logTrendDiagnostics("live:toggle-on", {
      from: nextRange.from,
      to: nextRange.to,
      selectedTags: selectedTags.map((item) => item.tag),
    });
    setRangePreset(resolveQuickPresetFromRangeSpan(nextRange));
    liveFollowRef.current = true;
    setLiveFollow(true);
    liveFollowWindowMsRef.current = span;
    setVisibleRange(nextRange);
    setCustomFrom(toLocalDateTimeInputValue(nextRange.from));
    setCustomTo(toLocalDateTimeInputValue(nextRange.to));
    setLiveMode(true);
    pendingToolbarPresetRef.current = null;
  };

  const setSeriesPatch = (tagName: string, patch: Partial<TrendTagSelection>) => {
    setSelectedTags((prev) => {
      const next = prev.map((tag) => (tag.tag === tagName ? { ...tag, ...patch } : tag));
      if (Object.prototype.hasOwnProperty.call(patch, "visible")) {
        logTrendDiagnostics("trend:series-visibility-changed", {
          tag: tagName,
          visible: patch.visible !== false,
          visibleCount: next.filter((tag) => tag.visible !== false).length,
          selectedCount: next.length,
          noQuery: true,
        });
      }
      return next;
    });
  };

  const toggleAllSeriesVisibility = () => {
    setSelectedTags((prev) => {
      const hasHiddenSeries = prev.some((tag) => tag.visible === false);
      const next = prev.map((tag) => ({ ...tag, visible: hasHiddenSeries }));
      logTrendDiagnostics("trend:series-visibility-changed", {
        tag: "*",
        visible: hasHiddenSeries,
        visibleCount: next.filter((tag) => tag.visible !== false).length,
        selectedCount: next.length,
        noQuery: true,
      });
      return next;
    });
  };

  const visibleSeriesColumns = DEFAULT_SERIES_COLUMNS;
  const visibleSeriesColumnTemplate = useMemo(
    () => visibleSeriesColumns.map((column) => `${Math.round(seriesColumnWidths[column.id])}px`).join(" "),
    [seriesColumnWidths],
  );
  const loadedPointCountByTag = useMemo(() => {
    const map = new Map<string, number>();
    for (const series of chartResponse?.series ?? []) {
      map.set(series.tag, series.points.length);
    }
    return map;
  }, [chartResponse]);
  const seriesDiagnosticsByTag = useMemo(() => {
    const map = new Map<string, NonNullable<TrendQueryResponse["series"][number]["diagnostics"]>>();
    for (const series of chartResponse?.series ?? []) {
      if (series.diagnostics) {
        map.set(series.tag, series.diagnostics);
      }
    }
    return map;
  }, [chartResponse]);
  const missingHistoryWarnings = useMemo(() => selectedTags
    .filter((tag) => tag.visible !== false)
    .map((tag) => {
      const diagnostics = seriesDiagnosticsByTag.get(tag.tag);
      if (!diagnostics?.missingHistoryBeforeRange) {
        return null;
      }
      const firstPointLabel = formatTrendHistoryTimestamp(diagnostics.firstPointTs);
      return {
        tag: tag.tag,
        message: `${tag.displayName || tag.tag}: no archived value before range start; line starts at first archived sample${firstPointLabel === "-" ? "." : ` (${firstPointLabel}).`}`,
        diagnostics,
      };
    })
    .filter((item): item is { tag: string; message: string; diagnostics: NonNullable<TrendQueryResponse["series"][number]["diagnostics"]> } => item !== null),
  [selectedTags, seriesDiagnosticsByTag]);
  const missingHistoryWarningSummary = missingHistoryWarnings.map((item) => item.message).join(" ");
  const missingHistoryWarningKey = missingHistoryWarnings
    .map((item) => `${item.tag}:${item.diagnostics.rangeFrom}:${item.diagnostics.firstPointTs ?? "-"}`)
    .join("|");
  const loadedSeriesCount = useMemo(
    () => selectedTags.filter((tag) => (loadedPointCountByTag.get(tag.tag) ?? 0) > 0).length,
    [loadedPointCountByTag, selectedTags],
  );
  const visibleSelectedSeriesCount = useMemo(
    () => selectedTags.filter((tag) => tag.visible !== false).length,
    [selectedTags],
  );
  const selectedSeriesCount = selectedTags.length;
  const allSelectedSeriesVisible = selectedSeriesCount > 0 && visibleSelectedSeriesCount === selectedSeriesCount;
  const someSelectedSeriesVisible = visibleSelectedSeriesCount > 0 && visibleSelectedSeriesCount < selectedSeriesCount;
  const visibleAllTitle = allSelectedSeriesVisible
    ? "Hide all series"
    : someSelectedSeriesVisible
      ? "Some series hidden"
      : "Show all series";
  const hasRenderedTrendData = pointCount > 0;
  const showInitialLoadingOverlay = selectedTags.length > 0
    && !error
    && !hasRenderedTrendData
    && (loading || (liveMode && liveHistoryState === "loading") || (!liveMode && offlineLoadState === "loading"));
  const showNoDataOverlay = selectedTags.length > 0
    && !error
    && !showInitialLoadingOverlay
    && Boolean(renderResponse)
    && pointCount === 0
    && ((liveMode && liveHistoryState === "empty") || (!liveMode && offlineLoadState === "empty"));

  useEffect(() => {
    for (const warning of missingHistoryWarnings) {
      logTrendDiagnostics("trend:series-missing-history", {
        ...warning.diagnostics,
      });
    }
  }, [missingHistoryWarningKey, missingHistoryWarnings]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const state = columnResizeStateRef.current;
      if (!state.id) {
        return;
      }
      const delta = event.clientX - state.startX;
      const minWidth = MIN_SERIES_COLUMN_WIDTHS[state.id];
      const next = Math.max(minWidth, Math.round(state.startWidth + delta));
      setSeriesColumnWidths((prev) => ({ ...prev, [state.id as TrendSeriesColumnId]: next }));
    };
    const handleUp = () => {
      if (!columnResizeStateRef.current.id) {
        return;
      }
      columnResizeStateRef.current = { id: null, startX: 0, startWidth: 0 };
      if (typeof document !== "undefined") {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("blur", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("blur", handleUp);
    };
  }, []);

  const startColumnResize = (event: ReactMouseEvent<HTMLDivElement>, columnId: TrendSeriesColumnId) => {
    event.preventDefault();
    event.stopPropagation();
    columnResizeStateRef.current = {
      id: columnId,
      startX: event.clientX,
      startWidth: seriesColumnWidths[columnId],
    };
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    }
  };

  const aggregationLabel = settings.aggregation === "auto" ? `auto -> ${statusAggregation}` : statusAggregation;
  const uiTheme = resolveTrendTheme(settings.theme);
  const chartBackground = settings.theme === "custom" ? normalizeHexColor(settings.background, uiTheme.background) : uiTheme.background;
  const tableTheme = resolveSeriesTableTheme(settings, uiTheme);
  const seriesTableRows = clamp(Math.round(settings.seriesTableRows), 2, 24);
  const seriesTableMaxHeightPx = Math.max(0, tableTheme.headerHeight + (seriesTableRows * tableTheme.rowHeight));
  const shellStyle: CSSProperties = {
    "--trends-theme-bg": chartBackground,
    "--trends-theme-panel": uiTheme.panel,
    "--trends-theme-border": uiTheme.border,
    "--trends-theme-text": uiTheme.text,
    "--trends-theme-muted": uiTheme.mutedText,
    "--trends-theme-accent": uiTheme.accent,
    "--trends-theme-grid": uiTheme.gridLine,
    "--trends-theme-tooltip-bg": uiTheme.tooltipBg,
    "--trends-theme-tooltip-border": uiTheme.tooltipBorder,
    "--trends-theme-toolbar-bg": uiTheme.toolbarBg,
    "--trends-theme-button-bg": uiTheme.buttonBg,
    "--trends-theme-button-hover-bg": uiTheme.buttonHoverBg,
    "--trends-theme-table-bg": uiTheme.tableBg,
    "--trends-theme-table-border": uiTheme.tableBorder,
    "--trends-series-table-max-height": `${seriesTableMaxHeightPx}px`,
    "--trends-series-table-bg": tableTheme.background,
    "--trends-series-table-header-bg": tableTheme.headerBackground,
    "--trends-series-table-text": tableTheme.textColor,
    "--trends-series-table-muted": tableTheme.mutedTextColor,
    "--trends-series-table-border": tableTheme.borderColor,
    "--trends-series-table-hover-bg": tableTheme.hoverBackground,
    "--trends-series-table-value-text": tableTheme.valueTextColor,
    "--trends-series-table-row-height": `${tableTheme.rowHeight}px`,
    "--trends-series-table-header-height": `${tableTheme.headerHeight}px`,
    "--trends-series-table-font-size": `${tableTheme.fontSize}px`,
    "--trends-series-table-cell-padding-x": `${tableTheme.cellPaddingX}px`,
    "--trends-series-table-cell-padding-y": `${tableTheme.cellPaddingY}px`,
  } as CSSProperties;
  const hasSelection = selectedTags.length > 0;

  const openContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };
  const openToolbarMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (contextMenu) {
      setContextMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.left, y: rect.bottom + 4 });
  };
  const runMenuAction = (action: () => void) => {
    action();
    setContextMenu(null);
  };
  const exportDiagnosticsLog = () => {
    const payload = exportTrendDiagnostics({
      objectId: object.id,
      liveMode,
      liveFollow,
      liveRetentionMs,
      rangePreset,
      visibleRange,
      loadedRange: mode === "offline" ? offlineLoadedRange : null,
      selectedTags: selectedTags.map((item) => item.tag),
      settings: {
        aggregation: settings.aggregation,
        maxVisiblePointsPerSeries: settings.maxVisiblePointsPerSeries,
        maxLivePointsPerTag: settings.maxLivePointsPerTag,
        maxCachedRanges: settings.maxCachedRanges,
        progressive: settings.progressive,
        zoomDebounceMs: settings.zoomDebounceMs,
      },
      statusAggregation,
      pointCount,
      bufferedPointCount: pointCount,
      liveBatchCount,
      livePointCount,
      liveSocketState,
      livePendingBufferCap: livePendingBufferCapRef.current,
      memory: buildWidgetDiagnostics(),
      limits: {
        maxOfflineBufferPointsPerSeries: MAX_OFFLINE_BUFFER_POINTS_PER_SERIES,
        maxOfflineBufferPointsTotal: MAX_OFFLINE_BUFFER_POINTS_TOTAL,
        maxOfflineBufferTimeSpanMs: MAX_OFFLINE_BUFFER_TIME_SPAN_MS,
        maxLiveBufferPointsTotal: MAX_LIVE_BUFFER_POINTS_TOTAL,
      },
      cache: cacheRef.current.getStats(),
    });
    downloadTextFile(`trend-diagnostics-${object.id}-${Date.now()}.json`, payload);
  };

  return (
    <div className="trends-widget-shell" style={shellStyle}>
      {object.showToolbar !== false ? (
        <div className="trends-toolbar">
          {settings.showToolbarMenuButton ? (
            <WorkbenchIconButton title="Menu" onClick={openToolbarMenu} icon={<ToolbarGlyph path="M4 7h16M4 12h16M4 17h16" />} />
          ) : null}
          {settings.showToolbarTagsButton ? (
            <WorkbenchIconButton title="Add or Remove Tags" onClick={() => setTagDialogOpen(true)} icon={<ToolbarGlyph path="M4 12h16M12 4v16" />} />
          ) : null}
          {settings.showToolbarLiveButton ? (
            <WorkbenchIconButton
              title={liveMode ? (liveFollow ? "Pause Live" : "Resume Follow") : "Start Live"}
              active={liveMode}
              onClick={toggleLiveMode}
              disabled={!hasSelection}
              icon={liveMode && liveFollow ? <ToolbarGlyph path="M8 6v12M16 6v12" /> : <ToolbarGlyph path="M9 7l9 5-9 5z" />}
            />
          ) : null}
          {settings.showToolbarTimeRangeButton ? (
            <WorkbenchIconButton title="Time Range" onClick={openTimeRangeDialog} disabled={!hasSelection} icon={<ToolbarGlyph path="M8 3v3M16 3v3M4 10h16M7 14h4M4 6h16v14H4z" />} />
          ) : null}
          {settings.showToolbarQuickRangeButtons ? (
            <>
              <WorkbenchIconButton title="Quick 5m" onClick={() => applyPreset("5m")} active={toolbarQuickPreset === "5m"} disabled={!hasSelection} icon={<span className="trends-toolbar__quick">5m</span>} />
              <WorkbenchIconButton title="Quick 15m" onClick={() => applyPreset("15m")} active={toolbarQuickPreset === "15m"} disabled={!hasSelection} icon={<span className="trends-toolbar__quick">15m</span>} />
              <WorkbenchIconButton title="Quick 1h" onClick={() => applyPreset("1h")} active={toolbarQuickPreset === "1h"} disabled={!hasSelection} icon={<span className="trends-toolbar__quick">1h</span>} />
            </>
          ) : null}
          {settings.showToolbarPanButtons ? (
            <>
              <WorkbenchIconButton title="Pan Left" onClick={() => panBy(-1)} disabled={!hasSelection} icon={<ToolbarGlyph path="M14 7l-5 5 5 5M10 12h10" />} />
              <WorkbenchIconButton title="Pan Right" onClick={() => panBy(1)} disabled={!hasSelection} icon={<ToolbarGlyph path="M10 7l5 5-5 5M4 12h10" />} />
            </>
          ) : null}
          {settings.showToolbarZoomButtons ? (
            <>
              <WorkbenchIconButton title="Zoom In" onClick={() => zoomBy(0.7)} disabled={!hasSelection} icon={<ToolbarGlyph path="M11 8v6M8 11h6M21 21l-4.3-4.3M16 11a5 5 0 1 1-10 0 5 5 0 0 1 10 0z" />} />
              <WorkbenchIconButton title="Zoom Out" onClick={() => zoomBy(1.4)} disabled={!hasSelection} icon={<ToolbarGlyph path="M8 11h6M21 21l-4.3-4.3M16 11a5 5 0 1 1-10 0 5 5 0 0 1 10 0z" />} />
            </>
          ) : null}
          {settings.showToolbarRefreshButton ? (
            <WorkbenchIconButton title="Refresh" onClick={refresh} disabled={!hasSelection} icon={<ToolbarGlyph path="M20 6v6h-6M4 18v-6h6M20 12a8 8 0 0 0-14.3-4M4 12a8 8 0 0 0 14.3 4" />} />
          ) : null}
          {canShowScaleEntry ? (
            <WorkbenchIconButton
              title="Scale Settings"
              onClick={() => {
                if (!canOpenRuntimeSettings) {
                  return;
                }
                setSettingsInitialTab("axes");
                setSettingsOpen(true);
              }}
              disabled={!canOpenRuntimeSettings}
              icon={<ToolbarGlyph path="M6 4v16M12 8v12M18 2v18" />}
            />
          ) : null}
          {canShowSettingsEntry ? (
            <WorkbenchIconButton
              title="Settings"
              onClick={() => {
                if (!canOpenRuntimeSettings) {
                  return;
                }
                setSettingsInitialTab("appearance");
                setSettingsOpen(true);
              }}
              disabled={!canOpenRuntimeSettings}
              icon={<SettingOutlined />}
            />
          ) : null}

          <div className="trends-toolbar__meta">
            {loading ? <Spin size="small" /> : null}
            <span>{aggregationLabel}</span>
            <span>{pointCount.toLocaleString()} pts</span>
          </div>
        </div>
      ) : null}

      <div className="trends-chart-wrap trends-chart-wrap--widget" onContextMenu={openContextMenu}>
        {selectedTags.length === 0 ? (
          <div className="trends-empty">No tags selected</div>
        ) : error ? (
          <div className="trends-empty trends-empty--error">{error}</div>
        ) : showInitialLoadingOverlay ? (
          <div className="trends-loading-overlay">
            <Spin size="large" />
            <span>Loading trend data...</span>
          </div>
        ) : showNoDataOverlay ? (
          <div className="trends-empty">No data for selected range</div>
        ) : (
          <>
            <TrendChart
              key={object.id}
              data={renderResponse}
              tags={selectedTags}
              axes={manualAxes}
              axisIdByTag={resolvedAxisIdByTag}
              settings={settings}
              showLegend={false}
              showTooltip={false}
              showDataZoomSlider={false}
              interactiveZoomEnabled={true}
              visibleRange={visibleRange}
              loadedRange={mode === "offline" ? offlineLoadedRange : null}
              liveMode={chartLiveMode}
              liveFollow={liveFollow}
              disableAnimation={liveMode && liveDataSource === "archivePolling"}
              liveWindowMs={liveWindowMs}
              liveRetentionMs={liveRetentionMs}
              onVisibleRangeChange={handleChartRangeChange}
              onHoverSnapshotChange={(snapshot) => {
                if (!snapshot) {
                  if (liveMode) {
                    return;
                  }
                  hoverSnapshotKeyRef.current = "";
                  hoverTimestampRef.current = null;
                  setHoverSeriesValues(null);
                  setHoverTimestamp(null);
                  return;
                }
                const next: Record<string, string> = {};
                for (const [tagName, value] of Object.entries(snapshot.values)) {
                  next[tagName] = formatTrendValue(value);
                }
                const key = `${snapshot.timestamp}|${Object.entries(next).sort(([a], [b]) => a.localeCompare(b)).map(([tag, value]) => `${tag}:${value}`).join("|")}`;
                if (hoverSnapshotKeyRef.current === key && hoverTimestampRef.current === snapshot.timestamp) {
                  return;
                }
                hoverSnapshotKeyRef.current = key;
                hoverTimestampRef.current = snapshot.timestamp;
                setHoverSeriesValues(next);
                setHoverTimestamp(snapshot.timestamp);
              }}
              onChartApiReady={(api) => {
                chartApiRef.current = api;
              }}
              onAxisManualRangeCommit={(axisId, range) => {
                setManualAxes((prev) => {
                  let changed = false;
                  const next = prev.map((axis) => {
                    if (axis.id !== axisId) {
                      return axis;
                    }
                    if (!range) {
                      const nextMin: TrendAxisConfig["min"] = "auto";
                      const nextMax: TrendAxisConfig["max"] = "auto";
                      if (axis.min === nextMin && axis.max === nextMax) {
                        return axis;
                      }
                      changed = true;
                      return { ...axis, min: nextMin, max: nextMax };
                    }
                    if (axis.min === range.min && axis.max === range.max) {
                      return axis;
                    }
                    changed = true;
                    return { ...axis, min: range.min, max: range.max };
                  });
                  return changed ? next : prev;
                });
              }}
            />
            {loading ? (
              <div className="trends-chart-refresh-indicator">
                <Spin size="small" />
              </div>
            ) : null}
          </>
        )}
      </div>

      {missingHistoryWarningSummary ? (
        <div className="trends-history-warning" title={missingHistoryWarningSummary}>
          {missingHistoryWarningSummary}
        </div>
      ) : null}

      {settings.showSeriesTable ? (
        <div className={["trends-series-table-wrap", seriesTableCollapsed ? "trends-series-table-wrap--collapsed" : ""].filter(Boolean).join(" ")}>
          <div className="trends-series-table__summary">
            <WorkbenchIconButton
              className="trends-series-table__collapse-btn"
              title={seriesTableCollapsed ? "Expand series table" : "Collapse series table"}
              onClick={() => setSeriesTableCollapsed((prev) => !prev)}
              icon={<ToolbarGlyph path={seriesTableCollapsed ? "M6 9l6 6 6-6" : "M6 15l6-6 6 6"} />}
            />
          </div>
          {!seriesTableCollapsed ? (
            <div className="trends-series-table">
              <div className="screen-editor-tags-row screen-editor-tags-row--header trends-series-table__row trends-series-table__row--head" style={{ gridTemplateColumns: visibleSeriesColumnTemplate }}>
                {visibleSeriesColumns.map((column, index) => (
                  <div key={column.id} className={`screen-editor-tags-cell screen-editor-tags-header-cell trends-series-table__cell trends-series-table__cell--${column.id} trends-series-table__cell--header`}>
                    {column.id === "visible" ? (
                      <button
                        type="button"
                        className={[
                          "trends-series-table__visibility-all",
                          allSelectedSeriesVisible ? "trends-series-table__visibility-all--all" : "",
                          someSelectedSeriesVisible ? "trends-series-table__visibility-all--mixed" : "",
                        ].filter(Boolean).join(" ")}
                        title={visibleAllTitle}
                        aria-label={visibleAllTitle}
                        aria-pressed={allSelectedSeriesVisible}
                        disabled={selectedSeriesCount === 0}
                        onClick={toggleAllSeriesVisibility}
                      >
                        <span className="trends-series-table__visibility-all-box" aria-hidden="true" />
                      </button>
                    ) : (
                      <span>{column.label}</span>
                    )}
                    {index < visibleSeriesColumns.length - 1 ? (
                      <div className="screen-editor-tags-column-resize-handle trends-series-table__resize-handle" onMouseDown={(event) => startColumnResize(event, column.id)} />
                    ) : null}
                  </div>
                ))}
              </div>
              {selectedTags.map((tag) => (
                <div key={tag.tag} className="screen-editor-tags-row trends-series-table__row" style={{ gridTemplateColumns: visibleSeriesColumnTemplate }}>
                  {visibleSeriesColumns.map((column) => {
                    if (column.id === "visible") {
                      const rowVisibilityTitle = tag.visible === false ? "Show series" : "Hide series";
                      return (
                        <div key={column.id} className="screen-editor-tags-cell trends-series-table__cell trends-series-table__cell--visible">
                          <input
                            className="trends-series-table__visibility-checkbox"
                            type="checkbox"
                            title={rowVisibilityTitle}
                            aria-label={`${rowVisibilityTitle}: ${tag.displayName || tag.tag}`}
                            checked={tag.visible !== false}
                            onChange={(event) => setSeriesPatch(tag.tag, { visible: event.target.checked })}
                          />
                        </div>
                      );
                    }
                    if (column.id === "tag") {
                      const diagnostics = seriesDiagnosticsByTag.get(tag.tag);
                      const archiveWarning = getSparseTrendArchivePolicyWarning(tag.archiveMode ?? tagInfoMap.get(tag.tag)?.archiveMode);
                      const showWarningIcon = Boolean(diagnostics?.missingHistoryBeforeRange || archiveWarning);
                      const warningTooltip = diagnostics?.missingHistoryBeforeRange
                        ? "No archived value before range start"
                        : archiveWarning ?? "History may be incomplete";
                      return (
                        <div
                          key={column.id}
                          className="screen-editor-tags-cell trends-series-table__cell trends-series-table__cell--tag"
                          title={[
                            tag.displayName || tag.tag,
                            diagnostics?.missingHistoryBeforeRange ? "No archived value before range start; line starts at first archived sample." : "",
                            tag.archiveMode || tagInfoMap.get(tag.tag)?.archiveMode
                              ? `Archive: ${formatTrendArchivePolicy(tag.archiveMode ?? tagInfoMap.get(tag.tag)?.archiveMode, tag.archivePeriodMs ?? tagInfoMap.get(tag.tag)?.archivePeriodMs)}`
                              : "",
                            archiveWarning ?? "",
                          ].filter(Boolean).join("\n")}
                        >
                          <span className="trends-series-table__tag-text">{tag.tag}</span>
                          {showWarningIcon ? (
                            <span
                              className="trends-series-table__warning-icon"
                              title={warningTooltip}
                              role="img"
                              aria-label={warningTooltip}
                            >
                              <ToolbarGlyph path="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
                            </span>
                          ) : null}
                        </div>
                      );
                    }
                    if (column.id === "displayName") {
                      return (
                        <div key={column.id} className="screen-editor-tags-cell trends-series-table__cell trends-series-table__cell--display-name" title={tag.displayName || tagInfoMap.get(tag.tag)?.displayName || "-"}>
                          {tag.displayName || tagInfoMap.get(tag.tag)?.displayName || "-"}
                        </div>
                      );
                    }
                    if (column.id === "description") {
                      return (
                        <div key={column.id} className="screen-editor-tags-cell trends-series-table__cell trends-series-table__cell--description" title={tagInfoMap.get(tag.tag)?.description || "-"}>
                          {tagInfoMap.get(tag.tag)?.description || "-"}
                        </div>
                      );
                    }
                    if (column.id === "axis") {
                      const axisId = resolvedAxisIdByTag.get(tag.tag) ?? tag.axisId ?? TREND_DEFAULT_AXIS_ID;
                      const axisLabel = axisLabelById.get(axisId) ?? axisId;
                      return (
                        <div key={column.id} className="screen-editor-tags-cell trends-series-table__cell trends-series-table__cell--axis" title={axisId === axisLabel ? axisId : `${axisLabel} (${axisId})`}>
                          {axisLabel}
                        </div>
                      );
                    }
                    if (column.id === "color") {
                      const colorValue = normalizeHexColor(tag.color, "#4FC3F7");
                      return (
                        <div key={column.id} className="screen-editor-tags-cell trends-series-table__cell trends-series-table__cell--color">
                          <div className="trends-series-table__color-row">
                            <ColorPicker
                              size="small"
                              value={colorValue}
                              onChangeComplete={(color) => setSeriesPatch(tag.tag, { color: color.toHexString() })}
                            />
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={column.id} className="screen-editor-tags-cell trends-series-table__cell trends-series-table__cell--value">
                        {tag.visible === false
                          ? "-"
                          : (hoverSeriesValues?.[tag.tag] ?? seriesLatestValues[tag.tag] ?? ((loadedPointCountByTag.get(tag.tag) ?? 0) === 0 ? "No data" : "-"))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {contextMenu ? (
        <div className="trends-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" className="trends-context-menu__item" onClick={() => runMenuAction(() => setTagDialogOpen(true))}>Add/Remove Tags</button>
          {canShowSettingsEntry ? (
            <button
              type="button"
              className="trends-context-menu__item"
              onClick={() => runMenuAction(() => setSettingsOpen(true))}
              disabled={!canOpenRuntimeSettings}
            >
              Settings
            </button>
          ) : null}
          <button
            type="button"
            className="trends-context-menu__item"
            onClick={() => runMenuAction(toggleLiveMode)}
            disabled={selectedTags.length === 0}
          >
            {liveMode ? (liveFollow ? "Pause Live" : "Resume Follow") : "Start Live"}
          </button>
          <button type="button" className="trends-context-menu__item" onClick={() => runMenuAction(refresh)} disabled={selectedTags.length === 0}>Refresh</button>
          <button
            type="button"
            className="trends-context-menu__item"
            onClick={() => runMenuAction(() => {
              setSelectedTags([]);
              setOfflineResponse(null);
              setOfflineLoadedRange(null);
              invalidateOfflineLoadState();
              offlineLoadedRangeRef.current = null;
              offlineResponseRef.current = null;
              setLiveResponse(null);
              setError(null);
            })}
            disabled={selectedTags.length === 0}
          >
            Clear Series
          </button>
          <div className="trends-context-menu__separator" />
          <button type="button" className="trends-context-menu__item" onClick={() => runMenuAction(() => applyPreset("5m"))}>Last 5 min</button>
          <button type="button" className="trends-context-menu__item" onClick={() => runMenuAction(() => applyPreset("15m"))}>Last 15 min</button>
          <button type="button" className="trends-context-menu__item" onClick={() => runMenuAction(() => applyPreset("1h"))}>Last 1 hour</button>
          <button type="button" className="trends-context-menu__item" onClick={() => runMenuAction(() => applyPreset("8h"))}>Last 8 hours</button>
          <button type="button" className="trends-context-menu__item" onClick={() => runMenuAction(() => applyPreset("24h"))}>Last 24 hours</button>
          <button type="button" className="trends-context-menu__item" onClick={() => runMenuAction(openTimeRangeDialog)}>Custom range...</button>
          <div className="trends-context-menu__separator" />
          <button type="button" className="trends-context-menu__item" onClick={() => runMenuAction(exportDiagnosticsLog)}>Export diagnostics log...</button>
        </div>
      ) : null}

      {object.showStatusBar !== false ? (
        <div className="trends-status-bar">
          <span>Backend: {connectionState}</span>
          <span>Range: {formatRangeLabel(visibleRange.from, visibleRange.to)}</span>
          <span>Series: {selectedTags.length}</span>
          <span>Loaded: {loadedSeriesCount}/{selectedTags.length}</span>
          <span>Points: {pointCount.toLocaleString()}</span>
          <span>Aggregation: {aggregationLabel}</span>
          <span>Last load: {lastLoadAt ? new Date(lastLoadAt).toLocaleTimeString() : "-"}</span>
          <span>Live WS: {liveSocketState}</span>
          <span>Live history: {liveMode ? `${liveHistoryState} (${liveHistoryPointCount.toLocaleString()} pts)` : "-"}</span>
          {missingHistoryWarningSummary ? <span title={missingHistoryWarningSummary}>History: {missingHistoryWarningSummary}</span> : null}
          {historyWarning ? <span>History: {historyWarning}</span> : null}
        </div>
      ) : null}

      <TrendWorkbenchDialog
        id="trend-time-range-dialog"
        title="Time Range"
        open={timeRangeDialogOpen}
        defaultRect={{ x: 260, y: 120, width: 440, height: 300 }}
        minWidth={400}
        minHeight={250}
        bodyClassName="trends-time-range-dialog-body"
        footer={(
          <>
            <WorkbenchButton onClick={() => setTimeRangeDialogOpen(false)}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={applyDialogCustomRange}>Apply</WorkbenchButton>
          </>
        )}
        onClose={() => setTimeRangeDialogOpen(false)}
      >
        <div className="trends-time-range">
          <div className="trends-time-range__presets">
            <button type="button" className="workbench-button" onClick={() => applyDialogPreset("5m")}>5m</button>
            <button type="button" className="workbench-button" onClick={() => applyDialogPreset("15m")}>15m</button>
            <button type="button" className="workbench-button" onClick={() => applyDialogPreset("1h")}>1h</button>
            <button type="button" className="workbench-button" onClick={() => applyDialogPreset("8h")}>8h</button>
            <button type="button" className="workbench-button" onClick={() => applyDialogPreset("24h")}>24h</button>
          </div>
          <label className="workbench-field">
            <span className="workbench-field__label">From</span>
            <input
              className="workbench-input"
              type="datetime-local"
              value={timeRangeDraftFrom}
              onChange={(event) => setTimeRangeDraftFrom(event.target.value)}
            />
          </label>
          <label className="workbench-field">
            <span className="workbench-field__label">To</span>
            <input
              className="workbench-input"
              type="datetime-local"
              value={timeRangeDraftTo}
              onChange={(event) => setTimeRangeDraftTo(event.target.value)}
            />
          </label>
        </div>
      </TrendWorkbenchDialog>

      <TrendTagPickerDialog
        open={tagDialogOpen}
        tags={allTags}
        selectedTags={selectedTags}
        axes={axes}
        initialFilters={tagPickerFilters}
        onClose={() => setTagDialogOpen(false)}
        onFiltersChange={setTagPickerFilters}
        onApply={(nextTags, nextAxes) => {
          setSelectedTags(nextTags);
          setManualAxes(normalizeTrendAxes(nextAxes, settings));
          setTagDialogOpen(false);
        }}
      />

      <TrendSettingsPanel
        open={settingsOpen}
        settings={settings}
        axes={axes}
        selectedTags={selectedTags}
        initialTab={settingsInitialTab}
        onClose={() => setSettingsOpen(false)}
        onSettingsChange={(next) => {
          const maxVisiblePointsPerSeries = clamp(
            Number(next.maxVisiblePointsPerSeries ?? next.maxPointsPerSeries),
            1000,
            8000,
          );
          const maxCachedRanges = clamp(
            Number(next.maxCachedRanges ?? next.cacheSize),
            8,
            256,
          );
          const maxLivePointsPerTag = clamp(
            Number(next.maxLivePointsPerTag ?? next.liveBufferLimit),
            200,
            20000,
          );
          setSettings({
            ...next,
            renderer: "echarts",
            liveDataSource: next.liveDataSource === "realtimeAppend" ? "realtimeAppend" : DEFAULT_LIVE_DATA_SOURCE,
            maxVisiblePointsPerSeries,
            maxLivePointsPerTag,
            maxCachedRanges,
            // Legacy aliases.
            maxPointsPerSeries: maxVisiblePointsPerSeries,
            cacheSize: maxCachedRanges,
            liveBufferLimit: maxLivePointsPerTag,
            zoomDebounceMs: clamp(next.zoomDebounceMs, 100, 1200),
            refreshIntervalMs: clamp(next.refreshIntervalMs, 500, 60000),
            liveResyncEnabled: Boolean(next.liveResyncEnabled),
            liveResyncIntervalSec: clamp(next.liveResyncIntervalSec, LIVE_REALTIME_RESYNC_MIN_SEC, LIVE_REALTIME_RESYNC_MAX_SEC),
            realtimeAppendSnapshotAggregation:
              next.realtimeAppendSnapshotAggregation === "raw" || next.realtimeAppendSnapshotAggregation === "minmax"
                ? next.realtimeAppendSnapshotAggregation
                : "auto",
            realtimeAppendSnapshotMaxPoints: clamp(next.realtimeAppendSnapshotMaxPoints, 1000, 8000),
            realtimeAppendFlushMs: clamp(next.realtimeAppendFlushMs, LIVE_REALTIME_FLUSH_MIN_MS, LIVE_REALTIME_FLUSH_MAX_MS),
            axisOffsetStep: clamp(next.axisOffsetStep, 8, 220),
            axisScaleGap: clamp(next.axisScaleGap, 0, 64),
          });
        }}
        onAxesChange={setManualAxes}
        onSelectedTagsChange={setSelectedTags}
      />
    </div>
  );
}
