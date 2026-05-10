import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type {
  Asset,
  EditorCommand,
  HmiScreen,
  HmiObject,
  InternalVariableDefinition,
  LibraryElement,
  ProjectLibraryRef,
  RuntimeAction,
  ScadaProject,
  ScreenKind,
} from "@web-scada/shared";
import { normalizeObjectsToGroup } from "@web-scada/shared";
import {
  Button,
  Checkbox,
  ColorPicker,
  Divider,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import { api } from "../services/api";
import { FloatingPanel } from "../components/floating-panel";
import { ObjectPropertyPanel } from "../components/object-property-panel";
import { createObjectByType } from "../hmi/editor/default-object-factory";
import { importSvgAssetToPrimitives } from "../hmi/editor/svg-primitive-import";
import { HmiStage } from "../hmi/runtime/hmi-stage";
import { useSnapshotHistory } from "../hooks/use-snapshot-history";
import { useScadaStore } from "../store/scada-store";
import { isTextEditingTarget } from "../utils/keyboard";
import {
  ScadaWorkbenchLayout,
  WorkbenchButton,
  WorkbenchPanelToolbar,
  WorkbenchSection,
  WorkbenchTabs,
  WorkbenchTreeItem,
  WorkbenchWindowManager,
  useWorkbenchWindows,
  type WorkbenchWindowDefinition,
} from "../components/workbench";

type CloneOptions = {
  count: number;
  direction: "horizontal" | "vertical";
  gapX: number;
  gapY: number;
  tagMode: "keepSameTags" | "addPrefix" | "replacePrefix" | "incrementNumber";
  tagPrefix?: string;
  tagReplaceFrom?: string;
  tagReplaceTo?: string;
  startIndex: number;
  step: number;
};
type PrimitiveShapeKind = "square" | "circle" | "triangle";

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function createPrimitiveShape(kind: PrimitiveShapeKind): HmiObject {
  if (kind === "triangle") {
    return {
      id: id("tri"),
      type: "line",
      x: 110,
      y: 110,
      width: 90,
      height: 80,
      minWidth: 20,
      minHeight: 20,
      points: [45, 0, 90, 80, 0, 80],
      stroke: "#8c8c8c",
      strokeWidth: 2,
      closed: true,
      fill: "#262626",
      opacity: 1,
    };
  }
  if (kind === "circle") {
    return {
      id: id("circle"),
      type: "rectangle",
      x: 110,
      y: 110,
      width: 90,
      height: 90,
      minWidth: 20,
      minHeight: 20,
      fill: "#262626",
      stroke: "#8c8c8c",
      strokeWidth: 2,
      cornerRadius: 45,
      opacity: 1,
    };
  }
  return {
    id: id("square"),
    type: "rectangle",
    x: 110,
    y: 110,
    width: 90,
    height: 90,
    minWidth: 20,
    minHeight: 20,
    fill: "#262626",
    stroke: "#8c8c8c",
    strokeWidth: 2,
    cornerRadius: 0,
    opacity: 1,
  };
}

function ScreenEditorLeftPanel({
  screen,
  project,
  libraries,
  assets,
  screenSearch,
  setScreenSearch,
  screenKindFilter,
  setScreenKindFilter,
  screenViewMode,
  setScreenViewMode,
  filteredScreens,
  newScreenKind,
  setNewScreenKind,
  newVarName,
  setNewVarName,
  newVarType,
  setNewVarType,
  addVariable,
  addScreen,
  setCurrentScreen,
  duplicateScreenLocal,
  setStartScreen,
  deleteScreenLocal,
  assetUploadName,
  setAssetUploadName,
  uploadInputRef,
  onUploadProjectAsset,
  addAssetAsImage,
  activeActivityId,
  navigate,
  newLibraryId,
  setNewLibraryId,
  newLibraryName,
  setNewLibraryName,
  createLibrary,
  loadLibraries,
  attachLibrary,
  addLibraryElementInstance,
}: {
  screen: HmiScreen;
  project: ScadaProject;
  libraries: any[];
  assets: Asset[];
  screenSearch: string;
  setScreenSearch: (v: string) => void;
  screenKindFilter: "all" | ScreenKind;
  setScreenKindFilter: (v: "all" | ScreenKind) => void;
  screenViewMode: "grid" | "list";
  setScreenViewMode: (v: "grid" | "list") => void;
  filteredScreens: HmiScreen[];
  newScreenKind: ScreenKind;
  setNewScreenKind: (v: ScreenKind) => void;
  newVarName: string;
  setNewVarName: (v: string) => void;
  newVarType: InternalVariableDefinition["dataType"];
  setNewVarType: (v: InternalVariableDefinition["dataType"]) => void;
  addVariable: (name: string, dataType: InternalVariableDefinition["dataType"], initialValue?: boolean | number | string | null) => void;
  addScreen: (kind: ScreenKind) => void;
  setCurrentScreen: (id: string) => void;
  duplicateScreenLocal: (screen: HmiScreen) => void;
  setStartScreen: (id: string) => void;
  deleteScreenLocal: (id: string) => void;
  assetUploadName: string;
  setAssetUploadName: (v: string) => void;
  uploadInputRef: React.RefObject<HTMLInputElement | null>;
  onUploadProjectAsset: (file: File) => Promise<void>;
  addAssetAsImage: (asset: Asset) => void;
  activeActivityId: string;
  navigate: (path: string) => void;
  newLibraryId: string;
  setNewLibraryId: (v: string) => void;
  newLibraryName: string;
  setNewLibraryName: (v: string) => void;
  createLibrary: () => Promise<void>;
  loadLibraries: () => Promise<void>;
  attachLibrary: (id: string) => Promise<void>;
  addLibraryElementInstance: (libraryId: string, elementOrId: LibraryElement | string) => void;
}) {
  if (activeActivityId === "search") {
    return (
      <div className="screen-editor-side-panel">
        <WorkbenchSection title="SEARCH">
          <div style={{ padding: "0 10px" }}>
            <input className="workbench-input" placeholder="Search screens..." value={screenSearch} onChange={(e) => setScreenSearch(e.target.value)} />
            <div style={{ marginTop: 8, color: "#969696", fontSize: 12 }}>
              {filteredScreens.length} screen(s) found
            </div>
          </div>
        </WorkbenchSection>
      </div>
    );
  }

  if (activeActivityId === "tags") {
    const projectTags = useScadaStore.getState().tags ?? {};
    const tagKeys = Object.keys(projectTags);
    const projectVariables = project.variables ?? [];
    return (
      <div className="screen-editor-side-panel">
        <WorkbenchSection title="TAGS">
          <div style={{ padding: "0 10px" }}>
            <div style={{ color: "#969696", fontSize: 12, marginBottom: 8 }}>
              Total tags: {tagKeys.length}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <WorkbenchTreeItem onClick={() => navigate("/tags")}>
                🏷️ Open Tags Workspace ({tagKeys.length} tags)
              </WorkbenchTreeItem>
              {(project.macros ?? []).map((macro) => (
                <WorkbenchTreeItem key={macro.id}>
                  <Space size={4}>
                    <span>▶ {macro.name}</span>
                    <Tag color={macro.enabled ?? true ? "green" : "default"} style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
                      {macro.enabled ?? true ? "EN" : "DIS"}
                    </Tag>
                  </Space>
                </WorkbenchTreeItem>
              ))}
            </div>
          </div>
        </WorkbenchSection>
        <WorkbenchSection title="INTERNAL VARIABLES (LW)">
          <div style={{ padding: "0 10px" }}>
            <input className="workbench-input" value={newVarName} onChange={(e) => setNewVarName(e.target.value)} placeholder="Variable name" />
            <div style={{ display: "flex", gap: 4, marginTop: 4, marginBottom: 6 }}>
              <select className="workbench-select" style={{ flex: 1 }} value={newVarType} onChange={(e) => setNewVarType(e.target.value as InternalVariableDefinition["dataType"])}>
                <option value="BOOL">BOOL</option>
                <option value="INT">INT</option>
                <option value="DINT">DINT</option>
                <option value="REAL">REAL</option>
                <option value="STRING">STRING</option>
              </select>
              <WorkbenchButton onClick={() => addVariable(newVarName.trim(), newVarType, newVarType === "BOOL" ? false : 0)}>Add</WorkbenchButton>
            </div>
            <div style={{ maxHeight: 200, overflow: "auto" }}>
              {projectVariables.slice(0, 50).map((v) => (
                <WorkbenchTreeItem key={v.name}><span>{v.name} ({v.dataType})</span></WorkbenchTreeItem>
              ))}
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
            <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              <input className="workbench-input" value={assetUploadName} onChange={(e) => setAssetUploadName(e.target.value)} placeholder="Asset name" style={{ flex: 1 }} />
              <WorkbenchButton onClick={() => uploadInputRef.current?.click()}>Upload</WorkbenchButton>
            </div>
            <div style={{ color: "#969696", fontSize: 11, marginBottom: 4 }}>
              Click on asset to add to screen
            </div>
            <div style={{ maxHeight: 400, overflow: "auto" }}>
              {assets.slice(0, 50).map((asset) => (
                <WorkbenchTreeItem key={asset.id} onClick={() => addAssetAsImage(asset)}>
                  <Space size={4}>
                    <img src={asset.previewUrl} alt={asset.name} style={{ width: 24, height: 24, objectFit: "contain", background: "#111" }} />
                    <span>{asset.name}</span>
                  </Space>
                </WorkbenchTreeItem>
              ))}
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
            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
              <input className="workbench-input" value={newLibraryId} onChange={(e) => setNewLibraryId(e.target.value)} placeholder="library id" style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
              <input className="workbench-input" value={newLibraryName} onChange={(e) => setNewLibraryName(e.target.value)} placeholder="library name" style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
              <WorkbenchButton onClick={() => void createLibrary()}>Create</WorkbenchButton>
              <WorkbenchButton onClick={() => void loadLibraries()}>Refresh</WorkbenchButton>
            </div>
          </div>
        </WorkbenchSection>
        <WorkbenchSection title="AVAILABLE LIBRARIES">
          <div style={{ padding: "0 10px" }}>
            {libraries.map((library) => {
              const attached = (project.libraries ?? []).some((item) => item.libraryId === library.id && item.enabled);
              return (
                <WorkbenchTreeItem key={library.id}>
                  <Space size={4} style={{ width: "100%", justifyContent: "space-between" }}>
                    <span>{library.name}</span>
                    {attached ? (
                      <Tag color="green" style={{ fontSize: 10 }}>attached</Tag>
                    ) : (
                      <WorkbenchButton onClick={() => void attachLibrary(library.id)}>Attach</WorkbenchButton>
                    )}
                  </Space>
                </WorkbenchTreeItem>
              );
            })}
          </div>
        </WorkbenchSection>
        <WorkbenchSection title="ELEMENTS">
          <div style={{ padding: "0 10px" }}>
            {(project.libraries ?? []).filter((ref) => ref.enabled).map((ref) => {
              const library = libraries.find((item) => item.id === ref.libraryId);
              if (!library) { return null; }
              return (
                <div key={ref.libraryId} style={{ marginBottom: 8 }}>
                  <div style={{ color: "#969696", fontSize: 11, marginBottom: 4 }}>{ref.name}</div>
                  {library.elements?.slice(0, 10).map((element: LibraryElement) => (
                    <WorkbenchTreeItem key={element.id}>
                      <Space size={4} style={{ width: "100%", justifyContent: "space-between" }}>
                        <span>{element.name}</span>
                        <WorkbenchButton onClick={() => addLibraryElementInstance(library.id, element)}>Add</WorkbenchButton>
                      </Space>
                    </WorkbenchTreeItem>
                  ))}
                </div>
              );
            })}
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
            <WorkbenchTreeItem onClick={() => navigate("/drivers")}>
              ⚙️ Open Drivers Workspace
            </WorkbenchTreeItem>
            <div style={{ marginTop: 8, color: "#969696", fontSize: 12 }}>
              Configure OPC UA, Modbus, and other protocol drivers in the Drivers workspace.
            </div>
          </div>
        </WorkbenchSection>
        <WorkbenchSection title="OPC UA & SIMULATION">
          <div style={{ padding: "0 10px" }}>
            <div style={{ color: "#969696", fontSize: 12 }}>
              Tags can be configured with OPC UA, LW, Internal or Simulated sources.
            </div>
            <div style={{ marginTop: 4 }}>
              <WorkbenchButton onClick={() => navigate("/tags")}>Configure Tags</WorkbenchButton>
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
            <WorkbenchButton onClick={() => navigate("/runtime")}>▶ Open Runtime</WorkbenchButton>
            <div style={{ marginTop: 8, color: "#969696", fontSize: 12 }}>
              Start screen: {project.startScreenId ? (project.screens.find((s) => s.id === project.startScreenId)?.name ?? project.startScreenId) : "-"}
            </div>
          </div>
        </WorkbenchSection>
      </div>
    );
  }

  return (
    <div className="screen-editor-side-panel">
      <WorkbenchSection title="SCREENS">
        <div style={{ display: "flex", gap: 4, padding: "0 10px 6px", flexWrap: "wrap" }}>
          <Select size="small" value={newScreenKind} style={{ width: 100 }} onChange={(value) => setNewScreenKind(value)} options={[
            { label: "Screen", value: "screen" }, { label: "Popup", value: "popup" }, { label: "Template", value: "template" },
          ]} />
          <WorkbenchButton onClick={() => addScreen(newScreenKind)}>Add</WorkbenchButton>
        </div>
        <div style={{ padding: "0 10px 6px" }}>
          <input className="workbench-input" value={screenSearch} onChange={(event) => setScreenSearch(event.target.value)} placeholder="Search screens" />
        </div>
        <div style={{ display: "flex", gap: 4, padding: "0 10px 6px", flexWrap: "wrap" }}>
          <select className="workbench-select" style={{ width: 100 }} value={screenKindFilter} onChange={(event) => setScreenKindFilter(event.target.value as "all" | ScreenKind)}>
            <option value="all">All</option>
            <option value="screen">Screen</option>
            <option value="popup">Popup</option>
            <option value="template">Template</option>
          </select>
          <select className="workbench-select" style={{ width: 80 }} value={screenViewMode} onChange={(event) => setScreenViewMode(event.target.value as "grid" | "list")}>
            <option value="grid">Grid</option>
            <option value="list">List</option>
          </select>
        </div>
        <div className={`screen-editor-screen-list screen-editor-screen-list--${screenViewMode}`}>
          {filteredScreens.map((item) => (
            <div
              key={item.id}
              className={`screen-editor-screen-card ${item.id === screen.id ? "active" : ""}`}
              onClick={() => setCurrentScreen(item.id)}
            >
              <Space size={4} style={{ width: "100%", justifyContent: "space-between" }}>
                <span>{item.name}</span>
                <Space size={4}>
                  <Tag color={item.kind === "popup" ? "purple" : item.kind === "template" ? "cyan" : "blue"} style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
                    {item.kind}
                  </Tag>
                  {project.startScreenId === item.id ? <Tag color="green" style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>Start</Tag> : null}
                </Space>
              </Space>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, padding: "4px 10px", flexWrap: "wrap" }}>
          <WorkbenchButton onClick={() => duplicateScreenLocal(screen)} disabled={!screen}>Duplicate</WorkbenchButton>
          <WorkbenchButton onClick={() => setStartScreen(screen.id)}>Set Start</WorkbenchButton>
          <WorkbenchButton variant="danger" onClick={() => deleteScreenLocal(screen.id)} disabled={filteredScreens.length <= 1}>Delete</WorkbenchButton>
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="CURRENT SCREEN">
        <div style={{ padding: "0 10px" }}>
          <input className="workbench-input" value={screen.name} onChange={(e) => { useScadaStore.getState().updateScreen(screen.id, { name: e.target.value }); }} placeholder="Screen name" />
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            <input className="workbench-input" type="number" style={{ width: "50%" }} value={screen.width} onChange={(e) => { useScadaStore.getState().updateScreen(screen.id, { width: Number(e.target.value) }); }} />
            <input className="workbench-input" type="number" style={{ width: "50%" }} value={screen.height} onChange={(e) => { useScadaStore.getState().updateScreen(screen.id, { height: Number(e.target.value) }); }} />
          </div>
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="LIBRARIES">
        <div style={{ padding: "0 10px" }}>
          {(project.libraries ?? []).map((ref) => (
            <WorkbenchTreeItem key={ref.libraryId}>
              <Space size={4}>
                <span>{ref.name}</span>
                <Tag color={ref.enabled ? "green" : "default"} style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
                  {ref.enabled ? "ON" : "OFF"}
                </Tag>
              </Space>
            </WorkbenchTreeItem>
          ))}
        </div>
      </WorkbenchSection>
    </div>
  );
}

function ScreenEditorCenter({
  screen,
  project,
  tags,
  libraries,
  selection,
  selectionRect,
  showObjectFrames,
  setSelectionRect,
  toggleSelectedObject,
  setSelectedObjects,
  setPropertiesOpen,
  setContextMenu,
  handleDrop,
  moveObjectWithHistory,
  resizeObjectWithHistory,
  undo,
  redo,
  handleSaveProject,
  isProjectDirty,
  isSavingProject,
  canUndo,
  canRedo,
  addObjectWithHistory,
  addPrimitiveShape,
  adjustPrimitiveStrokeWidth,
  selectedUnlocked,
  runCommand,
  canSameSize,
  canDistribute,
  spacingGap,
  setSpacingGap,
  canCopy,
  canPaste,
  canDelete,
  copySelectionToClipboard,
  pasteFromClipboard,
  deleteSelectionWithHistory,
  setCloneOpen,
  canGroup,
  canUngroup,
  canLock,
  canUnlock,
  canAlign,
  navigate,
}: {
  screen: HmiScreen;
  project: ScadaProject | null;
  tags: Record<string, any>;
  libraries: any[];
  selection: any;
  selectionRect: any;
  showObjectFrames: boolean;
  setSelectionRect: (rect: any) => void;
  toggleSelectedObject: (id: string) => void;
  setSelectedObjects: (ids: string[], activeId?: string) => void;
  setPropertiesOpen: (v: boolean) => void;
  setContextMenu: (v: any) => void;
  handleDrop: (event: DragEvent<HTMLDivElement>) => void;
  moveObjectWithHistory: (id: string, x: number, y: number) => void;
  resizeObjectWithHistory: (id: string, patch: Partial<HmiObject>) => void;
  undo: () => void;
  redo: () => void;
  handleSaveProject: () => Promise<void>;
  isProjectDirty: boolean;
  isSavingProject: boolean;
  canUndo: boolean;
  canRedo: boolean;
  addObjectWithHistory: (obj: HmiObject) => void;
  addPrimitiveShape: (kind: PrimitiveShapeKind) => void;
  adjustPrimitiveStrokeWidth: (delta: number) => void;
  selectedUnlocked: HmiObject[];
  runCommand: (cmd: EditorCommand) => void;
  canSameSize: boolean;
  canDistribute: boolean;
  spacingGap: number | undefined;
  setSpacingGap: (v: number | undefined) => void;
  canCopy: boolean;
  canPaste: boolean;
  canDelete: boolean;
  copySelectionToClipboard: () => void;
  pasteFromClipboard: () => void;
  deleteSelectionWithHistory: () => void;
  setCloneOpen: (v: boolean) => void;
  canGroup: boolean;
  canUngroup: boolean;
  canLock: boolean;
  canUnlock: boolean;
  canAlign: boolean;
  navigate: (path: string) => void;
}) {
  return (
    <div className="screen-editor-center">
      <WorkbenchTabs
        items={[
          {
            id: screen?.id ?? "screen",
            title: screen?.name ?? "Screen",
            active: true,
          },
        ]}
      />
      <WorkbenchPanelToolbar
        left={
          <>
            <WorkbenchButton onClick={() => void handleSaveProject()} disabled={!isProjectDirty || isSavingProject}>
              Save
            </WorkbenchButton>
            <WorkbenchButton onClick={undo} disabled={!canUndo}>↩</WorkbenchButton>
            <WorkbenchButton onClick={redo} disabled={!canRedo}>↪</WorkbenchButton>
          </>
        }
        center={
          <>
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("text"))}>Text</WorkbenchButton>
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("line"))}>Line</WorkbenchButton>
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("rectangle"))}>Rect</WorkbenchButton>
            <WorkbenchButton onClick={() => addPrimitiveShape("square")}>Square</WorkbenchButton>
            <WorkbenchButton onClick={() => addPrimitiveShape("circle")}>Circle</WorkbenchButton>
            <WorkbenchButton onClick={() => addPrimitiveShape("triangle")}>Triangle</WorkbenchButton>
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("button"))}>Button</WorkbenchButton>
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("switch"))}>Switch</WorkbenchButton>
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("value-display"))}>Value</WorkbenchButton>
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("state-indicator"))}>Indicator</WorkbenchButton>
          </>
        }
        right={
          <>
            <WorkbenchButton onClick={() => navigate("/runtime")}>▶ Preview</WorkbenchButton>
            <WorkbenchButton onClick={copySelectionToClipboard} disabled={!canCopy}>Copy</WorkbenchButton>
            <WorkbenchButton onClick={pasteFromClipboard} disabled={!canPaste}>Paste</WorkbenchButton>
            <WorkbenchButton variant="danger" onClick={deleteSelectionWithHistory} disabled={!canDelete}>Del</WorkbenchButton>
          </>
        }
      />
      <div style={{ padding: "4px 10px", display: "flex", gap: 4, flexWrap: "wrap", background: "#252526", borderBottom: "1px solid #3c3c3c" }}>
        <WorkbenchButton onClick={() => runCommand({ type: "makeSameWidth" })} disabled={!canSameSize}>W=</WorkbenchButton>
        <WorkbenchButton onClick={() => runCommand({ type: "makeSameHeight" })} disabled={!canSameSize}>H=</WorkbenchButton>
        <WorkbenchButton onClick={() => runCommand({ type: "makeSameSize" })} disabled={!canSameSize}>□=</WorkbenchButton>
        <WorkbenchButton onClick={() => runCommand({ type: "distributeHorizontally" })} disabled={!canDistribute}>↔</WorkbenchButton>
        <WorkbenchButton onClick={() => runCommand({ type: "distributeVertically" })} disabled={!canDistribute}>↕</WorkbenchButton>
        <WorkbenchButton onClick={() => runCommand({ type: "alignLeft" })} disabled={!canAlign}>⊣</WorkbenchButton>
        <WorkbenchButton onClick={() => runCommand({ type: "alignHorizontalCenter" })} disabled={!canAlign}>⟷</WorkbenchButton>
        <WorkbenchButton onClick={() => runCommand({ type: "alignRight" })} disabled={!canAlign}>⊢</WorkbenchButton>
        <WorkbenchButton onClick={() => runCommand({ type: "alignTop" })} disabled={!canAlign}>⊤</WorkbenchButton>
        <WorkbenchButton onClick={() => runCommand({ type: "alignVerticalCenter" })} disabled={!canAlign}>↕c</WorkbenchButton>
        <WorkbenchButton onClick={() => runCommand({ type: "alignBottom" })} disabled={!canAlign}>⊥</WorkbenchButton>
        <WorkbenchButton onClick={() => runCommand({ type: "groupSelected" })} disabled={!canGroup}>Group</WorkbenchButton>
        <WorkbenchButton onClick={() => runCommand({ type: "ungroupSelected" })} disabled={!canUngroup}>Ungroup</WorkbenchButton>
        <WorkbenchButton onClick={() => setCloneOpen(true)} disabled={!selectedUnlocked.length}>Clone</WorkbenchButton>
        <input
          className="workbench-input"
          type="number"
          value={spacingGap ?? ""}
          onChange={(e) => setSpacingGap(e.target.value ? Number(e.target.value) : undefined)}
          placeholder="Gap"
          style={{ width: 60 }}
        />
      </div>
      <div
        className="screen-editor-canvas-host"
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ visible: true, x: event.clientX, y: event.clientY });
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        {screen ? (
          <HmiStage
            project={project ?? undefined!}
            mode="editor"
            screen={screen}
            tags={tags}
            libraries={libraries}
            selectedObjectIds={selection.selectedObjectIds}
            activeObjectId={selection.activeObjectId}
            selectionRect={selectionRect}
            showObjectFrames={showObjectFrames}
            onSelectionRectChange={(rect) => setSelectionRect(rect)}
            onSelectObject={({ objectId, additive }) => {
              if (additive) {
                toggleSelectedObject(objectId);
              } else {
                setSelectedObjects([objectId], objectId);
              }
            }}
            onDoubleClickObject={() => setPropertiesOpen(true)}
            onContextMenuObject={({ objectId, clientX, clientY, additive }) => {
              if (additive) {
                toggleSelectedObject(objectId);
              } else {
                setSelectedObjects([objectId], objectId);
              }
              setContextMenu({ visible: true, x: clientX, y: clientY });
            }}
            onSelectObjects={(objectIds, activeId) => {
              setSelectedObjects(objectIds, activeId ?? "");
            }}
            onMoveObject={moveObjectWithHistory}
            onResizeObject={resizeObjectWithHistory}
          />
        ) : (
          <div className="screen-editor-empty-state">Select or create a screen</div>
        )}
      </div>
    </div>
  );
}

