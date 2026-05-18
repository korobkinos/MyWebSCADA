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
  const tagsRef = useRef(tags);
  const liveBufferLimitRef = useRef(settings.liveBufferLimit);
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
    tagsRef.current = tags;
  }, [tags]);

  useEffect(() => {
    liveBufferLimitRef.current = settings.liveBufferLimit;
  }, [settings.liveBufferLimit]);

  const renderChart = (): void => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    const activeTags = tags.filter((tag) => tag.visible !== false);
    const safeAxes: TrendAxisConfig[] = axes.length > 0
      ? axes
      : [{
          id: "axis:default",
          name: "default",
          position: "left",
          offset: 0,
          min: "auto",
          max: "auto",
        }];
    const axisIndexById = new Map<string, number>(safeAxes.map((axis, index) => [axis.id, index]));

    const yAxis = safeAxes.map((axis) => ({
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
      const axisId = axisIdByTag.get(tag.tag) ?? safeAxes[0]?.id;
      const yAxisIndex = axisId ? (axisIndexById.get(axisId) ?? 0) : 0;

      return {
        id: tag.tag,
        name: tag.displayName || tag.tag,
        type: "line" as const,
        showSymbol: settings.showSymbols || renderMode === "points",
        symbol: settings.showSymbols || renderMode === "points" ? "circle" : "none",
        sampling: settings.aggregation === "minmax" ? "minmax" : settings.aggregation === "lttb" ? "lttb" : undefined,
        progressive: 0,
        animation: false,
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
      animation: false,
      textStyle: { color: TREND_WORKBENCH_THEME.text },
      grid: {
        left: 56 + Math.max(0, (safeAxes.filter((axis) => axis.position === "left").length - 1) * (settings.axisOffsetStep + 10)),
        right: 56 + Math.max(0, (safeAxes.filter((axis) => axis.position === "right").length - 1) * (settings.axisOffsetStep + 10)),
        top: 34,
        bottom: interactiveZoomEnabled && showDataZoomSlider ? 74 : 20,
        containLabel: true,
      },
      legend: {
        show: showLegend && settings.legend,
        type: "scroll",
        top: 4,
        textStyle: { color: TREND_WORKBENCH_THEME.text },
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
        axisPointer: { show: true, label: { show: false } },
        axisLabel: { show: settings.axisLabels, color: TREND_WORKBENCH_THEME.mutedText },
        splitLine: { show: settings.gridLines, lineStyle: { color: TREND_WORKBENCH_THEME.gridLine } },
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
              borderColor: TREND_WORKBENCH_THEME.border,
              fillerColor: "rgba(0, 122, 204, 0.24)",
              backgroundColor: "rgba(255,255,255,0.03)",
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
    chart.setOption(option, { notMerge: true, lazyUpdate: true });
    window.setTimeout(() => {
      optionGuardRef.current = false;
    }, 0);
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
        onHoverSnapshotChangeRef.current?.(null);
        return;
      }
      const values: Record<string, number | boolean | string | null> = {};
      for (const tag of tagsRef.current) {
        const points = seriesPointsRef.current.get(tag.tag) ?? [];
        values[tag.tag] = resolveSeriesValueAtTimestamp(points, timestamp);
      }
      onHoverSnapshotChangeRef.current?.({ timestamp, values });
    };

    const handleMouseOut = () => {
      onHoverSnapshotChangeRef.current?.(null);
    };

    if (interactiveZoomEnabled) {
      chart.on("dataZoom", handleDataZoom);
    }
    chart.on("updateAxisPointer", handleAxisPointer);
    chart.on("mouseout", handleMouseOut);

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
          if (current.length > liveBufferLimitRef.current) {
            current.splice(0, current.length - liveBufferLimitRef.current);
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

        if (liveModeRef.current) {
          const now = Date.now();
          const right = Math.max(liveLastEmittedRightRef.current ?? now, now);
          liveLastEmittedRightRef.current = right;
          fullRangeRef.current = {
            from: fullRangeRef.current.from,
            to: Math.max(fullRangeRef.current.to, right),
          };
          const left = right - liveWindowMsRef.current;
          onVisibleRangeChangeRef.current({ from: left, to: right }, "live");
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
      chart.off("mouseout", handleMouseOut);
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
    for (const series of data?.series ?? []) {
      const normalizedPoints = normalizeSeriesPoints(series.points);
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
