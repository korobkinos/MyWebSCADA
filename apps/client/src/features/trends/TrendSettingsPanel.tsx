import { type ChangeEvent, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { ColorPicker } from "antd";
import { WorkbenchButton } from "../../components/workbench";
import type { TrendAxisConfig, TrendSettings, TrendTagSelection } from "./trendTypes";
import { TrendWorkbenchDialog } from "./TrendWorkbenchDialog";
import { TREND_DEFAULT_AXIS_ID, createTrendAxisConfig, normalizeTrendAxes } from "./trendUtils";

type TrendSettingsPanelProps = {
  open: boolean;
  settings: TrendSettings;
  axes: TrendAxisConfig[];
  selectedTags: TrendTagSelection[];
  initialTab?: TrendSettingsTab;
  onClose: () => void;
  onSettingsChange: (next: TrendSettings) => void;
  onAxesChange: (next: TrendAxisConfig[]) => void;
  onSelectedTagsChange: (next: TrendTagSelection[]) => void;
};

type TrendSettingsTab = "appearance" | "performance" | "axes" | "series" | "toolbar";

const TREND_SETTINGS_AXES_COLUMN_WIDTHS_STORAGE_KEY = "scada.trends.settings.axesColumnWidths";
const TREND_SETTINGS_SERIES_COLUMN_WIDTHS_STORAGE_KEY = "scada.trends.settings.seriesColumnWidths";
const MAX_TABLE_COLUMN_WIDTH = 1400;

const AXES_COLUMNS = [
  { id: "id", label: "Axis", width: 128, min: 100 },
  { id: "name", label: "Name", width: 144, min: 110 },
  { id: "position", label: "Side", width: 74, min: 68 },
  { id: "offset", label: "Offset", width: 66, min: 60 },
  { id: "min", label: "Min", width: 132, min: 120 },
  { id: "max", label: "Max", width: 132, min: 120 },
  { id: "labelSize", label: "Lbl Size", width: 74, min: 68 },
  { id: "labelGap", label: "Lbl Gap", width: 72, min: 66 },
  { id: "nameSize", label: "Name Size", width: 80, min: 72 },
  { id: "nameGap", label: "Name Gap", width: 76, min: 70 },
  { id: "padX", label: "Pad X", width: 66, min: 60 },
  { id: "padY", label: "Pad Y", width: 66, min: 60 },
  { id: "textColor", label: "Text", width: 86, min: 78 },
  { id: "cursorBg", label: "Cursor", width: 90, min: 82 },
  { id: "gridColor", label: "Grid", width: 86, min: 78 },
  { id: "used", label: "Used", width: 58, min: 52 },
  { id: "actions", label: "", width: 84, min: 74 },
] as const;

const SERIES_COLUMNS = [
  { id: "visible", label: "On", width: 52, min: 44 },
  { id: "tag", label: "Tag", width: 200, min: 140 },
  { id: "displayName", label: "Display Name", width: 184, min: 130 },
  { id: "color", label: "Color", width: 86, min: 76 },
  { id: "mode", label: "Mode", width: 94, min: 82 },
  { id: "lineWidth", label: "Width", width: 70, min: 64 },
  { id: "axis", label: "Axis", width: 160, min: 120 },
  { id: "actions", label: "", width: 154, min: 140 },
] as const;

const SETTINGS_NAV_ITEMS: Array<{ id: TrendSettingsTab; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "performance", label: "Data / Performance" },
  { id: "axes", label: "Axes" },
  { id: "series", label: "Series" },
  { id: "toolbar", label: "Toolbar" },
];

type AxisColumnId = (typeof AXES_COLUMNS)[number]["id"];
type SeriesColumnId = (typeof SERIES_COLUMNS)[number]["id"];
type AxisColumnWidths = Record<AxisColumnId, number>;
type SeriesColumnWidths = Record<SeriesColumnId, number>;

