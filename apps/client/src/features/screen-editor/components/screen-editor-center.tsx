import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { flushSync } from "react-dom";
import {
  AppstoreOutlined,
  CopyOutlined,
  DeleteOutlined,
  FileImageOutlined,
  FontSizeOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LogoutOutlined,
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
import { getEditorOffscreenPad, HmiStage } from "../../../hmi/runtime/hmi-stage";
import { createObjectByType } from "../../../hmi/editor/default-object-factory";
import {
  WorkbenchButton,
  WorkbenchIconButton,
} from "../../../components/workbench";
import { isTextEditingTarget } from "../../../utils/keyboard";
import type { EditorCommand, HmiObject, HmiScreen, ScadaProject } from "@web-scada/shared";
import type { NumericInputOpenPayload } from "../../../hmi/runtime/hmi-renderer";

type PrimitiveShapeKind = "square" | "circle" | "triangle";
type DropPosition = { x: number; y: number };
type EditorTool = "select" | "pan";
type ToolbarGroupId = "main" | "insert" | "arrange" | "align" | "edit" | "view";
const MIN_EDITOR_ZOOM = 0.02;
const MAX_EDITOR_ZOOM = 20;
const ZOOM_STEP = 1.1;
const ZOOM_OPTIONS = [0.02, 0.05, 0.1, 0.2, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 20];
const ACTIVE_TOOL_STORAGE_KEY = "screenEditor.activeTool";
const EDITOR_ZOOM_STORAGE_KEY = "screenEditor.canvas.zoom";
const EDITOR_ZOOM_PERSIST_DELAY_MS = 250;
const TOOLBAR_CONFIG_STORAGE_KEY = "screenEditor.toolbar.config";
const EMPTY_STAGE_TAGS: Record<string, any> = Object.freeze({});
const DEFAULT_TOOLBAR_GROUP_ORDER: ToolbarGroupId[] = ["main", "insert", "arrange", "align", "edit", "view"];
const TOOLBAR_GROUP_LABELS: Record<ToolbarGroupId, string> = {
  main: "Main",
  insert: "Insert",
  arrange: "Arrange",
  align: "Align",
  edit: "Edit",
  view: "View",
};

type ToolbarConfig = {
  order: ToolbarGroupId[];
  hidden: ToolbarGroupId[];
};

type ToolbarMenuItem = {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
};

function normalizeToolbarConfig(raw: Partial<ToolbarConfig> | null | undefined): ToolbarConfig {
  const knownGroups = new Set<ToolbarGroupId>(DEFAULT_TOOLBAR_GROUP_ORDER);
  const order = Array.isArray(raw?.order)
    ? raw.order.filter((id): id is ToolbarGroupId => knownGroups.has(id as ToolbarGroupId))
    : [];
  const hidden = Array.isArray(raw?.hidden)
    ? raw.hidden.filter((id): id is ToolbarGroupId => knownGroups.has(id as ToolbarGroupId))
    : [];

  return {
    order: [
      ...order,
      ...DEFAULT_TOOLBAR_GROUP_ORDER.filter((id) => !order.includes(id)),
    ],
    hidden: Array.from(new Set(hidden)),
  };
}

function loadToolbarConfig(): ToolbarConfig {
  if (typeof window === "undefined") {
    return normalizeToolbarConfig(null);
  }
  try {
    return normalizeToolbarConfig(JSON.parse(window.localStorage.getItem(TOOLBAR_CONFIG_STORAGE_KEY) ?? "null"));
  } catch {
    return normalizeToolbarConfig(null);
  }
}

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
  canMergeShapes: boolean;
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
  onRequestNumericInput?: (state: NumericInputOpenPayload) => void;
  onResizeScreen?: (screenId: string, patch: Partial<HmiScreen>) => void;
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
  canMergeShapes,
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
  onRequestNumericInput,
  onResizeScreen,
}: ScreenEditorCenterProps) {
  const [isCanvasDragOver, setIsCanvasDragOver] = useState(false);
  const [activeTool, setActiveTool] = useState<EditorTool>(() => {
    if (typeof window === "undefined") {
      return "select";
    }
    return parseEditorTool(window.localStorage.getItem(ACTIVE_TOOL_STORAGE_KEY));
  });
  const [isPanning, setIsPanning] = useState(false);
  const [toolbarConfig, setToolbarConfig] = useState<ToolbarConfig>(() => loadToolbarConfig());
  const [toolbarConfigOpen, setToolbarConfigOpen] = useState(false);
  const [openToolbarMenu, setOpenToolbarMenu] = useState<ToolbarGroupId | null>(null);
  const [gapInputOpen, setGapInputOpen] = useState(false);
  const [toolbarExpanded, setToolbarExpanded] = useState(true);
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  const gapInputRef = useRef<HTMLInputElement | null>(null);
  const suppressNextContextMenuRef = useRef(false);
  const pendingWheelZoomAnchorRef = useRef<{ screenX: number; screenY: number; targetZoom: number } | null>(null);
  const wheelZoomFrameIdRef = useRef<number | null>(null);
  const wheelZoomFactorRef = useRef(1);
  const isManualZoomRef = useRef(false);
  const latestEditorZoomRef = useRef(1);
  const zoomPersistTimeoutRef = useRef<number | null>(null);
  const [editorZoom, setEditorZoom] = useState<number>(() => {
    if (typeof window === "undefined") {
      return 1;
    }
    const raw = window.localStorage.getItem(EDITOR_ZOOM_STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return clampZoom(Number.isFinite(parsed) ? parsed : 1);
  });

  useEffect(() => {
    latestEditorZoomRef.current = editorZoom;
  }, [editorZoom]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (zoomPersistTimeoutRef.current !== null) {
      window.clearTimeout(zoomPersistTimeoutRef.current);
    }
    zoomPersistTimeoutRef.current = window.setTimeout(() => {
      window.localStorage.setItem(EDITOR_ZOOM_STORAGE_KEY, String(editorZoom));
      zoomPersistTimeoutRef.current = null;
    }, EDITOR_ZOOM_PERSIST_DELAY_MS);
  }, [editorZoom]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") {
        return;
      }
      if (zoomPersistTimeoutRef.current !== null) {
        window.clearTimeout(zoomPersistTimeoutRef.current);
        zoomPersistTimeoutRef.current = null;
      }
      window.localStorage.setItem(EDITOR_ZOOM_STORAGE_KEY, String(latestEditorZoomRef.current));
    };
  }, []);

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
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TOOLBAR_CONFIG_STORAGE_KEY, JSON.stringify(toolbarConfig));
  }, [toolbarConfig]);

  const setToolbarGroupHidden = useCallback((id: ToolbarGroupId, hidden: boolean) => {
    setToolbarConfig((prev) => {
      const nextHidden = new Set(prev.hidden);
      if (hidden) {
        nextHidden.add(id);
      } else {
        nextHidden.delete(id);
      }
      return normalizeToolbarConfig({ ...prev, hidden: Array.from(nextHidden) });
    });
  }, []);

  const moveToolbarGroup = useCallback((id: ToolbarGroupId, direction: -1 | 1) => {
    setToolbarConfig((prev) => {
      const order = [...prev.order];
      const index = order.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= order.length) {
        return prev;
      }
      const current = order[index];
      const next = order[nextIndex];
      if (!current || !next) {
        return prev;
      }
      order[index] = next;
      order[nextIndex] = current;
      return normalizeToolbarConfig({ ...prev, order });
    });
  }, []);

  const resetToolbarConfig = useCallback(() => {
    setToolbarConfig(normalizeToolbarConfig(null));
  }, []);

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
  const editorOffscreenPad = getEditorOffscreenPad(editorZoom);
  const viewportBackground = "#111111";
  const setEditorZoomKeepingViewportCenter = useCallback((nextZoomOrUpdater: number | ((prev: number) => number)) => {
    const el = canvasScrollRef.current;
    setEditorZoom((prev) => {
      const rawNext = typeof nextZoomOrUpdater === "function"
        ? (nextZoomOrUpdater as (value: number) => number)(prev)
        : nextZoomOrUpdater;
      const next = clampZoom(rawNext);
      if (next === prev) {
        return prev;
      }
      if (el) {
        const previousPad = getEditorOffscreenPad(prev);
        const centerScreenX = (el.scrollLeft + el.clientWidth / 2) / prev - previousPad;
        const centerScreenY = (el.scrollTop + el.clientHeight / 2) / prev - previousPad;
        pendingWheelZoomAnchorRef.current = {
          screenX: centerScreenX,
          screenY: centerScreenY,
          targetZoom: next,
        };
      }
      return next;
    });
  }, []);

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
    const next = clampZoom(fitZoom);
    setEditorZoom(next);
    pendingWheelZoomAnchorRef.current = {
      screenX: screen.width / 2,
      screenY: screen.height / 2,
      targetZoom: next,
    };
  }, [previewMode, screen.height, screen.width]);

  useEffect(() => {
    isManualZoomRef.current = false;
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
      if (isManualZoomRef.current) {
        return;
      }
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
      x: (el.scrollLeft + el.clientWidth / 2) / editorZoom - editorOffscreenPad,
      y: (el.scrollTop + el.clientHeight / 2) / editorZoom - editorOffscreenPad,
    };
  }, [editorOffscreenPad, editorZoom]);

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
    const currentPad = getEditorOffscreenPad(editorZoom);
    el.scrollLeft = Math.round((anchor.screenX + currentPad) * editorZoom - centerX);
    el.scrollTop = Math.round((anchor.screenY + currentPad) * editorZoom - centerY);
    pendingWheelZoomAnchorRef.current = null;
  }, [editorZoom]);

  useEffect(() => {
    const flushWheelZoom = () => {
      wheelZoomFrameIdRef.current = null;
      const el = canvasScrollRef.current;
      const deltaFactor = wheelZoomFactorRef.current;
      wheelZoomFactorRef.current = 1;
      if (!el || Math.abs(deltaFactor - 1) < 1e-9) {
        return;
      }
      const prev = latestEditorZoomRef.current;
      const next = clampZoom(prev * deltaFactor);
      if (next === prev) {
        return;
      }
      const previousPad = getEditorOffscreenPad(prev);
      const nextPad = getEditorOffscreenPad(next);
      const centerX = el.clientWidth / 2;
      const centerY = el.clientHeight / 2;
      const screenX = (el.scrollLeft + centerX) / prev - previousPad;
      const screenY = (el.scrollTop + centerY) / prev - previousPad;
      flushSync(() => {
        setEditorZoom(next);
      });
      latestEditorZoomRef.current = next;
      el.scrollLeft = Math.round((screenX + nextPad) * next - centerX);
      el.scrollTop = Math.round((screenY + nextPad) * next - centerY);
    };
    const handler = (event: WheelEvent) => {
      if (previewMode) return;
      if (!wheelZoomEnabled) return;
      if (isTextEditingTarget(event.target as EventTarget)) return;
      event.preventDefault();
      if (!event.deltaY) return;
      isManualZoomRef.current = true;
      wheelZoomFactorRef.current *= event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;

      if (wheelZoomFrameIdRef.current === null) {
        wheelZoomFrameIdRef.current = window.requestAnimationFrame(flushWheelZoom);
      }
    };
    const el = canvasScrollRef.current;
    if (!el) return;
    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
      if (wheelZoomFrameIdRef.current !== null) {
        window.cancelAnimationFrame(wheelZoomFrameIdRef.current);
        wheelZoomFrameIdRef.current = null;
      }
      wheelZoomFactorRef.current = 1;
    };
  }, [previewMode, wheelZoomEnabled]);

  const startPan = (event: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== "pan" || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    beginPan(event.clientX, event.clientY, false);
  };

  const visibleToolbarGroups = toolbarConfig.order.filter((id) => !toolbarConfig.hidden.includes(id));

  const renderToolbarGroup = (id: ToolbarGroupId) => {
    switch (id) {
      case "main":
        return (
          <>
            <WorkbenchIconButton
              onClick={() => void handleSaveProject()}
              disabled={!isProjectDirty || isSavingProject}
              title="Save Project"
              icon={<SaveOutlined />}
            />
            <WorkbenchIconButton onClick={undo} disabled={!canUndo} title="Undo" icon={<UndoOutlined />} />
            <WorkbenchIconButton onClick={redo} disabled={!canRedo} title="Redo" icon={<RedoOutlined />} />
            <WorkbenchIconButton
              active={previewMode}
              onClick={() => onPreviewModeChange(!previewMode)}
              title={previewMode ? "Exit Preview" : "Preview"}
              icon={<EyeOutlined />}
            />
            <WorkbenchIconButton onClick={onLogout} title="Logout and open Runtime" icon={<LogoutOutlined />} />
          </>
        );
      case "insert":
        return (
          <>
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
          </>
        );
      case "arrange":
        return (
          <>
            <WorkbenchIconButton onClick={() => runCommand({ type: "makeSameWidth" })} disabled={!canSameSize} title="Make same width" icon={<WidthIcon />} />
            <WorkbenchIconButton onClick={() => runCommand({ type: "makeSameHeight" })} disabled={!canSameSize} title="Make same height" icon={<HeightIcon />} />
            <WorkbenchIconButton onClick={() => runCommand({ type: "makeSameSize" })} disabled={!canSameSize} title="Make same size" icon={<SizeIcon />} />
            <WorkbenchIconButton onClick={() => runCommand({ type: "distributeHorizontally" })} disabled={!canDistribute} title="Distribute horizontally" icon={<SpaceBetweenHorizontallyIcon />} />
            <WorkbenchIconButton onClick={() => runCommand({ type: "distributeVertically" })} disabled={!canDistribute} title="Distribute vertically" icon={<SpaceBetweenVerticallyIcon />} />
            <WorkbenchIconButton onClick={() => onRotateSelectedBy(-90)} disabled={!selectedUnlocked.length} title="Rotate 90° Counterclockwise" icon={<RotateLeftOutlined />} />
            <WorkbenchIconButton onClick={() => onRotateSelectedBy(90)} disabled={!selectedUnlocked.length} title="Rotate 90° Clockwise" icon={<RotateRightOutlined />} />
            <div className="screen-editor-toolbar__gap-wrapper">
              <WorkbenchIconButton
                active={gapInputOpen}
                onClick={() => { setGapInputOpen(!gapInputOpen); if (!gapInputOpen) setTimeout(() => gapInputRef.current?.focus(), 50); }}
                title="Distribution gap"
                icon={<SpaceBetweenHorizontallyIcon />}
              />
              {gapInputOpen && (
                <input
                  ref={gapInputRef}
                  className="workbench-input screen-editor-toolbar__gap-input"
                  type="number"
                  value={spacingGap ?? ""}
                  onChange={(e) => setSpacingGap(e.target.value ? Number(e.target.value) : undefined)}
                  title="Distribution gap"
                />
              )}
            </div>
          </>
        );
      case "align":
        return (
          <>
            <WorkbenchIconButton onClick={() => runCommand({ type: "alignLeft" })} disabled={!canAlign} title="Align left" icon={<AlignLeftIcon />} />
            <WorkbenchIconButton onClick={() => runCommand({ type: "alignHorizontalCenter" })} disabled={!canAlign} title="Align horizontal center" icon={<AlignCenterHorizontallyIcon />} />
            <WorkbenchIconButton onClick={() => runCommand({ type: "alignRight" })} disabled={!canAlign} title="Align right" icon={<AlignRightIcon />} />
            <WorkbenchIconButton onClick={() => runCommand({ type: "alignTop" })} disabled={!canAlign} title="Align top" icon={<AlignTopIcon />} />
            <WorkbenchIconButton onClick={() => runCommand({ type: "alignVerticalCenter" })} disabled={!canAlign} title="Align vertical center" icon={<AlignCenterVerticallyIcon />} />
            <WorkbenchIconButton onClick={() => runCommand({ type: "alignBottom" })} disabled={!canAlign} title="Align bottom" icon={<AlignBottomIcon />} />
          </>
        );
      case "edit":
        return (
          <>
            <WorkbenchIconButton onClick={copySelectionToClipboard} disabled={!canCopy} title="Copy" icon={<CopyOutlined />} />
            <WorkbenchIconButton onClick={pasteFromClipboard} disabled={!canPaste} title="Paste" icon={<SnippetsOutlined />} />
            <WorkbenchIconButton onClick={deleteSelectionWithHistory} disabled={!canDelete} title="Delete" icon={<DeleteOutlined />} />
            <WorkbenchIconButton onClick={() => runCommand({ type: "groupSelected" })} disabled={!canGroup} title="Group selected objects" icon={<GroupIcon />} />
            <WorkbenchIconButton onClick={() => runCommand({ type: "ungroupSelected" })} disabled={!canUngroup} title="Ungroup selected objects" icon={<BorderSplitIcon />} />
            <WorkbenchIconButton onClick={() => runCommand({ type: "mergeSelectedLinesToPolyline" })} disabled={!canMergeLines} title="Merge selected lines to polyline" icon={<BorderSplitIcon />} />
            <WorkbenchIconButton onClick={() => runCommand({ type: "mergeSelectedShapes" })} disabled={!canMergeShapes} title="Merge selected primitive shapes" icon={<GroupIcon />} />
            <WorkbenchIconButton onClick={() => setCloneOpen(true)} disabled={!selectedUnlocked.length} title="Clone selected objects" icon={<CopyIcon />} />
            <WorkbenchIconButton onClick={onBringToFront} disabled={!hasSelection} title="Bring to Front" icon={<span style={{ fontSize: 13, lineHeight: 1 }}>&#x2912;</span>} />
            <WorkbenchIconButton onClick={onSendToBack} disabled={!hasSelection} title="Send to Back" icon={<span style={{ fontSize: 13, lineHeight: 1 }}>&#x2913;</span>} />
            <WorkbenchIconButton onClick={onMoveForward} disabled={!hasSelection} title="Move Forward" icon={<span style={{ fontSize: 14, lineHeight: 1 }}>&#x2191;</span>} />
            <WorkbenchIconButton onClick={onMoveBackward} disabled={!hasSelection} title="Move Backward" icon={<span style={{ fontSize: 14, lineHeight: 1 }}>&#x2193;</span>} />
          </>
        );
      case "view":
        return (
          <>
            <WorkbenchIconButton onClick={onOpenScreenSettings} title="Open Screen Settings" icon={<AppstoreOutlined />} />
            <WorkbenchIconButton onClick={onOpenLayers} title="Open Layers Window" icon={<UnorderedListOutlined />} />
            <WorkbenchIconButton onClick={onOpenObjectProperties} title="Open Object Properties Window" icon={<SettingOutlined />} />
            <WorkbenchIconButton onClick={onOpenSaveSelection} disabled={!canSaveSelection} title="Save Selection As Element" icon={<SaveOutlined />} />
            <WorkbenchIconButton active={activeTool === "select"} onClick={() => setActiveTool("select")} title="Select tool" icon={<CursorArrowIcon />} />
            <WorkbenchIconButton active={activeTool === "pan"} onClick={() => setActiveTool("pan")} title="Pan tool" icon={<HandIcon />} />
          </>
        );
      default:
        return null;
    }
  };

  const getToolbarMenuItems = (id: ToolbarGroupId): ToolbarMenuItem[] => {
    switch (id) {
      case "main":
        return [
          { label: "Save Project", disabled: !isProjectDirty || isSavingProject, onClick: () => void handleSaveProject() },
          { label: "Undo", disabled: !canUndo, onClick: undo },
          { label: "Redo", disabled: !canRedo, onClick: redo },
          { label: previewMode ? "Exit Preview" : "Preview", onClick: () => onPreviewModeChange(!previewMode) },
          { label: "Logout and open Runtime", onClick: onLogout },
        ];
      case "insert":
        return [
          { label: "Add Text", onClick: () => addAtViewportCenter(createObjectByType("text")) },
          { label: "Add Line", onClick: () => addAtViewportCenter(createObjectByType("line")) },
          { label: "Add Square", onClick: () => addPrimitiveShape("square", getViewportCenter()) },
          { label: "Add Circle", onClick: () => addPrimitiveShape("circle", getViewportCenter()) },
          { label: "Add Triangle", onClick: () => addPrimitiveShape("triangle", getViewportCenter()) },
          { label: "Add Frame", onClick: () => addAtViewportCenter(createObjectByType("frame")) },
          { label: "Add Image", onClick: () => addAtViewportCenter(createObjectByType("image")) },
          { label: "Add State Image", onClick: () => addAtViewportCenter(createObjectByType("stateImage")) },
          { label: "Add Numeric Image Indicator", onClick: () => addAtViewportCenter(createObjectByType("numeric-image-indicator")) },
          { label: "Add Button", onClick: () => addAtViewportCenter(createObjectByType("button")) },
          { label: "Add Switch", onClick: () => addAtViewportCenter(createObjectByType("switch")) },
          { label: "Add Value Display", onClick: () => addAtViewportCenter(createObjectByType("value-display")) },
          { label: "Add State Indicator", onClick: () => addAtViewportCenter(createObjectByType("state-indicator")) },
          { label: "Add Checkbox", onClick: () => addAtViewportCenter(createObjectByType("checkbox")) },
          { label: "Add Slider", onClick: () => addAtViewportCenter(createObjectByType("slider")) },
          { label: "Add Progress Bar", onClick: () => addAtViewportCenter(createObjectByType("progress-bar")) },
          { label: "Add Trend Chart", onClick: () => addAtViewportCenter(createObjectByType("trendChart")) },
          { label: "Add Event Table", onClick: () => addAtViewportCenter(createObjectByType("eventTable")) },
          { label: "Add Select", onClick: () => addAtViewportCenter(createObjectByType("select")) },
          { label: "Add Radio Group", onClick: () => addAtViewportCenter(createObjectByType("radio-group")) },
          { label: "Add Numeric Input", onClick: () => addAtViewportCenter(createObjectByType("numeric-input")) },
        ];
      case "arrange":
        return [
          { label: "Make same width", disabled: !canSameSize, onClick: () => runCommand({ type: "makeSameWidth" }) },
          { label: "Make same height", disabled: !canSameSize, onClick: () => runCommand({ type: "makeSameHeight" }) },
          { label: "Make same size", disabled: !canSameSize, onClick: () => runCommand({ type: "makeSameSize" }) },
          { label: "Distribute horizontally", disabled: !canDistribute, onClick: () => runCommand({ type: "distributeHorizontally" }) },
          { label: "Distribute vertically", disabled: !canDistribute, onClick: () => runCommand({ type: "distributeVertically" }) },
          { label: "Rotate 90° Counterclockwise", disabled: !selectedUnlocked.length, onClick: () => onRotateSelectedBy(-90) },
          { label: "Rotate 90° Clockwise", disabled: !selectedUnlocked.length, onClick: () => onRotateSelectedBy(90) },
        ];
      case "align":
        return [
          { label: "Align left", disabled: !canAlign, onClick: () => runCommand({ type: "alignLeft" }) },
          { label: "Align horizontal center", disabled: !canAlign, onClick: () => runCommand({ type: "alignHorizontalCenter" }) },
          { label: "Align right", disabled: !canAlign, onClick: () => runCommand({ type: "alignRight" }) },
          { label: "Align top", disabled: !canAlign, onClick: () => runCommand({ type: "alignTop" }) },
          { label: "Align vertical center", disabled: !canAlign, onClick: () => runCommand({ type: "alignVerticalCenter" }) },
          { label: "Align bottom", disabled: !canAlign, onClick: () => runCommand({ type: "alignBottom" }) },
        ];
      case "edit":
        return [
          { label: "Copy", disabled: !canCopy, onClick: copySelectionToClipboard },
          { label: "Paste", disabled: !canPaste, onClick: pasteFromClipboard },
          { label: "Delete", disabled: !canDelete, onClick: deleteSelectionWithHistory },
          { label: "Group selected objects", disabled: !canGroup, onClick: () => runCommand({ type: "groupSelected" }) },
          { label: "Ungroup selected objects", disabled: !canUngroup, onClick: () => runCommand({ type: "ungroupSelected" }) },
          { label: "Merge selected lines to polyline", disabled: !canMergeLines, onClick: () => runCommand({ type: "mergeSelectedLinesToPolyline" }) },
          { label: "Merge selected primitive shapes", disabled: !canMergeShapes, onClick: () => runCommand({ type: "mergeSelectedShapes" }) },
          { label: "Clone selected objects", disabled: !selectedUnlocked.length, onClick: () => setCloneOpen(true) },
          { label: "Bring to Front", disabled: !hasSelection, onClick: onBringToFront },
          { label: "Send to Back", disabled: !hasSelection, onClick: onSendToBack },
          { label: "Move Forward", disabled: !hasSelection, onClick: onMoveForward },
          { label: "Move Backward", disabled: !hasSelection, onClick: onMoveBackward },
        ];
      case "view":
        return [
          { label: "Open Screen Settings", onClick: onOpenScreenSettings },
          { label: "Open Layers Window", onClick: onOpenLayers },
          { label: "Open Object Properties Window", onClick: onOpenObjectProperties },
          { label: "Save Selection As Element", disabled: !canSaveSelection, onClick: onOpenSaveSelection },
          { label: "Select tool", onClick: () => setActiveTool("select") },
          { label: "Pan tool", onClick: () => setActiveTool("pan") },
        ];
      default:
        return [];
    }
  };

  return (
    <div className="screen-editor-center">
      <div className="screen-editor-toolbar">
        <div className="screen-editor-toolbar-menu">
          {visibleToolbarGroups.map((id) => (
            <div key={id} className="screen-editor-toolbar-menu__item">
              <button
                type="button"
                className={["screen-editor-toolbar-menu__button", openToolbarMenu === id ? "screen-editor-toolbar-menu__button--active" : ""].filter(Boolean).join(" ")}
                onClick={() => {
                  setToolbarConfigOpen(false);
                  setOpenToolbarMenu((open) => (open === id ? null : id));
                }}
              >
                {TOOLBAR_GROUP_LABELS[id]}
              </button>
              {openToolbarMenu === id ? (
                <div className="screen-editor-toolbar-menu__dropdown">
                  {getToolbarMenuItems(id).map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className="screen-editor-toolbar-menu__dropdown-item"
                      disabled={item.disabled}
                      onClick={() => {
                        if (item.disabled) {
                          return;
                        }
                        setOpenToolbarMenu(null);
                        item.onClick?.();
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          <div className="screen-editor-toolbar-menu__spacer" />
          <div className="screen-editor-toolbar__customize">
            <WorkbenchIconButton
              onClick={() => setToolbarExpanded(!toolbarExpanded)}
              title={toolbarExpanded ? "Hide icon toolbar" : "Show icon toolbar"}
              icon={toolbarExpanded ? <EyeOutlined /> : <EyeInvisibleOutlined />}
            />
            <WorkbenchIconButton
              active={toolbarConfigOpen}
              onClick={() => {
                setOpenToolbarMenu(null);
                setToolbarConfigOpen((open) => !open);
              }}
              title="Customize toolbar"
              icon={<SettingOutlined />}
            />
            {toolbarConfigOpen ? (
              <div className="screen-editor-toolbar-config">
                <div className="screen-editor-toolbar-config__header">
                  <span>Toolbar groups</span>
                  <button type="button" className="workbench-button" onClick={resetToolbarConfig}>
                    <span className="workbench-button__label">Reset</span>
                  </button>
                </div>
                {toolbarConfig.order.map((id, index) => (
                  <div key={id} className="screen-editor-toolbar-config__row">
                    <label className="screen-editor-toolbar-config__visible">
                      <input
                        type="checkbox"
                        checked={!toolbarConfig.hidden.includes(id)}
                        onChange={(event) => setToolbarGroupHidden(id, !event.currentTarget.checked)}
                      />
                      <span>{TOOLBAR_GROUP_LABELS[id]}</span>
                    </label>
                    <div className="screen-editor-toolbar-config__actions">
                      <button type="button" className="workbench-button" disabled={index === 0} onClick={() => moveToolbarGroup(id, -1)}>
                        <span className="workbench-button__label">Up</span>
                      </button>
                      <button type="button" className="workbench-button" disabled={index === toolbarConfig.order.length - 1} onClick={() => moveToolbarGroup(id, 1)}>
                        <span className="workbench-button__label">Down</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className={"screen-editor-toolbar__row" + (toolbarExpanded ? "" : " screen-editor-toolbar__row--collapsed")}>
          <div className="screen-editor-toolbar__groups">
            {visibleToolbarGroups.map((id) => (
              <div key={id} className="screen-editor-toolbar__group" data-toolbar-group={id}>
                {renderToolbarGroup(id)}
              </div>
            ))}
          </div>
          <div className="screen-editor-toolbar__screen-name" title={screen?.name ?? "Screen"}>
            {screen?.name ?? "Screen"}
          </div>
        </div>
      </div>
      <div
        className={`screen-editor-canvas-host${isCanvasDragOver ? " screen-editor-canvas-host--drag-over" : ""}${!previewMode && activeTool === "select" ? " screen-editor-canvas-host--select" : ""}${!previewMode && activeTool === "pan" ? " screen-editor-canvas-host--pan" : ""}${!previewMode && isPanning ? " screen-editor-canvas-host--panning" : ""}`}
        style={{
          ["--screen-editor-viewport-bg" as string]: viewportBackground,
          overflow: previewMode ? undefined : "visible",
        } as Record<string, string>}
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
            x: (event.clientX - rect.left) / editorZoom - editorOffscreenPad,
            y: (event.clientY - rect.top) / editorZoom - editorOffscreenPad,
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
              onRequestNumericInput={onRequestNumericInput}
              onResizeScreen={onResizeScreen}
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
            onClick={() => {
              isManualZoomRef.current = true;
              setEditorZoomKeepingViewportCenter((prev) => prev / ZOOM_STEP);
            }}
          >
            -
          </WorkbenchButton>
          <WorkbenchButton className="screen-editor-zoom-button" onClick={() => {
            isManualZoomRef.current = true;
            setEditorZoomKeepingViewportCenter(1);
          }}>
            100%
          </WorkbenchButton>
          <WorkbenchButton
            className="screen-editor-zoom-button"
            onClick={() => {
              isManualZoomRef.current = true;
              setEditorZoomKeepingViewportCenter((prev) => prev * ZOOM_STEP);
            }}
          >
            +
          </WorkbenchButton>
          <select
            className="workbench-select screen-editor-zoom-select"
            value={String(editorZoom)}
            onChange={(event) => {
              isManualZoomRef.current = true;
              setEditorZoomKeepingViewportCenter(Number(event.target.value));
            }}
          >
            {zoomSelectOptions.map((value) => (
              <option key={value} value={value}>
                {Math.round(value * 100)}%
              </option>
            ))}
          </select>
          <WorkbenchButton
            className="screen-editor-zoom-button"
            onClick={() => {
              isManualZoomRef.current = false;
              applyAutoFitZoom();
            }}
            title="Fit screen to viewport"
          >
            Fit
          </WorkbenchButton>
        </div>
      </div>
    </div>
  );
}
