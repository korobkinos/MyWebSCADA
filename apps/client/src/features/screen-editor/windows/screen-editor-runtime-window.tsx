import type { RuntimeState } from "@web-scada/shared";
import {
  WorkbenchButton,
  WorkbenchSection,
} from "../../../components/workbench";

type ScreenEditorRuntimeWindowProps = {
  runtime: RuntimeState;
  startScreenName: string;
  currentScreenName: string;
  onOpenRuntime: () => void;
  onStartRuntime: () => Promise<void>;
  onStopRuntime: () => Promise<void>;
};

export function ScreenEditorRuntimeWindow({
  runtime,
  startScreenName,
  currentScreenName,
  onOpenRuntime,
  onStartRuntime,
  onStopRuntime,
}: ScreenEditorRuntimeWindowProps) {
  const startedAtText = runtime.startedAt
    ? new Date(runtime.startedAt).toLocaleString()
    : "-";

  return (
    <div className="screen-editor-window-content">
      <WorkbenchSection title="RUNTIME">
        <div style={{ padding: "0 10px", display: "grid", gap: 6 }}>
          <div className="screen-editor-item-meta">
            State: {runtime.running ? "running" : "stopped"}
          </div>
          <div className="screen-editor-item-meta">Started at: {startedAtText}</div>
          <div className="screen-editor-item-meta">Start screen: {startScreenName}</div>
          <div className="screen-editor-item-meta">Current screen: {currentScreenName}</div>

          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <WorkbenchButton variant="primary" onClick={onOpenRuntime}>
              Open Runtime
            </WorkbenchButton>
            <WorkbenchButton onClick={() => void onStartRuntime()} disabled={runtime.running}>
              Start
            </WorkbenchButton>
            <WorkbenchButton onClick={() => void onStopRuntime()} disabled={!runtime.running}>
              Stop
            </WorkbenchButton>
          </div>
        </div>
      </WorkbenchSection>
    </div>
  );
}