function ScreenEditorRightPanel({
  activeObject,
  screenObjects,
  selection,
  setSelectedObjects,
  setPropertiesOpen,
  removeObjectWithHistory,
  setSaveModalOpen,
}: {
  activeObject: HmiObject | null;
  screenObjects: HmiObject[];
  selection: any;
  setSelectedObjects: (ids: string[], activeId?: string) => void;
  setPropertiesOpen: (v: boolean) => void;
  removeObjectWithHistory: (id: string) => void;
  setSaveModalOpen: (v: boolean) => void;
}) {
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

function ScreenEditorBottomPanel({
  screen,
  activeObject,
  isProjectDirty,
  saveStatusText,
}: {
  screen: HmiScreen | null;
  activeObject: HmiObject | null;
  isProjectDirty: boolean;
  saveStatusText: string;
}) {
  return (
    <div className="screen-editor-bottom-panel">
      <div>[screen] {screen?.name ?? "-"} ({screen?.width ?? 0}x{screen?.height ?? 0})</div>
      <div>[objects] {screen?.objects.length ?? 0}</div>
      <div>[selected] {activeObject ? `${activeObject.id} (${activeObject.type})` : "-"}</div>
      <div>[save] {isProjectDirty ? "Unsaved changes" : saveStatusText}</div>
    </div>
  );
}

export function EditorPage() {
  const navigate = useNavigate();
  const project = useScadaStore((s) => s.project);
  const tags = useScadaStore((s) => s.tags);
  const assets = useScadaStore((s) => s.assets);
  const libraries = useScadaStore((s) => s.libraries);
  const currentScreenId = useScadaStore((s) => s.currentScreenId);
  const selection = useScadaStore((s) => s.selection);
  const setCurrentScreen = useScadaStore((s) => s.setCurrentScreen);
  const setSelectedObjects = useScadaStore((s) => s.setSelectedObjects);
  const toggleSelectedObject = useScadaStore((s) => s.toggleSelectedObject);
  const setSelectionRect = useScadaStore((s) => s.setSelectionRect);
  const executeCommand = useScadaStore((s) => s.executeCommand);
  const moveObject = useScadaStore((s) => s.moveObject);
  const resizeObject = useScadaStore((s) => s.resizeObject);
  const updateObject = useScadaStore((s) => s.updateObject);
  const setScreenObjects = useScadaStore((s) => s.setScreenObjects);
  const removeObject = useScadaStore((s) => s.removeObject);
  const removeSelectedUnlocked = useScadaStore((s) => s.removeSelectedUnlocked);
  const addObject = useScadaStore((s) => s.addObject);
  const addScreen = useScadaStore((s) => s.addScreen);
  const updateScreen = useScadaStore((s) => s.updateScreen);
  const addVariable = useScadaStore((s) => s.addVariable);
  const saveProject = useScadaStore((s) => s.saveProject);
  const loadProject = useScadaStore((s) => s.loadProject);
  const loadAssets = useScadaStore((s) => s.loadAssets);
  const loadLibraries = useScadaStore((s) => s.loadLibraries);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);

  const [newVarName, setNewVarName] = useState("Counter1");
  const [newVarType, setNewVarType] = useState<InternalVariableDefinition["dataType"]>("REAL");
  const [newScreenKind, setNewScreenKind] = useState<ScreenKind>("screen");
  const [newLibraryId, setNewLibraryId] = useState("custom-equipment");
  const [newLibraryName, setNewLibraryName] = useState("Пользовательская библиотека");
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveTargetLibraryId, setSaveTargetLibraryId] = useState("");
  const [saveElementName, setSaveElementName] = useState("Новый элемент");
  const [saveElementDescription, setSaveElementDescription] = useState("");
  const [saveElementCategory, setSaveElementCategory] = useState("General");
  const [assetUploadName, setAssetUploadName] = useState("");
  const [spacingGap, setSpacingGap] = useState<number | undefined>(undefined);
  const [showObjectFrames, setShowObjectFrames] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneOptions, setCloneOptions] = useState<CloneOptions>({
    count: 2,
    direction: "horizontal",
    gapX: 40,
    gapY: 40,
    tagMode: "incrementNumber",
    startIndex: 1,
    step: 1,
  });
  const [activeActivityId, setActiveActivityId] = useState<string>("explorer");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });
  const [objectClipboard, setObjectClipboard] = useState<HmiObject[]>([]);
  const [pasteIteration, setPasteIteration] = useState(0);
  const [screenSearch, setScreenSearch] = useState("");
  const [screenKindFilter, setScreenKindFilter] = useState<"all" | ScreenKind>("all");
  const [screenViewMode, setScreenViewMode] = useState<"grid" | "list">("grid");
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [saveStatusText, setSaveStatusText] = useState("Loaded");
  const [savedProjectSignature, setSavedProjectSignature] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [floatingLibraries, setFloatingLibraries] = useState<boolean>(false);
  const [floatingAssets, setFloatingAssets] = useState<boolean>(false);
  const [floatingLibRect, setFloatingLibRect] = useState({ x: 120, y: 120, width: 460, height: 520 });
  const [floatingAssetRect, setFloatingAssetRect] = useState({ x: 180, y: 160, width: 480, height: 520 });

  const screen = useMemo(
    () => project?.screens.find((s) => s.id === currentScreenId) ?? project?.screens[0],
    [currentScreenId, project],
  );

  const selectedObjects = useMemo(
    () => screen?.objects.filter((obj) => selection.selectedObjectIds.includes(obj.id)) ?? [],
    [screen?.objects, selection.selectedObjectIds],
  );
  const currentProjectSignature = useMemo(() => buildProjectSaveSignature(project), [project]);
  const selectedUnlocked = selectedObjects.filter((obj) => !obj.locked);
  const selectedGroups = selectedObjects.filter((obj) => obj.type === "group");
  const activeObject =
    (selection.activeObjectId ? selectedObjects.find((obj) => obj.id === selection.activeObjectId) : undefined) ??
    selectedObjects[0] ??
    null;
  const history = useSnapshotHistory<HmiObject[]>({ maxSteps: 50 });

  const captureObjects = useCallback((): HmiObject[] => structuredClone(screen?.objects ?? []), [screen?.objects]);

  const applyObjects = useCallback(
    (objects: HmiObject[]) => {
      if (!screen) {
        return;
      }
      setScreenObjects(screen.id, structuredClone(objects));
    },
    [screen, setScreenObjects],
  );

  const runWithHistory = useCallback(
    (label: string, mutate: () => void) => {
      if (!screen) {
        return;
      }
      const before = captureObjects();
      mutate();
      const latestProject = useScadaStore.getState().project;
      const latestScreen = latestProject?.screens.find((item) => item.id === screen.id);
      if (!latestScreen) {
        return;
      }
      history.pushEntry(label, before, latestScreen.objects);
    },
    [captureObjects, history, screen],
  );

  const copySelectionToClipboard = useCallback(() => {
    if (!selectedObjects.length) {
      return;
    }
    setObjectClipboard(selectedObjects.map((item) => structuredClone(item)));
    setPasteIteration(0);
    void message.success(`Copied ${selectedObjects.length} object(s)`);
  }, [selectedObjects]);

  const pasteFromClipboard = useCallback(() => {
    if (objectClipboard.length === 0 || !screen) {
      return;
    }
    const offsetStep = 20;
    const newIteration = pasteIteration + 1;
    const offsetX = offsetStep * newIteration;
    const offsetY = offsetStep * newIteration;
    const cloned = objectClipboard.map((item) => cloneForPaste(item, offsetX, offsetY));
    runWithHistory("Paste objects", () => {
      const currentScreen = useScadaStore.getState().project?.screens.find((item) => item.id === screen.id);
      if (!currentScreen) {
        return;
      }
      setScreenObjects(screen.id, [...currentScreen.objects, ...cloned]);
    });
    setPasteIteration(newIteration);
    void message.success(`Pasted ${cloned.length} object(s)`);
  }, [objectClipboard, pasteIteration, runWithHistory, screen, setScreenObjects]);

  const selectedCount = selectedObjects.length;
  const statusObject = activeObject;

  const updateObjectWithHistory = useCallback(
    (objectId: string, patch: Partial<HmiObject>, label: string) => {
      if (!screen) {
        return;
      }
      runWithHistory(label, () => updateObject(screen.id, objectId, patch));
    },
    [runWithHistory, screen, updateObject],
  );

  const removeObjectWithHistory = useCallback(
    (objectId: string) => {
      if (!screen) {
        return;
      }
      runWithHistory("Delete object", () => removeObject(screen.id, objectId));
      const nextSelection = selection.selectedObjectIds.filter((id) => id !== objectId);
      setSelectedObjects(nextSelection, nextSelection[0]);
    },
    [runWithHistory, screen, removeObject, selection.selectedObjectIds, setSelectedObjects],
  );

  const addObjectWithHistory = useCallback(
    (object: HmiObject) => {
      if (!screen) {
        return;
      }
      runWithHistory("Add object", () => addObject(screen.id, object));
      setSelectedObjects([object.id], object.id);
    },
    [addObject, runWithHistory, screen, setSelectedObjects],
  );

  const addPrimitiveShape = (kind: PrimitiveShapeKind) => {
    addObjectWithHistory(createPrimitiveShape(kind));
  };

  const addLibraryElementInstance = useCallback(
    (libraryId: string, elementOrId: LibraryElement | string) => {
      if (!screen) {
        return;
      }
      const elementId = typeof elementOrId === "string" ? elementOrId : elementOrId.id;
      const library = libraries.find((l) => l.id === libraryId);
      if (!library) {
        void message.warning(`Library not found: ${libraryId}`);
        return;
      }
      const element = library.elements.find((e: LibraryElement) => e.id === elementId);
      if (!element) {
        void message.warning(`Element not found: ${elementId}`);
        return;
      }
      const instance = createObjectByType("libraryElementInstance") as Extract<HmiObject, { type: "libraryElementInstance" }>;
      instance.libraryId = libraryId;
      instance.elementId = elementId;
      instance.width = element.width ?? 100;
      instance.height = element.height ?? 80;
      addObjectWithHistory(instance);
    },
    [addObjectWithHistory, libraries, screen],
  );

  const moveObjectWithHistory = useCallback(
    (objectId: string, x: number, y: number) => {
      runWithHistory("Move object", () => moveObject(screen?.id ?? "", objectId, x, y));
    },
    [moveObject, runWithHistory, screen?.id],
  );

  const resizeObjectWithHistory = useCallback(
    (objectId: string, patch: Partial<HmiObject>) => {
      runWithHistory("Resize object", () => resizeObject(screen?.id ?? "", objectId, patch));
    },
    [resizeObject, runWithHistory, screen?.id],
  );

  const isProjectDirty = currentProjectSignature !== savedProjectSignature && savedProjectSignature !== null;

  const canUndo = history.canUndo;
  const canRedo = history.canRedo;
  const canDelete = selectedUnlocked.length > 0;
  const canCopy = selectedObjects.length > 0;
  const canPaste = objectClipboard.length > 0;
  const canGroup = selectedObjects.length >= 2 || selectedGroups.length > 0;
  const canUngroup = selectedGroups.length > 0;
  const canLock = selectedObjects.some((obj) => !obj.locked);
  const canUnlock = selectedObjects.some((obj) => obj.locked);
  const canAlign = selectedUnlocked.length >= 2;
  const canSameSize = selectedUnlocked.length >= 2;
  const canDistribute = selectedUnlocked.length >= 2;

  const undo = useCallback(() => {
    if (!screen) {
      return;
    }
    const previous = history.undo(screen.objects);
    if (previous) {
      applyObjects(previous);
    }
  }, [applyObjects, history, screen]);

  const redo = useCallback(() => {
    if (!screen) {
      return;
    }
    const next = history.redo(screen.objects);
    if (next) {
      applyObjects(next);
    }
  }, [applyObjects, history, screen]);

  const deleteSelectionWithHistory = useCallback(() => {
    if (!screen) {
      return;
    }
    if (!selectedUnlocked.length) {
      void message.warning("No unlocked objects selected");
      return;
    }
    runWithHistory("Delete selection", () => {
      const unlockedIds = selectedUnlocked.map((obj) => obj.id);
      for (const id of unlockedIds) {
        removeObject(screen.id, id);
      }
    });
    setSelectedObjects([], undefined);
  }, [removeObject, runWithHistory, screen, selectedUnlocked, setSelectedObjects]);

  const handleSaveProject = useCallback(async () => {
    setIsSavingProject(true);
    try {
      await saveProject();
      setSaveStatusText("Saved");
      setSavedProjectSignature(currentProjectSignature);
      void message.success("Project saved");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setSaveStatusText("Save failed");
      void message.error(errorMessage || "Failed to save project");
    } finally {
      setIsSavingProject(false);
    }
  }, [currentProjectSignature, saveProject]);

  const runCommand = useCallback(
    (command: EditorCommand) => {
      if (!screen) {
        return;
      }
      if ("type" in command) {
        executeCommand(command);
      }
    },
    [executeCommand, screen],
  );

  const addAssetAsImage = useCallback(
    (asset: Asset) => {
      if (!screen) {
        return;
      }
      const image = createObjectByType("image") as Extract<HmiObject, { type: "image" }>;
      image.assetId = asset.id;
      image.width = asset.width ?? 80;
      image.height = asset.height ?? 80;
      addObjectWithHistory(image);
    },
    [addObjectWithHistory, screen],
  );

  const addSvgAssetAsPrimitives = useCallback(
    async (asset: Asset) => {
      if (!screen) {
        return;
      }
      try {
        const imported = await importSvgAssetToPrimitives(asset);
        const { groupBounds, normalizedObjects } = normalizeObjectsToGroup(imported.objects);
        const group: Extract<HmiObject, { type: "group" }> = {
          id: id("group"),
          type: "group",
          name: `svg:${asset.name}`,
          x: 10,
          y: 10,
          width: Math.max(1, groupBounds.width),
          height: Math.max(1, groupBounds.height),
          minWidth: 10,
          minHeight: 10,
          objects: normalizedObjects,
        };
        addObjectWithHistory(group);
        if (imported.warnings.length) {
          void message.warning(imported.warnings.join(" | "));
        } else {
          void message.success(`SVG imported as primitives: ${asset.name}`);
        }
      } catch (error) {
        void message.error(error instanceof Error ? error.message : "Failed to import SVG as primitives");
      }
    },
    [addObjectWithHistory, screen],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/web-scada-item");
      if (!raw) {
        return;
      }
      try {
        const payload = JSON.parse(raw) as
          | { kind: "asset"; assetId: string }
          | { kind: "library-element"; libraryId: string; elementId: string };
        if (payload.kind === "asset") {
          const asset = assets.find((a) => a.id === payload.assetId);
          if (asset) {
            addAssetAsImage(asset);
          }
        } else if (payload.kind === "library-element") {
          addLibraryElementInstance(payload.libraryId, payload.elementId);
        }
      } catch {
        // ignore
      }
    },
    [addAssetAsImage, addLibraryElementInstance, assets],
  );

  const duplicateScreenLocal = useCallback(
    (source: HmiScreen) => {
      if (!project) {
        return;
      }
      const copy: HmiScreen = {
        ...structuredClone(source),
        id: id("screen"),
        name: `${source.name} Copy`,
      };
      const existingScreens = useScadaStore.getState().project?.screens ?? [];
      const updatedProject = {
        ...project,
        screens: [...existingScreens, copy],
      } as ScadaProject;
      updateProjectJson(updatedProject);
      setScreenObjects(copy.id, copy.objects);
      setCurrentScreen(copy.id);
      void message.success(`Screen duplicated: ${copy.name}`);
    },
    [project, setCurrentScreen, setScreenObjects, updateProjectJson],
  );

  const deleteScreenLocal = useCallback(
    (screenId: string) => {
      const currentProject = useScadaStore.getState().project;
      if (!currentProject) {
        return;
      }
      const remaining = currentProject.screens.filter((item) => item.id !== screenId);
      if (remaining.length === currentProject.screens.length) {
        void message.warning("Screen not found");
        return;
      }
      Modal.confirm({
        title: "Delete screen",
        content: `Delete screen "${currentProject.screens.find((s) => s.id === screenId)?.name ?? screenId}" permanently?`,
        okText: "Delete",
        okButtonProps: { danger: true },
        onOk: () => {
          const latestProject = useScadaStore.getState().project;
          if (!latestProject) {
            return;
          }
          const nextScreens = latestProject.screens.filter((item) => item.id !== screenId);
          const nextProject = { ...latestProject, screens: nextScreens } as ScadaProject;
          const nextScreenId = nextScreens.length > 0 && nextScreens[0] ? nextScreens[0].id : "";
          updateProjectJson(nextProject);
          if (nextScreenId) {
            setCurrentScreen(nextScreenId);
          }
          void message.success("Screen deleted");
        },
      });
    },
    [setCurrentScreen, updateProjectJson],
  );

  const setStartScreen = useCallback(
    (screenId: string) => {
      if (!project) {
        return;
      }
      updateProjectJson({ ...project, startScreenId: screenId } as ScadaProject);
      void message.success("Start screen updated");
    },
    [project, updateProjectJson],
  );

  const createLibrary = useCallback(async () => {
    if (!newLibraryId.trim()) {
      void message.warning("Library ID is required");
      return;
    }
    try {
      await api.createLibrary({ id: newLibraryId.trim(), name: newLibraryName.trim() || newLibraryId.trim() });
      await loadLibraries();
      void message.success("Library created");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to create library");
    }
  }, [loadLibraries, newLibraryId, newLibraryName]);

  const attachLibrary = useCallback(
    async (libraryId: string) => {
      try {
        const next = await api.attachLibrary(libraryId);
        updateProjectJson(next);
        void message.success("Library attached");
      } catch (error) {
        void message.error(error instanceof Error ? error.message : "Failed to attach library");
      }
    },
    [updateProjectJson],
  );

  const detachLibrary = useCallback(
    async (libraryId: string) => {
      Modal.confirm({
        title: "Detach library",
        content: "Remove this library from the project? Library file will not be deleted.",
        okText: "Detach",
        onOk: async () => {
          try {
            const next = await api.detachLibrary(libraryId);
            updateProjectJson(next);
            void message.success("Library detached");
          } catch (error) {
            void message.error(error instanceof Error ? error.message : "Failed to detach library");
          }
        },
      });
    },
    [updateProjectJson],
  );

  const enabledLibraryRefs = useMemo(
    () => (project?.libraries ?? []).filter((ref) => ref.enabled),
    [project?.libraries],
  );

  const onUploadProjectAsset = useCallback(
    async (file: File) => {
      try {
        if (!project) {
          return;
        }
        const formData = new FormData();
        formData.append("file", file);
        if (assetUploadName.trim()) {
          formData.append("name", assetUploadName.trim());
        }
        const result = await fetch("/api/assets/upload", {
          method: "POST",
          body: formData,
        });
        if (!result.ok) {
          throw new Error("Upload failed");
        }
        await loadAssets();
        await loadProject();
        setAssetUploadName("");
        void message.success("Asset uploaded");
      } catch (error) {
        void message.error(error instanceof Error ? error.message : "Failed to upload asset");
      }
    },
    [assetUploadName, loadAssets, loadProject, project],
  );

  const onSaveSelectionAsLibraryElement = useCallback(async () => {
    if (!saveTargetLibraryId) {
      void message.warning("Select library");
      return;
    }
    if (!saveElementName.trim()) {
      void message.warning("Element name is required");
      return;
    }
    const now = new Date().toISOString();
    const element: LibraryElement = {
      id: id("element"),
      elementKey: saveElementName.trim(),
      name: saveElementName.trim(),
      description: saveElementDescription.trim(),
      category: saveElementCategory.trim(),
      width: screen?.width ?? 220,
      height: screen?.height ?? 120,
      objects: structuredClone(selectedObjects),
      bindings: [],
      parameters: [],
      stateRules: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      const copiedObjects = await copySelectionAssetsToLibrary(element.objects, assets, saveTargetLibraryId);
      element.objects = copiedObjects;
      await api.createLibraryElement(saveTargetLibraryId, element);
      await loadLibraries();
      setSaveModalOpen(false);
      void message.success("Element saved to library");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to save element");
    }
  }, [assets, loadLibraries, saveElementCategory, saveElementDescription, saveElementName, saveTargetLibraryId, screen?.height, screen?.width, selectedObjects]);

  const filteredScreens = useMemo(() => {
    const list = project?.screens ?? [];
    const term = screenSearch.trim().toLowerCase();
    const byKind = screenKindFilter === "all" ? list : list.filter((item) => item.kind === screenKindFilter);
    if (!term) {
      return byKind;
    }
    return byKind.filter((item) => item.name.toLowerCase().includes(term));
  }, [project?.screens, screenKindFilter, screenSearch]);

  const adjustPrimitiveStrokeWidth = useCallback(
    (delta: number) => {
      if (!screen) {
        return;
      }
      for (const obj of selectedUnlocked) {
        if ("strokeWidth" in obj) {
          const current = (obj as any).strokeWidth ?? 1;
          updateObjectWithHistory(obj.id, { strokeWidth: Math.max(0.5, current + delta) }, "Adjust stroke width");
        }
      }
    },
    [screen, selectedUnlocked, updateObjectWithHistory],
  );

  const applyClone = useCallback(() => {
    if (!screen) {
      return;
    }
    const selected = structuredClone(selectedUnlocked);
    if (!selected.length) {
      return;
    }
    const offsetX = cloneOptions.direction === "horizontal" ? (selected[0]?.width ?? 40) + cloneOptions.gapX : 0;
    const offsetY = cloneOptions.direction === "vertical" ? (selected[0]?.height ?? 40) + cloneOptions.gapY : 0;
    let allCloned: HmiObject[] = [];
    for (let i = 0; i < cloneOptions.count; i++) {
      const clones = selected.map((obj) => cloneObject(obj, cloneOptions.startIndex + i, cloneOptions, offsetX * (i + 1), offsetY * (i + 1)));
      allCloned = [...allCloned, ...clones];
    }
    runWithHistory("Clone objects", () => {
      const currentScreen = useScadaStore.getState().project?.screens.find((item) => item.id === screen.id);
      if (!currentScreen) {
        return;
      }
      setScreenObjects(screen.id, [...currentScreen.objects, ...allCloned]);
    });
    setCloneOpen(false);
    void message.success(`Cloned ${allCloned.length} object(s)`);
  }, [cloneOptions, runWithHistory, screen, selectedUnlocked, setScreenObjects]);

  useEffect(() => {
    if (!project) {
      return;
    }
    if (!currentScreenId) {
      const first = project.screens[0];
      if (first) {
        setCurrentScreen(first.id);
      }
    }
  }, [currentScreenId, project, setCurrentScreen]);

  useEffect(() => {
    if (!project) {
      return;
    }
    const signature = buildProjectSaveSignature(project);
    if (savedProjectSignature === null) {
      setSavedProjectSignature(signature);
    }
  }, [project, savedProjectSignature]);

  useEffect(() => {
    if (!isProjectDirty) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isProjectDirty]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!screen) {
        return;
      }
      const ctrlOrMeta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const editing = isTextEditingTarget(event.target);

      if (ctrlOrMeta && key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (ctrlOrMeta && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        redo();
        return;
      }
      if (ctrlOrMeta && key === "s") {
        event.preventDefault();
        void handleSaveProject();
        return;
      }
      if (ctrlOrMeta && key === "c") {
        if (!editing) {
          copySelectionToClipboard();
        }
        return;
      }
      if (ctrlOrMeta && key === "v") {
        if (!editing) {
          pasteFromClipboard();
        }
        return;
      }
      if (!editing && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        deleteSelectionWithHistory();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copySelectionToClipboard, deleteSelectionWithHistory, handleSaveProject, pasteFromClipboard, redo, screen, undo]);

  if (!project) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <Typography.Text>Project is not loaded</Typography.Text>
      </div>
    );
  }

  if (!screen) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <Typography.Text>No screens available. Create a screen first.</Typography.Text>
      </div>
    );
  }

  const {
    openWindows,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindow,
    resizeWindow,
    isWindowOpen,
  } = useWorkbenchWindows();

  const windowDefinitions: WorkbenchWindowDefinition[] = [
    {
      id: "tags",
      title: "Tags",
      defaultRect: { x: 120, y: 80, width: 520, height: 520 },
      minWidth: 360,
      minHeight: 260,
      render: () => (
        <div className="screen-editor-window-content">
          <WorkbenchSection title="TAGS">
            <div className="screen-editor-empty-state">
              Tags workspace placeholder. Real tag tree will be moved here next.
            </div>
          </WorkbenchSection>
        </div>
      ),
    },
    {
      id: "drivers",
      title: "Drivers / OPC UA / Simulation",
      defaultRect: { x: 160, y: 100, width: 560, height: 460 },
      minWidth: 380,
      minHeight: 260,
      render: () => (
        <div className="screen-editor-window-content">
          <WorkbenchSection title="OPC UA & SIMULATION">
            <div className="screen-editor-empty-state">
              Drivers settings placeholder. Real settings will be moved here next.
            </div>
          </WorkbenchSection>
        </div>
      ),
    },
    {
      id: "assets",
      title: "Assets",
      defaultRect: { x: 180, y: 120, width: 560, height: 520 },
      minWidth: 380,
      minHeight: 280,
      render: () => (
        <div className="screen-editor-window-content">
          <WorkbenchSection title="ASSETS">
            <div className="screen-editor-empty-state">
              Assets workspace placeholder. Real assets manager will be moved here next.
            </div>
          </WorkbenchSection>
        </div>
      ),
    },
    {
      id: "libraries",
      title: "Libraries",
      defaultRect: { x: 200, y: 140, width: 560, height: 520 },
      minWidth: 380,
      minHeight: 280,
      render: () => (
        <div className="screen-editor-window-content">
          <WorkbenchSection title="LIBRARIES">
            <div className="screen-editor-empty-state">
              Libraries workspace placeholder. Real libraries manager will be moved here next.
            </div>
          </WorkbenchSection>
        </div>
      ),
    },
  ];

  const openDefinedWindow = (id: string) => {
    const definition = windowDefinitions.find((item) => item.id === id);
    if (definition) {
      openWindow(definition);
    }
  };

  const activityItems = [
    { id: "explorer", title: "Explorer", icon: "📁", active: activeActivityId === "explorer", onClick: () => setActiveActivityId("explorer") },
    { id: "search", title: "Search", icon: "🔎", active: activeActivityId === "search", onClick: () => setActiveActivityId("search") },
    { id: "tags", title: "Tags", icon: "🏷️", active: isWindowOpen("tags"), onClick: () => openDefinedWindow("tags") },
    { id: "assets", title: "Assets", icon: "🧩", active: isWindowOpen("assets"), onClick: () => openDefinedWindow("assets") },
    { id: "libraries", title: "Libraries", icon: "📚", active: isWindowOpen("libraries"), onClick: () => openDefinedWindow("libraries") },
    { id: "drivers", title: "Drivers", icon: "⚙️", active: isWindowOpen("drivers"), onClick: () => openDefinedWindow("drivers") },
    { id: "runtime", title: "Runtime", icon: "▶️", active: activeActivityId === "runtime", onClick: () => setActiveActivityId("runtime") },
  ];

  return (
    <div className="screen-editor-workbench-page">
      <ScadaWorkbenchLayout
        autoSaveId="my-web-scada-screen-editor"
        leftTitle="Explorer"
        rightTitle="Properties"
        bottomTitle="Terminal"
        activityItems={activityItems}
        leftPanel={{
          defaultSize: 20,
          minSize: 14,
          maxSize: 36,
          collapsible: true,
          collapsedSize: 0,
        }}
        rightPanel={{
          defaultSize: 24,
          minSize: 14,
          maxSize: 42,
          collapsible: true,
          collapsedSize: 0,
        }}
        bottomPanel={{
          defaultSize: 18,
          minSize: 8,
          maxSize: 36,
          collapsible: true,
          collapsedSize: 0,
        }}
        left={
          <ScreenEditorLeftPanel
            screen={screen}
            project={project}
            libraries={libraries}
            assets={assets}
            screenSearch={screenSearch}
            setScreenSearch={setScreenSearch}
            screenKindFilter={screenKindFilter}
            setScreenKindFilter={setScreenKindFilter}
            screenViewMode={screenViewMode}
            setScreenViewMode={setScreenViewMode}
            filteredScreens={filteredScreens}
            newScreenKind={newScreenKind}
            setNewScreenKind={setNewScreenKind}
            newVarName={newVarName}
            setNewVarName={setNewVarName}
            newVarType={newVarType}
            setNewVarType={setNewVarType}
            addVariable={addVariable}
            addScreen={addScreen}
            setCurrentScreen={setCurrentScreen}
            duplicateScreenLocal={duplicateScreenLocal}
            setStartScreen={setStartScreen}
            deleteScreenLocal={deleteScreenLocal}
            assetUploadName={assetUploadName}
            setAssetUploadName={setAssetUploadName}
            uploadInputRef={uploadInputRef}
            onUploadProjectAsset={onUploadProjectAsset}
            addAssetAsImage={addAssetAsImage}
            activeActivityId={activeActivityId}
            navigate={navigate}
            newLibraryId={newLibraryId}
            setNewLibraryId={setNewLibraryId}
            newLibraryName={newLibraryName}
            setNewLibraryName={setNewLibraryName}
            createLibrary={createLibrary}
            loadLibraries={loadLibraries}
            attachLibrary={attachLibrary}
            addLibraryElementInstance={addLibraryElementInstance}
          />
        }
        center={
          <ScreenEditorCenter
            screen={screen}
            project={project}
            tags={tags}
            libraries={libraries}
            selection={selection}
            selectionRect={selection.selectionRect}
            showObjectFrames={showObjectFrames}
            setSelectionRect={setSelectionRect}
            toggleSelectedObject={toggleSelectedObject}
            setSelectedObjects={setSelectedObjects}
            setPropertiesOpen={setPropertiesOpen}
            setContextMenu={setContextMenu}
            handleDrop={handleDrop}
            moveObjectWithHistory={moveObjectWithHistory}
            resizeObjectWithHistory={resizeObjectWithHistory}
            undo={undo}
            redo={redo}
            handleSaveProject={handleSaveProject}
            isProjectDirty={isProjectDirty}
            isSavingProject={isSavingProject}
            canUndo={canUndo}
            canRedo={canRedo}
            addObjectWithHistory={addObjectWithHistory}
            addPrimitiveShape={addPrimitiveShape}
            adjustPrimitiveStrokeWidth={adjustPrimitiveStrokeWidth}
            selectedUnlocked={selectedUnlocked}
            runCommand={runCommand}
            canSameSize={canSameSize}
            canDistribute={canDistribute}
            spacingGap={spacingGap}
            setSpacingGap={setSpacingGap}
            canCopy={canCopy}
            canPaste={canPaste}
            canDelete={canDelete}
            copySelectionToClipboard={copySelectionToClipboard}
            pasteFromClipboard={pasteFromClipboard}
            deleteSelectionWithHistory={deleteSelectionWithHistory}
            setCloneOpen={setCloneOpen}
            canGroup={canGroup}
            canUngroup={canUngroup}
            canLock={canLock}
            canUnlock={canUnlock}
            canAlign={canAlign}
            navigate={navigate}
          />
        }
        right={
          <ScreenEditorRightPanel
            activeObject={activeObject}
            screenObjects={screen.objects}
            selection={selection}
            setSelectedObjects={setSelectedObjects}
            setPropertiesOpen={setPropertiesOpen}
            removeObjectWithHistory={removeObjectWithHistory}
            setSaveModalOpen={setSaveModalOpen}
          />
        }
        bottom={
          <ScreenEditorBottomPanel
            screen={screen}
            activeObject={activeObject}
            isProjectDirty={isProjectDirty}
            saveStatusText={saveStatusText}
          />
        }
      />

      <WorkbenchWindowManager
        windows={openWindows}
        definitions={windowDefinitions}
        onClose={closeWindow}
        onFocus={focusWindow}
        onMove={moveWindow}
        onResize={resizeWindow}
      />

      <Modal
        title="Save As Library Element"
        open={saveModalOpen}
        onCancel={() => setSaveModalOpen(false)}
        onOk={() => void onSaveSelectionAsLibraryElement()}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select
            value={saveTargetLibraryId}
            onChange={setSaveTargetLibraryId}
            placeholder="Select library"
            options={libraries.map((item) => ({ label: item.name, value: item.id }))}
          />
          <Input value={saveElementName} onChange={(e) => setSaveElementName(e.target.value)} placeholder="Element name" />
          <Input value={saveElementDescription} onChange={(e) => setSaveElementDescription(e.target.value)} placeholder="Description" />
          <Input value={saveElementCategory} onChange={(e) => setSaveElementCategory(e.target.value)} placeholder="Category" />
        </Space>
      </Modal>

      <Modal
        title="Object Properties"
        open={propertiesOpen}
        width={740}
        onCancel={() => setPropertiesOpen(false)}
        onOk={() => setPropertiesOpen(false)}
      >
        <ObjectPropertyPanel
          project={project}
          screen={screen}
          assets={assets}
          libraries={libraries}
          object={activeObject}
          onPatch={(patch) => {
            if (!activeObject) {
              return;
            }
            updateObjectWithHistory(activeObject.id, patch, "Object properties change");
          }}
          onDelete={() => {
            if (!activeObject) {
              return;
            }
            if (activeObject.locked) {
              void message.warning("Locked object cannot be deleted");
              return;
            }
            removeObjectWithHistory(activeObject.id);
            setPropertiesOpen(false);
          }}
        />
      </Modal>

      <Modal
        title="Clone"
        open={cloneOpen}
        onCancel={() => setCloneOpen(false)}
        onOk={applyClone}
      >
        <Form layout="vertical">
          <Form.Item label="Count">
            <InputNumber min={1} value={cloneOptions.count} onChange={(value) => setCloneOptions((prev) => ({ ...prev, count: Number(value ?? 1) }))} />
          </Form.Item>
          <Form.Item label="Direction">
            <Select
              value={cloneOptions.direction}
              options={[
                { label: "horizontal", value: "horizontal" },
                { label: "vertical", value: "vertical" },
              ]}
              onChange={(value) => setCloneOptions((prev) => ({ ...prev, direction: value }))}
            />
          </Form.Item>
          <Form.Item label="Gap X / Gap Y">
            <Space>
              <InputNumber value={cloneOptions.gapX} onChange={(value) => setCloneOptions((prev) => ({ ...prev, gapX: Number(value ?? 0) }))} />
              <InputNumber value={cloneOptions.gapY} onChange={(value) => setCloneOptions((prev) => ({ ...prev, gapY: Number(value ?? 0) }))} />
            </Space>
          </Form.Item>
          <Form.Item label="Tag mode">
            <Select
              value={cloneOptions.tagMode}
              options={[
                { label: "keepSameTags", value: "keepSameTags" },
                { label: "addPrefix", value: "addPrefix" },
                { label: "replacePrefix", value: "replacePrefix" },
                { label: "incrementNumber", value: "incrementNumber" },
              ]}
              onChange={(value) => setCloneOptions((prev) => ({ ...prev, tagMode: value }))}
            />
          </Form.Item>
          <Form.Item label="Prefix/Replace">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input value={cloneOptions.tagPrefix} placeholder="tagPrefix" onChange={(e) => setCloneOptions((prev) => ({ ...prev, tagPrefix: e.target.value }))} />
              <Input value={cloneOptions.tagReplaceFrom} placeholder="replace from" onChange={(e) => setCloneOptions((prev) => ({ ...prev, tagReplaceFrom: e.target.value }))} />
              <Input value={cloneOptions.tagReplaceTo} placeholder="replace to" onChange={(e) => setCloneOptions((prev) => ({ ...prev, tagReplaceTo: e.target.value }))} />
            </Space>
          </Form.Item>
          <Form.Item label="Start / Step">
            <Space>
              <InputNumber value={cloneOptions.startIndex} onChange={(value) => setCloneOptions((prev) => ({ ...prev, startIndex: Number(value ?? 1) }))} />
              <InputNumber value={cloneOptions.step} onChange={(value) => setCloneOptions((prev) => ({ ...prev, step: Number(value ?? 1) }))} />
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {floatingLibraries || floatingAssets ? (
        <div className="floating-layer">
          {floatingLibraries ? (
            <FloatingPanel
              title="Library Directory"
              rect={floatingLibRect}
              onRectChange={setFloatingLibRect}
              onClose={() => setFloatingLibraries(false)}
            >
              <Space direction="vertical" style={{ width: "100%" }}>
                <Space>
                  <Button size="small" onClick={() => void loadLibraries()}>Refresh</Button>
                  <Button size="small" onClick={() => setFloatingLibraries(false)}>Dock</Button>
                </Space>
                <Input value={newLibraryId} onChange={(e) => setNewLibraryId(e.target.value)} placeholder="library id" />
                <Input value={newLibraryName} onChange={(e) => setNewLibraryName(e.target.value)} placeholder="library name" />
                <Button size="small" onClick={() => void createLibrary()}>Create Library</Button>
                <List
                  size="small"
                  dataSource={libraries}
                  renderItem={(library) => (
                    <List.Item actions={[<Button size="small" onClick={() => void attachLibrary(library.id)}>Attach</Button>]}>
                      {library.name}
                    </List.Item>
                  )}
                />
                <Divider style={{ margin: "8px 0" }} />
                <Typography.Text strong>Elements</Typography.Text>
                {enabledLibraryRefs.map((ref) => {
                  const library = libraries.find((item) => item.id === ref.libraryId);
                  if (!library) {
                    return null;
                  }
                  return (
                    <List
                      key={library.id}
                      size="small"
                      dataSource={library.elements}
                      renderItem={(element) => (
                        <List.Item
                          draggable
                          onDragStart={(event) =>
                            event.dataTransfer.setData(
                              "application/web-scada-item",
                              JSON.stringify({ kind: "library-element", libraryId: library.id, elementId: element.id }),
                            )
                          }
                          actions={[<Button size="small" onClick={() => addLibraryElementInstance(library.id, element)}>Add</Button>]}
                        >
                          {element.name}
                        </List.Item>
                      )}
                    />
                  );
                })}
              </Space>
            </FloatingPanel>
          ) : null}

          {floatingAssets ? (
            <FloatingPanel
              title="Asset Manager"
              rect={floatingAssetRect}
              onRectChange={setFloatingAssetRect}
              onClose={() => setFloatingAssets(false)}
            >
              <Space direction="vertical" style={{ width: "100%" }}>
                <Space>
                  <Button size="small" onClick={() => uploadInputRef.current?.click()}>Upload</Button>
                  <Button size="small" onClick={() => void loadAssets()}>Refresh</Button>
                  <Button size="small" onClick={() => setFloatingAssets(false)}>Dock</Button>
                </Space>
                <Input value={assetUploadName} onChange={(e) => setAssetUploadName(e.target.value)} placeholder="Asset name" />
                <List
                  size="small"
                  dataSource={assets}
                  renderItem={(asset) => (
                    <List.Item
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          "application/web-scada-item",
                          JSON.stringify({ kind: "asset", assetId: asset.id }),
                        );
                      }}
                      actions={[
                        <Button size="small" onClick={() => addAssetAsImage(asset)}>Add</Button>,
                        <Button size="small" danger onClick={() => void api.deleteAsset(asset.id).then(() => Promise.all([loadAssets(), loadProject()]))}>Delete</Button>,
                      ]}
                    >
                      <Space>
                        <img src={asset.previewUrl} alt={asset.name} style={{ width: 24, height: 24, objectFit: "cover" }} />
                        <span>{asset.name}</span>
                      </Space>
                    </List.Item>
                  )}
                />
              </Space>
            </FloatingPanel>
          ) : null}
        </div>
      ) : null}

      {contextMenu.visible ? (
        <div
          className="screen-editor-context-menu"
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 2000,
          }}
          onMouseLeave={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
        >
          <Space direction="vertical" style={{ width: "100%" }}>
            <Button type="text" size="small" block onClick={() => setPropertiesOpen(true)} disabled={!activeObject}>Properties</Button>
            <Button type="text" size="small" block onClick={copySelectionToClipboard} disabled={!canCopy}>Copy</Button>
            <Button type="text" size="small" block onClick={pasteFromClipboard} disabled={!canPaste}>Paste</Button>
            <Button type="text" size="small" block onClick={() => setCloneOpen(true)} disabled={!selectedUnlocked.length}>Clone...</Button>
            <Button type="text" size="small" danger block onClick={deleteSelectionWithHistory} disabled={!selectedUnlocked.length}>Delete</Button>
            <Button type="text" size="small" block onClick={() => runCommand({ type: "groupSelected" })} disabled={!canGroup}>Group</Button>
            <Button type="text" size="small" block onClick={() => runCommand({ type: "ungroupSelected" })} disabled={!canUngroup}>Ungroup</Button>
            <Button type="text" size="small" block onClick={() => runCommand({ type: "lockSelected" })} disabled={!canLock}>Lock</Button>
            <Button type="text" size="small" block onClick={() => runCommand({ type: "unlockSelected" })} disabled={!canUnlock}>Unlock</Button>
            <Button type="text" size="small" block onClick={() => adjustPrimitiveStrokeWidth(-1)} disabled={!selectedUnlocked.length}>Stroke -1</Button>
            <Button type="text" size="small" block onClick={() => adjustPrimitiveStrokeWidth(1)} disabled={!selectedUnlocked.length}>Stroke +1</Button>
            <Button type="text" size="small" block onClick={() => runCommand({ type: "alignLeft" })} disabled={!canAlign}>Align Left</Button>
            <Button type="text" size="small" block onClick={() => runCommand({ type: "makeSameSize" })} disabled={!canSameSize}>Same Size</Button>
            <Button type="text" size="small" block onClick={() => runCommand({ type: "distributeHorizontally" })} disabled={!canDistribute}>Distribute H</Button>
          </Space>
        </div>
      ) : null}

      <input
        ref={uploadInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (file) {
            void onUploadProjectAsset(file);
          }
        }}
      />
    </div>
  );
}