type TrendColorButtonProps = {
  value?: string;
  fallback: string;
  disabled?: boolean;
  title: string;
  onChange: (value: string) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseNumber(value: string): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
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

function nextManualAxisId(existingAxes: TrendAxisConfig[]): string {
  const used = new Set(existingAxes.map((axis) => axis.id));
  let index = 1;
  while (used.has(`axis:manual:${index}`)) {
    index += 1;
  }
  return `axis:manual:${index}`;
}

function defaultAxisColumnWidths(): AxisColumnWidths {
  return AXES_COLUMNS.reduce<AxisColumnWidths>((acc, column) => {
    acc[column.id] = column.width;
    return acc;
  }, {} as AxisColumnWidths);
}

function defaultSeriesColumnWidths(): SeriesColumnWidths {
  return SERIES_COLUMNS.reduce<SeriesColumnWidths>((acc, column) => {
    acc[column.id] = column.width;
    return acc;
  }, {} as SeriesColumnWidths);
}

function readAxisColumnWidths(): AxisColumnWidths {
  const fallback = defaultAxisColumnWidths();
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(TREND_SETTINGS_AXES_COLUMN_WIDTHS_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<Record<AxisColumnId, unknown>>;
    const next = { ...fallback };
    for (const column of AXES_COLUMNS) {
      const value = Number(parsed[column.id]);
      if (Number.isFinite(value)) {
        next[column.id] = clamp(Math.round(value), column.min, MAX_TABLE_COLUMN_WIDTH);
      }
    }
    return next;
  } catch {
    return fallback;
  }
}

function readSeriesColumnWidths(): SeriesColumnWidths {
  const fallback = defaultSeriesColumnWidths();
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(TREND_SETTINGS_SERIES_COLUMN_WIDTHS_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<Record<SeriesColumnId, unknown>>;
    const next = { ...fallback };
    for (const column of SERIES_COLUMNS) {
      const value = Number(parsed[column.id]);
      if (Number.isFinite(value)) {
        next[column.id] = clamp(Math.round(value), column.min, MAX_TABLE_COLUMN_WIDTH);
      }
    }
    return next;
  } catch {
    return fallback;
  }
}

function writeAxisColumnWidths(widths: AxisColumnWidths): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const payload: Partial<Record<AxisColumnId, number>> = {};
    for (const column of AXES_COLUMNS) {
      const value = Number(widths[column.id]);
      if (!Number.isFinite(value)) {
        continue;
      }
      payload[column.id] = clamp(Math.round(value), column.min, MAX_TABLE_COLUMN_WIDTH);
    }
    window.localStorage.setItem(TREND_SETTINGS_AXES_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore localStorage write errors
  }
}

function writeSeriesColumnWidths(widths: SeriesColumnWidths): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const payload: Partial<Record<SeriesColumnId, number>> = {};
    for (const column of SERIES_COLUMNS) {
      const value = Number(widths[column.id]);
      if (!Number.isFinite(value)) {
        continue;
      }
      payload[column.id] = clamp(Math.round(value), column.min, MAX_TABLE_COLUMN_WIDTH);
    }
    window.localStorage.setItem(TREND_SETTINGS_SERIES_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore localStorage write errors
  }
}

function TrendColorButton({ value, fallback, disabled = false, title, onChange }: TrendColorButtonProps) {
  const colorValue = normalizeHexColor(value, fallback);
  return (
    <ColorPicker
      value={colorValue}
      disabled={disabled}
      trigger="click"
      onChangeComplete={(color) => onChange(color.toHexString())}
    >
      <button
        type="button"
        className="trends-settings-color-button"
        title={`${title}: ${colorValue}`}
        aria-label={title}
        disabled={disabled}
      >
        <span className="trends-settings-color-button__swatch" style={{ backgroundColor: colorValue }} />
      </button>
    </ColorPicker>
  );
}

