import type { RuntimeState } from "@web-scada/shared";
import { useState } from "react";
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
  onRefreshStatus: () => Promise<void>;
};

export function ScreenEditorRuntimeWindow({
  runtime,
  startScreenName,
  currentScreenName,
  onOpenRuntime,
  onStartRuntime,
  onStopRuntime,
  onRefreshStatus,
}: ScreenEditorRuntimeWindowProps) {
  const [pendingAction, setPendingAction] = useState<"start" | "stop" | "refresh" | null>(null);
  const startedAtText = runtime.startedAt
    ? new Date(runtime.startedAt).toLocaleString()
    : "-";
  const stoppedAtText = runtime.stoppedAt
    ? new Date(runtime.stoppedAt).toLocaleString()
    : "-";
  const runtimeState = runtime.state ?? (runtime.running ? "running" : "stopped");

  const runAction = async (action: "start" | "stop" | "refresh", run: () => Promise<void>) => {
    setPendingAction(action);
    try {
      await run();
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="screen-editor-window-content">
      <WorkbenchSection title="RUNTIME">
        <div style={{ padding: "0 10px", display: "grid", gap: 6 }}>
          <div className="screen-editor-item-meta">
            State: {runtimeState}
          </div>
          <div className="screen-editor-item-meta">Started at: {startedAtText}</div>
          <div className="screen-editor-item-meta">Stopped at: {stoppedAtText}</div>
          <div className="screen-editor-item-meta">Poll groups: {runtime.pollGroups?.length ?? 0}</div>
          <div className="screen-editor-item-meta">Macro intervals: {runtime.macroIntervals?.length ?? 0}</div>
          {runtime.lastError ? <div className="screen-editor-item-meta">Last error: {runtime.lastError}</div> : null}
          <div className="screen-editor-item-meta">Start screen: {startScreenName}</div>
          <div className="screen-editor-item-meta">Current screen: {currentScreenName}</div>

          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <WorkbenchButton variant="primary" onClick={onOpenRuntime}>
              Open Runtime
            </WorkbenchButton>
            <WorkbenchButton
              onClick={() => void runAction("start", onStartRuntime)}
              disabled={runtimeState === "running" || runtimeState === "starting" || pendingAction !== null}
            >
              {pendingAction === "start" ? "Starting..." : "Start"}
            </WorkbenchButton>
            <WorkbenchButton
              onClick={() => void runAction("stop", onStopRuntime)}
              disabled={runtimeState === "stopped" || runtimeState === "stopping" || pendingAction !== null}
            >
              {pendingAction === "stop" ? "Stopping..." : "Stop"}
            </WorkbenchButton>
            <WorkbenchButton
              onClick={() => void runAction("refresh", onRefreshStatus)}
              disabled={pendingAction !== null}
            >
              {pendingAction === "refresh" ? "Refreshing..." : "Refresh"}
            </WorkbenchButton>
          </div>
        </div>
      </WorkbenchSection>
    </div>
  );
}
