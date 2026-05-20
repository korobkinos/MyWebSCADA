import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { TrendAxisConfig, TrendChartApi, TrendPoint, TrendQueryResponse, TrendSettings, TrendTagSelection, TrendVisibleRange } from "./trendTypes";
import { isTrendPerfDebugEnabled, logTrendDiagnostics } from "./trendDiagnostics";
import { resolveTrendTheme } from "./trendTheme";
import { applyTrendVisualHolds, buildTrendDataMatrixWithGaps, normalizeTrendPoints, resolveTrendGapBreakMs, type TrendVisualHoldSpec } from "./trendUtils";

const LIVE_RIGHT_DRIFT_LIMIT_MS = 5_000;
const LIVE_TRIM_GRACE_MS = 15_000;
const LIVE_DOMAIN_GRACE_MS = 1500;
const LIVE_MIN_SERIES_POINT_CAP = 200;
const LIVE_MAX_SERIES_POINT_CAP = 20_000;
const UPLOT_MIN_GAP_BREAK_MS = 20_000;
const LIVE_FOLLOW_INTERVAL_MS = 120;
const LIVE_FOLLOW_EMIT_EVERY_TICKS = 8;
const LIVE_SOURCE_HEARTBEAT_STALE_MS = 1200;
const LIVE_HOLD_REFRESH_INTERVAL_MS = 1000;

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
  const skipNextVisibleRangeRenderInLiveRef = useRef(false);
  const suppressSetScaleHookRef = useRef(false);
  const liveSeriesPointCapRef = useRef(resolveLiveSeriesPointCap(settings.liveBufferLimit));
  const liveFollowTimerRef = useRef<number | null>(null);
  const liveFollowTickCountRef = useRef(0);
  const liveSourceHeartbeatAtRef = useRef<number>(0);
  const liveHoldLastRebuildAtRef = useRef(0);

  const plotSeriesTagsRef = useRef<TrendTagSelection[]>([]);
  const latestDataPointCountRef = useRef(0);
  const appendLivePointsCallCountRef = useRef(0);
  const setDataCallCountRef = useRef(0);
  const setScaleCallCountRef = useRef(0);
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
      const gapBreakMs = gapBreakMsByTag.get(tag.tag) ?? UPLOT_MIN_GAP_BREAK_MS;
      const staleThresholdMs = Math.max(gapBreakMs, LIVE_SOURCE_HEARTBEAT_STALE_MS);
      const staleByDataAge = rightEdgeTs - latestNumericTs > staleThresholdMs;
      const stale = !sourceAlive || staleByDataAge;
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

    const liveRightEdge =
      liveLastEmittedRightRef.current
      ?? (Number.isFinite(visibleRangeRef.current.to) ? visibleRangeRef.current.to : Date.now());
    const holds = liveModeRef.current ? buildLiveVisualHolds(gapBreakMsByTag, liveRightEdge) : [];
    const withHolds = liveModeRef.current ? applyTrendVisualHolds(matrix, holds) : null;

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
    const setDataStartedAt = isTrendPerfDebugEnabled() ? performance.now() : 0;
    plot.setData(aligned, resetScales);
    setDataCallCountRef.current += 1;
    const yRangeAfter = {
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

    logTrendDiagnostics("uplot:set-data", {
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
      appendLivePointsCalls: appendLivePointsCallCountRef.current,
      setDataDurationTotalMs: Math.round(setDataDurationTotalRef.current * 1000) / 1000,
      yRangeBefore,
      yRangeAfter,
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
      liveHoldLastRebuildAtRef.current = 0;
      liveFollowTickCountRef.current = 0;
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
    const chartBackground = settings.theme === "custom" && /^#[0-9a-fA-F]{3,6}$/.test(settings.background)
      ? settings.background
      : (uiTheme.panel || "#1e1e1e");

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
      pxAlign: 1,
      // We feed x-values in epoch milliseconds and explicitly keep uPlot in ms mode.
      ms: 1,
      scales: {
        x: { time: true },
        y: { auto: settings.autoScale },
      },
      axes: [
        {
          scale: "x",
          side: 2,
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
      plugins: [
        {
          hooks: {
            drawClear: [
              (self: uPlot) => {
                self.ctx.save();
                self.ctx.fillStyle = chartBackground;
                self.ctx.fillRect(0, 0, self.bbox.width, self.bbox.height);
                self.ctx.restore();
              },
            ],
          },
        },
      ],
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
    const previousMap = seriesPointsRef.current;
    const historyToMs = Number.isFinite(new Date(data?.to ?? "").getTime()) ? new Date(data?.to ?? "").getTime() : Number.NaN;

    for (const series of data?.series ?? []) {
      historyMap.set(series.tag, normalizeTrendPoints(series.points));
    }

    const nextMap = new Map<string, TrendPoint[]>();
    const activeTagNames = new Set(tagsRef.current.filter((tag) => tag.visible !== false).map((tag) => tag.tag));

    if (liveModeRef.current) {
      for (const tagName of activeTagNames) {
        const historyPoints = historyMap.get(tagName) ?? [];
        const carryOverLivePoints = (previousMap.get(tagName) ?? []).filter((point) => Number.isFinite(historyToMs) && point.t > historyToMs);
        nextMap.set(tagName, normalizeTrendPoints([...historyPoints, ...carryOverLivePoints]));
      }
    } else {
      for (const tagName of activeTagNames) {
        nextMap.set(tagName, historyMap.get(tagName) ?? []);
      }
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
    if (liveModeRef.current && skipNextVisibleRangeRenderInLiveRef.current) {
      skipNextVisibleRangeRenderInLiveRef.current = false;
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
      return;
    }
    const tick = () => {
      const now = Date.now();
      const previousRight = liveLastEmittedRightRef.current ?? now;
      const candidate = Math.max(previousRight, now);
      const right = Math.min(candidate, now + LIVE_RIGHT_DRIFT_LIMIT_MS);
      const left = right - liveWindowMsRef.current;
      liveLastEmittedRightRef.current = right;
      fullRangeRef.current = {
        from: left - LIVE_DOMAIN_GRACE_MS,
        to: right + LIVE_DOMAIN_GRACE_MS,
      };
      applyVisibleRangeToPlot({ from: left, to: right }, "live-follow");
      liveFollowTickCountRef.current += 1;
      if (liveFollowTickCountRef.current % LIVE_FOLLOW_EMIT_EVERY_TICKS === 0) {
        skipNextVisibleRangeRenderInLiveRef.current = true;
        onVisibleRangeChangeRef.current({ from: left, to: right }, "live");
        logTrendDiagnostics("uplot:live-follow", {
          renderer: "uplot",
          tick: liveFollowTickCountRef.current,
          left,
          right,
          setScaleCalls: setScaleCallCountRef.current,
        });
      }
      if (
        now - liveHoldLastRebuildAtRef.current >= LIVE_HOLD_REFRESH_INTERVAL_MS
        && now - liveSourceHeartbeatAtRef.current <= LIVE_SOURCE_HEARTBEAT_STALE_MS
      ) {
        liveHoldLastRebuildAtRef.current = now;
        scheduleRebuildPlotData("live-hold-refresh", false);
      }
    };
    tick();
    liveFollowTimerRef.current = window.setInterval(tick, LIVE_FOLLOW_INTERVAL_MS);
    return () => {
      if (liveFollowTimerRef.current !== null) {
        window.clearInterval(liveFollowTimerRef.current);
        liveFollowTimerRef.current = null;
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

        if (liveModeRef.current) {
          const now = Date.now();
          const newestTs = Number.isFinite(maxUpdateTs) ? maxUpdateTs : now;
          const clampedNewestTs = Math.min(newestTs, now + LIVE_RIGHT_DRIFT_LIMIT_MS);
          const previousRight = liveLastEmittedRightRef.current ?? now;
          const right = Math.max(previousRight, clampedNewestTs);
          liveLastEmittedRightRef.current = right;
        } else if (Number.isFinite(minUpdateTs) && Number.isFinite(maxUpdateTs)) {
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
          });
        }

        scheduleRebuildPlotData("append-live-points", false);
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
