import { useMemo } from "react";
import { useScadaStore } from "../../../store/scada-store";
import {
  WorkbenchButton,
  WorkbenchSection,
} from "../../../components/workbench";
import { ScreenListSection } from "./screen-list-section";
import type { HmiScreen, ScreenKind } from "@web-scada/shared";

export type ScreenEditorActivityId =
  | "explorer"
  | "search"
  | "tags"
  | "assets"
  | "libraries"
  | "drivers"
  | "runtime";

type ScreenListViewMode = "grid" | "list";

type ScreenEditorLeftPanelProps = {
  activeActivityId: ScreenEditorActivityId;
  screen: HmiScreen | null | undefined;
  project: { startScreenId?: string; macros?: unknown[]; variables?: unknown[] } | null;
  assets: unknown[];
  libraries: unknown[];
  screenSearch: string;
  setScreenSearch: (v: string) => void;
  screenKindFilter: "all" | ScreenKind;
  setScreenKindFilter: (v: "all" | ScreenKind) => void;
  screenViewMode: ScreenListViewMode;
  setScreenViewMode: (v: ScreenListViewMode) => void;
  filteredScreens: HmiScreen[];
  newScreenKind: ScreenKind;
  setNewScreenKind: (v: ScreenKind) => void;
  addScreen: (kind: ScreenKind) => void;
  setCurrentScreen: (id: string) => void;
  duplicateScreenLocal: (screen: HmiScreen) => void;
  setStartScreen: (id: string) => void;
  deleteScreenLocal: (id: string) => void;
  navigate: (path: string) => void;
  openDefinedWindow: (id: string) => void;
};

