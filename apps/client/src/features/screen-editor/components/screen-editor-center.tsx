import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  AppstoreOutlined,
  CopyOutlined,
  DeleteOutlined,
  FontSizeOutlined,
  MinusOutlined,
  RedoOutlined,
  SaveOutlined,
  SettingOutlined,
  SnippetsOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { HmiStage } from "../../../hmi/runtime/hmi-stage";
import { createObjectByType } from "../../../hmi/editor/default-object-factory";
import {
  WorkbenchButton,
  WorkbenchIconButton,
  WorkbenchTabs,
} from "../../../components/workbench";
import { isTextEditingTarget } from "../../../utils/keyboard";
import type { EditorCommand, HmiObject, HmiScreen, ScadaProject } from "@web-scada/shared";

type PrimitiveShapeKind = "square" | "circle" | "triangle";
type DropPosition = { x: number; y: number };
type EditorTool = "select" | "pan";
const MIN_EDITOR_ZOOM = 0.1;
const MAX_EDITOR_ZOOM = 3;
const ZOOM_STEP = 1.1;
const ZOOM_OPTIONS = [0.1, 0.2, 0.5, 0.75, 1, 1.5, 2, 3];
const ACTIVE_TOOL_STORAGE_KEY = "screenEditor.activeTool";
const EMPTY_STAGE_TAGS: Record<string, any> = Object.freeze({});