function cloneObject(
  source: HmiObject,
  index: number,
  options: CloneOptions,
  offsetX: number,
  offsetY: number,
): HmiObject {
  const cloned = structuredClone(source) as HmiObject;
  const withId: HmiObject = regenerateIds({
    ...cloned,
    id: id(cloned.type),
    x: cloned.x + offsetX,
    y: cloned.y + offsetY,
    name: cloned.name ? `${cloned.name}_${index}` : cloned.name,
  });
  return remapTagFields(withId, (tag) => applyTagRule(tag, options, index));
}

function buildProjectSaveSignature(project: ScadaProject | null | undefined): string {
  if (!project) {
    return "";
  }
  const snapshot = {
    ...project,
    editorSettings: undefined,
  };
  return JSON.stringify(snapshot);
}

function cloneForPaste(source: HmiObject, offsetX: number, offsetY: number): HmiObject {
  const cloned = structuredClone(source) as HmiObject;
  const shifted: HmiObject = {
    ...cloned,
    id: id(cloned.type),
    x: cloned.x + offsetX,
    y: cloned.y + offsetY,
  };
  return regenerateIds(shifted);
}

function regenerateIds(object: HmiObject): HmiObject {
  if (object.type !== "group") {
    return object;
  }
  return {
    ...object,
    objects: object.objects.map((child) =>
      regenerateIds({
        ...child,
        id: id(child.type),
      }),
    ),
  };
}

