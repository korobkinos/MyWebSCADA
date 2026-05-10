import { message, Space, Tag, Typography } from "antd";
import type { HmiObject } from "@web-scada/shared";
import {
  WorkbenchButton,
  WorkbenchSection,
  WorkbenchTreeItem,
} from "../../../components/workbench";

export type ScreenEditorRightPanelProps = {
  activeObject: HmiObject | null;
  screenObjects: HmiObject[];
  selection: { selectedObjectIds: string[]; activeObjectId?: string };
  setSelectedObjects: (ids: string[], activeId?: string) => void;
  setPropertiesOpen: (v: boolean) => void;
  removeObjectWithHistory: (id: string) => void;
  setSaveModalOpen: (v: boolean) => void;
};

export function ScreenEditorRightPanel({
  activeObject,
  screenObjects,
  selection,
  setSelectedObjects,
  setPropertiesOpen,
  removeObjectWithHistory,
  setSaveModalOpen,
}: ScreenEditorRightPanelProps) {
  return (
    <div className="screen-editor-inspector">
      <WorkbenchSection title="SELECTED OBJECT">
        {activeObject ? (
          <div style={{ padding: "0 10px" }}>
            <div className="workbench-input" style={{ padding: "4px 8px", marginBottom: 4 }}>
              <Typography.Text style={{ fontSize: 11, color: "#969696" }}>ID: {activeObject.id}</Typography.Text>
            </div>
            <div className="workbench-input" style={{ padding: "4px 8px", marginBottom: 4 }}>
              <Typography.Text style={{ fontSize: 11, color: "#969696" }}>Type: {activeObject.type}</Typography.Text>
            </div>
            <div className="workbench-input" style={{ padding: "4px 8px", marginBottom: 4 }}>
              <Typography.Text style={{ fontSize: 11, color: "#969696" }}>
                x/y: {Math.round(activeObject.x)} / {Math.round(activeObject.y)}
              </Typography.Text>
            </div>
            <div className="workbench-input" style={{ padding: "4px 8px", marginBottom: 4 }}>
              <Typography.Text style={{ fontSize: 11, color: "#969696" }}>
                w/h: {Math.round(activeObject.width)} / {Math.round(activeObject.height)}
              </Typography.Text>
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              <WorkbenchButton onClick={() => setPropertiesOpen(true)}>Properties</WorkbenchButton>
              <WorkbenchButton variant="danger" onClick={() => {
                if (activeObject.locked) {
                  void message.warning("Locked object cannot be deleted");
                  return;
                }
                removeObjectWithHistory(activeObject.id);
              }}>Delete</WorkbenchButton>
            </div>
          </div>
        ) : (
          <div className="screen-editor-empty-state">Select an object on canvas</div>
        )}
      </WorkbenchSection>

      <WorkbenchSection title="LAYERS">
        {screenObjects.map((item) => (
          <WorkbenchTreeItem
            key={item.id}
            active={selection.selectedObjectIds.includes(item.id)}
            onClick={() => setSelectedObjects([item.id], item.id)}
          >
            <Space size={4}>
              <span style={{ color: item.visible ?? true ? "#ccc" : "#666" }}>
                {(item.name?.trim() || item.id)}
              </span>
              <Tag style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>{item.type}</Tag>
              {item.locked ? <Tag color="orange" style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>Lock</Tag> : null}
            </Space>
          </WorkbenchTreeItem>
        ))}
        <div style={{ padding: "4px 10px" }}>
          <WorkbenchButton onClick={() => setSaveModalOpen(true)}>Save Selection As Element</WorkbenchButton>
        </div>
      </WorkbenchSection>
    </div>
  );
}
