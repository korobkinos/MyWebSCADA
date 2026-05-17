import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { message, Spin } from "antd";
import type { TagValue } from "@web-scada/shared";
import { createRuntimeSocket } from "../../services/ws";
import type { TrendTagInfo } from "../../services/api";
import { WorkbenchButton } from "../../components/workbench";
import { fetchTrendRange, fetchTrendTags, queryTrendData } from "./trendApi";
import { TrendChart } from "./TrendChart";
import { TrendSettingsPanel } from "./TrendSettingsPanel";
import { TrendTagPickerDialog } from "./TrendTagPickerDialog";
import { TrendQueryCache, buildTrendCacheKey } from "./trendStore";
import type { TrendAxisConfig, TrendChartApi, TrendQueryResponse, TrendRangePreset, TrendSettings, TrendTagSelection, TrendVisibleRange } from "./trendTypes";
import { buildAxes, clamp, computeMaxPointsFromWidth, defaultTrendSettings, formatRangeLabel, loadTrendSelectedTags, loadTrendSettings, parseQuickRange, saveTrendSelectedTags, saveTrendSettings } from "./trendUtils";

const LIVE_FLUSH_MS = 300;
const TOO_MANY_TAGS_LIMIT = 40;

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

export function TrendPage() {
  const [allTags, setAllTags] = useState<TrendTagInfo[]>([]);
  const [selectedTags, setSelectedTags] = useState<TrendTagSelection[]>(() => loadTrendSelectedTags());
  const [settings, setSettings] = useState<TrendSettings>(() => loadTrendSettings());
  const [manualAxes, setManualAxes] = useState<TrendAxisConfig[]>([]);
  const [response, setResponse] = useState<TrendQueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [lastLoadAt, setLastLoadAt] = useState<number | undefined>(undefined);
  const [statusAggregation, setStatusAggregation] = useState<TrendQueryResponse["aggregation"]>("raw");
  const [rangePreset, setRangePreset] = useState<TrendRangePreset>("1h");
  const [visibleRange, setVisibleRange] = useState<TrendVisibleRange>(() => parseQuickRange("1h"));
  const [customFrom, setCustomFrom] = useState(() => toLocalDateTimeInputValue(Date.now() - 60 * 60 * 1000));
  const [customTo, setCustomTo] = useState(() => toLocalDateTimeInputValue(Date.now()));
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const requestIdRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const cacheRef = useRef(new TrendQueryCache(settings.cacheSize));
  const chartApiRef = useRef<TrendChartApi | null>(null);
  const liveBufferRef = useRef<Array<{ tag: string; value: number | boolean | string | null; quality?: string; timestamp: number }>>([]);
  const liveSocketRef = useRef<ReturnType<typeof createRuntimeSocket> | null>(null);

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
    const maxPoints = computeMaxPointsFromWidth(width, settings.maxPointsPerSeries);
    const tagNames = selectedTags.map((tag) => tag.tag);
    const key = buildTrendCacheKey({
      tags: tagNames,
      from: range.from,
      to: range.to,
      maxPoints,
      aggregation: settings.aggregation,
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

    try {
      const next = await queryTrendData({
        tags: tagNames,
        from: new Date(range.from).toISOString(),
        to: new Date(range.to).toISOString(),
        maxPoints,
        aggregation: settings.aggregation,
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
    } catch (queryError) {
      if (controller.signal.aborted) {
        return;
      }
      const text = queryError instanceof Error ? queryError.message : "Trends query failed";
      setError(text);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [selectedTags, settings.aggregation, settings.cacheEnabled, settings.maxPointsPerSeries]);

  useEffect(() => {
    cacheRef.current = new TrendQueryCache(settings.cacheSize);
    saveTrendSettings(settings);
  }, [settings]);

  useEffect(() => {
    saveTrendSelectedTags(selectedTags);
  }, [selectedTags]);

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
        setError(text);
      }
    })();
  }, []);

  useEffect(() => {
    if (selectedTags.length === 0) {
      return;
    }
    void executeQuery(visibleRange, { force: true });
  }, [selectedTags.length]);

  useEffect(() => {
    void executeQuery(visibleRange);
  }, [executeQuery, visibleRange.from, visibleRange.to]);

  useEffect(() => {
    if (!liveMode || selectedTags.length === 0) {
      liveSocketRef.current?.close();
      liveSocketRef.current = null;
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
    });
    socket.subscribeTags([...selected]);
    liveSocketRef.current = socket;

    const flushTimer = window.setInterval(() => {
      const batch = liveBufferRef.current.splice(0, liveBufferRef.current.length);
      if (batch.length === 0) {
        return;
      }
      chartApiRef.current?.appendLivePoints(batch);
    }, LIVE_FLUSH_MS);

    return () => {
      window.clearInterval(flushTimer);
      socket.close();
      if (liveSocketRef.current === socket) {
        liveSocketRef.current = null;
      }
    };
  }, [liveMode, selectedTags]);

  const applyPreset = async (preset: Exclude<TrendRangePreset, "custom">) => {
    const next = parseQuickRange(preset);
    setRangePreset(preset);
    setVisibleRange(next);
    if (preset === "24h" || preset === "8h" || preset === "1h" || preset === "15m" || preset === "5m") {
      setCustomFrom(toLocalDateTimeInputValue(next.from));
      setCustomTo(toLocalDateTimeInputValue(next.to));
    }
  };

  const applyCustom = () => {
    const from = fromLocalDateTimeInputValue(customFrom);
    const to = fromLocalDateTimeInputValue(customTo);
    setRangePreset("custom");
    setVisibleRange({ from, to });
  };

  const handleChartRangeChange = (range: TrendVisibleRange) => {
    setVisibleRange(range);
    if (liveMode) {
      setLiveMode(false);
      void message.info("Live paused by manual zoom/pan");
    }
  };

  const clearSelection = () => {
    setSelectedTags([]);
    setResponse(null);
    setError(null);
  };

  const refresh = () => {
    void executeQuery(visibleRange, { force: true });
  };

  const loadArchiveRange = async () => {
    try {
      const range = await fetchTrendRange(selectedTags.map((tag) => tag.tag));
      if (!range.from || !range.to) {
        void message.warning("No archive data for selected tags");
        return;
      }
      const next = { from: new Date(range.from).getTime(), to: new Date(range.to).getTime() };
      setRangePreset("custom");
      setCustomFrom(toLocalDateTimeInputValue(next.from));
      setCustomTo(toLocalDateTimeInputValue(next.to));
      setVisibleRange(next);
    } catch (rangeError) {
      void message.error(rangeError instanceof Error ? rangeError.message : "Failed to load archive range");
    }
  };

  const aggregationLabel = settings.aggregation === "auto" ? `auto -> ${statusAggregation}` : statusAggregation;

  return (
    <div className="trends-page">
      <div className="trends-toolbar">
        <WorkbenchButton variant="primary" onClick={() => setTagDialogOpen(true)}>Add/Remove Tags</WorkbenchButton>
        <WorkbenchButton onClick={clearSelection} disabled={selectedTags.length === 0}>Clear</WorkbenchButton>

        <select className="workbench-select" value={rangePreset} onChange={(event) => {
          const value = event.target.value as TrendRangePreset;
          if (value === "custom") {
            setRangePreset("custom");
            return;
          }
          void applyPreset(value);
        }}>
          <option value="5m">Last 5 min</option>
          <option value="15m">Last 15 min</option>
          <option value="1h">Last 1 hour</option>
          <option value="8h">Last 8 hours</option>
          <option value="24h">Last 24 hours</option>
          <option value="custom">Custom</option>
        </select>

        {rangePreset === "custom" ? (
          <>
            <input className="workbench-input" type="datetime-local" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
            <input className="workbench-input" type="datetime-local" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
            <WorkbenchButton onClick={applyCustom}>Apply</WorkbenchButton>
          </>
        ) : null}

        <WorkbenchButton onClick={loadArchiveRange} disabled={selectedTags.length === 0}>Archive Range</WorkbenchButton>
        <WorkbenchButton variant={liveMode ? "danger" : "default"} onClick={() => setLiveMode((prev) => !prev)} disabled={selectedTags.length === 0}>
          {liveMode ? "Pause" : "Live"}
        </WorkbenchButton>
        <WorkbenchButton onClick={refresh} disabled={selectedTags.length === 0}>Refresh</WorkbenchButton>
        <WorkbenchButton onClick={() => setSettingsOpen(true)}>Settings</WorkbenchButton>

        <div className="trends-toolbar__meta">
          {loading ? <Spin size="small" /> : null}
          <span>{aggregationLabel}</span>
          <span>{pointCount.toLocaleString()} pts</span>
        </div>
      </div>

      <div className="trends-chart-wrap">
        {selectedTags.length === 0 ? (
          <div className="trends-empty">No tags selected</div>
        ) : error ? (
          <div className="trends-empty trends-empty--error">{error}</div>
        ) : (
          <TrendChart
            data={response}
            tags={selectedTags}
            axes={axes}
            axisIdByTag={resolvedAxisIdByTag}
            settings={settings}
            visibleRange={visibleRange}
            liveMode={liveMode}
            liveWindowMs={liveWindowMs}
            onVisibleRangeChange={handleChartRangeChange}
            onChartApiReady={(api) => {
              chartApiRef.current = api;
            }}
          />
        )}
      </div>

      <div className="trends-status-bar">
        <span>Range: {formatRangeLabel(visibleRange.from, visibleRange.to)}</span>
        <span>Series: {selectedTags.length}</span>
        <span>Points: {pointCount.toLocaleString()}</span>
        <span>Aggregation: {aggregationLabel}</span>
        <span>Last load: {lastLoadAt ? new Date(lastLoadAt).toLocaleTimeString() : "-"}</span>
      </div>

      <TrendTagPickerDialog
        open={tagDialogOpen}
        tags={allTags}
        selectedTags={selectedTags}
        axes={axes}
        onClose={() => setTagDialogOpen(false)}
        onApply={(nextTags, nextAxes) => {
          setSelectedTags(nextTags);
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
