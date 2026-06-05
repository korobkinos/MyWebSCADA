import { create } from "zustand";
import { appToast } from "../ui";
import type {
  Asset,
  AppPermission,
  AppUser,
  DriverStatus,
  EditorCommand,
  EditorSelectionState,
  ElementLibrary,
  GroupObject,
  HmiObject,
  HmiScreen,
  InternalVariableDefinition,
  MacroDefinition,
  MacroRunResult,
  ManualCommandMeta,
  OperatorActionContext,
  RuntimeState,
  ScadaProject,
  ScreenKind,
  TagDataType,
  TagSnapshot,
  TagValue,
} from "@web-scada/shared";
import { executeEditorCommand, updateObjectDeep as updateObjectDeepInList } from "@web-scada/shared";
import { api, isAbortError } from "../services/api";
import { recordSetTagValuesCall } from "../services/runtime-diagnostics";

type TagMap = Record<string, TagValue>;
const TAG_MAP_MAX_OVERLAY_KEYS = 512;
const tagMapOverlayMeta = new WeakMap<object, { base: TagMap; overrides: TagMap }>();

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
  authUser: AppUser | null;
  authResolved: boolean;
  loadProject: () => Promise<void>;
  saveProject: (options?: { notify?: boolean }) => Promise<void>;
  loadTags: () => Promise<void>;
  loadDrivers: () => Promise<void>;
  loadMacros: () => Promise<void>;
  loadAssets: () => Promise<void>;
  loadLibraries: () => Promise<void>;
  loadRuntimeStatus: (options?: { signal?: AbortSignal }) => Promise<void>;
  startRuntime: () => Promise<void>;
  stopRuntime: () => Promise<void>;
  writeTag: (
    name: string,
    value: boolean | number | string | null,
    options?: { signal?: AbortSignal; commandMeta?: ManualCommandMeta; operatorActionContext?: OperatorActionContext },
  ) => Promise<void>;
  writeVariable: (
    name: string,
    value: boolean | number | string | null,
    options?: { signal?: AbortSignal; commandMeta?: ManualCommandMeta; operatorActionContext?: OperatorActionContext },
  ) => Promise<void>;
  runMacro: (
    macroId: string,
    args?: Record<string, unknown>,
    options?: {
      allowDisabledForTest?: boolean;
      context?: Record<string, unknown>;
      signal?: AbortSignal;
      commandMeta?: ManualCommandMeta;
      operatorActionContext?: OperatorActionContext;
    },
  ) => Promise<MacroRunResult>;
  updateMacro: (macroId: string, payload: {
    name: string;
    description?: string;
    enabled: boolean;
    language: "javascript-lite";
    code: string;
    triggers?: unknown[];
    options?: Record<string, unknown>;
  }) => Promise<MacroDefinition>;
  initializeAuth: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  loginEngineer: (password: string) => Promise<boolean>;
  logoutEngineer: () => void;
  hasPermission: (permission: AppPermission) => boolean;
  setTagValue: (value: TagValue) => void;
  setTagValues: (values: TagValue[]) => void;
  setDrivers: (drivers: DriverStatus[]) => void;
  setCurrentScreen: (screenId: string) => void;
  setSelectedObjects: (objectIds: string[], activeObjectId?: string) => void;
  toggleSelectedObject: (objectId: string) => void;
  clearSelection: () => void;
  setSelectionRect: (rect?: EditorSelectionState["selectionRect"]) => void;
  executeCommand: (command: EditorCommand) => string[];
  moveObject: (screenId: string, objectId: string, x: number, y: number) => void;
  resizeObject: (screenId: string, objectId: string, patch: Partial<HmiObject>) => void;
  updateObject: (screenId: string, objectId: string, patch: Partial<HmiObject>) => void;
  updateObjectDeep: (screenId: string, objectId: string, patch: Partial<HmiObject>) => void;
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

