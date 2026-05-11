import { Select, Space, Tag } from "antd";
import type { HmiScreen, ScreenKind } from "@web-scada/shared";
import {
  WorkbenchButton,
  WorkbenchSection,
} from "../../../components/workbench";

type ScreenListViewMode = "grid" | "list";

type ScreenListSectionProps = {
  screens: HmiScreen[];
  currentScreenId?: string;
  startScreenId?: string;
  search: string;
  onSearchChange: (value: string) => void;
  kindFilter: "all" | ScreenKind;
  onKindFilterChange: (value: "all" | ScreenKind) => void;
  viewMode: ScreenListViewMode;
  onViewModeChange: (value: ScreenListViewMode) => void;
  newScreenKind: ScreenKind;
  onNewScreenKindChange: (value: ScreenKind) => void;
  onCreateScreen: (kind: ScreenKind) => void;
  onSelectScreen: (id: string) => void;
  onDuplicateScreen: (screen: HmiScreen) => void;
  onSetStartScreen: (id: string) => void;
  onDeleteScreen: (id: string) => void;
  onOpenScreenSettings: () => void;
};

export function ScreenListSection(props: ScreenListSectionProps) {
  const {
    screens,
    currentScreenId,
    startScreenId,
    search,
    onSearchChange,
    kindFilter,
    onKindFilterChange,
    viewMode,
    onViewModeChange,
    newScreenKind,
    onNewScreenKindChange,
    onCreateScreen,
    onSelectScreen,
    onDuplicateScreen,
    onSetStartScreen,
    onDeleteScreen,
    onOpenScreenSettings,
  } = props;

  const currentScreen = screens.find((s) => s.id === currentScreenId);

  return (
    <>
      <WorkbenchSection title="SCREENS">
        <div style={{ display: "flex", gap: 4, padding: "0 10px 6px", flexWrap: "wrap" }}>
          <Select
            size="small"
            value={newScreenKind}
            style={{ width: 100 }}
            onChange={(value) => onNewScreenKindChange(value)}
            options={[
              { label: "Screen", value: "screen" },
              { label: "Popup", value: "popup" },
              { label: "Template", value: "template" },
            ]}
          />
          <WorkbenchButton onClick={() => onCreateScreen(newScreenKind)}>
            Add
          </WorkbenchButton>
        </div>
        <div style={{ padding: "0 10px 6px" }}>
          <input
            className="workbench-input"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search screens"
          />
        </div>
        <div style={{ display: "flex", gap: 4, padding: "0 10px 6px", flexWrap: "wrap" }}>
          <select
            className="workbench-select"
            style={{ width: 100 }}
            value={kindFilter}
            onChange={(event) =>
              onKindFilterChange(event.target.value as "all" | ScreenKind)
            }
          >
            <option value="all">All</option>
            <option value="screen">Screen</option>
            <option value="popup">Popup</option>
            <option value="template">Template</option>
          </select>
          <select
            className="workbench-select"
            style={{ width: 80 }}
            value={viewMode}
            onChange={(event) =>
              onViewModeChange(event.target.value as ScreenListViewMode)
            }
          >
            <option value="grid">Grid</option>
            <option value="list">List</option>
          </select>
        </div>
        <div
          className={`screen-editor-screen-list screen-editor-screen-list--${viewMode}`}
        >
          {screens.map((item) => (
            <div
              key={item.id}
              className={`screen-editor-screen-card ${item.id === currentScreenId ? "active" : ""}`}
              onClick={() => onSelectScreen(item.id)}
            >
              <Space size={4} style={{ width: "100%", justifyContent: "space-between" }}>
                <span>{item.name}</span>
                <Space size={4}>
                  <Tag
                    color={
                      item.kind === "popup"
                        ? "purple"
                        : item.kind === "template"
                          ? "cyan"
                          : "blue"
                    }
                    style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}
                  >
                    {item.kind}
                  </Tag>
                  {startScreenId === item.id ? (
                    <Tag
                      color="green"
                      style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}
                    >
                      Start
                    </Tag>
                  ) : null}
                </Space>
              </Space>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, padding: "4px 10px", flexWrap: "wrap" }}>
          <WorkbenchButton
            onClick={() => currentScreen && onDuplicateScreen(currentScreen)}
            disabled={!currentScreen}
          >
            Duplicate
          </WorkbenchButton>
          <WorkbenchButton
            onClick={() => currentScreen && onSetStartScreen(currentScreen.id)}
          >
            Set Start
          </WorkbenchButton>
          <WorkbenchButton
            variant="danger"
            onClick={() => currentScreen && onDeleteScreen(currentScreen.id)}
            disabled={screens.length <= 1}
          >
            Delete
          </WorkbenchButton>
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="CURRENT SCREEN">
        <div style={{ padding: "0 10px" }}>
          <div className="screen-editor-item-title">{currentScreen?.name ?? "-"}</div>
          <div className="screen-editor-item-meta" style={{ margin: "4px 0 8px" }}>
            {currentScreen ? `${currentScreen.width}x${currentScreen.height}` : "No screen selected"}
          </div>
          <WorkbenchButton onClick={onOpenScreenSettings} disabled={!currentScreen}>
            Open Screen Settings
          </WorkbenchButton>
        </div>
      </WorkbenchSection>
    </>
  );
}
