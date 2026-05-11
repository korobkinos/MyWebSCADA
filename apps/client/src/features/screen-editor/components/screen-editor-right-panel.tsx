import { message, Typography } from "antd";
import type { HmiObject } from "@web-scada/shared";
import {
  WorkbenchButton,
  WorkbenchSection,
} from "../../../components/workbench";

export type ScreenEditorRightPanelProps = {
  activeObject: HmiObject | null;
  onOpenObjectProperties: () => void;
  onOpenLayers: () => void;
  removeObjectWithHistory: (id: string) => void;
};

export function ScreenEditorRightPanel({
  activeObject,
  onOpenObjectProperties,
  onOpenLayers,
  removeObjectWithHistory,
}: ScreenEditorRightPanelProps) {
  return (
    <div className="screen-editor-inspector">
      <WorkbenchSection title="SELECTION">
        {activeObject ? (
          <div style={{ padding: "0 10px" }}>
            <div className="workbench-input" style={{ padding: "4px 8px", marginBottom: 4 }}>
              <Typography.Text style={{ fontSize: 11, color: "#969696" }}>ID: {activeObject.id}</Typography.Text>
            </div>
            <div className="workbench-input" style={{ padding: "4px 8px", marginBottom: 4 }}>
              <Typography.Text style={{ fontSize: 11, color: "#969696" }}>Type: {activeObject.type}</Typography.Text>
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              <WorkbenchButton onClick={onOpenObjectProperties}>Open Properties</WorkbenchButton>
              <WorkbenchButton onClick={onOpenLayers}>Open Layers</WorkbenchButton>
              <WorkbenchButton
                variant="danger"
                onClick={() => {
                  if (activeObject.locked) {
                    void message.warning("Locked object cannot be deleted");
                    return;
                  }
                  removeObjectWithHistory(activeObject.id);
                }}
              >
                Delete
              </WorkbenchButton>
            </div>
          </div>
        ) : (
          <div className="screen-editor-empty-state">Select an object on canvas</div>
        )}
      </WorkbenchSection>
    </div>
  );
}
