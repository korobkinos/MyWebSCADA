import type { HmiObject, HmiScreen } from "@web-scada/shared";
import { WorkbenchButton } from "../../../components/workbench";

export type ScreenEditorLogEntry = {
  id: string;
  time: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
};

export type ScreenEditorBottomPanelProps = {
  screen: HmiScreen | null;
  activeObject: HmiObject | null;
  isProjectDirty: boolean;
  saveStatusText: string;
  logs: ScreenEditorLogEntry[];
  onClearLogs?: () => void;
};

export function ScreenEditorBottomPanel({
  screen,
  activeObject,
  isProjectDirty,
  saveStatusText,
  logs,
  onClearLogs,
}: ScreenEditorBottomPanelProps) {
  return (
    <div className="screen-editor-bottom-panel">
      <div className="screen-editor-bottom-panel__status">
        <div>[screen] {screen?.name ?? "-"} ({screen?.width ?? 0}x{screen?.height ?? 0})</div>
        <div>[objects] {screen?.objects.length ?? 0}</div>
        <div>[selected] {activeObject ? `${activeObject.id} (${activeObject.type})` : "-"}</div>
        <div>[save] {isProjectDirty ? "Unsaved changes" : saveStatusText}</div>
      </div>
      <div className="screen-editor-bottom-panel__logs-header">
        <span>Editor log</span>
        {onClearLogs ? (
          <WorkbenchButton onClick={onClearLogs}>Clear</WorkbenchButton>
        ) : null}
      </div>
      <div className="screen-editor-bottom-panel__logs">
        {logs.length ? (
          logs.map((entry) => (
            <div key={entry.id} className={`screen-editor-log-entry screen-editor-log-entry--${entry.level}`}>
              [{entry.time}] {entry.message}
            </div>
          ))
        ) : (
          <div className="screen-editor-log-entry screen-editor-log-entry--info">[info] No log entries yet</div>
        )}
      </div>
    </div>
  );
}
