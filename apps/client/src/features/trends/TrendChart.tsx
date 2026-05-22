import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, GraphicComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ECharts, EChartsCoreOption } from "echarts/core";
import type { TrendAxisConfig, TrendAxisTitleMode, TrendChartApi, TrendPoint, TrendQueryResponse, TrendSettings, TrendTagSelection, TrendVisibleRange } from "./trendTypes";
import { isTrendPerfDebugEnabled, logTrendDiagnostics } from "./trendDiagnostics";
import { resolveTrendTheme } from "./trendTheme";
import { appendLiveCarryForwardPoint, insertTrendGapBreaks, normalizeTrendPoints, resolveTrendGapBreakMs } from "./trendUtils";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, GraphicComponent, CanvasRenderer]);
const LIVE_GAP_MIN_BREAK_MS = 10_000;
const LIVE_RIGHT_DRIFT_LIMIT_MS = 5_000;
const LIVE_TRIM_GRACE_MS = 15_000;
const LIVE_DOMAIN_GRACE_MS = 1500;
const LIVE_CARRY_FORWARD_TICK_MS = 500;
const LIVE_MIN_SERIES_POINT_CAP = 200;
const LIVE_MAX_SERIES_POINT_CAP = 20_000;
const Y_AXIS_HIT_ZONE_MIN_PX = 42;
const Y_AXIS_HIT_ZONE_MAX_PX = 96;
const Y_AXIS_INNER_GAP_PX = 2;
const Y_AXIS_EDGE_PADDING_PX = 10;
const Y_AXIS_MIN_SPAN = 1e-6;
const Y_AXIS_WHEEL_ZOOM_BASE = 0.12;
const Y_AXIS_LABEL_CHAR_BUDGET = 8;
const Y_AXIS_VERTICAL_LABEL_MAX_CHARS = 28;
const Y_AXIS_COMPACT_LABEL_MAX_CHARS = 18;
const Y_AXIS_VERTICAL_LABEL_ROTATION_RAD = Math.PI / 2;
const Y_AXIS_VERTICAL_LABEL_MIN_PADDING_X = 4;
const Y_AXIS_VERTICAL_LABEL_MIN_PADDING_Y = 2;

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
  disableAnimation?: boolean;
  liveWindowMs: number;
  onVisibleRangeChange: (range: TrendVisibleRange, source: "interaction" | "live") => void;
  onHoverSnapshotChange?: (snapshot: { timestamp: number; values: Record<string, number | boolean | string | null> } | null) => void;
  onChartApiReady?: (api: TrendChartApi) => void;
  onAxisManualRangeCommit?: (axisId: string, range: { min: number; max: number } | null) => void;
  probeEnabled?: boolean;
  probeTimestamp?: number | null;
  onProbeTimestampChange?: (timestamp: number | null) => void;
};

type TrendAxisRuntimeInfo = {
  id: string;
  position: "left" | "right";
  offset: number;
  yAxisIndex: number;
  grabWidth: number;
};

