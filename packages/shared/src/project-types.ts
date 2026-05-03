import type { HmiObject, TextStyle } from "./hmi-object-types";
import type { TagDataType, TagDefinition, TagScalarValue } from "./tag-types";
import type { Asset, ProjectLibraryRef } from "./asset-library-types";

export type DriverHealth = "stopped" | "starting" | "running" | "error" | "reconnecting";

export type DriverStatus = {
  id: string;
  type: string;
  health: DriverHealth;
  message?: string;
  updatedAt: number;
};

export type DriverBaseConfig = {
  id: string;
  type: "simulated" | "modbus-tcp" | "opcua";
  enabled: boolean;
  name?: string;
};

export type SimulatedDriverConfig = DriverBaseConfig & {
  type: "simulated";
};

export type ModbusTcpDriverConfig = DriverBaseConfig & {
  type: "modbus-tcp";
  host: string;
  port: number;
  unitId: number;
  timeoutMs?: number;
  reconnectMs?: number;
};

export type OpcUaDriverConfig = DriverBaseConfig & {
  type: "opcua";
  endpointUrl: string;
  securityPolicy?: "None" | "Basic256Sha256";
  securityMode?: "None" | "Sign" | "SignAndEncrypt";
  username?: string;
  password?: string;
};

export type DriverConfig = SimulatedDriverConfig | ModbusTcpDriverConfig | OpcUaDriverConfig;

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
  objects: HmiObject[];
  popupOptions?: PopupOptions;
};

export type InternalVariableDefinition = {
  name: string;
  description?: string;
  dataType: TagDataType;
  initialValue?: TagScalarValue;
  writable?: boolean;
};

export type MacroDefinition = {
  id: string;
  name: string;
  description?: string;
  language: "ts";
  code: string;
};

export type ScadaProject = {
  version: number;
  name: string;
  assets?: Asset[];
  libraries?: ProjectLibraryRef[];
  drivers: DriverConfig[];
  tags: TagDefinition[];
  variables?: InternalVariableDefinition[];
  macros?: MacroDefinition[];
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
