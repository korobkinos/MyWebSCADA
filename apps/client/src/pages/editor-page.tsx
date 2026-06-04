import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import type {
  Asset,
  EditorCommand,
  HmiScreen,
  HmiObject,
  ElementLibrary,
  LibraryElement,
  RuntimeAction,
  RenderContext,
  ScadaProject,
} from "@web-scada/shared";
import { findObjectDeep, isBindingReference, resolveLibraryElementInstanceBindingsDetailed } from "@web-scada/shared";
import { Button, Form, Input, InputNumber, Modal, Select, Space, Typography, message } from "antd";
import {
  ApiOutlined,
  AppstoreOutlined,
  BellOutlined,
  CodeOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  ImportOutlined,
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
import { appToast } from "../ui";
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
import { NumericInputDialog, type NumericInputDialogState } from "../hmi/runtime/numeric-input-dialog";
import type { NumericInputOpenPayload } from "../hmi/runtime/hmi-renderer";

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
type CanvasPoint = { x: number; y: number };

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

function isMergeShapeCandidate(object: HmiObject): boolean {
  if (object.type === "compoundShape") {
    return (object.parts?.length ?? 0) > 0;
  }
  return object.type === "rectangle" || (object.type === "line" && (object.closed ?? false));
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
  const macros = useScadaStore((s) => s.macros);
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
  const updateObjectDeep = useScadaStore((s) => s.updateObjectDeep);
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
  const writeTag = useScadaStore((s) => s.writeTag);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const setTagValues = useScadaStore((s) => s.setTagValues);
  const hasPermission = useScadaStore((s) => s.hasPermission);

  const canUsersView = hasPermission("users.view");
  const canUsersWrite = hasPermission("users.write");
  const canUsersDelete = hasPermission("users.delete");
  const canUsersChangePassword = hasPermission("users.changePassword");
  const canMacrosView = hasPermission("macros.view");
  const enabledLibraryIds = useMemo(
    () => new Set((project?.libraries ?? []).filter((item) => item.enabled).map((item) => item.libraryId)),
    [project?.libraries],
  );
  const activeLibraries = useMemo(
    () => libraries.filter((library) => enabledLibraryIds.has(library.id)),
    [enabledLibraryIds, libraries],
  );

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
  const [previewNumericDialogState, setPreviewNumericDialogState] = useState<NumericInputDialogState | null>(null);
  const previewNumericDialogWindowId = "editorPreviewNumericInputDialog";

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
  const viewportCenterRef = useRef<CanvasPoint>({ x: 100, y: 100 });

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
  const selectedMacroIds = useMemo(
    () => collectMacroReferenceIds(selectedObjects),
    [selectedObjects],
  );
  const saveSelectionMacroWarningText = useMemo(
    () => (selectedMacroIds.length > 0
      ? `Selected objects reference project macros: ${selectedMacroIds.join(", ")}. Macros are not included in the library.`
      : ""),
    [selectedMacroIds],
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
    updateObjectDeepWithHistory,
    removeObjectWithHistory,
    addObjectWithHistory,
    moveObjectWithHistory,
    moveObjectLive,
    commitLiveMoveWithHistory,
    resizeObjectWithHistory,
    deleteSelectionWithHistory,
    zOrderWithHistory,
  } = useEditorObjectHistory({
    screen,
    selection,
    selectedUnlocked,
    updateObject,
    updateObjectDeep,
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
    libraries: activeLibraries,
    tags,
    setTagValues,
  });

  const handlePreviewRequestNumericInput = useCallback((payload: NumericInputOpenPayload) => {
    const dialogWidth = Number.isFinite(payload.dialogWidth) ? Math.max(220, Math.round(payload.dialogWidth!)) : 300;
    const dialogHeight = Number.isFinite(payload.dialogHeight) ? Math.max(120, Math.round(payload.dialogHeight!)) : 150;
    const placement = payload.dialogPlacement ?? "custom";
    const fallbackX = Number.isFinite(payload.dialogX) ? Math.round(payload.dialogX!) : 200;
    const fallbackY = Number.isFinite(payload.dialogY) ? Math.round(payload.dialogY!) : 150;
    let dialogX = fallbackX;
    let dialogY = fallbackY;

    if (placement !== "custom" && payload.sourceClientRect) {
      const margin = Number.isFinite(payload.dialogOffset) ? Math.max(0, Math.round(payload.dialogOffset!)) : 12;
      const { left, top, width, height } = payload.sourceClientRect;
      const centerX = left + width / 2;
      const centerY = top + height / 2;
      if (placement === "top") {
        dialogX = Math.round(centerX - dialogWidth / 2);
        dialogY = Math.round(top - dialogHeight - margin);
      } else if (placement === "bottom") {
        dialogX = Math.round(centerX - dialogWidth / 2);
        dialogY = Math.round(top + height + margin);
      } else if (placement === "left") {
        dialogX = Math.round(left - dialogWidth - margin);
        dialogY = Math.round(centerY - dialogHeight / 2);
      } else if (placement === "right") {
        dialogX = Math.round(left + width + margin);
        dialogY = Math.round(centerY - dialogHeight / 2);
      }
    }

    const minOffset = 8;
    const maxX = Math.max(minOffset, window.innerWidth - dialogWidth - minOffset);
    const maxY = Math.max(minOffset, window.innerHeight - dialogHeight - minOffset);
    dialogX = Math.min(maxX, Math.max(minOffset, dialogX));
    dialogY = Math.min(maxY, Math.max(minOffset, dialogY));

    const actionContext: RenderContext = payload.actionContext ?? {
      screenId: screen?.id,
      parameters: {
        __runtimeObjectId: payload.objectId,
        __runtimeObjectName: payload.objectName,
      },
    };

    setPreviewNumericDialogState({
      objectId: payload.objectId,
      objectName: payload.objectName,
      targetTag: payload.writeTag ?? "",
      currentValue: payload.currentValue,
      min: payload.min,
      max: payload.max,
      step: payload.step,
      decimals: payload.decimals,
      formatMode: payload.formatMode,
      formatPattern: payload.formatPattern,
      unit: payload.unit,
      requiredActionRole: payload.requiredActionRole,
      backgroundColor: payload.backgroundColor,
      textColor: payload.textColor,
      borderColor: payload.borderColor,
      fontFamily: payload.fontFamily,
      fontSize: payload.fontSize,
      dialogBackgroundColor: payload.dialogBackgroundColor,
      dialogTextColor: payload.dialogTextColor,
      dialogBorderColor: payload.dialogBorderColor,
      dialogCloseButtonTextColor: payload.dialogCloseButtonTextColor,
      dialogCloseButtonBackgroundColor: payload.dialogCloseButtonBackgroundColor,
      dialogSetButtonTextColor: payload.dialogSetButtonTextColor,
      dialogSetButtonBackgroundColor: payload.dialogSetButtonBackgroundColor,
      dialogSetButtonBorderColor: payload.dialogSetButtonBorderColor,
      showMeta: payload.showMeta,
      stepButtonUseTextColor: payload.stepButtonUseTextColor,
      stepButtonTextColor: payload.stepButtonTextColor,
      stepButtonBackgroundColor: payload.stepButtonBackgroundColor,
      badTextColor: payload.badTextColor,
      badBackgroundColor: payload.badBackgroundColor,
      badBorderColor: payload.badBorderColor,
      signalBad: payload.signalBad,
      actionContext,
    });

    openWindow({
      id: previewNumericDialogWindowId,
      title: payload.dialogTitle?.trim() || payload.objectName || "Numeric Input",
      defaultRect: { x: dialogX, y: dialogY, width: dialogWidth, height: dialogHeight },
      minWidth: dialogWidth,
      minHeight: dialogHeight,
      resizable: false,
      resetRectOnOpen: true,
      render: () => null,
    });
  }, [openWindow, screen?.id]);

  const runCommand = useCallback(
    (command: EditorCommand) => {
      if (!screen) {
        return;
      }
      const labelByType: Record<EditorCommand["type"], string> = {
        groupSelected: "Group objects",
        ungroupSelected: "Ungroup objects",
        mergeSelectedLinesToPolyline: "Merge lines",
        mergeSelectedShapes: "Merge shapes",
        lockSelected: "Lock objects",
        unlockSelected: "Unlock objects",
        alignLeft: "Align left",
        alignRight: "Align right",
        alignTop: "Align top",
        alignBottom: "Align bottom",
        alignHorizontalCenter: "Align horizontal center",
        alignVerticalCenter: "Align vertical center",
        makeSameWidth: "Make same width",
        makeSameHeight: "Make same height",
        makeSameSize: "Make same size",
        distributeHorizontally: "Distribute horizontally",
        distributeVertically: "Distribute vertically",
        spaceEvenlyHorizontally: "Space evenly horizontally",
        spaceEvenlyVertically: "Space evenly vertically",
      };
      runWithHistory(labelByType[command.type] ?? "Editor command", () => {
        const warnings = executeCommand(command);
        if (warnings.length > 0) {
          void message.warning(warnings.join(" | "));
        }
      });
    },
    [executeCommand, runWithHistory, screen],
  );

  const addPrimitiveShape = (kind: PrimitiveShapeKind, center?: { x: number; y: number }) => {
    const shape = createPrimitiveShape(kind);
    if (center) {
      shape.x = Math.round(center.x - shape.width / 2);
      shape.y = Math.round(center.y - shape.height / 2);
    }
    addObjectWithHistory(shape);
  };

  const addLibraryElementInstance = useCallback(
    (libraryId: string, elementOrId: LibraryElement | string, position?: CanvasPoint) => {
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
      if (position) {
        instance.x = Math.max(0, Math.round(position.x));
        instance.y = Math.max(0, Math.round(position.y));
      } else {
        const center = viewportCenterRef.current;
        instance.x = Math.max(0, Math.round(center.x - instance.width / 2));
        instance.y = Math.max(0, Math.round(center.y - instance.height / 2));
      }
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

  const patchObjectById = useCallback(
    (objectId: string, patch: Partial<HmiObject>) => {
      if (!screen) {
        return;
      }
      const state = useScadaStore.getState();
      const currentScreen = state.project?.screens.find((item) => item.id === screen.id);
      const currentObject = currentScreen ? findObjectDeep(currentScreen.objects, objectId) : null;
      if (!currentObject) {
        return;
      }
      updateObjectDeepWithHistory(objectId, patch, `Patch object ${currentObject.name?.trim() || currentObject.id}`);
    },
    [screen, updateObjectDeepWithHistory],
  );

  const handleSaveProject = useCallback(async () => {
    setIsSavingProject(true);
    try {
      await saveProject();
      const latestProject = useScadaStore.getState().project;
      setSaveStatusText("Saved");
      setSavedProjectSignature(buildProjectSaveSignature(latestProject));
      appendEditorLog("success", "action=save-project status=OK");
      appToast.success("Saved");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setSaveStatusText("Save failed");
      appendEditorLog("error", `action=save-project status=ERROR error=${errorMessage || "unknown error"}`);
      appToast.error("Save failed", errorMessage ? { details: errorMessage } : undefined);
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
          addLibraryElementInstance(payload.libraryId, payload.elementId, position);
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

  const detachLibrary = useCallback(
    async (libraryId: string) => {
      try {
        const next = await api.detachLibrary(libraryId);
        updateProjectJson(next);
        void message.success("Library detached");
      } catch (error) {
        void message.error(error instanceof Error ? error.message : "Failed to detach library");
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
    const hasBrokenLibraryInstance = selectedObjects.some(
      (item) => item.type === "libraryElementInstance" && !libraries.some((lib) => lib.id === item.libraryId),
    );
    if (hasBrokenLibraryInstance) {
      void message.warning("Selection contains library element instances with missing source library");
      return;
    }
    if (selectedMacroIds.length > 0) {
      void message.warning(saveSelectionMacroWarningText);
    }
    const normalizedObjects = normalizeObjects(selectedObjects);
    const templateObjects = sanitizeObjectsForLibraryTemplate(normalizedObjects);
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
      objects: templateObjects,
      bindings: [],
      parameters: [],
      stateRules: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      const copiedObjects = await copySelectionAssetsToLibrary(element.objects, assets, saveTargetLibraryId, libraries);
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
    libraries,
    saveSelectionMacroWarningText,
    saveElementCategory,
    saveElementDescription,
    saveElementName,
    saveTargetLibraryId,
    selectedMacroIds.length,
    selectedObjects,
  ]);

  const prepareLibraryElementUpdate = useCallback(
    async (libraryId: string, element: LibraryElement) => {
      const state = useScadaStore.getState();
      const currentScreen = state.project?.screens.find((item) => item.id === screen?.id);
      const selectedFromState = state.selection.selectedObjectIds
        .map((objectId) => (currentScreen ? findObjectDeep(currentScreen.objects, objectId) : null))
        .filter((item): item is HmiObject => Boolean(item));
      const selectedForUpdate = selectedFromState.length > 0 ? selectedFromState : selectedObjects;

      if (!selectedForUpdate.length) {
        appendEditorLog("error", `action=update-library-element libraryId=${libraryId} elementId=${element.id} selectedCount=0 status=ERROR error=no-selection`);
        void message.warning("Select one or more objects on canvas");
        return null;
      }

      const library = libraries.find((item) => item.id === libraryId);
      const sourceElement = library?.elements.find((item) => item.id === element.id);
      if (!library || !sourceElement) {
        appendEditorLog("error", `action=update-library-element libraryId=${libraryId} elementId=${element.id} selectedCount=${selectedForUpdate.length} status=ERROR error=element-not-found`);
        void message.error("Selected element is missing from the selected library.");
        return null;
      }

      if (hasLibraryInstanceReference(selectedForUpdate, libraryId, element.id)) {
        appendEditorLog("error", `action=update-library-element libraryId=${libraryId} elementId=${element.id} selectedCount=${selectedForUpdate.length} status=ERROR error=self-reference`);
        void message.error("Selection contains this same library element instance. Remove it to avoid recursion.");
        return null;
      }

      const macroIds = collectMacroReferenceIds(selectedForUpdate);
      const usageCount = countLibraryElementInstancesInProject(state.project, libraryId, element.id);

      const confirmationLines = [
        `Update library element "${element.name}"?`,
        `Selected objects: ${selectedForUpdate.length}`,
        `Linked instances in project: ${usageCount}`,
        "Updating this element will affect all linked instances on screens.",
      ];
      if (macroIds.length > 0) {
        confirmationLines.push(
          `Selected objects reference project macros: ${macroIds.join(", ")}. Macros are not included in the library.`,
        );
      }

      return {
        libraryId,
        elementId: element.id,
        elementName: element.name,
        confirmationLines,
        flattenedCount: 0,
        flattenedObjects: selectedForUpdate,
        macroIds,
      };
    },
    [appendEditorLog, libraries, screen?.id, selectedObjects],
  );

  const executeLibraryElementUpdate = useCallback(
    async (payload: {
      libraryId: string;
      elementId: string;
      elementName: string;
      flattenedObjects: HmiObject[];
      macroIds: string[];
    }) => {
      try {
        const normalizedObjects = normalizeObjects(payload.flattenedObjects);
        const templateObjects = sanitizeObjectsForLibraryTemplate(normalizedObjects);
        const bounds = computeBounds(payload.flattenedObjects);
        const copiedObjects = await copySelectionAssetsToLibrary(templateObjects, assets, payload.libraryId, libraries);
        await api.updateLibraryElement(payload.libraryId, payload.elementId, {
          width: bounds.width,
          height: bounds.height,
          objects: copiedObjects,
        });
        await loadLibraries();
        appendEditorLog("success", `action=update-library-element libraryId=${payload.libraryId} elementId=${payload.elementId} selectedCount=${payload.flattenedObjects.length} status=OK`);
        if (payload.macroIds.length > 0) {
          void message.warning(
            `Selected objects reference project macros: ${payload.macroIds.join(", ")}. Macros are not included in the library.`,
          );
        }
        void message.success(`Library element updated: ${payload.elementName}`);
      } catch (error) {
        const errorText = error instanceof Error ? error.message : "Failed to update library element";
        appendEditorLog("error", `action=update-library-element libraryId=${payload.libraryId} elementId=${payload.elementId} selectedCount=${payload.flattenedObjects.length} status=ERROR error=${errorText}`);
        void message.error(errorText);
      }
    },
    [appendEditorLog, assets, libraries, loadLibraries],
  );


  const saveLibraryElementCopyFromSelection = useCallback(
    async (libraryId: string, element: LibraryElement, copyName: string) => {
      if (!selectedObjects.length) {
        void message.warning("Select one or more objects on canvas");
        return;
      }

      const macroIds = collectMacroReferenceIds(selectedObjects);
      if (macroIds.length > 0) {
        void message.warning(
          `Selected objects reference project macros: ${macroIds.join(", ")}. Macros are not included in the library.`,
        );
      }

      const enteredName = copyName.trim();
      if (!enteredName) {
        void message.warning("Element name is required");
        return;
      }

      const normalizedObjects = normalizeObjects(selectedObjects);
      const templateObjects = sanitizeObjectsForLibraryTemplate(normalizedObjects);
      const bounds = computeBounds(selectedObjects);
      const now = new Date().toISOString();
      try {
        const copiedObjects = await copySelectionAssetsToLibrary(templateObjects, assets, libraryId, libraries);
        const copyElement: LibraryElement = {
          ...element,
          id: id("element"),
          libraryId,
          elementKey: slugify(enteredName),
          name: enteredName,
          width: bounds.width,
          height: bounds.height,
          objects: copiedObjects,
          createdAt: now,
          updatedAt: now,
        };
        await api.createLibraryElement(libraryId, copyElement);
        await loadLibraries();
        if (macroIds.length > 0) {
          void message.warning(
            `Selected objects reference project macros: ${macroIds.join(", ")}. Macros are not included in the library.`,
          );
        }
        void message.success(`Library element copy saved: ${enteredName}`);
      } catch (error) {
        void message.error(error instanceof Error ? error.message : "Failed to save library element copy");
      }
    },
    [assets, libraries, loadLibraries, selectedObjects],
  );

  const adjustPrimitiveStrokeWidth = useCallback(
    (delta: number) => {
      if (!screen) {
        return;
      }
      const roundToTenths = (value: number) => Math.round(value * 10) / 10;
      for (const obj of selectedUnlocked) {
        if ("strokeWidth" in obj) {
          const current = (obj as { strokeWidth?: number }).strokeWidth ?? 1;
          updateObjectWithHistory(obj.id, { strokeWidth: roundToTenths(Math.max(0.5, current + delta)) }, "Adjust stroke width");
        }
      }
    },
    [screen, selectedUnlocked, updateObjectWithHistory],
  );

  const rotateSelectedBy = useCallback(
    (deltaDeg: number) => {
      if (!screen || !selectedUnlocked.length) {
        return;
      }
      const selectedIds = new Set(selectedUnlocked.map((item) => item.id));
      const normalizeRotation = (value: number): number => {
        const rounded = Math.round(value);
        return ((rounded % 360) + 360) % 360;
      };
      runWithHistory(deltaDeg > 0 ? "Rotate objects +90°" : "Rotate objects -90°", () => {
        const nextObjects = screen.objects.map((item) => {
          if (!selectedIds.has(item.id) || item.locked) {
            return item;
          }
          const current = Number(item.rotation ?? 0);
          const base = Number.isFinite(current) ? current : 0;
          return {
            ...item,
            rotation: normalizeRotation(base + deltaDeg),
          };
        });
        setScreenObjects(screen.id, nextObjects);
      });
    },
    [runWithHistory, screen, selectedUnlocked, setScreenObjects],
  );

  const nudgeSelectedBy = useCallback((dx: number, dy: number) => {
    if (!screen || !selectedUnlocked.length || (dx === 0 && dy === 0)) {
      return;
    }
    const selectedIds = new Set(selectedUnlocked.map((item) => item.id));
    runWithHistory("Nudge objects", () => {
      const nextObjects = screen.objects.map((item) => {
        if (!selectedIds.has(item.id) || item.locked) {
          return item;
        }
        return {
          ...item,
          x: item.x + dx,
          y: item.y + dy,
        };
      });
      setScreenObjects(screen.id, nextObjects);
    });
  }, [runWithHistory, screen, selectedUnlocked, setScreenObjects]);

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
      appToast.success("Saved");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setSaveStatusText("Save failed");
      appendEditorLog(
        "error",
        `action=save-object status=ERROR object=${objectName} id=${object.id} error=${errorMessage || "unknown error"}`,
      );
      appToast.error("Save failed", errorMessage ? { details: errorMessage } : undefined);
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
  const canMergeLines = selectedUnlocked.filter((obj) => obj.type === "line").length >= 2;
  const canMergeShapes =
    selectedObjects.length >= 2
    && selectedUnlocked.length === selectedObjects.length
    && selectedObjects.every(isMergeShapeCandidate);

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
    canMacrosView,
    updateScreen,
    startScreenName,
    startRuntime: handleStartRuntime,
    stopRuntime: handleStopRuntime,
    refreshRuntimeStatus: handleRefreshRuntimeStatus,
    navigateToRuntime: () => {
      if (project?.startScreenId) {
        setCurrentScreen(project.startScreenId);
      }
      navigate("/runtime");
    },
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
    saveSelectionMacroWarningText,
    onSaveSelectionAsLibraryElement,
    newLibraryId,
    setNewLibraryId,
    newLibraryName,
    setNewLibraryName,
    createLibrary,
    attachLibrary,
    detachLibrary,
    addLibraryElementInstance,
    prepareLibraryElementUpdate,
    executeLibraryElementUpdate,
    saveLibraryElementCopyFromSelection,
    loadLibraries,
    projectMacros: macros,
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
    patchObjectById,
    deleteActiveObject,
    onBringToFront: () => zOrderWithHistory("bringToFront"),
    onSendToBack: () => zOrderWithHistory("sendToBack"),
    onMoveForward: () => zOrderWithHistory("moveForward"),
    onMoveBackward: () => zOrderWithHistory("moveBackward"),
    openWindow,
    closeWindow,
  });

  const allWindowDefinitions = useMemo(() => {
    return [
      ...windowDefinitions,
      {
        id: previewNumericDialogWindowId,
        title: "Numeric Input",
        defaultRect: { x: 200, y: 150, width: 270, height: 150 },
        minWidth: 240,
        minHeight: 135,
        resizable: false,
        render: () => {
          if (!previewNumericDialogState) {
            return null;
          }
          return (
            <NumericInputDialog
              state={previewNumericDialogState}
              onCommit={async (value) => {
                if (!previewNumericDialogState.targetTag.trim()) {
                  return;
                }
                await writeTag(previewNumericDialogState.targetTag, value);
                setPreviewNumericDialogState((prev) => (prev ? { ...prev, currentValue: value } : prev));
              }}
              onCancel={() => {
                closeWindow(previewNumericDialogWindowId);
                setPreviewNumericDialogState(null);
              }}
            />
          );
        },
      },
    ];
  }, [closeWindow, previewNumericDialogState, previewNumericDialogWindowId, windowDefinitions, writeTag]);

  const activityItems = [
    { id: "screens", title: "Screens", icon: <AppstoreOutlined />, active: isWindowOpen("screens"), onClick: () => openDefinedWindow("screens") },
    { id: "search", title: "Search", icon: <SearchOutlined />, active: isWindowOpen("search"), onClick: () => openDefinedWindow("search") },
    { id: "tags", title: "Tags", icon: <TagsOutlined />, active: isWindowOpen("tags"), onClick: () => openDefinedWindow("tags") },
    { id: "events", title: "Event Manager", icon: <BellOutlined />, active: isWindowOpen("events"), onClick: () => openDefinedWindow("events") },
    { id: "archive", title: "Archive", icon: <DatabaseOutlined />, active: isWindowOpen("archive"), onClick: () => openDefinedWindow("archive") },
    canMacrosView
      ? { id: "macros", title: "Macros", icon: <CodeOutlined />, active: isWindowOpen("macros"), onClick: () => openDefinedWindow("macros") }
      : null,
    { id: "assets", title: "Assets", icon: <FileImageOutlined />, active: isWindowOpen("assets"), onClick: () => openDefinedWindow("assets") },
    { id: "libraries", title: "Libraries", icon: <FolderOpenOutlined />, active: isWindowOpen("libraries"), onClick: () => openDefinedWindow("libraries") },
    { id: "drivers", title: "Drivers", icon: <ApiOutlined />, active: isWindowOpen("drivers"), onClick: () => openDefinedWindow("drivers") },
    { id: "runtime", title: "Runtime", icon: <PlayCircleOutlined />, active: isWindowOpen("runtime"), onClick: () => openDefinedWindow("runtime") },
    { id: "layers", title: "Layers", icon: <UnorderedListOutlined />, active: isWindowOpen("layers"), onClick: () => openDefinedWindow("layers") },
    { id: "projectManager", title: "Project Manager", icon: <ImportOutlined />, active: isWindowOpen("projectManager"), onClick: () => openDefinedWindow("projectManager") },
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
      if (!editing && !ctrlOrMeta && !event.altKey && !event.shiftKey) {
        const nudgeStep = project?.editorSettings?.keyboardNudgeStepPx ?? 1;
        const step = Number.isFinite(nudgeStep) && nudgeStep > 0 ? nudgeStep : 1;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          nudgeSelectedBy(-step, 0);
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          nudgeSelectedBy(step, 0);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          nudgeSelectedBy(0, -step);
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          nudgeSelectedBy(0, step);
          return;
        }
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
  }, [copySelectionToClipboard, deleteSelectionWithHistory, handleSaveProject, nudgeSelectedBy, pasteFromClipboard, project?.editorSettings?.keyboardNudgeStepPx, redo, screen, undo]);

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
            libraries={activeLibraries}
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
            onLogout={() => {
              window.location.replace("/?logout=1");
            }}
            canSaveSelection={selectedObjects.length > 0}
            setContextMenu={setContextMenu}
            handleDrop={handleDrop}
            moveObjectWithHistory={moveObjectWithHistory}
            moveObjectLive={moveObjectLive}
            commitLiveMoveWithHistory={commitLiveMoveWithHistory}
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
            canMergeLines={canMergeLines}
            canMergeShapes={canMergeShapes}
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
            onRotateSelectedBy={rotateSelectedBy}
            onViewportCenterChange={(center) => {
              viewportCenterRef.current = center;
            }}
            onRequestNumericInput={previewMode ? handlePreviewRequestNumericInput : undefined}
            onResizeScreen={updateScreen}
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
        definitions={allWindowDefinitions}
        onClose={(id) => {
          closeWindow(id);
          if (id === previewNumericDialogWindowId) {
            setPreviewNumericDialogState(null);
          }
        }}
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
          <button
            type="button"
            className="screen-editor-context-menu__item"
            disabled={!selectedObjects.length}
            onClick={() => {
              openDefinedWindow("saveSelectionAsElement");
              setContextMenu({ visible: false, x: 0, y: 0 });
            }}
          >
            Save as Library Element...
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

  const remapAction = (action: RuntimeAction): RuntimeAction => remapActionBinding(action, map);

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
    if (cloned.action) {
      cloned.action = remapAction(cloned.action);
    }
    if (cloned.actions) {
      cloned.actions = cloned.actions.map((step) => ({ ...step, action: remapAction(step.action) }));
    }
  }

  if (cloned.type === "valueSelect" && cloned.target.type === "tag") {
    cloned.target = {
      ...cloned.target,
      tag: map(cloned.target.tag),
    };
  }

  if (cloned.type === "text" && typeof cloned.tag === "string" && cloned.tag.trim()) {
    cloned.tag = map(cloned.tag);
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

function remapActionBinding(action: RuntimeAction, map: (tag: string) => string): RuntimeAction {
  if (action.type === "write" || action.type === "pulse" || action.type === "hold" || action.type === "momentary" || action.type === "toggle") {
    return { ...action, tag: map(action.tag) };
  }
  if ((action.type === "writeConst" || action.type === "writeNumberPrompt") && action.target === "tag") {
    return { ...action, name: map(action.name) };
  }
  return action;
}

async function copySelectionAssetsToLibrary(
  objects: HmiObject[],
  projectAssets: Asset[],
  libraryId: string,
  libraries: ElementLibrary[],
): Promise<HmiObject[]> {
  const assetIds = [...new Set(objects.flatMap((obj) => collectAssetIds(obj)))];
  if (!assetIds.length) {
    return objects;
  }

  const targetLibrary = libraries.find((item) => item.id === libraryId);
  const mappedIds = new Map<string, string>();
  for (const assetId of assetIds) {
    const asset = projectAssets.find((item) => item.id === assetId);
    if (!asset) {
      continue;
    }
    const existingById = targetLibrary?.assets.find((item) => item.id === asset.id);
    if (existingById) {
      mappedIds.set(assetId, existingById.id);
      continue;
    }
    const existingBySignature = targetLibrary?.assets.find(
      (item) => item.fileName === asset.fileName && item.mimeType === asset.mimeType && item.size === asset.size,
    );
    if (existingBySignature) {
      mappedIds.set(assetId, existingBySignature.id);
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
  const ASSET_ID_KEYS = new Set([
    "assetId",
    "previewAssetId",
    "backgroundAssetId",
    "pressedBackgroundAssetId",
    "disabledBackgroundAssetId",
    "defaultAssetId",
    "badQualityAssetId",
  ]);

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => walk(item));
    }
    if (!value || typeof value !== "object") {
      return value;
    }
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, current] of Object.entries(record)) {
      if (ASSET_ID_KEYS.has(key) && typeof current === "string") {
        next[key] = mappedIds.get(current) ?? current;
        continue;
      }
      next[key] = walk(current);
    }
    return next;
  };

  return walk(object) as HmiObject;
}

function collectAssetIds(object: HmiObject): string[] {
  const ASSET_ID_KEYS = new Set([
    "assetId",
    "previewAssetId",
    "backgroundAssetId",
    "pressedBackgroundAssetId",
    "disabledBackgroundAssetId",
    "defaultAssetId",
    "badQualityAssetId",
  ]);
  const collected: string[] = [];

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    const record = value as Record<string, unknown>;
    for (const [key, current] of Object.entries(record)) {
      if (ASSET_ID_KEYS.has(key) && typeof current === "string" && current.trim()) {
        collected.push(current);
      }
      walk(current);
    }
  };

  walk(object);
  return collected;
}

function collectMacroReferenceIds(objects: HmiObject[]): string[] {
  const macroIds = new Set<string>();

  const visit = (object: HmiObject): void => {
    if ("onPressMacroId" in object && typeof object.onPressMacroId === "string" && object.onPressMacroId.trim()) {
      macroIds.add(object.onPressMacroId.trim());
    }
    if ("onReleaseMacroId" in object && typeof object.onReleaseMacroId === "string" && object.onReleaseMacroId.trim()) {
      macroIds.add(object.onReleaseMacroId.trim());
    }
    if ("action" in object && object.action && object.action.type === "runMacro" && object.action.macroId.trim()) {
      macroIds.add(object.action.macroId.trim());
    }
    if (object.type === "button") {
      for (const step of object.actions ?? []) {
        if (step.action.type === "runMacro" && step.action.macroId.trim()) {
          macroIds.add(step.action.macroId.trim());
        }
      }
    }
    if (object.type === "group") {
      for (const child of object.objects) {
        visit(child);
      }
    }
  };

  for (const object of objects) {
    visit(object);
  }

  return [...macroIds];
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
    ...structuredClone(obj),
    id: id(obj.type.replace(/[^a-z0-9]/gi, "_")),
    x: obj.x - bounds.minX,
    y: obj.y - bounds.minY,
  }));
}