function parseEditorTool(raw: string | null): EditorTool {
  return raw === "pan" ? "pan" : "select";
}

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
  onOpenScreenSettings: () => void;
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
  previewMode: boolean;
  onPreviewModeChange: (enabled: boolean) => void;
  hasSelection: boolean;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onMoveForward: () => void;
  onMoveBackward: () => void;
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
  onOpenScreenSettings,
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
  previewMode,
  onPreviewModeChange,
  hasSelection,
  onBringToFront,
  onSendToBack,
  onMoveForward,
  onMoveBackward,
}: ScreenEditorCenterProps) {
  const [isCanvasDragOver, setIsCanvasDragOver] = useState(false);
  const [activeTool, setActiveTool] = useState<EditorTool>(() => {
    if (typeof window === "undefined") {
      return "select";
    }
    return parseEditorTool(window.localStorage.getItem(ACTIVE_TOOL_STORAGE_KEY));
  });
  const [isPanning, setIsPanning] = useState(false);
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ACTIVE_TOOL_STORAGE_KEY, activeTool);
    window.dispatchEvent(
      new CustomEvent("screenEditor.activeTool.changed", {
        detail: { tool: activeTool },
      }),
    );
  }, [activeTool]);

  useEffect(() => {
    const onToolChange = (event: Event) => {
      const custom = event as CustomEvent<{ tool?: EditorTool }>;
      if (custom.detail?.tool === "pan" || custom.detail?.tool === "select") {
        setActiveTool(custom.detail.tool);
      }
    };
    window.addEventListener("screenEditor.activeTool.changed", onToolChange);
    return () => window.removeEventListener("screenEditor.activeTool.changed", onToolChange);
  }, []);

  useEffect(() => {
    if (activeTool !== "pan") {
      setIsPanning(false);
    }
  }, [activeTool]);

  const zoomSelectOptions = useMemo(() => {
    const preset = new Set(ZOOM_OPTIONS);
    return preset.has(editorZoom) ? ZOOM_OPTIONS : [...ZOOM_OPTIONS, editorZoom].sort((a, b) => a - b);
  }, [editorZoom]);
  const wheelZoomEnabled = project?.uiSettings?.editorWheelZoomEnabled ?? true;
  const stageMode = previewMode ? "runtime" : "editor";
  const stageTags = previewMode ? tags : EMPTY_STAGE_TAGS;
  const viewportBackground =
    screen?.backgroundFillMode === "viewport"
      ? screen.background ?? "#111111"
      : undefined;

  const startPan = (event: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== "pan" || event.button !== 0) {
      return;
    }
    const scrollElement = canvasScrollRef.current;
    if (!scrollElement) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setIsPanning(true);
    const startX = event.clientX;
    const startY = event.clientY;
    const startScrollLeft = scrollElement.scrollLeft;
    const startScrollTop = scrollElement.scrollTop;

    const onMove = (moveEvent: MouseEvent) => {
      scrollElement.scrollLeft = startScrollLeft - (moveEvent.clientX - startX);
      scrollElement.scrollTop = startScrollTop - (moveEvent.clientY - startY);
    };

    const stopPan = () => {
      setIsPanning(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stopPan);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stopPan);
  };

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
            <WorkbenchIconButton
              onClick={() => void handleSaveProject()}
              disabled={!isProjectDirty || isSavingProject}
              title="Save Project"
              icon={<SaveOutlined />}
            />
            <WorkbenchIconButton onClick={undo} disabled={!canUndo} title="Undo" icon={<UndoOutlined />} />
            <WorkbenchIconButton onClick={redo} disabled={!canRedo} title="Redo" icon={<RedoOutlined />} />
          </div>

          <div className="screen-editor-toolbar__group">
            <WorkbenchIconButton onClick={() => addObjectWithHistory(createObjectByType("text"))} title="Add Text" icon={<FontSizeOutlined />} />
            <WorkbenchIconButton onClick={() => addObjectWithHistory(createObjectByType("line"))} title="Add Line" icon={<MinusOutlined />} />
            <WorkbenchIconButton onClick={() => addObjectWithHistory(createObjectByType("rectangle"))} title="Add Rectangle" icon={<span>R</span>} />
            <WorkbenchIconButton onClick={() => addPrimitiveShape("square")} title="Add Square" icon={<span>Sq</span>} />
            <WorkbenchIconButton onClick={() => addPrimitiveShape("circle")} title="Add Circle" icon={<span>O</span>} />
            <WorkbenchIconButton onClick={() => addPrimitiveShape("triangle")} title="Add Triangle" icon={<span>Tr</span>} />
            <WorkbenchIconButton onClick={() => addObjectWithHistory(createObjectByType("button"))} title="Add Button" icon={<span>B</span>} />
            <WorkbenchIconButton onClick={() => addObjectWithHistory(createObjectByType("switch"))} title="Add Switch" icon={<span>Sw</span>} />
            <WorkbenchIconButton onClick={() => addObjectWithHistory(createObjectByType("value-display"))} title="Add Value Display" icon={<span>V</span>} />
            <WorkbenchIconButton onClick={() => addObjectWithHistory(createObjectByType("state-indicator"))} title="Add State Indicator" icon={<span>I</span>} />
          </div>

          <div className="screen-editor-toolbar__spacer" />

          <div className="screen-editor-toolbar__group">
            <WorkbenchButton
              variant={previewMode ? "primary" : "default"}
              onClick={() => onPreviewModeChange(!previewMode)}
              title={previewMode ? "Exit Preview" : "Preview"}
            >
              {previewMode ? "Exit Preview" : "Preview"}
            </WorkbenchButton>
            <WorkbenchIconButton onClick={onOpenScreenSettings} title="Open Screen Settings" icon={<AppstoreOutlined />} />
            <WorkbenchIconButton onClick={onOpenLayers} title="Open Layers Window" icon={<UnorderedListOutlined />} />
            <WorkbenchIconButton onClick={onOpenObjectProperties} title="Open Object Properties Window" icon={<SettingOutlined />} />
            <WorkbenchIconButton
              onClick={onOpenSaveSelection}
              disabled={!canSaveSelection}
              title="Save Selection As Element"
              icon={<SaveOutlined />}
            />
          </div>

          <div className="screen-editor-toolbar__group">
            <WorkbenchIconButton onClick={copySelectionToClipboard} disabled={!canCopy} title="Copy" icon={<CopyOutlined />} />
            <WorkbenchIconButton onClick={pasteFromClipboard} disabled={!canPaste} title="Paste" icon={<SnippetsOutlined />} />
            <WorkbenchIconButton
              onClick={deleteSelectionWithHistory}
              disabled={!canDelete}
              title="Delete"
              icon={<DeleteOutlined />}
            />
          </div>

          <div className="screen-editor-toolbar__group">
            <WorkbenchIconButton onClick={onBringToFront} disabled={!hasSelection} title="Bring to Front" icon={<span style={{ fontSize: 13, lineHeight: 1 }}>&#x2912;</span>} />
            <WorkbenchIconButton onClick={onSendToBack} disabled={!hasSelection} title="Send to Back" icon={<span style={{ fontSize: 13, lineHeight: 1 }}>&#x2913;</span>} />
            <WorkbenchIconButton onClick={onMoveForward} disabled={!hasSelection} title="Move Forward" icon={<span style={{ fontSize: 14, lineHeight: 1 }}>↑</span>} />
            <WorkbenchIconButton onClick={onMoveBackward} disabled={!hasSelection} title="Move Backward" icon={<span style={{ fontSize: 14, lineHeight: 1 }}>↓</span>} />
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

          <div className="screen-editor-toolbar__group">
            <WorkbenchButton
              variant={activeTool === "select" ? "primary" : "default"}
              onClick={() => setActiveTool("select")}
              title="Select tool"
            >
              Select
            </WorkbenchButton>
            <WorkbenchButton
              variant={activeTool === "pan" ? "primary" : "default"}
              onClick={() => setActiveTool("pan")}
              title="Pan tool"
            >
              Hand
            </WorkbenchButton>
          </div>
        </div>
      </div>

      <div
        className={`screen-editor-canvas-host${isCanvasDragOver ? " screen-editor-canvas-host--drag-over" : ""}${!previewMode && activeTool === "pan" ? " screen-editor-canvas-host--pan" : ""}${!previewMode && isPanning ? " screen-editor-canvas-host--panning" : ""}`}
        style={viewportBackground ? { background: viewportBackground } : undefined}
        onWheel={(event) => {
          if (previewMode) {
            return;
          }
          if (!wheelZoomEnabled) {
            return;
          }
          if (isTextEditingTarget(event.target)) {
            return;
          }
          if (!event.deltaY) {
            return;
          }
          event.preventDefault();
          const delta = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
          setEditorZoom((prev) => clampZoom(prev * delta));
        }}
        onContextMenu={(event) => {
          if (previewMode) {
            event.preventDefault();
            return;
          }
          if (activeTool === "pan") {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          setContextMenu({ visible: true, x: event.clientX, y: event.clientY });
        }}
        onDragEnter={(event) => {
          if (previewMode) {
            return;
          }
          event.preventDefault();
          setIsCanvasDragOver(true);
        }}
        onDragOver={(event) => {
          if (previewMode) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          setIsCanvasDragOver(false);
        }}
        onDrop={(event) => {
          if (previewMode) {
            return;
          }
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
        <div ref={canvasScrollRef} className="screen-editor-canvas-scroll">
          {screen ? (
            <HmiStage
              project={project ?? undefined!}
              mode={stageMode}
              screen={screen}
              tags={stageTags}
              libraries={libraries}
              selectedObjectIds={selection.selectedObjectIds}
              activeObjectId={selection.activeObjectId}
              selectionRect={selectionRect}
              showObjectFrames={showObjectFrames}
              onSelectionRectChange={(rect) => setSelectionRect(rect)}
              onSelectObject={({ objectId, additive }) => {
                if (previewMode) {
                  return;
                }
                if (additive) {
                  toggleSelectedObject(objectId);
                } else {
                  setSelectedObjects([objectId], objectId);
                }
              }}
              onDoubleClickObject={() => onOpenObjectProperties()}
              onContextMenuObject={({ objectId, clientX, clientY, additive }) => {
                if (previewMode) {
                  return;
                }
                if (additive) {
                  toggleSelectedObject(objectId);
                } else {
                  setSelectedObjects([objectId], objectId);
                }
                setContextMenu({ visible: true, x: clientX, y: clientY });
              }}
              onSelectObjects={(objectIds, activeId) => {
                if (previewMode) {
                  return;
                }
                setSelectedObjects(objectIds, activeId ?? "");
              }}
              onMoveObject={moveObjectWithHistory}
              onResizeObject={resizeObjectWithHistory}
              editorZoom={editorZoom}
            />
          ) : (
            <div className="screen-editor-empty-state">Select or create a screen</div>
          )}
        </div>
        {!previewMode && activeTool === "pan" ? (
          <div
            className="screen-editor-pan-overlay"
            onMouseDown={startPan}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
        ) : null}
        <div
          className="screen-editor-zoom-controls"
          title={wheelZoomEnabled ? "Mouse wheel zoom is enabled" : "Mouse wheel zoom is disabled"}
        >
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
