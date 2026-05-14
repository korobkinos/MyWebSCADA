import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import type {
  Asset,
  EditorCommand,
  HmiScreen,
  HmiObject,
  LibraryElement,
  RuntimeAction,
  ScadaProject,
} from "@web-scada/shared";
import { Button, Form, Input, InputNumber, Modal, Select, Space, Typography, message } from "antd";
import {
  ApiOutlined,
  AppstoreOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  SearchOutlined,
  SnippetsOutlined,
  TagsOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { api } from "../services/api";
import { createObjectByType } from "../hmi/editor/default-object-factory";
import { useScadaStore } from "../store/scada-store";
import { isTextEditingTarget } from "../utils/keyboard";
import {
  ScadaWorkbenchLayout,
  WorkbenchWindowManager,
  useWorkbenchWindows,
} from "../components/workbench";
import {
  ScreenEditorCenter,
  ScreenEditorBottomPanel,
} from "../features/screen-editor/components";
import { useEditorLog } from "../features/screen-editor/hooks/use-editor-log";
import { useEditorClipboard } from "../features/screen-editor/hooks/use-editor-clipboard";
import { useEditorObjectHistory } from "../features/screen-editor/hooks/use-editor-object-history";
import { useEditorAssets } from "../features/screen-editor/hooks/use-editor-assets";
import { useEditorScreens } from "../features/screen-editor/hooks/use-editor-screens";
import { useEditorRuntimePreview } from "../features/screen-editor/hooks/use-editor-runtime-preview";
import { useEditorWindowDefinitions } from "../features/screen-editor/hooks/use-editor-window-definitions";

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
  const loadRuntimeStatus = useScadaStore((s) => s.loadRuntimeStatus);
  const startRuntime = useScadaStore((s) => s.startRuntime);
  const stopRuntime = useScadaStore((s) => s.stopRuntime);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const setTagValues = useScadaStore((s) => s.setTagValues);
  const hasPermission = useScadaStore((s) => s.hasPermission);

  const canUsersView = hasPermission("users.view");
  const canUsersWrite = hasPermission("users.write");
  const canUsersDelete = hasPermission("users.delete");
  const canUsersChangePassword = hasPermission("users.changePassword");

  const [newLibraryId, setNewLibraryId] = useState("custom-equipment");
  const [newLibraryName, setNewLibraryName] = useState("Custom Library");
  const [saveTargetLibraryId, setSaveTargetLibraryId] = useState("");
  const [saveElementName, setSaveElementName] = useState("New Element");
  const [saveElementDescription, setSaveElementDescription] = useState("");
  const [saveElementCategory, setSaveElementCategory] = useState("General");
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
  const [searchQuery, setSearchQuery] = useState("");
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [saveStatusText, setSaveStatusText] = useState("Loaded");
  const [savedProjectSignature, setSavedProjectSignature] = useState<string | null>(null);

  const {
    openWindows,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindow,
    resizeWindow,
    isWindowOpen,
  } = useWorkbenchWindows();

  const { editorLog, appendEditorLog, clearEditorLog } = useEditorLog();

  const screen = useMemo(
    () => project?.screens.find((item) => item.id === currentScreenId) ?? project?.screens[0],
    [currentScreenId, project],
  );

  const selectedObjects = useMemo(
    () => screen?.objects.filter((obj) => selection.selectedObjectIds.includes(obj.id)) ?? [],
    [screen?.objects, selection.selectedObjectIds],
  );

  const selectedUnlocked = useMemo(
    () => selectedObjects.filter((obj) => !obj.locked),
    [selectedObjects],
  );
  const selectedGroups = useMemo(
    () => selectedObjects.filter((obj) => obj.type === "group"),
    [selectedObjects],
  );
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

  const currentProjectSignature = useMemo(() => buildProjectSaveSignature(project), [project]);
  const isProjectDirty = currentProjectSignature !== savedProjectSignature && savedProjectSignature !== null;
  const showObjectFrames = project?.editorSettings?.showObjectFrames ?? false;

  const {
    canUndo,
    canRedo,
    undo,
    redo,
    runWithHistory,
    updateObjectWithHistory,
    removeObjectWithHistory,
    addObjectWithHistory,
    moveObjectWithHistory,
    resizeObjectWithHistory,
    deleteSelectionWithHistory,
    zOrderWithHistory,
  } = useEditorObjectHistory({
    screen,
    selection,
    selectedUnlocked,
    updateObject,
    removeObject,
    addObject,
    moveObject,
    resizeObject,
    setScreenObjects,
    setSelectedObjects,
  });

  const {
    canCopy,
    canPaste,
    copySelectionToClipboard,
    pasteFromClipboard,
  } = useEditorClipboard({
    selectedObjects,
    screen,
    runWithHistory,
    setScreenObjects,
  });

  const {
    viewAsset,
    setViewAssetId,
    onUploadProjectAsset,
    addAssetAsImage,
    handleDeleteAsset,
    moveAssetToFolder,
    bulkMoveAssetsToFolder,
    renameAsset,
    refreshAssets,
  } = useEditorAssets({
    project,
    screen,
    assets,
    addObjectWithHistory,
    loadAssets,
    loadProject,
    appendEditorLog,
    closeWindow,
    apiClient: api,
  });

  const {
    pendingDeleteScreenId,
    setPendingDeleteScreenId,
    newScreenKind,
    setNewScreenKind,
    screenSearch,
    setScreenSearch,
    screenKindFilter,
    setScreenKindFilter,
    screenViewMode,
    setScreenViewMode,
    filteredScreens,
    requestDeleteScreen,
    performDeleteScreen,
    duplicateScreenLocal,
    setStartScreen,
  } = useEditorScreens({
    project,
    currentScreenId,
    setCurrentScreen,
    setScreenObjects,
    updateProjectJson,
  });

  const { previewMode, setPreviewMode } = useEditorRuntimePreview({
    project,
    screen,
    libraries,
    tags,
    setTagValues,
  });

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

  const addPrimitiveShape = (kind: PrimitiveShapeKind) => {
    addObjectWithHistory(createPrimitiveShape(kind));
  };

  const addLibraryElementInstance = useCallback(
    (libraryId: string, elementOrId: LibraryElement | string) => {
      if (!screen) {
        return;
      }
      const elementId = typeof elementOrId === "string" ? elementOrId : elementOrId.id;
      const library = libraries.find((item) => item.id === libraryId);
      if (!library) {
        void message.warning(`Library not found: ${libraryId}`);
        return;
      }
      const element = library.elements.find((item: LibraryElement) => item.id === elementId);
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
          const asset = assets.find((item) => item.id === payload.assetId);
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
  }, [
    appendEditorLog,
    assets,
    closeWindow,
    loadLibraries,
    saveElementCategory,
    saveElementDescription,
    saveElementName,
    saveTargetLibraryId,
    selectedObjects,
  ]);

  const adjustPrimitiveStrokeWidth = useCallback(
    (delta: number) => {
      if (!screen) {
        return;
      }
      for (const obj of selectedUnlocked) {
        if ("strokeWidth" in obj) {
          const current = (obj as { strokeWidth?: number }).strokeWidth ?? 1;
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

  const handleRefreshRuntimeStatus = useCallback(async () => {
    try {
      await loadRuntimeStatus();
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      appendEditorLog("error", `Runtime status refresh failed: ${errorText || "unknown error"}`);
      void message.error(errorText || "Failed to refresh runtime status");
    }
  }, [appendEditorLog, loadRuntimeStatus]);

  const handleStartRuntime = useCallback(async () => {
    try {
      await startRuntime();
      await loadRuntimeStatus();
      appendEditorLog("success", "Runtime started");
      void message.success("Runtime started");
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      appendEditorLog("error", `Runtime start failed: ${errorText || "unknown error"}`);
      void message.error(errorText || "Failed to start runtime");
    }
  }, [appendEditorLog, loadRuntimeStatus, startRuntime]);

  const handleStopRuntime = useCallback(async () => {
    try {
      await stopRuntime();
      await loadRuntimeStatus();
      appendEditorLog("success", "Runtime stopped");
      void message.success("Runtime stopped");
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      appendEditorLog("error", `Runtime stop failed: ${errorText || "unknown error"}`);
      void message.error(errorText || "Failed to stop runtime");
    }
  }, [appendEditorLog, loadRuntimeStatus, stopRuntime]);

  const deleteActiveObject = useCallback(() => {
    if (!screen) {
      return;
    }
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
  }, [closeWindow, removeObjectWithHistory, screen]);

  const canDelete = selectedUnlocked.length > 0;
  const canGroup = selectedObjects.length >= 2 || selectedGroups.length > 0;
  const canUngroup = selectedGroups.length > 0;
  const canLock = selectedObjects.some((obj) => !obj.locked);
  const canUnlock = selectedObjects.some((obj) => obj.locked);
  const canAlign = selectedUnlocked.length >= 2;
  const canSameSize = selectedUnlocked.length >= 2;
  const canDistribute = selectedUnlocked.length >= 2;

  const { windowDefinitions, openDefinedWindow } = useEditorWindowDefinitions({
    project,
    screen,
    assets,
    libraries,
    drivers,
    runtime,
    selectedObjects,
    selectedBounds,
    activeObject,
    selection,
    filteredScreens,
    screenSearch,
    setScreenSearch,
    screenKindFilter,
    setScreenKindFilter,
    screenViewMode,
    setScreenViewMode,
    newScreenKind,
    setNewScreenKind,
    addScreen,
    setCurrentScreen,
    duplicateScreenLocal,
    setStartScreen,
    requestDeleteScreen,
    searchQuery,
    setSearchQuery,
    updateProjectJson,
    handleSaveProject,
    isSavingProject,
    canUsersView,
    canUsersWrite,
    canUsersDelete,
    canUsersChangePassword,
    updateScreen,
    startScreenName,
    startRuntime: handleStartRuntime,
    stopRuntime: handleStopRuntime,
    refreshRuntimeStatus: handleRefreshRuntimeStatus,
    navigateToRuntime: () => navigate("/runtime"),
    setSelectedObjects,
    deleteSelectionWithHistory,
    runCommand,
    canDelete,
    canLock,
    canUnlock,
    saveTargetLibraryId,
    setSaveTargetLibraryId,
    saveElementName,
    setSaveElementName,
    saveElementCategory,
    setSaveElementCategory,
    saveElementDescription,
    setSaveElementDescription,
    onSaveSelectionAsLibraryElement,
    newLibraryId,
    setNewLibraryId,
    newLibraryName,
    setNewLibraryName,
    createLibrary,
    attachLibrary,
    addLibraryElementInstance,
    loadLibraries,
    onUploadProjectAsset,
    addAssetAsImage,
    moveAssetToFolder,
    bulkMoveAssetsToFolder,
    renameAsset,
    refreshAssets,
    handleDeleteAsset,
    viewAsset,
    setViewAssetId,
    saveObjectProperties,
    patchActiveObject,
    deleteActiveObject,
    onBringToFront: () => zOrderWithHistory("bringToFront"),
    onSendToBack: () => zOrderWithHistory("sendToBack"),
    onMoveForward: () => zOrderWithHistory("moveForward"),
    onMoveBackward: () => zOrderWithHistory("moveBackward"),
    openWindow,
    closeWindow,
  });

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

  useEffect(() => {
    void loadRuntimeStatus();
  }, [loadRuntimeStatus]);

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
      if (event.key === "Escape") {
        setContextMenu({ visible: false, x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copySelectionToClipboard, deleteSelectionWithHistory, handleSaveProject, pasteFromClipboard, redo, screen, undo]);

  if (!project || !screen) {
    return (
      <div className="screen-editor-workbench-page" style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <Typography.Text>
          {project ? "No screens available. Create a screen first." : "Project is not loaded"}
        </Typography.Text>
      </div>
    );
  }

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
            onOpenObjectProperties={() => openDefinedWindow("objectProperties")}
            onOpenLayers={() => openDefinedWindow("layers")}
            onOpenSaveSelection={() => openDefinedWindow("saveSelectionAsElement")}
            onOpenScreenSettings={() => openDefinedWindow("screenSettings")}
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
            hasSelection={selectedObjects.length > 0}
            onBringToFront={() => zOrderWithHistory("bringToFront")}
            onSendToBack={() => zOrderWithHistory("sendToBack")}
            onMoveForward={() => zOrderWithHistory("moveForward")}
            onMoveBackward={() => zOrderWithHistory("moveBackward")}
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
              <Input value={cloneOptions.tagPrefix} placeholder="tagPrefix" onChange={(event) => setCloneOptions((prev) => ({ ...prev, tagPrefix: event.target.value }))} />
              <Input value={cloneOptions.tagReplaceFrom} placeholder="replace from" onChange={(event) => setCloneOptions((prev) => ({ ...prev, tagReplaceFrom: event.target.value }))} />
              <Input value={cloneOptions.tagReplaceTo} placeholder="replace to" onChange={(event) => setCloneOptions((prev) => ({ ...prev, tagReplaceTo: event.target.value }))} />
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

      {contextMenu.visible ? (
        <div
          className="screen-editor-context-menu-backdrop"
          style={{ position: "fixed", inset: 0, zIndex: 1999 }}
          onClick={() => setContextMenu({ visible: false, x: 0, y: 0 })}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu({ visible: false, x: 0, y: 0 }); }}
        >
          <div
            className="screen-editor-context-menu"
            style={{
              position: "fixed",
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 2000,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="screen-editor-context-menu__row">
              <button type="button" className="screen-editor-context-menu__icon-button" disabled={!activeObject} onClick={() => { openDefinedWindow("objectProperties"); setContextMenu({ visible: false, x: 0, y: 0 }); }} title="Properties">
                <SettingOutlined />
              </button>
              <button type="button" className="screen-editor-context-menu__icon-button" onClick={() => { openDefinedWindow("layers"); setContextMenu({ visible: false, x: 0, y: 0 }); }} title="Layers">
                <UnorderedListOutlined />
            </button>
            <button type="button" className="screen-editor-context-menu__icon-button" disabled={!canCopy} onClick={() => { copySelectionToClipboard(); setContextMenu({ visible: false, x: 0, y: 0 }); }} title="Copy">
              <CopyOutlined />
            </button>
            <button type="button" className="screen-editor-context-menu__icon-button" disabled={!canPaste} onClick={() => { pasteFromClipboard(); setContextMenu({ visible: false, x: 0, y: 0 }); }} title="Paste">
              <SnippetsOutlined />
            </button>
            <button type="button" className="screen-editor-context-menu__icon-button" disabled={!canDelete} onClick={() => { deleteSelectionWithHistory(); setContextMenu({ visible: false, x: 0, y: 0 }); }} title="Delete">
              <DeleteOutlined />
            </button>
          </div>
          <div className="screen-editor-context-menu__separator" />
          <button type="button" className="screen-editor-context-menu__item" disabled={!selectedUnlocked.length} onClick={() => { setCloneOpen(true); setContextMenu({ visible: false, x: 0, y: 0 }); }}>
            Clone...
          </button>
          <button type="button" className="screen-editor-context-menu__item" disabled={!canGroup} onClick={() => { runCommand({ type: "groupSelected" }); setContextMenu({ visible: false, x: 0, y: 0 }); }}>
            Group
          </button>
          <button type="button" className="screen-editor-context-menu__item" disabled={!canUngroup} onClick={() => { runCommand({ type: "ungroupSelected" }); setContextMenu({ visible: false, x: 0, y: 0 }); }}>
            Ungroup
          </button>
          <div className="screen-editor-context-menu__separator" />
          <button type="button" className="screen-editor-context-menu__item" disabled={!canLock} onClick={() => { runCommand({ type: "lockSelected" }); setContextMenu({ visible: false, x: 0, y: 0 }); }}>
            Lock
          </button>
          <button type="button" className="screen-editor-context-menu__item" disabled={!canUnlock} onClick={() => { runCommand({ type: "unlockSelected" }); setContextMenu({ visible: false, x: 0, y: 0 }); }}>
            Unlock
          </button>
        </div>
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




