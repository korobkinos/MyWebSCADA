import type { EventTableObject } from "@web-scada/shared";
import { useMemo, useState } from "react";
import { DEFAULT_EVENT_TABLE_COLUMN_LABELS, type EventTableColumnId } from "./event-table-columns";
import { resolveEventTableConfig } from "./event-table-config";
import { TrendWorkbenchDialog } from "../trends/TrendWorkbenchDialog";
import { WorkbenchButton } from "../../components/workbench";

type EventTableSettingsDialogProps = {
  open: boolean;
  object: EventTableObject;
  onClose: () => void;
  onPatch: (patch: Partial<EventTableObject>) => void;
};

type SettingsTab = "general" | "columns" | "appearance" | "toolbar" | "sound" | "status" | "history";

const SETTINGS_NAV_ITEMS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "columns", label: "Columns" },
  { id: "appearance", label: "Appearance" },
  { id: "toolbar", label: "Toolbar" },
  { id: "sound", label: "Sound" },
  { id: "status", label: "Status" },
  { id: "history", label: "History" },
];

const DEFAULT_COLUMNS: EventTableColumnId[] = [
  "timestamp",
  "priority",
  "category",
  "message",
  "source",
  "value",
  "state",
  "ack",
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeNumber(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(Math.round(parsed), min, max);
}

function parseOptionalMillis(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(0, Math.round(parsed));
}

export function EventTableSettingsDialog({ open, object, onClose, onPatch }: EventTableSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const resolved = resolveEventTableConfig(object);
  const visibleColumns = resolved.columns;
  const allColumns = useMemo(
    () => Array.from(new Set([...DEFAULT_COLUMNS, ...visibleColumns])) as EventTableColumnId[],
    [visibleColumns],
  );

  const patchColumnVisibility = (column: EventTableColumnId, visible: boolean) => {
    const current = object.columns && object.columns.length > 0 ? object.columns : [...DEFAULT_COLUMNS];
    const next = visible
      ? (current.includes(column) ? current : [...current, column])
      : current.filter((item) => item !== column);
    onPatch({ columns: next.length > 0 ? next : [column] });
  };

  const patchColumnWidth = (column: EventTableColumnId, value: string) => {
    const nextWidths = { ...(object.columnWidths ?? {}) };
    if (!value.trim()) {
      delete nextWidths[column];
      onPatch({ columnWidths: nextWidths });
      return;
    }
    nextWidths[column] = normalizeNumber(value, 120, 40, 1400);
    onPatch({ columnWidths: nextWidths });
  };

  const patchColumnAlign = (column: EventTableColumnId, align: "left" | "center" | "right") => {
    onPatch({
      columnAlignments: {
        ...(object.columnAlignments ?? {}),
        [column]: align,
      },
    });
  };

  const content = (() => {
    if (activeTab === "general") {
      return (
        <div className="event-table-settings-fields event-table-settings-fields--two-col">
          <label className="workbench-field">
            <span className="workbench-field__label">Title</span>
            <input className="workbench-input" value={object.title ?? ""} onChange={(event) => onPatch({ title: event.target.value })} />
          </label>
          <label className="workbench-field">
            <span className="workbench-field__label">Mode</span>
            <select className="workbench-select" value={object.mode ?? (object.enableHistoryMode ? "history" : "online")} onChange={(event) => onPatch({ mode: event.target.value as "online" | "history", enableHistoryMode: event.target.value === "history" })}>
              <option value="online">online</option>
              <option value="history">history</option>
            </select>
          </label>
          <label className="workbench-field">
            <span className="workbench-field__label">Max Rows</span>
            <input className="workbench-input" type="number" min={1} max={10000} value={object.maxRows ?? 100} onChange={(event) => onPatch({ maxRows: normalizeNumber(event.target.value, 100, 1, 10000) })} />
          </label>
          <label className="workbench-field">
            <span className="workbench-field__label">Title Position</span>
            <select className="workbench-select" value={object.titlePosition ?? (object.showTitle === false ? "hidden" : "top")} onChange={(event) => onPatch({ titlePosition: event.target.value as EventTableObject["titlePosition"] })}>
              <option value="top">top</option>
              <option value="bottom">bottom</option>
              <option value="hidden">hidden</option>
            </select>
          </label>
          <label className="workbench-field">
            <span className="workbench-field__label">Title Align</span>
            <select className="workbench-select" value={object.titleAlign ?? "left"} onChange={(event) => onPatch({ titleAlign: event.target.value as EventTableObject["titleAlign"] })}>
              <option value="left">left</option>
              <option value="center">center</option>
              <option value="right">right</option>
            </select>
          </label>
          <label className="workbench-field">
            <span className="workbench-field__label">Show Cleared</span>
            <input type="checkbox" checked={object.showCleared === true} onChange={(event) => onPatch({ showCleared: event.target.checked })} />
          </label>
          <label className="workbench-field">
            <span className="workbench-field__label">Show Active Only</span>
            <input type="checkbox" checked={object.showActiveOnly === true} onChange={(event) => onPatch({ showActiveOnly: event.target.checked })} />
          </label>
          <label className="workbench-field">
            <span className="workbench-field__label">Show Unacknowledged Only</span>
            <input type="checkbox" checked={object.showUnacknowledgedOnly === true} onChange={(event) => onPatch({ showUnacknowledgedOnly: event.target.checked })} />
          </label>
        </div>
      );
    }

    if (activeTab === "columns") {
      return (
        <div className="event-table-settings-columns">
          {allColumns.map((column) => {
            const isVisible = visibleColumns.includes(column);
            const width = object.columnWidths?.[column];
            const alignment = object.columnAlignments?.[column] ?? object.cellTextAlign ?? "left";
            return (
              <div key={column} className="event-table-settings-columns__row">
                <div className="event-table-settings-columns__top">
                  <label className="screen-editor-settings-check">
                    <input type="checkbox" checked={isVisible} onChange={(event) => patchColumnVisibility(column, event.target.checked)} />
                    <span>{DEFAULT_EVENT_TABLE_COLUMN_LABELS[column]}</span>
                  </label>
                </div>
                <div className="event-table-settings-fields event-table-settings-fields--three-col">
                  <label className="workbench-field">
                    <span className="workbench-field__label">Label</span>
                    <input
                      className="workbench-input"
                      value={object.columnLabels?.[column] ?? ""}
                      onChange={(event) => onPatch({
                        columnLabels: {
                          ...(object.columnLabels ?? {}),
                          [column]: event.target.value,
                        },
                      })}
                    />
                  </label>
                  <label className="workbench-field">
                    <span className="workbench-field__label">Width</span>
                    <input
                      className="workbench-input"
                      type="number"
                      min={40}
                      max={1400}
                      value={typeof width === "number" ? width : ""}
                      onChange={(event) => patchColumnWidth(column, event.target.value)}
                    />
                  </label>
                  <label className="workbench-field">
                    <span className="workbench-field__label">Align</span>
                    <select className="workbench-select" value={alignment} onChange={(event) => patchColumnAlign(column, event.target.value as "left" | "center" | "right")}>
                      <option value="left">left</option>
                      <option value="center">center</option>
                      <option value="right">right</option>
                    </select>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (activeTab === "appearance") {
      return (
        <div className="event-table-settings-fields event-table-settings-fields--three-col">
          <label className="workbench-field"><span className="workbench-field__label">Font Size</span><input className="workbench-input" type="number" min={8} max={28} value={object.fontSize ?? 12} onChange={(event) => onPatch({ fontSize: normalizeNumber(event.target.value, 12, 8, 28) })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Title Font Size</span><input className="workbench-input" type="number" min={8} max={28} value={object.titleFontSize ?? 13} onChange={(event) => onPatch({ titleFontSize: normalizeNumber(event.target.value, 13, 8, 28) })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Title Height</span><input className="workbench-input" type="number" min={16} max={80} value={object.titleHeight ?? 28} onChange={(event) => onPatch({ titleHeight: normalizeNumber(event.target.value, 28, 16, 80) })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Row Height</span><input className="workbench-input" type="number" min={18} max={80} value={object.rowHeight ?? 26} onChange={(event) => onPatch({ rowHeight: normalizeNumber(event.target.value, 26, 18, 80) })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Header Height</span><input className="workbench-input" type="number" min={18} max={80} value={object.headerHeight ?? 28} onChange={(event) => onPatch({ headerHeight: normalizeNumber(event.target.value, 28, 18, 80) })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Cell Padding</span><input className="workbench-input" type="number" min={2} max={24} value={object.cellPadding ?? 8} onChange={(event) => onPatch({ cellPadding: normalizeNumber(event.target.value, 8, 2, 24) })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Text Align</span><select className="workbench-select" value={object.cellTextAlign ?? "left"} onChange={(event) => onPatch({ cellTextAlign: event.target.value as EventTableObject["cellTextAlign"] })}><option value="left">left</option><option value="center">center</option><option value="right">right</option></select></label>
          <label className="workbench-field"><span className="workbench-field__label">Border Width</span><input className="workbench-input" type="number" min={0} max={6} value={object.borderWidth ?? 1} onChange={(event) => onPatch({ borderWidth: normalizeNumber(event.target.value, 1, 0, 6) })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Border Radius</span><input className="workbench-input" type="number" min={0} max={32} value={object.borderRadius ?? 6} onChange={(event) => onPatch({ borderRadius: normalizeNumber(event.target.value, 6, 0, 32) })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Background</span><input className="workbench-input" value={object.backgroundColor ?? "#1f2328"} onChange={(event) => onPatch({ backgroundColor: event.target.value })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Header Background</span><input className="workbench-input" value={object.headerBackgroundColor ?? "#2a3038"} onChange={(event) => onPatch({ headerBackgroundColor: event.target.value })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Header Text</span><input className="workbench-input" value={object.headerTextColor ?? "#ced8df"} onChange={(event) => onPatch({ headerTextColor: event.target.value })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Text Color</span><input className="workbench-input" value={object.textColor ?? "#d6d6d6"} onChange={(event) => onPatch({ textColor: event.target.value })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Muted Text</span><input className="workbench-input" value={object.mutedTextColor ?? "#9ea6ad"} onChange={(event) => onPatch({ mutedTextColor: event.target.value })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Grid Line</span><input className="workbench-input" value={object.gridLineColor ?? "#30363d"} onChange={(event) => onPatch({ gridLineColor: event.target.value })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Title Text</span><input className="workbench-input" value={object.titleTextColor ?? "#ced8df"} onChange={(event) => onPatch({ titleTextColor: event.target.value })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Title Background</span><input className="workbench-input" value={object.titleBackgroundColor ?? "#2a3038"} onChange={(event) => onPatch({ titleBackgroundColor: event.target.value })} /></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.showHeader !== false} onChange={(event) => onPatch({ showHeader: event.target.checked })} /><span>Show header</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.showGridLines !== false} onChange={(event) => onPatch({ showGridLines: event.target.checked })} /><span>Show grid lines</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.zebraRows !== false} onChange={(event) => onPatch({ zebraRows: event.target.checked })} /><span>Zebra rows</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.compactMode === true} onChange={(event) => onPatch({ compactMode: event.target.checked })} /><span>Compact mode</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.transparentBackground === true} onChange={(event) => onPatch({ transparentBackground: event.target.checked })} /><span>Transparent background</span></label>
        </div>
      );
    }

    if (activeTab === "toolbar") {
      return (
        <div className="event-table-settings-fields event-table-settings-fields--two-col">
          <label className="workbench-field"><span className="workbench-field__label">Toolbar Position</span><select className="workbench-select" value={object.toolbarPosition ?? (object.showToolbar === false ? "hidden" : "top")} onChange={(event) => onPatch({ toolbarPosition: event.target.value as EventTableObject["toolbarPosition"] })}><option value="top">top</option><option value="bottom">bottom</option><option value="hidden">hidden</option></select></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.showToolbar !== false} onChange={(event) => onPatch({ showToolbar: event.target.checked })} /><span>Show toolbar</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={resolved.showSearch} onChange={(event) => onPatch({ showSearch: event.target.checked })} /><span>Show search</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={resolved.showActiveOnlyToggle} onChange={(event) => onPatch({ showActiveOnlyToggle: event.target.checked })} /><span>Show active-only toggle</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={resolved.showUnackedOnlyToggle} onChange={(event) => onPatch({ showUnackedOnlyToggle: event.target.checked })} /><span>Show unacked-only toggle</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={resolved.showAckVisibleButton} onChange={(event) => onPatch({ showAckVisibleButton: event.target.checked })} /><span>Show Ack visible button</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={resolved.showSilenceButton} onChange={(event) => onPatch({ showSilenceButton: event.target.checked })} /><span>Show Silence button</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={resolved.showEnableSoundsButton} onChange={(event) => onPatch({ showEnableSoundsButton: event.target.checked })} /><span>Show Enable sounds button</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={resolved.showSettingsButton} onChange={(event) => onPatch({ showSettingsButton: event.target.checked })} /><span>Show settings button</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={resolved.showCsvExportButton} onChange={(event) => onPatch({ showCsvExportButton: event.target.checked })} /><span>Show CSV export button</span></label>
        </div>
      );
    }

    if (activeTab === "sound") {
      return (
        <div className="event-table-settings-fields event-table-settings-fields--two-col">
          <label className="workbench-field"><span className="workbench-field__label">Playback Mode</span><select className="workbench-select" value={object.soundPlaybackMode ?? "once"} onChange={(event) => onPatch({ soundPlaybackMode: event.target.value as EventTableObject["soundPlaybackMode"] })}><option value="once">once</option><option value="loopUntilAcknowledged">loopUntilAcknowledged</option></select></label>
          <label className="workbench-field"><span className="workbench-field__label">Repeat interval (ms)</span><input className="workbench-input" type="number" min={1000} max={60000} value={object.soundRepeatIntervalMs ?? 5000} onChange={(event) => onPatch({ soundRepeatIntervalMs: normalizeNumber(event.target.value, 5000, 1000, 60000) })} /></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.stopSoundOnAck !== false} onChange={(event) => onPatch({ stopSoundOnAck: event.target.checked })} /><span>Stop sound on Ack</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.stopSoundOnSilence !== false} onChange={(event) => onPatch({ stopSoundOnSilence: event.target.checked })} /><span>Stop sound on Silence</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.enableSoundFallbackByPriority !== false} onChange={(event) => onPatch({ enableSoundFallbackByPriority: event.target.checked })} /><span>Enable fallback by priority</span></label>
          <label className="workbench-field"><span className="workbench-field__label">Fallback notification sound id</span><input className="workbench-input" value={object.fallbackNotificationSoundId ?? ""} onChange={(event) => onPatch({ fallbackNotificationSoundId: event.target.value })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Fallback warning sound id</span><input className="workbench-input" value={object.fallbackWarningSoundId ?? ""} onChange={(event) => onPatch({ fallbackWarningSoundId: event.target.value })} /></label>
          <label className="workbench-field"><span className="workbench-field__label">Fallback alarm sound id</span><input className="workbench-input" value={object.fallbackAlarmSoundId ?? ""} onChange={(event) => onPatch({ fallbackAlarmSoundId: event.target.value })} /></label>
        </div>
      );
    }

    if (activeTab === "status") {
      return (
        <div className="event-table-settings-fields event-table-settings-fields--two-col">
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.showStatusBar !== false} onChange={(event) => onPatch({ showStatusBar: event.target.checked })} /><span>Show status bar</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.statusSingleLine !== false} onChange={(event) => onPatch({ statusSingleLine: event.target.checked })} /><span>Status single line</span></label>
          <label className="workbench-field"><span className="workbench-field__label">Status Position</span><select className="workbench-select" value={object.statusPosition ?? "bottom"} onChange={(event) => onPatch({ statusPosition: event.target.value as EventTableObject["statusPosition"] })}><option value="top">top</option><option value="bottom">bottom</option><option value="hidden">hidden</option></select></label>
          <label className="workbench-field"><span className="workbench-field__label">Status Style</span><select className="workbench-select" value={object.statusStyle ?? "archiveLike"} onChange={(event) => onPatch({ statusStyle: event.target.value as EventTableObject["statusStyle"] })}><option value="archiveLike">archiveLike</option><option value="compact">compact</option><option value="hidden">hidden</option></select></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.showLastUpdate !== false} onChange={(event) => onPatch({ showLastUpdate: event.target.checked })} /><span>Show last update</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.showRecordCount !== false} onChange={(event) => onPatch({ showRecordCount: event.target.checked })} /><span>Show record count</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.showDatabaseStatus !== false} onChange={(event) => onPatch({ showDatabaseStatus: event.target.checked })} /><span>Show database status</span></label>
          <label className="screen-editor-settings-check"><input type="checkbox" checked={object.showModeIndicator !== false} onChange={(event) => onPatch({ showModeIndicator: event.target.checked })} /><span>Show mode indicator</span></label>
        </div>
      );
    }

    return (
      <div className="event-table-settings-fields event-table-settings-fields--two-col">
        <label className="screen-editor-settings-check"><input type="checkbox" checked={object.enableHistoryMode === true} onChange={(event) => onPatch({ enableHistoryMode: event.target.checked, mode: event.target.checked ? "history" : "online" })} /><span>Enable history mode</span></label>
        <label className="screen-editor-settings-check"><input type="checkbox" checked={object.enableCsvExport !== false} onChange={(event) => onPatch({ enableCsvExport: event.target.checked })} /><span>Enable CSV export</span></label>
        <label className="screen-editor-settings-check"><input type="checkbox" checked={object.showHistoryToolbar !== false} onChange={(event) => onPatch({ showHistoryToolbar: event.target.checked })} /><span>Show history toolbar</span></label>
        <label className="screen-editor-settings-check"><input type="checkbox" checked={object.serverSidePagination !== false} onChange={(event) => onPatch({ serverSidePagination: event.target.checked })} /><span>Server-side pagination</span></label>
        <label className="workbench-field"><span className="workbench-field__label">History preset</span><select className="workbench-select" value={object.historyPeriodPreset ?? "lastHour"} onChange={(event) => onPatch({ historyPeriodPreset: event.target.value as EventTableObject["historyPeriodPreset"] })}><option value="lastHour">lastHour</option><option value="shift">shift</option><option value="day">day</option><option value="week">week</option><option value="custom">custom</option></select></label>
        <label className="workbench-field"><span className="workbench-field__label">History from (ms)</span><input className="workbench-input" type="number" min={0} value={object.historyFrom ?? ""} onChange={(event) => onPatch({ historyFrom: parseOptionalMillis(event.target.value) })} /></label>
        <label className="workbench-field"><span className="workbench-field__label">History to (ms)</span><input className="workbench-input" type="number" min={0} value={object.historyTo ?? ""} onChange={(event) => onPatch({ historyTo: parseOptionalMillis(event.target.value) })} /></label>
        <label className="workbench-field"><span className="workbench-field__label">Page size</span><input className="workbench-input" type="number" min={1} max={5000} value={object.pageSize ?? 50} onChange={(event) => onPatch({ pageSize: normalizeNumber(event.target.value, 50, 1, 5000) })} /></label>
      </div>
    );
  })();

  return (
    <TrendWorkbenchDialog
      id="event-table-settings-dialog"
      title="Event Table Settings"
      open={open}
      defaultRect={{ x: 220, y: 90, width: 900, height: 650 }}
      minWidth={700}
      minHeight={500}
      bodyClassName="event-table-settings-dialog-body"
      footer={<WorkbenchButton onClick={onClose}>Close</WorkbenchButton>}
      onClose={onClose}
    >
      <div className="event-table-settings-body">
        <nav className="event-table-settings-nav" aria-label="Event table settings sections">
          {SETTINGS_NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`workbench-tree-item event-table-settings-nav-item ${activeTab === item.id ? "workbench-tree-item--active" : ""}`}
              onClick={() => setActiveTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="event-table-settings-content">
          <div className="event-table-settings-scroll">
            {content}
          </div>
        </div>
      </div>
    </TrendWorkbenchDialog>
  );
}
