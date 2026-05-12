import type { HmiObject, RuntimeAction, TextStyle } from "./hmi-object-types";
import type { TagDataType, TagDefinition, TagScalarValue } from "./tag-types";
import type { Asset, AssetGroup, ProjectLibraryRef } from "./asset-library-types";
import type { MacroRunReason } from "./runtime-command-types";

export type DriverHealth = "disabled" | "stopped" | "starting" | "running" | "error" | "reconnecting";

export type DriverStatus = {
  id: string;
  type: string;
  health: DriverHealth;
  message?: string;
  updatedAt: number;
};

export type DriverBaseConfig = {
  id: string;
  type: "simulated" | "opcua";
  enabled: boolean;
  name?: string;
};

export type SimulatedDriverConfig = DriverBaseConfig & {
  type: "simulated";
  updateIntervalMs?: number;
  defaultMode?: "manual" | "random" | "ramp";
  defaultMin?: number;
  defaultMax?: number;
  defaultStep?: number;
};

export type OpcUaDriverConfig = DriverBaseConfig & {
  type: "opcua";
  endpointUrl: string;
  securityPolicy?: "None" | "Basic256Sha256";
  securityMode?: "None" | "Sign" | "SignAndEncrypt";
  username?: string;
  password?: string;
  timeoutMs?: number;
  reconnectMs?: number;
};

export type DriverConfig = SimulatedDriverConfig | OpcUaDriverConfig;

export type ScreenKind = "screen" | "popup" | "template";

export type PopupOptions = {
  title?: string;
  defaultX?: number;
  defaultY?: number;
  modal?: boolean;
  draggable?: boolean;
  closable?: boolean;
  resizable?: boolean;
  titleTextStyle?: TextStyle;
};

export type HmiScreen = {
  id: string;
  name: string;
  kind: ScreenKind;
  width: number;
  height: number;
  background?: string;
  backgroundFillMode?: "screen" | "viewport";
  objects: HmiObject[];
  popupOptions?: PopupOptions;
};

export type InternalVariableDefinition = {
  id?: string;
  name: string;
  description?: string;
  dataType: TagDataType;
  initialValue?: TagScalarValue;
  currentValue?: TagScalarValue;
  persistent?: boolean;
  lwAddress?: number;
  writable?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type MacroDefinition = {
  id: string;
  name: string;
  description?: string;
  language: "javascript-lite";
  code: string;
  enabled?: boolean;
  triggers?: MacroTrigger[];
};

export type MacroRuntimeContext = {
  tagPrefix?: string;
  parameters?: Record<string, unknown>;
  popupInstanceId?: string;
  screenId?: string;
};

export type MacroUiEffect = Extract<RuntimeAction, { type: "openPopup" | "closePopup" | "openScreen" }>;

export type MacroRunResult = {
  ok: boolean;
  status?: "ok" | "skipped";
  reason?: MacroRunReason;
  effects?: MacroUiEffect[];
};

export type MacroTrigger =
  | {
      type: "onScreenOpen";
      screenKey: string;
    }
  | {
      type: "onScreenClose";
      screenKey: string;
    }
  | {
      type: "onButtonClick";
      objectId: string;
      screenKey?: string;
    }
  | {
      type: "onTagChange";
      tag: string;
    }
  | {
      type: "onCondition";
      condition: string;
    }
  | {
      type: "interval";
      intervalMs: number;
    };

export type LwStoreConfig = {
  mode?: "volatile" | "persistent";
  values?: Record<number, number>;
};

export type EditorPanelId =
  | "screens"
  | "assets"
  | "libraries"
  | "toolbox"
  | "properties"
  | "tags"
  | "macros"
  | "drivers"
  | "objectTree"
  | "layers"
  | "projectSettings";

export type EditorPanelState = {
  id: EditorPanelId;
  title: string;
  visible: boolean;
  collapsed: boolean;
  dock: "left" | "right" | "bottom" | "floating";
  x?: number;
  y?: number;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
};

export type DockSide = "left" | "right" | "top" | "bottom";

export type DockPanelState = {
  id: string;
  side: DockSide;
  hidden: boolean;
  size: number;
  lastVisibleSize: number;
  detached?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type DockLayoutSettings = {
  panels: Record<string, DockPanelState>;
};

export type EditorSettings = {
  layout?: EditorLayoutSettings;
  dockLayout?: DockLayoutSettings;
  panels?: EditorPanelState[];
  leftPanelWidth?: number;
  rightPanelWidth?: number;
  showObjectFrames?: boolean;
};

export type EditorLayoutSettings = {
  leftPanel: {
    visible: boolean;
    collapsed: boolean;
    width: number;
    minWidth: number;
    maxWidth: number;
    collapsedWidth: number;
  };
  rightPanel: {
    visible: boolean;
    collapsed: boolean;
    width: number;
    minWidth: number;
    maxWidth: number;
    collapsedWidth: number;
  };
  topArea: {
    collapsed: boolean;
    compact: boolean;
    height?: number;
  };
  canvasToolbar: {
    collapsed: boolean;
    compact: boolean;
  };
  panels: {
    screensCollapsed: boolean;
    currentScreenCollapsed: boolean;
    toolboxCollapsed: boolean;
    propertiesCollapsed: boolean;
    objectTreeCollapsed: boolean;
  };
};

export type ProjectTheme = "light" | "dark";

export type ProjectInfo = {
  title?: string;
  subtitle?: string;
  customer?: string;
  site?: string;
  author?: string;
  description?: string;
  notes?: string;
};

export type ProjectUiSettings = {
  theme?: ProjectTheme;
  hideMainMenu?: boolean;
  editorWheelZoomEnabled?: boolean;
  windowTitle?: string;
};

export type ProjectRuntimeSettings = {
  // Tags that must stay active even when they are not visible on the current runtime screen.
  alwaysActiveTags?: string[];
  // Allow unauthenticated runtime actions (tag writes, macro runs) when object/action role requirements allow it.
  allowGuestRuntimeActions?: boolean;
};

export type ScadaProject = {
  version: number;
  name: string;
  projectInfo?: ProjectInfo;
  uiSettings?: ProjectUiSettings;
  runtimeSettings?: ProjectRuntimeSettings;
  assets?: Asset[];
  assetGroups?: AssetGroup[];
  libraries?: ProjectLibraryRef[];
  drivers: DriverConfig[];
  tags: TagDefinition[];
  variables?: InternalVariableDefinition[];
  lwStore?: LwStoreConfig;
  macros?: MacroDefinition[];
  editorSettings?: EditorSettings;
  screens: HmiScreen[];
  startScreenId?: string;
};

export type RuntimeState = {
  running: boolean;
  startedAt?: number;
};

export type EngineerAuthResponse = {
  ok: boolean;
  token?: string;
};