export function ScreenEditorLeftPanel(props: ScreenEditorLeftPanelProps) {
  const {
    activeActivityId,
    screen,
    project,
    assets,
    libraries,
    screenSearch,
    setScreenSearch,
    screenKindFilter,
    setScreenKindFilter,
    screenViewMode,
    setScreenViewMode,
    filteredScreens,
    newScreenKind,
    setNewScreenKind,
    addScreen,
    setCurrentScreen,
    duplicateScreenLocal,
    setStartScreen,
    deleteScreenLocal,
    navigate,
    openDefinedWindow,
  } = props;

  const projectTags = useScadaStore.getState().tags ?? {};
  const tagKeys = Object.keys(projectTags);

  if (activeActivityId === "search") {
    return (
      <div className="screen-editor-side-panel">
        <WorkbenchSection title="SEARCH">
          <div style={{ padding: "0 10px" }}>
            <input
              className="workbench-input"
              placeholder="Search screens..."
              value={screenSearch}
              onChange={(e) => setScreenSearch(e.target.value)}
            />
            <div style={{ marginTop: 8, color: "#969696", fontSize: 12 }}>
              {filteredScreens.length} screen(s) found
            </div>
          </div>
        </WorkbenchSection>
      </div>
    );
  }

  if (activeActivityId === "tags") {
    return (
      <div className="screen-editor-side-panel">
        <WorkbenchSection title="TAGS">
          <div style={{ padding: "0 10px" }}>
            <WorkbenchButton onClick={() => openDefinedWindow("tags")}>
              🏷️ Open Tags Window
            </WorkbenchButton>
            <div style={{ marginTop: 8, color: "#969696", fontSize: 12 }}>
              {tagKeys.length} tag(s), {(project?.macros ?? []).length} macro(s), {(project?.variables ?? []).length} variable(s)
            </div>
          </div>
        </WorkbenchSection>
      </div>
    );
  }

  if (activeActivityId === "assets") {
    return (
      <div className="screen-editor-side-panel">
        <WorkbenchSection title="ASSETS">
          <div style={{ padding: "0 10px" }}>
            <WorkbenchButton onClick={() => openDefinedWindow("assets")}>
              🧩 Open Assets Window
            </WorkbenchButton>
            <div style={{ marginTop: 8, color: "#969696", fontSize: 12 }}>
              {assets.length} asset(s) available
            </div>
          </div>
        </WorkbenchSection>
      </div>
    );
  }

  if (activeActivityId === "libraries") {
    return (
      <div className="screen-editor-side-panel">
        <WorkbenchSection title="LIBRARIES">
          <div style={{ padding: "0 10px" }}>
            <WorkbenchButton onClick={() => openDefinedWindow("libraries")}>
              📚 Open Libraries Window
            </WorkbenchButton>
            <div style={{ marginTop: 8, color: "#969696", fontSize: 12 }}>
              {libraries.length} library/libraries available
            </div>
          </div>
        </WorkbenchSection>
      </div>
    );
  }

  if (activeActivityId === "drivers") {
    return (
      <div className="screen-editor-side-panel">
        <WorkbenchSection title="DRIVERS">
          <div style={{ padding: "0 10px" }}>
            <WorkbenchButton onClick={() => openDefinedWindow("drivers")}>
              ⚙️ Open Drivers Window
            </WorkbenchButton>
            <div style={{ marginTop: 8, color: "#969696", fontSize: 12 }}>
              OPC UA / Simulation
            </div>
          </div>
        </WorkbenchSection>
      </div>
    );
  }

  if (activeActivityId === "runtime") {
    return (
      <div className="screen-editor-side-panel">
        <WorkbenchSection title="RUNTIME">
          <div style={{ padding: "0 10px" }}>
            <WorkbenchButton onClick={() => navigate("/runtime")}>
              ▶ Open Runtime
            </WorkbenchButton>
            <div style={{ marginTop: 8, color: "#969696", fontSize: 12 }}>
              Start screen:{" "}
              {project?.startScreenId
                ? (filteredScreens.find((s) => s.id === project.startScreenId)
                    ?.name ?? project.startScreenId)
                : "-"}
            </div>
          </div>
        </WorkbenchSection>
      </div>
    );
  }

  return (
    <div className="screen-editor-side-panel">
      <ScreenListSection
        screens={filteredScreens}
        currentScreenId={screen?.id}
        startScreenId={project?.startScreenId}
        search={screenSearch}
        onSearchChange={setScreenSearch}
        kindFilter={screenKindFilter}
        onKindFilterChange={setScreenKindFilter}
        viewMode={screenViewMode}
        onViewModeChange={setScreenViewMode}
        newScreenKind={newScreenKind}
        onNewScreenKindChange={setNewScreenKind}
        onCreateScreen={addScreen}
        onSelectScreen={setCurrentScreen}
        onDuplicateScreen={duplicateScreenLocal}
        onSetStartScreen={setStartScreen}
        onDeleteScreen={deleteScreenLocal}
      />

      <WorkbenchSection title="ASSETS">
        <div style={{ padding: "0 10px" }}>
          <div className="screen-editor-item-meta" style={{ marginBottom: 4 }}>
            {assets.length} asset(s)
          </div>
          <WorkbenchButton onClick={() => openDefinedWindow("assets")}>
            🧩 Open Assets
          </WorkbenchButton>
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="LIBRARIES">
        <div style={{ padding: "0 10px" }}>
          <div className="screen-editor-item-meta" style={{ marginBottom: 4 }}>
            {libraries.length} library/libraries
          </div>
          <WorkbenchButton onClick={() => openDefinedWindow("libraries")}>
            📚 Open Libraries
          </WorkbenchButton>
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="TAGS">
        <div style={{ padding: "0 10px" }}>
          <div className="screen-editor-item-meta" style={{ marginBottom: 4 }}>
            {tagKeys.length} tags · {(project?.macros ?? []).length} macros · {(project?.variables ?? []).length} variables
          </div>
          <WorkbenchButton onClick={() => openDefinedWindow("tags")}>
            🏷️ Open Tags
          </WorkbenchButton>
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="DRIVERS">
        <div style={{ padding: "0 10px" }}>
          <div className="screen-editor-item-meta" style={{ marginBottom: 4 }}>
            OPC UA / Simulation
          </div>
          <WorkbenchButton onClick={() => openDefinedWindow("drivers")}>
            ⚙️ Open Drivers
          </WorkbenchButton>
        </div>
      </WorkbenchSection>
    </div>
  );
}