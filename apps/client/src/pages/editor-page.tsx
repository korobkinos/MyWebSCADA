import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import type {
  Asset,
  EditorCommand,
  HmiScreen,
  HmiObject,
  LibraryElement,
  ProjectLibraryRef,
  RuntimeAction,
  ScadaProject,
  ScreenKind,
} from "@web-scada/shared";
import { normalizeObjectsToGroup } from "@web-scada/shared";
import {
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Space,
  Typography,
  message,
} from "antd";
import {
  ApiOutlined,
  AppstoreOutlined,
  CodeOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  SearchOutlined,
  TagsOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { api } from "../services/api";
import { createRuntimeSocket, updateRuntimeTagSubscriptions } from "../services/ws";
import { FloatingPanel } from "../components/floating-panel";
import { ObjectPropertyPanel } from "../components/object-property-panel";
import { createObjectByType } from "../hmi/editor/default-object-factory";
import { importSvgAssetToPrimitives } from "../hmi/editor/svg-primitive-import";
import { useSnapshotHistory } from "../hooks/use-snapshot-history";
import { useScadaStore } from "../store/scada-store";
import { isTextEditingTarget } from "../utils/keyboard";
import { getAssetDisplayPath, normalizeAssetFolderPath } from "../utils/asset-path";
import {
  ScadaWorkbenchLayout,
  WorkbenchButton,
  WorkbenchWindowManager,
  useWorkbenchWindows,
  type WorkbenchWindowDefinition,
} from "../components/workbench";
import {
  ScreenEditorAssetsWindow,
  ScreenEditorLayersWindow,
  ScreenEditorLibrariesWindow,
  ScreenEditorDriversWindow,
  ScreenEditorRuntimeWindow,
  ScreenEditorSaveSelectionWindow,
  ScreenEditorScreensWindow,
  ScreenEditorSearchWindow,
  ScreenEditorProjectSettingsWindow,
  ScreenEditorScreenSettingsWindow,
  ScreenEditorTagsWindow,
  ScreenEditorMacrosWindow,
  ScreenEditorUserManagementWindow,
} from "../features/screen-editor/windows";
import {
  ScreenEditorCenter,
  ScreenEditorBottomPanel,
  type ScreenEditorLogEntry,
} from "../features/screen-editor/components";
import { collectRuntimeTagSubscriptions } from "../hmi/runtime/runtime-tag-subscriptions";

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

export function EditorPage() {
  useEffect(() => {
    document.body.classList.add("workbench-theme");
    return () => {
      document.body.classList.remove("workbench-theme");
    };
  }, []);
  const navigate = useNavigate();
  const project = useScadaStore((s) => s.project);
  const tags = useScadaStore((s) => s.tags);
  const drivers = useScadaStore((s) => s.drivers);
  const assets = useScadaStore((s) => s.assets);
  const libraries = useScadaStore((s) => s.libraries);
  const runtime = useScadaStore((s) => s.runtime);
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
  const updateScreen = useScadaStore((s) => s.updateScreen);
  const setScreenObjects = useScadaStore((s) => s.setScreenObjects);
  const removeObject = useScadaStore((s) => s.removeObject);
  const addObject = useScadaStore((s) => s.addObject);
  const addScreen = useScadaStore((s) => s.addScreen);
  const saveProject = useScadaStore((s) => s.saveProject);
  const loadProject = useScadaStore((s) => s.loadProject);
  const loadAssets = useScadaStore((s) => s.loadAssets);
  const loadLibraries = useScadaStore((s) => s.loadLibraries);
  const startRuntime = useScadaStore((s) => s.startRuntime);
  const stopRuntime = useScadaStore((s) => s.stopRuntime);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const setTagValues = useScadaStore((s) => s.setTagValues);
  const hasPermission = useScadaStore((s) => s.hasPermission);
  const canUsersView = hasPermission("users.view");
  const canUsersWrite = hasPermission("users.write");
  const canUsersDelete = hasPermission("users.delete");
  const canUsersChangePassword = hasPermission("users.changePassword");

  const [pendingDeleteScreenId, setPendingDeleteScreenId] = useState<string | null>(null);
  const [newScreenKind, setNewScreenKind] = useState<ScreenKind>("screen");
  const [newLibraryId, setNewLibraryId] = useState("custom-equipment");
  const [newLibraryName, setNewLibraryName] = useState("Custom Library");
  const [saveTargetLibraryId, setSaveTargetLibraryId] = useState("");
  const [saveElementName, setSaveElementName] = useState("New Element");
  const [saveElementDescription, setSaveElementDescription] = useState("");
  const [saveElementCategory, setSaveElementCategory] = useState("General");
  const [assetUploadName, setAssetUploadName] = useState("");
  const [spacingGap, setSpacingGap] = useState<number | undefined>(undefined);
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
  const [objectClipboard, setObjectClipboard] = useState<HmiObject[]>([]);
  const [pasteIteration, setPasteIteration] = useState(0);
  const [screenSearch, setScreenSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [screenKindFilter, setScreenKindFilter] = useState<"all" | ScreenKind>("all");
  const [screenViewMode, setScreenViewMode] = useState<"grid" | "list">("grid");
  const [previewMode, setPreviewMode] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [saveStatusText, setSaveStatusText] = useState("Loaded");
  const [savedProjectSignature, setSavedProjectSignature] = useState<string | null>(null);
  const [editorLog, setEditorLog] = useState<ScreenEditorLogEntry[]>([]);
  const [viewAssetId, setViewAssetId] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [floatingLibraries, setFloatingLibraries] = useState<boolean>(false);
  const [floatingAssets, setFloatingAssets] = useState<boolean>(false);
  const [floatingLibRect, setFloatingLibRect] = useState({ x: 120, y: 120, width: 460, height: 520 });
  const [floatingAssetRect, setFloatingAssetRect] = useState({ x: 180, y: 160, width: 480, height: 520 });
  const {
    openWindows,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindow,
    resizeWindow,
    isWindowOpen,
  } = useWorkbenchWindows();

  const appendEditorLog = useCallback((level: ScreenEditorLogEntry["level"], messageText: string) => {
    const now = new Date();
    const entry: ScreenEditorLogEntry = {
      id: `${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
      time: now.toLocaleTimeString(),
      level,
      message: messageText,
    };
    setEditorLog((prev) => [...prev.slice(-199), entry]);
  }, []);

  const clearEditorLog = useCallback(() => {
    setEditorLog([]);
  }, []);

  const screen = useMemo(
    () => project?.screens.find((s) => s.id === currentScreenId) ?? project?.screens[0],
    [currentScreenId, project],
  );

  const viewAsset = useMemo(
    () => assets.find((asset) => asset.id === viewAssetId) ?? null,
    [assets, viewAssetId],
  );

  const selectedObjects = useMemo(
    () => screen?.objects.filter((obj) => selection.selectedObjectIds.includes(obj.id)) ?? [],
    [screen?.objects, selection.selectedObjectIds],
  );
  const currentProjectSignature = useMemo(() => buildProjectSaveSignature(project), [project]);
  const selectedUnlocked = selectedObjects.filter((obj) => !obj.locked);
  const showObjectFrames = project?.editorSettings?.showObjectFrames ?? false;
  const selectedGroups = selectedObjects.filter((obj) => obj.type === "group");
  const activeObject =
    (selection.activeObjectId ? selectedObjects.find((obj) => obj.id === selection.activeObjectId) : undefined) ??
    selectedObjects[0] ??
    null;
  const selectedBounds = useMemo(
    () => (selectedObjects.length ? computeBounds(selectedObjects) : null),
    [selectedObjects],
  );
  const startScreenName = useMemo(() => {
    const startId = project?.startScreenId;
    if (!startId) {
      return "-";
    }
    return project?.screens.find((item) => item.id === startId)?.name ?? startId;
  }, [project]);
  const history = useSnapshotHistory<HmiObject[]>({ maxSteps: 50 });

  useEffect(() => {
    if (!previewMode || !project || !screen) {
      return;
    }
    const socket = createRuntimeSocket({
      onTagValues: (values) => setTagValues(values),
    });
    return () => socket.close();
  }, [previewMode, project, screen, setTagValues]);

  useEffect(() => {
    if (!previewMode || !project || !screen) {
      updateRuntimeTagSubscriptions([]);
      return;
    }
    const subscriptionTags = collectRuntimeTagSubscriptions({
      project,
      libraries,
      screen,
      tags,
      popups: [],
    });
    updateRuntimeTagSubscriptions(subscriptionTags);
    return () => {
      updateRuntimeTagSubscriptions([]);
    };
  }, [libraries, previewMode, project, screen, tags]);

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

  const patchActiveObject = useCallback(
    (patch: Partial<HmiObject>) => {
      if (!screen) {
        return;
      }
      const state = useScadaStore.getState();
      const objectId = state.selection.activeObjectId ?? state.selection.selectedObjectIds[0];
      if (!objectId) {
        return;
      }
      const currentScreen = state.project?.screens.find((item) => item.id === screen.id);
      const currentObject = currentScreen?.objects.find((item) => item.id === objectId);
      if (!currentObject) {
        return;
      }
      updateObjectWithHistory(objectId, patch, `Patch object ${currentObject.name?.trim() || currentObject.id}`);
    },
    [screen, updateObjectWithHistory],
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
      const latestProject = useScadaStore.getState().project;
      setSaveStatusText("Saved");
      setSavedProjectSignature(buildProjectSaveSignature(latestProject));
      appendEditorLog("success", "action=save-project status=OK");
      void message.success("Project saved");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setSaveStatusText("Save failed");
      appendEditorLog("error", `action=save-project status=ERROR error=${errorMessage || "unknown error"}`);
      void message.error(errorMessage || "Failed to save project");
    } finally {
      setIsSavingProject(false);
    }
  }, [appendEditorLog, saveProject]);

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
    (asset: Asset, position?: { x: number; y: number }) => {
      if (!screen) {
        return;
      }
      const image = createObjectByType("image") as Extract<HmiObject, { type: "image" }>;
      image.assetId = asset.id;
      image.width = asset.width ?? 80;
      image.height = asset.height ?? 80;
      if (position) {
        const nextX = position.x - image.width / 2;
        const nextY = position.y - image.height / 2;
        image.x = Math.min(Math.max(0, nextX), Math.max(0, screen.width - image.width));
        image.y = Math.min(Math.max(0, nextY), Math.max(0, screen.height - image.height));
      }
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
    (event: DragEvent<HTMLDivElement>, position?: { x: number; y: number }) => {
      event.preventDefault();
      const raw =
        event.dataTransfer.getData("application/web-scada-item") ||
        event.dataTransfer.getData("application/web-scada-asset");
      if (!raw) {
        return;
      }
      try {
        const payload = JSON.parse(raw) as
          | { kind: "asset"; assetId: string }
          | { assetId: string }
          | { kind: "library-element"; libraryId: string; elementId: string };
        if ("assetId" in payload && (!("kind" in payload) || payload.kind === "asset")) {
          const asset = assets.find((a) => a.id === payload.assetId);
          if (asset) {
            addAssetAsImage(asset, position);
          }
        } else if ("kind" in payload && payload.kind === "library-element") {
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

  const requestDeleteScreen = useCallback((screenId: string) => {
    const currentProject = useScadaStore.getState().project;
    if (!currentProject) {
      return;
    }
    if (currentProject.screens.length <= 1) {
      void message.warning("Cannot delete the last screen");
      return;
    }
    const target = currentProject.screens.find((screen) => screen.id === screenId);
    if (!target) {
      void message.warning("Screen not found");
      return;
    }
    setPendingDeleteScreenId(screenId);
  }, []);

  const performDeleteScreen = useCallback(() => {
    if (!pendingDeleteScreenId) {
      return;
    }
    const latestProject = useScadaStore.getState().project;
    if (!latestProject) {
      setPendingDeleteScreenId(null);
      return;
    }
    const nextScreens = latestProject.screens.filter((screen) => screen.id !== pendingDeleteScreenId);
    if (nextScreens.length === latestProject.screens.length) {
      void message.warning("Screen not found");
      setPendingDeleteScreenId(null);
      return;
    }
    if (nextScreens.length === 0) {
      void message.warning("Cannot delete the last screen");
      setPendingDeleteScreenId(null);
      return;
    }
    const nextStartScreenId =
      latestProject.startScreenId === pendingDeleteScreenId
        ? nextScreens[0]?.id ?? null
        : latestProject.startScreenId;
    const previousCurrentScreenId = useScadaStore.getState().currentScreenId;
    const nextProject = {
      ...latestProject,
      screens: nextScreens,
      startScreenId: nextStartScreenId,
    } as ScadaProject;
    updateProjectJson(nextProject);
    if (previousCurrentScreenId === pendingDeleteScreenId) {
      const fallbackId = nextScreens[0]?.id;
      if (fallbackId) {
        setCurrentScreen(fallbackId);
      }
    }
    setPendingDeleteScreenId(null);
    void message.success("Screen deleted");
  }, [pendingDeleteScreenId, setCurrentScreen, updateProjectJson]);

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

  const selectObjectFromSearch = useCallback(
    (screenId: string, objectId: string) => {
      setCurrentScreen(screenId);
      setSelectedObjects([objectId], objectId);
      closeWindow("search");
    },
    [closeWindow, setCurrentScreen, setSelectedObjects],
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
        const MAX_ASSET_SIZE_BYTES = 10 * 1024 * 1024;
        if (file.size > MAX_ASSET_SIZE_BYTES) {
          appendEditorLog("error", `action=asset-upload status=ERROR file=${file.name} error=file-too-large`);
          void message.error("File is too large. Max size is 10 MB.");
          return;
        }
        appendEditorLog("info", `action=asset-upload status=START file=${file.name}`);
        const uploaded = await api.uploadAsset(file, assetUploadName.trim() || undefined);
        await loadAssets();
        await loadProject();
        setAssetUploadName("");
        appendEditorLog("success", `action=asset-upload status=OK asset=${uploaded.name} id=${uploaded.id}`);
        void message.success(`Asset uploaded: ${uploaded.name}`);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        appendEditorLog("error", `action=asset-upload status=ERROR file=${file.name} error=${text || "unknown error"}`);
        if (text.toLowerCase().includes("too large") || text.toLowerCase().includes("file size")) {
          void message.error("File is too large. Max size is 10 MB.");
        } else {
          void message.error(text || "Failed to upload asset");
        }
      }
    },
    [appendEditorLog, assetUploadName, loadAssets, loadProject, project],
  );

  const onSaveSelectionAsLibraryElement = useCallback(async () => {
    if (!selectedObjects.length) {
      void message.warning("Select one or more objects on canvas");
      return;
    }
    if (!saveTargetLibraryId) {
      void message.warning("Select library");
      return;
    }
    if (!saveElementName.trim()) {
      void message.warning("Element name is required");
      return;
    }
    const normalizedObjects = normalizeObjects(selectedObjects);
    const bounds = computeBounds(selectedObjects);
    const now = new Date().toISOString();
    const element: LibraryElement = {
      id: id("element"),
      elementKey: saveElementName.trim(),
      name: saveElementName.trim(),
      description: saveElementDescription.trim(),
      category: saveElementCategory.trim(),
      width: bounds.width,
      height: bounds.height,
      objects: normalizedObjects,
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
      closeWindow("saveSelectionAsElement");
      appendEditorLog("success", `action=save-library-element status=OK element=${element.name} id=${element.id}`);
      void message.success("Element saved to library");
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "Failed to save element";
      appendEditorLog("error", `action=save-library-element status=ERROR element=${element.name} id=${element.id} error=${errorText}`);
      void message.error(error instanceof Error ? error.message : "Failed to save element");
    }
  }, [appendEditorLog, assets, closeWindow, loadLibraries, saveElementCategory, saveElementDescription, saveElementName, saveTargetLibraryId, selectedObjects]);

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

  const handleDeleteAsset = useCallback(
    async (assetId: string) => {
      try {
        const target = useScadaStore.getState().assets.find((a) => a.id === assetId);
        appendEditorLog("info", `action=asset-delete status=START assetId=${assetId} name=${target?.name ?? ""}`);

        const result = await api.deleteAsset(assetId);

        await loadAssets();
        await loadProject();

        if (viewAssetId === assetId) {
          setViewAssetId(null);
          closeWindow("assetViewer");
        }

        if (result.used) {
          appendEditorLog("warning", `action=asset-delete status=OK assetId=${assetId} used=true`);
          void message.warning("Asset deleted. Some objects now reference missing asset.");
        } else {
          appendEditorLog("success", `action=asset-delete status=OK assetId=${assetId} used=false`);
          void message.success(`Asset deleted${target?.name ? `: ${target.name}` : ""}`);
        }
      } catch (error) {
        const err = error as Error & { status?: number; details?: unknown };
        const text = err.message || String(error);
        const normalized = text.toLowerCase();
        appendEditorLog("error", `action=asset-delete status=ERROR assetId=${assetId} error=${text || "unknown error"}`);

        console.error("Asset delete failed", error);

        if (
          err.status === 403 ||
          normalized.includes("403") ||
          normalized.includes("forbidden") ||
          normalized.includes("assets.delete")
        ) {
          void message.error("No permission to delete assets. Required: assets.delete");
          return;
        }

        if (
          err.status === 401 ||
          normalized.includes("401") ||
          normalized.includes("unauthorized")
        ) {
          void message.error("Authorization required. Please login again.");
          return;
        }

        void message.error(text || "Failed to delete asset");
      }
    },
    [appendEditorLog, closeWindow, loadAssets, loadProject, viewAssetId],
  );

  const moveAssetToFolder = useCallback(
    async (assetId: string, folderPath: string) => {
      try {
        const normalized = normalizeAssetFolderPath(folderPath);
        const current = useScadaStore.getState().assets.find((item) => item.id === assetId);
        if (!current) {
          return;
        }
        if (normalizeAssetFolderPath(current.folderPath ?? "") === normalized) {
          return;
        }
        const targetFolderLabel = normalized || "root";
        appendEditorLog("info", `action=asset-move status=START asset=${current.name} id=${assetId} to=${targetFolderLabel}`);
        await api.updateAsset(assetId, { folderPath: normalized });
        await loadAssets();
        await loadProject();
        appendEditorLog("success", `action=asset-move status=OK asset=${current.name} id=${assetId} to=${targetFolderLabel}`);
        void message.success("Asset moved");
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        appendEditorLog("error", `action=asset-move status=ERROR assetId=${assetId} error=${text || "unknown error"}`);
        void message.error(text || "Failed to move asset");
      }
    },
    [appendEditorLog, loadAssets, loadProject],
  );

  const bulkMoveAssetsToFolder = useCallback(
    async (updates: Array<{ assetId: string; folderPath: string }>) => {
      if (!updates.length) {
        return;
      }
      try {
        appendEditorLog("info", `action=asset-folder-bulk-move status=START updates=${updates.length}`);
        for (const update of updates) {
          await api.updateAsset(update.assetId, {
            folderPath: normalizeAssetFolderPath(update.folderPath),
          });
        }
        await loadAssets();
        await loadProject();
        appendEditorLog("success", `action=asset-folder-bulk-move status=OK updates=${updates.length}`);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        appendEditorLog("error", `action=asset-folder-bulk-move status=ERROR error=${text || "unknown error"}`);
        throw error;
      }
    },
    [appendEditorLog, loadAssets, loadProject],
  );

  const renameAsset = useCallback(
    async (assetId: string, name: string) => {
      const nextName = name.trim();
      if (!nextName) {
        void message.warning("Asset name is required");
        return;
      }
      try {
        const current = useScadaStore.getState().assets.find((item) => item.id === assetId);
        appendEditorLog("info", `action=asset-rename status=START assetId=${assetId} from=${current?.name ?? ""} to=${nextName}`);
        await api.updateAsset(assetId, { name: nextName });
        await loadAssets();
        await loadProject();
        appendEditorLog("success", `action=asset-rename status=OK assetId=${assetId} from=${current?.name ?? ""} to=${nextName}`);
        void message.success("Asset renamed");
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        appendEditorLog("error", `action=asset-rename status=ERROR assetId=${assetId} to=${nextName} error=${text || "unknown error"}`);
        void message.error(text || "Failed to rename asset");
      }
    },
    [appendEditorLog, loadAssets, loadProject],
  );

  const refreshAssets = useCallback(async () => {
    try {
      appendEditorLog("info", "action=asset-refresh status=START");
      await loadAssets();
      appendEditorLog("success", "action=asset-refresh status=OK");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      appendEditorLog("error", `action=asset-refresh status=ERROR error=${text || "unknown error"}`);
      void message.error(text || "Failed to refresh assets");
    }
  }, [appendEditorLog, loadAssets]);

  const saveObjectProperties = useCallback(async () => {
    const state = useScadaStore.getState();
    const objectId = state.selection.activeObjectId ?? state.selection.selectedObjectIds[0];
    if (!screen || !objectId) {
      appendEditorLog("warning", "action=save-object status=ERROR error=no-object-selected");
      return;
    }
    const object = state.project?.screens
      .find((item) => item.id === screen.id)
      ?.objects.find((item) => item.id === objectId);
    if (!object) {
      appendEditorLog("warning", "action=save-object status=ERROR error=object-not-found");
      return;
    }
    const objectName = object.name?.trim() || object.id;
    try {
      setIsSavingProject(true);
      await saveProject();
      const latestProject = useScadaStore.getState().project;
      setSaveStatusText("Saved");
      setSavedProjectSignature(buildProjectSaveSignature(latestProject));
      appendEditorLog("success", `action=save-object status=OK object=${objectName} id=${object.id}`);
      void message.success(`Object saved: ${objectName}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setSaveStatusText("Save failed");
      appendEditorLog(
        "error",
        `action=save-object status=ERROR object=${objectName} id=${object.id} error=${errorMessage || "unknown error"}`,
      );
      void message.error(errorMessage || "Failed to save object");
    } finally {
      setIsSavingProject(false);
    }
  }, [appendEditorLog, saveProject, screen]);

  const deleteActiveObject = useCallback(() => {
    const state = useScadaStore.getState();
    const objectId = state.selection.activeObjectId ?? state.selection.selectedObjectIds[0];
    if (!objectId) {
      return;
    }
    const object = state.project?.screens
      .find((item) => item.id === screen.id)
      ?.objects.find((item) => item.id === objectId);
    if (!object) {
      return;
    }
    if (object.locked) {
      void message.warning("Locked object cannot be deleted");
      return;
    }
    removeObjectWithHistory(object.id);
    closeWindow("objectProperties");
  }, [closeWindow, removeObjectWithHistory, screen.id]);

  const windowDefinitions: WorkbenchWindowDefinition[] = [
    {
      id: "screens",
      title: "Screens",
      defaultRect: { x: 90, y: 80, width: 440, height: 620 },
      minWidth: 320,
      minHeight: 360,
      render: () => (
        <ScreenEditorScreensWindow
          screens={filteredScreens}
          currentScreenId={screen.id}
          startScreenId={project.startScreenId}
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
          onDeleteScreen={requestDeleteScreen}
          onOpenScreenSettings={() => openDefinedWindow("screenSettings")}
        />
      ),
    },
    {
      id: "search",
      title: "Search",
      defaultRect: { x: 120, y: 100, width: 520, height: 620 },
      minWidth: 360,
      minHeight: 360,
      render: () => (
        <ScreenEditorSearchWindow
          screens={project.screens}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onSelectScreen={setCurrentScreen}
          onSelectObject={selectObjectFromSearch}
        />
      ),
    },
    {
      id: "projectSettings",
      title: "Project Settings",
      defaultRect: { x: 180, y: 100, width: 560, height: 520 },
      minWidth: 420,
      minHeight: 320,
      render: () => (
        <ScreenEditorProjectSettingsWindow
          project={project}
          onUpdateProject={updateProjectJson}
          onSaveProject={handleSaveProject}
          isSavingProject={isSavingProject}
          canUsersView={canUsersView}
          onOpenUserManagement={() => openDefinedWindow("userManagement")}
        />
      ),
    },
    {
      id: "userManagement",
      title: "User Management",
      defaultRect: { x: 210, y: 110, width: 780, height: 640 },
      minWidth: 520,
      minHeight: 360,
      render: () => (
        <ScreenEditorUserManagementWindow
          canWrite={canUsersWrite}
          canDelete={canUsersDelete}
          canChangePassword={canUsersChangePassword}
        />
      ),
    },
    {
      id: "screenSettings",
      title: "Screen Settings",
      defaultRect: { x: 220, y: 120, width: 520, height: 520 },
      minWidth: 420,
      minHeight: 320,
      render: () => (
        <ScreenEditorScreenSettingsWindow
          screen={screen}
          onUpdateScreen={(patch) => updateScreen(screen.id, patch)}
        />
      ),
    },
    {
      id: "runtime",
      title: "Runtime",
      defaultRect: { x: 160, y: 120, width: 420, height: 360 },
      minWidth: 320,
      minHeight: 260,
      render: () => (
        <ScreenEditorRuntimeWindow
          runtime={runtime}
          startScreenName={startScreenName}
          currentScreenName={screen.name}
          onOpenRuntime={() => navigate('/runtime')}
          onStartRuntime={startRuntime}
          onStopRuntime={stopRuntime}
        />
      ),
    },
    {
      id: "layers",
      title: "Layers / Object Tree",
      defaultRect: { x: 220, y: 140, width: 420, height: 620 },
      minWidth: 320,
      minHeight: 360,
      render: () => (
        <ScreenEditorLayersWindow
          screen={screen}
          libraries={libraries}
          selectedObjectIds={selection.selectedObjectIds}
          activeObjectId={selection.activeObjectId}
          onSelectObject={(objectId) => setSelectedObjects([objectId], objectId)}
          onOpenObjectPropertiesForObject={(objectId) => {
            setSelectedObjects([objectId], objectId);
            openDefinedWindow("objectProperties");
          }}
          onDeleteSelected={deleteSelectionWithHistory}
          onLockSelected={() => runCommand({ type: 'lockSelected' })}
          onUnlockSelected={() => runCommand({ type: 'unlockSelected' })}
          canDelete={canDelete}
          canLock={canLock}
          canUnlock={canUnlock}
        />
      ),
    },
    {
      id: "saveSelectionAsElement",
      title: "Save Selection As Library Element",
      defaultRect: { x: 260, y: 120, width: 520, height: 460 },
      minWidth: 420,
      minHeight: 320,
      render: () => (
        <ScreenEditorSaveSelectionWindow
          selectedObjects={selectedObjects}
          libraries={libraries}
          targetLibraryId={saveTargetLibraryId}
          setTargetLibraryId={setSaveTargetLibraryId}
          elementName={saveElementName}
          setElementName={setSaveElementName}
          category={saveElementCategory}
          setCategory={setSaveElementCategory}
          description={saveElementDescription}
          setDescription={setSaveElementDescription}
          width={selectedBounds?.width ?? screen.width}
          height={selectedBounds?.height ?? screen.height}
          onSave={onSaveSelectionAsLibraryElement}
          onCancel={() => closeWindow('saveSelectionAsElement')}
          onOpenLibraries={() => openDefinedWindow('libraries')}
        />
      ),
    },
    {
      id: "tags",
      title: "Tags",
      defaultRect: { x: 120, y: 80, width: 520, height: 520 },
      minWidth: 360,
      minHeight: 260,
      render: () => (
        <ScreenEditorTagsWindow />
      ),
    },
    {
      id: "macros",
      title: "Macros",
      defaultRect: { x: 140, y: 80, width: 980, height: 680 },
      minWidth: 720,
      minHeight: 460,
      render: () => (
        <ScreenEditorMacrosWindow />
      ),
    },
    {
      id: "drivers",
      title: "Drivers / OPC UA / Simulation",
      defaultRect: { x: 160, y: 100, width: 560, height: 460 },
      minWidth: 380,
      minHeight: 260,
      render: () => (
        <ScreenEditorDriversWindow drivers={drivers} />
      ),
    },
    {
      id: "assets",
      title: "Assets",
      defaultRect: { x: 180, y: 120, width: 620, height: 540 },
      minWidth: 420,
      minHeight: 320,
      render: () => (
        <ScreenEditorAssetsWindow
          assets={assets}
          onUploadAsset={onUploadProjectAsset}
          onAddAssetAsImage={addAssetAsImage}
          onMoveAssetToFolder={moveAssetToFolder}
          onBulkMoveAssetsToFolder={bulkMoveAssetsToFolder}
          onRenameAsset={renameAsset}
          onRefreshAssets={refreshAssets}
          onDeleteAsset={handleDeleteAsset}
          onViewAsset={(asset) => {
            setViewAssetId(asset.id);
            openDefinedWindow('assetViewer');
          }}
        />
      ),
    },
    {
      id: "libraries",
      title: "Libraries",
      defaultRect: { x: 200, y: 140, width: 660, height: 560 },
      minWidth: 460,
      minHeight: 340,
      render: () => (
        <ScreenEditorLibrariesWindow
          libraries={libraries}
          attachedLibraries={project.libraries ?? []}
          libraryId={newLibraryId}
          libraryName={newLibraryName}
          onLibraryIdChange={setNewLibraryId}
          onLibraryNameChange={setNewLibraryName}
          onCreateLibrary={createLibrary}
          onAttachLibrary={attachLibrary}
          onAddLibraryElementToScreen={addLibraryElementInstance}
          onRefreshLibraries={loadLibraries}
        />
      ),
    },
    {
      id: "assetViewer",
      title: viewAsset ? `Asset: ${getAssetDisplayPath(viewAsset)}` : "Asset Viewer",
      defaultRect: { x: 240, y: 120, width: 640, height: 520 },
      minWidth: 360,
      minHeight: 260,
      render: () =>
        viewAsset ? (
          <div className="screen-editor-window-content screen-editor-asset-viewer">
            <div className="screen-editor-asset-viewer__preview">
              {viewAsset.previewUrl ? (
                <img src={viewAsset.previewUrl} alt={viewAsset.name} />
              ) : (
                <span>No preview</span>
              )}
            </div>
            <div className="screen-editor-asset-viewer__info">
              <div><strong>Name:</strong> {viewAsset.name}</div>
              <div><strong>Path:</strong> {getAssetDisplayPath(viewAsset)}</div>
              <div><strong>ID:</strong> {viewAsset.id}</div>
              <div><strong>Type:</strong> {viewAsset.type?.toUpperCase() ?? '-'}</div>
              <div>
                <strong>Size:</strong>{' '}
                {viewAsset.width && viewAsset.height
                  ? `${viewAsset.width} x ${viewAsset.height} px`
                  : '-'}
              </div>
              <div>
                <strong>File size:</strong>{' '}
                {viewAsset.size ? `${(viewAsset.size / 1024).toFixed(1)} KB` : '-'}
              </div>
              <div className="screen-editor-asset-viewer__actions">
                <WorkbenchButton
                  variant="primary"
                  onClick={() => addAssetAsImage(viewAsset)}
                >
                  Add to Screen
                </WorkbenchButton>
              </div>
            </div>
          </div>
        ) : (
          <div className="screen-editor-empty-state">No asset selected</div>
        ),
    },
    {
      id: "objectProperties",
      title: "Object Properties",
      defaultRect: { x: 280, y: 100, width: 420, height: 620 },
      minWidth: 320,
      minHeight: 360,
      render: () => (
        <div className="screen-editor-window-content screen-editor-object-properties-window">
          <div className="object-property-panel-toolbar">
            <WorkbenchButton
              variant="primary"
              onClick={() => void saveObjectProperties()}
              disabled={!activeObject || isSavingProject}
            >
              Save Object
            </WorkbenchButton>
          </div>
          <ObjectPropertyPanel
            project={project}
            screen={screen}
            assets={assets}
            libraries={libraries}
            object={activeObject}
            onPatch={patchActiveObject}
            onDelete={deleteActiveObject}
          />
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
    { id: "screens", title: "Screens", icon: <AppstoreOutlined />, active: isWindowOpen("screens"), onClick: () => openDefinedWindow("screens") },
    { id: "search", title: "Search", icon: <SearchOutlined />, active: isWindowOpen("search"), onClick: () => openDefinedWindow("search") },
    { id: "tags", title: "Tags", icon: <TagsOutlined />, active: isWindowOpen("tags"), onClick: () => openDefinedWindow("tags") },
    { id: "macros", title: "Macros", icon: <CodeOutlined />, active: isWindowOpen("macros"), onClick: () => openDefinedWindow("macros") },
    { id: "assets", title: "Assets", icon: <FileImageOutlined />, active: isWindowOpen("assets"), onClick: () => openDefinedWindow("assets") },
    { id: "libraries", title: "Libraries", icon: <FolderOpenOutlined />, active: isWindowOpen("libraries"), onClick: () => openDefinedWindow("libraries") },
    { id: "drivers", title: "Drivers", icon: <ApiOutlined />, active: isWindowOpen("drivers"), onClick: () => openDefinedWindow("drivers") },
    { id: "runtime", title: "Runtime", icon: <PlayCircleOutlined />, active: isWindowOpen("runtime"), onClick: () => openDefinedWindow("runtime") },
    { id: "layers", title: "Layers", icon: <UnorderedListOutlined />, active: isWindowOpen("layers"), onClick: () => openDefinedWindow("layers") },
    { id: "projectSettings", title: "Project Settings", icon: <SettingOutlined />, active: isWindowOpen("projectSettings"), onClick: () => openDefinedWindow("projectSettings") },
    canUsersView
      ? { id: "userManagement", title: "Users", icon: <UserOutlined />, active: isWindowOpen("userManagement"), onClick: () => openDefinedWindow("userManagement") }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <div className="screen-editor-workbench-page">
      <ScadaWorkbenchLayout
        autoSaveId="my-web-scada-screen-editor"
        bottomTitle="Terminal"
        activityItems={activityItems}
        bottomPanel={{
          defaultSize: 18,
          minSize: 8,
          maxSize: 36,
          collapsible: true,
          collapsedSize: 0,
        }}
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
            onOpenObjectProperties={() => openDefinedWindow('objectProperties')}
            onOpenLayers={() => openDefinedWindow('layers')}
            onOpenSaveSelection={() => openDefinedWindow('saveSelectionAsElement')}
            onOpenScreenSettings={() => openDefinedWindow('screenSettings')}
            canSaveSelection={selectedObjects.length > 0}
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
            previewMode={previewMode}
            onPreviewModeChange={setPreviewMode}
          />
        }
        bottom={
          <ScreenEditorBottomPanel
            screen={screen}
            activeObject={activeObject}
            isProjectDirty={isProjectDirty}
            saveStatusText={saveStatusText}
            logs={editorLog}
            onClearLogs={clearEditorLog}
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

      {pendingDeleteScreenId ? (
        <div className="workbench-confirm-backdrop">
          <div className="workbench-confirm-dialog">
            <div className="workbench-confirm-dialog__header">
              Delete screen
            </div>
            <div className="workbench-confirm-dialog__body">
              Delete screen permanently?
            </div>
            <div className="workbench-confirm-dialog__actions">
              <button
                type="button"
                className="workbench-button"
                onClick={() => setPendingDeleteScreenId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="workbench-button workbench-button--danger"
                onClick={performDeleteScreen}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                        <span title={getAssetDisplayPath(asset)}>{getAssetDisplayPath(asset)}</span>
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
            <Button type="text" size="small" block onClick={() => openDefinedWindow("objectProperties")} disabled={!activeObject}>Properties</Button>
            <Button type="text" size="small" block onClick={() => openDefinedWindow("layers")}>Layers</Button>
            <Button type="text" size="small" block onClick={() => openDefinedWindow("saveSelectionAsElement")} disabled={!selectedObjects.length}>Save Selection</Button>
            <Button type="text" size="small" block onClick={copySelectionToClipboard} disabled={!canCopy}>Copy</Button>
            <Button type="text" size="small" block onClick={pasteFromClipboard} disabled={!canPaste}>Paste</Button>
            <Button type="text" size="small" block onClick={() => setCloneOpen(true)} disabled={!selectedUnlocked.length}>Clone...</Button>
            <Button type="text" size="small" danger block onClick={deleteSelectionWithHistory} disabled={!selectedUnlocked.length}>Delete</Button>
            <Button type="text" size="small" block onClick={() => runCommand({ type: "groupSelected" })} disabled={!canGroup}>Group</Button>
            <Button type="text" size="small" block onClick={() => runCommand({ type: "ungroupSelected" })} disabled={!canUngroup}>Ungroup</Button>
            <Button type="text" size="small" block onClick={() => runCommand({ type: "lockSelected" })} disabled={!canLock}>Lock</Button>
            <Button type="text" size="small" block onClick={() => runCommand({ type: "unlockSelected" })} disabled={!canUnlock}>Unlock</Button>
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

