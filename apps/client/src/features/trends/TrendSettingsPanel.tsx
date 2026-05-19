import { type ChangeEvent, useEffect, useState } from "react";
import { ColorPicker, Input, Space } from "antd";
import { WorkbenchButton } from "../../components/workbench";
import type { TrendAxisConfig, TrendSettings, TrendTagSelection } from "./trendTypes";
import { TrendWorkbenchDialog } from "./TrendWorkbenchDialog";

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
  const [draftAxes, setDraftAxes] = useState<TrendAxisConfig[]>(axes);
  const [draftSelectedTags, setDraftSelectedTags] = useState<TrendTagSelection[]>(selectedTags);
  const [activeTab, setActiveTab] = useState<TrendSettingsTab>("appearance");

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraftSettings(settings);
    setDraftAxes(axes);
    setDraftSelectedTags(selectedTags);
    setActiveTab(initialTab ?? "appearance");
  }, [axes, initialTab, open, selectedTags, settings]);

  if (!open) {
    return null;
  }

  const patchSettings = (patch: Partial<TrendSettings>) => {
    setDraftSettings((prev) => ({ ...prev, ...patch }));
  };

  const updateAxis = (axisId: string, patch: Partial<TrendAxisConfig>) => {
    setDraftAxes((prev) => prev.map((axis) => (axis.id === axisId ? { ...axis, ...patch } : axis)));
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

  const handleSave = () => {
    onSettingsChange(draftSettings);
    onAxesChange(draftAxes);
    onSelectedTagsChange(draftSelectedTags);
    onClose();
  };

  return (
    <TrendWorkbenchDialog
      id="trend-settings-dialog"
      title="Trend Settings"
      open={open}
      defaultRect={{ x: 160, y: 80, width: 860, height: 520 }}
      minWidth={760}
      minHeight={450}
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
          <section className="trends-settings-section">
            <h3>Axes</h3>
            <p className="trends-settings-helper">Auto scale keeps axis dynamic. Disable Min/Max auto to set fixed bounds.</p>
            <div className="trends-settings-grid">
              <label><input type="checkbox" checked={draftSettings.groupByUnit} onChange={(event) => patchSettings({ groupByUnit: event.target.checked })} /> Group by unit</label>
              <label><input type="checkbox" checked={draftSettings.separateAxisPerTag} onChange={(event) => patchSettings({ separateAxisPerTag: event.target.checked })} /> Separate axis per tag</label>
              <label><input type="checkbox" checked={draftSettings.autoScale} onChange={(event) => patchSettings({ autoScale: event.target.checked })} /> Auto scale</label>
            </div>
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
            <p className="trends-settings-helper">Scale limits per axis are below: Min/Max auto or fixed numeric values.</p>
            <div className="trends-axis-table">
              {draftAxes.map((axis) => (
                <div key={axis.id} className="trends-axis-row">
                  <span className="trends-axis-row__id" title={axis.id}>{axis.id}</span>
                  <input className="workbench-input" value={axis.name ?? ""} onChange={(event) => updateAxis(axis.id, { name: event.target.value })} placeholder="Axis name" />
                  <select className="workbench-select" value={axis.position} onChange={(event) => updateAxis(axis.id, { position: event.target.value as TrendAxisConfig["position"] })}>
                    <option value="left">left</option>
                    <option value="right">right</option>
                  </select>
                  <div className="trends-axis-bound">
                    <label className="screen-editor-settings-check">
                      <input type="checkbox" checked={axis.min === "auto" || axis.min === undefined} onChange={(event) => updateAxis(axis.id, { min: event.target.checked ? "auto" : 0 })} />
                      <span>Min auto</span>
                    </label>
                    <input
                      className="workbench-input"
                      type="number"
                      disabled={axis.min === "auto" || axis.min === undefined}
                      value={axis.min === "auto" || axis.min === undefined ? "" : axis.min}
                      onChange={(event) => {
                        const parsed = parseNumber(event.target.value);
                        if (parsed === undefined) {
                          return;
                        }
                        updateAxis(axis.id, { min: parsed });
                      }}
                      placeholder="Min"
                    />
                  </div>
                  <div className="trends-axis-bound">
                    <label className="screen-editor-settings-check">
                      <input type="checkbox" checked={axis.max === "auto" || axis.max === undefined} onChange={(event) => updateAxis(axis.id, { max: event.target.checked ? "auto" : 100 })} />
                      <span>Max auto</span>
                    </label>
                    <input
                      className="workbench-input"
                      type="number"
                      disabled={axis.max === "auto" || axis.max === undefined}
                      value={axis.max === "auto" || axis.max === undefined ? "" : axis.max}
                      onChange={(event) => {
                        const parsed = parseNumber(event.target.value);
                        if (parsed === undefined) {
                          return;
                        }
                        updateAxis(axis.id, { max: parsed });
                      }}
                      placeholder="Max"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {activeTab === "series" ? (
          <section className="trends-settings-section">
            <h3>Series</h3>
            <p className="trends-settings-helper">Series settings are applied to line style and visibility.</p>
            <div className="trends-series-settings-list">
              {draftSelectedTags.map((tag) => (
                <div key={tag.tag} className="trends-series-settings-row">
                  <span className="trends-series-settings-row__name" title={tag.displayName || tag.tag}>{tag.displayName || tag.tag}</span>
                  <Space.Compact style={{ width: "100%" }}>
                    <ColorPicker
                      size="small"
                      value={normalizeHexColor(tag.color, "#4FC3F7")}
                      onChangeComplete={(color) => updateSeries(tag.tag, { color: color.toHexString() })}
                    />
                    <Input
                      value={tag.color || ""}
                      onChange={(event) => updateSeries(tag.tag, { color: event.target.value })}
                      placeholder="#4FC3F7"
                    />
                  </Space.Compact>
                  <select className="workbench-select" value={tag.mode ?? "line"} onChange={(event) => updateSeries(tag.tag, { mode: event.target.value as TrendTagSelection["mode"] })}>
                    <option value="line">line</option>
                    <option value="step">step</option>
                    <option value="points">points</option>
                  </select>
                  <input className="workbench-input" type="number" min={1} max={5} value={tag.lineWidth ?? draftSettings.defaultLineWidth} onChange={(event) => onNumericInput(event, (value) => updateSeries(tag.tag, { lineWidth: value }))} />
                  <label><input type="checkbox" checked={tag.visible !== false} onChange={(event) => updateSeries(tag.tag, { visible: event.target.checked })} /> visible</label>
                </div>
              ))}
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