function sanitizeObjectsForLibraryTemplate(objects: HmiObject[]): HmiObject[] {
  return objects.map((object) => sanitizeObjectForLibraryTemplate(object));
}

function sanitizeObjectForLibraryTemplate(object: HmiObject): HmiObject {
  const clone = structuredClone(object) as HmiObject;
  clearTagBindingsInObject(clone);
  return clone;
}

function preserveBindingOrClear(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim();
  return isBindingReference(normalized) ? normalized : "";
}

function clearTagBindingsInObject(object: HmiObject): void {
  const record = object as Record<string, unknown>;
  record.tagIndexing = undefined;
  record.tagIndexingByField = undefined;

  if (typeof record.tag === "string") {
    record.tag = preserveBindingOrClear(record.tag);
  }

  for (const key of Object.keys(record)) {
    if (!key.endsWith("Tag")) {
      continue;
    }
    if (typeof record[key] === "string") {
      record[key] = preserveBindingOrClear(record[key]);
    }
  }

  if (object.type === "valueSelect" && object.target.type === "tag") {
    object.target = {
      ...object.target,
      tag: preserveBindingOrClear(object.target.tag),
    };
  }

  if ("action" in object && object.action) {
    const action = object.action as RuntimeAction;
    if (action.type === "write" || action.type === "pulse" || action.type === "toggle") {
      action.tag = preserveBindingOrClear(action.tag);
    }
    if ((action.type === "writeConst" || action.type === "writeNumberPrompt") && action.target === "tag") {
      action.name = preserveBindingOrClear(action.name);
    }
  }
  if (object.type === "button" && object.actions) {
    object.actions = object.actions.map((step) => ({ ...step, action: remapActionBinding(step.action, preserveBindingOrClear) }));
  }

  if (object.type === "group") {
    for (const child of object.objects) {
      clearTagBindingsInObject(child);
    }
  }
}

