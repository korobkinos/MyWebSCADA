import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  AppstoreOutlined,
  CopyOutlined,
  DeleteOutlined,
  FileImageOutlined,
  FontSizeOutlined,
  MinusOutlined,
  NumberOutlined,
  LineChartOutlined,
  RedoOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  SaveOutlined,
  SettingOutlined,
  SnippetsOutlined,
  TableOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import {
  ActivityLogIcon,
  AlignBottomIcon,
  AlignCenterHorizontallyIcon,
  AlignCenterVerticallyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  BorderSplitIcon,
  ButtonIcon,
  CircleIcon,
  CopyIcon,
  CursorArrowIcon,
  GroupIcon,
  HandIcon,
  HeightIcon,
  CheckIcon,
  SliderIcon,
  SizeIcon,
  SquareIcon,
  SpaceBetweenHorizontallyIcon,
  SpaceBetweenVerticallyIcon,
  SwitchIcon,
  TriangleUpIcon,
  WidthIcon,
  BarChartIcon,
  ChevronDownIcon,
  DotFilledIcon,
  InputIcon,
} from "@radix-ui/react-icons";
import { Tabs } from "antd";
import { HmiStage } from "../../../hmi/runtime/hmi-stage";
import { createObjectByType } from "../../../hmi/editor/default-object-factory";
import {
  WorkbenchButton,
  WorkbenchIconButton,
} from "../../../components/workbench";
import { isTextEditingTarget } from "../../../utils/keyboard";
import type { EditorCommand, HmiObject, HmiScreen, ScadaProject } from "@web-scada/shared";

type PrimitiveShapeKind = "square" | "circle" | "triangle";
type DropPosition = { x: number; y: number };
type EditorTool = "select" | "pan";
type ToolbarTab = "main" | "insert" | "arrange" | "align" | "edit" | "view";
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

