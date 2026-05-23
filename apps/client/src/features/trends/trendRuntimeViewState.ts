import type { TrendAxisConfig, TrendRangePreset, TrendQuickPreset, TrendSeriesColumnId, TrendSeriesColumnWidths, TrendSettings, TrendTagPickerFilters, TrendTagSelection, TrendVisibleRange } from "./trendTypes";
import { clamp, defaultTrendSettings, normalizeTrendTableSettings } from "./trendUtils";

const TREND_RUNTIME_VIEW_STATE_STORAGE_PREFIX = "mywebscada.trends.runtimeViewState";
const TREND_RUNTIME_VIEW_STATE_VERSION = 2;

const SERIES_COLUMN_IDS: TrendSeriesColumnId[] = ["visible", "tag", "displayName", "description", "color", "value"];

type TrendRuntimeViewStateData = {
  rangePreset: TrendRangePreset;
  visibleRange: TrendVisibleRange;
  liveMode: boolean;
  customFrom: string;
  customTo: string;
  settings: TrendSettings;
  selectedTags: TrendTagSelection[];
  manualAxes: TrendAxisConfig[];
  tagPickerFilters: TrendTagPickerFilters;
  seriesColumnWidths: TrendSeriesColumnWidths;
  seriesTableCollapsed?: boolean;
  toolbarQuickPreset?: TrendQuickPreset | null;
  defaultsSignature?: string;
};

type TrendRuntimeViewStateEnvelope = {
  version: number;
  data: Partial<TrendRuntimeViewStateData>;
};

type RuntimeViewStateReadOptions = {
  objectId: string;
  defaultTagPickerFilters: TrendTagPickerFilters;
  defaultSeriesColumnWidths: TrendSeriesColumnWidths;
  objectDefaultsSignature?: string;
};

type RuntimeViewStateWriteOptions = {
  objectId: string;
  state: TrendRuntimeViewStateData;
};

type RuntimeViewStateResolveOptions = {
  raw: string;
  defaultTagPickerFilters: TrendTagPickerFilters;
  defaultSeriesColumnWidths: TrendSeriesColumnWidths;
  objectDefaultsSignature?: string;
};

export type { TrendRuntimeViewStateData };

export function getRuntimeViewStateStorageKey(objectId: string): string {
  return `${TREND_RUNTIME_VIEW_STATE_STORAGE_PREFIX}:${objectId}`;
}

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

function normalizeSettings(source: Partial<TrendSettings>): TrendSettings {
  const defaults = defaultTrendSettings();
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
    liveDataSource: source.liveDataSource === "realtimeAppend" ? "realtimeAppend" : defaults.liveDataSource,
    liveResyncEnabled: source.liveResyncEnabled ?? defaults.liveResyncEnabled,
    liveResyncIntervalSec: clamp(Number(source.liveResyncIntervalSec ?? defaults.liveResyncIntervalSec), 10, 30),
    realtimeAppendSnapshotAggregation:
      source.realtimeAppendSnapshotAggregation === "raw" || source.realtimeAppendSnapshotAggregation === "minmax"
        ? source.realtimeAppendSnapshotAggregation
        : defaults.realtimeAppendSnapshotAggregation,
    realtimeAppendSnapshotMaxPoints: clamp(Number(source.realtimeAppendSnapshotMaxPoints ?? defaults.realtimeAppendSnapshotMaxPoints), 1000, 8000),
    realtimeAppendFlushMs: clamp(Number(source.realtimeAppendFlushMs ?? defaults.realtimeAppendFlushMs), 50, 1000),
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
    table: normalizeTrendTableSettings(source.table ?? defaults.table),
  };
}

function normalizeSeriesColumnWidths(
  source: Partial<Record<TrendSeriesColumnId, unknown>> | undefined,
  defaults: TrendSeriesColumnWidths,
): TrendSeriesColumnWidths {
  const next = { ...defaults };
  for (const id of SERIES_COLUMN_IDS) {
    const value = Number(source?.[id]);
    if (Number.isFinite(value) && value >= 24 && value <= 640) {
      next[id] = Math.round(value);
    }
  }
  return next;
}

function normalizeTagPickerFilters(source: unknown, defaults: TrendTagPickerFilters): TrendTagPickerFilters {
  const value = source as Partial<TrendTagPickerFilters> | undefined;
  return {
    search: typeof value?.search === "string" ? value.search : defaults.search,
    groupFilter: typeof value?.groupFilter === "string" ? value.groupFilter : defaults.groupFilter,
    driverFilter: typeof value?.driverFilter === "string" ? value.driverFilter : defaults.driverFilter,
    selectionFilter: value?.selectionFilter === "added" ? "added" : "all",
  };
}

