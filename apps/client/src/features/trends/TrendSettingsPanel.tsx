import { type ChangeEvent, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { ColorPicker, Input, Space } from "antd";
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

const AXES_COLUMNS = [
  { id: "id", label: "Axis", width: 130, min: 100 },
  { id: "name", label: "Name", width: 150, min: 110 },
  { id: "position", label: "Side", width: 78, min: 68 },
  { id: "offset", label: "Offset", width: 66, min: 60 },
  { id: "min", label: "Min", width: 136, min: 122 },
  { id: "max", label: "Max", width: 136, min: 122 },
  { id: "labelSize", label: "Lbl Size", width: 76, min: 70 },
  { id: "labelGap", label: "Lbl Gap", width: 74, min: 68 },
  { id: "nameSize", label: "Name Size", width: 80, min: 72 },
  { id: "nameGap", label: "Name Gap", width: 78, min: 70 },
  { id: "padX", label: "Pad X", width: 66, min: 60 },
  { id: "padY", label: "Pad Y", width: 66, min: 60 },
  { id: "color", label: "Color", width: 110, min: 92 },
  { id: "used", label: "Used", width: 58, min: 52 },
  { id: "actions", label: "", width: 84, min: 74 },
] as const;

const SERIES_COLUMNS = [
  { id: "visible", label: "On", width: 52, min: 44 },
  { id: "tag", label: "Tag", width: 210, min: 140 },
  { id: "displayName", label: "Display Name", width: 190, min: 130 },
  { id: "color", label: "Color", width: 120, min: 100 },
  { id: "mode", label: "Mode", width: 96, min: 82 },
  { id: "lineWidth", label: "Width", width: 70, min: 64 },
  { id: "axis", label: "Axis", width: 170, min: 120 },
] as const;

type AxisColumnId = (typeof AXES_COLUMNS)[number]["id"];
type SeriesColumnId = (typeof SERIES_COLUMNS)[number]["id"];
type AxisColumnWidths = Record<AxisColumnId, number>;
type SeriesColumnWidths = Record<SeriesColumnId, number>;

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
  const [axisColumnWidths, setAxisColumnWidths] = useState<AxisColumnWidths>(() => defaultAxisColumnWidths());
  const [seriesColumnWidths, setSeriesColumnWidths] = useState<SeriesColumnWidths>(() => defaultSeriesColumnWidths());
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
  }, [axes, initialTab, open, selectedTags, settings]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const axisState = axisResizeStateRef.current;
      if (axisState.id) {
        const config = AXES_COLUMNS.find((column) => column.id === axisState.id);
        if (!config) {
          return;
        }
        const delta = event.clientX - axisState.startX;
        const nextWidth = Math.max(config.min, Math.round(axisState.startWidth + delta));
        setAxisColumnWidths((prev) => ({ ...prev, [axisState.id as AxisColumnId]: nextWidth }));
      }
      const seriesState = seriesResizeStateRef.current;
      if (seriesState.id) {
        const config = SERIES_COLUMNS.find((column) => column.id === seriesState.id);
        if (!config) {
          return;
        }
        const delta = event.clientX - seriesState.startX;
        const nextWidth = Math.max(config.min, Math.round(seriesState.startWidth + delta));
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

  const axisTemplate = AXES_COLUMNS.map((column) => `${Math.round(axisColumnWidths[column.id])}px`).join(" ");
  const seriesTemplate = SERIES_COLUMNS.map((column) => `${Math.round(seriesColumnWidths[column.id])}px`).join(" ");

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
      defaultRect={{ x: 120, y: 70, width: 1320, height: 640 }}
      minWidth={1020}
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
        <div className="trends-settings-tabs" role="tablist" aria-label="Trend settings sections">
          <button type="button" role="tab" aria-selected={activeTab === "appearance"} className={`trends-settings-tab ${activeTab === "appearance" ? "trends-settings-tab--active" : ""}`} onClick={() => setActiveTab("appearance")}>Appearance</button>
          <button type="button" role="tab" aria-selected={activeTab === "performance"} className={`trends-settings-tab ${activeTab === "performance" ? "trends-settings-tab--active" : ""}`} onClick={() => setActiveTab("performance")}>Data / Performance</button>
          <button type="button" role="tab" aria-selected={activeTab === "axes"} className={`trends-settings-tab ${activeTab === "axes" ? "trends-settings-tab--active" : ""}`} onClick={() => setActiveTab("axes")}>Axes</button>
          <button type="button" role="tab" aria-selected={activeTab === "series"} className={`trends-settings-tab ${activeTab === "series" ? "trends-settings-tab--active" : ""}`} onClick={() => setActiveTab("series")}>Series</button>
          <button type="button" role="tab" aria-selected={activeTab === "toolbar"} className={`trends-settings-tab ${activeTab === "toolbar" ? "trends-settings-tab--active" : ""}`} onClick={() => setActiveTab("toolbar")}>Toolbar</button>
        </div>

        {activeTab === "appearance" ? (
          <section className="trends-settings-section">
            <h3>Appearance</h3>
            <p className="trends-settings-helper">Theme controls chart, toolbar, status bar, table, and menu palette.</p>
            <div className="trends-settings-fields trends-settings-fields--two-col">
              <label className="workbench-field">
                <span className="workbench-field__label">Theme</span>
                <select className="workbench-select" value={draftSettings.theme} onChange={(event) => patchSettings({ theme: event.target.value as TrendSettings["theme"] })}>
                  <option value="workbench-dark">Workbench dark</option>
                  <option value="echarts-dark">ECharts dark</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label className="workbench-field" title="Background is applied only for Custom theme.">
                <span className="workbench-field__label">Background (Custom only)</span>
                <Space.Compact style={{ width: "100%" }}>
                  <ColorPicker
                    size="small"
                    value={normalizeHexColor(draftSettings.background, "#1e1e1e")}
                    disabled={draftSettings.theme !== "custom"}
                    onChangeComplete={(color) => patchSettings({ background: color.toHexString() })}
                  />
                  <Input
                    value={draftSettings.background}
                    disabled={draftSettings.theme !== "custom"}
                    onChange={(event) => patchSettings({ background: event.target.value })}
                    placeholder="#1e1e1e"
                  />
                </Space.Compact>
              </label>
            </div>
            <div className="trends-settings-grid">
              <label title="Show/hide X/Y grid lines."><input type="checkbox" checked={draftSettings.gridLines} onChange={(event) => patchSettings({ gridLines: event.target.checked })} /> Grid lines</label>
              <label title="Show/hide axis labels."><input type="checkbox" checked={draftSettings.axisLabels} onChange={(event) => patchSettings({ axisLabels: event.target.checked })} /> Axis labels</label>
              <label title="Show point markers for series."><input type="checkbox" checked={draftSettings.showSymbols} onChange={(event) => patchSettings({ showSymbols: event.target.checked })} /> Point symbols</label>
              <label title="Show/hide bottom live values table."><input type="checkbox" checked={draftSettings.showSeriesTable} onChange={(event) => patchSettings({ showSeriesTable: event.target.checked })} /> Show bottom table</label>
            </div>
            <div className="trends-settings-fields trends-settings-fields--two-col">
              <label className="workbench-field">
                <span className="workbench-field__label">Bottom table rows</span>
                <input
                  className="workbench-input"
                  type="number"
                  min={2}
                  max={24}
                  value={draftSettings.seriesTableRows}
                  onChange={(event) => onNumericInput(event, (value) => patchSettings({ seriesTableRows: Math.max(2, Math.min(24, Math.round(value))) }))}
                />
              </label>
            </div>
          </section>
        ) : null}

        {activeTab === "performance" ? (
          <section className="trends-settings-section">
            <h3>Data / Performance</h3>
            <p className="trends-settings-helper">Live mode always requests raw data regardless of aggregation.</p>
            <div className="trends-settings-fields trends-settings-fields--two-col">
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
              <label className="workbench-field">
                <span className="workbench-field__label">Cache size</span>
                <input className="workbench-input" type="number" min={8} max={256} value={draftSettings.cacheSize} onChange={(event) => onNumericInput(event, (value) => patchSettings({ cacheSize: value }))} />
              </label>
              <label className="workbench-field">
                <span className="workbench-field__label">Live buffer limit</span>
                <input className="workbench-input" type="number" min={200} max={20000} value={draftSettings.liveBufferLimit} onChange={(event) => onNumericInput(event, (value) => patchSettings({ liveBufferLimit: value }))} />
              </label>
            </div>
            <div className="trends-settings-grid">
              <label title="Use ECharts progressive rendering for large datasets."><input type="checkbox" checked={draftSettings.progressive} onChange={(event) => patchSettings({ progressive: event.target.checked })} /> Progressive rendering</label>
              <label title="Disable animations when data volume is large."><input type="checkbox" checked={draftSettings.disableAnimationsLargeData} onChange={(event) => patchSettings({ disableAnimationsLargeData: event.target.checked })} /> Disable animation on large data</label>
              <label title="Enable cached trend query responses."><input type="checkbox" checked={draftSettings.cacheEnabled} onChange={(event) => patchSettings({ cacheEnabled: event.target.checked })} /> Cache enabled</label>
            </div>
          </section>
        ) : null}

        {activeTab === "axes" ? (
          <section className="trends-settings-section trends-settings-section--axes">
            <h3>Axes</h3>
            <p className="trends-settings-helper">Tag goes to Default axis on add. Create extra axes and assign them in Series tab.</p>
            <div className="trends-settings-fields trends-settings-fields--two-col">
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
                    <div className="screen-editor-tags-cell trends-settings-table__cell">
                      <input className="workbench-input" value={axis.color ?? ""} onChange={(event) => updateAxis(axis.id, { color: event.target.value })} placeholder="#4FC3F7" />
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
          <section className="trends-settings-section trends-settings-section--series">
            <h3>Series</h3>
            <p className="trends-settings-helper">Assign axis per tag and adjust series style.</p>
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
                {draftSelectedTags.map((tag) => (
                  <div key={tag.tag} className="screen-editor-tags-row trends-settings-table__row" style={{ gridTemplateColumns: seriesTemplate }}>
                    <div className="screen-editor-tags-cell trends-settings-table__cell">
                      <input type="checkbox" checked={tag.visible !== false} onChange={(event) => updateSeries(tag.tag, { visible: event.target.checked })} />
                    </div>
                    <div className="screen-editor-tags-cell trends-settings-table__cell" title={tag.tag}>{tag.tag}</div>
                    <div className="screen-editor-tags-cell trends-settings-table__cell">
                      <input className="workbench-input" value={tag.displayName ?? ""} onChange={(event) => updateSeries(tag.tag, { displayName: event.target.value })} />
                    </div>
                    <div className="screen-editor-tags-cell trends-settings-table__cell">
                      <Space.Compact style={{ width: "100%" }}>
                        <ColorPicker
                          size="small"
                          value={normalizeHexColor(tag.color, "#4FC3F7")}
                          onChangeComplete={(color) => updateSeries(tag.tag, { color: color.toHexString() })}
                        />
                        <Input value={tag.color ?? ""} onChange={(event) => updateSeries(tag.tag, { color: event.target.value })} placeholder="#4FC3F7" />
                      </Space.Compact>
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
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "toolbar" ? (
          <section className="trends-settings-section">
            <h3>Toolbar</h3>
            <p className="trends-settings-helper">Toggle visibility of chart toolbar controls.</p>
            <div className="trends-settings-grid">
              <label><input type="checkbox" checked={draftSettings.showToolbarMenuButton} onChange={(event) => patchSettings({ showToolbarMenuButton: event.target.checked })} /> Menu button</label>
              <label><input type="checkbox" checked={draftSettings.showToolbarTagsButton} onChange={(event) => patchSettings({ showToolbarTagsButton: event.target.checked })} /> Add/Remove tags</label>
              <label><input type="checkbox" checked={draftSettings.showToolbarLiveButton} onChange={(event) => patchSettings({ showToolbarLiveButton: event.target.checked })} /> Live button</label>
              <label><input type="checkbox" checked={draftSettings.showToolbarTimeRangeButton} onChange={(event) => patchSettings({ showToolbarTimeRangeButton: event.target.checked })} /> Time range button</label>
              <label><input type="checkbox" checked={draftSettings.showToolbarQuickRangeButtons} onChange={(event) => patchSettings({ showToolbarQuickRangeButtons: event.target.checked })} /> Quick ranges</label>
              <label><input type="checkbox" checked={draftSettings.showToolbarPanButtons} onChange={(event) => patchSettings({ showToolbarPanButtons: event.target.checked })} /> Pan buttons</label>
              <label><input type="checkbox" checked={draftSettings.showToolbarZoomButtons} onChange={(event) => patchSettings({ showToolbarZoomButtons: event.target.checked })} /> Zoom buttons</label>
              <label><input type="checkbox" checked={draftSettings.showToolbarRefreshButton} onChange={(event) => patchSettings({ showToolbarRefreshButton: event.target.checked })} /> Refresh button</label>
              <label><input type="checkbox" checked={draftSettings.showToolbarScaleButton} onChange={(event) => patchSettings({ showToolbarScaleButton: event.target.checked })} /> Scale button</label>
              <label><input type="checkbox" checked={draftSettings.showToolbarSettingsButton} onChange={(event) => patchSettings({ showToolbarSettingsButton: event.target.checked })} /> Settings button</label>
            </div>
          </section>
        ) : null}
      </div>
    </TrendWorkbenchDialog>
  );
}
