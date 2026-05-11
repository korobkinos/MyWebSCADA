import { useEffect, useMemo, useState, type DragEvent } from "react";
import { HmiStage } from "../../../hmi/runtime/hmi-stage";
import { createObjectByType } from "../../../hmi/editor/default-object-factory";
import {
  WorkbenchButton,
  WorkbenchTabs,
} from "../../../components/workbench";
import type { EditorCommand, HmiObject, HmiScreen, ScadaProject } from "@web-scada/shared";

type PrimitiveShapeKind = "square" | "circle" | "triangle";
type DropPosition = { x: number; y: number };
const MIN_EDITOR_ZOOM = 0.1;
const MAX_EDITOR_ZOOM = 3;
const ZOOM_STEP = 1.1;
const ZOOM_OPTIONS = [0.1, 0.2, 0.5, 1, 1.5, 2];

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  if (value < MIN_EDITOR_ZOOM) {
    return MIN_EDITOR_ZOOM;
  }
  if (value > MAX_EDITOR_ZOOM) {
    return MAX_EDITOR_ZOOM;
  }
  return Math.round(value * 1000) / 1000;
}

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
  onOpenLayers: () => void;
  onOpenSaveSelection: () => void;
  canSaveSelection: boolean;
  setContextMenu: (v: any) => void;
  handleDrop: (event: DragEvent<HTMLDivElement>, position?: DropPosition) => void;
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
  onOpenLayers,
  onOpenSaveSelection,
  canSaveSelection,
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
  const [isCanvasDragOver, setIsCanvasDragOver] = useState(false);
  const [editorZoom, setEditorZoom] = useState<number>(() => {
    if (typeof window === "undefined") {
      return 1;
    }
    const raw = window.localStorage.getItem("screenEditor.canvas.zoom");
    const parsed = raw ? Number(raw) : NaN;
    return clampZoom(Number.isFinite(parsed) ? parsed : 1);
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("screenEditor.canvas.zoom", String(editorZoom));
  }, [editorZoom]);

  const zoomSelectOptions = useMemo(() => {
    const preset = new Set(ZOOM_OPTIONS);
    return preset.has(editorZoom) ? ZOOM_OPTIONS : [...ZOOM_OPTIONS, editorZoom].sort((a, b) => a - b);
  }, [editorZoom]);

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

      <div className="screen-editor-toolbar">
        <div className="screen-editor-toolbar__row">
          <div className="screen-editor-toolbar__group">
            <WorkbenchButton
              onClick={() => void handleSaveProject()}
              disabled={!isProjectDirty || isSavingProject}
              title="Save project"
            >
              Save
            </WorkbenchButton>
            <WorkbenchButton onClick={undo} disabled={!canUndo} title="Undo">
              Undo
            </WorkbenchButton>
            <WorkbenchButton onClick={redo} disabled={!canRedo} title="Redo">
              Redo
            </WorkbenchButton>
          </div>

          <div className="screen-editor-toolbar__group">
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("text"))} title="Add text">
              Text
            </WorkbenchButton>
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("line"))} title="Add line">
              Line
            </WorkbenchButton>
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("rectangle"))} title="Add rectangle">
              Rect
            </WorkbenchButton>
            <WorkbenchButton onClick={() => addPrimitiveShape("square")} title="Add square">
              Square
            </WorkbenchButton>
            <WorkbenchButton onClick={() => addPrimitiveShape("circle")} title="Add circle">
              Circle
            </WorkbenchButton>
            <WorkbenchButton onClick={() => addPrimitiveShape("triangle")} title="Add triangle">
              Triangle
            </WorkbenchButton>
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("button"))} title="Add button">
              Button
            </WorkbenchButton>
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("switch"))} title="Add switch">
              Switch
            </WorkbenchButton>
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("value-display"))} title="Add value display">
              Value
            </WorkbenchButton>
            <WorkbenchButton onClick={() => addObjectWithHistory(createObjectByType("state-indicator"))} title="Add state indicator">
              Indicator
            </WorkbenchButton>
          </div>

          <div className="screen-editor-toolbar__spacer" />

          <div className="screen-editor-toolbar__group">
            <WorkbenchButton onClick={() => navigate("/runtime")} title="Open runtime preview">
              Preview
            </WorkbenchButton>
            <WorkbenchButton onClick={onOpenLayers} title="Open layers window">
              Layers
            </WorkbenchButton>
            <WorkbenchButton onClick={onOpenObjectProperties} title="Open object properties window">
              Properties
            </WorkbenchButton>
            <WorkbenchButton
              onClick={onOpenSaveSelection}
              disabled={!canSaveSelection}
              title="Save selected objects as library element"
            >
              Save Selection
            </WorkbenchButton>
          </div>

          <div className="screen-editor-toolbar__group">
            <WorkbenchButton onClick={copySelectionToClipboard} disabled={!canCopy} title="Copy selected objects">
              Copy
            </WorkbenchButton>
            <WorkbenchButton onClick={pasteFromClipboard} disabled={!canPaste} title="Paste objects">
              Paste
            </WorkbenchButton>
            <WorkbenchButton
              variant="danger"
              onClick={deleteSelectionWithHistory}
              disabled={!canDelete}
              title="Delete selected objects"
            >
              Delete
            </WorkbenchButton>
          </div>
        </div>

        <div className="screen-editor-toolbar__row">
          <div className="screen-editor-toolbar__group">
            <WorkbenchButton onClick={() => runCommand({ type: "makeSameWidth" })} disabled={!canSameSize} title="Make same width">
              Same W
            </WorkbenchButton>
            <WorkbenchButton onClick={() => runCommand({ type: "makeSameHeight" })} disabled={!canSameSize} title="Make same height">
              Same H
            </WorkbenchButton>
            <WorkbenchButton onClick={() => runCommand({ type: "makeSameSize" })} disabled={!canSameSize} title="Make same size">
              Same Size
            </WorkbenchButton>
          </div>

          <div className="screen-editor-toolbar__group">
            <WorkbenchButton onClick={() => runCommand({ type: "distributeHorizontally" })} disabled={!canDistribute} title="Distribute horizontally">
              Dist H
            </WorkbenchButton>
            <WorkbenchButton onClick={() => runCommand({ type: "distributeVertically" })} disabled={!canDistribute} title="Distribute vertically">
              Dist V
            </WorkbenchButton>
            <input
              className="workbench-input screen-editor-toolbar__gap-input"
              type="number"
              value={spacingGap ?? ""}
              onChange={(e) => setSpacingGap(e.target.value ? Number(e.target.value) : undefined)}
              placeholder="Gap"
              title="Distribution gap"
            />
          </div>

          <div className="screen-editor-toolbar__group">
            <WorkbenchButton onClick={() => runCommand({ type: "alignLeft" })} disabled={!canAlign} title="Align left">
              Align L
            </WorkbenchButton>
            <WorkbenchButton onClick={() => runCommand({ type: "alignHorizontalCenter" })} disabled={!canAlign} title="Align horizontal center">
              Align C
            </WorkbenchButton>
            <WorkbenchButton onClick={() => runCommand({ type: "alignRight" })} disabled={!canAlign} title="Align right">
              Align R
            </WorkbenchButton>
            <WorkbenchButton onClick={() => runCommand({ type: "alignTop" })} disabled={!canAlign} title="Align top">
              Align T
            </WorkbenchButton>
            <WorkbenchButton onClick={() => runCommand({ type: "alignVerticalCenter" })} disabled={!canAlign} title="Align vertical center">
              Align M
            </WorkbenchButton>
            <WorkbenchButton onClick={() => runCommand({ type: "alignBottom" })} disabled={!canAlign} title="Align bottom">
              Align B
            </WorkbenchButton>
          </div>

          <div className="screen-editor-toolbar__group">
            <WorkbenchButton onClick={() => runCommand({ type: "groupSelected" })} disabled={!canGroup} title="Group selected objects">
              Group
            </WorkbenchButton>
            <WorkbenchButton onClick={() => runCommand({ type: "ungroupSelected" })} disabled={!canUngroup} title="Ungroup selected objects">
              Ungroup
            </WorkbenchButton>
            <WorkbenchButton onClick={() => setCloneOpen(true)} disabled={!selectedUnlocked.length} title="Clone selected objects">
              Clone
            </WorkbenchButton>
          </div>
        </div>
      </div>

      <div
        className={`screen-editor-canvas-host${isCanvasDragOver ? " screen-editor-canvas-host--drag-over" : ""}`}
        onWheel={(event) => {
          if (!event.ctrlKey) {
            return;
          }
          event.preventDefault();
          const delta = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
          setEditorZoom((prev) => clampZoom(prev * delta));
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ visible: true, x: event.clientX, y: event.clientY });
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsCanvasDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          setIsCanvasDragOver(false);
        }}
        onDrop={(event) => {
          const host = event.currentTarget;
          const stageSurface = host.querySelector(".canvas-wrap") as HTMLDivElement | null;
          const rect = (stageSurface ?? host).getBoundingClientRect();
          const position = {
            x: (event.clientX - rect.left) / editorZoom,
            y: (event.clientY - rect.top) / editorZoom,
          };
          setIsCanvasDragOver(false);
          handleDrop(event, position);
        }}
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
            editorZoom={editorZoom}
          />
        ) : (
          <div className="screen-editor-empty-state">Select or create a screen</div>
        )}
        <div className="screen-editor-zoom-controls" title="Ctrl + wheel to zoom">
          <WorkbenchButton
            className="screen-editor-zoom-button"
            onClick={() => setEditorZoom((prev) => clampZoom(prev / ZOOM_STEP))}
          >
            -
          </WorkbenchButton>
          <WorkbenchButton className="screen-editor-zoom-button" onClick={() => setEditorZoom(1)}>
            100%
          </WorkbenchButton>
          <WorkbenchButton
            className="screen-editor-zoom-button"
            onClick={() => setEditorZoom((prev) => clampZoom(prev * ZOOM_STEP))}
          >
            +
          </WorkbenchButton>
          <select
            className="workbench-select screen-editor-zoom-select"
            value={String(editorZoom)}
            onChange={(event) => setEditorZoom(clampZoom(Number(event.target.value)))}
          >
            {zoomSelectOptions.map((value) => (
              <option key={value} value={value}>
                {Math.round(value * 100)}%
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
