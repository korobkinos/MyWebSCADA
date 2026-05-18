import type { TrendAxisConfig, TrendRangePreset, TrendSeriesColumnId, TrendSeriesColumnWidths, TrendSettings, TrendTagPickerFilters, TrendTagSelection, TrendVisibleRange } from "./trendTypes";
import { clamp, defaultTrendSettings } from "./trendUtils";

const TREND_RUNTIME_VIEW_STATE_STORAGE_PREFIX = "mywebscada.trends.runtimeViewState";
const TREND_RUNTIME_VIEW_STATE_VERSION = 2;

const SERIES_COLUMN_IDS: TrendSeriesColumnId[] = ["visible", "tag", "color", "value"];

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
};

type TrendRuntimeViewStateEnvelope = {
  version: number;
  data: Partial<TrendRuntimeViewStateData>;
};

type RuntimeViewStateReadOptions = {
  objectId: string;
  defaultTagPickerFilters: TrendTagPickerFilters;
  defaultSeriesColumnWidths: TrendSeriesColumnWidths;
};

type RuntimeViewStateWriteOptions = {
  objectId: string;
  state: TrendRuntimeViewStateData;
};

type RuntimeViewStateResolveOptions = {
  raw: string;
  defaultTagPickerFilters: TrendTagPickerFilters;
  defaultSeriesColumnWidths: TrendSeriesColumnWidths;
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

function normalizeSeriesColumnWidths(
  source: Partial<Record<TrendSeriesColumnId, unknown>> | undefined,
  defaults: TrendSeriesColumnWidths,
): TrendSeriesColumnWidths {
  const next = { ...defaults };
  for (const id of SERIES_COLUMN_IDS) {
    const value = Number(source?.[id]);
    if (Number.isFinite(value) && value >= 36 && value <= 640) {
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
    selectionFilter: value?.selectionFilter === "added" ? "added" : "all",
  };
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
}: RuntimeViewStateResolveOptions): TrendRuntimeViewStateData | null {
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
      ? parsed.manualAxes.filter((axis) => typeof axis?.id === "string" && (axis?.position === "left" || axis?.position === "right"))
      : [];

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
    };
  } catch {
    return null;
  }
}

export function readRuntimeViewState({
  objectId,
  defaultTagPickerFilters,
  defaultSeriesColumnWidths,
}: RuntimeViewStateReadOptions): TrendRuntimeViewStateData | null {
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