function createPatchedTagMap(base: TagMap, updates: TagMap): TagMap {
  const meta = tagMapOverlayMeta.get(base);
  const rootBase = meta?.base ?? base;
  const overrides: TagMap = {};
  if (meta) {
    for (const key of Object.keys(meta.overrides)) {
      const value = meta.overrides[key];
      if (value) {
        overrides[key] = value;
      }
    }
  }
  for (const key of Object.keys(updates)) {
    const value = updates[key];
    if (value) {
      overrides[key] = value;
    }
  }

  if (Object.keys(overrides).length > TAG_MAP_MAX_OVERLAY_KEYS) {
    const compact: TagMap = {};
    for (const key of Object.keys(rootBase)) {
      const value = rootBase[key];
      if (value) {
        compact[key] = value;
      }
    }
    for (const key of Object.keys(overrides)) {
      const value = overrides[key];
      if (value) {
        compact[key] = value;
      }
    }
    return compact;
  }

  const overlay = Object.create(rootBase) as TagMap;
  for (const key of Object.keys(overrides)) {
    Object.defineProperty(overlay, key, {
      configurable: true,
      enumerable: true,
      value: overrides[key],
      writable: false,
    });
  }
  tagMapOverlayMeta.set(overlay, { base: rootBase, overrides });
  return overlay;
}

function areDriverStatusListsEqual(left: DriverStatus[], right: DriverStatus[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) {
      return false;
    }
    if (a.id !== b.id || a.type !== b.type || a.health !== b.health || a.message !== b.message || a.updatedAt !== b.updatedAt) {
      return false;
    }
  }
  return true;
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
  const children = obj.objects.map((child) => scaleObjectProportionally(child, sx, sy));

  return {
    ...obj,
    ...(patch as Partial<GroupObject>),
    width: nextWidth,
    height: nextHeight,
    objects: children,
  } satisfies GroupObject;
}

function scaleObjectProportionally(object: HmiObject, sx: number, sy: number): HmiObject {
  if (object.locked) {
    return object;
  }

  const strokeScale = (Math.abs(sx) + Math.abs(sy)) / 2;
  const scaleByKey = (key: string, value: unknown): unknown => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return value;
    }
    if (key === "x" || key === "width" || key === "minWidth") {
      return value * sx;
    }
    if (key === "y" || key === "height" || key === "minHeight") {
      return value * sy;
    }
    if (key === "fontSize" || key === "strokeWidth" || key === "borderWidth") {
      return value * strokeScale;
    }
    return value;
  };

  const scaleRecord = (input: Record<string, unknown>): Record<string, unknown> => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (Array.isArray(value)) {
        if (key === "points" && value.every((item) => typeof item === "number")) {
          next[key] = value.map((item, index) => (Number(item) * (index % 2 === 0 ? sx : sy)));
        } else if (key === "objects") {
          next[key] = value.map((item) => {
            if (item && typeof item === "object") {
              return scaleObjectProportionally(item as HmiObject, sx, sy);
            }
            return item;
          });
        } else {
          next[key] = value.map((item) => {
            if (item && typeof item === "object") {
              return scaleRecord(item as Record<string, unknown>);
            }
            return item;
          });
        }
        continue;
      }
      if (value && typeof value === "object") {
        next[key] = scaleRecord(value as Record<string, unknown>);
        continue;
      }
      next[key] = scaleByKey(key, value);
    }
    return next;
  };

  return scaleRecord(object as unknown as Record<string, unknown>) as HmiObject;
}