type TrendGridRuntimeInfo = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type TrendAxisStats = {
  min: number;
  max: number;
  hasNumeric: boolean;
};

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
  disableAnimation = false,
  liveWindowMs,
  onVisibleRangeChange,
  onHoverSnapshotChange,
  onChartApiReady,
  onAxisManualRangeCommit,
  probeEnabled = false,
  probeTimestamp = null,
  onProbeTimestampChange,
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
  const liveNowRef = useRef<number>(Date.now());
  const liveModeRef = useRef(liveMode);
  const liveWindowMsRef = useRef(liveWindowMs);
  const onVisibleRangeChangeRef = useRef(onVisibleRangeChange);
  const onHoverSnapshotChangeRef = useRef(onHoverSnapshotChange);
  const onAxisManualRangeCommitRef = useRef(onAxisManualRangeCommit);
  const probeEnabledRef = useRef(probeEnabled);
  const probeTimestampRef = useRef<number | null>(probeTimestamp);
  const onProbeTimestampChangeRef = useRef(onProbeTimestampChange);
  const zoomDebounceMsRef = useRef(settings.zoomDebounceMs);
  const liveSeriesPointCapRef = useRef(resolveLiveSeriesPointCap(settings.maxLivePointsPerTag));
  const tagsRef = useRef(tags);
  const lastAxisPointerTsRef = useRef<number | null>(null);
  const renderChartRef = useRef<() => void>(() => {});
  const renderRafRef = useRef<number | null>(null);
  const renderRafReasonRef = useRef<string | null>(null);
  const renderThrottleCountRef = useRef(0);
  const appendLivePointsCallCountRef = useRef(0);
  const yAxisOverrideRef = useRef<Map<string, { min: number; max: number }>>(new Map());
  const yAxisRuntimeInfoRef = useRef<TrendAxisRuntimeInfo[]>([]);
  const gridRuntimeInfoRef = useRef<TrendGridRuntimeInfo | null>(null);
  const hoveredYAxisIdRef = useRef<string | null>(null);
  const yAxisPanStateRef = useRef<{
    axisId: string;
    startMin: number;
    startMax: number;
    startPointerY: number;
    valuePerPixel: number;
  } | null>(null);
  const axisStatsByTagRef = useRef<Map<string, TrendAxisStats>>(new Map());
  const activeTagNameSetRef = useRef<Set<string>>(new Set(tags.map((tag) => tag.tag)));
  const skipNextDataZoomUntilRef = useRef(0);
  const hoverRafRef = useRef<number | null>(null);
  const hoverPendingTsRef = useRef<number | null>(null);
  const hoverLastSnapshotRef = useRef<{ timestamp: number; values: Record<string, number | boolean | string | null> } | null>(null);
  const hoverThrottleCountRef = useRef(0);
  const rootCursorRef = useRef<string>("");
  const lastPointerPixelXRef = useRef<number | null>(null);
  const lastPointerPixelYRef = useRef<number | null>(null);
  const pointerInsideRef = useRef(false);
  const restoreAxisPointerRafRef = useRef<number | null>(null);
  const axisPointerRestoreImmediateCountRef = useRef(0);
  const axisPointerRestoreRafCountRef = useRef(0);
  const axisPointerSkippedClearCountRef = useRef(0);
  const liveRenderCountRef = useRef(0);
  const skipNextVisibleRangeRenderInLiveRef = useRef(false);
  const axisCommitTimersRef = useRef<Map<string, number>>(new Map());
  const probeDragActiveRef = useRef(false);
  const recomputeAxisStats = (points: TrendPoint[]): TrendAxisStats => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      if (!point || typeof point.v !== "number" || !Number.isFinite(point.v)) {
        continue;
      }
      if (point.v < min) {
        min = point.v;
      }
      if (point.v > max) {
        max = point.v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: 0, max: 0, hasNumeric: false };
    }
    return { min, max, hasNumeric: true };
  };
  const setRootCursor = (nextCursor: string): void => {
    const normalizedCursor = nextCursor || "default";
    if (!rootRef.current || rootCursorRef.current === normalizedCursor) {
      return;
    }
    rootRef.current.style.cursor = normalizedCursor;
    rootCursorRef.current = normalizedCursor;
  };
  const scheduleRender = (reason: string): void => {
    if (renderRafRef.current !== null) {
      renderThrottleCountRef.current += 1;
      renderRafReasonRef.current = reason;
      return;
    }
    renderRafReasonRef.current = reason;
    renderRafRef.current = window.requestAnimationFrame(() => {
      renderRafRef.current = null;
      renderChartRef.current();
    });
  };
  const resolveAxisRangeFromChart = (axisId: string, yAxisIndex: number): { min: number; max: number } | null => {
    const override = yAxisOverrideRef.current.get(axisId);
    if (override) {
      return override;
    }
    const chart = chartRef.current;
    const grid = gridRuntimeInfoRef.current;
    if (!chart || !grid) {
      return null;
    }
    const min = Number(chart.convertFromPixel({ yAxisIndex }, grid.bottom));
    const max = Number(chart.convertFromPixel({ yAxisIndex }, grid.top));
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min <= Y_AXIS_MIN_SPAN) {
      return null;
    }
    return { min, max };
  };
  const scheduleAxisCommit = (axisId: string, range: { min: number; max: number } | null, immediate = false): void => {
    const callback = onAxisManualRangeCommitRef.current;
    if (!callback) {
      return;
    }
    const timers = axisCommitTimersRef.current;
    const existingTimer = timers.get(axisId);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      timers.delete(axisId);
    }
    if (immediate) {
      callback(axisId, range);
      return;
    }
    const timerId = window.setTimeout(() => {
      timers.delete(axisId);
      callback(axisId, range);
    }, 240);
    timers.set(axisId, timerId);
  };
  const applyYAxisOverride = (axisId: string, range: { min: number; max: number }, options?: { commit?: boolean; immediateCommit?: boolean }): void => {
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) {
      return;
    }
    const min = Math.min(range.min, range.max);
    const max = Math.max(range.min, range.max);
    if (max - min <= Y_AXIS_MIN_SPAN) {
      return;
    }
    yAxisOverrideRef.current.set(axisId, { min, max });
    if (options?.commit) {
      scheduleAxisCommit(axisId, { min, max }, options.immediateCommit === true);
    }
    scheduleRender("y-axis-override");
  };
  const resetYAxisOverride = (axisId: string): void => {
    if (!yAxisOverrideRef.current.has(axisId)) {
      return;
    }
    yAxisOverrideRef.current.delete(axisId);
    scheduleAxisCommit(axisId, null, true);
    scheduleRender("y-axis-reset");
  };
  const findYAxisInteractionTarget = (x: number, y: number): TrendAxisRuntimeInfo | null => {
    const grid = gridRuntimeInfoRef.current;
    if (!grid) {
      return null;
    }
    if (y < grid.top - Y_AXIS_EDGE_PADDING_PX || y > grid.bottom + Y_AXIS_EDGE_PADDING_PX) {
      return null;
    }
    let best: { axis: TrendAxisRuntimeInfo; distance: number } | null = null;
    for (const axis of yAxisRuntimeInfoRef.current) {
      const axisLineX = axis.position === "left"
        ? grid.left - axis.offset
        : grid.right + axis.offset;
      const minX = axis.position === "left"
        ? axisLineX - axis.grabWidth
        : axisLineX + Y_AXIS_INNER_GAP_PX;
      const maxX = axis.position === "left"
        ? axisLineX - Y_AXIS_INNER_GAP_PX
        : axisLineX + axis.grabWidth;
      if (x < minX || x > maxX) {
        continue;
      }
      const centerX = (minX + maxX) / 2;
      const distance = Math.abs(x - centerX);
      if (!best || distance < best.distance) {
        best = { axis, distance };
      }
    }
    return best?.axis ?? null;
  };
  const applyYAxisZoom = (axis: TrendAxisRuntimeInfo, deltaY: number, pointerY: number): void => {
    const chart = chartRef.current;
    if (!chart || !Number.isFinite(deltaY) || Math.abs(deltaY) < 1e-3) {
      return;
    }
    const current = resolveAxisRangeFromChart(axis.id, axis.yAxisIndex);
    if (!current) {
      return;
    }
    const span = Math.max(Y_AXIS_MIN_SPAN, current.max - current.min);
    const factor = deltaY > 0 ? 1 + Y_AXIS_WHEEL_ZOOM_BASE : 1 - Y_AXIS_WHEEL_ZOOM_BASE;
    const pointerValueRaw = Number(chart.convertFromPixel({ yAxisIndex: axis.yAxisIndex }, pointerY));
    const anchor = Number.isFinite(pointerValueRaw) ? pointerValueRaw : (current.min + current.max) / 2;
    const nextMin = anchor - (anchor - current.min) * factor;
    const nextMax = anchor + (current.max - anchor) * factor;
    if (Math.abs(nextMax - nextMin) < Math.min(Y_AXIS_MIN_SPAN, span)) {
      return;
    }
    applyYAxisOverride(axis.id, { min: nextMin, max: nextMax }, { commit: true });
  };
  const startYAxisPan = (axis: TrendAxisRuntimeInfo, pointerY: number): void => {
    const current = resolveAxisRangeFromChart(axis.id, axis.yAxisIndex);
    const grid = gridRuntimeInfoRef.current;
    if (!current) {
      return;
    }
    if (!grid) {
      return;
    }
    const plotHeight = Math.max(1, grid.bottom - grid.top);
    const span = Math.max(Y_AXIS_MIN_SPAN, current.max - current.min);
    yAxisPanStateRef.current = {
      axisId: axis.id,
      startMin: current.min,
      startMax: current.max,
      startPointerY: pointerY,
      valuePerPixel: span / plotHeight,
    };
    setRootCursor("ns-resize");
  };
  const updateYAxisPan = (pointerY: number): void => {
    const state = yAxisPanStateRef.current;
    if (!state) {
      return;
    }
    const deltaPixels = pointerY - state.startPointerY;
    const delta = deltaPixels * state.valuePerPixel;
    applyYAxisOverride(state.axisId, {
      min: state.startMin + delta,
      max: state.startMax + delta,
    }, { commit: false });
  };
  const finishYAxisPan = (): void => {
    const state = yAxisPanStateRef.current;
    yAxisPanStateRef.current = null;
    if (state) {
      const range = yAxisOverrideRef.current.get(state.axisId);
      if (range) {
        scheduleAxisCommit(state.axisId, range, true);
      }
    }
    setRootCursor(hoveredYAxisIdRef.current ? "ns-resize" : "");
  };
  const isPointInsidePlot = (x: number, y: number): boolean => {
    const grid = gridRuntimeInfoRef.current;
    if (!grid) {
      return false;
    }
    return x >= grid.left && x <= grid.right && y >= grid.top && y <= grid.bottom;
  };
  const clampTimestampToDomain = (timestamp: number): number | null => {
    if (!Number.isFinite(timestamp)) {
      return null;
    }
    const domain = fullRangeRef.current;
    if (!Number.isFinite(domain.from) || !Number.isFinite(domain.to) || domain.to <= domain.from) {
      return timestamp;
    }
    return Math.max(domain.from, Math.min(domain.to, timestamp));
  };
  const resolveTimestampFromPixelX = (x: number): number | null => {
    const chart = chartRef.current;
    if (!chart || !Number.isFinite(x)) {
      return null;
    }
    const raw = Number(chart.convertFromPixel({ xAxisIndex: 0 }, x));
    return clampTimestampToDomain(raw);
  };
  const showAxisPointerAtTimestamp = (timestamp: number): void => {
    const chart = chartRef.current;
    if (!chart || !Number.isFinite(timestamp)) {
      return;
    }
    let pointerX = Number(chart.convertToPixel({ xAxisIndex: 0 }, timestamp));
    if (!Number.isFinite(pointerX)) {
      pointerX = lastPointerPixelXRef.current ?? Number.NaN;
    } else {
      lastPointerPixelXRef.current = pointerX;
    }
    if (Number.isFinite(pointerX)) {
      chart.dispatchAction({
        type: "updateAxisPointer",
        x: pointerX,
        currTrigger: "mousemove",
      });
    }
    chart.dispatchAction({
      type: "showTip",
      xAxisIndex: 0,
      value: timestamp,
    });
  };
  const restoreAxisPointerFromPointer = (mode: "immediate" | "raf"): boolean => {
    const chart = chartRef.current;
    const x = lastPointerPixelXRef.current;
    const y = lastPointerPixelYRef.current;
    if (x === null || y === null || !chart || !pointerInsideRef.current || !Number.isFinite(x) || !Number.isFinite(y) || !isPointInsidePlot(x, y)) {
      return false;
    }
    chart.dispatchAction({
      type: "updateAxisPointer",
      currTrigger: "mousemove",
      x,
      y,
    });
    chart.dispatchAction({
      type: "showTip",
      x,
      y,
    });
    const pointerTs = Number(chart.convertFromPixel({ xAxisIndex: 0 }, x));
    if (Number.isFinite(pointerTs)) {
      lastAxisPointerTsRef.current = pointerTs;
      if (probeEnabledRef.current) {
        probeTimestampRef.current = pointerTs;
        onProbeTimestampChangeRef.current?.(pointerTs);
      }
    }
    if (mode === "immediate") {
      axisPointerRestoreImmediateCountRef.current += 1;
    } else {
      axisPointerRestoreRafCountRef.current += 1;
    }
    if (isTrendPerfDebugEnabled()) {
      logTrendDiagnostics("chart:axis-pointer-restore", {
        mode,
        liveMode: liveModeRef.current,
      });
    }
    return true;
  };
  const scheduleAxisPointerRestoreFromPointer = (): void => {
    if (restoreAxisPointerRafRef.current !== null) {
      window.cancelAnimationFrame(restoreAxisPointerRafRef.current);
    }
    restoreAxisPointerRafRef.current = window.requestAnimationFrame(() => {
      restoreAxisPointerRafRef.current = null;
      restoreAxisPointerFromPointer("raf");
    });
  };
  const setProbeTimestampInternal = (timestamp: number | null, emitChange: boolean): void => {
    probeTimestampRef.current = timestamp;
    if (timestamp === null) {
      return;
    }
    lastAxisPointerTsRef.current = timestamp;
    if (emitChange) {
      onProbeTimestampChangeRef.current?.(timestamp);
    }
    showAxisPointerAtTimestamp(timestamp);
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
    if (liveMode) {
      liveNowRef.current = Date.now();
    }
  }, [liveMode]);

  useEffect(() => {
    liveWindowMsRef.current = liveWindowMs;
  }, [liveWindowMs]);

  useEffect(() => {
    if (!liveMode) {
      return;
    }
    const timerId = window.setInterval(() => {
      liveNowRef.current = Date.now();
      scheduleRender("live-carry-forward-tick");
    }, LIVE_CARRY_FORWARD_TICK_MS);
    return () => {
      window.clearInterval(timerId);
    };
  }, [liveMode]);

  useEffect(() => {
    onVisibleRangeChangeRef.current = onVisibleRangeChange;
  }, [onVisibleRangeChange]);

  useEffect(() => {
    onHoverSnapshotChangeRef.current = onHoverSnapshotChange;
  }, [onHoverSnapshotChange]);

  useEffect(() => {
    onAxisManualRangeCommitRef.current = onAxisManualRangeCommit;
  }, [onAxisManualRangeCommit]);

  useEffect(() => {
    probeEnabledRef.current = probeEnabled;
    if (!probeEnabled) {
      probeDragActiveRef.current = false;
      return;
    }
    const ts = probeTimestampRef.current ?? clampTimestampToDomain(visibleRange.to) ?? null;
    if (ts !== null) {
      setProbeTimestampInternal(ts, false);
      scheduleRender("probe-enabled");
    }
  }, [probeEnabled, visibleRange.to]);

  useEffect(() => {
    probeTimestampRef.current = probeTimestamp;
    if (!probeEnabledRef.current) {
      return;
    }
    if (probeTimestamp === null) {
      return;
    }
    const clamped = clampTimestampToDomain(probeTimestamp);
    if (clamped === null) {
      return;
    }
    lastAxisPointerTsRef.current = clamped;
    showAxisPointerAtTimestamp(clamped);
  }, [probeTimestamp]);

  useEffect(() => {
    onProbeTimestampChangeRef.current = onProbeTimestampChange;
  }, [onProbeTimestampChange]);

  useEffect(() => {
    zoomDebounceMsRef.current = settings.zoomDebounceMs;
  }, [settings.zoomDebounceMs]);

  useEffect(() => {
    liveSeriesPointCapRef.current = resolveLiveSeriesPointCap(settings.maxLivePointsPerTag);
  }, [settings.maxLivePointsPerTag]);

  useEffect(() => {
    tagsRef.current = tags;
    activeTagNameSetRef.current = new Set(tags.map((tag) => tag.tag));
  }, [tags]);

  useEffect(() => {
    const knownAxisIds = new Set(axes.map((axis) => axis.id));
    const overrides = yAxisOverrideRef.current;
    for (const axisId of [...overrides.keys()]) {
      if (!knownAxisIds.has(axisId)) {
        overrides.delete(axisId);
      }
    }
  }, [axes]);

  const renderChart = (): void => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }
    const debugPerf = isTrendPerfDebugEnabled();
    const renderStartedAt = debugPerf ? performance.now() : 0;
    if (liveModeRef.current) {
      liveRenderCountRef.current += 1;
    }
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
      axisTitleMode: "hidden",
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
    let safeAxes: TrendAxisConfig[] = baseAxes.filter((axis) => usedAxisIds.has(axis.id));
    if (safeAxes.length === 0 && activeTags.length > 0) {
      safeAxes = [baseAxes[0] ?? fallbackAxis];
    }
    safeAxes = safeAxes.map((axis) => {
      const axisPosition = axis.position === "right" ? "right" : "left";
      return {
        ...axis,
        position: axisPosition,
        offset: Math.max(0, Number(axis.offset ?? 0)),
      };
    });
    const axisIndexById = new Map<string, number>(safeAxes.map((axis, index) => [axis.id, index]));
    const axisRangeById = new Map<string, { min: number; max: number }>();
    for (const tag of activeTags) {
      const axisId = axisIdByTag.get(tag.tag) ?? safeAxes[0]?.id;
      if (!axisId) {
        continue;
      }
      const stats = axisStatsByTagRef.current.get(tag.tag);
      if (!stats || !stats.hasNumeric) {
        continue;
      }
      const current = axisRangeById.get(axisId);
      if (!current) {
        axisRangeById.set(axisId, { min: stats.min, max: stats.max });
      } else {
        if (stats.min < current.min) {
          current.min = stats.min;
        }
        if (stats.max > current.max) {
          current.max = stats.max;
        }
      }
    }

    const resolveAxisTitleMode = (axis: TrendAxisConfig): TrendAxisTitleMode => {
      return axis.axisTitleMode === "hidden"
        || axis.axisTitleMode === "compactLabel"
        || axis.axisTitleMode === "verticalLabel"
        ? axis.axisTitleMode
        : "hidden";
    };
    const axisScaleGapPx = Math.max(0, Math.round(Number(settings.axisScaleGap ?? 6)));
    const resolveAxisTitleGapPx = (axis: TrendAxisConfig): number => {
      return Math.max(0, Math.round(Number(axis.axisNameGap ?? 6)));
    };
    const resolveAxisNameOutwardPx = (axis: TrendAxisConfig, axisTitleMode: TrendAxisTitleMode) => {
      if (axisTitleMode === "hidden") {
        return 0;
      }
      const fontSize = Math.max(9, Number(axis.axisNameFontSize ?? 12));
      const padX = Math.max(0, Number(axis.axisNamePaddingX ?? 6));
      const padY = Math.max(0, Number(axis.axisNamePaddingY ?? 4));
      const titleGap = resolveAxisTitleGapPx(axis);
      if (axisTitleMode === "verticalLabel") {
        const textHeight = Math.ceil(Math.max(10, fontSize * 1.2));
        return Math.ceil(textHeight + (padY * 2) + 2 + titleGap);
      }
      const axisName = (axis.name || axis.unit || axis.id || "").trim();
      if (!axisName) {
        return 0;
      }
      const rawName = axisName.length > Y_AXIS_COMPACT_LABEL_MAX_CHARS
        ? `${axisName.slice(0, Math.max(1, Y_AXIS_COMPACT_LABEL_MAX_CHARS - 3))}...`
        : axisName;
      const textWidth = Math.ceil(Math.max(1, rawName.length) * fontSize * 0.62);
      return Math.ceil(textWidth + (padX * 2) + 4 + titleGap);
    };
    const resolveAxisLabelOutwardPx = (axis: TrendAxisConfig) => {
      if (!settings.axisLabels) {
        return 8;
      }
      const fontSize = Math.max(9, Number(axis.axisLabelFontSize ?? 12));
      const margin = Math.max(0, Number(axis.axisLabelMargin ?? 6));
      const approxCharWidth = fontSize * 0.62;
      const valueCandidates: number[] = [];
      const override = yAxisOverrideRef.current.get(axis.id);
      if (override) {
        valueCandidates.push(override.min, override.max);
      }
      if (typeof axis.min === "number") {
        valueCandidates.push(axis.min);
      }
      if (typeof axis.max === "number") {
        valueCandidates.push(axis.max);
      }
      const range = axisRangeById.get(axis.id);
      if (range) {
        valueCandidates.push(range.min, range.max);
      }
      if (valueCandidates.length === 0) {
        valueCandidates.push(0);
      }
      let maxLabelChars = 1;
      for (const value of valueCandidates) {
        const text = String(Math.round(Number(value)));
        if (text.length > maxLabelChars) {
          maxLabelChars = text.length;
        }
      }
      const estimatedChars = Math.max(3, Math.min(Y_AXIS_LABEL_CHAR_BUDGET, maxLabelChars + 1));
      const labelWidth = Math.ceil(estimatedChars * approxCharWidth);
      return Math.max(fontSize + margin + 8, labelWidth + margin + 12);
    };
    const axisLayoutById = new Map<string, { offset: number; outward: number }>();
    for (const side of ["left", "right"] as const) {
      const sideAxes = safeAxes
        .map((axis, index) => ({ axis, index }))
        .filter((entry) => entry.axis.position === side)
        .sort((a, b) => (Number(a.axis.offset ?? 0) - Number(b.axis.offset ?? 0)) || (a.index - b.index));
      let previousOccupiedEnd = Number.NEGATIVE_INFINITY;
      for (const entry of sideAxes) {
        const axisTitleMode = resolveAxisTitleMode(entry.axis);
        const outward = resolveAxisNameOutwardPx(entry.axis, axisTitleMode) + resolveAxisLabelOutwardPx(entry.axis);
        const requestedOffset = Math.max(0, Number(entry.axis.offset ?? 0));
        const offset = Number.isFinite(previousOccupiedEnd)
          ? Math.max(requestedOffset, previousOccupiedEnd + axisScaleGapPx)
          : requestedOffset;
        axisLayoutById.set(entry.axis.id, { offset, outward });
        previousOccupiedEnd = offset + outward;
      }
    }
    yAxisRuntimeInfoRef.current = safeAxes.map((axis, index) => {
      const layout = axisLayoutById.get(axis.id);
      const axisTitleMode = resolveAxisTitleMode(axis);
      const outward = layout?.outward ?? (resolveAxisNameOutwardPx(axis, axisTitleMode) + resolveAxisLabelOutwardPx(axis));
      return {
        id: axis.id,
        position: axis.position,
        offset: layout?.offset ?? Math.max(0, Number(axis.offset ?? 0)),
        yAxisIndex: index,
        grabWidth: Math.max(Y_AXIS_HIT_ZONE_MIN_PX, Math.min(Y_AXIS_HIT_ZONE_MAX_PX, Math.round(outward))),
      };
    });

    const yAxis = safeAxes.map((axis) => {
      const axisLabelMargin = Math.max(0, Number(axis.axisLabelMargin ?? 6));
      const axisLabelFontSize = Math.max(9, Number(axis.axisLabelFontSize ?? 12));
      const axisLabelWidth = Math.ceil((axisLabelFontSize * 0.62) * Y_AXIS_LABEL_CHAR_BUDGET);
      const override = yAxisOverrideRef.current.get(axis.id);
      const layout = axisLayoutById.get(axis.id);
      const axisTextColor = axis.axisTextColor ?? axis.color ?? uiTheme.text;
      const axisGridLineColor = axis.axisGridLineColor ?? uiTheme.gridLine;
      const axisPointerLabelBackgroundColor = axis.axisPointerLabelBackgroundColor ?? uiTheme.tooltipBg;
      const axisPointerLabelFontSize = Math.max(11, axisLabelFontSize);
      return ({
      type: "value" as const,
      zlevel: -5,
      z: -5,
      name: "",
      position: axis.position,
      offset: layout?.offset ?? Math.max(0, Number(axis.offset ?? 0)),
      scale: settings.autoScale,
      min: (() => {
        if (override) {
          return override.min;
        }
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
        if (override) {
          return override.max;
        }
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
      nameRotate: 0,
      nameGap: 0,
      axisLine: { show: true, lineStyle: { color: axisTextColor } },
      axisPointer: {
        show: true,
        z: 220,
        zlevel: 220,
        label: {
          show: true,
          z: 220,
          zlevel: 220,
          color: uiTheme.text,
          backgroundColor: axisPointerLabelBackgroundColor,
          borderColor: uiTheme.border,
          borderWidth: 1,
          padding: [3, 8, 3, 8],
          fontSize: axisPointerLabelFontSize,
          fontWeight: 600,
          lineHeight: axisPointerLabelFontSize + 2,
        },
      },
      axisLabel: {
        show: settings.axisLabels,
        color: axisTextColor,
        hideOverlap: false,
        showMinLabel: true,
        showMaxLabel: true,
        margin: axisLabelMargin,
        fontSize: axisLabelFontSize,
        width: axisLabelWidth,
        overflow: "truncate",
        ellipsis: "...",
        align: axis.position === "left" ? "right" : "left",
        verticalAlign: "middle",
        formatter: (value: number) => {
          const numeric = Number(value);
          return Number.isFinite(numeric) ? String(Math.round(numeric)) : String(value);
        },
      },
      minInterval: 1,
      splitLine: { show: settings.gridLines, lineStyle: { color: axisGridLineColor, type: "dashed" } },
    });
    });
    const axisTitleLabelSpecs = safeAxes
      .map((axis) => {
        const axisTitleMode = resolveAxisTitleMode(axis);
        if (axisTitleMode === "hidden") {
          return null;
        }
        const axisName = (axis.name || axis.unit || axis.id || "").trim();
        if (!axisName) {
          return null;
        }
        const axisTextColor = axis.axisTextColor ?? axis.color ?? uiTheme.text;
        const layout = axisLayoutById.get(axis.id);
        return {
          axisName,
          position: axis.position,
          offset: layout?.offset ?? Math.max(0, Number(axis.offset ?? 0)),
          horizontalOffsetX: Math.round(Number(axis.verticalLabelOffsetX ?? 0)),
          fontSize: Math.max(9, Number(axis.axisNameFontSize ?? 12)),
          paddingX: Math.max(0, Number(axis.axisNamePaddingX ?? 6)),
          paddingY: Math.max(0, Number(axis.axisNamePaddingY ?? 4)),
          titleGap: resolveAxisTitleGapPx(axis),
          color: axisTextColor,
          mode: axisTitleMode,
          axisId: axis.id,
          backgroundColor: chartBackground,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const totalPointCount = activeTags.reduce((acc, tag) => acc + (seriesPointsRef.current.get(tag.tag)?.length ?? 0), 0);
    const isLargeDataset = totalPointCount >= 5000;
    const animationEnabled = !disableAnimation && !liveMode && (!settings.disableAnimationsLargeData || !isLargeDataset);
    const progressiveValue = settings.progressive ? 450 : 0;
    const progressiveThreshold = settings.progressive ? 2500 : Number.MAX_SAFE_INTEGER;

    const series: any[] = activeTags.map((tag) => {
      const sourcePoints = seriesPointsRef.current.get(tag.tag) ?? [];
      const lineWidth = tag.lineWidth ?? settings.defaultLineWidth;
      const lineType = tag.lineType ?? "solid";
      const renderMode = tag.mode ?? (tagsByName.get(tag.tag)?.mode ?? "line");
      const gapBreakMs = resolveTrendGapBreakMs(sourcePoints);
      const withGaps = insertTrendGapBreaks(sourcePoints, gapBreakMs);
      const liveNowTs = liveModeRef.current
        ? (liveLastEmittedRightRef.current ?? liveNowRef.current)
        : Number.NaN;
      const displayPoints = liveModeRef.current
        ? appendLiveCarryForwardPoint(withGaps.points, liveNowTs)
        : withGaps.points;
      const dataPoints: Array<[number, number | null]> = [];
      for (let pointIndex = 0; pointIndex < displayPoints.length; pointIndex += 1) {
        const point = displayPoints[pointIndex];
        if (!point) {
          continue;
        }
        const quality = (point.q ?? "good").toLowerCase();
        const invalidQuality = quality === "bad" || quality === "uncertain";
        const value = settings.showBadQualityGaps && invalidQuality ? null : point.v;
        dataPoints.push([point.t, value]);
      }
      for (const gap of withGaps.gaps) {
        logTrendDiagnostics("chart:gap-break", {
          tag: tag.tag,
          previousTs: gap.previousTs,
          currentTs: gap.currentTs,
          deltaMs: gap.deltaMs,
          gapBreakMs: gap.gapBreakMs,
          liveMode,
          source: "render",
        });
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
      const firstPoint = sourcePoints[0];
      const lastPoint = sourcePoints[sourcePoints.length - 1];
      logTrendDiagnostics("chart:series-render", {
        tag: tag.tag,
        liveMode,
        points: sourcePoints.length,
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
        cursor: "default",
        emphasis: {
          disabled: true,
          focus: "none" as const,
          scale: false,
        },
        blur: {
          lineStyle: {
            opacity: 1,
          },
          itemStyle: {
            opacity: 1,
          },
        },
        select: {
          disabled: true,
        },
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
    if (probeEnabledRef.current && probeTimestampRef.current !== null) {
      const probeTs = clampTimestampToDomain(probeTimestampRef.current);
      if (probeTs !== null) {
        series.push({
          id: "__trend_probe_cursor__",
          name: "__trend_probe_cursor__",
          type: "line" as const,
          data: [],
          symbol: "none",
          silent: true,
          tooltip: { show: false },
          lineStyle: { opacity: 0 },
          markLine: {
            silent: true,
            animation: false,
            symbol: ["none", "none"],
            label: { show: false },
            lineStyle: { color: "#8ea6ff", width: 1, type: "dashed", opacity: 0.95 },
            data: [{ xAxis: probeTs }],
          },
        });
      }
    }
    const echartsPointCount = series.reduce((count, item) => count + item.data.length, 0);

    const leftAxisOutward = safeAxes
      .filter((axis) => axis.position === "left")
      .reduce((max, axis) => {
        const layout = axisLayoutById.get(axis.id);
        const offset = layout?.offset ?? Math.max(0, Number(axis.offset ?? 0));
        const axisTitleMode = resolveAxisTitleMode(axis);
        const outward = layout?.outward ?? (resolveAxisNameOutwardPx(axis, axisTitleMode) + resolveAxisLabelOutwardPx(axis));
        return Math.max(max, offset + outward);
      }, 0);
    const rightAxisOutward = safeAxes
      .filter((axis) => axis.position === "right")
      .reduce((max, axis) => {
        const layout = axisLayoutById.get(axis.id);
        const offset = layout?.offset ?? Math.max(0, Number(axis.offset ?? 0));
        const axisTitleMode = resolveAxisTitleMode(axis);
        const outward = layout?.outward ?? (resolveAxisNameOutwardPx(axis, axisTitleMode) + resolveAxisLabelOutwardPx(axis));
        return Math.max(max, offset + outward);
      }, 0);
    const gridLeft = Math.max(2, Math.round(leftAxisOutward + 1));
    const gridRight = Math.max(2, Math.round(rightAxisOutward + 1));
    const gridTop = 34;
    const gridBottom = interactiveZoomEnabled && showDataZoomSlider ? 74 : 20;
    const rootWidth = rootRef.current?.clientWidth ?? 0;
    const rootHeight = rootRef.current?.clientHeight ?? 0;
    if (rootWidth > 0 && rootHeight > 0) {
      gridRuntimeInfoRef.current = {
        left: gridLeft,
        right: Math.max(gridLeft + 20, rootWidth - gridRight),
        top: gridTop,
        bottom: Math.max(gridTop + 20, rootHeight - gridBottom),
      };
    }
    const verticalAxisLabelGraphics: any[] = [];
    if (rootWidth > 0 && rootHeight > 0) {
      const axisCenterY = Math.round((gridTop + (rootHeight - gridBottom)) / 2);
      for (let index = 0; index < axisTitleLabelSpecs.length; index += 1) {
        const spec = axisTitleLabelSpecs[index];
        if (!spec) {
          continue;
        }
        const nameLimit = spec.mode === "verticalLabel" ? Y_AXIS_VERTICAL_LABEL_MAX_CHARS : Y_AXIS_COMPACT_LABEL_MAX_CHARS;
        const rawName = spec.axisName.length > nameLimit
          ? `${spec.axisName.slice(0, Math.max(1, nameLimit - 3))}...`
          : spec.axisName;
        const paddingX = Math.max(Y_AXIS_VERTICAL_LABEL_MIN_PADDING_X, spec.paddingX);
        const paddingY = Math.max(Y_AXIS_VERTICAL_LABEL_MIN_PADDING_Y, spec.paddingY);
        const textWidth = Math.ceil(Math.max(1, rawName.length) * spec.fontSize * 0.62);
        const textHeight = Math.ceil(Math.max(10, spec.fontSize * 1.2));
        const rectWidth = Math.ceil(textWidth + (paddingX * 2) + 2);
        const rectHeight = Math.ceil(textHeight + (paddingY * 2) + 2);
        const axisX = spec.position === "left"
          ? Math.round(gridLeft - spec.offset)
          : Math.round(rootWidth - gridRight + spec.offset);
        const layerShiftX = spec.mode === "verticalLabel"
          ? Math.ceil((rectHeight / 2) + spec.titleGap)
          : Math.ceil((rectWidth / 2) + spec.titleGap);
        const labelCenterX = axisX + (
          spec.position === "left"
            ? -layerShiftX
            : layerShiftX
        ) + spec.horizontalOffsetX;
        const centerY = axisCenterY;
        verticalAxisLabelGraphics.push({
          id: `trend-axis-label-group-${spec.axisId}`,
          type: "group",
          silent: true,
          zlevel: 40,
          z: 40,
          x: labelCenterX,
          y: centerY,
          rotation: spec.mode === "verticalLabel" ? Y_AXIS_VERTICAL_LABEL_ROTATION_RAD : 0,
          originX: 0,
          originY: 0,
          children: [
            {
              id: `trend-axis-label-bg-${spec.axisId}`,
              type: "rect",
              silent: true,
              z: 0,
              shape: {
                x: Math.round(-rectWidth / 2),
                y: Math.round(-rectHeight / 2),
                width: rectWidth,
                height: rectHeight,
                r: 3,
              },
              style: {
                fill: spec.backgroundColor,
                opacity: 1,
                stroke: uiTheme.border,
                lineWidth: 1,
              },
            },
            {
              id: `trend-axis-label-text-${spec.axisId}`,
              type: "text",
              silent: true,
              zlevel: 40,
              z: 2,
              style: {
                x: 0,
                y: 0,
                text: rawName,
                textAlign: "center",
                textVerticalAlign: "middle",
                fill: spec.color,
                fontSize: spec.fontSize,
                fontFamily: "Consolas",
                overflow: "truncate",
                width: textWidth,
              },
            },
          ],
        });
      }
    }

    const option: EChartsCoreOption = {
      // Keep full domain stable so wheel zoom can zoom-out after zoom-in.
      // Windowed range is controlled via dataZoom start/end values.
      backgroundColor: chartBackground,
      animation: animationEnabled,
      textStyle: { color: uiTheme.text },
      grid: {
        left: gridLeft,
        right: gridRight,
        top: gridTop,
        bottom: gridBottom,
        containLabel: false,
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
      graphic: verticalAxisLabelGraphics,
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
    const setOptionStartedAt = debugPerf ? performance.now() : 0;
    const lazyUpdate = !liveModeRef.current;
    const replaceMerge: string[] = liveModeRef.current ? ["series", "yAxis", "graphic"] : ["series", "yAxis", "graphic"];
    chart.setOption(option, { notMerge: false, lazyUpdate, replaceMerge });
    const hasPointerPixels = pointerInsideRef.current
      && lastPointerPixelXRef.current !== null
      && lastPointerPixelYRef.current !== null
      && Number.isFinite(lastPointerPixelXRef.current)
      && Number.isFinite(lastPointerPixelYRef.current);
    if (hasPointerPixels) {
      restoreAxisPointerFromPointer("immediate");
      if (liveModeRef.current || lazyUpdate) {
        scheduleAxisPointerRestoreFromPointer();
      }
    } else if (lastAxisPointerTsRef.current !== null || (probeEnabledRef.current && probeTimestampRef.current !== null)) {
      let pointerTs = lastAxisPointerTsRef.current;
      if (probeEnabledRef.current && probeTimestampRef.current !== null) {
        pointerTs = probeTimestampRef.current;
      }
      let pointerX = lastPointerPixelXRef.current;
      if (liveModeRef.current && pointerX !== null) {
        const livePointerTs = Number(chart.convertFromPixel({ xAxisIndex: 0 }, pointerX));
        if (Number.isFinite(livePointerTs)) {
          pointerTs = livePointerTs;
          lastAxisPointerTsRef.current = livePointerTs;
          if (probeEnabledRef.current) {
            probeTimestampRef.current = livePointerTs;
            onProbeTimestampChangeRef.current?.(livePointerTs);
          }
        }
      } else if (pointerX === null && pointerTs !== null) {
        const pixelFromTs = Number(chart.convertToPixel({ xAxisIndex: 0 }, pointerTs));
        if (Number.isFinite(pixelFromTs)) {
          pointerX = pixelFromTs;
        }
      }
      if (pointerTs !== null && pointerX !== null && Number.isFinite(pointerX)) {
        chart.dispatchAction({
          type: "updateAxisPointer",
          x: pointerX,
          currTrigger: "mousemove",
        });
      }
      if (pointerTs !== null) {
        chart.dispatchAction({
          type: "showTip",
          xAxisIndex: 0,
          value: pointerTs,
        });
      }
    }
    window.setTimeout(() => {
      optionGuardRef.current = false;
    }, 0);
    if (debugPerf) {
      logTrendDiagnostics("chart:render", {
        durationMs: Math.round((performance.now() - renderStartedAt) * 1000) / 1000,
        setOptionDurationMs: Math.round((performance.now() - setOptionStartedAt) * 1000) / 1000,
        seriesCount: series.length,
        sourcePointCount: totalPointCount,
        echartsPointCount,
        domain: fullRangeRef.current,
        visibleRange,
        appendLivePointsCalls: appendLivePointsCallCountRef.current,
        liveRenderCount: liveRenderCountRef.current,
        throttledRenderCalls: renderThrottleCountRef.current,
        throttledHoverCalls: hoverThrottleCountRef.current,
        axisPointerRestoresImmediate: axisPointerRestoreImmediateCountRef.current,
        axisPointerRestoresRaf: axisPointerRestoreRafCountRef.current,
        axisPointerSkippedClears: axisPointerSkippedClearCountRef.current,
        lazyUpdate,
        replaceMerge,
        triggerReason: renderRafReasonRef.current,
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
    setRootCursor("default");

    const handleDataZoom = (payload: unknown) => {
      if (skipNextDataZoomUntilRef.current > Date.now()) {
        return;
      }
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
        if (probeEnabledRef.current && probeTimestampRef.current !== null) {
          return;
        }
        if (
          pointerInsideRef.current
          && lastPointerPixelXRef.current !== null
          && lastPointerPixelYRef.current !== null
          && Number.isFinite(lastPointerPixelXRef.current)
          && Number.isFinite(lastPointerPixelYRef.current)
        ) {
          axisPointerSkippedClearCountRef.current += 1;
          return;
        }
        hoverPendingTsRef.current = null;
        hoverLastSnapshotRef.current = null;
        lastAxisPointerTsRef.current = null;
        onHoverSnapshotChangeRef.current?.(null);
        return;
      }
      lastAxisPointerTsRef.current = timestamp;
      if (probeEnabledRef.current) {
        probeTimestampRef.current = timestamp;
      }
      hoverPendingTsRef.current = timestamp;
      if (hoverRafRef.current !== null) {
        hoverThrottleCountRef.current += 1;
        return;
      }
      hoverRafRef.current = window.requestAnimationFrame(() => {
        hoverRafRef.current = null;
        const pendingTs = hoverPendingTsRef.current;
        if (pendingTs === null) {
          return;
        }
        const values: Record<string, number | boolean | string | null> = {};
        for (const tag of tagsRef.current) {
          const points = seriesPointsRef.current.get(tag.tag) ?? [];
          values[tag.tag] = resolveSeriesValueAtTimestamp(points, pendingTs);
        }
        const lastSnapshot = hoverLastSnapshotRef.current;
        if (lastSnapshot && lastSnapshot.timestamp === pendingTs) {
          let unchanged = true;
          for (const tag of tagsRef.current) {
            if (lastSnapshot.values[tag.tag] !== values[tag.tag]) {
              unchanged = false;
              break;
            }
          }
          if (unchanged) {
            return;
          }
        }
        const snapshot = { timestamp: pendingTs, values };
        hoverLastSnapshotRef.current = snapshot;
        onHoverSnapshotChangeRef.current?.(snapshot);
      });
    };

    const handleGlobalOut = () => {
      if (rootRef.current?.matches(":hover")) {
        return;
      }
      zr.setCursorStyle("default");
      pointerInsideRef.current = false;
      if (restoreAxisPointerRafRef.current !== null) {
        window.cancelAnimationFrame(restoreAxisPointerRafRef.current);
        restoreAxisPointerRafRef.current = null;
      }
      if (!probeEnabledRef.current) {
        lastPointerPixelXRef.current = null;
        lastPointerPixelYRef.current = null;
      }
      if (probeEnabledRef.current && probeTimestampRef.current !== null) {
        return;
      }
      hoverPendingTsRef.current = null;
      hoverLastSnapshotRef.current = null;
      lastAxisPointerTsRef.current = null;
      hoveredYAxisIdRef.current = null;
      if (!yAxisPanStateRef.current) {
        setRootCursor("");
      }
      onHoverSnapshotChangeRef.current?.(null);
    };
    const zr = chart.getZr();

    const handleZrMouseMove = (event: unknown) => {
      const source = event as { offsetX?: number; offsetY?: number; event?: MouseEvent };
      const x = Number(source.offsetX);
      const y = Number(source.offsetY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      pointerInsideRef.current = isPointInsidePlot(x, y);
      lastPointerPixelXRef.current = x;
      lastPointerPixelYRef.current = y;
      if (yAxisPanStateRef.current) {
        zr.setCursorStyle("ns-resize");
        updateYAxisPan(y);
        return;
      }
      if (probeDragActiveRef.current) {
        const timestamp = resolveTimestampFromPixelX(x);
        if (timestamp !== null) {
          setProbeTimestampInternal(timestamp, true);
        }
        zr.setCursorStyle("ew-resize");
        setRootCursor("ew-resize");
        return;
      }
      const axis = findYAxisInteractionTarget(x, y);
      hoveredYAxisIdRef.current = axis?.id ?? null;
      if (axis) {
        zr.setCursorStyle("ns-resize");
        setRootCursor("ns-resize");
        return;
      }
      if (probeEnabledRef.current && isPointInsidePlot(x, y)) {
        zr.setCursorStyle("ew-resize");
        setRootCursor("ew-resize");
        return;
      }
      zr.setCursorStyle("default");
      setRootCursor("");
    };

    const handleZrMouseDown = (event: unknown) => {
      const source = event as { offsetX?: number; offsetY?: number; event?: MouseEvent };
      const native = source.event;
      if (!native || native.button !== 0) {
        return;
      }
      const x = Number(source.offsetX);
      const y = Number(source.offsetY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      const axis = findYAxisInteractionTarget(x, y);
      if (!axis) {
        if (!probeEnabledRef.current || !isPointInsidePlot(x, y)) {
          return;
        }
        native.preventDefault();
        native.stopPropagation();
        probeDragActiveRef.current = true;
        const timestamp = resolveTimestampFromPixelX(x);
        if (timestamp !== null) {
          setProbeTimestampInternal(timestamp, true);
        }
        setRootCursor("ew-resize");
        return;
      }
      native.preventDefault();
      native.stopPropagation();
      startYAxisPan(axis, y);
    };

    const handleZrMouseWheel = (event: unknown) => {
      const source = event as { offsetX?: number; offsetY?: number; event?: WheelEvent };
      const native = source.event;
      const x = Number(source.offsetX);
      const y = Number(source.offsetY);
      if (!native || !Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      const axis = findYAxisInteractionTarget(x, y);
      if (!axis) {
        return;
      }
      native.preventDefault();
      native.stopPropagation();
      skipNextDataZoomUntilRef.current = Date.now() + 140;
      applyYAxisZoom(axis, native.deltaY, y);
    };

    const handleZrDoubleClick = (event: unknown) => {
      const source = event as { offsetX?: number; offsetY?: number };
      const x = Number(source.offsetX);
      const y = Number(source.offsetY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      const axis = findYAxisInteractionTarget(x, y);
      if (!axis) {
        return;
      }
      resetYAxisOverride(axis.id);
    };

    const handleWindowMouseMove = (event: MouseEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      if (probeDragActiveRef.current) {
        const x = event.clientX - rect.left;
        const timestamp = resolveTimestampFromPixelX(x);
        if (timestamp !== null) {
          setProbeTimestampInternal(timestamp, true);
        }
      }
      if (!yAxisPanStateRef.current) {
        return;
      }
      const y = event.clientY - rect.top;
      updateYAxisPan(y);
    };

    const handleWindowMouseUp = () => {
      if (probeDragActiveRef.current) {
        probeDragActiveRef.current = false;
        setRootCursor(hoveredYAxisIdRef.current ? "ns-resize" : "");
      }
      if (!yAxisPanStateRef.current) {
        return;
      }
      finishYAxisPan();
    };

    if (interactiveZoomEnabled) {
      chart.on("dataZoom", handleDataZoom);
    }
    chart.on("updateAxisPointer", handleAxisPointer);
    chart.on("globalout", handleGlobalOut);
    zr.on("mousemove", handleZrMouseMove);
    zr.on("mousedown", handleZrMouseDown);
    zr.on("mousewheel", handleZrMouseWheel);
    zr.on("dblclick", handleZrDoubleClick);
    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    window.addEventListener("blur", handleWindowMouseUp);

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(rootRef.current);

    onChartApiReady?.({
      appendLivePoints: (updates) => {
        appendLivePointsCallCountRef.current += 1;
        liveNowRef.current = Date.now();
        const active = activeTagNameSetRef.current;
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
          const gapBreakMs = Math.max(LIVE_GAP_MIN_BREAK_MS, resolveTrendGapBreakMs(current));
          if (lastPoint && lastPoint.v !== null && nextPoint.v !== null && nextPoint.t - lastPoint.t > gapBreakMs) {
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
              gapBreakMs,
              liveMode: liveModeRef.current,
              source: "live-append",
            });
            logTrendDiagnostics("live:stale-source-gap", {
              tag: update.tag,
              previousTs: lastPoint.t,
              currentTs: nextPoint.t,
              deltaMs: nextPoint.t - lastPoint.t,
              gapBreakMs,
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
          axisStatsByTagRef.current.set(tagName, recomputeAxisStats(points));
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
          skipNextVisibleRangeRenderInLiveRef.current = true;
          onVisibleRangeChangeRef.current({ from: left, to: right }, "live");
        } else if (Number.isFinite(minUpdateTs) && Number.isFinite(maxUpdateTs)) {
          fullRangeRef.current = {
            from: Math.min(fullRangeRef.current.from, minUpdateTs),
            to: Math.max(fullRangeRef.current.to, maxUpdateTs),
          };
        }
        if (isTrendPerfDebugEnabled()) {
          logTrendDiagnostics("live:append-applied", {
            batchSize: updates.length,
            updatedTagCount: updatedTags.size,
            minUpdateTs: Number.isFinite(minUpdateTs) ? minUpdateTs : null,
            maxUpdateTs: Number.isFinite(maxUpdateTs) ? maxUpdateTs : null,
            renderQueued: true,
          });
        }
        scheduleRender("append-live-points");
      },
      notifyLiveHeartbeat: (timestampMs) => {
        const nextTs = Number.isFinite(timestampMs) ? Number(timestampMs) : Date.now();
        liveNowRef.current = nextTs;
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
      zr.off("mousemove", handleZrMouseMove);
      zr.off("mousedown", handleZrMouseDown);
      zr.off("mousewheel", handleZrMouseWheel);
      zr.off("dblclick", handleZrDoubleClick);
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
      window.removeEventListener("blur", handleWindowMouseUp);
      resizeObserver.disconnect();
      if (zoomTimerRef.current) {
        window.clearTimeout(zoomTimerRef.current);
      }
      if (renderRafRef.current !== null) {
        window.cancelAnimationFrame(renderRafRef.current);
        renderRafRef.current = null;
      }
      if (restoreAxisPointerRafRef.current !== null) {
        window.cancelAnimationFrame(restoreAxisPointerRafRef.current);
        restoreAxisPointerRafRef.current = null;
      }
      if (hoverRafRef.current !== null) {
        window.cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      for (const timerId of axisCommitTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      axisCommitTimersRef.current.clear();
      finishYAxisPan();
      probeDragActiveRef.current = false;
      hoveredYAxisIdRef.current = null;
      setRootCursor("");
      chart.dispose();
      chartRef.current = null;
      liveLastEmittedRightRef.current = null;
      yAxisRuntimeInfoRef.current = [];
      gridRuntimeInfoRef.current = null;
      lastPointerPixelXRef.current = null;
      lastPointerPixelYRef.current = null;
      pointerInsideRef.current = false;
    };
  }, [interactiveZoomEnabled]);

  useEffect(() => {
    const historyMap = new Map<string, TrendPoint[]>();
    for (const series of data?.series ?? []) {
      const normalizedPointsSource = normalizeTrendPoints(series.points);
      historyMap.set(series.tag, normalizedPointsSource);
    }

    const previousSeriesPoints = seriesPointsRef.current;
    const nextMap = new Map<string, TrendPoint[]>();
    const activeTagNames = activeTagNameSetRef.current;
    for (const tagName of activeTagNames) {
      const newPoints = historyMap.get(tagName) ?? [];
      if (newPoints.length === 0) {
        // Preserve the last known point from previous data if the new query returned
        // nothing for this tag (unchanging value — no new archive rows in the window).
        // This lets appendLiveCarryForwardPoint extend the line forward from the
        // last known value instead of drawing nothing.
        const prevPoints = previousSeriesPoints.get(tagName);
        if (prevPoints && prevPoints.length > 0) {
          const lastPrev = prevPoints[prevPoints.length - 1];
          if (lastPrev && lastPrev.v !== null) {
            nextMap.set(tagName, [lastPrev]);
            continue;
          }
        }
      }
      nextMap.set(tagName, newPoints);
    }

    const nextStats = new Map<string, TrendAxisStats>();
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
    for (const tagName of activeTagNames) {
      const points = nextMap.get(tagName) ?? [];
      nextStats.set(tagName, recomputeAxisStats(points));
    }

    seriesPointsRef.current = nextMap;
    axisStatsByTagRef.current = nextStats;
    fullRangeRef.current = Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs > minTs
      ? { from: minTs, to: maxTs }
      : visibleRange;
    scheduleRender("data-change");
  }, [data]);

  useEffect(() => {
    scheduleRender("props-change");
  }, [axes, axisIdByTag, settings, tags]);

  useEffect(() => {
    if (liveModeRef.current && skipNextVisibleRangeRenderInLiveRef.current) {
      skipNextVisibleRangeRenderInLiveRef.current = false;
      return;
    }
    scheduleRender("visible-range-change");
  }, [visibleRange.from, visibleRange.to]);

  return <div ref={rootRef} className="trends-chart" />;
}
