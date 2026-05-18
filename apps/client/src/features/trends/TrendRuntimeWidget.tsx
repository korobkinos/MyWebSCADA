import { type CSSProperties, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColorPicker, Spin } from "antd";
import type { TagValue, TrendChartObject } from "@web-scada/shared";
import { createRuntimeSocket } from "../../services/ws";
import type { TrendTagInfo } from "../../services/api";
import { WorkbenchButton, WorkbenchIconButton } from "../../components/workbench";
import { fetchTrendTags, queryTrendData } from "./trendApi";
import { TrendChart } from "./TrendChart";
import { TrendSettingsPanel } from "./TrendSettingsPanel";
import { TrendTagPickerDialog } from "./TrendTagPickerDialog";
import { TrendWorkbenchDialog } from "./TrendWorkbenchDialog";
import { TrendQueryCache, buildTrendCacheKey } from "./trendStore";
import type { TrendAxisConfig, TrendChartApi, TrendQueryResponse, TrendRangePreset, TrendSeriesColumnId, TrendSeriesColumnWidths, TrendSettings, TrendTagPickerFilters, TrendTagSelection, TrendVisibleRange } from "./trendTypes";
import { buildAxes, clamp, computeMaxPointsFromWidth, defaultTrendSettings, formatRangeLabel, parseQuickRange } from "./trendUtils";
import { readRuntimeViewState, type TrendRuntimeViewStateData, writeRuntimeViewState } from "./trendRuntimeViewState";
import { resolveTrendTheme } from "./trendTheme";

const LIVE_FLUSH_MS = 300;
const TOO_MANY_TAGS_LIMIT = 40;
const TREND_ZOOM_MIN_SPAN_MS = 15_000;
const TREND_ZOOM_MAX_SPAN_MS = 24 * 60 * 60 * 1000;

type TrendSeriesColumnState = {
  id: TrendSeriesColumnId;
  label: string;
  visible: boolean;
};

const DEFAULT_SERIES_COLUMNS: TrendSeriesColumnState[] = [
  { id: "visible", label: "Visible", visible: true },
  { id: "tag", label: "Tag", visible: true },
  { id: "color", label: "Color", visible: true },
  { id: "value", label: "Value", visible: true },
];

const DEFAULT_SERIES_COLUMN_WIDTHS: TrendSeriesColumnWidths = {
  visible: 72,
  tag: 340,
  color: 270,
  value: 120,
};