export const useScadaStore = create<ScadaState>((set, get) => ({
  project: null,
  assets: [],
  libraries: [],
  tags: {},
  tagSnapshots: [],
  drivers: [],
  macros: [],
  runtime: { running: false, state: "stopped" },
  currentScreenId: null,
  selection: {
    selectedObjectIds: [],
  },
  engineerAuthorized: Boolean(api.getEngineerToken()),
  authUser: null,
  authResolved: false,

  async initializeAuth() {
    const token = api.getEngineerToken();
    if (!token) {
      set({ engineerAuthorized: false, authUser: null, authResolved: true });
      return;
    }
    try {
      const me = await api.authMe();
      if (!me.user) {
        api.setEngineerToken(null);
        set({ engineerAuthorized: false, authUser: null, authResolved: true });
        return;
      }
      set({ engineerAuthorized: true, authUser: me.user, authResolved: true });
    } catch {
      api.setEngineerToken(null);
      set({ engineerAuthorized: false, authUser: null, authResolved: true });
    }
  },

  async loadProject() {
    const project = await api.getProject();
    set({
      project,
      macros: project.macros ?? [],
      currentScreenId: project.startScreenId ?? project.screens[0]?.id ?? null,
      selection: { selectedObjectIds: [] },
    });
  },

  async saveProject(options) {
    const project = get().project;
    if (!project) {
      return;
    }
    const shouldNotify = options?.notify === true;
    try {
      const saved = await api.saveProject(project);
      set({ project: saved });
      if (shouldNotify) {
        appToast.success("Saved");
      }
    } catch (error) {
      if (shouldNotify) {
        const details = error instanceof Error ? error.message.trim() : "";
        appToast.error("Save failed", details ? { details } : undefined);
      }
      throw error;
    }
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
    get().setDrivers(drivers);
  },

  async loadMacros() {
    const macros = await api.listMacros();
    set((state) => ({
      macros,
      project: state.project
        ? {
            ...state.project,
            macros,
          }
        : null,
    }));
  },

  async updateMacro(macroId, payload) {
    const updated = await api.updateMacro(macroId, payload);
    set((state) => ({
      macros: state.macros.map((m) => (m.id === macroId ? updated : m)),
      project: state.project
        ? {
            ...state.project,
            macros: (() => {
              const source = state.project?.macros ?? [];
              const hasTarget = source.some((m) => m.id === macroId);
              if (!hasTarget) {
                return [...source, updated];
              }
              return source.map((m) => (m.id === macroId ? updated : m));
            })(),
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

  async loadRuntimeStatus(options) {
    try {
      const runtime = await api.getRuntimeStatus({ signal: options?.signal });
      set({ runtime });
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      throw error;
    }
  },

  async startRuntime() {
    const runtime = await api.startRuntime();
    set({ runtime });
  },

  async stopRuntime() {
    const runtime = await api.stopRuntime();
    set({ runtime });
  },

  async writeTag(name, value, options) {
    await api.writeTag(name, value, options);
  },

  async writeVariable(name, value, options) {
    await api.writeVariable(name, value, options);
  },

  async runMacro(macroId, args, options) {
    return await api.runMacro(macroId, args, options);
  },

  async login(username, password) {
    const result = await api.login(username, password);
    const ok = result.ok && Boolean(result.token) && Boolean(result.user);
    set({ engineerAuthorized: ok, authUser: result.user ?? null, authResolved: true });
    return ok;
  },

  async loginEngineer(password) {
    const result = await api.loginEngineer(password);
    const ok = result.ok && Boolean(result.token);
    const me = ok ? await api.authMe() : { user: null };
    set({ engineerAuthorized: ok, authUser: me.user ?? null, authResolved: true });
    return ok;
  },

  logoutEngineer() {
    const token = api.getEngineerToken();
    api.setEngineerToken(null);
    set({ engineerAuthorized: false, authUser: null, authResolved: true });
    if (token) {
      void api.logout({ token, suppressAuthInvalidEvent: true }).catch(() => undefined);
    }
  },

  hasPermission(permission) {
    const user = get().authUser;
    if (!user) {
      return false;
    }
    return user.permissions.includes(permission);
  },

  setTagValue(value) {
    get().setTagValues([value]);
  },

  setTagValues(values) {
    if (values.length === 0) {
      return;
    }
    recordSetTagValuesCall(values.length);
    set((state) => {
      const changedTags: TagMap = {};
      let tagsChanged = false;

      for (const value of values) {
        const prev = state.tags[value.name];
        if (
          prev &&
          prev.value === value.value &&
          prev.quality === value.quality &&
          prev.source === value.source
        ) {
          continue;
        }
        tagsChanged = true;
        changedTags[value.name] = value;
      }

      if (!tagsChanged) {
        return state;
      }

      return {
        tags: createPatchedTagMap(state.tags, changedTags),
        tagSnapshots: state.tagSnapshots,
      };
    });
  },

  setDrivers(drivers) {
    set((state) => {
      if (areDriverStatusListsEqual(state.drivers, drivers)) {
        return state;
      }
      return { drivers };
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

  updateObjectDeep(screenId, objectId, patch) {
    const project = get().project;
    if (!project) {
      return;
    }

    set({
      project: mutateScreen(project, screenId, (screen) => {
        const nextObjects = updateObjectDeepInList(screen.objects, objectId, patch);
        if (nextObjects === screen.objects) {
          return screen;
        }
        return {
          ...screen,
          objects: nextObjects,
        };
      }),
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
    const previousCurrentScreenId = get().currentScreenId;
    const nextCurrentScreenId =
      previousCurrentScreenId && next.screens.some((screen) => screen.id === previousCurrentScreenId)
        ? previousCurrentScreenId
        : next.startScreenId ?? next.screens[0]?.id ?? null;

    set({
      project: next,
      assets: next.assets ?? [],
      macros: next.macros ?? get().macros,
      currentScreenId: nextCurrentScreenId,
      selection: { selectedObjectIds: [] },
    });
  },
}));

