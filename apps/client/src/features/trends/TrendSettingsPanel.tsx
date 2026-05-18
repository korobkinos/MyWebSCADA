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
  onClose: () => void;
  onSettingsChange: (next: TrendSettings) => void;
  onAxesChange: (next: TrendAxisConfig[]) => void;
  onSelectedTagsChange: (next: TrendTagSelection[]) => void;
};

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
  onClose,
  onSettingsChange,
  onAxesChange,
  onSelectedTagsChange,
}: TrendSettingsPanelProps) {
  const [draftSettings, setDraftSettings] = useState<TrendSettings>(settings);
  const [draftAxes, setDraftAxes] = useState<TrendAxisConfig[]>(axes);
  const [draftSelectedTags, setDraftSelectedTags] = useState<TrendTagSelection[]>(selectedTags);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraftSettings(settings);
    setDraftAxes(axes);
    setDraftSelectedTags(selectedTags);
  }, [axes, open, selectedTags, settings]);

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
      defaultRect={{ x: 180, y: 88, width: 680, height: 620 }}
      minWidth={560}
      minHeight={420}
      bodyClassName="trends-settings-dialog-body"
      footer={(
        <>
          <WorkbenchButton onClick={onClose}>Cancel</WorkbenchButton>
          <WorkbenchButton variant="primary" onClick={handleSave}>Save</WorkbenchButton>
        </>
      )}
      onClose={onClose}
    >
      <div className="trends-dialog__body">
        <section className="trends-settings-section">
          <h3>Appearance</h3>
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
            <Space.Compact style={{ width: "100%" }}>
              <ColorPicker
                size="small"
                value={normalizeHexColor(draftSettings.background, "#1e1e1e")}
                onChangeComplete={(color) => patchSettings({ background: color.toHexString() })}
              />
              <Input
                value={draftSettings.background}
                onChange={(event) => patchSettings({ background: event.target.value })}
                placeholder="#1e1e1e"
              />
            </Space.Compact>
          </label>
          <div className="trends-settings-grid">
            <label><input type="checkbox" checked={draftSettings.gridLines} onChange={(event) => patchSettings({ gridLines: event.target.checked })} /> Grid lines</label>
            <label><input type="checkbox" checked={draftSettings.axisLabels} onChange={(event) => patchSettings({ axisLabels: event.target.checked })} /> Axis labels</label>
            <label><input type="checkbox" checked={draftSettings.showSymbols} onChange={(event) => patchSettings({ showSymbols: event.target.checked })} /> Point symbols</label>
            <label><input type="checkbox" checked={draftSettings.showSeriesTable} onChange={(event) => patchSettings({ showSeriesTable: event.target.checked })} /> Show bottom table</label>
          </div>
        </section>

        <section className="trends-settings-section">
          <h3>Performance</h3>
          <div className="trends-settings-row">
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
          <div className="trends-settings-grid">
            <label><input type="checkbox" checked={draftSettings.progressive} onChange={(event) => patchSettings({ progressive: event.target.checked })} /> Progressive rendering</label>
            <label><input type="checkbox" checked={draftSettings.disableAnimationsLargeData} onChange={(event) => patchSettings({ disableAnimationsLargeData: event.target.checked })} /> Disable animation on large data</label>
            <label><input type="checkbox" checked={draftSettings.cacheEnabled} onChange={(event) => patchSettings({ cacheEnabled: event.target.checked })} /> Cache enabled</label>
          </div>
          <div className="trends-settings-row">
            <label className="workbench-field">
              <span className="workbench-field__label">Cache size</span>
              <input className="workbench-input" type="number" min={8} max={256} value={draftSettings.cacheSize} onChange={(event) => onNumericInput(event, (value) => patchSettings({ cacheSize: value }))} />
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Live buffer limit</span>
              <input className="workbench-input" type="number" min={200} max={20000} value={draftSettings.liveBufferLimit} onChange={(event) => onNumericInput(event, (value) => patchSettings({ liveBufferLimit: value }))} />
            </label>
          </div>
        </section>

        <section className="trends-settings-section">
          <h3>Axes</h3>
          <div className="trends-settings-grid">
            <label><input type="checkbox" checked={draftSettings.groupByUnit} onChange={(event) => patchSettings({ groupByUnit: event.target.checked })} /> Group by unit</label>
            <label><input type="checkbox" checked={draftSettings.separateAxisPerTag} onChange={(event) => patchSettings({ separateAxisPerTag: event.target.checked })} /> Separate axis per tag</label>
            <label><input type="checkbox" checked={draftSettings.autoScale} onChange={(event) => patchSettings({ autoScale: event.target.checked })} /> Auto scale</label>
          </div>
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
            <input className="workbench-input" type="number" min={24} max={120} value={draftSettings.axisOffsetStep} onChange={(event) => onNumericInput(event, (value) => patchSettings({ axisOffsetStep: value }))} />
          </label>
          <div className="trends-axis-table">
            {draftAxes.map((axis) => (
              <div key={axis.id} className="trends-axis-row">
                <span>{axis.id}</span>
                <input className="workbench-input" value={axis.name ?? ""} onChange={(event) => updateAxis(axis.id, { name: event.target.value })} placeholder="Axis name" />
                <select className="workbench-select" value={axis.position} onChange={(event) => updateAxis(axis.id, { position: event.target.value as TrendAxisConfig["position"] })}>
                  <option value="left">left</option>
                  <option value="right">right</option>
                </select>
              </div>
            ))}
          </div>
        </section>

        <section className="trends-settings-section">
          <h3>Series</h3>
          <div className="trends-series-table">
            {draftSelectedTags.map((tag) => (
              <div key={tag.tag} className="trends-series-row">
                <span>{tag.displayName || tag.tag}</span>
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
      </div>
    </TrendWorkbenchDialog>
  );
}
