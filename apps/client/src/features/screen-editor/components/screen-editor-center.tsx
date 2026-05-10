import { type DragEvent } from "react";
import { HmiStage } from "../../../hmi/runtime/hmi-stage";
import { createObjectByType } from "../../../hmi/editor/default-object-factory";
import {
  WorkbenchButton,
  WorkbenchPanelToolbar,
  WorkbenchTabs,
} from "../../../components/workbench";
import type { EditorCommand, HmiObject, HmiScreen, ScadaProject } from "@web-scada/shared";

type PrimitiveShapeKind = "square" | "circle" | "triangle";

export type ScreenEditorCenterProps = {
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
  onOpenObjectProperties: () => void;
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
};

export function ScreenEditorCenter({
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
  onOpenObjectProperties,
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
}: ScreenEditorCenterProps) {
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
            onDoubleClickObject={() => onOpenObjectProperties()}
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