import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import type {
  Asset,
  EditorPanelState,
  EditorLayoutSettings,
  EditorCommand,
  HmiObject,
  InternalVariableDefinition,
  LibraryElement,
  ProjectLibraryRef,
  RuntimeAction,
  ScreenKind,
} from "@web-scada/shared";
import { normalizeObjectsToGroup } from "@web-scada/shared";
import {
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  BorderOutlined,
  DeleteOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LeftOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
  RedoOutlined,
  RightOutlined,
  SaveOutlined,
  UndoOutlined,
  VerticalAlignTopOutlined,
} from "@ant-design/icons";
import { api } from "../services/api";
import { FloatingPanel } from "../components/floating-panel";
import { ResizableDockPanel } from "../components/resizable-dock-panel";
import { ObjectPropertyPanel } from "../components/object-property-panel";
import { createObjectByType } from "../hmi/editor/default-object-factory";
import { importSvgAssetToPrimitives } from "../hmi/editor/svg-primitive-import";
import { HmiStage } from "../hmi/runtime/hmi-stage";
import { useSnapshotHistory } from "../hooks/use-snapshot-history";
import { useScadaStore } from "../store/scada-store";
import { isTextEditingTarget } from "../utils/keyboard";

const basicToolboxTypes: HmiObject["type"][] = [
  "text",
  "line",
  "rectangle",
  "value-display",
  "value-input",
  "state-indicator",
  "button",
  "switch",
  "valueSelect",
  "image",
  "stateImage",
  "frame",
];

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

