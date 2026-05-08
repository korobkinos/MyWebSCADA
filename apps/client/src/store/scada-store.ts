import { create } from "zustand";
import type {
  Asset,
  DriverStatus,
  EditorCommand,
  EditorSelectionState,
  ElementLibrary,
  GroupObject,
  HmiObject,
  HmiScreen,
  InternalVariableDefinition,
  MacroDefinition,
  RuntimeState,
  ScadaProject,
  ScreenKind,
  TagDataType,
  TagSnapshot,
  TagValue,
} from "@web-scada/shared";
import { executeEditorCommand } from "@web-scada/shared";
import { api } from "../services/api";

type TagMap = Record<string, TagValue>;

type ScadaState = {
  project: ScadaProject | null;
  assets: Asset[];
  libraries: ElementLibrary[];
  tags: TagMap;
  tagSnapshots: TagSnapshot[];
  drivers: DriverStatus[];
  macros: MacroDefinition[];
  runtime: RuntimeState;
  currentScreenId: string | null;
  selection: EditorSelectionState;
  engineerAuthorized: boolean;
  loadProject: () => Promise<void>;
  saveProject: () => Promise<void>;
  loadTags: () => Promise<void>;
  loadDrivers: () => Promise<void>;
  loadMacros: () => Promise<void>;
  loadAssets: () => Promise<void>;
  loadLibraries: () => Promise<void>;
  startRuntime: () => Promise<void>;
  stopRuntime: () => Promise<void>;
  writeTag: (name: string, value: boolean | number | string | null) => Promise<void>;
  writeVariable: (name: string, value: boolean | number | string | null) => Promise<void>;
  runMacro: (
    macroId: string,
    args?: Record<string, unknown>,
    options?: { allowDisabledForTest?: boolean },
  ) => Promise<{ ok: boolean; status?: "ok" | "skipped"; reason?: "disabled" }>;
  updateMacro: (macroId: string, payload: {
    name: string;
    description?: string;
    enabled: boolean;
    language: "ts" | "javascript-lite" | "expression" | "blockly";
    code: string;
    triggers?: unknown[];
  }) => Promise<MacroDefinition>;
  loginEngineer: (password: string) => Promise<boolean>;
  logoutEngineer: () => void;
  setTagValue: (value: TagValue) => void;
  setCurrentScreen: (screenId: string) => void;
  setSelectedObjects: (objectIds: string[], activeObjectId?: string) => void;
  toggleSelectedObject: (objectId: string) => void;
  clearSelection: () => void;
  setSelectionRect: (rect?: EditorSelectionState["selectionRect"]) => void;
  executeCommand: (command: EditorCommand) => string[];
  moveObject: (screenId: string, objectId: string, x: number, y: number) => void;
  resizeObject: (screenId: string, objectId: string, patch: Partial<HmiObject>) => void;
  updateObject: (screenId: string, objectId: string, patch: Partial<HmiObject>) => void;
  addScreen: (kind?: ScreenKind) => void;
  updateScreen: (screenId: string, patch: Partial<HmiScreen>) => void;
  setScreenObjects: (screenId: string, objects: HmiObject[]) => void;
  addObject: (screenId: string, object: HmiObject) => void;
  removeObject: (screenId: string, objectId: string) => void;
  removeSelectedUnlocked: (screenId: string) => void;
  addVariable: (name: string, dataType: InternalVariableDefinition["dataType"], initialValue?: boolean | number | string | null) => void;
  updateProjectJson: (next: ScadaProject) => void;
};

function toTagMap(items: TagSnapshot[]): TagMap {
  return items.reduce<TagMap>((acc, item) => {
    acc[item.definition.name] = item.value;
    return acc;
  }, {});
}

function mutateScreen(project: ScadaProject, screenId: string, updater: (screen: HmiScreen) => HmiScreen): ScadaProject {
  return {
    ...project,
    screens: project.screens.map((screen) => (screen.id === screenId ? updater(screen) : screen)),
  };
}

function mutateObject(
  project: ScadaProject,
  screenId: string,
  objectId: string,
  updater: (obj: HmiObject) => HmiObject,
): ScadaProject {
  return mutateScreen(project, screenId, (screen) => ({
    ...screen,
    objects: screen.objects.map((obj) => (obj.id === objectId ? updater(obj) : obj)),
  }));
}

function applyResize(obj: HmiObject, patch: Partial<HmiObject>): HmiObject {
  if (obj.locked) {
    return obj;
  }

  if (obj.type !== "group") {
    return { ...obj, ...patch } as HmiObject;
  }

  const nextWidth = typeof patch.width === "number" ? patch.width : obj.width;
  const nextHeight = typeof patch.height === "number" ? patch.height : obj.height;
  if (obj.objects.some((child) => child.locked) && (nextWidth !== obj.width || nextHeight !== obj.height)) {
    return obj;
  }

  const sx = obj.width === 0 ? 1 : nextWidth / obj.width;
  const sy = obj.height === 0 ? 1 : nextHeight / obj.height;
  const children = obj.objects.map((child) => {
    if (child.locked) {
      return child;
    }
    return {
      ...child,
      x: child.x * sx,
      y: child.y * sy,
      width: child.width * sx,
      height: child.height * sy,
    };
  });

  return {
    ...obj,
    ...(patch as Partial<GroupObject>),
    width: nextWidth,
    height: nextHeight,
    objects: children,
  } satisfies GroupObject;
}