function slugify(input: string): string {
  const clean = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || `element-${Math.random().toString(36).slice(2, 8)}`;
}

function hasLibraryInstanceReference(objects: HmiObject[], libraryId: string, elementId: string): boolean {
  const scan = (items: HmiObject[]): boolean => items.some((item) => {
    if (item.type === "libraryElementInstance" && item.libraryId === libraryId && item.elementId === elementId) {
      return true;
    }
    if (item.type === "group") {
      return scan(item.objects);
    }
    return false;
  });
  return scan(objects);
}

function countLibraryElementInstancesInProject(
  project: ScadaProject | null | undefined,
  libraryId: string,
  elementId: string,
): number {
  if (!project) {
    return 0;
  }
  let count = 0;
  const scan = (objects: HmiObject[]) => {
    for (const item of objects) {
      if (item.type === "libraryElementInstance" && item.libraryId === libraryId && item.elementId === elementId) {
        count += 1;
      }
      if (item.type === "group") {
        scan(item.objects);
      }
    }
  };
  for (const screen of project.screens) {
    scan(screen.objects);
  }
  return count;
}

export function flattenSelfInstancesInSelection(
  objects: HmiObject[],
  libraryId: string,
  elementId: string,
  libraries: ElementLibrary[],
): { result: HmiObject[]; flattenedCount: number } {
  const result: HmiObject[] = [];
  let flattenedCount = 0;

  for (const obj of objects) {
    if (obj.type === "libraryElementInstance" && obj.libraryId === libraryId && obj.elementId === elementId) {
      const library = libraries.find((lib) => lib.id === libraryId);
      const element = library?.elements.find((el) => el.id === elementId);
      if (element) {
        // Resolve bindings for this specific instance using real tag assignments
        const { resolvedBindings } = resolveLibraryElementInstanceBindingsDetailed(
          element,
          obj as Extract<HmiObject, { type: "libraryElementInstance" }>,
          { tagValues: {} }, // runtime values not needed for static analysis
        );

        // Map internal $binding.* refs to their actual resolved tags in the raw objects
        const resolvedObjects = element.objects.map((childObj) => {
          const deepClone = structuredClone(childObj);
          resolveBindingRefsInObject(deepClone, resolvedBindings);
          // Apply instance offset relative to the original instance bounds
          deepClone.x += obj.x;
          deepClone.y += obj.y;
          return deepClone;
        });

        result.push(...resolvedObjects);
        flattenedCount++;
      }
    } else {
      result.push(obj);
    }
  }

  return { result, flattenedCount };
}