function applyTagRule(tag: string, options: CloneOptions, index: number): string {
  if (options.tagMode === "keepSameTags") {
    return tag;
  }
  if (options.tagMode === "addPrefix") {
    const prefix = options.tagPrefix?.trim() ?? "";
    if (!prefix) {
      return tag;
    }
    return tag.startsWith(".") ? `${prefix}${tag}` : `${prefix}.${tag}`;
  }
  if (options.tagMode === "replacePrefix") {
    const from = options.tagReplaceFrom ?? "";
    const to = options.tagReplaceTo ?? "";
    if (!from || !tag.startsWith(from)) {
      return tag;
    }
    return `${to}${tag.slice(from.length)}`;
  }
  return tag.replace(/\d+(?!.*\d)/, (token) => String(Number(token) + index));
}

function remapTagFields(object: HmiObject, map: (tag: string) => string): HmiObject {
  const cloned = structuredClone(object) as HmiObject;

  const remapAction = (action: RuntimeAction): RuntimeAction => {
    if (action.type === "write" || action.type === "pulse" || action.type === "toggle") {
      return { ...action, tag: map(action.tag) };
    }
    if ((action.type === "writeConst" || action.type === "writeNumberPrompt") && action.target === "tag") {
      return { ...action, name: map(action.name) };
    }
    return action;
  };

  if (cloned.type === "value-display" || cloned.type === "value-input" || cloned.type === "state-indicator" || cloned.type === "switch") {
    cloned.tag = map(cloned.tag);
  }

  if (cloned.type === "image") {
    if (cloned.stateTag) {
      cloned.stateTag = map(cloned.stateTag);
    }
    if (cloned.action) {
      cloned.action = remapAction(cloned.action);
    }
  }

  if (cloned.type === "stateImage") {
    cloned.tag = map(cloned.tag);
    if (cloned.action) {
      cloned.action = remapAction(cloned.action);
    }
  }

  if (cloned.type === "button") {
    cloned.action = remapAction(cloned.action);
  }

  if (cloned.type === "valueSelect" && cloned.target.type === "tag") {
    cloned.target = {
      ...cloned.target,
      tag: map(cloned.target.tag),
    };
  }

  if (cloned.type === "frame" && cloned.tagPrefix) {
    cloned.tagPrefix = map(cloned.tagPrefix);
  }

  if (cloned.type === "libraryElementInstance" && cloned.tagPrefix) {
    cloned.tagPrefix = map(cloned.tagPrefix);
  }
  if (cloned.type === "libraryElementInstance" && cloned.action) {
    cloned.action = remapAction(cloned.action);
  }

  if (cloned.type === "group") {
    cloned.objects = cloned.objects.map((child) => remapTagFields(child, map));
  }

  return cloned;
}

