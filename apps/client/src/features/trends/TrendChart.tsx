import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, DataZoomComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ECharts, EChartsCoreOption } from "echarts/core";
import type { TrendAxisConfig, TrendChartApi, TrendPoint, TrendQueryResponse, TrendSettings, TrendTagSelection, TrendVisibleRange } from "./trendTypes";
import { TREND_WORKBENCH_THEME } from "./trendTheme";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);

type TrendChartProps = {
  data: TrendQueryResponse | null;
  tags: TrendTagSelection[];
  axes: TrendAxisConfig[];
  axisIdByTag: Map<string, string>;
  settings: TrendSettings;
  visibleRange: TrendVisibleRange;
  liveMode: boolean;
  liveWindowMs: number;
  onVisibleRangeChange: (range: TrendVisibleRange, source: "interaction" | "live") => void;
  onChartApiReady?: (api: TrendChartApi) => void;
};

const LARGE_POINTS_THRESHOLD = 6000;

export function TrendChart({
  data,
  tags,
  axes,
  axisIdByTag,
  settings,
  visibleRange,
  liveMode,
  liveWindowMs,
  onVisibleRangeChange,
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

  const renderChart = (): void => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    const activeTags = tags.filter((tag) => tag.visible !== false);
    const axisIndexById = new Map<string, number>(axes.map((axis, index) => [axis.id, index]));

    const yAxis = axes.map((axis) => ({
      type: "value" as const,
      name: axis.name || axis.unit || axis.id,
      position: axis.position,
      offset: axis.offset ?? 0,
      scale: settings.autoScale,
      min: axis.min === "auto" ? null : axis.min,
      max: axis.max === "auto" ? null : axis.max,
      nameTextStyle: { color: axis.color ?? TREND_WORKBENCH_THEME.text },
      axisLine: { show: true, lineStyle: { color: axis.color ?? TREND_WORKBENCH_THEME.border } },
      axisLabel: { show: settings.axisLabels, color: TREND_WORKBENCH_THEME.mutedText },
      splitLine: { show: settings.gridLines, lineStyle: { color: TREND_WORKBENCH_THEME.gridLine, type: "dashed" } },
    }));

    const totalPoints = [...seriesPointsRef.current.values()].reduce((acc, points) => acc + points.length, 0);
    const disableAnimation = settings.disableAnimationsLargeData && totalPoints > LARGE_POINTS_THRESHOLD;

    const series = activeTags.map((tag, index) => {
      const points = seriesPointsRef.current.get(tag.tag) ?? [];
      const lineWidth = tag.lineWidth ?? settings.defaultLineWidth;
      const lineType = tag.lineType ?? "solid";
      const renderMode = tag.mode ?? (tagsByName.get(tag.tag)?.mode ?? "line");
      const dataPoints = points.map((point) => {
        const quality = (point.q ?? "good").toLowerCase();
        const invalidQuality = quality === "bad" || quality === "uncertain";
        const value = settings.showBadQualityGaps && invalidQuality ? null : point.v;
        return [point.t, value];
      });
      const axisId = axisIdByTag.get(tag.tag) ?? axes[0]?.id;
      const yAxisIndex = axisId ? (axisIndexById.get(axisId) ?? 0) : 0;

      return {
        id: tag.tag,
        name: tag.displayName || tag.tag,
        type: "line" as const,
        showSymbol: settings.showSymbols || renderMode === "points",
        symbol: settings.showSymbols || renderMode === "points" ? "circle" : "none",
        sampling: settings.aggregation === "minmax" ? "minmax" : settings.aggregation === "lttb" ? "lttb" : undefined,
        progressive: settings.progressive ? 4000 : 0,
        animation: !disableAnimation,
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

    const option: EChartsCoreOption = {
      // Keep full domain stable so wheel zoom can zoom-out after zoom-in.
      // Windowed range is controlled via dataZoom start/end values.
      backgroundColor: settings.background,
      animation: !disableAnimation,
      textStyle: { color: TREND_WORKBENCH_THEME.text },
      grid: {
        left: 12,
        right: 12 + Math.max(0, (axes.filter((axis) => axis.position === "right").length - 1) * (settings.axisOffsetStep + 8)),
        top: 34,
        bottom: settings.dataZoomSlider ? 74 : 20,
        containLabel: true,
      },
      legend: {
        show: settings.legend,
        type: "scroll",
        top: 4,
        textStyle: { color: TREND_WORKBENCH_THEME.text },
      },
      tooltip: settings.tooltip
        ? {
            trigger: "axis",
            backgroundColor: "#1f1f1f",
            borderColor: TREND_WORKBENCH_THEME.border,
            textStyle: { color: TREND_WORKBENCH_THEME.text },
          }
        : undefined,
      xAxis: {
        type: "time",
        min: fullRangeRef.current.from,
        max: fullRangeRef.current.to,
        axisLine: { lineStyle: { color: TREND_WORKBENCH_THEME.border } },
        axisLabel: { show: settings.axisLabels, color: TREND_WORKBENCH_THEME.mutedText },
        splitLine: { show: settings.gridLines, lineStyle: { color: TREND_WORKBENCH_THEME.gridLine } },
      },
      yAxis,
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: [0],
          filterMode: "none",
          startValue: visibleRange.from,
          endValue: visibleRange.to,
          minValueSpan: 1000,
        },
        {
          type: "slider",
          show: settings.dataZoomSlider,
          xAxisIndex: [0],
          filterMode: "none",
          startValue: visibleRange.from,
          endValue: visibleRange.to,
          minValueSpan: 1000,
          height: 20,
          bottom: 14,
          borderColor: TREND_WORKBENCH_THEME.border,
          fillerColor: "rgba(0, 122, 204, 0.24)",
          backgroundColor: "rgba(255,255,255,0.03)",
        },
      ],
      series,
    };

    optionGuardRef.current = true;
    chart.setOption(option, { notMerge: true, lazyUpdate: true });
    window.setTimeout(() => {
      optionGuardRef.current = false;
    }, 0);
  };

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
      const nextFromPayload = resolveRangeFromZoomPayload(payload);
      const nextRange = nextFromPayload ?? (() => {
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
      if (!nextRange) {
        return;
      }
      const prev = lastZoomRangeRef.current;
      if (prev && Math.abs(prev.from - nextRange.from) < 5 && Math.abs(prev.to - nextRange.to) < 5) {
        return;
      }
      lastZoomRangeRef.current = nextRange;
      if (liveMode) {
        // Stop live immediately on user zoom/pan to prevent jitter.
        onVisibleRangeChange(nextRange, "interaction");
        return;
      }
      if (zoomTimerRef.current) {
        window.clearTimeout(zoomTimerRef.current);
      }
      zoomTimerRef.current = window.setTimeout(() => {
        onVisibleRangeChange(nextRange, "interaction");
      }, settings.zoomDebounceMs);
    };

    chart.on("dataZoom", handleDataZoom);

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(rootRef.current);

    onChartApiReady?.({
      appendLivePoints: (updates) => {
        const active = new Set(tags.map((tag) => tag.tag));
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
          current.push({
            t: update.timestamp,
            v: numericValue,
            q: update.quality?.toLowerCase() === "bad"
              ? "bad"
              : update.quality?.toLowerCase() === "uncertain"
                ? "uncertain"
                : "good",
          });
          if (update.timestamp < minUpdateTs) {
            minUpdateTs = update.timestamp;
          }
          if (update.timestamp > maxUpdateTs) {
            maxUpdateTs = update.timestamp;
          }
          if (current.length > settings.liveBufferLimit) {
            current.splice(0, current.length - settings.liveBufferLimit);
          }
          seriesPointsRef.current.set(update.tag, current);
          updatedTags.add(update.tag);
        }

        if (updatedTags.size === 0) {
          return;
        }

        if (Number.isFinite(minUpdateTs) && Number.isFinite(maxUpdateTs)) {
          fullRangeRef.current = {
            from: Math.min(fullRangeRef.current.from, minUpdateTs),
            to: Math.max(fullRangeRef.current.to, maxUpdateTs),
          };
        }

        if (liveMode) {
          const rightCandidate = Number.isFinite(maxUpdateTs) ? maxUpdateTs : Date.now();
          const right = Math.max(liveLastEmittedRightRef.current ?? rightCandidate, rightCandidate);
          if (liveLastEmittedRightRef.current === null || right - liveLastEmittedRightRef.current >= 800) {
            liveLastEmittedRightRef.current = right;
            const left = right - liveWindowMs;
            onVisibleRangeChange({ from: left, to: right }, "live");
          }
        }
        renderChart();
      },
      getWidth: () => rootRef.current?.clientWidth ?? 0,
      getPointCount: () => [...seriesPointsRef.current.values()].reduce((acc, points) => acc + points.length, 0),
    });

    return () => {
      chart.off("dataZoom", handleDataZoom);
      resizeObserver.disconnect();
      if (zoomTimerRef.current) {
        window.clearTimeout(zoomTimerRef.current);
      }
      chart.dispose();
      chartRef.current = null;
      liveLastEmittedRightRef.current = null;
    };
  }, [liveMode, liveWindowMs, onChartApiReady, onVisibleRangeChange, settings.liveBufferLimit, settings.zoomDebounceMs, tags]);

  useEffect(() => {
    const nextMap = new Map<string, TrendPoint[]>();
    let minTs = Number.POSITIVE_INFINITY;
    let maxTs = Number.NEGATIVE_INFINITY;
    for (const series of data?.series ?? []) {
      nextMap.set(series.tag, [...series.points]);
      for (const point of series.points) {
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
  }, [data, visibleRange]);

  useEffect(() => {
    renderChart();
  }, [axes, axisIdByTag, settings, tags, visibleRange.from, visibleRange.to]);

  return <div ref={rootRef} className="trends-chart" />;
}