const defaultEditorLayoutSettings: EditorLayoutSettings = {
  leftPanel: {
    visible: true,
    collapsed: false,
    width: 330,
    minWidth: 240,
    maxWidth: 520,
    collapsedWidth: 36,
  },
  rightPanel: {
    visible: true,
    collapsed: false,
    width: 340,
    minWidth: 260,
    maxWidth: 560,
    collapsedWidth: 36,
  },
  topArea: {
    collapsed: false,
    compact: false,
  },
  canvasToolbar: {
    collapsed: false,
    compact: false,
  },
  panels: {
    screensCollapsed: false,
    currentScreenCollapsed: false,
    toolboxCollapsed: false,
    propertiesCollapsed: false,
    objectTreeCollapsed: false,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeLayoutSettings(input?: EditorLayoutSettings): EditorLayoutSettings {
  if (!input) {
    return structuredClone(defaultEditorLayoutSettings);
  }
  const leftMin = input.leftPanel?.minWidth ?? defaultEditorLayoutSettings.leftPanel.minWidth;
  const leftMax = input.leftPanel?.maxWidth ?? defaultEditorLayoutSettings.leftPanel.maxWidth;
  const rightMin = input.rightPanel?.minWidth ?? defaultEditorLayoutSettings.rightPanel.minWidth;
  const rightMax = input.rightPanel?.maxWidth ?? defaultEditorLayoutSettings.rightPanel.maxWidth;
  return {
    leftPanel: {
      visible: input.leftPanel?.visible ?? defaultEditorLayoutSettings.leftPanel.visible,
      collapsed: input.leftPanel?.collapsed ?? defaultEditorLayoutSettings.leftPanel.collapsed,
      minWidth: leftMin,
      maxWidth: leftMax,
      collapsedWidth: input.leftPanel?.collapsedWidth ?? defaultEditorLayoutSettings.leftPanel.collapsedWidth,
      width: clamp(input.leftPanel?.width ?? defaultEditorLayoutSettings.leftPanel.width, leftMin, leftMax),
    },
    rightPanel: {
      visible: input.rightPanel?.visible ?? defaultEditorLayoutSettings.rightPanel.visible,
      collapsed: input.rightPanel?.collapsed ?? defaultEditorLayoutSettings.rightPanel.collapsed,
      minWidth: rightMin,
      maxWidth: rightMax,
      collapsedWidth: input.rightPanel?.collapsedWidth ?? defaultEditorLayoutSettings.rightPanel.collapsedWidth,
      width: clamp(input.rightPanel?.width ?? defaultEditorLayoutSettings.rightPanel.width, rightMin, rightMax),
    },
    topArea: {
      collapsed: input.topArea?.collapsed ?? defaultEditorLayoutSettings.topArea.collapsed,
      compact: input.topArea?.compact ?? defaultEditorLayoutSettings.topArea.compact,
      height: input.topArea?.height,
    },
    canvasToolbar: {
      collapsed: input.canvasToolbar?.collapsed ?? defaultEditorLayoutSettings.canvasToolbar.collapsed,
      compact: input.canvasToolbar?.compact ?? defaultEditorLayoutSettings.canvasToolbar.compact,
    },
    panels: {
      screensCollapsed: input.panels?.screensCollapsed ?? defaultEditorLayoutSettings.panels.screensCollapsed,
      currentScreenCollapsed: input.panels?.currentScreenCollapsed ?? defaultEditorLayoutSettings.panels.currentScreenCollapsed,
      toolboxCollapsed: input.panels?.toolboxCollapsed ?? defaultEditorLayoutSettings.panels.toolboxCollapsed,
      propertiesCollapsed: input.panels?.propertiesCollapsed ?? defaultEditorLayoutSettings.panels.propertiesCollapsed,
      objectTreeCollapsed: input.panels?.objectTreeCollapsed ?? defaultEditorLayoutSettings.panels.objectTreeCollapsed,
    },
  };
}

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
  const [leftTab, setLeftTab] = useState("screens");
  const [toolbarTab, setToolbarTab] = useState("file");
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const panelDropRef = useRef<HTMLDivElement | null>(null);
  const saveLayoutTimerRef = useRef<number | null>(null);
  const persistLayoutTimerRef = useRef<number | null>(null);
  const settingsLoadedRef = useRef<boolean>(false);
  const focusRestoreRef = useRef<{
    leftCollapsed: boolean;
    rightCollapsed: boolean;
    topAreaCollapsed: boolean;
    canvasToolbarCollapsed: boolean;
  } | null>(null);
  const [layout, setLayout] = useState<EditorLayoutSettings>(() =>
    normalizeLayoutSettings(project?.editorSettings?.layout),
  );
  const [focusMode, setFocusMode] = useState(false);
  const [floatingLibraries, setFloatingLibraries] = useState<boolean>(false);
  const [floatingAssets, setFloatingAssets] = useState<boolean>(false);
  const [floatingLibRect, setFloatingLibRect] = useState({ x: 120, y: 120, width: 460, height: 520 });
  const [floatingAssetRect, setFloatingAssetRect] = useState({ x: 180, y: 160, width: 480, height: 520 });
  const [leftWidth, setLeftWidth] = useState<number>(layout.leftPanel.width);
  const [rightWidth, setRightWidth] = useState<number>(layout.rightPanel.width);
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(layout.leftPanel.collapsed);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(layout.rightPanel.collapsed);
  const [topAreaCollapsed, setTopAreaCollapsed] = useState<boolean>(layout.topArea.collapsed);
  const [topAreaCompact, setTopAreaCompact] = useState<boolean>(layout.topArea.compact);
  const [canvasToolbarCollapsed, setCanvasToolbarCollapsed] = useState<boolean>(layout.canvasToolbar.collapsed);
  const [canvasToolbarCompact, setCanvasToolbarCompact] = useState<boolean>(layout.canvasToolbar.compact);
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({
    screens: layout.panels.screensCollapsed,
    currentScreen: layout.panels.currentScreenCollapsed,
    toolbox: layout.panels.toolboxCollapsed,
    assets: false,
    libraries: false,
    properties: layout.panels.propertiesCollapsed,
    objectTree: layout.panels.objectTreeCollapsed,
  });

  const screen = useMemo(
    () => project?.screens.find((s) => s.id === currentScreenId) ?? project?.screens[0],
    [currentScreenId, project],
  );

  const selectedObjects = useMemo(
    () => screen?.objects.filter((obj) => selection.selectedObjectIds.includes(obj.id)) ?? [],
    [screen?.objects, selection.selectedObjectIds],
  );
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

  const enabledLibraryRefs = useMemo(
    () => (project?.libraries ?? []).filter((ref) => ref.enabled),
    [project?.libraries],
  );

  // Apply saved layout settings only on initial mount, not on subsequent updates
  // to prevent overwriting user's live toggle changes
  useEffect(() => {
    if (settingsLoadedRef.current) {
      return;
    }
    if (!project?.editorSettings) {
      return;
    }
    settingsLoadedRef.current = true;
    const normalized = normalizeLayoutSettings(project.editorSettings.layout);
    setLayout(normalized);
    setLeftWidth(normalized.leftPanel.width);
    setRightWidth(normalized.rightPanel.width);
    setLeftCollapsed(normalized.leftPanel.collapsed);
    setRightCollapsed(normalized.rightPanel.collapsed);
    setTopAreaCollapsed(normalized.topArea.collapsed);
    setTopAreaCompact(normalized.topArea.compact);
    setCanvasToolbarCollapsed(normalized.canvasToolbar.collapsed);
    setCanvasToolbarCompact(normalized.canvasToolbar.compact);
    setCollapsedPanels((prev) => ({
      ...prev,
      screens: normalized.panels.screensCollapsed,
      currentScreen: normalized.panels.currentScreenCollapsed,
      toolbox: normalized.panels.toolboxCollapsed,
      properties: normalized.panels.propertiesCollapsed,
      objectTree: normalized.panels.objectTreeCollapsed,
    }));
    if (typeof project.editorSettings.showObjectFrames === "boolean") {
      setShowObjectFrames(project.editorSettings.showObjectFrames);
    }
  }, [project?.editorSettings]);

  useEffect(() => {
    if (!project) {
      return;
    }
    const defaultPanels: EditorPanelState[] = [
      { id: "screens", title: "Screens", visible: true, collapsed: collapsedPanels.screens ?? false, dock: "left", width: leftWidth, height: 240 },
      { id: "assets", title: "Assets", visible: !floatingAssets, collapsed: collapsedPanels.assets ?? false, dock: floatingAssets ? "floating" : "left", x: floatingAssetRect.x, y: floatingAssetRect.y, width: floatingAssetRect.width, height: floatingAssetRect.height },
      { id: "libraries", title: "Libraries", visible: !floatingLibraries, collapsed: collapsedPanels.libraries ?? false, dock: floatingLibraries ? "floating" : "right", x: floatingLibRect.x, y: floatingLibRect.y, width: floatingLibRect.width, height: floatingLibRect.height },
      { id: "toolbox", title: "Toolbox", visible: true, collapsed: collapsedPanels.toolbox ?? false, dock: "left", width: leftWidth, height: 220 },
      { id: "properties", title: "Properties", visible: true, collapsed: collapsedPanels.properties ?? false, dock: "right", width: rightWidth, height: 280 },
      { id: "objectTree", title: "Object Tree / Layers", visible: true, collapsed: collapsedPanels.objectTree ?? false, dock: "right", width: rightWidth, height: 320 },
      { id: "tags", title: "Tags", visible: true, collapsed: false, dock: "left", width: leftWidth, height: 220 },
      { id: "macros", title: "Macros", visible: true, collapsed: false, dock: "left", width: leftWidth, height: 220 },
      { id: "drivers", title: "Drivers", visible: true, collapsed: false, dock: "left", width: leftWidth, height: 220 },
    ];

    const nextLayout = normalizeLayoutSettings({
      ...layout,
      leftPanel: { ...layout.leftPanel, width: leftWidth, collapsed: leftCollapsed },
      rightPanel: { ...layout.rightPanel, width: rightWidth, collapsed: rightCollapsed },
      topArea: { ...layout.topArea, collapsed: topAreaCollapsed, compact: topAreaCompact },
      canvasToolbar: { ...layout.canvasToolbar, collapsed: canvasToolbarCollapsed, compact: canvasToolbarCompact },
      panels: {
        ...layout.panels,
        screensCollapsed: collapsedPanels.screens ?? false,
        currentScreenCollapsed: collapsedPanels.currentScreen ?? false,
        toolboxCollapsed: collapsedPanels.toolbox ?? false,
        propertiesCollapsed: collapsedPanels.properties ?? false,
        objectTreeCollapsed: collapsedPanels.objectTree ?? false,
      },
    });

    const nextSettings = {
      ...(project.editorSettings ?? {}),
      layout: nextLayout,
      leftPanelWidth: leftWidth,
      rightPanelWidth: rightWidth,
      showObjectFrames,
      panels: defaultPanels,
    };

    if (saveLayoutTimerRef.current) {
      window.clearTimeout(saveLayoutTimerRef.current);
    }
    saveLayoutTimerRef.current = window.setTimeout(() => {
      const latest = useScadaStore.getState().project;
      if (!latest) {
        return;
      }
      const prevSerialized = JSON.stringify(latest.editorSettings ?? {});
      const nextSerialized = JSON.stringify(nextSettings);
      if (prevSerialized === nextSerialized) {
        return;
      }
      useScadaStore.setState((state) => ({
        ...state,
        project: state.project
          ? {
              ...state.project,
              editorSettings: nextSettings,
            }
          : state.project,
      }));
      setLayout(nextLayout);
      void useScadaStore.getState().saveProject();
    }, 700);

    return () => {
      if (saveLayoutTimerRef.current) {
        window.clearTimeout(saveLayoutTimerRef.current);
      }
    };
  }, [
    canvasToolbarCollapsed,
    canvasToolbarCompact,
    collapsedPanels.assets,
    collapsedPanels.currentScreen,
    collapsedPanels.libraries,
    collapsedPanels.objectTree,
    collapsedPanels.properties,
    collapsedPanels.screens,
    collapsedPanels.toolbox,
    floatingAssetRect.height,
    floatingAssetRect.width,
    floatingAssetRect.x,
    floatingAssetRect.y,
    floatingAssets,
    floatingLibRect.height,
    floatingLibRect.width,
    floatingLibRect.x,
    floatingLibRect.y,
    floatingLibraries,
    layout,
    leftCollapsed,
    leftWidth,
    project,
    rightCollapsed,
    rightWidth,
    showObjectFrames,
    topAreaCollapsed,
    topAreaCompact,
  ]);

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
        const current = captureObjects();
        const previous = history.undo(current);
        if (previous) {
          applyObjects(previous);
        }
        return;
      }

      if (ctrlOrMeta && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        const current = captureObjects();
        const next = history.redo(current);
        if (next) {
          applyObjects(next);
        }
        return;
      }

      if (ctrlOrMeta && key === "s") {
        event.preventDefault();
        void saveProject();
        return;
      }

      if (!editing && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        const lockedCount = selectedObjects.filter((item) => item.locked).length;
        const before = captureObjects();
        removeSelectedUnlocked(screen.id);
        const latestProject = useScadaStore.getState().project;
        const latestScreen = latestProject?.screens.find((item) => item.id === screen.id);
        if (latestScreen) {
          history.pushEntry("Delete objects", before, latestScreen.objects);
        }
        if (lockedCount > 0) {
          void message.warning("Locked objects were not deleted.");
        }
        return;
      }

      if (!ctrlOrMeta) {
        return;
      }
      if (key === "g" && event.shiftKey) {
        event.preventDefault();
        const before = captureObjects();
        executeCommand({ type: "ungroupSelected" });
        const latestProject = useScadaStore.getState().project;
        const latestScreen = latestProject?.screens.find((item) => item.id === screen.id);
        if (latestScreen) {
          history.pushEntry("Command: ungroupSelected", before, latestScreen.objects);
        }
        return;
      }
      if (key === "g") {
        event.preventDefault();
        const before = captureObjects();
        executeCommand({ type: "groupSelected" });
        const latestProject = useScadaStore.getState().project;
        const latestScreen = latestProject?.screens.find((item) => item.id === screen.id);
        if (latestScreen) {
          history.pushEntry("Command: groupSelected", before, latestScreen.objects);
        }
        return;
      }
      if (key === "l" && event.shiftKey) {
        event.preventDefault();
        const before = captureObjects();
        executeCommand({ type: "unlockSelected" });
        const latestProject = useScadaStore.getState().project;
        const latestScreen = latestProject?.screens.find((item) => item.id === screen.id);
        if (latestScreen) {
          history.pushEntry("Command: unlockSelected", before, latestScreen.objects);
        }
        return;
      }
      if (key === "l") {
        event.preventDefault();
        const before = captureObjects();
        executeCommand({ type: "lockSelected" });
        const latestProject = useScadaStore.getState().project;
        const latestScreen = latestProject?.screens.find((item) => item.id === screen.id);
        if (latestScreen) {
          history.pushEntry("Command: lockSelected", before, latestScreen.objects);
        }
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyObjects, captureObjects, executeCommand, history, removeSelectedUnlocked, saveProject, screen, selectedObjects]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    const shell = document.querySelector(".app-shell") as HTMLElement | null;
    const workspace = document.querySelector(".editor-workspace") as HTMLElement | null;
    const viewport = document.querySelector(".canvas-viewport") as HTMLElement | null;
    const bodyOverflowX = document.body.scrollWidth > window.innerWidth + 1;
    const bodyOverflowY = document.body.scrollHeight > window.innerHeight + 1;

    // eslint-disable-next-line no-console
    console.info("[LayoutDiagnostics]", {
      window: { width: window.innerWidth, height: window.innerHeight },
      appShell: shell ? { width: shell.clientWidth, height: shell.clientHeight } : null,
      editorWorkspace: workspace ? { width: workspace.clientWidth, height: workspace.clientHeight } : null,
      canvasViewport: viewport ? { width: viewport.clientWidth, height: viewport.clientHeight } : null,
      body: { scrollWidth: document.body.scrollWidth, scrollHeight: document.body.scrollHeight },
      documentElement: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
    });

    if (bodyOverflowX || bodyOverflowY) {
      // eslint-disable-next-line no-console
      console.warn("Body overflow detected", {
        bodyScrollWidth: document.body.scrollWidth,
        bodyScrollHeight: document.body.scrollHeight,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
      });
    }
  }, [leftWidth, rightWidth, leftCollapsed, rightCollapsed, topAreaCollapsed, canvasToolbarCollapsed, floatingAssets, floatingLibraries, toolbarTab, leftTab]);

  useEffect(() => {
    history.clear();
  }, [screen?.id]);

  if (!project || !screen) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const runCommand = (command: EditorCommand): void => {
    runWithHistory(`Command: ${command.type}`, () => {
      const warnings = executeCommand(command);
      if (warnings.length) {
        void message.warning(warnings.join("; "));
      }
      setContextMenu((prev) => ({ ...prev, visible: false }));
    });
  };

  const addObjectWithHistory = useCallback(
    (object: HmiObject) => {
      runWithHistory(`Add ${object.type}`, () => {
        addObject(screen.id, object);
      });
    },
    [addObject, runWithHistory, screen.id],
  );

  const deleteSelectionWithHistory = useCallback(() => {
    if (!selectedObjects.length) {
      return;
    }
    const lockedCount = selectedObjects.filter((item) => item.locked).length;
    runWithHistory("Delete objects", () => {
      removeSelectedUnlocked(screen.id);
    });
    if (lockedCount > 0) {
      void message.warning("Locked objects were not deleted.");
    }
  }, [removeSelectedUnlocked, runWithHistory, screen.id, selectedObjects]);

  const moveObjectWithHistory = useCallback(
    (objectId: string, x: number, y: number) => {
      runWithHistory("Move object", () => {
        moveObject(screen.id, objectId, x, y);
      });
    },
    [moveObject, runWithHistory, screen.id],
  );

  const resizeObjectWithHistory = useCallback(
    (objectId: string, patch: Partial<HmiObject>) => {
      runWithHistory("Resize/transform object", () => {
        resizeObject(screen.id, objectId, patch);
      });
    },
    [resizeObject, runWithHistory, screen.id],
  );

  const updateObjectWithHistory = useCallback(
    (objectId: string, patch: Partial<HmiObject>, label = "Update object") => {
      runWithHistory(label, () => {
        updateObject(screen.id, objectId, patch);
      });
    },
    [runWithHistory, screen.id, updateObject],
  );

  const removeObjectWithHistory = useCallback(
    (objectId: string) => {
      runWithHistory("Delete object", () => {
        removeObject(screen.id, objectId);
      });
    },
    [removeObject, runWithHistory, screen.id],
  );

  const onUploadProjectAsset = async (file: File): Promise<void> => {
    try {
      await api.uploadAsset(file, assetUploadName || file.name);
      setAssetUploadName("");
      await Promise.all([loadAssets(), loadProject()]);
      void message.success("Asset загружен");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Ошибка загрузки asset");
    }
  };

  const addAssetAsImage = (asset: Asset, x = 100, y = 100): void => {
    const object = createObjectByType("image") as Extract<HmiObject, { type: "image" }>;
    addObjectWithHistory({
      ...object,
      x,
      y,
      assetId: asset.id,
      src: undefined,
      fit: "contain",
      preserveAspectRatio: true,
      opacity: 1,
    });
  };

  const addLibraryElementInstance = (libraryId: string, element: LibraryElement, x = 120, y = 120): void => {
    addObjectWithHistory({
      id: id("lib"),
      type: "libraryElementInstance",
      x,
      y,
      width: element.width,
      height: element.height,
      minWidth: 40,
      minHeight: 30,
      libraryId,
      elementId: element.id,
      tagPrefix: "",
      parameterValues: {},
      scaleMode: "fit",
    });
  };

  const attachLibrary = async (libraryId: string): Promise<void> => {
    try {
      const nextProject = await api.attachLibrary(libraryId);
      updateProjectJson(nextProject);
      await loadLibraries();
      void message.success("Библиотека подключена");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Не удалось подключить библиотеку");
    }
  };

  const detachLibrary = async (libraryId: string): Promise<void> => {
    try {
      const nextProject = await api.detachLibrary(libraryId);
      updateProjectJson(nextProject);
      await loadLibraries();
      void message.success("Библиотека отключена");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Не удалось отключить библиотеку");
    }
  };

  const createLibrary = async (): Promise<void> => {
    try {
      const created = await api.createLibrary({ id: newLibraryId, name: newLibraryName });
      const nextProject = await api.attachLibrary(created.id);
      updateProjectJson(nextProject);
      await loadLibraries();
      void message.success("Библиотека создана");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Не удалось создать библиотеку");
    }
  };

  const onSaveSelectionAsLibraryElement = async (): Promise<void> => {
    const targetLibrary = libraries.find((item) => item.id === saveTargetLibraryId);
    if (!targetLibrary) {
      void message.error("Выберите библиотеку");
      return;
    }

    const picked = selectionIds.length
      ? screen.objects.filter((obj) => selectionIds.includes(obj.id))
      : selectedObjects;
    if (!picked.length) {
      void message.error("Нужно выбрать хотя бы один объект");
      return;
    }

    try {
      const copied = await copySelectionAssetsToLibrary(picked, assets, targetLibrary.id);
      const normalized = normalizeObjects(copied);
      const bounds = computeBounds(normalized);
      const now = new Date().toISOString();
      const element: LibraryElement = {
        id: slugify(saveElementName),
        name: saveElementName,
        description: saveElementDescription || undefined,
        category: saveElementCategory || undefined,
        width: bounds.width,
        height: bounds.height,
        objects: normalized,
        parameters: [],
        createdAt: now,
        updatedAt: now,
      };
      await api.createLibraryElement(targetLibrary.id, element);
      await loadLibraries();
      setSaveModalOpen(false);
      void message.success("Элемент сохранен в библиотеку");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Ошибка сохранения в библиотеку");
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const data = event.dataTransfer.getData("application/web-scada-item");
    if (!data) {
      return;
    }
    const rect = panelDropRef.current?.getBoundingClientRect();
    const x = rect ? Math.max(0, event.clientX - rect.left) : 120;
    const y = rect ? Math.max(0, event.clientY - rect.top) : 120;
    try {
      const payload = JSON.parse(data) as
        | { kind: "asset"; assetId: string }
        | { kind: "library-element"; libraryId: string; elementId: string };
      if (payload.kind === "asset") {
        const asset = assets.find((item) => item.id === payload.assetId);
        if (asset) {
          addAssetAsImage(asset, x, y);
        }
        return;
      }
      const library = libraries.find((item) => item.id === payload.libraryId);
      const element = library?.elements.find((item) => item.id === payload.elementId);
      if (library && element) {
        addLibraryElementInstance(library.id, element, x, y);
      }
    } catch {
      // ignore malformed drag payload
    }
  };

  const applyClone = (): void => {
    if (!selectedUnlocked.length) {
      setCloneOpen(false);
      return;
    }

    const created: HmiObject[] = [];
    for (let i = 0; i < cloneOptions.count; i += 1) {
      const index = cloneOptions.startIndex + i * cloneOptions.step;
      const dx = cloneOptions.direction === "horizontal" ? cloneOptions.gapX * (i + 1) : 0;
      const dy = cloneOptions.direction === "vertical" ? cloneOptions.gapY * (i + 1) : 0;
      for (const source of selectedUnlocked) {
        const copy = cloneObject(source, index, cloneOptions, dx, dy);
        created.push(copy);
      }
    }

    runWithHistory("Clone objects", () => {
      for (const object of created) {
        addObject(screen.id, object);
      }
    });
    setSelectedObjects(
      created.map((obj) => obj.id),
      created[created.length - 1]?.id,
    );
    setCloneOpen(false);
  };

  const leftPanelHidden = leftCollapsed;
  const rightPanelHidden = rightCollapsed;

  const resetLayout = (): void => {
    const defaults = normalizeLayoutSettings(defaultEditorLayoutSettings);
    setLayout(defaults);
    setLeftWidth(defaults.leftPanel.width);
    setRightWidth(defaults.rightPanel.width);
    setLeftCollapsed(defaults.leftPanel.collapsed);
    setRightCollapsed(defaults.rightPanel.collapsed);
    setTopAreaCollapsed(defaults.topArea.collapsed);
    setTopAreaCompact(defaults.topArea.compact);
    setCanvasToolbarCollapsed(defaults.canvasToolbar.collapsed);
    setCanvasToolbarCompact(defaults.canvasToolbar.compact);
    setCollapsedPanels((prev) => ({
      ...prev,
      screens: defaults.panels.screensCollapsed,
      currentScreen: defaults.panels.currentScreenCollapsed,
      toolbox: defaults.panels.toolboxCollapsed,
      properties: defaults.panels.propertiesCollapsed,
      objectTree: defaults.panels.objectTreeCollapsed,
    }));
    setFocusMode(false);
  };

  const toggleFocusMode = (): void => {
    setFocusMode((prev) => {
      const next = !prev;
      if (next) {
        focusRestoreRef.current = {
          leftCollapsed,
          rightCollapsed,
          topAreaCollapsed,
          canvasToolbarCollapsed,
        };
        setLeftCollapsed(true);
        setRightCollapsed(true);
        setTopAreaCollapsed(true);
        setCanvasToolbarCollapsed(true);
      } else {
        const restore = focusRestoreRef.current;
        setLeftCollapsed(restore?.leftCollapsed ?? false);
        setRightCollapsed(restore?.rightCollapsed ?? false);
        setTopAreaCollapsed(restore?.topAreaCollapsed ?? false);
        setCanvasToolbarCollapsed(restore?.canvasToolbarCollapsed ?? false);
        focusRestoreRef.current = null;
      }
      return next;
    });
  };

  const canGroup = selectedUnlocked.length >= 2;
  const canUngroup = selectedGroups.some((item) => !item.locked);
  const canAlign = selectedUnlocked.length >= 2;
  const canDistribute = selectedUnlocked.length >= 3;
  const canSameSize = selectedUnlocked.length >= 2;
  const canLock = selectedObjects.length > 0;
  const canUnlock = selectedObjects.some((item) => item.locked);
  const canDelete = selectedUnlocked.length > 0;
  const debugPerformance =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.localStorage.getItem("debugPerformance") === "1";

  useEffect(() => {
    if (!debugPerformance) {
      return;
    }
    // eslint-disable-next-line no-console
    console.debug("[Render] EditorPage", {
      screenId: screen.id,
      objects: screen.objects.length,
      selected: selection.selectedObjectIds.length,
      history: {
        undo: history.canUndo,
        redo: history.canRedo,
      },
    });
  }, [debugPerformance, history.canRedo, history.canUndo, screen.id, screen.objects.length, selection.selectedObjectIds.length]);

  const undo = () => {
    const previous = history.undo(captureObjects());
    if (previous) {
      applyObjects(previous);
    }
  };

  const addSvgAssetAsPrimitives = async (asset: Asset, x = 100, y = 100): Promise<void> => {
    try {
      const imported = await importSvgAssetToPrimitives(asset);
      const { groupBounds, normalizedObjects } = normalizeObjectsToGroup(imported.objects);
      addObjectWithHistory({
        id: id("group"),
        type: "group",
        name: `svg:${asset.name}`,
        x,
        y,
        width: Math.max(1, groupBounds.width),
        height: Math.max(1, groupBounds.height),
        minWidth: 10,
        minHeight: 10,
        objects: normalizedObjects,
      });
      if (imported.warnings.length) {
        void message.warning(imported.warnings.join(" | "));
      } else {
        void message.success(`SVG imported as primitives: ${asset.name}`);
      }
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to import SVG as primitives");
    }
  };

  const redo = () => {
    const next = history.redo(captureObjects());
    if (next) {
      applyObjects(next);
    }
  };

  return (
    <div className="editor-page">
	          <Card
        size="small"
        className="editor-ribbon"
        style={{ marginBottom: 12, minWidth: 0 }}
        bodyStyle={{ overflow: "hidden", padding: topAreaCompact ? 8 : 12 }}
        extra={
          <Space size={6}>
            <Tooltip title="Undo Ctrl+Z">
              <Button size="small" icon={<UndoOutlined />} onClick={undo} disabled={!history.canUndo} />
            </Tooltip>
            <Tooltip title="Redo Ctrl+Y">
              <Button size="small" icon={<RedoOutlined />} onClick={redo} disabled={!history.canRedo} />
            </Tooltip>
            <Tooltip title="Delete Del">
              <Button size="small" icon={<DeleteOutlined />} onClick={deleteSelectionWithHistory} disabled={!canDelete} />
            </Tooltip>
            <Tooltip title="Save Ctrl+S">
              <Button size="small" icon={<SaveOutlined />} onClick={() => void saveProject()} />
            </Tooltip>
            <Tooltip title={leftPanelHidden ? "Show left panel" : "Hide left panel"}>
              <Button
                size="small"
                icon={leftPanelHidden ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setLeftCollapsed((prev) => !prev)}
              />
            </Tooltip>
            <Tooltip title={rightPanelHidden ? "Show right panel" : "Hide right panel"}>
              <Button
                size="small"
                icon={rightPanelHidden ? <MenuUnfoldOutlined /> : <MenuFoldOutlined style={{ transform: "scaleX(-1)" }} />}
                onClick={() => setRightCollapsed((prev) => !prev)}
              />
            </Tooltip>
            <Tooltip title={canvasToolbarCollapsed ? "Show canvas toolbar" : "Hide canvas toolbar"}>
              <Button
                size="small"
                icon={canvasToolbarCollapsed ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                onClick={() => setCanvasToolbarCollapsed((prev) => !prev)}
              />
            </Tooltip>
            <Tooltip title={topAreaCollapsed ? "Expand ribbon" : "Collapse ribbon"}>
              <Button
                size="small"
                icon={topAreaCollapsed ? <VerticalAlignTopOutlined /> : <BorderOutlined />}
                onClick={() => setTopAreaCollapsed((prev) => !prev)}
              />
            </Tooltip>
            <Tooltip title={focusMode ? "Exit focus mode" : "Focus mode"}>
              <Button
                size="small"
                icon={focusMode ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                onClick={toggleFocusMode}
              />
            </Tooltip>
            <Tooltip title="Reset layout">
              <Button size="small" icon={<ReloadOutlined />} onClick={resetLayout} />
            </Tooltip>
          </Space>
        }
      >
        {topAreaCollapsed ? (
          <Space wrap>
            <Button size="small" type="primary" onClick={() => void saveProject()}>Save</Button>
            <Button size="small" onClick={() => navigate("/runtime")}>Run Preview</Button>
            <Button size="small" onClick={() => setFloatingAssets(true)}>Assets</Button>
            <Button size="small" onClick={() => setFloatingLibraries(true)}>Libraries</Button>
            <Switch checked={showObjectFrames} onChange={setShowObjectFrames} />
          </Space>
        ) : (
          <Tabs
            size="small"
            activeKey={toolbarTab}
            onChange={setToolbarTab}
            items={[
            {
              key: "file",
              label: "File",
              children: (
                <Space wrap>
                  <Button type="primary" onClick={() => void saveProject()}>Save</Button>
                  <Button onClick={() => void saveProject()}>Save As</Button>
                  <Button onClick={() => void loadProject()}>Import Project</Button>
                  <Button onClick={() => void saveProject()}>Export Project</Button>
                  <Button onClick={() => navigate("/project")}>Project Settings</Button>
                </Space>
              ),
            },
            {
              key: "edit",
              label: "Edit",
              children: (
                <Space wrap>
                  <Button disabled>Undo</Button>
                  <Button disabled>Redo</Button>
                  <Button disabled>Cut</Button>
                  <Button disabled>Copy</Button>
                  <Button disabled>Paste</Button>
                  <Button danger disabled={!selectedUnlocked.length} onClick={deleteSelectionWithHistory}>Delete</Button>
                  <Button disabled={!selectedUnlocked.length} onClick={() => setCloneOpen(true)}>Clone</Button>
                </Space>
              ),
            },
            {
              key: "arrange",
              label: "Arrange",
              children: (
                <Space wrap>
                  <Button onClick={() => runCommand({ type: "groupSelected" })} disabled={!canGroup}>Group</Button>
                  <Button onClick={() => runCommand({ type: "ungroupSelected" })} disabled={!canUngroup}>Ungroup</Button>
                  <Button onClick={() => runCommand({ type: "alignLeft" })} disabled={!canAlign}>Align Left</Button>
                  <Button onClick={() => runCommand({ type: "alignHorizontalCenter" })} disabled={!canAlign}>Align Center</Button>
                  <Button onClick={() => runCommand({ type: "alignRight" })} disabled={!canAlign}>Align Right</Button>
                </Space>
              ),
            },
            {
              key: "insert",
              label: "Insert",
              children: (
                <Space wrap>
                  {basicToolboxTypes.map((type) => (
                    <Button key={type} size="small" onClick={() => addObjectWithHistory(createObjectByType(type))}>
                      {type}
                    </Button>
                  ))}
                  <Button size="small" onClick={() => addObjectWithHistory(createPrimitiveShape("square"))}>Square</Button>
                  <Button size="small" onClick={() => addObjectWithHistory(createPrimitiveShape("circle"))}>Circle</Button>
                  <Button size="small" onClick={() => addObjectWithHistory(createPrimitiveShape("triangle"))}>Triangle</Button>
                </Space>
              ),
            },
            {
              key: "runtime",
              label: "Runtime",
              children: (
                <Space wrap>
                  <Button onClick={() => navigate("/runtime")}>Preview</Button>
                  <Button onClick={() => navigate("/runtime")}>Open Runtime</Button>
                  <Button onClick={() => updateProjectJson({ ...project, startScreenId: screen.id })}>Set Start Screen</Button>
                </Space>
              ),
            },
            {
              key: "tools",
              label: "Tools",
              children: (
                <Space wrap>
                  <Button onClick={() => setLeftTab("screens")}>Screens</Button>
                  <Button onClick={() => setLeftTab("assets")}>Assets</Button>
                  <Button onClick={() => setLeftTab("libraries")}>Libraries</Button>
                  <Button onClick={() => setLeftTab("tags")}>Tags</Button>
                  <Button onClick={() => setLeftTab("macros")}>Macros</Button>
                  <Button onClick={() => setFloatingAssets(true)}>Open Asset Manager</Button>
                  <Button onClick={() => setFloatingLibraries(true)}>Open Library Directory</Button>
                  <Space>
                    <span>Show Object Frames</span>
                    <Switch checked={showObjectFrames} onChange={setShowObjectFrames} />
                  </Space>
                </Space>
              ),
            },
            ]}
          />
        )}
      </Card>
      <div ref={workspaceRef} className="editor-workspace" style={{ minHeight: 0, overflow: "hidden" }}>
        <ResizableDockPanel
          id="editor.leftDock"
          side="left"
          hidden={leftPanelHidden}
          size={leftWidth}
          lastVisibleSize={leftWidth}
          minSize={layout.leftPanel.minWidth}
          maxSize={layout.leftPanel.maxWidth}
          autoHideThreshold={80}
          restoreSize={defaultEditorLayoutSettings.leftPanel.width}
          workspaceRef={workspaceRef}
          restoreTooltip="Show left panel"
          restoreIcon={<RightOutlined />}
          onStateChange={(state) => {
            setLeftCollapsed(state.hidden);
            if (!state.hidden) {
              setLeftWidth(clamp(state.size, layout.leftPanel.minWidth, layout.leftPanel.maxWidth));
            }
          }}
          className="editor-column dock-panel"
        >
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto", height: "100%", minWidth: 0, paddingRight: 2 }}>
              <div className="dock-header">
                <Typography.Text strong>Left Dock</Typography.Text>
                <Button size="small" onClick={() => setLeftCollapsed(true)}>Hide</Button>
              </div>
          <Card size="small" style={{ marginBottom: 12, overflow: "auto", minHeight: 0 }}>
            <Tabs
              activeKey={leftTab}
              onChange={setLeftTab}
              size="small"
              items={[
                {
                  key: "screens",
                  label: "Screens",
                  children: <Typography.Text type="secondary">Screen management below</Typography.Text>,
                },
                {
                  key: "assets",
                  label: "Assets",
                  children: <Typography.Text type="secondary">Asset manager below</Typography.Text>,
                },
                {
                  key: "libraries",
                  label: "Libraries",
                  children: <Typography.Text type="secondary">Library management in side panel</Typography.Text>,
                },
                {
                  key: "tags",
                  label: "Tags",
                  children: (
                    <Space direction="vertical">
                      <Typography.Text type="secondary">Tag table and search</Typography.Text>
                      <Button size="small" onClick={() => navigate("/tags")}>Open Tags Workspace</Button>
                    </Space>
                  ),
                },
                {
                  key: "macros",
                  label: "Macros",
                  children: (
                    <Space direction="vertical">
                      <Typography.Text type="secondary">Macro list and run</Typography.Text>
                      <List
                        size="small"
                        dataSource={project.macros ?? []}
                        renderItem={(macro) => (
                          <List.Item
                            actions={[
                              <Button
                                size="small"
                                disabled={(macro.enabled ?? true) === false}
                                onClick={() => void useScadaStore.getState().runMacro(macro.id)}
                              >
                                Run
                              </Button>,
                            ]}
                          >
                            <Space>
                              <span>{macro.name}</span>
                              <Tag color={macro.enabled ?? true ? "green" : "default"}>
                                {macro.enabled ?? true ? "EN" : "DIS"}
                              </Tag>
                            </Space>
                          </List.Item>
                        )}
                      />
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
          <Card
            title="Screens"
            size="small"
            style={{ display: leftTab === "screens" ? "block" : "none", overflow: "auto", minHeight: 0 }}
            extra={
              <Space>
                <Button size="small" onClick={() => setCollapsedPanels((prev) => ({ ...prev, screens: !prev.screens }))}>
                  {collapsedPanels.screens ? "Expand" : "Collapse"}
                </Button>
                <Select
                  size="small"
                  value={newScreenKind}
                  style={{ width: 100 }}
                  onChange={(value) => setNewScreenKind(value)}
                  options={[
                    { label: "Screen", value: "screen" },
                    { label: "Popup", value: "popup" },
                    { label: "Template", value: "template" },
                  ]}
                />
                <Button size="small" onClick={() => addScreen(newScreenKind)}>
                  Add
                </Button>
              </Space>
            }
          >
            {collapsedPanels.screens ? null : (
            <List
              size="small"
              dataSource={project.screens}
              renderItem={(item) => (
                <List.Item
                  onClick={() => setCurrentScreen(item.id)}
                  style={{ cursor: "pointer", fontWeight: item.id === screen.id ? 700 : 400 }}
                >
                  {`${item.name} (${item.kind})`}
                </List.Item>
              )}
            />
            )}
          </Card>

          <Card
            title="Current Screen"
            size="small"
            style={{ marginTop: 12, display: leftTab === "screens" ? "block" : "none", overflow: "auto", minHeight: 0 }}
            extra={<Button size="small" onClick={() => setCollapsedPanels((prev) => ({ ...prev, currentScreen: !prev.currentScreen }))}>{collapsedPanels.currentScreen ? "Expand" : "Collapse"}</Button>}
          >
            {collapsedPanels.currentScreen ? null : (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input value={screen.name} onChange={(e) => updateScreen(screen.id, { name: e.target.value })} />
              <InputNumber style={{ width: "100%" }} value={screen.width} onChange={(value) => updateScreen(screen.id, { width: Number(value ?? 320) })} />
              <InputNumber style={{ width: "100%" }} value={screen.height} onChange={(value) => updateScreen(screen.id, { height: Number(value ?? 200) })} />
              <Input placeholder="background" value={screen.background ?? ""} onChange={(e) => updateScreen(screen.id, { background: e.target.value })} />
            </Space>
            )}
          </Card>

          <Card
            title="Toolbox (Basic)"
            size="small"
            style={{ marginTop: 12, display: leftTab === "screens" ? "block" : "none", overflow: "auto", minHeight: 0 }}
            extra={<Button size="small" onClick={() => setCollapsedPanels((prev) => ({ ...prev, toolbox: !prev.toolbox }))}>{collapsedPanels.toolbox ? "Expand" : "Collapse"}</Button>}
          >
            {collapsedPanels.toolbox ? null : (
            <Space wrap>
              {basicToolboxTypes.map((type) => (
                <Button key={type} size="small" onClick={() => addObjectWithHistory(createObjectByType(type))}>
                  {type}
                </Button>
              ))}
              <Button size="small" onClick={() => addObjectWithHistory(createPrimitiveShape("square"))}>Square</Button>
              <Button size="small" onClick={() => addObjectWithHistory(createPrimitiveShape("circle"))}>Circle</Button>
              <Button size="small" onClick={() => addObjectWithHistory(createPrimitiveShape("triangle"))}>Triangle</Button>
            </Space>
            )}
          </Card>

          <Card
            title="Assets"
            size="small"
            style={{ marginTop: 12, display: leftTab === "assets" && !floatingAssets ? "block" : "none", overflow: "auto", minHeight: 0 }}
            extra={
              <Space>
                <Button size="small" onClick={() => setFloatingAssets(true)}>Float</Button>
                <Button size="small" onClick={() => setCollapsedPanels((prev) => ({ ...prev, assets: !prev.assets }))}>{collapsedPanels.assets ? "Expand" : "Collapse"}</Button>
              </Space>
            }
          >
            {collapsedPanels.assets ? null : (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input value={assetUploadName} onChange={(e) => setAssetUploadName(e.target.value)} placeholder="Имя asset (опционально)" />
              <Space>
                <Button onClick={() => uploadInputRef.current?.click()}>Upload PNG/JPG/SVG</Button>
                <Button onClick={() => void loadAssets()}>Refresh</Button>
              </Space>
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
              <List
                size="small"
                dataSource={assets}
                renderItem={(asset) => (
                  <List.Item
                    style={{ cursor: "grab" }}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        "application/web-scada-item",
                        JSON.stringify({ kind: "asset", assetId: asset.id }),
                      );
                    }}
                    actions={[
                      <Button key="add-image" size="small" onClick={() => addAssetAsImage(asset)}>
                        Add Image
                      </Button>,
                      asset.type === "svg" ? (
                        <Button key="add-svg" size="small" onClick={() => void addSvgAssetAsPrimitives(asset)}>
                          Add SVG Primitives
                        </Button>
                      ) : null,
                    ]}
                  >
                    <Space>
                      <img src={asset.previewUrl} alt={asset.name} style={{ width: 30, height: 30, objectFit: "contain", background: "#111" }} />
                      <span>{asset.name}</span>
                    </Space>
                  </List.Item>
                )}
              />
            </Space>
            )}
          </Card>
          </div>
        </ResizableDockPanel>

        <div className="editor-center-column" style={{ flex: "1 1 auto" }}>
          <Card
            size="small"
            className="editor-stage-card"
            title={`Editor: ${screen.name}`}
            extra={
              <Space>
                <Button onClick={() => void saveProject()} type="primary">
                  Save
                </Button>
                <Button onClick={() => navigate("/runtime")}>Run Preview</Button>
                <Tooltip title={canvasToolbarCollapsed ? "Show toolbar" : "Hide toolbar"}>
                  <Button
                    onClick={() => setCanvasToolbarCollapsed((prev) => !prev)}
                    size="small"
                    icon={canvasToolbarCollapsed ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                  />
                </Tooltip>
                <Tooltip title={canvasToolbarCompact ? "Toolbar normal" : "Toolbar compact"}>
                  <Button
                    onClick={() => setCanvasToolbarCompact((prev) => !prev)}
                    size="small"
                    icon={<BorderOutlined />}
                  />
                </Tooltip>
              </Space>
            }
          >
            <div className="editor-stage-toolbar" style={{ marginBottom: canvasToolbarCollapsed ? 6 : 10 }}>
            {canvasToolbarCollapsed ? (
              <Button size="small" onClick={() => setCanvasToolbarCollapsed(false)}>Show Canvas Commands</Button>
            ) : (
            <Space wrap size={canvasToolbarCompact ? 4 : 8}>
              <Button onClick={() => runCommand({ type: "groupSelected" })} disabled={!canGroup}>
                Group
              </Button>
              <Button onClick={() => runCommand({ type: "ungroupSelected" })} disabled={!canUngroup}>
                Ungroup
              </Button>
              <Button onClick={() => runCommand({ type: "lockSelected" })} disabled={!canLock}>
                Lock
              </Button>
              <Button onClick={() => runCommand({ type: "unlockSelected" })} disabled={!canUnlock}>
                Unlock
              </Button>
              <Button onClick={() => runCommand({ type: "alignLeft" })} disabled={!canAlign}>
                Align Left
              </Button>
              <Button onClick={() => runCommand({ type: "alignHorizontalCenter" })} disabled={!canAlign}>
                Align H-Center
              </Button>
              <Button onClick={() => runCommand({ type: "alignRight" })} disabled={!canAlign}>
                Align Right
              </Button>
              <Button onClick={() => runCommand({ type: "alignTop" })} disabled={!canAlign}>
                Align Top
              </Button>
              <Button onClick={() => runCommand({ type: "alignVerticalCenter" })} disabled={!canAlign}>
                Align V-Center
              </Button>
              <Button onClick={() => runCommand({ type: "alignBottom" })} disabled={!canAlign}>
                Align Bottom
              </Button>
              <Button onClick={() => runCommand({ type: "makeSameWidth" })} disabled={!canSameSize}>
                Same Width
              </Button>
              <Button onClick={() => runCommand({ type: "makeSameHeight" })} disabled={!canSameSize}>
                Same Height
              </Button>
              <Button onClick={() => runCommand({ type: "makeSameSize" })} disabled={!canSameSize}>
                Same Size
              </Button>
              <Button onClick={() => runCommand({ type: "distributeHorizontally" })} disabled={!canDistribute}>
                Distribute H
              </Button>
              <Button onClick={() => runCommand({ type: "distributeVertically" })} disabled={!canDistribute}>
                Distribute V
              </Button>
              <InputNumber
                placeholder="Gap"
                value={spacingGap}
                onChange={(value) => setSpacingGap(value === null ? undefined : Number(value))}
                style={{ width: 90 }}
              />
              <Button
                onClick={() => runCommand({ type: "spaceEvenlyHorizontally", options: { gap: spacingGap } })}
                disabled={!canDistribute}
              >
                Space H
              </Button>
              <Button
                onClick={() => runCommand({ type: "spaceEvenlyVertically", options: { gap: spacingGap } })}
                disabled={!canDistribute}
              >
                Space V
              </Button>
            </Space>
            )}
            </div>

            <div
              className="canvas-viewport"
              style={{ overflow: "auto", minHeight: 0 }}
              ref={panelDropRef}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({
                  visible: true,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <HmiStage
                project={project}
                mode="editor"
                screen={screen}
                tags={tags}
                libraries={libraries}
                selectedObjectIds={selection.selectedObjectIds}
                activeObjectId={selection.activeObjectId}
                selectionRect={selection.selectionRect}
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
                  setContextMenu({
                    visible: true,
                    x: clientX,
                    y: clientY,
                  });
                }}
                onSelectObjects={(objectIds, activeId) => {
                  setSelectedObjects(objectIds, activeId);
                }}
                onMoveObject={moveObjectWithHistory}
                onResizeObject={resizeObjectWithHistory}
              />
            </div>
          </Card>

        </div>
        <ResizableDockPanel
          id="editor.rightDock"
          side="right"
          hidden={rightPanelHidden}
          size={rightWidth}
          lastVisibleSize={rightWidth}
          minSize={layout.rightPanel.minWidth}
          maxSize={layout.rightPanel.maxWidth}
          autoHideThreshold={80}
          restoreSize={defaultEditorLayoutSettings.rightPanel.width}
          workspaceRef={workspaceRef}
          restoreTooltip="Show right panel"
          restoreIcon={<LeftOutlined />}
          onStateChange={(state) => {
            setRightCollapsed(state.hidden);
            if (!state.hidden) {
              setRightWidth(clamp(state.size, layout.rightPanel.minWidth, layout.rightPanel.maxWidth));
            }
          }}
          className="editor-column dock-panel"
        >
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto", height: "100%", minWidth: 0, paddingRight: 2 }}>
              <div className="dock-header">
                <Typography.Text strong>Right Dock</Typography.Text>
                <Button size="small" onClick={() => setRightCollapsed(true)}>Hide</Button>
              </div>
          <Card
            title="Libraries"
            size="small"
            style={{ display: leftTab === "libraries" && !floatingLibraries ? "block" : "none", overflow: "auto", minHeight: 0 }}
            extra={
              <Space>
                <Button size="small" onClick={() => setFloatingLibraries(true)}>Float</Button>
                <Button size="small" onClick={() => setCollapsedPanels((prev) => ({ ...prev, libraries: !prev.libraries }))}>{collapsedPanels.libraries ? "Expand" : "Collapse"}</Button>
              </Space>
            }
          >
            {collapsedPanels.libraries ? null : (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input value={newLibraryId} onChange={(e) => setNewLibraryId(e.target.value)} placeholder="library id" />
              <Input value={newLibraryName} onChange={(e) => setNewLibraryName(e.target.value)} placeholder="library name" />
              <Space>
                <Button onClick={() => void createLibrary()}>Create</Button>
                <Button onClick={() => void loadLibraries()}>Refresh</Button>
              </Space>

              <Divider style={{ margin: "8px 0" }} />
              <Typography.Text strong>Available Libraries</Typography.Text>
              <List
                size="small"
                dataSource={libraries}
                renderItem={(library) => {
                  const attached = (project.libraries ?? []).some((item) => item.libraryId === library.id && item.enabled);
                  return (
                    <List.Item
                      actions={[
                        attached ? (
                          <Typography.Text type="secondary">attached</Typography.Text>
                        ) : (
                          <Button size="small" onClick={() => void attachLibrary(library.id)}>Attach</Button>
                        ),
                      ]}
                    >
                      {library.name}
                    </List.Item>
                  );
                }}
              />

              <Divider style={{ margin: "8px 0" }} />
              <Typography.Text strong>Project Libraries</Typography.Text>
              <List
                size="small"
                dataSource={project.libraries ?? []}
                renderItem={(ref: ProjectLibraryRef) => (
                  <List.Item
                    actions={[
                      ref.enabled ? (
                        <Button size="small" onClick={() => void detachLibrary(ref.libraryId)}>Detach</Button>
                      ) : (
                        <Button size="small" type="primary" onClick={() => void attachLibrary(ref.libraryId)}>Attach</Button>
                      ),
                    ]}
                  >
                    {ref.name}
                  </List.Item>
                )}
              />

              <Divider style={{ margin: "8px 0" }} />
              <Typography.Text strong>Library Elements</Typography.Text>
              {enabledLibraryRefs.map((ref) => {
                const library = libraries.find((item) => item.id === ref.libraryId);
                if (!library) {
                  return (
                    <Card key={ref.libraryId} size="small" title={ref.name} style={{ marginBottom: 8 }}>
                      <Typography.Text type="danger">Library not found</Typography.Text>
                    </Card>
                  );
                }
                return (
                  <Card key={library.id} size="small" title={library.name} style={{ marginBottom: 8 }}>
                    <List
                      size="small"
                      dataSource={library.elements}
                      renderItem={(element) => (
                        <List.Item
                          style={{ cursor: "grab" }}
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
                  </Card>
                );
              })}
            </Space>
            )}
          </Card>

          <Card title="Internal Variables (LW)" size="small" style={{ marginTop: 12, display: leftTab === "macros" ? "block" : "none", overflow: "auto", minHeight: 0 }}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input value={newVarName} onChange={(e) => setNewVarName(e.target.value)} placeholder="Variable name" />
              <Select
                value={newVarType}
                onChange={(v) => setNewVarType(v)}
                options={["BOOL", "INT", "DINT", "REAL", "STRING"].map((item) => ({ label: item, value: item }))}
              />
              <Button
                onClick={() => {
                  if (!newVarName.trim()) {
                    return;
                  }
                  addVariable(newVarName.trim(), newVarType, newVarType === "BOOL" ? false : 0);
                }}
              >
                Add LW Variable
              </Button>
              <List
                size="small"
                dataSource={project.variables ?? []}
                renderItem={(item) => <List.Item>{`LW.${item.name} (${item.dataType})`}</List.Item>}
              />
            </Space>
          </Card>

          <Card
            title="Properties"
            size="small"
            style={{ marginTop: 12, overflow: "auto", minHeight: 0 }}
            extra={<Button size="small" onClick={() => setCollapsedPanels((prev) => ({ ...prev, properties: !prev.properties }))}>{collapsedPanels.properties ? "Expand" : "Collapse"}</Button>}
          >
            {collapsedPanels.properties ? null : activeObject ? (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Typography.Text>{`id: ${activeObject.id}`}</Typography.Text>
                <Typography.Text>{`type: ${activeObject.type}`}</Typography.Text>
                <Typography.Text>{`name: ${activeObject.name ?? "-"}`}</Typography.Text>
                <Typography.Text>{`x/y: ${Math.round(activeObject.x)} / ${Math.round(activeObject.y)}`}</Typography.Text>
                <Typography.Text>{`w/h: ${Math.round(activeObject.width)} / ${Math.round(activeObject.height)}`}</Typography.Text>
                <Typography.Text>{`locked: ${activeObject.locked ? "yes" : "no"}`}</Typography.Text>
                <Button type="primary" onClick={() => setPropertiesOpen(true)}>
                  Properties
                </Button>
              </Space>
            ) : (
              <Typography.Text type="secondary">Select object</Typography.Text>
            )}
          </Card>

          <Card
            title="Object Tree / Layers"
            size="small"
            style={{ marginTop: 12, overflow: "auto", minHeight: 0 }}
            extra={<Button size="small" onClick={() => setCollapsedPanels((prev) => ({ ...prev, objectTree: !prev.objectTree }))}>{collapsedPanels.objectTree ? "Expand" : "Collapse"}</Button>}
          >
            {collapsedPanels.objectTree ? null : (
              <Space direction="vertical" style={{ width: "100%" }}>
                <List
                  size="small"
                  dataSource={screen.objects}
                  renderItem={(item) => (
                    <List.Item
                      style={{
                        cursor: "pointer",
                        background: selection.selectedObjectIds.includes(item.id) ? "#e6f4ff" : "transparent",
                        borderRadius: 6,
                        paddingInline: 8,
                      }}
                      onClick={() => setSelectedObjects([item.id], item.id)}
                      actions={[
                        <Button
                          key={`visible-${item.id}`}
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation();
                            updateObjectWithHistory(item.id, { visible: !(item.visible ?? true) }, "Toggle object visibility");
                          }}
                        >
                          {item.visible ?? true ? "Hide" : "Show"}
                        </Button>,
                        <Button
                          key={`lock-${item.id}`}
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation();
                            updateObjectWithHistory(item.id, { locked: !item.locked }, "Toggle object lock");
                          }}
                        >
                          {item.locked ? "Unlock" : "Lock"}
                        </Button>,
                        <Button
                          key={`delete-${item.id}`}
                          size="small"
                          danger
                          disabled={item.locked}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeObjectWithHistory(item.id);
                          }}
                        >
                          Delete
                        </Button>,
                      ]}
                    >
                      <Checkbox
                        checked={selectionIds.includes(item.id)}
                        onChange={(event) => {
                          setSelectionIds((prev) =>
                            event.target.checked ? [...prev, item.id] : prev.filter((idValue) => idValue !== item.id),
                          );
                        }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {(item.name?.trim() || item.id)} ({item.type})
                      </Checkbox>
                    </List.Item>
                  )}
                />
                <Button type="primary" onClick={() => setSaveModalOpen(true)}>
                  Save Selection As Library Element
                </Button>
              </Space>
	            )}
	          </Card>
	          </div>
        </ResizableDockPanel>
	      </div>

	      {focusMode ? (
        <div className="focus-exit-button">
          <Button size="small" type="primary" onClick={toggleFocusMode}>
            Exit Focus
          </Button>
        </div>
      ) : null}

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
            placeholder="Библиотека"
            options={libraries.map((item) => ({ label: item.name, value: item.id }))}
          />
          <Input value={saveElementName} onChange={(e) => setSaveElementName(e.target.value)} placeholder="Имя элемента" />
          <Input value={saveElementDescription} onChange={(e) => setSaveElementDescription(e.target.value)} placeholder="Описание" />
          <Input value={saveElementCategory} onChange={(e) => setSaveElementCategory(e.target.value)} placeholder="Категория" />
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
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 2000,
            background: "#ffffff",
            border: "1px solid #d9d9d9",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            padding: 8,
          }}
          onMouseLeave={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
        >
          <Space direction="vertical">
            <Button size="small" onClick={() => setPropertiesOpen(true)} disabled={!activeObject}>Properties</Button>
            <Button size="small" onClick={() => setCloneOpen(true)} disabled={!selectedUnlocked.length}>Clone...</Button>
            <Button size="small" danger onClick={deleteSelectionWithHistory} disabled={!selectedUnlocked.length}>Delete</Button>
            <Button size="small" onClick={() => runCommand({ type: "groupSelected" })} disabled={!canGroup}>Group</Button>
            <Button size="small" onClick={() => runCommand({ type: "ungroupSelected" })} disabled={!canUngroup}>Ungroup</Button>
            <Button size="small" onClick={() => runCommand({ type: "lockSelected" })} disabled={!canLock}>Lock</Button>
            <Button size="small" onClick={() => runCommand({ type: "unlockSelected" })} disabled={!canUnlock}>Unlock</Button>
            <Button size="small" onClick={() => runCommand({ type: "alignLeft" })} disabled={!canAlign}>Align Left</Button>
            <Button size="small" onClick={() => runCommand({ type: "makeSameSize" })} disabled={!canSameSize}>Same Size</Button>
            <Button size="small" onClick={() => runCommand({ type: "distributeHorizontally" })} disabled={!canDistribute}>Distribute H</Button>
          </Space>
        </div>
      ) : null}
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