export const useScadaStore = create<ScadaState>((set, get) => ({
  project: null,
  assets: [],
  libraries: [],
  tags: {},
  tagSnapshots: [],
  drivers: [],
  macros: [],
  runtime: { running: false },
  currentScreenId: null,
  selection: {
    selectedObjectIds: [],
  },
  engineerAuthorized: Boolean(api.getEngineerToken()),

  async loadProject() {
    const project = await api.getProject();
    set({
      project,
      assets: project.assets ?? [],
      currentScreenId: project.startScreenId ?? project.screens[0]?.id ?? null,
      selection: { selectedObjectIds: [] },
    });
  },

  async saveProject() {
    const project = get().project;
    if (!project) {
      return;
    }
    const saved = await api.saveProject(project);
    set({ project: saved });
  },

  async loadTags() {
    const snapshots = await api.getTags();
    set({
      tagSnapshots: snapshots,
      tags: toTagMap(snapshots),
    });
  },

  async loadDrivers() {
    const drivers = await api.getDrivers();
    set({ drivers });
  },

  async loadMacros() {
    const macros = await api.listMacros();
    set({ macros });
  },

  async updateMacro(macroId, payload) {
    const updated = await api.updateMacro(macroId, payload);
    set((state) => ({
      macros: state.macros.map((m) => (m.id === macroId ? updated : m)),
      project: state.project
        ? {
            ...state.project,
            macros: (state.project.macros ?? []).map((m) => (m.id === macroId ? updated : m)),
          }
        : null,
    }));
    return updated;
  },

  async loadAssets() {
    const assets = await api.listAssets();
    set({ assets });
  },

  async loadLibraries() {
    const libraries = await api.listLibraries();
    set({ libraries });
  },

  async startRuntime() {
    const runtime = await api.startRuntime();
    set({ runtime });
  },

  async stopRuntime() {
    const runtime = await api.stopRuntime();
    set({ runtime });
  },

  async writeTag(name, value) {
    await api.writeTag(name, value);
  },

  async writeVariable(name, value) {
    await api.writeVariable(name, value);
  },

  async runMacro(macroId, args, options) {
    return await api.runMacro(macroId, args, options);
  },

  async loginEngineer(password) {
    const result = await api.loginEngineer(password);
    const ok = result.ok && Boolean(result.token);
    set({ engineerAuthorized: ok });
    return ok;
  },

  logoutEngineer() {
    api.setEngineerToken(null);
    set({ engineerAuthorized: false });
  },

  setTagValue(value) {
    set((state) => {
      const existingSnapshot = state.tagSnapshots.some((item) => item.definition.name === value.name);
      const nextSnapshots = existingSnapshot
        ? state.tagSnapshots.map((item) => (item.definition.name === value.name ? { ...item, value } : item))
        : [
            ...state.tagSnapshots,
            {
              definition: {
                name: value.name,
                dataType: "REAL" as TagDataType,
                writable: true,
              },
              value,
            },
          ];

      return {
        tags: {
          ...state.tags,
          [value.name]: value,
        },
        tagSnapshots: nextSnapshots,
      };
    });
  },

  setCurrentScreen(screenId) {
    set({
      currentScreenId: screenId,
      selection: { selectedObjectIds: [] },
    });
  },

  setSelectedObjects(objectIds, activeObjectId) {
    set((state) => ({
      selection: {
        ...state.selection,
        selectedObjectIds: [...new Set(objectIds)],
        activeObjectId: activeObjectId ?? objectIds[objectIds.length - 1],
      },
    }));
  },

  toggleSelectedObject(objectId) {
    set((state) => {
      const exists = state.selection.selectedObjectIds.includes(objectId);
      const selectedObjectIds = exists
        ? state.selection.selectedObjectIds.filter((id) => id !== objectId)
        : [...state.selection.selectedObjectIds, objectId];
      return {
        selection: {
          ...state.selection,
          selectedObjectIds,
          activeObjectId: exists ? selectedObjectIds[selectedObjectIds.length - 1] : objectId,
        },
      };
    });
  },

  clearSelection() {
    set((state) => ({
      selection: {
        ...state.selection,
        selectedObjectIds: [],
        activeObjectId: undefined,
      },
    }));
  },

  setSelectionRect(rect) {
    set((state) => ({
      selection: {
        ...state.selection,
        selectionRect: rect,
      },
    }));
  },

  executeCommand(command) {
    const state = get();
    const project = state.project;
    const screenId = state.currentScreenId;
    if (!project || !screenId) {
      return [];
    }
    const screen = project.screens.find((item) => item.id === screenId);
    if (!screen) {
      return [];
    }

    const result = executeEditorCommand(screen, state.selection, command);
    set({
      project: mutateScreen(project, screenId, () => result.screen),
      selection: result.selection,
    });
    return result.warnings ?? [];
  },

  moveObject(screenId, objectId, x, y) {
    const project = get().project;
    if (!project) {
      return;
    }

    set({
      project: mutateObject(project, screenId, objectId, (obj) => (obj.locked ? obj : { ...obj, x, y })),
    });
  },

  resizeObject(screenId, objectId, patch) {
    const project = get().project;
    if (!project) {
      return;
    }

    set({
      project: mutateObject(project, screenId, objectId, (obj) => applyResize(obj, patch)),
    });
  },

  updateObject(screenId, objectId, patch) {
    const project = get().project;
    if (!project) {
      return;
    }

    set({
      project: mutateObject(project, screenId, objectId, (obj) => ({ ...obj, ...patch } as HmiObject)),
    });
  },

  addScreen(kind = "screen") {
    const project = get().project;
    if (!project) {
      return;
    }

    const nextIndex = project.screens.length + 1;
    const screenId = `${kind}_${nextIndex}`;
    const nextScreen: HmiScreen = {
      id: screenId,
      name: `${kind.toUpperCase()} ${nextIndex}`,
      kind,
      width: kind === "popup" ? 520 : 1920,
      height: kind === "popup" ? 320 : 1080,
      background: kind === "template" ? "transparent" : "#1e1e1e",
      objects: [],
      popupOptions:
        kind === "popup"
          ? {
              title: `Popup ${nextIndex}`,
              defaultX: 120,
              defaultY: 120,
              modal: false,
              draggable: true,
              closable: true,
              resizable: false,
            }
          : undefined,
    };

    set({
      project: {
        ...project,
        screens: [...project.screens, nextScreen],
      },
      currentScreenId: screenId,
      selection: { selectedObjectIds: [] },
    });
  },

  updateScreen(screenId, patch) {
    const project = get().project;
    if (!project) {
      return;
    }

    set({
      project: {
        ...project,
        screens: project.screens.map((screen) => (screen.id === screenId ? { ...screen, ...patch } : screen)),
      },
    });
  },

  setScreenObjects(screenId, objects) {
    const project = get().project;
    if (!project) {
      return;
    }

    const objectsById = new Set(objects.map((item) => item.id));
    const selection = get().selection;
    const nextSelected = selection.selectedObjectIds.filter((id) => objectsById.has(id));
    const nextActive = selection.activeObjectId && objectsById.has(selection.activeObjectId)
      ? selection.activeObjectId
      : nextSelected[nextSelected.length - 1];

    set({
      project: mutateScreen(project, screenId, (screen) => ({ ...screen, objects })),
      selection: {
        ...selection,
        selectedObjectIds: nextSelected,
        activeObjectId: nextActive,
      },
    });
  },

  addObject(screenId, object) {
    const project = get().project;
    if (!project) {
      return;
    }

    const next: ScadaProject = {
      ...project,
      screens: project.screens.map((screen) =>
        screen.id === screenId ? { ...screen, objects: [...screen.objects, object] } : screen,
      ),
    };

    set({
      project: next,
      selection: {
        selectedObjectIds: [object.id],
        activeObjectId: object.id,
      },
    });
  },

  removeObject(screenId, objectId) {
    const project = get().project;
    if (!project) {
      return;
    }

    const next: ScadaProject = {
      ...project,
      screens: project.screens.map((screen) =>
        screen.id === screenId
          ? { ...screen, objects: screen.objects.filter((object) => object.id !== objectId) }
          : screen,
      ),
    };

    set({
      project: next,
      selection: { selectedObjectIds: [] },
    });
  },

  removeSelectedUnlocked(screenId) {
    const project = get().project;
    const selection = get().selection.selectedObjectIds;
    if (!project) {
      return;
    }

    const selectedSet = new Set(selection);
    const next = mutateScreen(project, screenId, (screen) => ({
      ...screen,
      objects: screen.objects.filter((object) => !(selectedSet.has(object.id) && !object.locked)),
    }));

    set({
      project: next,
      selection: { selectedObjectIds: [] },
    });
  },

  addVariable(name, dataType, initialValue) {
    const project = get().project;
    if (!project) {
      return;
    }

    const nextVariables = [
      ...(project.variables ?? []),
      {
        name,
        dataType,
        initialValue: initialValue ?? null,
        writable: true,
      },
    ];

    set({
      project: {
        ...project,
        variables: nextVariables,
      },
    });
  },

  updateProjectJson(next) {
    set({
      project: next,
      assets: next.assets ?? [],
      currentScreenId: next.startScreenId ?? next.screens[0]?.id ?? null,
      selection: { selectedObjectIds: [] },
    });
  },
}));