const MIN_SERIES_COLUMN_WIDTHS: Record<TrendSeriesColumnId, number> = {
  visible: 36,
  tag: 120,
  color: 72,
  value: 70,
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

function isAuthenticationRequiredErrorMessage(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes("authentication required") || text.includes("unauthorized");
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
  const preset = object.rangePreset ?? "1h";
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
  const source = object.settings ?? {};
  return {
    ...defaults,
    ...source,
    maxPointsPerSeries: clamp(Number(source.maxPointsPerSeries ?? defaults.maxPointsPerSeries), 1000, 8000),
    cacheSize: clamp(Number(source.cacheSize ?? defaults.cacheSize), 8, 256),
    liveBufferLimit: clamp(Number(source.liveBufferLimit ?? defaults.liveBufferLimit), 200, 20000),
    zoomDebounceMs: clamp(Number(source.zoomDebounceMs ?? defaults.zoomDebounceMs), 100, 1200),
    defaultLineWidth: clamp(Number(source.defaultLineWidth ?? defaults.defaultLineWidth), 1, 5),
    axisOffsetStep: clamp(Number(source.axisOffsetStep ?? defaults.axisOffsetStep), 24, 120),
  };
}

type TrendRuntimeWidgetProps = {
  object: TrendChartObject;
};

type TrendContextMenuState = {
  x: number;
  y: number;
};

type LiveSocketState = "idle" | "connecting" | "open" | "closed" | "error";
type PendingToolbarRange = { range: TrendVisibleRange; preset: TrendRangePreset };

const DEFAULT_TAG_PICKER_FILTERS: TrendTagPickerFilters = {
  search: "",
  groupFilter: "all",
  selectionFilter: "all",
};
function resolveInitialRuntimeViewState(object: TrendChartObject): TrendRuntimeViewStateData {
  const objectRange = resolveRangeFromObject(object);
  const restored = readRuntimeViewState({
    objectId: object.id,
    defaultTagPickerFilters: DEFAULT_TAG_PICKER_FILTERS,
    defaultSeriesColumnWidths: DEFAULT_SERIES_COLUMN_WIDTHS,
  });
  if (restored) {
    return restored;
  }
  return {
    rangePreset: objectRange.preset,
    visibleRange: objectRange.range,
    liveMode: Boolean(object.liveMode),
    customFrom: toLocalDateTimeInputValue(objectRange.range.from),
    customTo: toLocalDateTimeInputValue(objectRange.range.to),
    settings: resolveSettingsFromObject(object),
    selectedTags: object.selectedTags ?? [],
    manualAxes: object.axes ?? [],
    tagPickerFilters: DEFAULT_TAG_PICKER_FILTERS,
    seriesColumnWidths: DEFAULT_SERIES_COLUMN_WIDTHS,
  };
}

export function TrendRuntimeWidget({ object }: TrendRuntimeWidgetProps) {
  const initialViewState = useMemo(() => resolveInitialRuntimeViewState(object), [object.id]);
  const [allTags, setAllTags] = useState<TrendTagInfo[]>([]);
  const [selectedTags, setSelectedTags] = useState<TrendTagSelection[]>(initialViewState.selectedTags ?? object.selectedTags ?? []);
  const [manualAxes, setManualAxes] = useState<TrendAxisConfig[]>(initialViewState.manualAxes ?? object.axes ?? []);
  const [tagPickerFilters, setTagPickerFilters] = useState<TrendTagPickerFilters>(initialViewState.tagPickerFilters ?? DEFAULT_TAG_PICKER_FILTERS);
  const [settings, setSettings] = useState<TrendSettings>(() => initialViewState.settings ?? resolveSettingsFromObject(object));
  const [response, setResponse] = useState<TrendQueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState(initialViewState.liveMode);
  const [lastLoadAt, setLastLoadAt] = useState<number | undefined>(undefined);
  const [statusAggregation, setStatusAggregation] = useState<TrendQueryResponse["aggregation"]>("raw");
  const [rangePreset, setRangePreset] = useState<TrendRangePreset>(initialViewState.rangePreset);
  const [visibleRange, setVisibleRange] = useState<TrendVisibleRange>(initialViewState.visibleRange);
  const [customFrom, setCustomFrom] = useState(initialViewState.customFrom);
  const [customTo, setCustomTo] = useState(initialViewState.customTo);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<TrendContextMenuState | null>(null);
  const [liveSocketState, setLiveSocketState] = useState<LiveSocketState>("idle");
  const [liveBatchCount, setLiveBatchCount] = useState(0);
  const [livePointCount, setLivePointCount] = useState(0);
  const [liveLastBatchAt, setLiveLastBatchAt] = useState<number | null>(null);
  const [liveLastPointTs, setLiveLastPointTs] = useState<number | null>(null);
  const [liveAutoStopReason, setLiveAutoStopReason] = useState<string | null>(null);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [screenRevision, setScreenRevision] = useState(0);
  const [pendingToolbarRange, setPendingToolbarRange] = useState<PendingToolbarRange | null>(null);
  const [seriesLatestValues, setSeriesLatestValues] = useState<Record<string, string>>({});
  const [hoverSeriesValues, setHoverSeriesValues] = useState<Record<string, string> | null>(null);
  const [hoverTimestamp, setHoverTimestamp] = useState<number | null>(null);
  const [seriesColumnWidths, setSeriesColumnWidths] = useState<TrendSeriesColumnWidths>(initialViewState.seriesColumnWidths ?? DEFAULT_SERIES_COLUMN_WIDTHS);
  const [timeRangeDialogOpen, setTimeRangeDialogOpen] = useState(false);
  const [timeRangeDraftFrom, setTimeRangeDraftFrom] = useState(initialViewState.customFrom);
  const [timeRangeDraftTo, setTimeRangeDraftTo] = useState(initialViewState.customTo);

  const requestIdRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const cacheRef = useRef(new TrendQueryCache(settings.cacheSize));
  const chartApiRef = useRef<TrendChartApi | null>(null);
  const liveBufferRef = useRef<Array<{ tag: string; value: number | boolean | string | null; quality?: string; timestamp: number }>>([]);
  const liveSocketRef = useRef<ReturnType<typeof createRuntimeSocket> | null>(null);
  const historyLoadTimerRef = useRef<number | null>(null);
  const columnResizeStateRef = useRef<{ id: TrendSeriesColumnId | null; startX: number; startWidth: number }>({
    id: null,
    startX: 0,
    startWidth: 0,
  });

  const tagInfoMap = useMemo(() => new Map(allTags.map((tag) => [tag.name, tag])), [allTags]);

  const { axes, resolvedAxisIdByTag } = useMemo(
    () => buildAxes(selectedTags, tagInfoMap, settings, manualAxes),
    [manualAxes, selectedTags, settings, tagInfoMap],
  );

  const liveWindowMs = Math.max(60_000, visibleRange.to - visibleRange.from);

  const pointCount = useMemo(
    () => response?.series.reduce((acc, series) => acc + series.points.length, 0) ?? 0,
    [response],
  );

  useEffect(() => {
    const nextViewState = resolveInitialRuntimeViewState(object);
    setResponse(null);
    setError(null);
    setLastLoadAt(undefined);
    setSelectedTags(nextViewState.selectedTags ?? object.selectedTags ?? []);
    setManualAxes(nextViewState.manualAxes ?? object.axes ?? []);
    setTagPickerFilters(nextViewState.tagPickerFilters ?? DEFAULT_TAG_PICKER_FILTERS);
    setSettings(nextViewState.settings ?? resolveSettingsFromObject(object));
    setLiveMode(nextViewState.liveMode);
    setRangePreset(nextViewState.rangePreset);
    setVisibleRange(nextViewState.visibleRange);
    setCustomFrom(nextViewState.customFrom);
    setCustomTo(nextViewState.customTo);
    setTimeRangeDraftFrom(nextViewState.customFrom);
    setTimeRangeDraftTo(nextViewState.customTo);
    setSeriesColumnWidths(nextViewState.seriesColumnWidths ?? DEFAULT_SERIES_COLUMN_WIDTHS);
    setSeriesLatestValues({});
    setHoverSeriesValues(null);
    setHoverTimestamp(null);
    setHistoryWarning(null);
    setScreenRevision((prev) => prev + 1);
  }, [object.id]);

  useEffect(() => {
    writeRuntimeViewState({
      objectId: object.id,
      state: {
        rangePreset,
        visibleRange,
        liveMode,
        customFrom,
        customTo,
        settings,
        selectedTags,
        manualAxes,
        tagPickerFilters,
        seriesColumnWidths,
      },
    });
  }, [customFrom, customTo, liveMode, manualAxes, object.id, rangePreset, selectedTags, seriesColumnWidths, settings, tagPickerFilters, visibleRange]);

  const executeQuery = useCallback(async (range: TrendVisibleRange, options?: { force?: boolean }) => {
    if (selectedTags.length === 0) {
      setResponse(null);
      return;
    }
    if (selectedTags.length > TOO_MANY_TAGS_LIMIT) {
      setError(`Too many tags selected (${selectedTags.length}). Limit is ${TOO_MANY_TAGS_LIMIT}.`);
      return;
    }
    if (range.to <= range.from) {
      setError("Invalid range");
      return;
    }

    const width = chartApiRef.current?.getWidth() ?? 1200;
    const effectiveMaxPointsSetting = liveMode ? 8000 : settings.maxPointsPerSeries;
    const maxPoints = computeMaxPointsFromWidth(width, effectiveMaxPointsSetting);
    const requestAggregation = liveMode ? "raw" : settings.aggregation;
    const tagNames = selectedTags.map((tag) => tag.tag);
    const key = buildTrendCacheKey({
      tags: tagNames,
      from: range.from,
      to: range.to,
      maxPoints,
      aggregation: requestAggregation,
    });

    if (!options?.force && settings.cacheEnabled) {
      const cached = cacheRef.current.get(key);
      if (cached) {
        setResponse(cached);
        setStatusAggregation(cached.aggregation);
        setLastLoadAt(Date.now());
        return;
      }
    }

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    setLoading(true);
    setError(null);
    setHistoryWarning(null);

    try {
      const next = await queryTrendData({
        tags: tagNames,
        from: new Date(range.from).toISOString(),
        to: new Date(range.to).toISOString(),
        maxPoints,
        aggregation: requestAggregation,
      }, controller.signal);
      if (requestId !== requestIdRef.current) {
        return;
      }
      if (settings.cacheEnabled) {
        cacheRef.current.set(key, next);
      }
      setResponse(next);
      setStatusAggregation(next.aggregation);
      setLastLoadAt(Date.now());
      const nextLatest: Record<string, string> = {};
      for (const series of next.series) {
        const lastPoint = series.points[series.points.length - 1];
        nextLatest[series.tag] = formatTrendValue(lastPoint?.v);
      }
      setSeriesLatestValues(nextLatest);
    } catch (queryError) {
      if (controller.signal.aborted) {
        return;
      }
      const text = queryError instanceof Error ? queryError.message : "Trends query failed";
      if (isAuthenticationRequiredErrorMessage(text) && liveMode) {
        setError(null);
        setHistoryWarning("History loading requires authentication");
      } else {
        setError(text);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [liveMode, selectedTags, settings.aggregation, settings.cacheEnabled, settings.maxPointsPerSeries]);

  useEffect(() => {
    cacheRef.current = new TrendQueryCache(settings.cacheSize);
  }, [settings.cacheSize]);

  useEffect(() => {
    void (async () => {
      try {
        const tags = await fetchTrendTags();
        setAllTags(tags);
        if (selectedTags.length > 0) {
          const existing = new Set(tags.map((item) => item.name));
          setSelectedTags((prev) => prev.filter((item) => existing.has(item.tag)));
        }
      } catch (loadError) {
        const text = loadError instanceof Error ? loadError.message : "Failed to load trend tags";
        if (isAuthenticationRequiredErrorMessage(text)) {
          setHistoryWarning("History loading requires authentication");
        } else {
          setError(text);
        }
      }
    })();
  }, []);

  useEffect(() => () => {
    requestControllerRef.current?.abort();
    liveSocketRef.current?.close();
    if (historyLoadTimerRef.current) {
      window.clearTimeout(historyLoadTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (selectedTags.length === 0 || liveMode) {
      return;
    }
    void executeQuery(visibleRange, { force: true });
  }, [executeQuery, liveMode, screenRevision, selectedTags, visibleRange]);

  useEffect(() => {
    if (!liveMode || selectedTags.length === 0) {
      return;
    }
    void executeQuery(visibleRange, { force: true });
  }, [executeQuery, liveMode, screenRevision, selectedTags]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("mousedown", closeMenu);
    return () => window.removeEventListener("mousedown", closeMenu);
  }, [contextMenu]);

  useEffect(() => {
    if (!liveMode || selectedTags.length === 0) {
      liveSocketRef.current?.close();
      liveSocketRef.current = null;
      setLiveSocketState("idle");
      return;
    }

    const selected = new Set(selectedTags.map((tag) => tag.tag));
    liveBufferRef.current = [];
    const socket = createRuntimeSocket({
      onTagValues: (values: TagValue[]) => {
        for (const value of values) {
          if (!selected.has(value.name)) {
            continue;
          }
          liveBufferRef.current.push({
            tag: value.name,
            value: value.value,
            quality: value.quality,
            timestamp: value.timestamp,
          });
        }
      },
      onSocketStateChange: (state) => {
        setLiveSocketState(state);
      },
    }, { participateInGlobalSubscriptions: false });
    socket.subscribeTags([...selected]);
    liveSocketRef.current = socket;

    const flushTimer = window.setInterval(() => {
      const batch = liveBufferRef.current.splice(0, liveBufferRef.current.length);
      if (batch.length === 0) {
        return;
      }
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
      setSeriesLatestValues((prev) => {
        const next = { ...prev };
        for (const item of batch) {
          next[item.tag] = formatTrendValue(item.value);
        }
        return next;
      });
      chartApiRef.current?.appendLivePoints(batch);
    }, LIVE_FLUSH_MS);

    return () => {
      window.clearInterval(flushTimer);
      socket.close();
      setLiveSocketState("closed");
      if (liveSocketRef.current === socket) {
        liveSocketRef.current = null;
      }
    };
  }, [liveMode, selectedTags]);

  useEffect(() => {
    if (!liveMode) {
      return;
    }
    setLiveAutoStopReason(null);
    setLiveBatchCount(0);
    setLivePointCount(0);
    setLiveLastBatchAt(null);
    setLiveLastPointTs(null);
  }, [liveMode]);

  const applyRangeAndQuery = (next: TrendVisibleRange, options?: { keepLive?: boolean; preset?: TrendRangePreset }) => {
    const normalized: TrendVisibleRange = {
      from: Math.min(next.from, next.to),
      to: Math.max(next.from, next.to),
    };
    if (!options?.keepLive && liveMode) {
      setLiveMode(false);
      setLiveAutoStopReason("Stopped by toolbar history navigation");
      setPendingToolbarRange({ range: normalized, preset: options?.preset ?? "custom" });
      return;
    }
    setRangePreset(options?.preset ?? "custom");
    setVisibleRange(normalized);
    setCustomFrom(toLocalDateTimeInputValue(normalized.from));
    setCustomTo(toLocalDateTimeInputValue(normalized.to));
    void executeQuery(normalized, { force: true });
  };

  const applyPreset = (preset: Exclude<TrendRangePreset, "custom">) => {
    const next = parseQuickRange(preset);
    setTimeRangeDraftFrom(toLocalDateTimeInputValue(next.from));
    setTimeRangeDraftTo(toLocalDateTimeInputValue(next.to));
    applyRangeAndQuery(next, { preset });
  };

  const openTimeRangeDialog = () => {
    setTimeRangeDraftFrom(customFrom);
    setTimeRangeDraftTo(customTo);
    setTimeRangeDialogOpen(true);
  };

  const applyDialogPreset = (preset: Exclude<TrendRangePreset, "custom">) => {
    const next = parseQuickRange(preset);
    setTimeRangeDraftFrom(toLocalDateTimeInputValue(next.from));
    setTimeRangeDraftTo(toLocalDateTimeInputValue(next.to));
    applyRangeAndQuery(next, { preset });
    setTimeRangeDialogOpen(false);
  };

  const applyDialogCustomRange = () => {
    const from = fromLocalDateTimeInputValue(timeRangeDraftFrom);
    const to = fromLocalDateTimeInputValue(timeRangeDraftTo);
    setTimeRangeDialogOpen(false);
    applyRangeAndQuery({ from, to }, { preset: "custom" });
  };

  useEffect(() => {
    if (liveMode || !pendingToolbarRange) {
      return;
    }
    const next = pendingToolbarRange.range;
    setPendingToolbarRange(null);
    setRangePreset(pendingToolbarRange.preset);
    setVisibleRange(next);
    setCustomFrom(toLocalDateTimeInputValue(next.from));
    setCustomTo(toLocalDateTimeInputValue(next.to));
    void executeQuery(next, { force: true });
  }, [executeQuery, liveMode, pendingToolbarRange]);

  const zoomBy = (factor: number) => {
    const currentSpan = Math.max(TREND_ZOOM_MIN_SPAN_MS, visibleRange.to - visibleRange.from);
    const nextSpan = clamp(Math.round(currentSpan * factor), TREND_ZOOM_MIN_SPAN_MS, TREND_ZOOM_MAX_SPAN_MS);
    const center = (visibleRange.from + visibleRange.to) / 2;
    applyRangeAndQuery({
      from: Math.round(center - nextSpan / 2),
      to: Math.round(center + nextSpan / 2),
    });
  };

  const panBy = (direction: -1 | 1) => {
    const span = Math.max(TREND_ZOOM_MIN_SPAN_MS, visibleRange.to - visibleRange.from);
    const shift = Math.round(span * 0.25 * direction);
    applyRangeAndQuery({
      from: visibleRange.from + shift,
      to: visibleRange.to + shift,
    });
  };

  const backToLive = () => {
    const span = Math.max(60_000, visibleRange.to - visibleRange.from);
    const right = Date.now();
    const next = { from: right - span, to: right };
    setLiveAutoStopReason(null);
    setLiveMode(true);
    applyRangeAndQuery(next, { keepLive: true });
  };

  const handleChartRangeChange = (range: TrendVisibleRange, source: "interaction" | "live") => {
    setVisibleRange(range);
    if (source === "interaction" && liveMode) {
      setLiveMode(false);
      setLiveAutoStopReason("Stopped by zoom/pan interaction");
      if (selectedTags.length > 0) {
        void executeQuery(range, { force: true });
      }
      return;
    }
    if (source === "interaction" && !liveMode && selectedTags.length > 0) {
      if (historyLoadTimerRef.current) {
        window.clearTimeout(historyLoadTimerRef.current);
      }
      const span = Math.max(1_000, range.to - range.from);
      const queryRange: TrendVisibleRange = {
        from: range.from - Math.floor(span * 0.35),
        to: range.to + Math.floor(span * 0.35),
      };
      historyLoadTimerRef.current = window.setTimeout(() => {
        void executeQuery(queryRange, { force: true });
      }, 220);
    }
  };

  const refresh = () => {
    void executeQuery(visibleRange, { force: true });
  };

  const setSeriesPatch = (tagName: string, patch: Partial<TrendTagSelection>) => {
    setSelectedTags((prev) => prev.map((tag) => (tag.tag === tagName ? { ...tag, ...patch } : tag)));
  };

  const visibleSeriesColumns = DEFAULT_SERIES_COLUMNS;
  const visibleSeriesColumnTemplate = useMemo(
    () => visibleSeriesColumns.map((column) => `${Math.round(seriesColumnWidths[column.id])}px`).join(" "),
    [seriesColumnWidths],
  );
  const loadedPointCountByTag = useMemo(() => {
    const map = new Map<string, number>();
    for (const series of response?.series ?? []) {
      map.set(series.tag, series.points.length);
    }
    return map;
  }, [response]);
  const loadedSeriesCount = useMemo(
    () => selectedTags.filter((tag) => (loadedPointCountByTag.get(tag.tag) ?? 0) > 0).length,
    [loadedPointCountByTag, selectedTags],
  );

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
  } as CSSProperties;
  const hasSelection = selectedTags.length > 0;

  const openContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };
  const openToolbarMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.left, y: rect.bottom + 4 });
  };
  const runMenuAction = (action: () => void) => {
    action();
    setContextMenu(null);
  };

  return (
    <div className="trends-widget-shell" style={shellStyle}>
      {object.showToolbar !== false ? (
        <div className="trends-toolbar">
          <WorkbenchIconButton title="Menu" onClick={openToolbarMenu} icon={<ToolbarGlyph path="M4 7h16M4 12h16M4 17h16" />} />
          <WorkbenchIconButton title="Add or Remove Tags" onClick={() => setTagDialogOpen(true)} icon={<ToolbarGlyph path="M4 12h16M12 4v16" />} />
          <WorkbenchIconButton
            title={liveMode ? "Pause Live" : "Start Live"}
            active={liveMode}
            onClick={() => setLiveMode((prev) => !prev)}
            disabled={!hasSelection}
            icon={liveMode ? <ToolbarGlyph path="M8 6v12M16 6v12" /> : <ToolbarGlyph path="M9 7l9 5-9 5z" />}
          />
          <WorkbenchIconButton title="Time Range" onClick={openTimeRangeDialog} disabled={!hasSelection} icon={<ToolbarGlyph path="M8 3v3M16 3v3M4 10h16M7 14h4M4 6h16v14H4z" />} />
          <WorkbenchIconButton title="Quick 5m" onClick={() => applyPreset("5m")} disabled={!hasSelection} icon={<span className="trends-toolbar__quick">5m</span>} />
          <WorkbenchIconButton title="Quick 15m" onClick={() => applyPreset("15m")} disabled={!hasSelection} icon={<span className="trends-toolbar__quick">15m</span>} />
          <WorkbenchIconButton title="Quick 1h" onClick={() => applyPreset("1h")} disabled={!hasSelection} icon={<span className="trends-toolbar__quick">1h</span>} />
          <WorkbenchIconButton title="Pan Left" onClick={() => panBy(-1)} disabled={!hasSelection} icon={<ToolbarGlyph path="M14 7l-5 5 5 5M10 12h10" />} />
          <WorkbenchIconButton title="Pan Right" onClick={() => panBy(1)} disabled={!hasSelection} icon={<ToolbarGlyph path="M10 7l5 5-5 5M4 12h10" />} />
          <WorkbenchIconButton title="Zoom In" onClick={() => zoomBy(0.7)} disabled={!hasSelection} icon={<ToolbarGlyph path="M11 8v6M8 11h6M21 21l-4.3-4.3M16 11a5 5 0 1 1-10 0 5 5 0 0 1 10 0z" />} />
          <WorkbenchIconButton title="Zoom Out" onClick={() => zoomBy(1.4)} disabled={!hasSelection} icon={<ToolbarGlyph path="M8 11h6M21 21l-4.3-4.3M16 11a5 5 0 1 1-10 0 5 5 0 0 1 10 0z" />} />
          <WorkbenchIconButton title="Back to Live" onClick={backToLive} disabled={!hasSelection || liveMode} icon={<ToolbarGlyph path="M3 12a9 9 0 1 0 3-6.7M3 5v6h6" />} />
          <WorkbenchIconButton title="Refresh" onClick={refresh} disabled={!hasSelection} icon={<ToolbarGlyph path="M20 6v6h-6M4 18v-6h6M20 12a8 8 0 0 0-14.3-4M4 12a8 8 0 0 0 14.3 4" />} />
          <WorkbenchIconButton title="Settings" onClick={() => setSettingsOpen(true)} icon={<ToolbarGlyph path="M12 8.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6zm8 3.8l-2.1-.5a6.8 6.8 0 0 0-.5-1.2l1.2-1.8-1.9-1.9-1.8 1.2a6.8 6.8 0 0 0-1.2-.5L12 4l-2.2.3a6.8 6.8 0 0 0-1.2.5L6.8 3.6 5 5.5l1.2 1.8c-.2.4-.4.8-.5 1.2L3.6 12l.3 2.2c.1.4.3.8.5 1.2L3.2 17.2 5 19l1.8-1.2c.4.2.8.4 1.2.5L12 20l2.2-.3c.4-.1.8-.3 1.2-.5l1.8 1.2 1.9-1.9-1.2-1.8c.2-.4.4-.8.5-1.2L20 12z" />} />

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
        ) : (
          <TrendChart
            key={object.id}
            data={response}
            tags={selectedTags}
            axes={axes}
            axisIdByTag={resolvedAxisIdByTag}
            settings={settings}
            showLegend={false}
            showTooltip={false}
            showDataZoomSlider={false}
            interactiveZoomEnabled={false}
            visibleRange={visibleRange}
            liveMode={liveMode}
            liveWindowMs={liveWindowMs}
            onVisibleRangeChange={handleChartRangeChange}
            onHoverSnapshotChange={(snapshot) => {
              if (!snapshot) {
                setHoverSeriesValues(null);
                setHoverTimestamp(null);
                return;
              }
              const next: Record<string, string> = {};
              for (const [tagName, value] of Object.entries(snapshot.values)) {
                next[tagName] = formatTrendValue(value);
              }
              setHoverSeriesValues(next);
              setHoverTimestamp(snapshot.timestamp);
            }}
            onChartApiReady={(api) => {
              chartApiRef.current = api;
            }}
          />
        )}
      </div>

      {settings.showSeriesTable ? (
      <div className="trends-series-table-wrap">
        <div className="trends-series-table">
          <div className="screen-editor-tags-row screen-editor-tags-row--header trends-series-table__row trends-series-table__row--head" style={{ gridTemplateColumns: visibleSeriesColumnTemplate }}>
            {visibleSeriesColumns.map((column, index) => (
              <div key={column.id} className={`screen-editor-tags-cell screen-editor-tags-header-cell trends-series-table__cell trends-series-table__cell--${column.id} trends-series-table__cell--header`}>
                <span>{column.label}</span>
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
                  return (
                    <div key={column.id} className="screen-editor-tags-cell trends-series-table__cell trends-series-table__cell--visible">
                      <input
                        type="checkbox"
                        checked={tag.visible !== false}
                        onChange={(event) => setSeriesPatch(tag.tag, { visible: event.target.checked })}
                      />
                    </div>
                  );
                }
                if (column.id === "tag") {
                  return (
                    <div key={column.id} className="screen-editor-tags-cell trends-series-table__cell trends-series-table__cell--tag" title={tag.displayName || tag.tag}>
                      {tag.displayName || tag.tag}
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
                    {hoverSeriesValues?.[tag.tag] ?? seriesLatestValues[tag.tag] ?? ((loadedPointCountByTag.get(tag.tag) ?? 0) === 0 ? "No data" : "-")}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      ) : null}
      {contextMenu ? (
        <div className="trends-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" className="trends-context-menu__item" onClick={() => runMenuAction(() => setTagDialogOpen(true))}>Add/Remove Tags</button>
          <button type="button" className="trends-context-menu__item" onClick={() => runMenuAction(() => setSettingsOpen(true))}>Settings</button>
          <button
            type="button"
            className="trends-context-menu__item"
            onClick={() => runMenuAction(() => setLiveMode((prev) => !prev))}
            disabled={selectedTags.length === 0}
          >
            {liveMode ? "Pause Live" : "Start Live"}
          </button>
          <button type="button" className="trends-context-menu__item" onClick={() => runMenuAction(refresh)} disabled={selectedTags.length === 0}>Refresh</button>
          <button
            type="button"
            className="trends-context-menu__item"
            onClick={() => runMenuAction(() => {
              setSelectedTags([]);
              setResponse(null);
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
        </div>
      ) : null}

      {object.showStatusBar !== false ? (
        <div className="trends-status-bar">
          <span>Range: {formatRangeLabel(visibleRange.from, visibleRange.to)}</span>
          <span>Series: {selectedTags.length}</span>
          <span>Loaded: {loadedSeriesCount}/{selectedTags.length}</span>
          <span>Points: {pointCount.toLocaleString()}</span>
          <span>Aggregation: {aggregationLabel}</span>
          <span>History: {historyWarning ?? "ok"}</span>
          <span>Last load: {lastLoadAt ? new Date(lastLoadAt).toLocaleTimeString() : "-"}</span>
          <span>Live WS: {liveSocketState}</span>
          <span>Live batches: {liveBatchCount}</span>
          <span>Live points: {livePointCount}</span>
          <span>Live last batch: {liveLastBatchAt ? new Date(liveLastBatchAt).toLocaleTimeString() : "-"}</span>
          <span>Live last point ts: {liveLastPointTs ? new Date(liveLastPointTs).toLocaleTimeString() : "-"}</span>
          <span>Live stop reason: {liveAutoStopReason ?? "-"}</span>
        </div>
      ) : null}

      <TrendWorkbenchDialog
        id="trend-time-range-dialog"
        title="Time Range"
        open={timeRangeDialogOpen}
        defaultRect={{ x: 260, y: 120, width: 520, height: 340 }}
        minWidth={460}
        minHeight={280}
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
          setSelectedTags(nextTags.map((tag) => ({ ...tag, visible: true })));
          setManualAxes(nextAxes);
          setTagDialogOpen(false);
        }}
      />

      <TrendSettingsPanel
        open={settingsOpen}
        settings={settings}
        axes={axes}
        selectedTags={selectedTags}
        onClose={() => setSettingsOpen(false)}
        onSettingsChange={(next) => {
          setSettings({
            ...next,
            maxPointsPerSeries: clamp(next.maxPointsPerSeries, 1000, 8000),
            zoomDebounceMs: clamp(next.zoomDebounceMs, 100, 1200),
            cacheSize: clamp(next.cacheSize, 8, 256),
            liveBufferLimit: clamp(next.liveBufferLimit, 200, 20000),
            axisOffsetStep: clamp(next.axisOffsetStep, 24, 120),
          });
        }}
        onAxesChange={setManualAxes}
        onSelectedTagsChange={setSelectedTags}
      />
    </div>
  );
}