async function copySelectionAssetsToLibrary(
  objects: HmiObject[],
  projectAssets: Asset[],
  libraryId: string,
): Promise<HmiObject[]> {
  const assetIds = [...new Set(objects.flatMap((obj) => collectAssetIds(obj)))];
  if (!assetIds.length) {
    return objects;
  }

  const mappedIds = new Map<string, string>();
  for (const assetId of assetIds) {
    const asset = projectAssets.find((item) => item.id === assetId);
    if (!asset) {
      continue;
    }
    const fileResponse = await fetch(asset.previewUrl);
    const blob = await fileResponse.blob();
    const file = new File([blob], asset.fileName, { type: asset.mimeType });
    const uploaded = await api.uploadLibraryAsset(libraryId, file, asset.name);
    mappedIds.set(assetId, uploaded.id);
  }

  return objects.map((obj) => replaceAssetIds(obj, mappedIds));
}

function replaceAssetIds(object: HmiObject, mappedIds: Map<string, string>): HmiObject {
  if (object.type === "image") {
    return {
      ...object,
      assetId: object.assetId ? mappedIds.get(object.assetId) ?? object.assetId : undefined,
      stateImages: object.stateImages?.map((state) => ({
        ...state,
        assetId: state.assetId ? mappedIds.get(state.assetId) ?? state.assetId : undefined,
      })),
    };
  }
  if (object.type === "stateImage") {
    return {
      ...object,
      defaultAssetId: object.defaultAssetId ? mappedIds.get(object.defaultAssetId) ?? object.defaultAssetId : undefined,
      badQualityAssetId: object.badQualityAssetId
        ? mappedIds.get(object.badQualityAssetId) ?? object.badQualityAssetId
        : undefined,
      states: object.states.map((state) => ({
        ...state,
        assetId: mappedIds.get(state.assetId) ?? state.assetId,
      })),
    };
  }
  if (object.type === "button") {
    return {
      ...object,
      backgroundAssetId: object.backgroundAssetId
        ? mappedIds.get(object.backgroundAssetId) ?? object.backgroundAssetId
        : undefined,
      pressedBackgroundAssetId: object.pressedBackgroundAssetId
        ? mappedIds.get(object.pressedBackgroundAssetId) ?? object.pressedBackgroundAssetId
        : undefined,
      disabledBackgroundAssetId: object.disabledBackgroundAssetId
        ? mappedIds.get(object.disabledBackgroundAssetId) ?? object.disabledBackgroundAssetId
        : undefined,
    };
  }
  return {
    ...object,
  };
}