function resolveBindingRefsInObject(object: HmiObject, resolvedBindings: Record<string, string>): void {
  // Common tag properties across multiple object types
  const tagFields = [
    "tag",
    "writeTag",
    "stateTag",
    "openTag",
    "closedTag",
    "errorTag",
    "commandOpenTag",
    "commandCloseTag",
    "runTag",
    "faultTag",
    "commandStartTag",
    "commandStopTag",
    "visibleTag",
    "disabledTag",
  ];

  for (const field of tagFields) {
    if (field in object) {
      const val = (object as Record<string, unknown>)[field];
      if (typeof val === "string" && val.startsWith("$binding.")) {
        const bindingKey = val.slice(9);
        (object as Record<string, unknown>)[field] = resolvedBindings[bindingKey] || "";
      }
    }
  }

  if (object.type === "valueSelect" && object.target?.type === "tag" && object.target.tag.startsWith("$binding.")) {
    const bindingKey = object.target.tag.slice(9);
    object.target.tag = resolvedBindings[bindingKey] || "";
  }

  if ("action" in object && object.action) {
    const action = object.action as RuntimeAction;
    if (
      (action.type === "write" || action.type === "pulse" || action.type === "toggle") &&
      action.tag.startsWith("$binding.")
    ) {
      const bindingKey = action.tag.slice(9);
      action.tag = resolvedBindings[bindingKey] || "";
    }
    if (
      (action.type === "writeConst" || action.type === "writeNumberPrompt") &&
      action.target === "tag" &&
      action.name.startsWith("$binding.")
    ) {
      const bindingKey = action.name.slice(9);
      action.name = resolvedBindings[bindingKey] || "";
    }
  }
  if (object.type === "button" && object.actions) {
    object.actions = object.actions.map((step) => ({ ...step, action: remapActionBinding(step.action, (tag) => {
      if (!tag.startsWith("$binding.")) {
        return tag;
      }
      return resolvedBindings[tag.slice(9)] || "";
    }) }));
  }

  if (object.type === "group") {
    for (const child of object.objects) {
      resolveBindingRefsInObject(child, resolvedBindings);
    }
  }
}