export function TrendSettingsPanel({
  open,
  settings,
  axes,
  selectedTags,
  initialTab,
  onClose,
  onSettingsChange,
  onAxesChange,
  onSelectedTagsChange,
}: TrendSettingsPanelProps) {
  const [draftSettings, setDraftSettings] = useState<TrendSettings>(settings);
  const [draftAxes, setDraftAxes] = useState<TrendAxisConfig[]>(normalizeTrendAxes(axes, settings));
  const [draftSelectedTags, setDraftSelectedTags] = useState<TrendTagSelection[]>(selectedTags);
  const [activeTab, setActiveTab] = useState<TrendSettingsTab>("appearance");
  const [axisColumnWidths, setAxisColumnWidths] = useState<AxisColumnWidths>(() => readAxisColumnWidths());
  const [seriesColumnWidths, setSeriesColumnWidths] = useState<SeriesColumnWidths>(() => readSeriesColumnWidths());
  const axisResizeStateRef = useRef<{ id: AxisColumnId | null; startX: number; startWidth: number }>({ id: null, startX: 0, startWidth: 0 });
  const seriesResizeStateRef = useRef<{ id: SeriesColumnId | null; startX: number; startWidth: number }>({ id: null, startX: 0, startWidth: 0 });

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraftSettings(settings);
    setDraftAxes(normalizeTrendAxes(axes, settings));
    setDraftSelectedTags(selectedTags);
    setActiveTab(initialTab ?? "appearance");
    setAxisColumnWidths(readAxisColumnWidths());
    setSeriesColumnWidths(readSeriesColumnWidths());
  }, [axes, initialTab, open, selectedTags, settings]);

  useEffect(() => {
    writeAxisColumnWidths(axisColumnWidths);
  }, [axisColumnWidths]);

  useEffect(() => {
    writeSeriesColumnWidths(seriesColumnWidths);
  }, [seriesColumnWidths]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const axisState = axisResizeStateRef.current;
      if (axisState.id) {
        const config = AXES_COLUMNS.find((column) => column.id === axisState.id);
        if (!config) {
          return;
        }
        const delta = event.clientX - axisState.startX;
        const nextWidth = clamp(Math.round(axisState.startWidth + delta), config.min, MAX_TABLE_COLUMN_WIDTH);
        setAxisColumnWidths((prev) => ({ ...prev, [axisState.id as AxisColumnId]: nextWidth }));
      }
      const seriesState = seriesResizeStateRef.current;
      if (seriesState.id) {
        const config = SERIES_COLUMNS.find((column) => column.id === seriesState.id);
        if (!config) {
          return;
        }
        const delta = event.clientX - seriesState.startX;
        const nextWidth = clamp(Math.round(seriesState.startWidth + delta), config.min, MAX_TABLE_COLUMN_WIDTH);
        setSeriesColumnWidths((prev) => ({ ...prev, [seriesState.id as SeriesColumnId]: nextWidth }));
      }
    };
    const handleUp = () => {
      if (axisResizeStateRef.current.id) {
        axisResizeStateRef.current = { id: null, startX: 0, startWidth: 0 };
      }
      if (seriesResizeStateRef.current.id) {
        seriesResizeStateRef.current = { id: null, startX: 0, startWidth: 0 };
      }
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

  const patchSettings = (patch: Partial<TrendSettings>) => {
    setDraftSettings((prev) => ({ ...prev, ...patch }));
  };

  const updateAxis = (axisId: string, patch: Partial<TrendAxisConfig>) => {
    setDraftAxes((prev) => normalizeTrendAxes(prev.map((axis) => (axis.id === axisId ? { ...axis, ...patch } : axis)), draftSettings));
  };

  const updateSeries = (tag: string, patch: Partial<TrendTagSelection>) => {
    setDraftSelectedTags((prev) => prev.map((item) => (item.tag === tag ? { ...item, ...patch } : item)));
  };

  const removeSeriesTag = (tag: string) => {
    setDraftSelectedTags((prev) => prev.filter((item) => item.tag !== tag));
  };

  const moveSeriesTag = (tag: string, direction: -1 | 1) => {
    setDraftSelectedTags((prev) => {
      const index = prev.findIndex((item) => item.tag === tag);
      if (index < 0) {
        return prev;
      }
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [item] = next.splice(index, 1);
      if (!item) {
        return prev;
      }
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const onNumericInput = (event: ChangeEvent<HTMLInputElement>, apply: (value: number) => void) => {
    const parsed = parseNumber(event.target.value);
    if (parsed === undefined) {
      return;
    }
    apply(parsed);
  };

  const addAxis = () => {
    setDraftAxes((prev) => {
      const nextId = nextManualAxisId(prev);
      return normalizeTrendAxes([...prev, createTrendAxisConfig(draftSettings, nextId, prev.length)], draftSettings);
    });
  };

  const removeAxis = (axisId: string) => {
    if (axisId === TREND_DEFAULT_AXIS_ID) {
      return;
    }
    setDraftAxes((prev) => normalizeTrendAxes(prev.filter((axis) => axis.id !== axisId), draftSettings));
    setDraftSelectedTags((prev) => prev.map((tag) => (
      tag.axisMode === "manual" && tag.axisId === axisId
        ? { ...tag, axisMode: "auto", axisId: undefined }
        : tag
    )));
  };

  const handleSave = () => {
    onSettingsChange(draftSettings);
    onAxesChange(normalizeTrendAxes(draftAxes, draftSettings));
    onSelectedTagsChange(draftSelectedTags);
    onClose();
  };

  const axisUsageCount = useMemo(() => {
    const usage = new Map<string, number>();
    for (const tag of draftSelectedTags) {
      const assigned = tag.axisMode === "manual" && tag.axisId ? tag.axisId : TREND_DEFAULT_AXIS_ID;
      usage.set(assigned, (usage.get(assigned) ?? 0) + 1);
    }
    return usage;
  }, [draftSelectedTags]);

  const axisTemplate = useMemo(
    () => AXES_COLUMNS.map((column) => `${Math.round(axisColumnWidths[column.id])}px`).join(" "),
    [axisColumnWidths],
  );

  const seriesTemplate = useMemo(
    () => SERIES_COLUMNS.map((column) => `${Math.round(seriesColumnWidths[column.id])}px`).join(" "),
    [seriesColumnWidths],
  );

  const startAxisColumnResize = (event: ReactMouseEvent<HTMLDivElement>, columnId: AxisColumnId) => {
    event.preventDefault();
    event.stopPropagation();
    axisResizeStateRef.current = { id: columnId, startX: event.clientX, startWidth: axisColumnWidths[columnId] };
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    }
  };

  const startSeriesColumnResize = (event: ReactMouseEvent<HTMLDivElement>, columnId: SeriesColumnId) => {
    event.preventDefault();
    event.stopPropagation();
    seriesResizeStateRef.current = { id: columnId, startX: event.clientX, startWidth: seriesColumnWidths[columnId] };
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    }
  };

  if (!open) {
    return null;
  }

  return (
    <TrendWorkbenchDialog
      id="trend-settings-dialog"
      title="Trend Settings"
      open={open}
      defaultRect={{ x: 140, y: 80, width: 1020, height: 620 }}
      minWidth={820}
      minHeight={500}
      bodyClassName="trends-settings-dialog-body"
      footer={(
        <>
          <WorkbenchButton onClick={onClose}>Cancel</WorkbenchButton>
          <WorkbenchButton variant="primary" onClick={handleSave}>Save</WorkbenchButton>
        </>
      )}
      onClose={onClose}
    >
      <div className="trends-dialog__body trends-settings-body">
        <nav className="trends-settings-nav" aria-label="Trend settings sections">
          {SETTINGS_NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={activeTab === item.id}
              className={`workbench-tree-item trends-settings-nav-item ${activeTab === item.id ? "workbench-tree-item--active" : ""}`}
              onClick={() => setActiveTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="trends-settings-content">
          {activeTab === "appearance" ? (
            <div className="trends-settings-scroll" role="tabpanel" aria-label="Appearance settings">
              <section className="workbench-section">
                <div className="workbench-section__header"><span className="workbench-section__title">Theme</span></div>
                <div className="workbench-section__content">
                  <div className="trends-settings-fields trends-settings-fields--two-col-compact">
                    <label className="workbench-field">
                      <span className="workbench-field__label">Theme</span>
                      <select className="workbench-select" value={draftSettings.theme} onChange={(event) => patchSettings({ theme: event.target.value as TrendSettings["theme"] })}>
                        <option value="workbench-dark">Workbench dark</option>
                        <option value="echarts-dark">ECharts dark</option>
                        <option value="custom">Custom</option>
                      </select>
                    </label>
                    <label className="workbench-field">
                      <span className="workbench-field__label">Background</span>
                      <div className="trends-settings-color-field">
                        <TrendColorButton
                          value={draftSettings.background}
                          fallback="#1e1e1e"
                          title="Background color"
                          disabled={draftSettings.theme !== "custom"}
                          onChange={(value) => patchSettings({ background: value })}
                        />
                        <span className="trends-settings-field-note">Custom theme only</span>
                      </div>
                    </label>
                  </div>
                </div>
              </section>

              <section className="workbench-section">
                <div className="workbench-section__header"><span className="workbench-section__title">Display</span></div>
                <div className="workbench-section__content">
                  <div className="trends-settings-check-grid">
                    <label className="screen-editor-settings-check"><input type="checkbox" checked={draftSettings.gridLines} onChange={(event) => patchSettings({ gridLines: event.target.checked })} /><span>Grid lines</span></label>
                    <label className="screen-editor-settings-check"><input type="checkbox" checked={draftSettings.axisLabels} onChange={(event) => patchSettings({ axisLabels: event.target.checked })} /><span>Axis labels</span></label>
                    <label className="screen-editor-settings-check"><input type="checkbox" checked={draftSettings.showSymbols} onChange={(event) => patchSettings({ showSymbols: event.target.checked })} /><span>Point symbols</span></label>
                    <label className="screen-editor-settings-check"><input type="checkbox" checked={draftSettings.showSeriesTable} onChange={(event) => patchSettings({ showSeriesTable: event.target.checked })} /><span>Show bottom table</span></label>
                  </div>
                </div>
              </section>

              <section className="workbench-section">
                <div className="workbench-section__header"><span className="workbench-section__title">Bottom Table</span></div>
                <div className="workbench-section__content">
                  <div className="trends-settings-fields trends-settings-fields--single-narrow">
                    <label className="workbench-field">
                      <span className="workbench-field__label">Rows</span>
                      <input
                        className="workbench-input"
                        type="number"
                        min={2}
                        max={24}
                        value={draftSettings.seriesTableRows}
                        onChange={(event) => onNumericInput(event, (value) => patchSettings({ seriesTableRows: clamp(Math.round(value), 2, 24) }))}
                      />
                    </label>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === "performance" ? (
            <div className="trends-settings-scroll" role="tabpanel" aria-label="Data and performance settings">
              <section className="workbench-section">
                <div className="workbench-section__header"><span className="workbench-section__title">Data Query</span></div>
                <div className="workbench-section__content">
                  <div className="trends-settings-fields trends-settings-fields--three-col">
                    <label className="workbench-field">
                      <span className="workbench-field__label">Max points/series</span>
                      <input className="workbench-input" type="number" min={1000} max={8000} value={draftSettings.maxPointsPerSeries} onChange={(event) => onNumericInput(event, (value) => patchSettings({ maxPointsPerSeries: value }))} />
                    </label>
                    <label className="workbench-field">
                      <span className="workbench-field__label">Aggregation</span>
                      <select className="workbench-select" value={draftSettings.aggregation} onChange={(event) => patchSettings({ aggregation: event.target.value as TrendSettings["aggregation"] })}>
                        <option value="auto">auto</option>
                        <option value="raw">raw</option>
                        <option value="minmax">minmax</option>
                        <option value="avg">avg</option>
                        <option value="lttb">lttb</option>
                      </select>
                    </label>
                    <label className="workbench-field">
                      <span className="workbench-field__label">Zoom debounce (ms)</span>
                      <input className="workbench-input" type="number" min={100} max={1200} value={draftSettings.zoomDebounceMs} onChange={(event) => onNumericInput(event, (value) => patchSettings({ zoomDebounceMs: value }))} />
                    </label>
                  </div>
                </div>
              </section>

              <section className="workbench-section">
                <div className="workbench-section__header"><span className="workbench-section__title">Live Performance</span></div>
                <div className="workbench-section__content">
                  <div className="trends-settings-fields trends-settings-fields--three-col">
                    <label className="workbench-field">
                      <span className="workbench-field__label">Live buffer limit</span>
                      <input className="workbench-input" type="number" min={200} max={20000} value={draftSettings.liveBufferLimit} onChange={(event) => onNumericInput(event, (value) => patchSettings({ liveBufferLimit: value }))} />
                    </label>
                    <label className="screen-editor-settings-check"><input type="checkbox" checked={draftSettings.progressive} onChange={(event) => patchSettings({ progressive: event.target.checked })} /><span>Progressive rendering</span></label>
                    <label className="screen-editor-settings-check"><input type="checkbox" checked={draftSettings.disableAnimationsLargeData} onChange={(event) => patchSettings({ disableAnimationsLargeData: event.target.checked })} /><span>Disable animation on large data</span></label>
                  </div>
                </div>
              </section>

              <section className="workbench-section">
                <div className="workbench-section__header"><span className="workbench-section__title">Cache</span></div>
                <div className="workbench-section__content">
                  <div className="trends-settings-fields trends-settings-fields--three-col">
                    <label className="screen-editor-settings-check"><input type="checkbox" checked={draftSettings.cacheEnabled} onChange={(event) => patchSettings({ cacheEnabled: event.target.checked })} /><span>Cache enabled</span></label>
                    <label className="workbench-field">
                      <span className="workbench-field__label">Cache size</span>
                      <input className="workbench-input" type="number" min={8} max={256} value={draftSettings.cacheSize} onChange={(event) => onNumericInput(event, (value) => patchSettings({ cacheSize: value }))} />
                    </label>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === "axes" ? (
            <section className="trends-settings-section-table" role="tabpanel" aria-label="Axis settings">
              <div className="workbench-section trends-settings-section-compact">
                <div className="workbench-section__header"><span className="workbench-section__title">Axes</span></div>
                <div className="workbench-section__content">
                  <div className="trends-settings-fields trends-settings-fields--two-col-compact">
                    <label className="workbench-field">
                      <span className="workbench-field__label">Axis placement</span>
                      <select className="workbench-select" value={draftSettings.axisPlacement} onChange={(event) => patchSettings({ axisPlacement: event.target.value as TrendSettings["axisPlacement"] })}>
                        <option value="split">Split left/right</option>
                        <option value="left">Left only</option>
                        <option value="right">Right only</option>
                      </select>
                    </label>
                    <label className="workbench-field">
                      <span className="workbench-field__label">Axis offset step</span>
                      <input className="workbench-input" type="number" min={8} max={220} value={draftSettings.axisOffsetStep} onChange={(event) => onNumericInput(event, (value) => patchSettings({ axisOffsetStep: value }))} />
                    </label>
                  </div>
                  <div className="trends-settings-toolbar-row">
                    <WorkbenchButton variant="primary" onClick={addAxis}>Add Axis</WorkbenchButton>
                  </div>
                </div>
              </div>

              <div className="trends-settings-table-wrap">
                <div className="trends-settings-table">
                  <div className="screen-editor-tags-row screen-editor-tags-row--header trends-settings-table__row trends-settings-table__row--head" style={{ gridTemplateColumns: axisTemplate }}>
                    {AXES_COLUMNS.map((column, index) => (
                      <div key={column.id} className="screen-editor-tags-cell screen-editor-tags-header-cell trends-settings-table__cell trends-settings-table__cell--header">
                        <span>{column.label}</span>
                        {index < AXES_COLUMNS.length - 1 ? (
                          <div className="screen-editor-tags-column-resize-handle trends-settings-table__resize-handle" onMouseDown={(event) => startAxisColumnResize(event, column.id)} />
                        ) : null}
                      </div>
                    ))}
                  </div>

                  {draftAxes.map((axis) => (
                    <div key={axis.id} className="screen-editor-tags-row trends-settings-table__row" style={{ gridTemplateColumns: axisTemplate }}>
                      <div className="screen-editor-tags-cell trends-settings-table__cell" title={axis.id}>{axis.id}</div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <input className="workbench-input" value={axis.name ?? ""} onChange={(event) => updateAxis(axis.id, { name: event.target.value })} />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <select className="workbench-select" value={axis.position} onChange={(event) => updateAxis(axis.id, { position: event.target.value as TrendAxisConfig["position"] })}>
                          <option value="left">left</option>
                          <option value="right">right</option>
                        </select>
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <input className="workbench-input" type="number" value={axis.offset ?? 0} onChange={(event) => onNumericInput(event, (value) => updateAxis(axis.id, { offset: Math.max(0, Math.round(value)) }))} />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell trends-settings-table__bound-cell">
                        <label className="screen-editor-settings-check">
                          <input type="checkbox" checked={axis.min === "auto" || axis.min === undefined} onChange={(event) => updateAxis(axis.id, { min: event.target.checked ? "auto" : 0 })} />
                          <span>auto</span>
                        </label>
                        <input
                          className="workbench-input"
                          type="number"
                          step="0.1"
                          disabled={axis.min === "auto" || axis.min === undefined}
                          value={axis.min === "auto" || axis.min === undefined ? "" : axis.min}
                          onChange={(event) => onNumericInput(event, (value) => updateAxis(axis.id, { min: value }))}
                        />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell trends-settings-table__bound-cell">
                        <label className="screen-editor-settings-check">
                          <input type="checkbox" checked={axis.max === "auto" || axis.max === undefined} onChange={(event) => updateAxis(axis.id, { max: event.target.checked ? "auto" : 100 })} />
                          <span>auto</span>
                        </label>
                        <input
                          className="workbench-input"
                          type="number"
                          step="0.1"
                          disabled={axis.max === "auto" || axis.max === undefined}
                          value={axis.max === "auto" || axis.max === undefined ? "" : axis.max}
                          onChange={(event) => onNumericInput(event, (value) => updateAxis(axis.id, { max: value }))}
                        />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <input className="workbench-input" type="number" value={axis.axisLabelFontSize ?? 12} onChange={(event) => onNumericInput(event, (value) => updateAxis(axis.id, { axisLabelFontSize: value }))} />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <input className="workbench-input" type="number" value={axis.axisLabelMargin ?? 6} onChange={(event) => onNumericInput(event, (value) => updateAxis(axis.id, { axisLabelMargin: value }))} />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <input className="workbench-input" type="number" value={axis.axisNameFontSize ?? 12} onChange={(event) => onNumericInput(event, (value) => updateAxis(axis.id, { axisNameFontSize: value }))} />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <input className="workbench-input" type="number" value={axis.axisNameGap ?? 30} onChange={(event) => onNumericInput(event, (value) => updateAxis(axis.id, { axisNameGap: value }))} />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <input className="workbench-input" type="number" value={axis.axisNamePaddingX ?? 6} onChange={(event) => onNumericInput(event, (value) => updateAxis(axis.id, { axisNamePaddingX: value }))} />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <input className="workbench-input" type="number" value={axis.axisNamePaddingY ?? 3} onChange={(event) => onNumericInput(event, (value) => updateAxis(axis.id, { axisNamePaddingY: value }))} />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell trends-settings-table__cell--color">
                        <TrendColorButton
                          value={axis.axisTextColor ?? axis.color}
                          fallback="#4FC3F7"
                          title={`Axis ${axis.name || axis.id} text color`}
                          onChange={(value) => updateAxis(axis.id, { axisTextColor: value, color: value })}
                        />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell trends-settings-table__cell--color">
                        <TrendColorButton
                          value={axis.axisPointerLabelBackgroundColor}
                          fallback="#4a5a75"
                          title={`Axis ${axis.name || axis.id} cursor label background`}
                          onChange={(value) => updateAxis(axis.id, { axisPointerLabelBackgroundColor: value })}
                        />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell trends-settings-table__cell--color">
                        <TrendColorButton
                          value={axis.axisGridLineColor}
                          fallback="#3c3c3c"
                          title={`Axis ${axis.name || axis.id} grid color`}
                          onChange={(value) => updateAxis(axis.id, { axisGridLineColor: value })}
                        />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">{axisUsageCount.get(axis.id) ?? 0}</div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <WorkbenchButton variant="danger" onClick={() => removeAxis(axis.id)} disabled={axis.id === TREND_DEFAULT_AXIS_ID}>Delete</WorkbenchButton>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === "series" ? (
            <section className="trends-settings-section-table trends-settings-section-table--full-table" role="tabpanel" aria-label="Series settings">
              <div className="trends-settings-table-wrap">
                <div className="trends-settings-table">
                  <div className="screen-editor-tags-row screen-editor-tags-row--header trends-settings-table__row trends-settings-table__row--head" style={{ gridTemplateColumns: seriesTemplate }}>
                    {SERIES_COLUMNS.map((column, index) => (
                      <div key={column.id} className="screen-editor-tags-cell screen-editor-tags-header-cell trends-settings-table__cell trends-settings-table__cell--header">
                        <span>{column.label}</span>
                        {index < SERIES_COLUMNS.length - 1 ? (
                          <div className="screen-editor-tags-column-resize-handle trends-settings-table__resize-handle" onMouseDown={(event) => startSeriesColumnResize(event, column.id)} />
                        ) : null}
                      </div>
                    ))}
                  </div>

                  {draftSelectedTags.map((tag, index) => (
                    <div key={tag.tag} className="screen-editor-tags-row trends-settings-table__row" style={{ gridTemplateColumns: seriesTemplate }}>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <input type="checkbox" checked={tag.visible !== false} onChange={(event) => updateSeries(tag.tag, { visible: event.target.checked })} />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell" title={tag.tag}>{tag.tag}</div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <input className="workbench-input" value={tag.displayName ?? ""} onChange={(event) => updateSeries(tag.tag, { displayName: event.target.value })} />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell trends-settings-table__cell--color">
                        <TrendColorButton
                          value={tag.color}
                          fallback="#4FC3F7"
                          title={`Series ${tag.displayName || tag.tag} color`}
                          onChange={(value) => updateSeries(tag.tag, { color: value })}
                        />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <select className="workbench-select" value={tag.mode ?? "line"} onChange={(event) => updateSeries(tag.tag, { mode: event.target.value as TrendTagSelection["mode"] })}>
                          <option value="line">line</option>
                          <option value="step">step</option>
                          <option value="points">points</option>
                        </select>
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <input className="workbench-input" type="number" min={1} max={5} value={tag.lineWidth ?? draftSettings.defaultLineWidth} onChange={(event) => onNumericInput(event, (value) => updateSeries(tag.tag, { lineWidth: value }))} />
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell">
                        <select
                          className="workbench-select"
                          value={tag.axisMode === "manual" && tag.axisId ? tag.axisId : TREND_DEFAULT_AXIS_ID}
                          onChange={(event) => {
                            const nextAxisId = event.target.value;
                            if (nextAxisId === TREND_DEFAULT_AXIS_ID) {
                              updateSeries(tag.tag, { axisMode: "auto", axisId: undefined });
                              return;
                            }
                            updateSeries(tag.tag, { axisMode: "manual", axisId: nextAxisId });
                          }}
                        >
                          {draftAxes.map((axis) => (
                            <option key={axis.id} value={axis.id}>{axis.name || axis.id}</option>
                          ))}
                        </select>
                      </div>
                      <div className="screen-editor-tags-cell trends-settings-table__cell trends-settings-table__cell--actions">
                        <div className="trends-settings-table__actions">
                          <button type="button" className="workbench-button" onClick={() => moveSeriesTag(tag.tag, -1)} disabled={index === 0}>Up</button>
                          <button type="button" className="workbench-button" onClick={() => moveSeriesTag(tag.tag, 1)} disabled={index === draftSelectedTags.length - 1}>Down</button>
                          <button type="button" className="workbench-button workbench-button--danger" onClick={() => removeSeriesTag(tag.tag)}>Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === "toolbar" ? (
            <section className="trends-settings-section-table" role="tabpanel" aria-label="Toolbar settings">
              <div className="trends-settings-table-wrap">
                <div className="trends-settings-toolbar-table">
                  <div className="screen-editor-tags-row screen-editor-tags-row--header" style={{ gridTemplateColumns: "190px 82px minmax(220px, 1fr)" }}>
                    <div className="screen-editor-tags-cell screen-editor-tags-header-cell">Control</div>
                    <div className="screen-editor-tags-cell screen-editor-tags-header-cell">Visible</div>
                    <div className="screen-editor-tags-cell screen-editor-tags-header-cell">Description</div>
                  </div>
                  <div className="screen-editor-tags-row" style={{ gridTemplateColumns: "190px 82px minmax(220px, 1fr)" }}>
                    <div className="screen-editor-tags-cell">Menu button</div>
                    <div className="screen-editor-tags-cell"><input type="checkbox" checked={draftSettings.showToolbarMenuButton} onChange={(event) => patchSettings({ showToolbarMenuButton: event.target.checked })} /></div>
                    <div className="screen-editor-tags-cell">Open context actions.</div>
                  </div>
                  <div className="screen-editor-tags-row" style={{ gridTemplateColumns: "190px 82px minmax(220px, 1fr)" }}>
                    <div className="screen-editor-tags-cell">Add/Remove tags</div>
                    <div className="screen-editor-tags-cell"><input type="checkbox" checked={draftSettings.showToolbarTagsButton} onChange={(event) => patchSettings({ showToolbarTagsButton: event.target.checked })} /></div>
                    <div className="screen-editor-tags-cell">Open tag selection dialog.</div>
                  </div>
                  <div className="screen-editor-tags-row" style={{ gridTemplateColumns: "190px 82px minmax(220px, 1fr)" }}>
                    <div className="screen-editor-tags-cell">Live button</div>
                    <div className="screen-editor-tags-cell"><input type="checkbox" checked={draftSettings.showToolbarLiveButton} onChange={(event) => patchSettings({ showToolbarLiveButton: event.target.checked })} /></div>
                    <div className="screen-editor-tags-cell">Toggle live mode.</div>
                  </div>
                  <div className="screen-editor-tags-row" style={{ gridTemplateColumns: "190px 82px minmax(220px, 1fr)" }}>
                    <div className="screen-editor-tags-cell">Time range button</div>
                    <div className="screen-editor-tags-cell"><input type="checkbox" checked={draftSettings.showToolbarTimeRangeButton} onChange={(event) => patchSettings({ showToolbarTimeRangeButton: event.target.checked })} /></div>
                    <div className="screen-editor-tags-cell">Open custom range dialog.</div>
                  </div>
                  <div className="screen-editor-tags-row" style={{ gridTemplateColumns: "190px 82px minmax(220px, 1fr)" }}>
                    <div className="screen-editor-tags-cell">Quick ranges</div>
                    <div className="screen-editor-tags-cell"><input type="checkbox" checked={draftSettings.showToolbarQuickRangeButtons} onChange={(event) => patchSettings({ showToolbarQuickRangeButtons: event.target.checked })} /></div>
                    <div className="screen-editor-tags-cell">Show 5m / 15m / 1h buttons.</div>
                  </div>
                  <div className="screen-editor-tags-row" style={{ gridTemplateColumns: "190px 82px minmax(220px, 1fr)" }}>
                    <div className="screen-editor-tags-cell">Pan buttons</div>
                    <div className="screen-editor-tags-cell"><input type="checkbox" checked={draftSettings.showToolbarPanButtons} onChange={(event) => patchSettings({ showToolbarPanButtons: event.target.checked })} /></div>
                    <div className="screen-editor-tags-cell">Shift visible range left/right.</div>
                  </div>
                  <div className="screen-editor-tags-row" style={{ gridTemplateColumns: "190px 82px minmax(220px, 1fr)" }}>
                    <div className="screen-editor-tags-cell">Zoom buttons</div>
                    <div className="screen-editor-tags-cell"><input type="checkbox" checked={draftSettings.showToolbarZoomButtons} onChange={(event) => patchSettings({ showToolbarZoomButtons: event.target.checked })} /></div>
                    <div className="screen-editor-tags-cell">Zoom in and zoom out.</div>
                  </div>
                  <div className="screen-editor-tags-row" style={{ gridTemplateColumns: "190px 82px minmax(220px, 1fr)" }}>
                    <div className="screen-editor-tags-cell">Refresh button</div>
                    <div className="screen-editor-tags-cell"><input type="checkbox" checked={draftSettings.showToolbarRefreshButton} onChange={(event) => patchSettings({ showToolbarRefreshButton: event.target.checked })} /></div>
                    <div className="screen-editor-tags-cell">Reload chart data.</div>
                  </div>
                  <div className="screen-editor-tags-row" style={{ gridTemplateColumns: "190px 82px minmax(220px, 1fr)" }}>
                    <div className="screen-editor-tags-cell">Scale button</div>
                    <div className="screen-editor-tags-cell"><input type="checkbox" checked={draftSettings.showToolbarScaleButton} onChange={(event) => patchSettings({ showToolbarScaleButton: event.target.checked })} /></div>
                    <div className="screen-editor-tags-cell">Open axis scaling settings.</div>
                  </div>
                  <div className="screen-editor-tags-row" style={{ gridTemplateColumns: "190px 82px minmax(220px, 1fr)" }}>
                    <div className="screen-editor-tags-cell">Settings button</div>
                    <div className="screen-editor-tags-cell"><input type="checkbox" checked={draftSettings.showToolbarSettingsButton} onChange={(event) => patchSettings({ showToolbarSettingsButton: event.target.checked })} /></div>
                    <div className="screen-editor-tags-cell">Open appearance settings.</div>
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </TrendWorkbenchDialog>
  );
}
