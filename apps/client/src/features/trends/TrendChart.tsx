import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, DataZoomComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ECharts, EChartsCoreOption } from "echarts/core";
import type { TrendAxisConfig, TrendChartApi, TrendPoint, TrendQueryResponse, TrendSettings, TrendTagSelection, TrendVisibleRange } from "./trendTypes";
import { isTrendPerfDebugEnabled, logTrendDiagnostics } from "./trendDiagnostics";
import { resolveTrendTheme } from "./trendTheme";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);
const LIVE_GAP_MIN_BREAK_MS = 10_000;
const LIVE_RIGHT_DRIFT_LIMIT_MS = 5_000;
const LIVE_TRIM_GRACE_MS = 15_000;
const LIVE_DOMAIN_GRACE_MS = 1500;
const LIVE_MIN_SERIES_POINT_CAP = 200;
const LIVE_MAX_SERIES_POINT_CAP = 20_000;

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
};

function resolveGapBreakMs(points: TrendPoint[]): number {
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

function resolveLiveSeriesPointCap(liveBufferLimit: number): number {
  if (!Number.isFinite(liveBufferLimit)) {
    return LIVE_MIN_SERIES_POINT_CAP;
  }
  const normalized = Math.round(liveBufferLimit);
  return Math.max(LIVE_MIN_SERIES_POINT_CAP, Math.min(LIVE_MAX_SERIES_POINT_CAP, normalized));
}

export function TrendChart({
  data,
  tags,
  axes,
  axisIdByTag,
  settings,
  showLegend = true,
  showTooltip = true,
  showDataZoomSlider = true,
  interactiveZoomEnabled = true,
  visibleRange,
  liveMode,
  liveWindowMs,
  onVisibleRangeChange,
  onHoverSnapshotChange,
  onChartApiReady,
}: TrendChartProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);
  const seriesPointsRef = useRef<Map<string, TrendPoint[]>>(new Map());
  const fullRangeRef = useRef<TrendVisibleRange>(visibleRange);
  const tagsByName = useMemo(() => new Map(tags.map((tag) => [tag.tag, tag])), [tags]);
  const lastZoomRangeRef = useRef<TrendVisibleRange | null>(null);
  const zoomTimerRef = useRef<number | null>(null);
  const optionGuardRef = useRef(false);
  const liveLastEmittedRightRef = useRef<number | null>(null);
  const liveModeRef = useRef(liveMode);
  const liveWindowMsRef = useRef(liveWindowMs);
  const onVisibleRangeChangeRef = useRef(onVisibleRangeChange);
  const onHoverSnapshotChangeRef = useRef(onHoverSnapshotChange);
  const zoomDebounceMsRef = useRef(settings.zoomDebounceMs);
  const liveSeriesPointCapRef = useRef(resolveLiveSeriesPointCap(settings.liveBufferLimit));
  const tagsRef = useRef(tags);
  const lastAxisPointerTsRef = useRef<number | null>(null);
  const renderChartRef = useRef<() => void>(() => {});
  const normalizeSeriesPoints = (points: TrendPoint[]): TrendPoint[] => {
    if (points.length <= 1) {
      return [...points];
    }
    const sorted = [...points].sort((a, b) => a.t - b.t);
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
  };
  const resolveRangeFromZoomPayload = (payload: unknown): TrendVisibleRange | null => {
    const source = payload && typeof payload === "object"
      ? ("batch" in payload && Array.isArray((payload as { batch?: unknown[] }).batch)
        ? (payload as { batch?: unknown[] }).batch?.[0]
        : payload)
      : null;
    if (!source || typeof source !== "object") {
      return null;
    }
    const startValue = Number((source as { startValue?: unknown }).startValue);
    const endValue = Number((source as { endValue?: unknown }).endValue);
    if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
      return null;
    }
    const next = { from: Math.min(startValue, endValue), to: Math.max(startValue, endValue) };
    if (next.to - next.from < 1000) {
      return null;
    }
    return next;
  };
  const normalizeRangeToDomain = (range: TrendVisibleRange): TrendVisibleRange | null => {
    const domain = fullRangeRef.current;
    if (!Number.isFinite(domain.from) || !Number.isFinite(domain.to) || domain.to <= domain.from) {
      return range;
    }
    const minSpan = 1000;
    const clampedFrom = Math.max(domain.from, Math.min(domain.to, range.from));
    const clampedTo = Math.max(domain.from, Math.min(domain.to, range.to));
    let from = Math.min(clampedFrom, clampedTo);
    let to = Math.max(clampedFrom, clampedTo);
    if (to - from < minSpan) {
      const center = (from + to) / 2;
      from = Math.max(domain.from, center - minSpan / 2);
      to = Math.min(domain.to, from + minSpan);
      from = Math.max(domain.from, to - minSpan);
      if (to - from < minSpan) {
        from = domain.from;
        to = domain.to;
      }
    }
    if (!(to > from)) {
      return null;
    }
    return { from, to };
  };

  useEffect(() => {
    liveModeRef.current = liveMode;
  }, [liveMode]);

  useEffect(() => {
    liveWindowMsRef.current = liveWindowMs;
  }, [liveWindowMs]);

  useEffect(() => {
    onVisibleRangeChangeRef.current = onVisibleRangeChange;
  }, [onVisibleRangeChange]);

  useEffect(() => {
    onHoverSnapshotChangeRef.current = onHoverSnapshotChange;
  }, [onHoverSnapshotChange]);

  useEffect(() => {
    zoomDebounceMsRef.current = settings.zoomDebounceMs;
  }, [settings.zoomDebounceMs]);

  useEffect(() => {
    liveSeriesPointCapRef.current = resolveLiveSeriesPointCap(settings.liveBufferLimit);
  }, [settings.liveBufferLimit]);

  useEffect(() => {
    tagsRef.current = tags;
  }, [tags]);

  const renderChart = (): void => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }
    const debugPerf = isTrendPerfDebugEnabled();
    const renderStartedAt = debugPerf ? performance.now() : 0;
    const uiTheme = resolveTrendTheme(settings.theme);
    const chartBackground = settings.theme === "custom" && /^#[0-9a-fA-F]{3,6}$/.test(settings.background)
      ? settings.background
      : uiTheme.background;

    const activeTags = tags.filter((tag) => tag.visible !== false);
    const fallbackAxis: TrendAxisConfig = {
      id: "axis:default",
      name: "default",
      position: "left",
      offset: 0,
      min: "auto",
      max: "auto",
    };
    const baseAxes: TrendAxisConfig[] = axes.length > 0 ? axes : [fallbackAxis];
    const knownAxisIds = new Set(baseAxes.map((axis) => axis.id));
    const usedAxisIds = new Set<string>();
    for (const tag of activeTags) {
      const axisId = axisIdByTag.get(tag.tag);
      if (axisId && knownAxisIds.has(axisId)) {
        usedAxisIds.add(axisId);
      } else if (baseAxes[0]?.id) {
        usedAxisIds.add(baseAxes[0].id);
      }
    }
    const axisOffsetStepPx = Math.max(14, Math.round(settings.axisOffsetStep * 0.6));
    const positionOffsetIndex: Record<"left" | "right", number> = { left: 0, right: 0 };
    let safeAxes: TrendAxisConfig[] = baseAxes.filter((axis) => usedAxisIds.has(axis.id));
    if (safeAxes.length === 0 && activeTags.length > 0) {
      safeAxes = [baseAxes[0] ?? fallbackAxis];
    }
    safeAxes = safeAxes.map((axis) => {
      const axisPosition = axis.position === "right" ? "right" : "left";
      const positionIndex = positionOffsetIndex[axisPosition];
      positionOffsetIndex[axisPosition] += 1;
      return {
        ...axis,
        position: axisPosition,
        offset: positionIndex * axisOffsetStepPx,
      };
    });
    const axisIndexById = new Map<string, number>(safeAxes.map((axis, index) => [axis.id, index]));
    const axisRangeById = new Map<string, { min: number; max: number }>();
    for (const tag of activeTags) {
      const axisId = axisIdByTag.get(tag.tag) ?? safeAxes[0]?.id;
      if (!axisId) {
        continue;
      }
      const points = seriesPointsRef.current.get(tag.tag) ?? [];
      for (const point of points) {
        if (!point || typeof point.v !== "number" || !Number.isFinite(point.v)) {
          continue;
        }
        const current = axisRangeById.get(axisId);
        if (!current) {
          axisRangeById.set(axisId, { min: point.v, max: point.v });
        } else {
          if (point.v < current.min) {
            current.min = point.v;
          }
          if (point.v > current.max) {
            current.max = point.v;
          }
        }
      }
    }

    const yAxis = safeAxes.map((axis) => {
      const axisName = axis.name || axis.unit || axis.id;
      return ({
      type: "value" as const,
      name: `{axisName|${axisName}}`,
      position: axis.position,
      offset: axis.offset ?? 0,
      scale: settings.autoScale,
      min: (() => {
        if (axis.min !== "auto") {
          return axis.min;
        }
        if (!settings.autoScale) {
          return null;
        }
        const range = axisRangeById.get(axis.id);
        if (!range) {
          return 0;
        }
        if (Math.abs(range.max - range.min) < 1e-9) {
          const pad = Math.max(1, Math.abs(range.max) * 0.05, 0.5);
          return range.min - pad;
        }
        return null;
      })(),
      max: (() => {
        if (axis.max !== "auto") {
          return axis.max;
        }
        if (!settings.autoScale) {
          return null;
        }
        const range = axisRangeById.get(axis.id);
        if (!range) {
          return 1;
        }
        if (Math.abs(range.max - range.min) < 1e-9) {
          const pad = Math.max(1, Math.abs(range.max) * 0.05, 0.5);
          return range.max + pad;
        }
        return null;
      })(),
      nameLocation: "middle" as const,
      nameRotate: axis.position === "left" ? 90 : -90,
      nameGap: 30,
      nameTextStyle: {
        rich: {
          axisName: {
            color: axis.color ?? uiTheme.text,
            align: "center",
            verticalAlign: "middle",
            backgroundColor: uiTheme.toolbarBg,
            borderColor: uiTheme.border,
            borderWidth: 1,
            padding: [3, 6, 3, 6],
            borderRadius: 3,
          },
        },
      },
      axisLine: { show: true, lineStyle: { color: axis.color ?? uiTheme.border } },
      axisLabel: { show: settings.axisLabels, color: uiTheme.mutedText, hideOverlap: false, showMinLabel: true, showMaxLabel: true, margin: 6 },
      splitLine: { show: settings.gridLines, lineStyle: { color: uiTheme.gridLine, type: "dashed" } },
    });
    });

    const totalPointCount = activeTags.reduce((acc, tag) => acc + (seriesPointsRef.current.get(tag.tag)?.length ?? 0), 0);
    const isLargeDataset = totalPointCount >= 5000;
    const animationEnabled = !liveMode && (!settings.disableAnimationsLargeData || !isLargeDataset);
    const progressiveValue = settings.progressive ? 450 : 0;
    const progressiveThreshold = settings.progressive ? 2500 : Number.MAX_SAFE_INTEGER;

    const series = activeTags.map((tag, index) => {
      const points = seriesPointsRef.current.get(tag.tag) ?? [];
      const lineWidth = tag.lineWidth ?? settings.defaultLineWidth;
      const lineType = tag.lineType ?? "solid";
      const renderMode = tag.mode ?? (tagsByName.get(tag.tag)?.mode ?? "line");
      const gapBreakMs = resolveGapBreakMs(points);
      const dataPoints: Array<[number, number | null]> = [];
      for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        const point = points[pointIndex];
        if (!point) {
          continue;
        }
        const previous = pointIndex > 0 ? points[pointIndex - 1] : null;
        if (!liveMode && previous && point.t - previous.t > gapBreakMs) {
          const leftGapTs = previous.t + 1;
          const rightGapTs = point.t - 1;
          dataPoints.push([leftGapTs, null]);
          if (rightGapTs > leftGapTs) {
            dataPoints.push([rightGapTs, null]);
          }
        }
        const quality = (point.q ?? "good").toLowerCase();
        const invalidQuality = quality === "bad" || quality === "uncertain";
        const value = settings.showBadQualityGaps && invalidQuality ? null : point.v;
        dataPoints.push([point.t, value]);
      }
      const axisId = axisIdByTag.get(tag.tag) ?? safeAxes[0]?.id;
      const yAxisIndex = axisId ? (axisIndexById.get(axisId) ?? 0) : 0;

      const sampling = liveMode
        ? undefined
        : settings.aggregation === "minmax"
          ? "minmax"
          : settings.aggregation === "lttb"
            ? "lttb"
            : undefined;
      const firstPoint = points[0];
      const lastPoint = points[points.length - 1];
      logTrendDiagnostics("chart:series-render", {
        tag: tag.tag,
        liveMode,
        points: points.length,
        renderPoints: dataPoints.length,
        firstTs: firstPoint?.t ?? null,
        lastTs: lastPoint?.t ?? null,
        sampling: sampling ?? "none",
      });
      return {
        id: tag.tag,
        name: tag.displayName || tag.tag,
        type: "line" as const,
        showSymbol: settings.showSymbols || renderMode === "points",
        symbol: settings.showSymbols || renderMode === "points" ? "circle" : "none",
        sampling,
        progressive: progressiveValue,
        progressiveThreshold,
        animation: animationEnabled,
        connectNulls: false,
        step: tag.step || renderMode === "step" ? "end" : false,
        yAxisIndex,
        lineStyle: {
          width: lineWidth,
          type: lineType,
          color: tag.color,
        },
        itemStyle: {
          color: tag.color,
        },
        data: dataPoints,
      };
    });
    const echartsPointCount = series.reduce((count, item) => count + item.data.length, 0);

    const option: EChartsCoreOption = {
      // Keep full domain stable so wheel zoom can zoom-out after zoom-in.
      // Windowed range is controlled via dataZoom start/end values.
      backgroundColor: chartBackground,
      animation: animationEnabled,
      textStyle: { color: uiTheme.text },
      grid: {
        left: 0 + Math.max(0, (safeAxes.filter((axis) => axis.position === "left").length - 1) * (axisOffsetStepPx + 2)),
        right: 18 + Math.max(0, (safeAxes.filter((axis) => axis.position === "right").length - 1) * (axisOffsetStepPx + 6)),
        top: 34,
        bottom: interactiveZoomEnabled && showDataZoomSlider ? 74 : 20,
        containLabel: true,
      },
      legend: {
        show: showLegend && settings.legend,
        type: "scroll",
        top: 4,
        textStyle: { color: uiTheme.text },
      },
      axisPointer: {
        show: true,
        triggerTooltip: showTooltip && settings.tooltip,
        type: "line",
        lineStyle: { color: "#8a8a8a", width: 1, type: "dashed" },
      },
      tooltip: showTooltip && settings.tooltip
        ? {
            trigger: "axis",
            triggerOn: "mousemove|click",
            axisPointer: {
              type: "line",
              label: { show: false },
              animation: false,
            },
            backgroundColor: uiTheme.tooltipBg,
            borderColor: uiTheme.tooltipBorder,
            textStyle: { color: uiTheme.text },
          }
        : undefined,
      xAxis: {
        type: "time",
        min: fullRangeRef.current.from,
        max: fullRangeRef.current.to,
        axisLine: { lineStyle: { color: uiTheme.border } },
        axisPointer: { show: true, label: { show: false } },
        axisLabel: { show: settings.axisLabels, color: uiTheme.mutedText },
        splitLine: { show: settings.gridLines, lineStyle: { color: uiTheme.gridLine } },
      },
      yAxis,
      dataZoom: interactiveZoomEnabled
        ? [
            {
              type: "inside",
              xAxisIndex: [0],
              filterMode: "none",
              rangeMode: ["value", "value"],
              brushSelect: false,
              startValue: visibleRange.from,
              endValue: visibleRange.to,
              minValueSpan: 1000,
            },
            {
              type: "slider",
              show: showDataZoomSlider,
              xAxisIndex: [0],
              filterMode: "none",
              rangeMode: ["value", "value"],
              startValue: visibleRange.from,
              endValue: visibleRange.to,
              minValueSpan: 1000,
              showDataShadow: false,
              height: 20,
              bottom: 14,
              borderColor: uiTheme.tableBorder,
              fillerColor: `${uiTheme.accent}66`,
              handleStyle: { color: uiTheme.accent, borderColor: uiTheme.border },
              moveHandleStyle: { color: uiTheme.accent, opacity: 0.6 },
              dataBackground: {
                lineStyle: { color: uiTheme.gridLine, opacity: 0.65 },
                areaStyle: { color: uiTheme.buttonBg, opacity: 0.45 },
              },
              selectedDataBackground: {
                lineStyle: { color: uiTheme.accent, opacity: 0.85 },
                areaStyle: { color: uiTheme.accent, opacity: 0.2 },
              },
              backgroundColor: uiTheme.buttonBg,
            },
          ]
        : [
            {
              type: "slider",
              show: false,
              xAxisIndex: [0],
              filterMode: "none",
              rangeMode: ["value", "value"],
              startValue: visibleRange.from,
              endValue: visibleRange.to,
              minValueSpan: 1000,
            },
          ],
      series,
    };

    optionGuardRef.current = true;
    chart.setOption(option, { notMerge: false, lazyUpdate: true, replaceMerge: ["series"] });
    if (lastAxisPointerTsRef.current !== null) {
      chart.dispatchAction({
        type: "showTip",
        xAxisIndex: 0,
        value: lastAxisPointerTsRef.current,
      });
    }
    window.setTimeout(() => {
      optionGuardRef.current = false;
    }, 0);
    if (debugPerf) {
      logTrendDiagnostics("chart:render", {
        durationMs: Math.round((performance.now() - renderStartedAt) * 1000) / 1000,
        seriesCount: series.length,
        sourcePointCount: totalPointCount,
        echartsPointCount,
        domain: fullRangeRef.current,
        visibleRange,
      });
    }
  };
  renderChartRef.current = renderChart;

  useEffect(() => {
    if (!rootRef.current) {
      return;
    }

    const chart = echarts.init(rootRef.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;

    const handleDataZoom = (payload: unknown) => {
      if (optionGuardRef.current) {
        return;
      }
      const optionRange = (() => {
        const option = chart.getOption() as { dataZoom?: Array<{ startValue?: unknown; endValue?: unknown }> };
        const dataZoom = option.dataZoom?.[0];
        if (!dataZoom) {
          return null;
        }
        const startValue = Number(dataZoom.startValue);
        const endValue = Number(dataZoom.endValue);
        if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
          return null;
        }
        return { from: Math.min(startValue, endValue), to: Math.max(startValue, endValue) };
      })();
      const nextFromPayload = optionRange ?? resolveRangeFromZoomPayload(payload);
      const nextRangeRaw = nextFromPayload ?? (() => {
        const width = rootRef.current?.clientWidth ?? 0;
        if (width <= 0) {
          return null;
        }
        const from = Number(chart.convertFromPixel({ xAxisIndex: 0 }, 0));
        const to = Number(chart.convertFromPixel({ xAxisIndex: 0 }, width));
        if (!Number.isFinite(from) || !Number.isFinite(to)) {
          return null;
        }
        const fallback = { from: Math.min(from, to), to: Math.max(from, to) };
        if (fallback.to - fallback.from < 1000) {
          return null;
        }
        return fallback;
      })();
      const nextRange = nextRangeRaw ? normalizeRangeToDomain(nextRangeRaw) : null;
      if (!nextRange) {
        return;
      }
      const prev = lastZoomRangeRef.current;
      if (prev && Math.abs(prev.from - nextRange.from) < 5 && Math.abs(prev.to - nextRange.to) < 5) {
        return;
      }
      lastZoomRangeRef.current = nextRange;
      if (liveModeRef.current) {
        // Stop live immediately on user zoom/pan to prevent jitter.
        onVisibleRangeChangeRef.current(nextRange, "interaction");
        return;
      }
      if (zoomTimerRef.current) {
        window.clearTimeout(zoomTimerRef.current);
      }
      zoomTimerRef.current = window.setTimeout(() => {
        onVisibleRangeChangeRef.current(nextRange, "interaction");
      }, zoomDebounceMsRef.current);
    };

    const resolveSeriesValueAtTimestamp = (points: TrendPoint[], timestamp: number): number | null => {
      if (points.length === 0) {
        return null;
      }
      let low = 0;
      let high = points.length - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const midPoint = points[mid];
        if (!midPoint) {
          break;
        }
        if (midPoint.t === timestamp) {
          return midPoint.v;
        }
        if (midPoint.t < timestamp) {
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      const prevIndex = Math.max(0, Math.min(points.length - 1, high));
      const nextIndex = Math.max(0, Math.min(points.length - 1, low));
      const prevPoint = points[prevIndex];
      const nextPoint = points[nextIndex];
      if (!prevPoint) {
        return nextPoint?.v ?? null;
      }
      if (!nextPoint) {
        return prevPoint.v;
      }
      if (prevIndex === nextIndex) {
        return prevPoint.v;
      }
      return Math.abs(nextPoint.t - timestamp) < Math.abs(timestamp - prevPoint.t) ? nextPoint.v : prevPoint.v;
    };

    const handleAxisPointer = (payload: unknown) => {
      const source = payload && typeof payload === "object"
        ? (Array.isArray((payload as { axesInfo?: unknown[] }).axesInfo)
          ? (payload as { axesInfo?: Array<{ value?: unknown }> }).axesInfo?.[0]
          : null)
        : null;
      const timestamp = Number(source?.value);
      if (!Number.isFinite(timestamp)) {
        lastAxisPointerTsRef.current = null;
        onHoverSnapshotChangeRef.current?.(null);
        return;
      }
      lastAxisPointerTsRef.current = timestamp;
      const values: Record<string, number | boolean | string | null> = {};
      for (const tag of tagsRef.current) {
        const points = seriesPointsRef.current.get(tag.tag) ?? [];
        values[tag.tag] = resolveSeriesValueAtTimestamp(points, timestamp);
      }
      onHoverSnapshotChangeRef.current?.({ timestamp, values });
    };

    const handleGlobalOut = () => {
      lastAxisPointerTsRef.current = null;
      onHoverSnapshotChangeRef.current?.(null);
    };

    if (interactiveZoomEnabled) {
      chart.on("dataZoom", handleDataZoom);
    }
    chart.on("updateAxisPointer", handleAxisPointer);
    chart.on("globalout", handleGlobalOut);

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(rootRef.current);

    onChartApiReady?.({
      appendLivePoints: (updates) => {
        const active = new Set(tagsRef.current.map((tag) => tag.tag));
        const updatedTags = new Set<string>();
        let minUpdateTs = Number.POSITIVE_INFINITY;
        let maxUpdateTs = Number.NEGATIVE_INFINITY;
        for (const update of updates) {
          if (!active.has(update.tag)) {
            continue;
          }
          const current = seriesPointsRef.current.get(update.tag) ?? [];
          let numericValue: number | null = null;
          if (typeof update.value === "number") {
            numericValue = update.value;
          } else if (typeof update.value === "boolean") {
            numericValue = update.value ? 1 : 0;
          } else if (update.value === null) {
            numericValue = null;
          } else {
            continue;
          }
          const nextPoint: TrendPoint = {
            t: update.timestamp,
            v: numericValue,
            q: update.quality?.toLowerCase() === "bad"
              ? "bad"
              : update.quality?.toLowerCase() === "uncertain"
                ? "uncertain"
                : "good",
          };
          const lastPoint = current[current.length - 1];
          if (lastPoint && nextPoint.t - lastPoint.t > Math.max(LIVE_GAP_MIN_BREAK_MS, resolveGapBreakMs(current))) {
            const gapLeftTs = lastPoint.t + 1;
            const gapRightTs = nextPoint.t - 1;
            current.push({ t: gapLeftTs, v: null, q: "uncertain" });
            if (gapRightTs > gapLeftTs) {
              current.push({ t: gapRightTs, v: null, q: "uncertain" });
            }
            logTrendDiagnostics("live:gap-break", {
              tag: update.tag,
              previousTs: lastPoint.t,
              nextTs: nextPoint.t,
              deltaMs: nextPoint.t - lastPoint.t,
            });
          }
          if (!lastPoint || nextPoint.t > lastPoint.t) {
            current.push(nextPoint);
          } else if (lastPoint.t === nextPoint.t) {
            current[current.length - 1] = nextPoint;
          } else {
            // Keep chronological order for stable line rendering in live mode.
            let index = current.length - 1;
            while (index >= 0 && current[index]!.t > nextPoint.t) {
              index -= 1;
            }
            if (index >= 0 && current[index]!.t === nextPoint.t) {
              current[index] = nextPoint;
            } else if (index + 1 < current.length && current[index + 1]!.t === nextPoint.t) {
              current[index + 1] = nextPoint;
            } else {
              current.splice(index + 1, 0, nextPoint);
            }
          }
          if (update.timestamp < minUpdateTs) {
            minUpdateTs = update.timestamp;
          }
          if (update.timestamp > maxUpdateTs) {
            maxUpdateTs = update.timestamp;
          }
          seriesPointsRef.current.set(update.tag, current);
          updatedTags.add(update.tag);
        }

        if (updatedTags.size === 0) {
          return;
        }

        const trimRightTs = Number.isFinite(maxUpdateTs) ? maxUpdateTs : Date.now();
        const trimFromTs = trimRightTs - liveWindowMsRef.current - LIVE_TRIM_GRACE_MS;
        const seriesPointCap = liveSeriesPointCapRef.current;
        for (const tagName of updatedTags) {
          const points = seriesPointsRef.current.get(tagName);
          if (!points || points.length <= 1) {
            continue;
          }
          let cutIndex = 0;
          while (cutIndex < points.length && points[cutIndex]!.t < trimFromTs) {
            cutIndex += 1;
          }
          if (cutIndex > 0) {
            points.splice(0, cutIndex);
          }
          if (points.length > seriesPointCap) {
            points.splice(0, points.length - seriesPointCap);
          }
          seriesPointsRef.current.set(tagName, points);
        }

        if (liveModeRef.current) {
          const now = Date.now();
          const newestTs = Number.isFinite(maxUpdateTs) ? maxUpdateTs : now;
          const clampedNewestTs = Math.min(newestTs, now + LIVE_RIGHT_DRIFT_LIMIT_MS);
          const previousRight = liveLastEmittedRightRef.current ?? clampedNewestTs;
          const right = Math.max(previousRight, clampedNewestTs);
          const left = right - liveWindowMsRef.current;
          liveLastEmittedRightRef.current = right;
          fullRangeRef.current = {
            from: left - LIVE_DOMAIN_GRACE_MS,
            to: right + LIVE_DOMAIN_GRACE_MS,
          };
          onVisibleRangeChangeRef.current({ from: left, to: right }, "live");
        } else if (Number.isFinite(minUpdateTs) && Number.isFinite(maxUpdateTs)) {
          fullRangeRef.current = {
            from: Math.min(fullRangeRef.current.from, minUpdateTs),
            to: Math.max(fullRangeRef.current.to, maxUpdateTs),
          };
        }
        renderChartRef.current();
      },
      getWidth: () => rootRef.current?.clientWidth ?? 0,
      getPointCount: () => [...seriesPointsRef.current.values()].reduce((acc, points) => acc + points.length, 0),
    });
    renderChartRef.current();

    return () => {
      if (interactiveZoomEnabled) {
        chart.off("dataZoom", handleDataZoom);
      }
      chart.off("updateAxisPointer", handleAxisPointer);
      chart.off("globalout", handleGlobalOut);
      resizeObserver.disconnect();
      if (zoomTimerRef.current) {
        window.clearTimeout(zoomTimerRef.current);
      }
      chart.dispose();
      chartRef.current = null;
      liveLastEmittedRightRef.current = null;
    };
  }, [interactiveZoomEnabled]);

  useEffect(() => {
    const nextMap = new Map<string, TrendPoint[]>();
    let minTs = Number.POSITIVE_INFINITY;
    let maxTs = Number.NEGATIVE_INFINITY;
    const liveSeriesPointCap = liveSeriesPointCapRef.current;
    for (const series of data?.series ?? []) {
      const normalizedPointsSource = normalizeSeriesPoints(series.points);
      const normalizedPoints = liveModeRef.current && normalizedPointsSource.length > liveSeriesPointCap
        ? normalizedPointsSource.slice(normalizedPointsSource.length - liveSeriesPointCap)
        : normalizedPointsSource;
      nextMap.set(series.tag, normalizedPoints);
      for (const point of normalizedPoints) {
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
      : visibleRange;
    renderChart();
  }, [data]);

  useEffect(() => {
    renderChart();
  }, [axes, axisIdByTag, settings, tags, visibleRange.from, visibleRange.to]);

  return <div ref={rootRef} className="trends-chart" />;
}
