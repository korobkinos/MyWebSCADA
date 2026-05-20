import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { TrendAxisConfig, TrendChartApi, TrendPoint, TrendQueryResponse, TrendSettings, TrendTagSelection, TrendVisibleRange } from "./trendTypes";
import { isTrendPerfDebugEnabled, logTrendDiagnostics } from "./trendDiagnostics";
import { resolveTrendTheme } from "./trendTheme";
import { applyTrendVisualHolds, buildTrendDataMatrixWithGaps, normalizeTrendPoints, resolveTrendGapBreakMs, type TrendVisualHoldSpec } from "./trendUtils";

const LIVE_TRIM_GRACE_MS = 15_000;
const LIVE_DOMAIN_GRACE_MS = 1500;
const LIVE_MIN_SERIES_POINT_CAP = 200;
const LIVE_MAX_SERIES_POINT_CAP = 20_000;
const UPLOT_MIN_GAP_BREAK_MS = 20_000;
const LIVE_FOLLOW_INTERVAL_MS = 120;
const LIVE_FOLLOW_EMIT_INTERVAL_MS = 750;
const LIVE_FOLLOW_SCALE_QUANTUM_MS = 500;
const LIVE_CARRY_FORWARD_REBUILD_INTERVAL_MS = 500;
const LIVE_APPEND_REBUILD_MIN_INTERVAL_MS = 500;
const LIVE_SOURCE_HEARTBEAT_STALE_MS = 3500;
const LIVE_STICKY_Y_PADDING_RATIO = 0.25;
const LIVE_STICKY_Y_MIN_FLOOR = 0.1;

type TrendChartProps = {
  data: TrendQueryResponse | null;
  tags: TrendTagSelection[];
  axes: TrendAxisConfig[];
  axisIdByTag: Map<string, string>;
  settings: TrendSettings;
  showLegend?: boolean;
  showTooltip?: boolean;
  showDataZoomSlider?: boolean;
  interactiveZoomEnabled?: boolean;
  visibleRange: TrendVisibleRange;
  liveMode: boolean;
  liveWindowMs: number;
  onVisibleRangeChange: (range: TrendVisibleRange, source: "interaction" | "live") => void;
  onHoverSnapshotChange?: (snapshot: { timestamp: number; values: Record<string, number | boolean | string | null> } | null) => void;
  onChartApiReady?: (api: TrendChartApi) => void;
  onAxisManualRangeCommit?: (axisId: string, range: { min: number; max: number } | null) => void;
};

type SanitizedMatrixDiagnostics = {
  xUnsortedCount: number;
  xDuplicateCount: number;
  invalidTimestampCount: number;
  seriesLengthMismatchCount: number;
  invalidValueCount: number;
  nonNullCount: number;
  explicitNullCount: number;
  alignmentNullCount: number;
};

type SanitizedMatrixResult = {
  aligned: uPlot.AlignedData;
  diagnostics: SanitizedMatrixDiagnostics;
};

type NumericRange = {
  min: number;
  max: number;
};

type LiveStickyYScaleResult = {
  yScaleApplied: boolean;
  yScaleReason: "none" | "init" | "init-fallback" | "expand";
};

function buildSeriesPointMapFromQueryData(data: TrendQueryResponse | null, activeTagNames: Set<string>): Map<string, TrendPoint[]> {
  const historyMap = new Map<string, TrendPoint[]>();
  for (const series of data?.series ?? []) {
    historyMap.set(series.tag, normalizeTrendPoints(series.points));
  }

  const nextMap = new Map<string, TrendPoint[]>();
  for (const tagName of activeTagNames) {
    nextMap.set(tagName, historyMap.get(tagName) ?? []);
  }
  return nextMap;
}

function resolveLiveSeriesPointCap(liveBufferLimit: number): number {
  if (!Number.isFinite(liveBufferLimit)) {
    return LIVE_MIN_SERIES_POINT_CAP;
  }
  const normalized = Math.round(liveBufferLimit);
  return Math.max(LIVE_MIN_SERIES_POINT_CAP, Math.min(LIVE_MAX_SERIES_POINT_CAP, normalized));
}