function toGridLineColor(rawColor: string | undefined, opacity: number): string {
  const safeOpacity = Math.min(1, Math.max(0, opacity));
  const fallback = `rgba(255, 255, 255, ${safeOpacity})`;
  const value = (rawColor ?? "").trim();
  if (!value.startsWith("#")) {
    return fallback;
  }
  const hex = value.slice(1);
  const expandHex = (token: string): string => token.split("").map((ch) => ch + ch).join("");
  const normalized = hex.length === 3 ? expandHex(hex) : hex.length === 6 ? hex : "";
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return fallback;
  }
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${safeOpacity})`;
}

function normalizeGridLineWidth(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(6, Math.max(0.5, value ?? 1));
}

function normalizeGridOpacity(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0.08;
  }
  return Math.min(1, Math.max(0, value ?? 0.08));
}

function normalizeGridLineStyle(value: string | undefined): "solid" | "dashed" | "dotted" | "dashDot" {
  if (value === "dashed" || value === "dotted" || value === "dashDot") {
    return value;
  }
  return "solid";
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
  onLogout: () => void;
  canSaveSelection: boolean;
  setContextMenu: (v: any) => void;
  handleDrop: (event: DragEvent<HTMLDivElement>, position?: DropPosition) => void;
  moveObjectWithHistory: (id: string, x: number, y: number) => void;
  moveObjectLive: (id: string, x: number, y: number) => void;
  commitLiveMoveWithHistory: () => void;
  resizeObjectWithHistory: (id: string, patch: Partial<HmiObject>) => void;
  undo: () => void;
  redo: () => void;
  handleSaveProject: () => Promise<void>;
  isProjectDirty: boolean;
  isSavingProject: boolean;
  canUndo: boolean;
  canRedo: boolean;
  addObjectWithHistory: (obj: HmiObject) => void;
  addPrimitiveShape: (kind: PrimitiveShapeKind, center?: { x: number; y: number }) => void;
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
  canMergeLines: boolean;
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
  onRotateSelectedBy: (deltaDeg: number) => void;
  onViewportCenterChange?: (center: { x: number; y: number }) => void;
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
  onLogout,
  canSaveSelection,
  setContextMenu,
  handleDrop,
  moveObjectWithHistory,
  moveObjectLive,
  commitLiveMoveWithHistory,
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
  canMergeLines,
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
  onRotateSelectedBy,
  onViewportCenterChange,
}: ScreenEditorCenterProps) {
  const [isCanvasDragOver, setIsCanvasDragOver] = useState(false);
  const [activeTool, setActiveTool] = useState<EditorTool>(() => {
    if (typeof window === "undefined") {
      return "select";
    }
    return parseEditorTool(window.localStorage.getItem(ACTIVE_TOOL_STORAGE_KEY));
  });
  const [isPanning, setIsPanning] = useState(false);
  const [toolbarTab, setToolbarTab] = useState<ToolbarTab>("main");
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  const suppressNextContextMenuRef = useRef(false);
  const pendingWheelZoomAnchorRef = useRef<{ worldX: number; worldY: number; targetZoom: number } | null>(null);
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
  const showEditorGrid = project?.editorSettings?.showEditorGrid ?? true;
  const gridLineOpacity = normalizeGridOpacity(project?.editorSettings?.editorGridOpacity);
  const gridLineColor = toGridLineColor(project?.editorSettings?.editorGridColor, gridLineOpacity);
  const gridLineWidth = normalizeGridLineWidth(project?.editorSettings?.editorGridLineWidth);
  const gridLineStyle = normalizeGridLineStyle(project?.editorSettings?.editorGridLineStyle);
  const stageMode = previewMode ? "runtime" : "editor";
  const stageTags = previewMode ? tags : EMPTY_STAGE_TAGS;
  const viewportBackground =
    screen?.backgroundFillMode === "viewport"
      ? screen.background ?? "#111111"
      : "#111111";
  const applyAutoFitZoom = useCallback(() => {
    if (previewMode) {
      return;
    }
    const viewport = canvasScrollRef.current;
    if (!viewport) {
      return;
    }
    const targetWidth = Math.max(1, screen.width);
    const targetHeight = Math.max(1, screen.height);
    const fitZoom = Math.min(viewport.clientWidth / targetWidth, viewport.clientHeight / targetHeight);
    if (!Number.isFinite(fitZoom) || fitZoom <= 0) {
      return;
    }
    setEditorZoom(clampZoom(fitZoom));
  }, [previewMode, screen.height, screen.width]);

  useEffect(() => {
    applyAutoFitZoom();
  }, [applyAutoFitZoom, screen.id]);

  useEffect(() => {
    if (previewMode) {
      return;
    }
    const viewport = canvasScrollRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      applyAutoFitZoom();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [applyAutoFitZoom, previewMode]);

  const beginPan = useCallback((startX: number, startY: number, suppressContextMenu: boolean) => {
    const scrollElement = canvasScrollRef.current;
    if (!scrollElement) {
      return;
    }
    setIsPanning(true);
    const startScrollLeft = scrollElement.scrollLeft;
    const startScrollTop = scrollElement.scrollTop;
    let moved = false;

    const onMove = (moveEvent: MouseEvent) => {
      if (!moved && (Math.abs(moveEvent.clientX - startX) > 2 || Math.abs(moveEvent.clientY - startY) > 2)) {
        moved = true;
      }
      scrollElement.scrollLeft = startScrollLeft - (moveEvent.clientX - startX);
      scrollElement.scrollTop = startScrollTop - (moveEvent.clientY - startY);
    };

    const stopPan = () => {
      setIsPanning(false);
      if (suppressContextMenu && moved) {
        suppressNextContextMenuRef.current = true;
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stopPan);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stopPan);
  }, []);

  // Task 3: compute canvas-space position of the current viewport center
  const getViewportCenter = useCallback((): { x: number; y: number } => {
    const el = canvasScrollRef.current;
    if (!el) {
      return { x: 100, y: 100 };
    }
    return {
      x: (el.scrollLeft + el.clientWidth / 2) / editorZoom,
      y: (el.scrollTop + el.clientHeight / 2) / editorZoom,
    };
  }, [editorZoom]);

  useEffect(() => {
    onViewportCenterChange?.(getViewportCenter());
  }, [getViewportCenter, onViewportCenterChange]);

  useEffect(() => {
    const el = canvasScrollRef.current;
    if (!el || !onViewportCenterChange) {
      return;
    }
    const emit = () => onViewportCenterChange(getViewportCenter());
    el.addEventListener("scroll", emit, { passive: true });
    return () => el.removeEventListener("scroll", emit);
  }, [getViewportCenter, onViewportCenterChange]);

  // Task 3: add any object centered on the current viewport
  const addAtViewportCenter = useCallback(
    (obj: HmiObject) => {
      const center = getViewportCenter();
      addObjectWithHistory({
        ...obj,
        x: Math.round(center.x - obj.width / 2),
        y: Math.round(center.y - obj.height / 2),
      });
    },
    [addObjectWithHistory, getViewportCenter],
  );

  // Task 4: native non-passive wheel listener – prevents scroll when wheel-zoom is active
  useLayoutEffect(() => {
    const anchor = pendingWheelZoomAnchorRef.current;
    const el = canvasScrollRef.current;
    if (!anchor || !el) {
      return;
    }
    if (Math.abs(anchor.targetZoom - editorZoom) > 1e-6) {
      return;
    }
    const centerX = el.clientWidth / 2;
    const centerY = el.clientHeight / 2;
    el.scrollLeft = Math.max(0, Math.round(anchor.worldX * editorZoom - centerX));
    el.scrollTop = Math.max(0, Math.round(anchor.worldY * editorZoom - centerY));
    pendingWheelZoomAnchorRef.current = null;
  }, [editorZoom]);

  useEffect(() => {
    const el = canvasScrollRef.current;
    if (!el) return;
    const handler = (event: WheelEvent) => {
      if (previewMode) return;
      if (!wheelZoomEnabled) return;
      if (isTextEditingTarget(event.target as EventTarget)) return;
      event.preventDefault();
      if (!event.deltaY) return;
      const delta = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setEditorZoom((prev) => {
        const next = clampZoom(prev * delta);
        if (next === prev) {
          return prev;
        }
        // Zoom around the visible viewport center to keep behavior stable.
        const centerX = el.clientWidth / 2;
        const centerY = el.clientHeight / 2;
        const worldX = (el.scrollLeft + centerX) / prev;
        const worldY = (el.scrollTop + centerY) / prev;
        pendingWheelZoomAnchorRef.current = { worldX, worldY, targetZoom: next };
        return next;
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [previewMode, wheelZoomEnabled]);

  const startPan = (event: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== "pan" || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    beginPan(event.clientX, event.clientY, false);
  };

  return (
    <div className="screen-editor-center">
      <div className="screen-editor-toolbar">
        <div className="screen-editor-toolbar__row">
          <div className="screen-editor-toolbar__group screen-editor-toolbar__group--tabs">
            <Tabs
              size="small"
              activeKey={toolbarTab}
              onChange={(key) => setToolbarTab(key as ToolbarTab)}
              className="object-property-tabs object-property-tabs--main screen-editor-toolbar-tabs"
              items={[
                {
                  key: "main",
                  label: "Main",
                  children: (
                    <div className="screen-editor-toolbar-tabs__actions">
                      <WorkbenchIconButton
                        onClick={() => void handleSaveProject()}
                        disabled={!isProjectDirty || isSavingProject}
                        title="Save Project"
                        icon={<SaveOutlined />}
                      />
                      <WorkbenchIconButton onClick={undo} disabled={!canUndo} title="Undo" icon={<UndoOutlined />} />
                      <WorkbenchIconButton onClick={redo} disabled={!canRedo} title="Redo" icon={<RedoOutlined />} />
                      <WorkbenchButton
                        variant={previewMode ? "primary" : "default"}
                        onClick={() => onPreviewModeChange(!previewMode)}
                        title={previewMode ? "Exit Preview" : "Preview"}
                      >
                        {previewMode ? "Exit Preview" : "Preview"}
                      </WorkbenchButton>
                      <WorkbenchButton onClick={onLogout} title="Logout and open Runtime">
                        Logout
                      </WorkbenchButton>
                    </div>
                  ),
                },
                {
                  key: "insert",
                  label: "Insert",
                  children: (
                    <div className="screen-editor-toolbar-tabs__actions">
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("text"))} title="Add Text" icon={<FontSizeOutlined />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("line"))} title="Add Line" icon={<MinusOutlined />} />
                      <WorkbenchIconButton onClick={() => addPrimitiveShape("square", getViewportCenter())} title="Add Square" icon={<SquareIcon />} />
                      <WorkbenchIconButton onClick={() => addPrimitiveShape("circle", getViewportCenter())} title="Add Circle" icon={<CircleIcon />} />
                      <WorkbenchIconButton onClick={() => addPrimitiveShape("triangle", getViewportCenter())} title="Add Triangle" icon={<TriangleUpIcon />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("frame"))} title="Add Frame" icon={<BorderSplitIcon />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("image"))} title="Add Image" icon={<FileImageOutlined />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("stateImage"))} title="Add State Image" icon={<ActivityLogIcon />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("numeric-image-indicator"))} title="Add Numeric Image Indicator" icon={<NumberOutlined />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("button"))} title="Add Button" icon={<ButtonIcon />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("switch"))} title="Add Switch" icon={<SwitchIcon />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("value-display"))} title="Add Value Display" icon={<NumberOutlined />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("state-indicator"))} title="Add State Indicator" icon={<ActivityLogIcon />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("checkbox"))} title="Add Checkbox" icon={<CheckIcon />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("slider"))} title="Add Slider" icon={<SliderIcon />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("progress-bar"))} title="Add Progress Bar" icon={<BarChartIcon />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("trendChart"))} title="Add Trend Chart" icon={<LineChartOutlined />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("eventTable"))} title="Add Event Table" icon={<TableOutlined />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("select"))} title="Add Select" icon={<ChevronDownIcon />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("radio-group"))} title="Add Radio Group" icon={<DotFilledIcon />} />
                      <WorkbenchIconButton onClick={() => addAtViewportCenter(createObjectByType("numeric-input"))} title="Add Numeric Input" icon={<InputIcon />} />
                    </div>
                  ),
                },
                {
                  key: "arrange",
                  label: "Arrange",
                  children: (
                    <div className="screen-editor-toolbar-tabs__actions">
                      <WorkbenchIconButton onClick={() => runCommand({ type: "makeSameWidth" })} disabled={!canSameSize} title="Make same width" icon={<WidthIcon />} />
                      <WorkbenchIconButton onClick={() => runCommand({ type: "makeSameHeight" })} disabled={!canSameSize} title="Make same height" icon={<HeightIcon />} />
                      <WorkbenchIconButton onClick={() => runCommand({ type: "makeSameSize" })} disabled={!canSameSize} title="Make same size" icon={<SizeIcon />} />
                      <WorkbenchIconButton onClick={() => runCommand({ type: "distributeHorizontally" })} disabled={!canDistribute} title="Distribute horizontally" icon={<SpaceBetweenHorizontallyIcon />} />
                      <WorkbenchIconButton onClick={() => runCommand({ type: "distributeVertically" })} disabled={!canDistribute} title="Distribute vertically" icon={<SpaceBetweenVerticallyIcon />} />
                      <WorkbenchIconButton onClick={() => onRotateSelectedBy(-90)} disabled={!selectedUnlocked.length} title="Rotate 90° Counterclockwise" icon={<RotateLeftOutlined />} />
                      <WorkbenchIconButton onClick={() => onRotateSelectedBy(90)} disabled={!selectedUnlocked.length} title="Rotate 90° Clockwise" icon={<RotateRightOutlined />} />
                      <input
                        className="workbench-input screen-editor-toolbar__gap-input"
                        type="number"
                        value={spacingGap ?? ""}
                        onChange={(e) => setSpacingGap(e.target.value ? Number(e.target.value) : undefined)}
                        placeholder="Gap"
                        title="Distribution gap"
                      />
                    </div>
                  ),
                },
                {
                  key: "align",
                  label: "Align",
                  children: (
                    <div className="screen-editor-toolbar-tabs__actions">
                      <WorkbenchIconButton onClick={() => runCommand({ type: "alignLeft" })} disabled={!canAlign} title="Align left" icon={<AlignLeftIcon />} />
                      <WorkbenchIconButton onClick={() => runCommand({ type: "alignHorizontalCenter" })} disabled={!canAlign} title="Align horizontal center" icon={<AlignCenterHorizontallyIcon />} />
                      <WorkbenchIconButton onClick={() => runCommand({ type: "alignRight" })} disabled={!canAlign} title="Align right" icon={<AlignRightIcon />} />
                      <WorkbenchIconButton onClick={() => runCommand({ type: "alignTop" })} disabled={!canAlign} title="Align top" icon={<AlignTopIcon />} />
                      <WorkbenchIconButton onClick={() => runCommand({ type: "alignVerticalCenter" })} disabled={!canAlign} title="Align vertical center" icon={<AlignCenterVerticallyIcon />} />
                      <WorkbenchIconButton onClick={() => runCommand({ type: "alignBottom" })} disabled={!canAlign} title="Align bottom" icon={<AlignBottomIcon />} />
                    </div>
                  ),
                },
                {
                  key: "edit",
                  label: "Edit",
                  children: (
                    <div className="screen-editor-toolbar-tabs__actions">
                      <WorkbenchIconButton onClick={copySelectionToClipboard} disabled={!canCopy} title="Copy" icon={<CopyOutlined />} />
                      <WorkbenchIconButton onClick={pasteFromClipboard} disabled={!canPaste} title="Paste" icon={<SnippetsOutlined />} />
                      <WorkbenchIconButton
                        onClick={deleteSelectionWithHistory}
                        disabled={!canDelete}
                        title="Delete"
                        icon={<DeleteOutlined />}
                      />
                      <WorkbenchIconButton onClick={() => runCommand({ type: "groupSelected" })} disabled={!canGroup} title="Group selected objects" icon={<GroupIcon />} />
                      <WorkbenchIconButton onClick={() => runCommand({ type: "ungroupSelected" })} disabled={!canUngroup} title="Ungroup selected objects" icon={<BorderSplitIcon />} />
                      <WorkbenchButton onClick={() => runCommand({ type: "mergeSelectedLinesToPolyline" })} disabled={!canMergeLines} title="Merge selected lines to polyline">Merge Lines</WorkbenchButton>
                      <WorkbenchIconButton onClick={() => setCloneOpen(true)} disabled={!selectedUnlocked.length} title="Clone selected objects" icon={<CopyIcon />} />
                      <WorkbenchIconButton onClick={onBringToFront} disabled={!hasSelection} title="Bring to Front" icon={<span style={{ fontSize: 13, lineHeight: 1 }}>&#x2912;</span>} />
                      <WorkbenchIconButton onClick={onSendToBack} disabled={!hasSelection} title="Send to Back" icon={<span style={{ fontSize: 13, lineHeight: 1 }}>&#x2913;</span>} />
                      <WorkbenchIconButton onClick={onMoveForward} disabled={!hasSelection} title="Move Forward" icon={<span style={{ fontSize: 14, lineHeight: 1 }}>&#x2191;</span>} />
                      <WorkbenchIconButton onClick={onMoveBackward} disabled={!hasSelection} title="Move Backward" icon={<span style={{ fontSize: 14, lineHeight: 1 }}>&#x2193;</span>} />
                    </div>
                  ),
                },
                {
                  key: "view",
                  label: "View",
                  children: (
                    <div className="screen-editor-toolbar-tabs__actions">
                      <WorkbenchIconButton onClick={onOpenScreenSettings} title="Open Screen Settings" icon={<AppstoreOutlined />} />
                      <WorkbenchIconButton onClick={onOpenLayers} title="Open Layers Window" icon={<UnorderedListOutlined />} />
                      <WorkbenchIconButton onClick={onOpenObjectProperties} title="Open Object Properties Window" icon={<SettingOutlined />} />
                      <WorkbenchIconButton
                        onClick={onOpenSaveSelection}
                        disabled={!canSaveSelection}
                        title="Save Selection As Element"
                        icon={<SaveOutlined />}
                      />
                      <WorkbenchIconButton
                        active={activeTool === "select"}
                        onClick={() => setActiveTool("select")}
                        title="Select tool"
                        icon={<CursorArrowIcon />}
                      />
                      <WorkbenchIconButton
                        active={activeTool === "pan"}
                        onClick={() => setActiveTool("pan")}
                        title="Pan tool"
                        icon={<HandIcon />}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </div>
          <div className="screen-editor-toolbar__screen-name" title={screen?.name ?? "Screen"}>
            {screen?.name ?? "Screen"}
          </div>
        </div>
      </div>
      <div
        className={`screen-editor-canvas-host${isCanvasDragOver ? " screen-editor-canvas-host--drag-over" : ""}${!previewMode && activeTool === "select" ? " screen-editor-canvas-host--select" : ""}${!previewMode && activeTool === "pan" ? " screen-editor-canvas-host--pan" : ""}${!previewMode && isPanning ? " screen-editor-canvas-host--panning" : ""}`}
        style={{ ["--screen-editor-viewport-bg" as string]: viewportBackground } as Record<string, string>}
        onWheel={(event) => {
          // Task 4: zoom is handled by the native non-passive listener (useEffect above).
          // React's onWheel is passive by default and cannot preventDefault reliably.
          if (previewMode) return;
          if (wheelZoomEnabled) {
            event.stopPropagation();
          }
        }}
        onContextMenu={(event) => {
          if (suppressNextContextMenuRef.current) {
            event.preventDefault();
            suppressNextContextMenuRef.current = false;
            return;
          }
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
        <div
          ref={canvasScrollRef}
          className="screen-editor-canvas-scroll"
          style={{
            ["--screen-editor-viewport-bg" as string]: viewportBackground,
          } as Record<string, string>}
        >
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
                  const isAlreadySelected = selection.selectedObjectIds.includes(objectId);
                  if (!isAlreadySelected) {
                    setSelectedObjects([objectId], objectId);
                  }
                }
                setContextMenu({ visible: true, x: clientX, y: clientY });
              }}
              onEmptySpaceMouseDown={(nativeEvent) => {
                if (previewMode || nativeEvent.button !== 2) {
                  return;
                }
                beginPan(nativeEvent.clientX, nativeEvent.clientY, true);
              }}
              onSelectObjects={(objectIds, activeId) => {
                if (previewMode) {
                  return;
                }
                setSelectedObjects(objectIds, activeId ?? "");
              }}
              onMoveObject={moveObjectLive}
              onMoveObjectEnd={commitLiveMoveWithHistory}
              onResizeObject={resizeObjectWithHistory}
              editorZoom={editorZoom}
              showEditorGrid={!previewMode && showEditorGrid}
              editorGridColor={gridLineColor}
              editorGridLineWidth={gridLineWidth}
              editorGridLineStyle={gridLineStyle}
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