function normalizeAxisTitleMode(value: unknown): "hidden" | "compactLabel" | "verticalLabel" {
  if (value === "compactLabel" || value === "verticalLabel") {
    return value;
  }
  return "hidden";
}

function normalizeVerticalLabelOffsetX(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return clamp(Math.round(numeric), -160, 160);
}

function parseLegacyOrCurrent(raw: string): Partial<TrendRuntimeViewStateData> | null {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  if (
    "version" in parsed
    && "data" in parsed
    && Number.isFinite(Number((parsed as TrendRuntimeViewStateEnvelope).version))
    && typeof (parsed as TrendRuntimeViewStateEnvelope).data === "object"
  ) {
    return (parsed as TrendRuntimeViewStateEnvelope).data;
  }
  return parsed as Partial<TrendRuntimeViewStateData>;
}

export function resolveRuntimeViewState({
  raw,
  defaultTagPickerFilters,
  defaultSeriesColumnWidths,
  objectDefaultsSignature,
}: RuntimeViewStateResolveOptions): TrendRuntimeViewStateData | null {
  void objectDefaultsSignature;
  try {
    const parsed = parseLegacyOrCurrent(raw);
    if (!parsed) {
      return null;
    }
    const from = Number(parsed.visibleRange?.from);
    const to = Number(parsed.visibleRange?.to);
    const isRangeValid = Number.isFinite(from) && Number.isFinite(to) && to > from;
    const preset = parsed.rangePreset;
    const isPresetValid = preset === "5m" || preset === "15m" || preset === "1h" || preset === "8h" || preset === "24h" || preset === "custom";
    if (!isRangeValid || !isPresetValid) {
      return null;
    }

    const selectedTags = Array.isArray(parsed.selectedTags)
      ? parsed.selectedTags.filter((item) => typeof item?.tag === "string" && item.tag.trim().length > 0)
      : [];
    const manualAxes = Array.isArray(parsed.manualAxes)
      ? parsed.manualAxes
        .filter((axis) => typeof axis?.id === "string" && (axis?.position === "left" || axis?.position === "right"))
        .map((axis) => ({
          ...axis,
          axisTitleMode: normalizeAxisTitleMode((axis as { axisTitleMode?: unknown }).axisTitleMode),
          verticalLabelOffsetX: normalizeVerticalLabelOffsetX((axis as { verticalLabelOffsetX?: unknown }).verticalLabelOffsetX),
        }))
      : [];
    const rawToolbarQuickPreset = (parsed as Record<string, unknown>).toolbarQuickPreset;
    const toolbarQuickPreset: TrendQuickPreset | null =
      rawToolbarQuickPreset === "5m" || rawToolbarQuickPreset === "15m" || rawToolbarQuickPreset === "1h"
        ? rawToolbarQuickPreset
        : null;

    return {
      rangePreset: preset,
      visibleRange: { from, to },
      liveMode: Boolean(parsed.liveMode),
      customFrom: typeof parsed.customFrom === "string" ? parsed.customFrom : toLocalDateTimeInputValue(from),
      customTo: typeof parsed.customTo === "string" ? parsed.customTo : toLocalDateTimeInputValue(to),
      settings: normalizeSettings((parsed.settings ?? {}) as Partial<TrendSettings>),
      selectedTags,
      manualAxes,
      tagPickerFilters: normalizeTagPickerFilters(parsed.tagPickerFilters, defaultTagPickerFilters),
      seriesColumnWidths: normalizeSeriesColumnWidths(
        parsed.seriesColumnWidths as Partial<Record<TrendSeriesColumnId, unknown>> | undefined,
        defaultSeriesColumnWidths,
      ),
      seriesTableCollapsed: Boolean(parsed.seriesTableCollapsed),
      toolbarQuickPreset,
      defaultsSignature: typeof parsed.defaultsSignature === "string" ? parsed.defaultsSignature : undefined,
    };
  } catch {
    return null;
  }
}

export function readRuntimeViewState({
  objectId,
  defaultTagPickerFilters,
  defaultSeriesColumnWidths,
  objectDefaultsSignature,
}: RuntimeViewStateReadOptions): TrendRuntimeViewStateData | null {
  void objectDefaultsSignature;
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(getRuntimeViewStateStorageKey(objectId));
  if (!raw) {
    return null;
  }
  return resolveRuntimeViewState({
    raw,
    defaultTagPickerFilters,
    defaultSeriesColumnWidths,
    objectDefaultsSignature,
  });
}

export function writeRuntimeViewState({ objectId, state }: RuntimeViewStateWriteOptions): void {
  if (typeof window === "undefined") {
    return;
  }
  const payload: TrendRuntimeViewStateEnvelope = {
    version: TREND_RUNTIME_VIEW_STATE_VERSION,
    data: state,
  };
  window.localStorage.setItem(getRuntimeViewStateStorageKey(objectId), JSON.stringify(payload));
}