function collectAssetIds(object: HmiObject): string[] {
  if (object.type === "image") {
    const ids: string[] = [];
    if (object.assetId) {
      ids.push(object.assetId);
    }
    for (const state of object.stateImages ?? []) {
      if (state.assetId) {
        ids.push(state.assetId);
      }
    }
    return ids;
  }
  if (object.type === "stateImage") {
    const ids: string[] = [];
    if (object.defaultAssetId) {
      ids.push(object.defaultAssetId);
    }
    if (object.badQualityAssetId) {
      ids.push(object.badQualityAssetId);
    }
    for (const state of object.states) {
      ids.push(state.assetId);
    }
    return ids;
  }
  if (object.type === "button") {
    return [object.backgroundAssetId, object.pressedBackgroundAssetId, object.disabledBackgroundAssetId].filter(
      (v): v is string => Boolean(v),
    );
  }
  return [];
}

function computeBounds(objects: HmiObject[]): { minX: number; minY: number; width: number; height: number } {
  const minX = Math.min(...objects.map((obj) => obj.x));
  const minY = Math.min(...objects.map((obj) => obj.y));
  const maxX = Math.max(...objects.map((obj) => obj.x + obj.width));
  const maxY = Math.max(...objects.map((obj) => obj.y + obj.height));
  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function normalizeObjects(objects: HmiObject[]): HmiObject[] {
  const bounds = computeBounds(objects);
  return objects.map((obj) => ({
    ...obj,
    id: id(obj.type.replace(/[^a-z0-9]/gi, "_")),
    x: obj.x - bounds.minX,
    y: obj.y - bounds.minY,
  }));
}

function slugify(input: string): string {
  const clean = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || `element-${Math.random().toString(36).slice(2, 8)}`;
}