function resolveNumericValue(value: number | boolean | string | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return value === null ? null : null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatUPlotTimeTick(timestampMs: number, rangeMs: number): string {
  const date = new Date(timestampMs);
  if (!Number.isFinite(date.getTime())) {
    return "-";
  }
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  if (rangeMs <= 2 * 60 * 60 * 1000) {
    return `${hh}:${mm}:${pad2(date.getSeconds())}`;
  }
  if (rangeMs <= 24 * 60 * 60 * 1000) {
    return `${hh}:${mm}`;
  }
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)} ${hh}:${mm}`;
}

function createEmptyAlignedData(seriesCount: number): uPlot.AlignedData {
  const aligned: uPlot.AlignedData = [[]];
  for (let index = 0; index < seriesCount; index += 1) {
    aligned.push([]);
  }
  return aligned;
}

function sanitizeAlignedMatrix(aligned: uPlot.AlignedData): SanitizedMatrixResult {
  const xSource = (Array.isArray(aligned[0]) ? aligned[0] : []) as Array<number | null | undefined>;
  let xUnsortedCount = 0;
  let xDuplicateCount = 0;
  let invalidTimestampCount = 0;

  let previousFiniteTs = Number.NaN;
  for (let index = 0; index < xSource.length; index += 1) {
    const current = xSource[index];
    if (!Number.isFinite(current)) {
      invalidTimestampCount += 1;
      continue;
    }
    if (Number.isFinite(previousFiniteTs)) {
      if (current! < previousFiniteTs) {
        xUnsortedCount += 1;
      } else if (current === previousFiniteTs) {
        xDuplicateCount += 1;
      }
    }
    previousFiniteTs = current as number;
  }

  const sorted = xSource
    .map((timestamp, index) => ({ timestamp, index }))
    .filter((item) => Number.isFinite(item.timestamp)) as Array<{ timestamp: number; index: number }>;

  sorted.sort((a, b) => (a.timestamp - b.timestamp) || (a.index - b.index));

  const deduped: Array<{ timestamp: number; sourceIndex: number }> = [];
  for (const item of sorted) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.timestamp === item.timestamp) {
      previous.sourceIndex = item.index;
      continue;
    }
    deduped.push({ timestamp: item.timestamp, sourceIndex: item.index });
  }

  const xValues = deduped.map((item) => item.timestamp);
  const fixed: uPlot.AlignedData = [xValues];

  let seriesLengthMismatchCount = 0;
  let invalidValueCount = 0;
  let nonNullCount = 0;
  let explicitNullCount = 0;
  let alignmentNullCount = 0;

  for (let seriesIndex = 1; seriesIndex < aligned.length; seriesIndex += 1) {
    const source = aligned[seriesIndex] as Array<number | null | undefined> | undefined;
    if (!source || source.length !== xSource.length) {
      seriesLengthMismatchCount += 1;
    }
    const target = new Array<number | null | undefined>(xValues.length).fill(undefined);
    for (let index = 0; index < deduped.length; index += 1) {
      const sourceIndex = deduped[index]!.sourceIndex;
      const value = source?.[sourceIndex];
      if (typeof value === "number" && Number.isFinite(value)) {
        target[index] = value;
        nonNullCount += 1;
      } else if (value === null) {
        target[index] = null;
        explicitNullCount += 1;
      } else {
        // undefined means "no sample exactly at this aligned timestamp" and should not create a hard gap.
        target[index] = undefined;
        alignmentNullCount += 1;
        if (typeof value === "number" && !Number.isFinite(value)) {
          invalidValueCount += 1;
        }
      }
    }
    fixed.push(target);
  }

  return {
    aligned: fixed,
    diagnostics: {
      xUnsortedCount,
      xDuplicateCount,
      invalidTimestampCount,
      seriesLengthMismatchCount,
      invalidValueCount,
      nonNullCount,
      explicitNullCount,
      alignmentNullCount,
    },
  };
}

function resolveNumericRangeFromValuesByTag(valuesByTag: Map<string, Array<number | null | undefined>>): NumericRange | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const values of valuesByTag.values()) {
    for (const value of values) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        continue;
      }
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  return { min, max };
}

function expandNumericRange(range: NumericRange): NumericRange {
  const span = range.max - range.min;
  const padding = span > 0
    ? span * LIVE_STICKY_Y_PADDING_RATIO
    : Math.max(Math.abs(range.max) * LIVE_STICKY_Y_PADDING_RATIO, LIVE_STICKY_Y_MIN_FLOOR);
  return {
    min: range.min - padding,
    max: range.max + padding,
  };
}

export function TrendChartUPlot({
  data,
  tags,
  axes,
  axisIdByTag,
  settings,
  interactiveZoomEnabled = true,
  visibleRange,
  liveMode,
  liveWindowMs,
  onVisibleRangeChange,
  onHoverSnapshotChange,
  onChartApiReady,
  onAxisManualRangeCommit,
}: TrendChartProps) {
  void axes;
  void axisIdByTag;
  void onAxisManualRangeCommit;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const seriesPointsRef = useRef<Map<string, TrendPoint[]>>(new Map());
  const fullRangeRef = useRef<TrendVisibleRange>(visibleRange);
  const liveModeRef = useRef(liveMode);
  const liveWindowMsRef = useRef(liveWindowMs);
  const visibleRangeRef = useRef(visibleRange);
  const onVisibleRangeChangeRef = useRef(onVisibleRangeChange);
  const tagsRef = useRef(tags);
  const settingsRef = useRef(settings);

  const pendingRenderRafRef = useRef<number | null>(null);
  const pendingRenderResetScalesRef = useRef(false);
  const pendingRenderReasonRef = useRef<string>("initial");

  const liveLastEmittedRightRef = useRef<number | null>(null);
  const liveLastScaledRightRef = useRef<number | null>(null);
  const suppressSetScaleHookRef = useRef(false);
  const liveSeriesPointCapRef = useRef(resolveLiveSeriesPointCap(settings.liveBufferLimit));
  const liveFollowTimerRef = useRef<number | null>(null);
  const liveAppendRebuildTimerRef = useRef<number | null>(null);
  const liveFollowTickCountRef = useRef(0);
  const liveLastRangeEmitAtRef = useRef(0);
  const liveSourceHeartbeatAtRef = useRef<number>(0);
  const liveLastAppendAtRef = useRef(0);
  const liveLastAppendRebuildAtRef = useRef(0);
  const liveLastCarryForwardRebuildAtRef = useRef(0);
  const liveIgnoredPropSyncCountRef = useRef(0);
  const liveStickyYRangeRef = useRef<NumericRange | null>(null);

  const plotSeriesTagsRef = useRef<TrendTagSelection[]>([]);
  const latestDataPointCountRef = useRef(0);
  const appendLivePointsCallCountRef = useRef(0);
  const setDataCallCountRef = useRef(0);
  const setScaleCallCountRef = useRef(0);
  const setScaleYCallCountRef = useRef(0);
  const setDataDurationTotalRef = useRef(0);
  const lastLiveBatchSizeRef = useRef(0);

  const structureSignature = useMemo(() => JSON.stringify({
    activeTags: tags
      .filter((tag) => tag.visible !== false)
      .map((tag) => ({
        tag: tag.tag,
        color: tag.color,
        width: tag.lineWidth,
        mode: tag.mode,
        step: tag.step,
      })),
    theme: settings.theme,
    background: settings.background,
    axisLabels: settings.axisLabels,
    autoScale: settings.autoScale,
    gridLines: settings.gridLines,
    defaultLineWidth: settings.defaultLineWidth,
    interactiveZoomEnabled,
  }), [interactiveZoomEnabled, settings.autoScale, settings.axisLabels, settings.background, settings.defaultLineWidth, settings.gridLines, settings.theme, tags]);

  const applyVisibleRangeToPlot = (nextRange: TrendVisibleRange, reason: string): void => {
    const plot = plotRef.current;
    if (!plot) {
      return;
    }
    if (!Number.isFinite(nextRange.from) || !Number.isFinite(nextRange.to) || nextRange.to <= nextRange.from) {
      return;
    }
    suppressSetScaleHookRef.current = true;
    try {
      plot.setScale("x", { min: nextRange.from, max: nextRange.to });
      setScaleCallCountRef.current += 1;
    } finally {
      suppressSetScaleHookRef.current = false;
    }
    if (isTrendPerfDebugEnabled()) {
      logTrendDiagnostics("uplot:set-scale", {
        renderer: "uplot",
        reason,
        min: nextRange.from,
        max: nextRange.to,
        setScaleCalls: setScaleCallCountRef.current,
      });
    }
  };

  const applyLiveStickyYScale = (
    dataRange: NumericRange | null,
    reason: string,
  ): LiveStickyYScaleResult => {
    if (!liveModeRef.current || !settingsRef.current.autoScale || !dataRange) {
      return {
        yScaleApplied: false,
        yScaleReason: "none",
      };
    }

    const previous = liveStickyYRangeRef.current;
    if (!previous) {
      const initialized = expandNumericRange(dataRange);
      liveStickyYRangeRef.current = initialized;
      if (isTrendPerfDebugEnabled()) {
        logTrendDiagnostics("uplot:y-scale-sticky", {
          renderer: "uplot",
          reason,
          dataRange,
          previous,
          next: initialized,
          changed: true,
          expanded: false,
          yScaleApplied: false,
          yScaleReason: "init",
          yRangeAfterSticky: initialized,
          setScaleYCalls: setScaleYCallCountRef.current,
        });
      }
      return {
        yScaleApplied: false,
        yScaleReason: "init",
      };
    }

    let next = previous;
    let changed = false;
    let expanded = false;

    const exceeded = dataRange.min < previous.min || dataRange.max > previous.max;
    if (exceeded) {
      next = expandNumericRange({
        min: Math.min(previous.min, dataRange.min),
        max: Math.max(previous.max, dataRange.max),
      });
      changed = next.min !== previous.min || next.max !== previous.max;
      expanded = true;
    }

    if (!next || (!changed && !expanded)) {
      return {
        yScaleApplied: false,
        yScaleReason: "none",
      };
    }

    liveStickyYRangeRef.current = next;

    if (!isTrendPerfDebugEnabled()) {
      return {
        yScaleApplied: false,
        yScaleReason: expanded ? "expand" : "none",
      };
    }

    logTrendDiagnostics("uplot:y-scale-sticky", {
      renderer: "uplot",
      reason,
      dataRange,
      previous,
      next,
      changed,
      expanded,
      yScaleApplied: false,
      yScaleReason: expanded ? "expand" : "none",
      yRangeAfterSticky: next,
      setScaleYCalls: setScaleYCallCountRef.current,
    });

    if (expanded) {
      logTrendDiagnostics("uplot:y-scale-expand", {
        renderer: "uplot",
        reason,
        dataRange,
        previous,
        next,
        yScaleApplied: false,
        yScaleReason: "expand",
        setScaleYCalls: setScaleYCallCountRef.current,
      });
    }

    return {
      yScaleApplied: false,
      yScaleReason: expanded ? "expand" : "none",
    };
  };

  const buildLiveVisualHolds = (gapBreakMsByTag: Map<string, number>, rightEdgeTs: number): TrendVisualHoldSpec[] => {
    const now = Date.now();
    const heartbeatAgeMs = now - liveSourceHeartbeatAtRef.current;
    const sourceAlive = heartbeatAgeMs <= LIVE_SOURCE_HEARTBEAT_STALE_MS;
    const holds: TrendVisualHoldSpec[] = [];
    for (const tag of plotSeriesTagsRef.current) {
      const points = seriesPointsRef.current.get(tag.tag) ?? [];
      let latestNumericTs = Number.NaN;
      let latestNumericValue = Number.NaN;
      for (let index = points.length - 1; index >= 0; index -= 1) {
        const point = points[index];
        if (!point) {
          continue;
        }
        if (typeof point.v === "number" && Number.isFinite(point.v)) {
          latestNumericTs = point.t;
          latestNumericValue = point.v;
          break;
        }
      }
      if (!Number.isFinite(latestNumericTs) || !Number.isFinite(latestNumericValue)) {
        continue;
      }
      void gapBreakMsByTag;
      const stale = !sourceAlive;
      holds.push({
        tag: tag.tag,
        value: latestNumericValue,
        holdTs: rightEdgeTs,
        stale,
      });
    }
    return holds;
  };

  const rebuildPlotData = (reason: string, resetScales = false): void => {
    const plot = plotRef.current;
    if (!plot) {
      return;
    }

    const startedAt = isTrendPerfDebugEnabled() ? performance.now() : 0;
    const gapBreakMsByTag = new Map<string, number>();
    const sources = plotSeriesTagsRef.current.map((tag) => {
      const points = seriesPointsRef.current.get(tag.tag) ?? [];
      gapBreakMsByTag.set(tag.tag, Math.max(UPLOT_MIN_GAP_BREAK_MS, resolveTrendGapBreakMs(points)));
      return {
        tag: tag.tag,
        points: points.map((point) => (point.q === "bad" ? point : { ...point, q: "good" as const })),
      };
    });

    const matrix = buildTrendDataMatrixWithGaps(sources, {
      showBadQualityGaps: settingsRef.current.showBadQualityGaps,
      gapBreakMsByTag,
    });
    const liveSourceAlive = Date.now() - liveSourceHeartbeatAtRef.current <= LIVE_SOURCE_HEARTBEAT_STALE_MS;

    const liveRightEdge =
      liveLastEmittedRightRef.current
      ?? (Number.isFinite(visibleRangeRef.current.to) ? visibleRangeRef.current.to : Date.now());
    const holds = liveModeRef.current ? buildLiveVisualHolds(gapBreakMsByTag, liveRightEdge) : [];
    const withHolds = liveModeRef.current ? applyTrendVisualHolds(matrix, holds) : null;
    const rawDataYRange = resolveNumericRangeFromValuesByTag(matrix.valuesByTag);

    const xValues = withHolds?.xValues ?? matrix.xValues;
    const valuesByTag = withHolds?.valuesByTag ?? matrix.valuesByTag;
    const rawAligned: uPlot.AlignedData = [xValues];
    for (const tag of plotSeriesTagsRef.current) {
      rawAligned.push(valuesByTag.get(tag.tag) ?? new Array<number | null | undefined>(xValues.length).fill(undefined));
    }

    const sanitized = sanitizeAlignedMatrix(rawAligned);
    const aligned = sanitized.aligned;
    latestDataPointCountRef.current = matrix.pointCount;

    const yRangeBefore = {
      min: Number(plot.scales.y?.min),
      max: Number(plot.scales.y?.max),
    };
    const stickyYScaleResult = applyLiveStickyYScale(rawDataYRange, reason);
    const setDataStartedAt = isTrendPerfDebugEnabled() ? performance.now() : 0;
    plot.setData(aligned, resetScales);
    setDataCallCountRef.current += 1;
    const yRangeAfter = {
      min: Number(plot.scales.y?.min),
      max: Number(plot.scales.y?.max),
    };
    const yRangeAfterSticky = {
      min: Number(plot.scales.y?.min),
      max: Number(plot.scales.y?.max),
    };
    if (!liveModeRef.current) {
      applyVisibleRangeToPlot(visibleRangeRef.current, "data-sync");
    }

    if (!isTrendPerfDebugEnabled()) {
      return;
    }

    const setDataDurationMs = performance.now() - setDataStartedAt;
    setDataDurationTotalRef.current += setDataDurationMs;

    const invalidCount =
      sanitized.diagnostics.xUnsortedCount
      + sanitized.diagnostics.xDuplicateCount
      + sanitized.diagnostics.invalidTimestampCount
      + sanitized.diagnostics.seriesLengthMismatchCount
      + sanitized.diagnostics.invalidValueCount;

    if (invalidCount > 0) {
      logTrendDiagnostics("uplot:data-matrix-invalid", {
        renderer: "uplot",
        xUnsortedCount: sanitized.diagnostics.xUnsortedCount,
        xDuplicateCount: sanitized.diagnostics.xDuplicateCount,
        invalidTimestampCount: sanitized.diagnostics.invalidTimestampCount,
        seriesLengthMismatchCount: sanitized.diagnostics.seriesLengthMismatchCount,
        invalidValueCount: sanitized.diagnostics.invalidValueCount,
      });
    }

    logTrendDiagnostics(liveModeRef.current ? "uplot:set-data-live" : "uplot:set-data", {
      renderer: "uplot",
      xUnit: "ms",
      reason,
      xCount: aligned[0]?.length ?? 0,
      seriesCount: plotSeriesTagsRef.current.length,
      totalNonNullCount: sanitized.diagnostics.nonNullCount,
      explicitNullCount: sanitized.diagnostics.explicitNullCount,
      alignmentNullCount: sanitized.diagnostics.alignmentNullCount,
      visualHoldCount: withHolds?.diagnostics.heldTagCount ?? 0,
      visualHoldStaleTagCount: withHolds?.diagnostics.staleTagCount ?? 0,
      duplicateTimestampsRemoved: matrix.diagnostics.duplicateTimestampCountRemoved + sanitized.diagnostics.xDuplicateCount,
      invalidTimestampsRemoved: matrix.diagnostics.invalidTimestampCount + sanitized.diagnostics.invalidTimestampCount,
      setDataDurationMs: Math.round(setDataDurationMs * 1000) / 1000,
      totalDurationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
      liveBatchSize: lastLiveBatchSizeRef.current,
      pointCount: matrix.pointCount,
      gapBreakCount: matrix.gapBreakCount,
      duplicateTimestampCountBeforeDedupe: matrix.diagnostics.duplicateTimestampCountBeforeDedupe,
      unsortedInputCount: matrix.diagnostics.unsortedPairCount,
      setDataCalls: setDataCallCountRef.current,
      setScaleCalls: setScaleCallCountRef.current,
      setScaleYCalls: setScaleYCallCountRef.current,
      appendLivePointsCalls: appendLivePointsCallCountRef.current,
      setDataDurationTotalMs: Math.round(setDataDurationTotalRef.current * 1000) / 1000,
      yRangeBefore,
      yRangeAfter,
      yRangeAfterSticky,
      stickyYRange: liveStickyYRangeRef.current,
      rawDataYRange,
      yScaleApplied: stickyYScaleResult.yScaleApplied,
      yScaleReason: stickyYScaleResult.yScaleReason,
      seriesDiagnostics: matrix.diagnostics.series.map((item) => ({
        tag: item.tag,
        firstTs: item.firstTs,
        lastTs: item.lastTs,
        gapBreakMs: item.gapBreakMs,
        realGapCount: item.realGapCount,
        explicitNullCount: item.nullCount,
        alignmentNullCount: item.alignmentNullCount,
      })),
    });

    if (withHolds) {
      logTrendDiagnostics("uplot:visual-hold", {
        renderer: "uplot",
        sourceAlive: liveSourceAlive,
        heldTagCount: withHolds.diagnostics.heldTagCount,
        staleTagCount: withHolds.diagnostics.staleTagCount,
        holdTs: withHolds.diagnostics.holdTs,
        xExtended: withHolds.diagnostics.xExtended,
      });
      if (withHolds.diagnostics.staleTagCount > 0) {
        logTrendDiagnostics("uplot:stale-tag-gap", {
          renderer: "uplot",
          staleTagCount: withHolds.diagnostics.staleTagCount,
          reason,
        });
      }
    }

    logTrendDiagnostics("uplot:y-scale-range", {
      renderer: "uplot",
      reason,
      yRangeBefore,
      yRangeAfter,
      yRangeAfterSticky,
    });
  };

  const scheduleRebuildPlotData = (reason: string, resetScales = false): void => {
    if (pendingRenderRafRef.current !== null) {
      pendingRenderResetScalesRef.current = pendingRenderResetScalesRef.current || resetScales;
      pendingRenderReasonRef.current = reason;
      return;
    }
    pendingRenderResetScalesRef.current = resetScales;
    pendingRenderReasonRef.current = reason;
    pendingRenderRafRef.current = window.requestAnimationFrame(() => {
      pendingRenderRafRef.current = null;
      const nextResetScales = pendingRenderResetScalesRef.current;
      const nextReason = pendingRenderReasonRef.current;
      pendingRenderResetScalesRef.current = false;
      rebuildPlotData(nextReason, nextResetScales);
    });
  };

  const scheduleAppendLiveRebuild = (): void => {
    if (!liveModeRef.current) {
      scheduleRebuildPlotData("append-live-points", false);
      return;
    }
    const now = Date.now();
    const elapsed = now - liveLastAppendRebuildAtRef.current;
    if (elapsed >= LIVE_APPEND_REBUILD_MIN_INTERVAL_MS) {
      liveLastAppendRebuildAtRef.current = now;
      scheduleRebuildPlotData("append-live-points", true);
      return;
    }
    if (liveAppendRebuildTimerRef.current !== null) {
      return;
    }
    const delay = Math.max(0, LIVE_APPEND_REBUILD_MIN_INTERVAL_MS - elapsed);
    liveAppendRebuildTimerRef.current = window.setTimeout(() => {
      liveAppendRebuildTimerRef.current = null;
      liveLastAppendRebuildAtRef.current = Date.now();
      scheduleRebuildPlotData("append-live-points-throttled", true);
    }, delay);
  };

  useEffect(() => {
    tagsRef.current = tags;
  }, [tags]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    liveModeRef.current = liveMode;
    if (liveMode) {
      liveSourceHeartbeatAtRef.current = Date.now();
      liveLastAppendAtRef.current = Date.now();
      liveLastAppendRebuildAtRef.current = 0;
      liveLastCarryForwardRebuildAtRef.current = 0;
      liveLastRangeEmitAtRef.current = 0;
      liveFollowTickCountRef.current = 0;
      liveLastScaledRightRef.current = null;
    } else {
      liveStickyYRangeRef.current = null;
      liveLastScaledRightRef.current = null;
      if (liveAppendRebuildTimerRef.current !== null) {
        window.clearTimeout(liveAppendRebuildTimerRef.current);
        liveAppendRebuildTimerRef.current = null;
      }
    }
  }, [liveMode]);

  useEffect(() => {
    liveWindowMsRef.current = liveWindowMs;
  }, [liveWindowMs]);

  useEffect(() => {
    visibleRangeRef.current = visibleRange;
  }, [visibleRange]);

  useEffect(() => {
    onVisibleRangeChangeRef.current = onVisibleRangeChange;
  }, [onVisibleRangeChange]);

  useEffect(() => {
    liveSeriesPointCapRef.current = resolveLiveSeriesPointCap(settings.liveBufferLimit);
  }, [settings.liveBufferLimit]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const plotSeriesTags = tags.filter((tag) => tag.visible !== false);
    plotSeriesTagsRef.current = plotSeriesTags;

    if (plotRef.current) {
      plotRef.current.destroy();
      plotRef.current = null;
    }

    const uiTheme = resolveTrendTheme(settings.theme);

    const stepped = typeof uPlot.paths?.stepped === "function"
      ? uPlot.paths.stepped({ align: 1, ascDesc: false })
      : undefined;

    const uplotSeries: uPlot.Series[] = [
      {
        label: "time",
        value: (self: uPlot, value: number) => {
          const min = Number(self.scales.x?.min);
          const max = Number(self.scales.x?.max);
          const rangeMs = Number.isFinite(min) && Number.isFinite(max) ? Math.max(0, max - min) : 0;
          return formatUPlotTimeTick(value, rangeMs);
        },
      },
    ];

    for (const tag of plotSeriesTags) {
      const mode = tag.mode ?? "line";
      const isStep = tag.step || mode === "step";
      uplotSeries.push({
        label: tag.displayName || tag.tag,
        scale: "y",
        stroke: tag.color,
        width: tag.lineWidth ?? settings.defaultLineWidth,
        spanGaps: false,
        paths: isStep ? stepped : undefined,
        points: {
          show: false,
        },
      });
    }

    const opts: uPlot.Options = {
      width: Math.max(320, root.clientWidth || 320),
      height: Math.max(180, root.clientHeight || 180),
      pxAlign: false,
      // We feed x-values in epoch milliseconds and explicitly keep uPlot in ms mode.
      ms: 1,
      scales: {
        x: {
          time: true,
          range: (_self: uPlot, initMin: number, initMax: number) => {
            if (!liveModeRef.current) {
              return [initMin, initMax];
            }
            const right = liveLastEmittedRightRef.current
              ?? (Number.isFinite(initMax) ? initMax : Date.now());
            return [right - liveWindowMsRef.current, right];
          },
        },
        y: {
          auto: settings.autoScale,
          range: (_self: uPlot, initMin: number, initMax: number) => {
            if (!liveModeRef.current || !settingsRef.current.autoScale) {
              return [initMin, initMax];
            }
            const sticky = liveStickyYRangeRef.current;
            return sticky ? [sticky.min, sticky.max] : [initMin, initMax];
          },
        },
      },
      axes: [
        {
          scale: "x",
          side: 2,
          size: 28,
          stroke: uiTheme.mutedText,
          grid: { stroke: settings.gridLines ? (uiTheme.gridLine || "#333333") : "transparent" },
          show: settings.axisLabels,
          values: (self: uPlot, values: number[]) => {
            const min = Number(self.scales.x?.min);
            const max = Number(self.scales.x?.max);
            const rangeMs = Number.isFinite(min) && Number.isFinite(max) ? Math.max(0, max - min) : 0;
            return values.map((value) => formatUPlotTimeTick(value, rangeMs));
          },
        },
        {
          scale: "y",
          side: 3,
          size: 64,
          stroke: uiTheme.mutedText,
          grid: { stroke: settings.gridLines ? (uiTheme.gridLine || "#333333") : "transparent" },
          show: settings.axisLabels,
          values: (_self: uPlot, values: number[]) => values.map((value) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) {
              return "-";
            }
            return String(Math.round(numeric * 1000) / 1000);
          }),
        },
      ],
      series: uplotSeries,
      legend: {
        show: false,
      },
      cursor: {
        show: interactiveZoomEnabled,
        x: false,
        y: false,
        lock: false,
        drag: {
          x: interactiveZoomEnabled,
          y: false,
          setScale: interactiveZoomEnabled,
        },
      },
      hooks: {
        setScale: [
          (self: uPlot, scaleKey: string) => {
            if (scaleKey !== "x" || suppressSetScaleHookRef.current || !interactiveZoomEnabled) {
              return;
            }
            const min = Number(self.scales.x?.min);
            const max = Number(self.scales.x?.max);
            if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
              return;
            }
            onVisibleRangeChangeRef.current({ from: min, to: max }, "interaction");
          },
        ],
      },
    };

    const initStartedAt = isTrendPerfDebugEnabled() ? performance.now() : 0;
    plotRef.current = new uPlot(opts, createEmptyAlignedData(plotSeriesTags.length), root);
    onHoverSnapshotChange?.(null);

    if (isTrendPerfDebugEnabled()) {
      logTrendDiagnostics("uplot:init", {
        renderer: "uplot",
        initDurationMs: Math.round((performance.now() - initStartedAt) * 1000) / 1000,
        seriesCount: plotSeriesTags.length,
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      const width = Math.max(320, root.clientWidth || 320);
      const height = Math.max(180, root.clientHeight || 180);
      plotRef.current?.setSize({ width, height });
    });
    resizeObserver.observe(root);

    scheduleRebuildPlotData("recreate", true);

    return () => {
      resizeObserver.disconnect();
      if (pendingRenderRafRef.current !== null) {
        window.cancelAnimationFrame(pendingRenderRafRef.current);
        pendingRenderRafRef.current = null;
      }
      onHoverSnapshotChange?.(null);
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
    };
  }, [interactiveZoomEnabled, onHoverSnapshotChange, settings.autoScale, settings.axisLabels, settings.background, settings.defaultLineWidth, settings.gridLines, settings.theme, structureSignature, tags]);

  useEffect(() => {
    const historyMap = new Map<string, TrendPoint[]>();

    for (const series of data?.series ?? []) {
      historyMap.set(series.tag, normalizeTrendPoints(series.points));
    }

    const nextMap = new Map<string, TrendPoint[]>();
    const activeTagNames = new Set(tagsRef.current.filter((tag) => tag.visible !== false).map((tag) => tag.tag));

    for (const tagName of activeTagNames) {
      nextMap.set(tagName, historyMap.get(tagName) ?? []);
    }

    let minTs = Number.POSITIVE_INFINITY;
    let maxTs = Number.NEGATIVE_INFINITY;
    for (const points of nextMap.values()) {
      for (const point of points) {
        if (point.t < minTs) {
          minTs = point.t;
        }
        if (point.t > maxTs) {
          maxTs = point.t;
        }
      }
    }

    seriesPointsRef.current = nextMap;
    fullRangeRef.current = Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs > minTs
      ? { from: minTs, to: maxTs }
      : visibleRangeRef.current;

    scheduleRebuildPlotData("data-change", true);
  }, [data]);

  useEffect(() => {
    if (liveMode) {
      return;
    }

    const activeTagNames = new Set(tagsRef.current.filter((tag) => tag.visible !== false).map((tag) => tag.tag));
    const nextMap = buildSeriesPointMapFromQueryData(data, activeTagNames);

    let minTs = Number.POSITIVE_INFINITY;
    let maxTs = Number.NEGATIVE_INFINITY;
    for (const points of nextMap.values()) {
      for (const point of points) {
        if (point.t < minTs) {
          minTs = point.t;
        }
        if (point.t > maxTs) {
          maxTs = point.t;
        }
      }
    }

    seriesPointsRef.current = nextMap;
    fullRangeRef.current = Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs > minTs
      ? { from: minTs, to: maxTs }
      : visibleRangeRef.current;
    liveStickyYRangeRef.current = null;
    scheduleRebuildPlotData("live-exit-history-reset", true);
  }, [data, liveMode]);

  useEffect(() => {
    if (liveModeRef.current) {
      liveIgnoredPropSyncCountRef.current += 1;
      if (isTrendPerfDebugEnabled()) {
        logTrendDiagnostics("uplot:range-prop-ignored-live", {
          renderer: "uplot",
          ignoredCount: liveIgnoredPropSyncCountRef.current,
          from: visibleRange.from,
          to: visibleRange.to,
        });
      }
      return;
    }
    applyVisibleRangeToPlot(visibleRange, "prop-sync");
  }, [visibleRange.from, visibleRange.to]);

  useEffect(() => {
    if (!liveMode) {
      if (liveFollowTimerRef.current !== null) {
        window.clearInterval(liveFollowTimerRef.current);
        liveFollowTimerRef.current = null;
      }
      if (liveAppendRebuildTimerRef.current !== null) {
        window.clearTimeout(liveAppendRebuildTimerRef.current);
        liveAppendRebuildTimerRef.current = null;
      }
      return;
    }
    const tick = () => {
      const now = Date.now();
      const right = Math.floor(now / LIVE_FOLLOW_SCALE_QUANTUM_MS) * LIVE_FOLLOW_SCALE_QUANTUM_MS;
      const left = right - liveWindowMsRef.current;
      liveLastEmittedRightRef.current = right;
      fullRangeRef.current = {
        from: left - LIVE_DOMAIN_GRACE_MS,
        to: right + LIVE_DOMAIN_GRACE_MS,
      };
      const xRangeAdvanced = liveLastScaledRightRef.current !== right;
      liveLastScaledRightRef.current = right;
      liveFollowTickCountRef.current += 1;
      if (now - liveLastCarryForwardRebuildAtRef.current >= LIVE_CARRY_FORWARD_REBUILD_INTERVAL_MS) {
        liveLastCarryForwardRebuildAtRef.current = now;
        scheduleRebuildPlotData("live-carry-forward-tick", false);
      }
      if (now - liveLastRangeEmitAtRef.current >= LIVE_FOLLOW_EMIT_INTERVAL_MS) {
        liveLastRangeEmitAtRef.current = now;
        onVisibleRangeChangeRef.current({ from: left, to: right }, "live");
      }
      if (isTrendPerfDebugEnabled()) {
        logTrendDiagnostics("uplot:live-follow-scale", {
          renderer: "uplot",
          tick: liveFollowTickCountRef.current,
          left,
          right,
          xRangeAdvanced,
          liveFollowNowTs: now,
          setScaleCalls: setScaleCallCountRef.current,
          setScaleYCalls: setScaleYCallCountRef.current,
          liveRangeEmitIntervalMs: LIVE_FOLLOW_EMIT_INTERVAL_MS,
          liveFollowScaleQuantumMs: LIVE_FOLLOW_SCALE_QUANTUM_MS,
          heartbeatAgeMs: now - liveSourceHeartbeatAtRef.current,
          sourceAlive: now - liveSourceHeartbeatAtRef.current <= LIVE_SOURCE_HEARTBEAT_STALE_MS,
          sourceHeartbeatStaleMs: LIVE_SOURCE_HEARTBEAT_STALE_MS,
        });
      }
    };
    tick();
    liveFollowTimerRef.current = window.setInterval(tick, LIVE_FOLLOW_INTERVAL_MS);
    return () => {
      if (liveFollowTimerRef.current !== null) {
        window.clearInterval(liveFollowTimerRef.current);
        liveFollowTimerRef.current = null;
      }
      if (liveAppendRebuildTimerRef.current !== null) {
        window.clearTimeout(liveAppendRebuildTimerRef.current);
        liveAppendRebuildTimerRef.current = null;
      }
    };
  }, [liveMode]);

  useEffect(() => {
    onChartApiReady?.({
      appendLivePoints: (updates) => {
        appendLivePointsCallCountRef.current += 1;
        lastLiveBatchSizeRef.current = updates.length;
        liveSourceHeartbeatAtRef.current = Date.now();

        const activeTags = new Set(tagsRef.current.filter((tag) => tag.visible !== false).map((tag) => tag.tag));
        const updatedTags = new Set<string>();
        let minUpdateTs = Number.POSITIVE_INFINITY;
        let maxUpdateTs = Number.NEGATIVE_INFINITY;

        for (const update of updates) {
          if (!activeTags.has(update.tag) || !Number.isFinite(update.timestamp)) {
            continue;
          }
          const numericValue = resolveNumericValue(update.value);
          if (update.value !== null && numericValue === null) {
            continue;
          }

          const quality = update.quality?.toLowerCase() === "bad"
            ? "bad"
            : update.quality?.toLowerCase() === "uncertain"
              ? "uncertain"
              : "good";

          const current = seriesPointsRef.current.get(update.tag) ?? [];
          current.push({
            t: update.timestamp,
            v: numericValue,
            q: quality,
          });
          seriesPointsRef.current.set(update.tag, current);
          updatedTags.add(update.tag);

          if (update.timestamp < minUpdateTs) {
            minUpdateTs = update.timestamp;
          }
          if (update.timestamp > maxUpdateTs) {
            maxUpdateTs = update.timestamp;
          }
        }

        if (updatedTags.size === 0) {
          return;
        }
        liveLastAppendAtRef.current = Date.now();

        const trimRightTs = Number.isFinite(maxUpdateTs) ? maxUpdateTs : Date.now();
        const trimFromTs = trimRightTs - liveWindowMsRef.current - LIVE_TRIM_GRACE_MS;
        const seriesPointCap = liveSeriesPointCapRef.current;

        for (const tagName of updatedTags) {
          const normalized = normalizeTrendPoints(seriesPointsRef.current.get(tagName) ?? []);
          const trimmed = normalized.filter((point) => point.t >= trimFromTs);
          if (trimmed.length > seriesPointCap) {
            trimmed.splice(0, trimmed.length - seriesPointCap);
          }
          seriesPointsRef.current.set(tagName, trimmed);
        }

        if (!liveModeRef.current && Number.isFinite(minUpdateTs) && Number.isFinite(maxUpdateTs)) {
          fullRangeRef.current = {
            from: Math.min(fullRangeRef.current.from, minUpdateTs),
            to: Math.max(fullRangeRef.current.to, maxUpdateTs),
          };
        }

        if (isTrendPerfDebugEnabled()) {
          logTrendDiagnostics("live:append-applied", {
            renderer: "uplot",
            batchSize: updates.length,
            updatedTagCount: updatedTags.size,
            minUpdateTs: Number.isFinite(minUpdateTs) ? minUpdateTs : null,
            maxUpdateTs: Number.isFinite(maxUpdateTs) ? maxUpdateTs : null,
            appendRebuildMinIntervalMs: LIVE_APPEND_REBUILD_MIN_INTERVAL_MS,
          });
        }

        scheduleAppendLiveRebuild();
      },
      notifyLiveHeartbeat: (timestampMs) => {
        const nextTs = Number.isFinite(timestampMs) ? Number(timestampMs) : Date.now();
        liveSourceHeartbeatAtRef.current = nextTs;
      },
      getWidth: () => rootRef.current?.clientWidth ?? 0,
      getPointCount: () => latestDataPointCountRef.current,
    });
  }, [onChartApiReady]);

  // TODO: Stage 2 - add axis title modes (hidden / compactLabel / verticalLabel) for uPlot.
  return <div ref={rootRef} className="trends-chart trends-chart--uplot" />;
}
