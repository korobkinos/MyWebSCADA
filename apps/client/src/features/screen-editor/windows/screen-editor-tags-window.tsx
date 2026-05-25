import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { TagDefinition, TagScalarValue, TagSimulationProfile, TagSimulationSettings, TagSourceType } from "@web-scada/shared";
import { message, Modal } from "antd";
import { WorkbenchButton, WorkbenchWindow, type WorkbenchWindowRect } from "../../../components/workbench";
import { reconcileEventsAfterTagDeletion } from "../../events/event-tag-utils";
import { api, type OpcUaBrowseItem } from "../../../services/api";
import { useScadaStore } from "../../../store/scada-store";

type TagEditorMode = "view" | "add" | "edit";
type SourceFilter = "all" | TagSourceType;
type SimulationBulkMode = "patch" | "replace" | "fillEmpty";
type CreateSimulationDuplicateMode = "overwrite" | "suffix";
type BulkFieldKey =
  | "enabled"
  | "profile"
  | "updateIntervalMs"
  | "min"
  | "max"
  | "initialValue"
  | "ramp.step"
  | "ramp.direction"
  | "ramp.resetOnLimit"
  | "random.min"
  | "random.max"
  | "sin.amplitude"
  | "sin.offset"
  | "sin.periodMs"
  | "sin.phaseDeg"
  | "noise.amplitude"
  | "noise.type"
  | "toggle.trueMs"
  | "toggle.falseMs"
  | "randomBool.trueProbability"
  | "variationMode";
type TagColumnId = "name" | "source" | "dataType" | "driver" | "address" | "group" | "writable";
type TagColumnConfig = {
  id: TagColumnId;
  title: string;
  defaultWidth: number;
  minWidth: number;
};
type TagColumnVisibility = Record<TagColumnId, boolean>;
type GeneratedSimulationEntry = {
  baseName: string;
  indexText: string;
};

const TAG_COLUMNS: TagColumnConfig[] = [
  { id: "name", title: "NAME", defaultWidth: 260, minWidth: 140 },
  { id: "source", title: "SOURCE", defaultWidth: 100, minWidth: 80 },
  { id: "dataType", title: "TYPE", defaultWidth: 90, minWidth: 70 },
  { id: "driver", title: "DRIVER", defaultWidth: 160, minWidth: 100 },
  { id: "address", title: "NODE / ADDRESS", defaultWidth: 320, minWidth: 160 },
  { id: "group", title: "GROUP", defaultWidth: 120, minWidth: 90 },
  { id: "writable", title: "W", defaultWidth: 60, minWidth: 44 },
];

const TAG_DETAILS_WIDTH_STORAGE_KEY = "screenEditor.tags.detailsWidth";
const TAG_COLUMNS_WIDTH_STORAGE_KEY = "screenEditor.tags.columnWidths";
const TAG_COLUMN_VISIBILITY_STORAGE_KEY = "screenEditor.tags.columnVisibility";
const TAG_PAGE_SIZE_STORAGE_KEY = "screenEditor.tags.pageSize";
const OPC_BROWSER_RECT_STORAGE_KEY = "screenEditor.tags.opcBrowserRect";
const DEFAULT_DETAILS_WIDTH = 360;
const MIN_DETAILS_WIDTH = 260;
const MAX_DETAILS_WIDTH = 640;
const DEFAULT_PAGE_SIZE = 100;
const OPC_BROWSER_MIN_WIDTH = 720;
const OPC_BROWSER_MIN_HEIGHT = 420;
const OPC_BROWSER_DEFAULT_RECT: WorkbenchWindowRect = { x: 120, y: 80, width: 980, height: 650 };
const CREATE_SIMULATION_MIN_WIDTH = 720;
const CREATE_SIMULATION_MIN_HEIGHT = 520;
const CREATE_SIMULATION_DEFAULT_RECT: WorkbenchWindowRect = { x: 180, y: 90, width: 900, height: 680 };
const BULK_SIMULATION_MIN_WIDTH = 760;
const BULK_SIMULATION_MIN_HEIGHT = 560;
const BULK_SIMULATION_DEFAULT_RECT: WorkbenchWindowRect = { x: 200, y: 100, width: 880, height: 700 };
const OPC_UA_IMPORT_SUBTREE_DEFAULT_MAX_NODES = 20_000;
const OPC_UA_IMPORT_SUBTREE_DEFAULT_SCAN_RATE = 500;

function createDefaultColumnVisibility(): TagColumnVisibility {
  return TAG_COLUMNS.reduce<TagColumnVisibility>(
    (acc, column) => ({ ...acc, [column.id]: true }),
    {
      name: true,
      source: true,
      dataType: true,
      driver: true,
      address: true,
      group: true,
      writable: true,
    },
  );
}

function clampDetailsWidth(value: number): number {
  return Math.min(MAX_DETAILS_WIDTH, Math.max(MIN_DETAILS_WIDTH, value));
}

function createDefaultColumnWidths(): Record<TagColumnId, number> {
  return TAG_COLUMNS.reduce<Record<TagColumnId, number>>(
    (acc, column) => ({ ...acc, [column.id]: column.defaultWidth }),
    {
      name: 0,
      source: 0,
      dataType: 0,
      driver: 0,
      address: 0,
      group: 0,
      writable: 0,
    },
  );
}

function parseStoredColumnWidths(raw: string | null): Record<TagColumnId, number> {
  const defaults = createDefaultColumnWidths();
  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<TagColumnId, unknown>>;
    return TAG_COLUMNS.reduce<Record<TagColumnId, number>>((acc, column) => {
      const candidate = parsed[column.id];
      acc[column.id] =
        typeof candidate === "number" && Number.isFinite(candidate)
          ? Math.max(column.minWidth, candidate)
          : defaults[column.id];
      return acc;
    }, { ...defaults });
  } catch {
    return defaults;
  }
}

function parseStoredColumnVisibility(raw: string | null): TagColumnVisibility {
  const defaults = createDefaultColumnVisibility();
  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<TagColumnId, unknown>>;
    const next = TAG_COLUMNS.reduce<TagColumnVisibility>((acc, column) => {
      const candidate = parsed[column.id];
      acc[column.id] = candidate === false ? false : true;
      return acc;
    }, { ...defaults });
    next.name = true;
    if (!Object.values(next).some(Boolean)) {
      next.name = true;
    }
    return next;
  } catch {
    return defaults;
  }
}

const sourceTypeOptions: Array<{ label: string; value: TagSourceType }> = [
  { label: "OPC UA", value: "opcua" },
  { label: "LW", value: "lw" },
  { label: "Internal", value: "internal" },
  { label: "Computed", value: "computed" },
  { label: "Simulated", value: "simulated" },
  { label: "Modbus", value: "modbus" },
];

const dataTypeOptions: TagDefinition["dataType"][] = [
  "BOOL",
  "INT",
  "UINT",
  "DINT",
  "UDINT",
  "REAL",
  "STRING",
];
const OPC_UA_BROWSE_ROOT_NODE_ID = "RootFolder";
const NUMERIC_TAG_DATA_TYPES = new Set<TagDefinition["dataType"]>(["INT", "UINT", "DINT", "UDINT", "REAL"]);
const SIMULATION_MIN_INTERVAL_MS = 100;
const SIMULATION_BULK_CREATE_LIMIT = 5000;
const BULK_FIELD_KEYS: BulkFieldKey[] = [
  "enabled",
  "profile",
  "updateIntervalMs",
  "min",
  "max",
  "initialValue",
  "ramp.step",
  "ramp.direction",
  "ramp.resetOnLimit",
  "random.min",
  "random.max",
  "sin.amplitude",
  "sin.offset",
  "sin.periodMs",
  "sin.phaseDeg",
  "noise.amplitude",
  "noise.type",
  "toggle.trueMs",
  "toggle.falseMs",
  "randomBool.trueProbability",
  "variationMode",
];

function isBoolType(dataType: TagDefinition["dataType"]): boolean {
  return dataType === "BOOL";
}

function isStringType(dataType: TagDefinition["dataType"]): boolean {
  return dataType === "STRING";
}

function isNumericType(dataType: TagDefinition["dataType"]): boolean {
  return NUMERIC_TAG_DATA_TYPES.has(dataType);
}

function getDefaultSimulationProfile(dataType: TagDefinition["dataType"]): TagSimulationProfile {
  if (isBoolType(dataType)) {
    return "toggle";
  }
  if (isStringType(dataType)) {
    return "constant";
  }
  return "ramp";
}

function profileFromLegacyPattern(
  pattern: unknown,
  dataType: TagDefinition["dataType"],
): TagSimulationProfile {
  const value = typeof pattern === "string" ? pattern : "";
  if (isBoolType(dataType)) {
    if (value === "toggle") {
      return "toggle";
    }
    if (value === "random") {
      return "randomBool";
    }
    return "constant";
  }
  if (isStringType(dataType)) {
    return "constant";
  }
  if (value === "random") {
    return "random";
  }
  if (value === "sine") {
    return "sin";
  }
  if (value === "static") {
    return "constant";
  }
  return getDefaultSimulationProfile(dataType);
}

function profileFromLegacyMode(mode: TagSimulationSettings["mode"] | undefined): TagSimulationProfile | undefined {
  if (mode === "manual") {
    return "constant";
  }
  if (mode === "random" || mode === "range") {
    return "random";
  }
  if (mode === "ramp") {
    return "ramp";
  }
  if (mode === "toggle") {
    return "toggle";
  }
  if (mode === "sine") {
    return "sin";
  }
  return undefined;
}

function profileToLegacyPattern(
  profile: TagSimulationProfile | undefined,
  dataType: TagDefinition["dataType"],
): "toggle" | "sine" | "random" | "static" {
  if (isBoolType(dataType)) {
    if (profile === "toggle") {
      return "toggle";
    }
    if (profile === "randomBool" || profile === "random") {
      return "random";
    }
    return "static";
  }
  if (isStringType(dataType)) {
    return "static";
  }
  if (profile === "constant") {
    return "static";
  }
  if (profile === "random") {
    return "random";
  }
  if (profile === "sin" || profile === "sinNoise") {
    return "sine";
  }
  return "sine";
}

function coerceProfileForDataType(
  profile: TagSimulationProfile | undefined,
  dataType: TagDefinition["dataType"],
): TagSimulationProfile {
  if (isBoolType(dataType)) {
    if (profile === "constant" || profile === "toggle" || profile === "randomBool" || profile === "random") {
      return profile;
    }
    return "toggle";
  }
  if (isStringType(dataType)) {
    return "constant";
  }
  if (profile === "toggle" || profile === "randomBool") {
    return "random";
  }
  if (
    profile === "constant"
    || profile === "ramp"
    || profile === "random"
    || profile === "sin"
    || profile === "rampNoise"
    || profile === "sinNoise"
  ) {
    return profile;
  }
  return getDefaultSimulationProfile(dataType);
}

function toSimulationSettings(tag: TagDefinition): TagSimulationSettings {
  const address = (tag.address ?? {}) as Record<string, unknown>;
  const profile = coerceProfileForDataType(
    tag.simulation?.profile
      ?? profileFromLegacyMode(tag.simulation?.mode)
      ?? profileFromLegacyPattern(address.pattern, tag.dataType),
    tag.dataType,
  );
  if (tag.simulation) {
    const min = typeof tag.simulation.min === "number" ? tag.simulation.min : (typeof address.min === "number" ? address.min : undefined);
    const max = typeof tag.simulation.max === "number" ? tag.simulation.max : (typeof address.max === "number" ? address.max : undefined);
    return {
      ...tag.simulation,
      enabled: tag.simulation.enabled ?? true,
      profile,
      updateIntervalMs: tag.simulation.updateIntervalMs ?? tag.simulation.intervalMs ?? (typeof address.periodMs === "number" ? address.periodMs : tag.scanRateMs),
      min,
      max,
      ramp: {
        step: tag.simulation.ramp?.step ?? tag.simulation.step,
        direction: tag.simulation.ramp?.direction ?? "pingPong",
        resetOnLimit: tag.simulation.ramp?.resetOnLimit ?? false,
      },
      random: {
        min: tag.simulation.random?.min ?? min,
        max: tag.simulation.random?.max ?? max,
      },
      sin: {
        amplitude: tag.simulation.sin?.amplitude,
        offset: tag.simulation.sin?.offset,
        periodMs: tag.simulation.sin?.periodMs ?? (typeof address.periodMs === "number" ? address.periodMs : undefined),
        phaseDeg: tag.simulation.sin?.phaseDeg ?? 0,
      },
      noise: {
        amplitude: tag.simulation.noise?.amplitude ?? 0,
        type: tag.simulation.noise?.type ?? "uniform",
      },
      toggle: {
        trueMs: tag.simulation.toggle?.trueMs,
        falseMs: tag.simulation.toggle?.falseMs,
      },
      randomBool: {
        trueProbability: tag.simulation.randomBool?.trueProbability ?? 0.5,
      },
      variationMode: tag.simulation.variationMode ?? "perTagSeed",
    };
  }
  return {
    enabled: true,
    profile,
    updateIntervalMs: typeof address.periodMs === "number" ? address.periodMs : tag.scanRateMs,
    initialValue: (address.value as TagScalarValue | undefined) ?? undefined,
    min: typeof address.min === "number" ? address.min : undefined,
    max: typeof address.max === "number" ? address.max : undefined,
    ramp: {
      step: typeof address.step === "number" ? address.step : undefined,
      direction: "pingPong",
      resetOnLimit: false,
    },
    random: {
      min: typeof address.min === "number" ? address.min : undefined,
      max: typeof address.max === "number" ? address.max : undefined,
    },
    sin: {
      periodMs: typeof address.periodMs === "number" ? address.periodMs : undefined,
      phaseDeg: 0,
    },
    noise: {
      amplitude: 0,
      type: "uniform",
    },
    randomBool: {
      trueProbability: 0.5,
    },
    variationMode: "perTagSeed",
  };
}

function syncLegacySimulationAddress(tag: TagDefinition): TagDefinition {
  if (tag.sourceType !== "simulated" || !tag.simulation) {
    return tag;
  }
  const baseAddress = (tag.address && typeof tag.address === "object")
    ? { ...(tag.address as Record<string, unknown>) }
    : {};
  const simulation = tag.simulation;
  const nextAddress: Record<string, unknown> = {
    ...baseAddress,
    pattern: profileToLegacyPattern(simulation.profile, tag.dataType),
  };
  if (typeof simulation.updateIntervalMs === "number") {
    nextAddress.periodMs = simulation.updateIntervalMs;
  } else {
    delete nextAddress.periodMs;
  }
  if (typeof simulation.min === "number") {
    nextAddress.min = simulation.min;
  } else {
    delete nextAddress.min;
  }
  if (typeof simulation.max === "number") {
    nextAddress.max = simulation.max;
  } else {
    delete nextAddress.max;
  }
  if (typeof simulation.ramp?.step === "number") {
    nextAddress.step = simulation.ramp.step;
  } else {
    delete nextAddress.step;
  }
  if (simulation.initialValue !== undefined) {
    nextAddress.value = simulation.initialValue;
  } else {
    delete nextAddress.value;
  }
  return {
    ...tag,
    address: nextAddress,
  };
}

function withSimulationPatch(
  tag: TagDefinition,
  patch: Partial<TagSimulationSettings>,
): TagDefinition {
  if (tag.sourceType !== "simulated") {
    return tag;
  }
  const nextSimulation: TagSimulationSettings = {
    ...toSimulationSettings(tag),
    ...patch,
  };
  const normalized = {
    ...tag,
    simulation: {
      ...nextSimulation,
      profile: coerceProfileForDataType(nextSimulation.profile, tag.dataType),
    },
  };
  return syncLegacySimulationAddress(normalized);
}

function getSimulationFieldValue(simulation: TagSimulationSettings, key: BulkFieldKey): unknown {
  const parts = key.split(".");
  let cursor: unknown = simulation;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function setSimulationFieldValue(simulation: TagSimulationSettings, key: BulkFieldKey, value: unknown): TagSimulationSettings {
  const next = structuredClone(simulation) as Record<string, unknown>;
  const parts = key.split(".");
  let cursor: Record<string, unknown> = next;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]!;
    const current = cursor[part];
    if (!current || typeof current !== "object") {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
  return next as TagSimulationSettings;
}

function isEmptyBulkValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function normalizeSimulationForSave(simulation: TagSimulationSettings, dataType: TagDefinition["dataType"]): TagSimulationSettings {
  const normalized = {
    ...simulation,
    profile: coerceProfileForDataType(simulation.profile, dataType),
  };
  if (typeof normalized.updateIntervalMs === "number") {
    normalized.updateIntervalMs = Math.max(SIMULATION_MIN_INTERVAL_MS, Math.round(normalized.updateIntervalMs));
  }
  return normalized;
}

function coerceInitialValueByDataType(value: TagScalarValue | undefined, dataType: TagDefinition["dataType"]): TagScalarValue | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (isBoolType(dataType)) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return value.toLowerCase() === "true";
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    return false;
  }
  if (isStringType(dataType)) {
    return String(value);
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function createBulkApplyFlags(): Record<BulkFieldKey, boolean> {
  return BULK_FIELD_KEYS.reduce<Record<BulkFieldKey, boolean>>((acc, key) => {
    acc[key] = key === "profile" || key === "enabled" || key === "updateIntervalMs";
    return acc;
  }, {} as Record<BulkFieldKey, boolean>);
}

function clampOpcBrowserRect(rect: WorkbenchWindowRect): WorkbenchWindowRect {
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(OPC_BROWSER_MIN_WIDTH, Math.round(rect.width)),
    height: Math.max(OPC_BROWSER_MIN_HEIGHT, Math.round(rect.height)),
  };
}

function clampCreateSimulationRect(rect: WorkbenchWindowRect): WorkbenchWindowRect {
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(CREATE_SIMULATION_MIN_WIDTH, Math.round(rect.width)),
    height: Math.max(CREATE_SIMULATION_MIN_HEIGHT, Math.round(rect.height)),
  };
}

function clampBulkSimulationRect(rect: WorkbenchWindowRect): WorkbenchWindowRect {
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(BULK_SIMULATION_MIN_WIDTH, Math.round(rect.width)),
    height: Math.max(BULK_SIMULATION_MIN_HEIGHT, Math.round(rect.height)),
  };
}

function parseStoredOpcBrowserRect(raw: string | null): WorkbenchWindowRect {
  if (!raw) {
    return OPC_BROWSER_DEFAULT_RECT;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof WorkbenchWindowRect, unknown>>;
    if (
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number"
    ) {
      return OPC_BROWSER_DEFAULT_RECT;
    }
    return clampOpcBrowserRect({
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
    });
  } catch {
    return OPC_BROWSER_DEFAULT_RECT;
  }
}

function getOpcUaParentNodeId(nodeId: string): string | null {
  const text = nodeId.trim();

  if (!text || text === OPC_UA_BROWSE_ROOT_NODE_ID) {
    return null;
  }

  const marker = ";s=";
  const markerIndex = text.indexOf(marker);
  if (markerIndex >= 0) {
    const prefix = text.slice(0, markerIndex + marker.length);
    const path = text.slice(markerIndex + marker.length);
    const lastSlash = path.lastIndexOf("/");
    const lastDot = path.lastIndexOf(".");
    const separatorIndex = Math.max(lastSlash, lastDot);
    if (separatorIndex > 0) {
      return `${prefix}${path.slice(0, separatorIndex)}`;
    }
    return OPC_UA_BROWSE_ROOT_NODE_ID;
  }

  return OPC_UA_BROWSE_ROOT_NODE_ID;
}

function mapOpcUaDataTypeToTagDataType(dataType?: string): TagDefinition["dataType"] {
  const normalized = (dataType ?? "").toLowerCase();

  if (normalized.includes("boolean") || normalized.includes("bool")) {
    return "BOOL";
  }
  if (normalized.includes("udint") || normalized.includes("uint32")) {
    return "UDINT";
  }
  if (normalized.includes("dint") || normalized.includes("int32")) {
    return "DINT";
  }
  if (normalized.includes("uint16") || normalized.includes("ushort") || normalized.includes("uint")) {
    return "UINT";
  }
  if (normalized.includes("int16") || normalized.includes("short") || normalized.includes("integer") || normalized.includes("int")) {
    return "INT";
  }
  if (
    normalized.includes("double")
    || normalized.includes("float")
    || normalized.includes("real")
    || normalized.includes("number")
    || normalized.includes("decimal")
  ) {
    return "REAL";
  }
  if (normalized.includes("string") || normalized.includes("text")) {
    return "STRING";
  }

  return "REAL";
}

function makeTagNameFromOpcNode(node: OpcUaBrowseItem): string {
  const raw = node.displayName || node.browseName || node.nodeId;
  const normalized = raw
    .replace(/^.*[:/]/, "")
    .replace(/[^\w.]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "opcua_tag";
}

function canBrowseOpcNode(node: OpcUaBrowseItem): boolean {
  return node.hasChildren === true;
}

type OpcUaBrowserContentProps = {
  opcUaDrivers: Array<{ id: string; name?: string }>;
  mode: "single" | "multi";
  driverId: string;
  nodeId: string;
  search: string;
  loading: boolean;
  error: string | null;
  nodes: OpcUaBrowseItem[];
  selectedNodeIds: Set<string>;
  focusNodeId: string;
  historyLength: number;
  canGoUp: boolean;
  onDriverChange: (driverId: string) => void;
  onBack: () => void;
  onUp: () => void;
  onRoot: () => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onRowClick: (node: OpcUaBrowseItem) => void;
  onRowDoubleClick: (node: OpcUaBrowseItem) => void;
  onToggleSelection: (nodeId: string) => void;
  onSingleSelect: (nodeId: string) => void;
  onOpenNode: (node: OpcUaBrowseItem) => void;
  onSelectNode: (node: OpcUaBrowseItem) => void;
  onCancel: () => void;
  onConfirmSingle: () => void;
  onConfirmMulti: () => void;
  subtreeImportBusy: boolean;
  subtreeImportEnabled: boolean;
  subtreeImportOverwrite: boolean;
  subtreeImportRootName: string;
  subtreeImportScanRateMs: string;
  subtreeImportMaxNodes: string;
  onSubtreeImportOverwriteChange: (value: boolean) => void;
  onSubtreeImportRootNameChange: (value: string) => void;
  onSubtreeImportScanRateMsChange: (value: string) => void;
  onSubtreeImportMaxNodesChange: (value: string) => void;
  onImportSubtree: () => void;
};

function OpcUaBrowserContent({
  opcUaDrivers,
  mode,
  driverId,
  nodeId,
  search,
  loading,
  error,
  nodes,
  selectedNodeIds,
  focusNodeId,
  historyLength,
  canGoUp,
  onDriverChange,
  onBack,
  onUp,
  onRoot,
  onRefresh,
  onSearchChange,
  onRowClick,
  onRowDoubleClick,
  onToggleSelection,
  onSingleSelect,
  onOpenNode,
  onSelectNode,
  onCancel,
  onConfirmSingle,
  onConfirmMulti,
  subtreeImportBusy,
  subtreeImportEnabled,
  subtreeImportOverwrite,
  subtreeImportRootName,
  subtreeImportScanRateMs,
  subtreeImportMaxNodes,
  onSubtreeImportOverwriteChange,
  onSubtreeImportRootNameChange,
  onSubtreeImportScanRateMsChange,
  onSubtreeImportMaxNodesChange,
  onImportSubtree,
}: OpcUaBrowserContentProps) {
  return (
    <div className="screen-editor-window-content screen-editor-opc-browser-content">
      <div className="screen-editor-opc-browser-toolbar">
        <select
          className="workbench-select"
          value={driverId}
          onChange={(event) => onDriverChange(event.target.value)}
        >
          <option value="">Select driver</option>
          {opcUaDrivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.name ?? driver.id}
            </option>
          ))}
        </select>
        <WorkbenchButton
          onClick={onBack}
          disabled={historyLength === 0 || loading || !driverId}
        >
          Back
        </WorkbenchButton>
        <WorkbenchButton
          onClick={onUp}
          disabled={!canGoUp || loading || !driverId}
        >
          Up
        </WorkbenchButton>
        <WorkbenchButton
          onClick={onRoot}
          disabled={nodeId === OPC_UA_BROWSE_ROOT_NODE_ID || loading || !driverId}
        >
          Root
        </WorkbenchButton>
        <WorkbenchButton
          variant="primary"
          onClick={onRefresh}
          disabled={loading || !driverId}
        >
          {loading ? "Loading..." : "Refresh"}
        </WorkbenchButton>
        <div className="screen-editor-opc-browser-current-node" title={nodeId || OPC_UA_BROWSE_ROOT_NODE_ID}>
          Current NodeId: {nodeId || OPC_UA_BROWSE_ROOT_NODE_ID}
        </div>
        <input
          className="workbench-input screen-editor-opc-browser-toolbar__search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search"
        />
      </div>

      <div className="screen-editor-opc-browser-list">
        <div className="screen-editor-opc-browser-row screen-editor-opc-browser-row--header">
          <div className="screen-editor-opc-browser-cell">S</div>
          <div className="screen-editor-opc-browser-cell">Browse Name</div>
          <div className="screen-editor-opc-browser-cell">Display Name</div>
          <div className="screen-editor-opc-browser-cell">Node Class</div>
          <div className="screen-editor-opc-browser-cell">Data Type</div>
          <div className="screen-editor-opc-browser-cell">Writable</div>
          <div className="screen-editor-opc-browser-cell">NodeId</div>
          <div className="screen-editor-opc-browser-cell">Actions</div>
        </div>
        {error ? (
          <div className="screen-editor-empty-state">{error}</div>
        ) : null}
        {!error && nodes.length === 0 && !loading ? (
          <div className="screen-editor-empty-state">No nodes</div>
        ) : null}
        {nodes.map((node) => {
          const isChecked = selectedNodeIds.has(node.nodeId);
          const isFocused = focusNodeId === node.nodeId;
          const isSelected = mode === "multi" ? isChecked : isFocused;
          const isBrowsable = canBrowseOpcNode(node);
          return (
            <div
              key={node.nodeId}
              className={[
                "screen-editor-opc-browser-row",
                isBrowsable ? "screen-editor-opc-browser-row--folder" : "screen-editor-opc-browser-row--leaf",
                isSelected ? "screen-editor-opc-browser-row--selected" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => onRowClick(node)}
              onDoubleClick={() => onRowDoubleClick(node)}
            >
              <div className="screen-editor-opc-browser-cell">
                {mode === "multi" ? (
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onToggleSelection(node.nodeId)}
                    onClick={(event) => event.stopPropagation()}
                  />
                ) : (
                  <input
                    type="radio"
                    checked={isChecked}
                    onChange={() => onSingleSelect(node.nodeId)}
                    onClick={(event) => event.stopPropagation()}
                  />
                )}
              </div>
              <div className="screen-editor-opc-browser-cell" title={node.browseName}>{node.browseName || "-"}</div>
              <div className="screen-editor-opc-browser-cell" title={node.displayName}>{node.displayName || "-"}</div>
              <div className="screen-editor-opc-browser-cell" title={node.nodeClass}>{node.nodeClass || "-"}</div>
              <div className="screen-editor-opc-browser-cell" title={node.dataType}>{node.dataType || "-"}</div>
              <div className="screen-editor-opc-browser-cell">{node.writable ? "Yes" : "No"}</div>
              <div className="screen-editor-opc-browser-cell" title={node.nodeId}>{node.nodeId}</div>
              <div className="screen-editor-opc-browser-cell screen-editor-opc-browser-cell--actions">
                {isBrowsable ? (
                  <WorkbenchButton
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenNode(node);
                    }}
                  >
                    Open
                  </WorkbenchButton>
                ) : (
                  <WorkbenchButton
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectNode(node);
                    }}
                  >
                    Select
                  </WorkbenchButton>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="screen-editor-opc-browser-footer">
        {mode === "multi" ? (
          <div className="screen-editor-opc-browser-import-options">
            <label className="screen-editor-opc-browser-import-options__check">
              <input
                type="checkbox"
                checked={subtreeImportOverwrite}
                onChange={(event) => onSubtreeImportOverwriteChange(event.target.checked)}
                disabled={subtreeImportBusy}
              />
              <span>Overwrite existing tags</span>
            </label>
            <label className="screen-editor-opc-browser-import-options__field">
              <span>Root name / prefix</span>
              <input
                className="workbench-input"
                value={subtreeImportRootName}
                onChange={(event) => onSubtreeImportRootNameChange(event.target.value)}
                disabled={subtreeImportBusy}
              />
            </label>
            <label className="screen-editor-opc-browser-import-options__field">
              <span>Scan rate ms</span>
              <input
                className="workbench-input"
                type="number"
                min={50}
                value={subtreeImportScanRateMs}
                onChange={(event) => onSubtreeImportScanRateMsChange(event.target.value)}
                disabled={subtreeImportBusy}
              />
            </label>
            <label className="screen-editor-opc-browser-import-options__field">
              <span>Max nodes</span>
              <input
                className="workbench-input"
                type="number"
                min={1}
                value={subtreeImportMaxNodes}
                onChange={(event) => onSubtreeImportMaxNodesChange(event.target.value)}
                disabled={subtreeImportBusy}
              />
            </label>
          </div>
        ) : null}
        <WorkbenchButton onClick={onCancel} disabled={subtreeImportBusy}>Cancel</WorkbenchButton>
        {mode === "single" ? (
          <WorkbenchButton
            variant="primary"
            onClick={onConfirmSingle}
            disabled={selectedNodeIds.size === 0 || subtreeImportBusy}
          >
            Select Node
          </WorkbenchButton>
        ) : (
          <>
            <WorkbenchButton
              onClick={onConfirmMulti}
              disabled={selectedNodeIds.size === 0 || subtreeImportBusy}
            >
              Import Selected
            </WorkbenchButton>
            <WorkbenchButton
              variant="primary"
              onClick={onImportSubtree}
              disabled={!subtreeImportEnabled || subtreeImportBusy}
            >
              {subtreeImportBusy ? "Importing..." : "Import Subtree"}
            </WorkbenchButton>
          </>
        )}
      </div>
    </div>
  );
}

function makeUniqueTagName(base: string, tags: TagDefinition[], reservedNames?: Set<string>): string {
  const fallback = base.trim() || "opcua_tag";
  const usedNames = new Set(tags.map((item) => item.name));
  if (reservedNames) {
    for (const name of reservedNames) {
      usedNames.add(name);
    }
  }
  if (!usedNames.has(fallback)) {
    return fallback;
  }
  let suffix = 2;
  let next = `${fallback}_${suffix}`;
  while (usedNames.has(next)) {
    suffix += 1;
    next = `${fallback}_${suffix}`;
  }
  return next;
}

function createId(): string {
  return `tag_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function tagKey(tag: TagDefinition): string {
  return tag.id ?? tag.name;
}

function toOptionalNumber(raw: string): number | undefined {
  if (!raw.trim()) {
    return undefined;
  }
  const next = Number(raw);
  return Number.isFinite(next) ? next : undefined;
}

function formatAddressCell(tag: TagDefinition): string {
  if (tag.nodeId) {
    return tag.nodeId;
  }
  if (typeof tag.lwAddress === "number") {
    return String(tag.lwAddress);
  }
  if (tag.internalVariableName) {
    return tag.internalVariableName;
  }
  if (tag.address && typeof tag.address === "object") {
    const raw = (tag.address as { raw?: unknown }).raw;
    return typeof raw === "string" ? raw : JSON.stringify(tag.address);
  }
  return "-";
}

function createDefaultDraft(): TagDefinition {
  return {
    id: createId(),
    name: "",
    description: "",
    sourceType: "opcua",
    dataType: "REAL",
    writable: false,
    scanRateMs: 500,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function normalizeDraft(draft: TagDefinition, isEditing: boolean): TagDefinition {
  let normalized: TagDefinition = {
    ...draft,
    id: draft.id ?? createId(),
    name: draft.name.trim(),
    sourceType: draft.sourceType ?? "simulated",
    dataType: draft.dataType ?? "REAL",
    description: draft.description?.trim() || undefined,
    group: draft.group?.trim() || undefined,
    unit: draft.unit?.trim() || undefined,
    createdAt: isEditing ? draft.createdAt ?? nowIso() : nowIso(),
    updatedAt: nowIso(),
  };

  const sourceType = normalized.sourceType ?? "simulated";

  if (sourceType !== "opcua") {
    normalized.driverId = undefined;
    normalized.nodeId = undefined;
  }
  if (sourceType !== "lw") {
    normalized.lwAddress = undefined;
    normalized.persistent = undefined;
  }
  if (sourceType !== "internal") {
    normalized.internalVariableName = undefined;
  }
  if (sourceType !== "simulated" && sourceType !== "modbus") {
    normalized.address = undefined;
  }
  if (sourceType === "simulated") {
    const simulation = toSimulationSettings(normalized);
    normalized = syncLegacySimulationAddress({
      ...normalized,
      simulation: {
        ...simulation,
        profile: coerceProfileForDataType(simulation.profile, normalized.dataType),
      },
    });
  }

  return normalized;
}

function buildGeneratedSimulationEntries(
  prefix: string,
  startIndex: number,
  count: number,
  padding: number,
): GeneratedSimulationEntry[] {
  const entries: GeneratedSimulationEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const current = startIndex + index;
    const indexText = String(Math.max(0, current)).padStart(padding, "0");
    entries.push({
      baseName: `${prefix}_${indexText}`,
      indexText,
    });
  }
  return entries;
}

function nextNameWithSuffix(baseName: string, usedNames: Set<string>): string {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName);
    return baseName;
  }
  let suffix = 1;
  let next = `${baseName}_${suffix}`;
  while (usedNames.has(next)) {
    suffix += 1;
    next = `${baseName}_${suffix}`;
  }
  usedNames.add(next);
  return next;
}

function createDefaultSimulationSettingsDraft(dataType: TagDefinition["dataType"]): TagSimulationSettings {
  return normalizeSimulationForSave(
    toSimulationSettings({
      name: "__simulation_draft__",
      sourceType: "simulated",
      dataType,
      simulation: {
        enabled: true,
        profile: getDefaultSimulationProfile(dataType),
        updateIntervalMs: 1000,
      },
    }),
    dataType,
  );
}

export function ScreenEditorTagsWindow() {
  const project = useScadaStore((s) => s.project);
  const runtimeTags = useScadaStore((s) => s.tags);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const saveProject = useScadaStore((s) => s.saveProject);
  const loadProject = useScadaStore((s) => s.loadProject);
  const loadTags = useScadaStore((s) => s.loadTags);
  const loadDrivers = useScadaStore((s) => s.loadDrivers);
  const loadMacros = useScadaStore((s) => s.loadMacros);

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [driverFilter, setDriverFilter] = useState<string | "all">("all");
  const [groupFilter, setGroupFilter] = useState<string | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTagKeys, setSelectedTagKeys] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<TagEditorMode>("view");
  const [draftTag, setDraftTag] = useState<TagDefinition | null>(null);
  const [pendingDeleteTagId, setPendingDeleteTagId] = useState<string | null>(null);
  const [columnsPanelOpen, setColumnsPanelOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_PAGE_SIZE;
    }
    const saved = window.localStorage.getItem(TAG_PAGE_SIZE_STORAGE_KEY);
    const parsed = saved ? Number(saved) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE_SIZE;
  });
  const [detailsWidth, setDetailsWidth] = useState<number>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_DETAILS_WIDTH;
    }
    const saved = window.localStorage.getItem(TAG_DETAILS_WIDTH_STORAGE_KEY);
    const parsed = saved ? Number(saved) : Number.NaN;
    return Number.isFinite(parsed) ? clampDetailsWidth(parsed) : DEFAULT_DETAILS_WIDTH;
  });
  const [columnWidths, setColumnWidths] = useState<Record<TagColumnId, number>>(() => {
    if (typeof window === "undefined") {
      return createDefaultColumnWidths();
    }
    return parseStoredColumnWidths(window.localStorage.getItem(TAG_COLUMNS_WIDTH_STORAGE_KEY));
  });
  const [columnVisibility, setColumnVisibility] = useState<TagColumnVisibility>(() => {
    if (typeof window === "undefined") {
      return createDefaultColumnVisibility();
    }
    return parseStoredColumnVisibility(window.localStorage.getItem(TAG_COLUMN_VISIBILITY_STORAGE_KEY));
  });
  const [isDetailsResizeActive, setIsDetailsResizeActive] = useState(false);
  const [opcBrowseOpen, setOpcBrowseOpen] = useState(false);
  const [opcBrowserRect, setOpcBrowserRect] = useState<WorkbenchWindowRect>(() => {
    if (typeof window === "undefined") {
      return OPC_BROWSER_DEFAULT_RECT;
    }
    return parseStoredOpcBrowserRect(window.localStorage.getItem(OPC_BROWSER_RECT_STORAGE_KEY));
  });
  const [opcBrowserZIndex, setOpcBrowserZIndex] = useState(40);
  const [createSimulationRect, setCreateSimulationRect] = useState<WorkbenchWindowRect>(CREATE_SIMULATION_DEFAULT_RECT);
  const [createSimulationZIndex, setCreateSimulationZIndex] = useState(45);
  const [bulkSimulationRect, setBulkSimulationRect] = useState<WorkbenchWindowRect>(BULK_SIMULATION_DEFAULT_RECT);
  const [bulkSimulationZIndex, setBulkSimulationZIndex] = useState(44);
  const [opcBrowseDriverId, setOpcBrowseDriverId] = useState("");
  const [opcBrowseNodeId, setOpcBrowseNodeId] = useState(OPC_UA_BROWSE_ROOT_NODE_ID);
  const [opcBrowseSearch, setOpcBrowseSearch] = useState("");
  const [opcBrowseLoading, setOpcBrowseLoading] = useState(false);
  const [opcBrowseError, setOpcBrowseError] = useState<string | null>(null);
  const [opcBrowseNodes, setOpcBrowseNodes] = useState<OpcUaBrowseItem[]>([]);
  const [opcBrowseSelectedNodeIds, setOpcBrowseSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [opcBrowseMode, setOpcBrowseMode] = useState<"single" | "multi">("single");
  const [opcBrowseFocusNodeId, setOpcBrowseFocusNodeId] = useState("");
  const [opcBrowseHistory, setOpcBrowseHistory] = useState<string[]>([]);
  const [opcBrowsePreselectNodeId, setOpcBrowsePreselectNodeId] = useState<string | null>(null);
  const [opcImportSubtreeBusy, setOpcImportSubtreeBusy] = useState(false);
  const [opcImportSubtreeOverwrite, setOpcImportSubtreeOverwrite] = useState(false);
  const [opcImportSubtreeRootName, setOpcImportSubtreeRootName] = useState("");
  const [opcImportSubtreeScanRateMs, setOpcImportSubtreeScanRateMs] = useState(String(OPC_UA_IMPORT_SUBTREE_DEFAULT_SCAN_RATE));
  const [opcImportSubtreeMaxNodes, setOpcImportSubtreeMaxNodes] = useState(String(OPC_UA_IMPORT_SUBTREE_DEFAULT_MAX_NODES));
  const [opcReadLoading, setOpcReadLoading] = useState(false);
  const [bulkSimulationOpen, setBulkSimulationOpen] = useState(false);
  const [bulkSimulationMode, setBulkSimulationMode] = useState<SimulationBulkMode>("patch");
  const [bulkApplyFlags, setBulkApplyFlags] = useState<Record<BulkFieldKey, boolean>>(() => createBulkApplyFlags());
  const [bulkSimulationDraft, setBulkSimulationDraft] = useState<TagSimulationSettings>(() => createDefaultSimulationSettingsDraft("REAL"));
  const [bulkApplyToFiltered, setBulkApplyToFiltered] = useState(false);
  const [createSimulationOpen, setCreateSimulationOpen] = useState(false);
  const [createSimulationPrefix, setCreateSimulationPrefix] = useState("AI_SIM");
  const [createSimulationStartIndex, setCreateSimulationStartIndex] = useState(1);
  const [createSimulationCount, setCreateSimulationCount] = useState(100);
  const [createSimulationPadding, setCreateSimulationPadding] = useState(3);
  const [createSimulationDataType, setCreateSimulationDataType] = useState<TagDefinition["dataType"]>("REAL");
  const [createSimulationGroup, setCreateSimulationGroup] = useState("");
  const [createSimulationAddressPattern, setCreateSimulationAddressPattern] = useState("SIM.{index}");
  const [createSimulationDraft, setCreateSimulationDraft] = useState<TagSimulationSettings>(() => createDefaultSimulationSettingsDraft("REAL"));
  const [createSimulationDuplicateState, setCreateSimulationDuplicateState] = useState<{
    entries: GeneratedSimulationEntry[];
    duplicates: string[];
  } | null>(null);
  const [createSimulationDuplicateBusy, setCreateSimulationDuplicateBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const detailsWidthDraftRef = useRef(detailsWidth);

  if (!project) {
    return (
      <div className="screen-editor-window-content screen-editor-tags-window">
        <div className="screen-editor-empty-state">Project is not loaded</div>
      </div>
    );
  }

  const tags = project.tags ?? [];
  const drivers = project.drivers ?? [];
  const opcUaDrivers = useMemo(() => drivers.filter((driver) => driver.type === "opcua"), [drivers]);

  const groupOptions = useMemo(
    () => [...new Set(tags.map((tag) => tag.group).filter((value): value is string => Boolean(value)))],
    [tags],
  );
  const sourceFilterOptions = useMemo(
    () => {
      const available = new Set<TagSourceType>();
      for (const tag of tags) {
        available.add((tag.sourceType ?? "simulated") as TagSourceType);
      }
      return sourceTypeOptions.filter((option) => available.has(option.value));
    },
    [tags],
  );

  useEffect(() => {
    if (sourceFilter === "all") {
      return;
    }
    const exists = sourceFilterOptions.some((option) => option.value === sourceFilter);
    if (!exists) {
      setSourceFilter("all");
    }
  }, [sourceFilter, sourceFilterOptions]);

  const filteredTags = useMemo(
    () =>
      tags.filter((tag) => {
        if (search.trim()) {
          const term = search.trim().toLowerCase();
          const hit =
            tag.name.toLowerCase().includes(term) ||
            (tag.description ?? "").toLowerCase().includes(term) ||
            (tag.nodeId ?? "").toLowerCase().includes(term);
          if (!hit) {
            return false;
          }
        }
        if (sourceFilter !== "all" && (tag.sourceType ?? "simulated") !== sourceFilter) {
          return false;
        }
        if (driverFilter !== "all" && (tag.driverId ?? "") !== driverFilter) {
          return false;
        }
        if (groupFilter !== "all" && (tag.group ?? "") !== groupFilter) {
          return false;
        }
        return true;
      }),
    [driverFilter, groupFilter, search, sourceFilter, tags],
  );

  useEffect(() => {
    setPage(1);
  }, [search, sourceFilter, driverFilter, groupFilter]);

  useEffect(() => {
    setCreateSimulationDraft((prev) => normalizeSimulationForSave({
      ...prev,
      profile: coerceProfileForDataType(prev.profile, createSimulationDataType),
    }, createSimulationDataType));
  }, [createSimulationDataType]);

  const totalRows = filteredTags.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pageRows = useMemo(
    () => filteredTags.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredTags, pageSize, safePage],
  );

  const visibleColumns = useMemo(() => {
    const next = TAG_COLUMNS.filter((column) => columnVisibility[column.id] !== false);
    return next.length > 0 ? next : TAG_COLUMNS.filter((column) => column.id === "name");
  }, [columnVisibility]);

  const tagGridTemplateColumns = useMemo(
    () => visibleColumns.map((column) => `${columnWidths[column.id] ?? column.defaultWidth}px`).join(" "),
    [columnWidths, visibleColumns],
  );

  const selectedTag = tags.find((tag) => tagKey(tag) === selectedId) ?? filteredTags[0] ?? null;
  const sourceType = draftTag?.sourceType ?? "simulated";
  const draftSimulation = draftTag?.sourceType === "simulated" ? toSimulationSettings(draftTag) : undefined;
  const simulationDataType = draftTag?.dataType ?? "REAL";
  const isSimBool = isBoolType(simulationDataType);
  const isSimString = isStringType(simulationDataType);
  const isSimNumeric = isNumericType(simulationDataType);
  const simulationProfile = coerceProfileForDataType(draftSimulation?.profile, simulationDataType);
  const editorDriverOptions = drivers.filter((driver) => {
    if (sourceType === "opcua") {
      return driver.type === "opcua";
    }
    if (sourceType === "simulated") {
      return driver.type === "simulated";
    }
    return false;
  });
  const simulationDrivers = useMemo(
    () => drivers.filter((driver) => driver.type === "simulated"),
    [drivers],
  );
  const filteredTagKeys = useMemo(() => new Set(filteredTags.map((tag) => tagKey(tag))), [filteredTags]);
  const selectedFilteredTags = useMemo(
    () => filteredTags.filter((tag) => selectedTagKeys.has(tagKey(tag))),
    [filteredTags, selectedTagKeys],
  );
  const selectedSimulationTargets = useMemo(
    () => selectedFilteredTags.filter((tag) => (tag.sourceType ?? "simulated") === "simulated"),
    [selectedFilteredTags],
  );
  const createSimulationNamePreview = useMemo(() => {
    const prefix = createSimulationPrefix.trim() || "AI_SIM";
    const count = Math.max(0, Math.floor(createSimulationCount));
    const startIndex = Math.floor(createSimulationStartIndex);
    const padding = Math.max(0, Math.floor(createSimulationPadding));
    const entries = buildGeneratedSimulationEntries(prefix, startIndex, count, padding);
    const names = entries.slice(0, 6).map((entry) => entry.baseName);
    if (count > 6) {
      const tailStart = Math.max(0, count - 3);
      for (const entry of entries.slice(tailStart)) {
        names.push(entry.baseName);
      }
    }
    return names;
  }, [createSimulationCount, createSimulationPadding, createSimulationPrefix, createSimulationStartIndex]);

  useEffect(() => {
    const existingKeys = new Set(tags.map((tag) => tagKey(tag)));
    setSelectedTagKeys((prev) => {
      const next = new Set<string>();
      for (const key of prev) {
        if (existingKeys.has(key)) {
          next.add(key);
        }
      }
      return next;
    });
  }, [tags]);

  const saveTags = (nextTags: TagDefinition[]): void => {
    const previousTagNames = new Set((project.tags ?? []).map((tag) => tag.name));
    const nextTagNames = new Set(nextTags.map((tag) => tag.name));
    const deletedTagNames = [...previousTagNames].filter((name) => !nextTagNames.has(name));

    let nextProject = {
      ...project,
      tags: nextTags,
    };

    if (deletedTagNames.length > 0) {
      const reconciled = reconcileEventsAfterTagDeletion(nextProject, deletedTagNames);
      nextProject = reconciled.project;
      if (reconciled.changed) {
        void message.warning(
          `Event Manager: disabled ${reconciled.affectedEventCount} event(s) due to deleted source/security tags.`,
        );
      }
    }

    updateProjectJson(nextProject);
  };

  const browseOpcUaNodes = async (
    params?: { driverId?: string; nodeId?: string; search?: string },
  ): Promise<{ nodeId: string; nodes: OpcUaBrowseItem[] } | null> => {
    const driverId = params?.driverId ?? opcBrowseDriverId;
    const nodeId = params?.nodeId ?? opcBrowseNodeId;
    const searchValue = params?.search ?? opcBrowseSearch;
    if (!driverId) {
      setOpcBrowseError("Select OPC UA driver");
      setOpcBrowseNodes([]);
      return null;
    }

    setOpcBrowseLoading(true);
    setOpcBrowseError(null);
    try {
      const response = await api.opcUaBrowse({
        driverId,
        nodeId: nodeId || OPC_UA_BROWSE_ROOT_NODE_ID,
        search: searchValue.trim() ? searchValue.trim() : undefined,
      });
      setOpcBrowseDriverId(driverId);
      const resolvedNodeId = response.nodeId || nodeId || OPC_UA_BROWSE_ROOT_NODE_ID;
      const resolvedNodes = response.nodes ?? [];
      setOpcBrowseNodeId(resolvedNodeId);
      setOpcBrowseNodes(resolvedNodes);
      if (opcBrowsePreselectNodeId) {
        const preselected = resolvedNodes.find((node) => node.nodeId === opcBrowsePreselectNodeId);
        if (preselected) {
          setOpcBrowseSelectedNodeIds(new Set([preselected.nodeId]));
          setOpcBrowseFocusNodeId(preselected.nodeId);
        }
        setOpcBrowsePreselectNodeId(null);
      }
      return { nodeId: resolvedNodeId, nodes: resolvedNodes };
    } catch (error) {
      const text = error instanceof Error ? error.message : "Failed to browse OPC UA nodes";
      setOpcBrowseNodes([]);
      setOpcBrowseError(text);
      void message.error(text);
      return null;
    } finally {
      setOpcBrowseLoading(false);
    }
  };

  const closeOpcBrowseDialog = (): void => {
    setOpcBrowseOpen(false);
    setOpcBrowseError(null);
    setOpcBrowseLoading(false);
    setOpcImportSubtreeBusy(false);
    setOpcBrowseSelectedNodeIds(new Set());
    setOpcBrowseFocusNodeId("");
    setOpcBrowseHistory([]);
    setOpcBrowsePreselectNodeId(null);
  };

  const openOpcBrowseForTag = (): void => {
    if (!draftTag || draftTag.sourceType !== "opcua") {
      return;
    }
    const initialDriverId = draftTag.driverId ?? opcUaDrivers[0]?.id ?? "";
    if (!initialDriverId) {
      void message.warning("No OPC UA drivers configured");
      return;
    }
    const targetNodeId = draftTag.nodeId?.trim() ?? "";
    const initialNodeId = targetNodeId
      ? getOpcUaParentNodeId(targetNodeId) ?? OPC_UA_BROWSE_ROOT_NODE_ID
      : OPC_UA_BROWSE_ROOT_NODE_ID;
    setOpcBrowseMode("single");
    setOpcBrowseDriverId(initialDriverId);
    setOpcBrowseNodeId(initialNodeId);
    setOpcBrowseSearch("");
    setOpcBrowseNodes([]);
    setOpcBrowseSelectedNodeIds(new Set());
    setOpcBrowseFocusNodeId("");
    setOpcBrowseHistory([]);
    setOpcBrowsePreselectNodeId(targetNodeId || null);
    setOpcImportSubtreeOverwrite(false);
    setOpcImportSubtreeRootName("");
    setOpcImportSubtreeScanRateMs(String(OPC_UA_IMPORT_SUBTREE_DEFAULT_SCAN_RATE));
    setOpcImportSubtreeMaxNodes(String(OPC_UA_IMPORT_SUBTREE_DEFAULT_MAX_NODES));
    setOpcBrowserZIndex((value) => value + 1);
    setOpcBrowseOpen(true);
    void browseOpcUaNodes({ driverId: initialDriverId, nodeId: initialNodeId, search: "" });
  };

  const openOpcBrowseImport = (): void => {
    const initialDriverId = opcUaDrivers[0]?.id ?? "";
    if (!initialDriverId) {
      void message.warning("No OPC UA drivers configured");
      return;
    }
    setOpcBrowseMode("multi");
    setOpcBrowseDriverId(initialDriverId);
    setOpcBrowseNodeId(OPC_UA_BROWSE_ROOT_NODE_ID);
    setOpcBrowseSearch("");
    setOpcBrowseNodes([]);
    setOpcBrowseSelectedNodeIds(new Set());
    setOpcBrowseFocusNodeId("");
    setOpcBrowseHistory([]);
    setOpcBrowsePreselectNodeId(null);
    setOpcImportSubtreeOverwrite(false);
    setOpcImportSubtreeRootName("");
    setOpcImportSubtreeScanRateMs(String(OPC_UA_IMPORT_SUBTREE_DEFAULT_SCAN_RATE));
    setOpcImportSubtreeMaxNodes(String(OPC_UA_IMPORT_SUBTREE_DEFAULT_MAX_NODES));
    setOpcImportSubtreeBusy(false);
    setOpcBrowserZIndex((value) => value + 1);
    setOpcBrowseOpen(true);
    void browseOpcUaNodes({ driverId: initialDriverId, nodeId: OPC_UA_BROWSE_ROOT_NODE_ID, search: "" });
  };

  const deleteOpcUaTagsForSelectedDriver = async (): Promise<void> => {
    if (sourceFilter !== "opcua" || driverFilter === "all") {
      void message.warning("Select source OPC UA and a specific driver first");
      return;
    }
    const driverId = driverFilter;
    const driver = drivers.find((item) => item.id === driverId && item.type === "opcua");
    if (!driver) {
      void message.warning(`OPC UA driver ${driverId} is not found`);
      return;
    }
    try {
      const impact = await api.getOpcUaDriverImpact(driverId);
      const tagsText = impact.tagNamesPreview.length > 0 ? `\n${impact.tagNamesPreview.join("\n")}` : "\nNone";
      const accepted = window.confirm(
        `Delete OPC UA tags for driver ${driver.name ?? driver.id} (${driver.id})?\n`
        + `Tags: ${impact.tagCount}\n`
        + `Affected macros: ${impact.affectedMacroCount}\n`
        + `Dynamic macros: ${impact.dynamicMacroCount}\n`
        + `Tags preview:${tagsText}\n\n`
        + "Affected macros will be marked invalid and excluded from execution.",
      );
      if (!accepted) {
        return;
      }
      const response = await api.deleteOpcUaTagsByDriver(driverId);
      await Promise.all([loadProject(), loadTags(), loadDrivers(), loadMacros()]);
      void message.success(`Deleted ${response.deletedTags} OPC UA tags for ${driver.name ?? driver.id}`);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to delete OPC UA tags for driver");
    }
  };

  const applyOpcUaNodeToDraft = (node: OpcUaBrowseItem): void => {
    if (!draftTag) {
      return;
    }
    setDraftTag((prev) => {
      if (!prev) {
        return prev;
      }
      const generatedBaseName = makeTagNameFromOpcNode(node);
      const generatedName = makeUniqueTagName(
        generatedBaseName,
        tags.filter((item) => !editingId || tagKey(item) !== editingId),
      );
      const isNewTag = editorMode === "add";
      return {
        ...prev,
        sourceType: "opcua",
        driverId: opcBrowseDriverId || prev.driverId,
        nodeId: node.nodeId,
        address: { nodeId: node.nodeId },
        name: isNewTag && !prev.name.trim() ? generatedName : prev.name,
        description: prev.description?.trim() ? prev.description : (node.displayName || node.browseName || prev.description),
        dataType: mapOpcUaDataTypeToTagDataType(node.dataType),
        writable: node.writable ?? prev.writable ?? false,
        scanRateMs: prev.scanRateMs ?? 500,
      };
    });
    closeOpcBrowseDialog();
  };

  const importSelectedOpcUaNodes = (): void => {
    if (!opcBrowseDriverId) {
      void message.error("Select OPC UA driver");
      return;
    }
    const selectedNodes = opcBrowseNodes.filter((node) => opcBrowseSelectedNodeIds.has(node.nodeId) && !node.hasChildren);
    if (!selectedNodes.length) {
      void message.warning("Select at least one leaf variable node");
      return;
    }

    const existingNodeKeySet = new Set(
      tags
        .filter((tag) => tag.sourceType === "opcua")
        .map((tag) => `${tag.driverId ?? ""}::${tag.nodeId ?? ""}`),
    );
    const reservedNames = new Set(tags.map((tag) => tag.name));
    const nextTags = [...tags];
    let skipped = 0;

    for (const node of selectedNodes) {
      const nodeKey = `${opcBrowseDriverId}::${node.nodeId}`;
      if (existingNodeKeySet.has(nodeKey)) {
        skipped += 1;
        continue;
      }
      const baseName = makeTagNameFromOpcNode(node);
      const uniqueName = makeUniqueTagName(baseName, tags, reservedNames);
      reservedNames.add(uniqueName);
      existingNodeKeySet.add(nodeKey);
      const stamp = nowIso();
      nextTags.push({
        id: createId(),
        name: uniqueName,
        description: node.displayName || node.browseName || undefined,
        sourceType: "opcua",
        dataType: mapOpcUaDataTypeToTagDataType(node.dataType),
        driverId: opcBrowseDriverId,
        nodeId: node.nodeId,
        address: { nodeId: node.nodeId },
        writable: Boolean(node.writable),
        scanRateMs: 500,
        createdAt: stamp,
        updatedAt: stamp,
      });
    }

    if (nextTags.length === tags.length) {
      void message.warning(skipped > 0 ? `Skipped ${skipped} already imported nodes` : "Nothing imported");
      return;
    }

    saveTags(nextTags);
    const lastImportedTag = nextTags[nextTags.length - 1];
    if (lastImportedTag) {
      setSelectedId(tagKey(lastImportedTag));
    }
    closeOpcBrowseDialog();
    if (skipped > 0) {
      void message.warning(`Imported ${nextTags.length - tags.length} nodes. Skipped ${skipped} already imported nodes`);
    } else {
      void message.success(`Imported ${nextTags.length - tags.length} OPC UA tags`);
    }
  };

  const resolveOpcBrowseSelectionForSubtree = (): OpcUaBrowseItem | null => {
    if (opcBrowseFocusNodeId) {
      const focused = opcBrowseNodes.find((node) => node.nodeId === opcBrowseFocusNodeId);
      if (focused) {
        return focused;
      }
    }
    const selectedNodeId = [...opcBrowseSelectedNodeIds][0];
    if (!selectedNodeId) {
      return null;
    }
    return opcBrowseNodes.find((node) => node.nodeId === selectedNodeId) ?? null;
  };

  const importOpcUaSubtree = async (): Promise<void> => {
    if (!opcBrowseDriverId) {
      void message.error("Select OPC UA driver");
      return;
    }
    const selectedNode = resolveOpcBrowseSelectionForSubtree();
    if (!selectedNode) {
      void message.warning("Select a folder/structure node first");
      return;
    }
    if (!selectedNode.hasChildren) {
      void message.warning("Import Subtree is available only for nodes with children");
      return;
    }

    const maxNodes = toOptionalNumber(opcImportSubtreeMaxNodes) ?? OPC_UA_IMPORT_SUBTREE_DEFAULT_MAX_NODES;
    const scanRateMs = toOptionalNumber(opcImportSubtreeScanRateMs) ?? OPC_UA_IMPORT_SUBTREE_DEFAULT_SCAN_RATE;
    const rootName = opcImportSubtreeRootName.trim() || selectedNode.browseName || selectedNode.displayName;

    setOpcImportSubtreeBusy(true);
    try {
      const response = await api.opcUaImportSubtree({
        driverId: opcBrowseDriverId,
        nodeId: selectedNode.nodeId,
        rootName,
        overwrite: opcImportSubtreeOverwrite,
        scanRateMs,
        maxNodes,
      });
      await Promise.all([loadProject(), loadTags()]);
      void message.success(`Imported ${response.created} tags, updated ${response.updated}, scanned ${response.scanned}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Failed to import OPC UA subtree";
      void message.error(text);
    } finally {
      setOpcImportSubtreeBusy(false);
    }
  };

  const readOpcUaNodeTest = async (): Promise<void> => {
    if (!draftTag?.driverId || !draftTag.nodeId?.trim()) {
      void message.warning("Select driver and NodeId first");
      return;
    }
    setOpcReadLoading(true);
    try {
      const result = await api.opcUaRead({
        driverId: draftTag.driverId,
        nodeId: draftTag.nodeId.trim(),
      });
      setDraftTag((prev) =>
        prev
          ? {
              ...prev,
              dataType: mapOpcUaDataTypeToTagDataType(result.dataType),
            }
          : prev,
      );
      void message.success(`Read OK (${result.quality})`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Read failed";
      void message.error(text);
    } finally {
      setOpcReadLoading(false);
    }
  };

  const toggleOpcBrowseNodeSelection = (nodeId: string): void => {
    setOpcBrowseSelectedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const openOpcBrowseNode = (node: OpcUaBrowseItem): void => {
    if (!canBrowseOpcNode(node)) {
      if (opcBrowseMode === "single") {
        applyOpcUaNodeToDraft(node);
        return;
      }
      setOpcBrowseFocusNodeId(node.nodeId);
      toggleOpcBrowseNodeSelection(node.nodeId);
      return;
    }
    const currentNodeId = opcBrowseNodeId || OPC_UA_BROWSE_ROOT_NODE_ID;
    if (node.nodeId !== currentNodeId) {
      setOpcBrowseHistory((prev) =>
        prev[prev.length - 1] === currentNodeId ? prev : [...prev, currentNodeId],
      );
    }
    setOpcBrowseNodeId(node.nodeId);
    void browseOpcUaNodes({ nodeId: node.nodeId });
  };

  const goBackOpcNode = (): void => {
    const previousNodeId = opcBrowseHistory[opcBrowseHistory.length - 1];
    if (!previousNodeId) {
      return;
    }
    setOpcBrowseHistory((prev) => prev.slice(0, -1));
    setOpcBrowseNodeId(previousNodeId);
    void browseOpcUaNodes({ nodeId: previousNodeId });
  };

  const goUpOpcNode = (): void => {
    const currentNodeId = opcBrowseNodeId || OPC_UA_BROWSE_ROOT_NODE_ID;
    const parentNodeId = getOpcUaParentNodeId(currentNodeId);
    if (!parentNodeId) {
      return;
    }
    setOpcBrowseHistory((prev) =>
      prev[prev.length - 1] === currentNodeId ? prev : [...prev, currentNodeId],
    );
    setOpcBrowseNodeId(parentNodeId);
    void browseOpcUaNodes({ nodeId: parentNodeId });
  };

  const goRootOpcNode = (): void => {
    setOpcBrowseHistory([]);
    setOpcBrowseNodeId(OPC_UA_BROWSE_ROOT_NODE_ID);
    void browseOpcUaNodes({ nodeId: OPC_UA_BROWSE_ROOT_NODE_ID });
  };

  const opcBrowseParentNodeId = getOpcUaParentNodeId(opcBrowseNodeId || OPC_UA_BROWSE_ROOT_NODE_ID);
  const selectedOpcBrowseNodeForSubtree = resolveOpcBrowseSelectionForSubtree();
  const canImportOpcBrowseSubtree = Boolean(selectedOpcBrowseNodeForSubtree?.hasChildren);

  const focusOpcBrowserWindow = useCallback(() => {
    setOpcBrowserZIndex((value) => value + 1);
  }, []);

  const focusCreateSimulationWindow = useCallback(() => {
    setCreateSimulationZIndex((value) => value + 1);
  }, []);

  const focusBulkSimulationWindow = useCallback(() => {
    setBulkSimulationZIndex((value) => value + 1);
  }, []);

  const handleOpcDriverChange = (nextDriverId: string): void => {
    setOpcBrowseDriverId(nextDriverId);
    setOpcBrowseNodeId(OPC_UA_BROWSE_ROOT_NODE_ID);
    setOpcBrowseSelectedNodeIds(new Set());
    setOpcBrowseFocusNodeId("");
    setOpcBrowseHistory([]);
    setOpcBrowsePreselectNodeId(null);
    void browseOpcUaNodes({
      driverId: nextDriverId,
      nodeId: OPC_UA_BROWSE_ROOT_NODE_ID,
      search: "",
    });
  };

  const handleOpcNodeRowClick = (node: OpcUaBrowseItem): void => {
    setOpcBrowseFocusNodeId(node.nodeId);
    if (opcBrowseMode === "multi") {
      toggleOpcBrowseNodeSelection(node.nodeId);
      return;
    }
    setOpcBrowseSelectedNodeIds(new Set([node.nodeId]));
  };

  const handleOpcNodeRowDoubleClick = (node: OpcUaBrowseItem): void => {
    if (canBrowseOpcNode(node)) {
      openOpcBrowseNode(node);
      return;
    }
    if (opcBrowseMode === "single") {
      applyOpcUaNodeToDraft(node);
      return;
    }
    toggleOpcBrowseNodeSelection(node.nodeId);
  };

  const handleOpcLeafSelect = (node: OpcUaBrowseItem): void => {
    if (opcBrowseMode === "single") {
      applyOpcUaNodeToDraft(node);
      return;
    }
    setOpcBrowseFocusNodeId(node.nodeId);
    toggleOpcBrowseNodeSelection(node.nodeId);
  };

  const confirmSingleOpcNodeSelection = (): void => {
    const selectedNodeId = [...opcBrowseSelectedNodeIds][0];
    const selectedNode = opcBrowseNodes.find((node) => node.nodeId === selectedNodeId);
    if (!selectedNode) {
      void message.warning("Select a node");
      return;
    }
    applyOpcUaNodeToDraft(selectedNode);
  };

  const openAdd = (): void => {
    setDraftTag(createDefaultDraft());
    setEditingId(null);
    setEditorMode("add");
    setPendingDeleteTagId(null);
  };

  const openEdit = (tag: TagDefinition): void => {
    const key = tagKey(tag);
    const draft = structuredClone(tag);
    const normalizedDraft = draft.sourceType === "simulated"
      ? {
        ...draft,
        simulation: toSimulationSettings(draft),
      }
      : draft;
    setSelectedId(key);
    setEditingId(key);
    setDraftTag(normalizedDraft);
    setEditorMode("edit");
    setPendingDeleteTagId(null);
  };

  const cancelEditor = (): void => {
    setDraftTag(null);
    setEditingId(null);
    setEditorMode("view");
  };

  const applySaveDraft = (): void => {
    if (!draftTag) {
      return;
    }
    let normalized = normalizeDraft(draftTag, editorMode === "edit");

    if (!normalized.name) {
      void message.error("Tag name is required");
      return;
    }

    if (normalized.sourceType === "opcua" && (!normalized.driverId || !normalized.nodeId?.trim())) {
      void message.error("OPC UA tag requires driver and NodeId");
      return;
    }
    if (normalized.sourceType === "lw" && typeof normalized.lwAddress !== "number") {
      void message.error("LW tag requires LW Address");
      return;
    }
    if (normalized.sourceType === "internal" && !normalized.internalVariableName?.trim()) {
      void message.error("Internal tag requires Internal Variable Name");
      return;
    }
    if (normalized.sourceType === "simulated") {
      const simulation = {
        ...toSimulationSettings(normalized),
        profile: coerceProfileForDataType(normalized.simulation?.profile, normalized.dataType),
      };
      if (typeof simulation.updateIntervalMs === "number" && simulation.updateIntervalMs < SIMULATION_MIN_INTERVAL_MS) {
        void message.error(`Simulation interval must be at least ${SIMULATION_MIN_INTERVAL_MS} ms`);
        return;
      }
      if (isNumericType(normalized.dataType)) {
        if (typeof simulation.min === "number" && typeof simulation.max === "number" && simulation.min > simulation.max) {
          void message.error("Simulation Min must be less than or equal to Max");
          return;
        }
        if (typeof simulation.noise?.amplitude === "number" && simulation.noise.amplitude < 0) {
          void message.error("Simulation Noise amplitude must be greater than or equal to 0");
          return;
        }
        if (typeof simulation.ramp?.step === "number" && simulation.ramp.step < 0) {
          void message.error("Simulation Step must be greater than or equal to 0");
          return;
        }
        if (simulation.profile === "ramp" && typeof simulation.ramp?.step === "number" && simulation.ramp.step <= 0) {
          void message.error("Ramp mode requires Step greater than 0");
          return;
        }
      }
      normalized = syncLegacySimulationAddress({
        ...normalized,
        simulation,
      });
    }

    const duplicate = tags.some(
      (tag) =>
        tag.name === normalized.name &&
        tagKey(tag) !== (editingId ?? ""),
    );
    if (duplicate) {
      void message.error("Tag name must be unique");
      return;
    }

    const nextTags =
      editorMode === "edit" && editingId
        ? tags.map((tag) => (tagKey(tag) === editingId ? normalized : tag))
        : [...tags, normalized];

    saveTags(nextTags);
    setSelectedId(tagKey(normalized));
    setDraftTag(null);
    setEditingId(null);
    setEditorMode("view");
    setPendingDeleteTagId(null);
  };

  const requestDeleteSelected = (): void => {
    if (!selectedTag) {
      return;
    }
    setPendingDeleteTagId(tagKey(selectedTag));
  };

  const deleteCheckedTags = (): void => {
    if (selectedTagKeys.size === 0) {
      void message.warning("No selected tags");
      return;
    }
    const count = selectedTagKeys.size;
    const ok = window.confirm(`Delete ${count} selected tag(s)?`);
    if (!ok) {
      return;
    }
    const nextTags = tags.filter((tag) => !selectedTagKeys.has(tagKey(tag)));
    saveTags(nextTags);
    setSelectedTagKeys(new Set());
    setPendingDeleteTagId(null);
    if (!selectedId || selectedTagKeys.has(selectedId)) {
      const nextSelected = nextTags[0];
      setSelectedId(nextSelected ? tagKey(nextSelected) : null);
    }
    setDraftTag(null);
    setEditingId(null);
    setEditorMode("view");
    void message.success(`Deleted ${count} tag(s)`);
  };

  const confirmDelete = (): void => {
    if (!pendingDeleteTagId) {
      return;
    }
    const nextTags = tags.filter((tag) => tagKey(tag) !== pendingDeleteTagId);
    saveTags(nextTags);
    setPendingDeleteTagId(null);
    if (selectedId === pendingDeleteTagId) {
      const nextSelected = nextTags[0];
      setSelectedId(nextSelected ? tagKey(nextSelected) : null);
    }
    setDraftTag(null);
    setEditingId(null);
    setEditorMode("view");
  };

  const duplicateTag = (tag: TagDefinition): void => {
    let nextName = `${tag.name}_copy`;
    let suffix = 1;
    while (tags.some((item) => item.name === nextName)) {
      suffix += 1;
      nextName = `${tag.name}_copy_${suffix}`;
    }
    const duplicated: TagDefinition = {
      ...tag,
      id: createId(),
      name: nextName,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const nextTags = [...tags, duplicated];
    saveTags(nextTags);
    setSelectedId(tagKey(duplicated));
  };

  const toggleTagSelection = (key: string): void => {
    setSelectedTagKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSelectAllFiltered = (): void => {
    setSelectedTagKeys((prev) => {
      const next = new Set(prev);
      const allSelected = filteredTags.length > 0 && filteredTags.every((tag) => next.has(tagKey(tag)));
      if (allSelected) {
        for (const tag of filteredTags) {
          next.delete(tagKey(tag));
        }
      } else {
        for (const tag of filteredTags) {
          next.add(tagKey(tag));
        }
      }
      return next;
    });
  };

  const openBulkSimulationDialog = (): void => {
    const source = selectedSimulationTargets[0] ?? filteredTags.find((tag) => (tag.sourceType ?? "simulated") === "simulated");
    if (source) {
      setBulkSimulationDraft(toSimulationSettings(source));
    } else {
      setBulkSimulationDraft(createDefaultSimulationSettingsDraft("REAL"));
    }
    setBulkApplyFlags(createBulkApplyFlags());
    setBulkSimulationMode("patch");
    setBulkApplyToFiltered(false);
    setBulkSimulationZIndex((value) => value + 1);
    setBulkSimulationOpen(true);
  };

  const openCreateSimulationWindow = (): void => {
    setCreateSimulationZIndex((value) => value + 1);
    setCreateSimulationDuplicateState(null);
    setCreateSimulationOpen(true);
  };

  const applyBulkSimulation = (): void => {
    const selectedKeys = bulkApplyToFiltered ? filteredTagKeys : selectedTagKeys;
    const targets = tags.filter((tag) => selectedKeys.has(tagKey(tag)) && (tag.sourceType ?? "simulated") === "simulated");
    if (targets.length === 0) {
      void message.warning("Select simulated tags or enable Apply to filtered tags");
      return;
    }

    const applySingle = (tag: TagDefinition): TagDefinition => {
      const current = toSimulationSettings(tag);
      let next = bulkSimulationMode === "replace"
        ? normalizeSimulationForSave(structuredClone(bulkSimulationDraft), tag.dataType)
        : structuredClone(current);

      if (bulkSimulationMode !== "replace") {
        for (const fieldKey of BULK_FIELD_KEYS) {
          if (!bulkApplyFlags[fieldKey]) {
            continue;
          }
          const incoming = getSimulationFieldValue(bulkSimulationDraft, fieldKey);
          if (bulkSimulationMode === "fillEmpty") {
            const existing = getSimulationFieldValue(next, fieldKey);
            if (!isEmptyBulkValue(existing)) {
              continue;
            }
          }
          next = setSimulationFieldValue(next, fieldKey, incoming);
        }
      }

      next.initialValue = coerceInitialValueByDataType(next.initialValue, tag.dataType);
      next = normalizeSimulationForSave(next, tag.dataType);
      return syncLegacySimulationAddress({
        ...tag,
        simulation: next,
      });
    };

    const nextTags = tags.map((tag) => (
      selectedKeys.has(tagKey(tag)) && (tag.sourceType ?? "simulated") === "simulated"
        ? applySingle(tag)
        : tag
    ));
    saveTags(nextTags);
    setBulkSimulationOpen(false);
    void message.success(`Applied simulation profile to ${targets.length} tag(s)`);
  };

  const commitCreateSimulationTags = async (
    entries: GeneratedSimulationEntry[],
    mode: "strict" | CreateSimulationDuplicateMode,
  ): Promise<void> => {
    const defaultDriverId = simulationDrivers[0]?.id;
    const simulationSettings = normalizeSimulationForSave({
      ...structuredClone(createSimulationDraft),
      initialValue: coerceInitialValueByDataType(createSimulationDraft.initialValue, createSimulationDataType),
    }, createSimulationDataType);
    const group = createSimulationGroup.trim() || undefined;
    const addressPattern = createSimulationAddressPattern.trim();
    const now = nowIso();

    const buildTag = (name: string, indexText: string): TagDefinition => {
      const addressRaw = addressPattern
        ? addressPattern.replaceAll("{index}", indexText).replaceAll("{name}", name)
        : name;
      return syncLegacySimulationAddress({
        id: createId(),
        name,
        description: "",
        sourceType: "simulated",
        dataType: createSimulationDataType,
        driverId: defaultDriverId,
        group,
        writable: false,
        scanRateMs: simulationSettings.updateIntervalMs,
        address: addressRaw ? { raw: addressRaw } : undefined,
        simulation: simulationSettings,
        createdAt: now,
        updatedAt: now,
      });
    };

    const nextTags = [...tags];
    const indexByName = new Map<string, number>();
    for (let index = 0; index < nextTags.length; index += 1) {
      indexByName.set(nextTags[index]!.name, index);
    }
    const usedNames = new Set(nextTags.map((tag) => tag.name));
    let createdCount = 0;
    let overwrittenCount = 0;
    let renamedCount = 0;
    let lastName = "";

    for (const entry of entries) {
      let targetName = entry.baseName;
      if (mode === "suffix") {
        const resolvedName = nextNameWithSuffix(entry.baseName, usedNames);
        if (resolvedName !== entry.baseName) {
          renamedCount += 1;
        }
        targetName = resolvedName;
      } else if (!usedNames.has(targetName)) {
        usedNames.add(targetName);
      }

      const existingIndex = indexByName.get(targetName);
      if (existingIndex !== undefined) {
        if (mode === "overwrite") {
          const existing = nextTags[existingIndex]!;
          const generated = buildTag(targetName, entry.indexText);
          nextTags[existingIndex] = syncLegacySimulationAddress({
            ...generated,
            id: existing.id,
            createdAt: existing.createdAt ?? now,
            updatedAt: nowIso(),
          });
          overwrittenCount += 1;
          lastName = targetName;
        }
        continue;
      }

      const nextTag = buildTag(targetName, entry.indexText);
      nextTags.push(nextTag);
      indexByName.set(targetName, nextTags.length - 1);
      createdCount += 1;
      lastName = targetName;
    }

    saveTags(nextTags);
    if (lastName) {
      const lastTag = nextTags.find((tag) => tag.name === lastName);
      setSelectedId(lastTag ? tagKey(lastTag) : null);
    }
    setCreateSimulationOpen(false);
    setCreateSimulationDuplicateState(null);

    try {
      await saveProject();
      void message.success(
        `Simulation tags updated: created ${createdCount}, overwritten ${overwrittenCount}, renamed ${renamedCount}`,
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : "Failed to save project";
      void message.warning(
        `Simulation tags created locally, but project was not saved: ${text}`,
      );
    }
  };

  const resolveCreateSimulationDuplicates = async (mode: CreateSimulationDuplicateMode): Promise<void> => {
    if (!createSimulationDuplicateState) {
      return;
    }
    setCreateSimulationDuplicateBusy(true);
    try {
      await commitCreateSimulationTags(createSimulationDuplicateState.entries, mode);
    } finally {
      setCreateSimulationDuplicateBusy(false);
    }
  };

  const applyCreateSimulationTags = async (): Promise<void> => {
    const prefix = createSimulationPrefix.trim();
    const count = Math.max(0, Math.floor(createSimulationCount));
    const startIndex = Math.floor(createSimulationStartIndex);
    const padding = Math.max(0, Math.floor(createSimulationPadding));
    if (!prefix) {
      void message.error("Prefix is required");
      return;
    }
    if (count <= 0) {
      void message.error("Count must be greater than 0");
      return;
    }
    if (count > SIMULATION_BULK_CREATE_LIMIT) {
      void message.error(`Count exceeds limit (${SIMULATION_BULK_CREATE_LIMIT})`);
      return;
    }
    const entries = buildGeneratedSimulationEntries(prefix, startIndex, count, padding);
    const existing = new Set(tags.map((tag) => tag.name));
    const duplicates = entries
      .map((entry) => entry.baseName)
      .filter((name) => existing.has(name));
    if (duplicates.length > 0) {
      setCreateSimulationDuplicateState({ entries, duplicates });
      return;
    }
    await commitCreateSimulationTags(entries, "strict");
  };

  const exportCsv = (): void => {
    const header = [
      "name",
      "description",
      "sourceType",
      "dataType",
      "driverId",
      "nodeId",
      "area",
      "address",
      "bit",
      "scale",
      "offset",
      "unit",
      "writable",
      "scanRateMs",
      "group",
      "internalVariableName",
      "lwAddress",
      "persistent",
      "simulation",
    ];
    const rows = tags.map((tag) => [
      tag.name,
      tag.description ?? "",
      tag.sourceType ?? "simulated",
      tag.dataType,
      tag.driverId ?? "",
      tag.nodeId ?? "",
      tag.area ?? "",
      tag.address ? JSON.stringify(tag.address) : tag.lwAddress ?? tag.internalVariableName ?? "",
      tag.bit ?? "",
      tag.scale ?? "",
      tag.offset ?? "",
      tag.unit ?? "",
      tag.writable ? "1" : "0",
      tag.scanRateMs ?? "",
      tag.group ?? "",
      tag.internalVariableName ?? "",
      tag.lwAddress ?? "",
      tag.persistent ? "1" : "0",
      tag.simulation ? JSON.stringify(tag.simulation) : "",
    ]);

    const csv = [header, ...rows]
      .map((line) =>
        line
          .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tags.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (!lines.length) {
        return;
      }
      const headers = parseCsv(lines[0] ?? "").map((header) => header.trim());
      const rows = lines.slice(1).map((line) => parseCsv(line));
      const imported = rows
        .map((cells): TagDefinition => {
          const map = new Map<string, string>();
          headers.forEach((header, index) => {
            map.set(header, cells[index] ?? "");
          });
          const sourceType = (map.get("sourceType") as TagSourceType | undefined) ?? "simulated";
          const lwAddressRaw = map.get("lwAddress") ?? map.get("address");
          const lwAddress = lwAddressRaw ? Number(lwAddressRaw) : undefined;
          const internalFromCell = map.get("internalVariableName") || (sourceType === "internal" ? map.get("address") : undefined);
          const simulationRaw = map.get("simulation")?.trim();
          const simulation = simulationRaw ? (() => {
            try {
              return JSON.parse(simulationRaw) as TagSimulationSettings;
            } catch {
              return undefined;
            }
          })() : undefined;
          const importedTag: TagDefinition = {
            id: createId(),
            name: map.get("name")?.trim() ?? "",
            description: map.get("description") || undefined,
            sourceType,
            dataType: (map.get("dataType") as TagDefinition["dataType"]) ?? "REAL",
            driverId: map.get("driverId") || undefined,
            nodeId: map.get("nodeId") || undefined,
            area: (map.get("area") as TagDefinition["area"]) || undefined,
            address:
              sourceType === "modbus" || sourceType === "simulated"
                ? parseAddressCell(map.get("address"))
                : undefined,
            bit: map.get("bit") ? Number(map.get("bit")) : undefined,
            scale: map.get("scale") ? Number(map.get("scale")) : undefined,
            offset: map.get("offset") ? Number(map.get("offset")) : undefined,
            unit: map.get("unit") || undefined,
            writable: map.get("writable") === "1" || map.get("writable")?.toLowerCase() === "true",
            scanRateMs: map.get("scanRateMs") ? Number(map.get("scanRateMs")) : undefined,
            group: map.get("group") || undefined,
            lwAddress: Number.isFinite(lwAddress) ? lwAddress : undefined,
            internalVariableName: internalFromCell || undefined,
            persistent: map.get("persistent") === "1" || map.get("persistent")?.toLowerCase() === "true",
            simulation,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
          if (sourceType === "simulated") {
            importedTag.simulation = simulation ?? toSimulationSettings(importedTag);
            return syncLegacySimulationAddress(importedTag);
          }
          return importedTag;
        })
        .filter((tag) => tag.name);

      saveTags(imported);
      setSelectedId(imported[0] ? tagKey(imported[0]) : null);
      cancelEditor();
      setPendingDeleteTagId(null);
      void message.success(`Imported ${imported.length} tags`);
    };
    reader.readAsText(file);
  };

  const onImportClick = (): void => {
    importInputRef.current?.click();
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TAG_DETAILS_WIDTH_STORAGE_KEY, String(detailsWidth));
  }, [detailsWidth]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TAG_COLUMNS_WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TAG_COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibility));
  }, [columnVisibility]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TAG_PAGE_SIZE_STORAGE_KEY, String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(OPC_BROWSER_RECT_STORAGE_KEY, JSON.stringify(opcBrowserRect));
  }, [opcBrowserRect]);

  useEffect(() => {
    detailsWidthDraftRef.current = detailsWidth;
    bodyRef.current?.style.setProperty("--tags-details-width", `${detailsWidth}px`);
  }, [detailsWidth]);

  const startDetailsResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = detailsWidth;

    const onMove = (moveEvent: MouseEvent): void => {
      const delta = startX - moveEvent.clientX;
      const next = clampDetailsWidth(startWidth + delta);
      detailsWidthDraftRef.current = next;
      bodyRef.current?.style.setProperty("--tags-details-width", `${next}px`);
    };

    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsDetailsResizeActive(false);
      setDetailsWidth(detailsWidthDraftRef.current);
    };

    detailsWidthDraftRef.current = startWidth;
    setIsDetailsResizeActive(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [detailsWidth]);

  const startColumnResize = useCallback((
    event: React.MouseEvent<HTMLSpanElement>,
    columnId: TagColumnId,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const column = TAG_COLUMNS.find((item) => item.id === columnId);
    if (!column) {
      return;
    }

    const startX = event.clientX;
    const startWidth = columnWidths[columnId] ?? column.defaultWidth;

    const onMove = (moveEvent: MouseEvent): void => {
      const delta = moveEvent.clientX - startX;
      const next = Math.max(column.minWidth, startWidth + delta);
      setColumnWidths((prev) => ({
        ...prev,
        [columnId]: next,
      }));
    };

    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [columnWidths]);

  const resetWidths = useCallback(() => {
    setDetailsWidth(DEFAULT_DETAILS_WIDTH);
    setColumnWidths(createDefaultColumnWidths());
  }, []);

  return (
    <div className="screen-editor-window-content screen-editor-tags-window">
      <div className="screen-editor-tags-window__toolbar">
        <WorkbenchButton variant="primary" onClick={openAdd}>
          Add Tag
        </WorkbenchButton>
        <WorkbenchButton
          onClick={() => selectedTag && duplicateTag(selectedTag)}
          disabled={!selectedTag}
        >
          Duplicate
        </WorkbenchButton>
        <WorkbenchButton
          variant="danger"
          onClick={requestDeleteSelected}
          disabled={!selectedTag}
        >
          Delete
        </WorkbenchButton>
        <WorkbenchButton
          variant="danger"
          onClick={deleteCheckedTags}
          disabled={selectedTagKeys.size === 0}
        >
          Delete Selected
        </WorkbenchButton>
        <WorkbenchButton onClick={exportCsv} disabled={tags.length === 0}>
          Export CSV
        </WorkbenchButton>
        <WorkbenchButton onClick={onImportClick}>
          Import CSV
        </WorkbenchButton>
        <WorkbenchButton onClick={openOpcBrowseImport} disabled={opcUaDrivers.length === 0}>
          Import from OPC UA
        </WorkbenchButton>
        <WorkbenchButton onClick={openBulkSimulationDialog}>
          Apply Simulation Profile
        </WorkbenchButton>
        <WorkbenchButton onClick={openCreateSimulationWindow}>
          Create Simulation Tags
        </WorkbenchButton>
        <WorkbenchButton
          variant="danger"
          onClick={() => void deleteOpcUaTagsForSelectedDriver()}
          disabled={sourceFilter !== "opcua" || driverFilter === "all"}
        >
          Delete OPC UA Tags (Driver)
        </WorkbenchButton>
        <WorkbenchButton onClick={() => void saveProject({ notify: true })}>
          Save Project
        </WorkbenchButton>
        <WorkbenchButton onClick={resetWidths}>
          Reset Widths
        </WorkbenchButton>
        <WorkbenchButton onClick={() => setColumnsPanelOpen((open) => !open)}>
          Columns
        </WorkbenchButton>

        <input
          ref={importInputRef}
          hidden
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) {
              return;
            }
            if (!window.confirm("Import CSV replaces current tags. Continue?")) {
              return;
            }
            importCsv(file);
          }}
        />

        <input
          className="workbench-input screen-editor-tags-window__toolbar-input"
          value={search}
          placeholder="Search name / description / nodeId"
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="workbench-select screen-editor-tags-window__toolbar-select"
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
        >
          <option value="all">All sources</option>
          {sourceFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className="workbench-select screen-editor-tags-window__toolbar-select"
          value={driverFilter}
          onChange={(event) => setDriverFilter(event.target.value)}
        >
          <option value="all">All drivers</option>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {(driver.name ?? driver.id)} ({driver.type})
            </option>
          ))}
        </select>
        <select
          className="workbench-select screen-editor-tags-window__toolbar-select"
          value={groupFilter}
          onChange={(event) => setGroupFilter(event.target.value)}
        >
          <option value="all">All groups</option>
          {groupOptions.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </select>
        <div className="screen-editor-tags-window__toolbar-meta">
          Total: {tags.length} | Filtered: {totalRows} | Selected: {selectedTagKeys.size} | Runtime: {Object.keys(runtimeTags).length}
        </div>
      </div>

      {columnsPanelOpen ? (
        <div className="screen-editor-tags-columns-panel">
          {TAG_COLUMNS.map((column) => (
            <label key={column.id} className="screen-editor-tags-column-toggle">
              <input
                type="checkbox"
                checked={columnVisibility[column.id] !== false}
                disabled={column.id === "name"}
                onChange={(event) =>
                  setColumnVisibility((prev) => ({
                    ...prev,
                    [column.id]: event.target.checked,
                    name: true,
                  }))}
              />
              <span>{column.title}</span>
            </label>
          ))}
        </div>
      ) : null}

      <div
        ref={bodyRef}
        className="screen-editor-tags-window__body"
        style={{ "--tags-details-width": `${detailsWidth}px` } as CSSProperties}
      >
        <div className="screen-editor-tags-window__list">
          <div className="screen-editor-tags-table">
            <div
              className="screen-editor-tags-row screen-editor-tags-row--header"
              style={{ gridTemplateColumns: `42px ${tagGridTemplateColumns}` }}
            >
              <div className="screen-editor-tags-cell screen-editor-tags-header-cell">
                <input
                  type="checkbox"
                  checked={filteredTags.length > 0 && filteredTags.every((tag) => selectedTagKeys.has(tagKey(tag)))}
                  onChange={toggleSelectAllFiltered}
                />
              </div>
              {visibleColumns.map((column) => (
                <div key={column.id} className="screen-editor-tags-cell screen-editor-tags-header-cell">
                  <span>{column.title}</span>
                  <span
                    className="screen-editor-tags-column-resize-handle"
                    onMouseDown={(event) => startColumnResize(event, column.id)}
                  />
                </div>
              ))}
            </div>
            {pageRows.map((tag) => {
              const key = tagKey(tag);
              const selected = selectedTag ? tagKey(selectedTag) === key : false;
              const checked = selectedTagKeys.has(key);
              const address = formatAddressCell(tag);
              const rowCells: Record<TagColumnId, string> = {
                name: tag.name,
                source: tag.sourceType ?? "simulated",
                dataType: tag.dataType,
                driver: tag.driverId ?? "-",
                address,
                group: tag.group ?? "-",
                writable: tag.writable ? "Y" : "N",
              };
              return (
                <div
                  key={key}
                  className={[
                    "screen-editor-tags-row",
                    selected ? "screen-editor-tags-row--selected" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    setSelectedId(key);
                    if (editorMode === "add") {
                      cancelEditor();
                    }
                  }}
                  onDoubleClick={() => openEdit(tag)}
                  style={{ gridTemplateColumns: `42px ${tagGridTemplateColumns}` }}
                >
                  <div className="screen-editor-tags-cell">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTagSelection(key)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </div>
                  {visibleColumns.map((column) => {
                    const value = rowCells[column.id];
                    return (
                      <div key={column.id} className="screen-editor-tags-cell" title={value}>
                        {value}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {pageRows.length === 0 ? (
              <div className="screen-editor-empty-state">No tags match the filters</div>
            ) : null}
          </div>
        </div>

        <div
          className={[
            "screen-editor-tags-resize-handle",
            isDetailsResizeActive ? "screen-editor-tags-resize-handle--active" : "",
          ].filter(Boolean).join(" ")}
          onMouseDown={startDetailsResize}
        />

        <div className="screen-editor-tags-window__details">
          <div className="screen-editor-tag-editor">
            {editorMode !== "view" && draftTag ? (
              <>
                <div className="screen-editor-tag-editor__title">
                  {editorMode === "add" ? "Add Tag" : "Edit Tag"}
                </div>

                <label className="workbench-field">
                  <span className="workbench-field__label">Name</span>
                  <input
                    className="workbench-input"
                    value={draftTag.name}
                    onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                  />
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Description</span>
                  <input
                    className="workbench-input"
                    value={draftTag.description ?? ""}
                    onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, description: event.target.value } : prev))}
                  />
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Source Type</span>
                  <select
                    className="workbench-select"
                    value={draftTag.sourceType ?? "simulated"}
                    onChange={(event) =>
                      setDraftTag((prev) =>
                        prev
                          ? {
                            ...prev,
                            sourceType: event.target.value as TagSourceType,
                            simulation:
                              event.target.value === "simulated"
                                ? {
                                  ...toSimulationSettings(prev),
                                  profile: coerceProfileForDataType(prev.simulation?.profile, prev.dataType),
                                }
                                : prev.simulation,
                          }
                          : prev,
                      )}
                  >
                    {sourceTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Data Type</span>
                  <select
                    className="workbench-select"
                    value={draftTag.dataType}
                    disabled={sourceType === "opcua"}
                    onChange={(event) =>
                      setDraftTag((prev) => {
                        if (!prev) {
                          return prev;
                        }
                        const dataType = event.target.value as TagDefinition["dataType"];
                        if (prev.sourceType !== "simulated") {
                          return {
                            ...prev,
                            dataType,
                          };
                        }
                        return withSimulationPatch(
                          {
                            ...prev,
                            dataType,
                          },
                          { profile: coerceProfileForDataType(prev.simulation?.profile, dataType) },
                        );
                      })}
                  >
                    {dataTypeOptions.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  {sourceType === "opcua" ? (
                    <span className="screen-editor-tag-editor__hint">Autofilled from OPC UA Browser / Read Test</span>
                  ) : null}
                </label>

                {sourceType === "opcua" ? (
                  <>
                    <label className="workbench-field">
                      <span className="workbench-field__label">OPC UA Driver</span>
                      <select
                        className="workbench-select"
                        value={draftTag.driverId ?? ""}
                        onChange={(event) =>
                          setDraftTag((prev) => (prev ? { ...prev, driverId: event.target.value || undefined } : prev))}
                      >
                        <option value="">Select driver</option>
                        {editorDriverOptions.map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.name ?? driver.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="workbench-field">
                      <span className="workbench-field__label">NodeId</span>
                      <div className="screen-editor-tag-editor__row">
                        <input
                          className="workbench-input"
                          value={draftTag.nodeId ?? ""}
                          onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, nodeId: event.target.value } : prev))}
                        />
                        <WorkbenchButton
                          variant="primary"
                          onClick={openOpcBrowseForTag}
                          disabled={opcUaDrivers.length === 0}
                        >
                          Browse...
                        </WorkbenchButton>
                        <WorkbenchButton
                          onClick={() => void readOpcUaNodeTest()}
                          disabled={!draftTag.driverId || !draftTag.nodeId?.trim() || opcReadLoading}
                        >
                          Read Test
                        </WorkbenchButton>
                      </div>
                      <span className="screen-editor-tag-editor__hint">Use Browse to select a node from OPC UA server</span>
                      {opcUaDrivers.length === 0 ? (
                        <span className="screen-editor-tag-editor__hint screen-editor-tag-editor__hint--warning">
                          No OPC UA drivers configured
                        </span>
                      ) : null}
                    </label>
                  </>
                ) : null}

                {sourceType === "lw" ? (
                  <>
                    <label className="workbench-field">
                      <span className="workbench-field__label">LW Address</span>
                      <input
                        className="workbench-input"
                        type="number"
                        min={0}
                        value={draftTag.lwAddress ?? ""}
                        onChange={(event) =>
                          setDraftTag((prev) =>
                            prev
                              ? {
                                ...prev,
                                lwAddress: toOptionalNumber(event.target.value),
                              }
                              : prev,
                          )}
                      />
                    </label>
                    <label className="screen-editor-tags-checkbox-field">
                      <input
                        type="checkbox"
                        checked={Boolean(draftTag.persistent)}
                        onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, persistent: event.target.checked } : prev))}
                      />
                      <span>Persistent</span>
                    </label>
                  </>
                ) : null}

                {sourceType === "internal" ? (
                  <label className="workbench-field">
                    <span className="workbench-field__label">Internal Variable Name</span>
                    <input
                      className="workbench-input"
                      value={draftTag.internalVariableName ?? ""}
                      onChange={(event) =>
                        setDraftTag((prev) => (prev ? { ...prev, internalVariableName: event.target.value } : prev))}
                    />
                  </label>
                ) : null}

                {sourceType === "modbus" ? (
                  <label className="workbench-field">
                    <span className="workbench-field__label">Address (raw)</span>
                    <input
                      className="workbench-input"
                      value={(draftTag.address as { raw?: string } | undefined)?.raw ?? ""}
                      onChange={(event) =>
                        setDraftTag((prev) =>
                          prev
                            ? {
                              ...prev,
                              address: event.target.value.trim() ? { raw: event.target.value } : undefined,
                            }
                            : prev,
                        )}
                    />
                  </label>
                ) : null}

                {sourceType === "simulated" ? (
                  <>
                    <div className="screen-editor-tag-editor__title">Simulation Settings</div>
                    <span className="screen-editor-tag-editor__hint">
                      These settings are used by the Simulation runtime for this tag.
                    </span>

                    <label className="screen-editor-tags-checkbox-field">
                      <input
                        type="checkbox"
                        checked={Boolean(draftSimulation?.enabled ?? true)}
                        onChange={(event) => setDraftTag((prev) => (prev ? withSimulationPatch(prev, { enabled: event.target.checked }) : prev))}
                      />
                      <span>Simulation Enabled</span>
                    </label>

                    <label className="workbench-field">
                      <span className="workbench-field__label">Simulation Profile</span>
                      <select
                        className="workbench-select"
                        value={simulationProfile}
                        onChange={(event) =>
                          setDraftTag((prev) => {
                            if (!prev) {
                              return prev;
                            }
                            const nextProfile = event.target.value as TagSimulationProfile;
                            return withSimulationPatch(prev, { profile: nextProfile });
                          })}
                      >
                        <option value="constant">Constant</option>
                        {isSimNumeric ? <option value="ramp">Ramp</option> : null}
                        {isSimNumeric ? <option value="random">Random</option> : null}
                        {isSimNumeric ? <option value="sin">Sin</option> : null}
                        {isSimNumeric ? <option value="rampNoise">Ramp + Noise</option> : null}
                        {isSimNumeric ? <option value="sinNoise">Sin + Noise</option> : null}
                        {isSimBool ? <option value="toggle">Toggle</option> : null}
                        {isSimBool ? <option value="randomBool">Random Bool</option> : null}
                      </select>
                    </label>

                    <label className="workbench-field">
                      <span className="workbench-field__label">Interval (ms)</span>
                      <input
                        className="workbench-input"
                        type="number"
                        min={SIMULATION_MIN_INTERVAL_MS}
                        value={draftSimulation?.updateIntervalMs ?? ""}
                        onChange={(event) =>
                          setDraftTag((prev) => {
                            if (!prev) {
                              return prev;
                            }
                            const updateIntervalMs = toOptionalNumber(event.target.value);
                            return withSimulationPatch(prev, { updateIntervalMs });
                          })}
                      />
                    </label>

                    <label className="workbench-field">
                      <span className="workbench-field__label">Variation Mode</span>
                      <select
                        className="workbench-select"
                        value={draftSimulation?.variationMode ?? "perTagSeed"}
                        onChange={(event) =>
                          setDraftTag((prev) => (prev ? withSimulationPatch(prev, { variationMode: event.target.value as TagSimulationSettings["variationMode"] }) : prev))}
                      >
                        <option value="perTagSeed">Per-tag Seed</option>
                        <option value="same">Same</option>
                        <option value="perTagPhase">Per-tag Phase</option>
                        <option value="perTagOffset">Per-tag Offset</option>
                        <option value="perTagNoise">Per-tag Noise</option>
                      </select>
                    </label>

                    {isSimBool ? (
                      <label className="workbench-field">
                        <span className="workbench-field__label">Initial Value</span>
                        <select
                          className="workbench-select"
                          value={String(Boolean(draftSimulation?.initialValue ?? false))}
                          onChange={(event) =>
                            setDraftTag((prev) => (prev ? withSimulationPatch(prev, { initialValue: event.target.value === "true" }) : prev))}
                        >
                          <option value="false">false</option>
                          <option value="true">true</option>
                        </select>
                      </label>
                    ) : null}

                    {isSimString ? (
                      <label className="workbench-field">
                        <span className="workbench-field__label">Initial Value</span>
                        <input
                          className="workbench-input"
                          value={typeof draftSimulation?.initialValue === "string" ? draftSimulation.initialValue : ""}
                          onChange={(event) =>
                            setDraftTag((prev) => (prev ? withSimulationPatch(prev, { initialValue: event.target.value }) : prev))}
                        />
                      </label>
                    ) : null}

                    {isSimNumeric ? (
                      <>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Initial Value</span>
                          <input
                            className="workbench-input"
                            type="number"
                            value={typeof draftSimulation?.initialValue === "number" ? draftSimulation.initialValue : ""}
                            onChange={(event) =>
                              setDraftTag((prev) => {
                                if (!prev) {
                                  return prev;
                                }
                                const initialValue = toOptionalNumber(event.target.value);
                                return withSimulationPatch(prev, { initialValue });
                              })}
                          />
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Min</span>
                          <input
                            className="workbench-input"
                            type="number"
                            value={draftSimulation?.min ?? ""}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev ? withSimulationPatch(prev, { min: toOptionalNumber(event.target.value) }) : prev))}
                          />
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Max</span>
                          <input
                            className="workbench-input"
                            type="number"
                            value={draftSimulation?.max ?? ""}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev ? withSimulationPatch(prev, { max: toOptionalNumber(event.target.value) }) : prev))}
                          />
                        </label>
                      </>
                    ) : null}

                    {isSimNumeric && (simulationProfile === "ramp" || simulationProfile === "rampNoise") ? (
                      <>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Step</span>
                          <input
                            className="workbench-input"
                            type="number"
                            min={0}
                            value={draftSimulation?.ramp?.step ?? ""}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev
                                ? withSimulationPatch(prev, {
                                  ramp: {
                                    ...toSimulationSettings(prev).ramp,
                                    step: toOptionalNumber(event.target.value),
                                  },
                                })
                                : prev))}
                          />
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Direction</span>
                          <select
                            className="workbench-select"
                            value={draftSimulation?.ramp?.direction ?? "pingPong"}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev
                                ? withSimulationPatch(prev, {
                                  ramp: {
                                    ...toSimulationSettings(prev).ramp,
                                    direction: event.target.value as NonNullable<TagSimulationSettings["ramp"]>["direction"],
                                  },
                                })
                                : prev))}
                          >
                            <option value="pingPong">PingPong</option>
                            <option value="up">Up</option>
                            <option value="down">Down</option>
                          </select>
                        </label>
                        <label className="screen-editor-tags-checkbox-field">
                          <input
                            type="checkbox"
                            checked={Boolean(draftSimulation?.ramp?.resetOnLimit)}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev
                                ? withSimulationPatch(prev, {
                                  ramp: {
                                    ...toSimulationSettings(prev).ramp,
                                    resetOnLimit: event.target.checked,
                                  },
                                })
                                : prev))}
                          />
                          <span>Reset On Limit</span>
                        </label>
                      </>
                    ) : null}

                    {isSimNumeric && simulationProfile === "random" ? (
                      <>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Random Min</span>
                          <input
                            className="workbench-input"
                            type="number"
                            value={draftSimulation?.random?.min ?? ""}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev
                                ? withSimulationPatch(prev, {
                                  random: {
                                    ...toSimulationSettings(prev).random,
                                    min: toOptionalNumber(event.target.value),
                                  },
                                })
                                : prev))}
                          />
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Random Max</span>
                          <input
                            className="workbench-input"
                            type="number"
                            value={draftSimulation?.random?.max ?? ""}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev
                                ? withSimulationPatch(prev, {
                                  random: {
                                    ...toSimulationSettings(prev).random,
                                    max: toOptionalNumber(event.target.value),
                                  },
                                })
                                : prev))}
                          />
                        </label>
                      </>
                    ) : null}

                    {isSimNumeric && (simulationProfile === "sin" || simulationProfile === "sinNoise") ? (
                      <>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Amplitude</span>
                          <input
                            className="workbench-input"
                            type="number"
                            value={draftSimulation?.sin?.amplitude ?? ""}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev
                                ? withSimulationPatch(prev, {
                                  sin: {
                                    ...toSimulationSettings(prev).sin,
                                    amplitude: toOptionalNumber(event.target.value),
                                  },
                                })
                                : prev))}
                          />
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Offset</span>
                          <input
                            className="workbench-input"
                            type="number"
                            value={draftSimulation?.sin?.offset ?? ""}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev
                                ? withSimulationPatch(prev, {
                                  sin: {
                                    ...toSimulationSettings(prev).sin,
                                    offset: toOptionalNumber(event.target.value),
                                  },
                                })
                                : prev))}
                          />
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Period (ms)</span>
                          <input
                            className="workbench-input"
                            type="number"
                            min={SIMULATION_MIN_INTERVAL_MS}
                            value={draftSimulation?.sin?.periodMs ?? ""}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev
                                ? withSimulationPatch(prev, {
                                  sin: {
                                    ...toSimulationSettings(prev).sin,
                                    periodMs: toOptionalNumber(event.target.value),
                                  },
                                })
                                : prev))}
                          />
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Phase (deg)</span>
                          <input
                            className="workbench-input"
                            type="number"
                            value={draftSimulation?.sin?.phaseDeg ?? ""}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev
                                ? withSimulationPatch(prev, {
                                  sin: {
                                    ...toSimulationSettings(prev).sin,
                                    phaseDeg: toOptionalNumber(event.target.value),
                                  },
                                })
                                : prev))}
                          />
                        </label>
                      </>
                    ) : null}

                    {isSimNumeric && (simulationProfile === "rampNoise" || simulationProfile === "sinNoise") ? (
                      <>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Noise Amplitude</span>
                          <input
                            className="workbench-input"
                            type="number"
                            min={0}
                            value={draftSimulation?.noise?.amplitude ?? ""}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev
                                ? withSimulationPatch(prev, {
                                  noise: {
                                    ...toSimulationSettings(prev).noise,
                                    amplitude: toOptionalNumber(event.target.value),
                                  },
                                })
                                : prev))}
                          />
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">Noise Type</span>
                          <select
                            className="workbench-select"
                            value={draftSimulation?.noise?.type ?? "uniform"}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev
                                ? withSimulationPatch(prev, {
                                  noise: {
                                    ...toSimulationSettings(prev).noise,
                                    type: event.target.value as NonNullable<TagSimulationSettings["noise"]>["type"],
                                  },
                                })
                                : prev))}
                          >
                            <option value="uniform">Uniform</option>
                            <option value="normal">Normal</option>
                          </select>
                        </label>
                      </>
                    ) : null}

                    {isSimBool && simulationProfile === "toggle" ? (
                      <>
                        <label className="workbench-field">
                          <span className="workbench-field__label">True Duration (ms)</span>
                          <input
                            className="workbench-input"
                            type="number"
                            min={SIMULATION_MIN_INTERVAL_MS}
                            value={draftSimulation?.toggle?.trueMs ?? ""}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev
                                ? withSimulationPatch(prev, {
                                  toggle: {
                                    ...toSimulationSettings(prev).toggle,
                                    trueMs: toOptionalNumber(event.target.value),
                                  },
                                })
                                : prev))}
                          />
                        </label>
                        <label className="workbench-field">
                          <span className="workbench-field__label">False Duration (ms)</span>
                          <input
                            className="workbench-input"
                            type="number"
                            min={SIMULATION_MIN_INTERVAL_MS}
                            value={draftSimulation?.toggle?.falseMs ?? ""}
                            onChange={(event) =>
                              setDraftTag((prev) => (prev
                                ? withSimulationPatch(prev, {
                                  toggle: {
                                    ...toSimulationSettings(prev).toggle,
                                    falseMs: toOptionalNumber(event.target.value),
                                  },
                                })
                                : prev))}
                          />
                        </label>
                      </>
                    ) : null}

                    {isSimBool && simulationProfile === "randomBool" ? (
                      <label className="workbench-field">
                        <span className="workbench-field__label">True Probability (0..1)</span>
                        <input
                          className="workbench-input"
                          type="number"
                          min={0}
                          max={1}
                          step={0.01}
                          value={draftSimulation?.randomBool?.trueProbability ?? ""}
                          onChange={(event) =>
                            setDraftTag((prev) => (prev
                              ? withSimulationPatch(prev, {
                                randomBool: {
                                  ...toSimulationSettings(prev).randomBool,
                                  trueProbability: toOptionalNumber(event.target.value),
                                },
                              })
                              : prev))}
                        />
                      </label>
                    ) : null}
                  </>
                ) : null}

                <label className="workbench-field">
                  <span className="workbench-field__label">Group</span>
                  <input
                    className="workbench-input"
                    value={draftTag.group ?? ""}
                    onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, group: event.target.value } : prev))}
                  />
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Unit</span>
                  <input
                    className="workbench-input"
                    value={draftTag.unit ?? ""}
                    onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, unit: event.target.value } : prev))}
                  />
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Scan Rate (ms)</span>
                  <input
                    className="workbench-input"
                    type="number"
                    min={50}
                    value={draftTag.scanRateMs ?? ""}
                    onChange={(event) =>
                      setDraftTag((prev) =>
                        prev
                          ? {
                            ...prev,
                            scanRateMs: toOptionalNumber(event.target.value),
                          }
                          : prev,
                      )}
                  />
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Scale</span>
                  <input
                    className="workbench-input"
                    type="number"
                    value={draftTag.scale ?? ""}
                    onChange={(event) =>
                      setDraftTag((prev) =>
                        prev
                          ? {
                            ...prev,
                            scale: toOptionalNumber(event.target.value),
                          }
                          : prev,
                      )}
                  />
                </label>

                <label className="workbench-field">
                  <span className="workbench-field__label">Offset</span>
                  <input
                    className="workbench-input"
                    type="number"
                    value={draftTag.offset ?? ""}
                    onChange={(event) =>
                      setDraftTag((prev) =>
                        prev
                          ? {
                            ...prev,
                            offset: toOptionalNumber(event.target.value),
                          }
                          : prev,
                      )}
                  />
                </label>

                <label className="screen-editor-tags-checkbox-field">
                  <input
                    type="checkbox"
                    checked={Boolean(draftTag.writable)}
                    onChange={(event) => setDraftTag((prev) => (prev ? { ...prev, writable: event.target.checked } : prev))}
                  />
                  <span>Writable</span>
                </label>

                <div className="screen-editor-tag-editor-actions">
                  <WorkbenchButton variant="primary" onClick={applySaveDraft}>
                    Save
                  </WorkbenchButton>
                  <WorkbenchButton onClick={cancelEditor}>
                    Cancel
                  </WorkbenchButton>
                </div>
              </>
            ) : selectedTag ? (
              <>
                <div className="screen-editor-tag-editor__title">Tag Details</div>
                <div className="screen-editor-tag-editor__kv">
                  <span>Name</span>
                  <strong>{selectedTag.name}</strong>
                </div>
                <div className="screen-editor-tag-editor__kv">
                  <span>Source</span>
                  <strong>{selectedTag.sourceType ?? "simulated"}</strong>
                </div>
                <div className="screen-editor-tag-editor__kv">
                  <span>Data Type</span>
                  <strong>{selectedTag.dataType}</strong>
                </div>
                <div className="screen-editor-tag-editor__kv">
                  <span>Driver</span>
                  <strong>{selectedTag.driverId ?? "-"}</strong>
                </div>
                <div className="screen-editor-tag-editor__kv">
                  <span>Address</span>
                  <strong>{formatAddressCell(selectedTag)}</strong>
                </div>
                <div className="screen-editor-tag-editor__kv">
                  <span>Group</span>
                  <strong>{selectedTag.group ?? "-"}</strong>
                </div>
                <div className="screen-editor-tag-editor-actions">
                  <WorkbenchButton onClick={() => openEdit(selectedTag)}>Edit</WorkbenchButton>
                  <WorkbenchButton onClick={() => duplicateTag(selectedTag)}>Duplicate</WorkbenchButton>
                  <WorkbenchButton variant="danger" onClick={requestDeleteSelected}>Delete</WorkbenchButton>
                </div>
              </>
            ) : (
              <div className="screen-editor-empty-state">Select tag</div>
            )}

            {pendingDeleteTagId && selectedTag && pendingDeleteTagId === tagKey(selectedTag) ? (
              <div className="screen-editor-tags-inline-confirm">
                <div className="screen-editor-tags-inline-confirm__title">
                  Delete {selectedTag.name}?
                </div>
                <div className="screen-editor-tags-inline-confirm__actions">
                  <WorkbenchButton onClick={() => setPendingDeleteTagId(null)}>Cancel</WorkbenchButton>
                  <WorkbenchButton variant="danger" onClick={confirmDelete}>Delete</WorkbenchButton>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {bulkSimulationOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="screen-editor-opc-browser-layer">
              <WorkbenchWindow
                id="applySimulationProfile"
                title="APPLY SIMULATION PROFILE"
                rect={bulkSimulationRect}
                zIndex={bulkSimulationZIndex}
                minWidth={BULK_SIMULATION_MIN_WIDTH}
                minHeight={BULK_SIMULATION_MIN_HEIGHT}
                onClose={() => setBulkSimulationOpen(false)}
                onFocus={focusBulkSimulationWindow}
                onMove={(x, y) =>
                  setBulkSimulationRect((prev) =>
                    clampBulkSimulationRect({ ...prev, x, y }),
                  )}
                onResize={(rect) => setBulkSimulationRect(clampBulkSimulationRect(rect))}
              >
                <div className="screen-editor-simulation-create-window">
                  <div className="screen-editor-simulation-create-body screen-editor-tag-editor">
                    <div style={{ display: "grid", gap: 8 }}>
          <label className="screen-editor-settings-check">
            <input
              type="checkbox"
              checked={bulkApplyToFiltered}
              onChange={(event) => setBulkApplyToFiltered(event.target.checked)}
            />
            <span>Apply to all filtered tags ({filteredTags.length})</span>
          </label>
          <div>Selected tags: <strong>{selectedTagKeys.size}</strong>, simulated in selection: <strong>{selectedSimulationTargets.length}</strong></div>
          <label className="workbench-field">
            <span className="workbench-field__label">Bulk Mode</span>
            <select className="workbench-select" value={bulkSimulationMode} onChange={(event) => setBulkSimulationMode(event.target.value as SimulationBulkMode)}>
              <option value="patch">Patch selected fields only</option>
              <option value="replace">Replace full simulation config</option>
              <option value="fillEmpty">Fill empty fields only</option>
            </select>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags.profile} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, profile: event.target.checked }))} />
              <span>Profile</span>
            </label>
            <select className="workbench-select" value={bulkSimulationDraft.profile ?? "constant"} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "profile", event.target.value as TagSimulationProfile))}>
              <option value="constant">Constant</option>
              <option value="ramp">Ramp</option>
              <option value="random">Random</option>
              <option value="sin">Sin</option>
              <option value="rampNoise">Ramp + Noise</option>
              <option value="sinNoise">Sin + Noise</option>
              <option value="toggle">Toggle</option>
              <option value="randomBool">Random Bool</option>
            </select>

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags.enabled} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, enabled: event.target.checked }))} />
              <span>Enabled</span>
            </label>
            <select className="workbench-select" value={String(Boolean(bulkSimulationDraft.enabled ?? true))} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "enabled", event.target.value === "true"))}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags.updateIntervalMs} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, updateIntervalMs: event.target.checked }))} />
              <span>Interval</span>
            </label>
            <input className="workbench-input" type="number" min={SIMULATION_MIN_INTERVAL_MS} value={bulkSimulationDraft.updateIntervalMs ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "updateIntervalMs", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags.min} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, min: event.target.checked }))} />
              <span>Min</span>
            </label>
            <input className="workbench-input" type="number" value={bulkSimulationDraft.min ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "min", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags.max} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, max: event.target.checked }))} />
              <span>Max</span>
            </label>
            <input className="workbench-input" type="number" value={bulkSimulationDraft.max ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "max", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["ramp.step"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "ramp.step": event.target.checked }))} />
              <span>Ramp Step</span>
            </label>
            <input className="workbench-input" type="number" min={0} value={bulkSimulationDraft.ramp?.step ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "ramp.step", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["sin.periodMs"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "sin.periodMs": event.target.checked }))} />
              <span>Sin Period</span>
            </label>
            <input className="workbench-input" type="number" min={SIMULATION_MIN_INTERVAL_MS} value={bulkSimulationDraft.sin?.periodMs ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "sin.periodMs", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["noise.amplitude"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "noise.amplitude": event.target.checked }))} />
              <span>Noise Amp</span>
            </label>
            <input className="workbench-input" type="number" min={0} value={bulkSimulationDraft.noise?.amplitude ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "noise.amplitude", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["noise.type"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "noise.type": event.target.checked }))} />
              <span>Noise Type</span>
            </label>
            <select className="workbench-select" value={bulkSimulationDraft.noise?.type ?? "uniform"} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "noise.type", event.target.value))}>
              <option value="uniform">uniform</option>
              <option value="normal">normal</option>
            </select>

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["ramp.direction"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "ramp.direction": event.target.checked }))} />
              <span>Ramp Dir</span>
            </label>
            <select className="workbench-select" value={bulkSimulationDraft.ramp?.direction ?? "pingPong"} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "ramp.direction", event.target.value))}>
              <option value="pingPong">pingPong</option>
              <option value="up">up</option>
              <option value="down">down</option>
            </select>

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["ramp.resetOnLimit"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "ramp.resetOnLimit": event.target.checked }))} />
              <span>Ramp Reset</span>
            </label>
            <select className="workbench-select" value={String(Boolean(bulkSimulationDraft.ramp?.resetOnLimit))} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "ramp.resetOnLimit", event.target.value === "true"))}>
              <option value="false">false</option>
              <option value="true">true</option>
            </select>

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["random.min"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "random.min": event.target.checked }))} />
              <span>Rnd Min</span>
            </label>
            <input className="workbench-input" type="number" value={bulkSimulationDraft.random?.min ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "random.min", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["random.max"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "random.max": event.target.checked }))} />
              <span>Rnd Max</span>
            </label>
            <input className="workbench-input" type="number" value={bulkSimulationDraft.random?.max ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "random.max", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["sin.amplitude"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "sin.amplitude": event.target.checked }))} />
              <span>Sin Amp</span>
            </label>
            <input className="workbench-input" type="number" value={bulkSimulationDraft.sin?.amplitude ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "sin.amplitude", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["sin.offset"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "sin.offset": event.target.checked }))} />
              <span>Sin Offset</span>
            </label>
            <input className="workbench-input" type="number" value={bulkSimulationDraft.sin?.offset ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "sin.offset", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["sin.phaseDeg"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "sin.phaseDeg": event.target.checked }))} />
              <span>Sin Phase</span>
            </label>
            <input className="workbench-input" type="number" value={bulkSimulationDraft.sin?.phaseDeg ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "sin.phaseDeg", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["toggle.trueMs"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "toggle.trueMs": event.target.checked }))} />
              <span>True ms</span>
            </label>
            <input className="workbench-input" type="number" min={SIMULATION_MIN_INTERVAL_MS} value={bulkSimulationDraft.toggle?.trueMs ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "toggle.trueMs", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["toggle.falseMs"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "toggle.falseMs": event.target.checked }))} />
              <span>False ms</span>
            </label>
            <input className="workbench-input" type="number" min={SIMULATION_MIN_INTERVAL_MS} value={bulkSimulationDraft.toggle?.falseMs ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "toggle.falseMs", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags.variationMode} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, variationMode: event.target.checked }))} />
              <span>Variation</span>
            </label>
            <select className="workbench-select" value={bulkSimulationDraft.variationMode ?? "perTagSeed"} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "variationMode", event.target.value))}>
              <option value="perTagSeed">perTagSeed</option>
              <option value="same">same</option>
              <option value="perTagPhase">perTagPhase</option>
              <option value="perTagOffset">perTagOffset</option>
              <option value="perTagNoise">perTagNoise</option>
            </select>

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags["randomBool.trueProbability"]} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, "randomBool.trueProbability": event.target.checked }))} />
              <span>Bool Prob</span>
            </label>
            <input className="workbench-input" type="number" min={0} max={1} step={0.01} value={bulkSimulationDraft.randomBool?.trueProbability ?? ""} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "randomBool.trueProbability", toOptionalNumber(event.target.value)))} />

            <label className="screen-editor-settings-check">
              <input type="checkbox" checked={bulkApplyFlags.initialValue} onChange={(event) => setBulkApplyFlags((prev) => ({ ...prev, initialValue: event.target.checked }))} />
              <span>Initial</span>
            </label>
            <input className="workbench-input" value={String(bulkSimulationDraft.initialValue ?? "")} onChange={(event) => setBulkSimulationDraft((prev) => setSimulationFieldValue(prev, "initialValue", event.target.value))} />
          </div>
                    </div>
                  </div>
                  <div className="screen-editor-simulation-create-footer">
                    <WorkbenchButton onClick={() => setBulkSimulationOpen(false)}>Cancel</WorkbenchButton>
                    <WorkbenchButton variant="primary" onClick={applyBulkSimulation}>Apply</WorkbenchButton>
                  </div>
                </div>
              </WorkbenchWindow>
            </div>,
            document.body,
          )
        : null}

      {createSimulationOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="screen-editor-opc-browser-layer">
              <WorkbenchWindow
                id="createSimulationTags"
                title="CREATE SIMULATION TAGS"
                rect={createSimulationRect}
                zIndex={createSimulationZIndex}
                minWidth={CREATE_SIMULATION_MIN_WIDTH}
                minHeight={CREATE_SIMULATION_MIN_HEIGHT}
                onClose={() => setCreateSimulationOpen(false)}
                onFocus={focusCreateSimulationWindow}
                onMove={(x, y) =>
                  setCreateSimulationRect((prev) =>
                    clampCreateSimulationRect({ ...prev, x, y }),
                  )}
                onResize={(rect) => setCreateSimulationRect(clampCreateSimulationRect(rect))}
              >
                <div className="screen-editor-simulation-create-window">
                  <div className="screen-editor-simulation-create-body screen-editor-tag-editor">
                    <div className="screen-editor-simulation-create-grid">
                      <label className="workbench-field">
                        <span className="workbench-field__label">Prefix</span>
                        <input className="workbench-input" value={createSimulationPrefix} onChange={(event) => setCreateSimulationPrefix(event.target.value)} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Start Index</span>
                        <input className="workbench-input" type="number" value={createSimulationStartIndex} onChange={(event) => setCreateSimulationStartIndex(Number(event.target.value || 0))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Count</span>
                        <input className="workbench-input" type="number" min={1} max={SIMULATION_BULK_CREATE_LIMIT} value={createSimulationCount} onChange={(event) => setCreateSimulationCount(Number(event.target.value || 0))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Padding</span>
                        <input className="workbench-input" type="number" min={0} value={createSimulationPadding} onChange={(event) => setCreateSimulationPadding(Number(event.target.value || 0))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Data Type</span>
                        <select className="workbench-select" value={createSimulationDataType} onChange={(event) => setCreateSimulationDataType(event.target.value as TagDefinition["dataType"])}>
                          {dataTypeOptions.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Group</span>
                        <input className="workbench-input" value={createSimulationGroup} onChange={(event) => setCreateSimulationGroup(event.target.value)} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Address Pattern ({`{index}`}, {`{name}`})</span>
                        <input className="workbench-input" value={createSimulationAddressPattern} onChange={(event) => setCreateSimulationAddressPattern(event.target.value)} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Profile</span>
                        <select
                          className="workbench-select"
                          value={createSimulationDraft.profile ?? "constant"}
                          onChange={(event) => setCreateSimulationDraft((prev) => normalizeSimulationForSave(setSimulationFieldValue(prev, "profile", event.target.value as TagSimulationProfile), createSimulationDataType))}
                        >
                          <option value="constant">Constant</option>
                          <option value="ramp">Ramp</option>
                          <option value="random">Random</option>
                          <option value="sin">Sin</option>
                          <option value="rampNoise">Ramp + Noise</option>
                          <option value="sinNoise">Sin + Noise</option>
                          <option value="toggle">Toggle</option>
                          <option value="randomBool">Random Bool</option>
                        </select>
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Interval (ms)</span>
                        <input className="workbench-input" type="number" min={SIMULATION_MIN_INTERVAL_MS} value={createSimulationDraft.updateIntervalMs ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "updateIntervalMs", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Min</span>
                        <input className="workbench-input" type="number" value={createSimulationDraft.min ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "min", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Max</span>
                        <input className="workbench-input" type="number" value={createSimulationDraft.max ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "max", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Initial Value</span>
                        <input className="workbench-input" value={String(createSimulationDraft.initialValue ?? "")} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "initialValue", event.target.value))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Ramp Step</span>
                        <input className="workbench-input" type="number" min={0} value={createSimulationDraft.ramp?.step ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "ramp.step", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Ramp Direction</span>
                        <select className="workbench-select" value={createSimulationDraft.ramp?.direction ?? "pingPong"} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "ramp.direction", event.target.value))}>
                          <option value="pingPong">pingPong</option>
                          <option value="up">up</option>
                          <option value="down">down</option>
                        </select>
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Random Min</span>
                        <input className="workbench-input" type="number" value={createSimulationDraft.random?.min ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "random.min", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Random Max</span>
                        <input className="workbench-input" type="number" value={createSimulationDraft.random?.max ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "random.max", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Sin Amplitude</span>
                        <input className="workbench-input" type="number" value={createSimulationDraft.sin?.amplitude ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "sin.amplitude", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Sin Offset</span>
                        <input className="workbench-input" type="number" value={createSimulationDraft.sin?.offset ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "sin.offset", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Sin Period (ms)</span>
                        <input className="workbench-input" type="number" min={SIMULATION_MIN_INTERVAL_MS} value={createSimulationDraft.sin?.periodMs ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "sin.periodMs", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Sin Phase (deg)</span>
                        <input className="workbench-input" type="number" value={createSimulationDraft.sin?.phaseDeg ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "sin.phaseDeg", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Noise Amplitude</span>
                        <input className="workbench-input" type="number" min={0} value={createSimulationDraft.noise?.amplitude ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "noise.amplitude", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Noise Type</span>
                        <select className="workbench-select" value={createSimulationDraft.noise?.type ?? "uniform"} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "noise.type", event.target.value))}>
                          <option value="uniform">uniform</option>
                          <option value="normal">normal</option>
                        </select>
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Toggle trueMs</span>
                        <input className="workbench-input" type="number" min={SIMULATION_MIN_INTERVAL_MS} value={createSimulationDraft.toggle?.trueMs ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "toggle.trueMs", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Toggle falseMs</span>
                        <input className="workbench-input" type="number" min={SIMULATION_MIN_INTERVAL_MS} value={createSimulationDraft.toggle?.falseMs ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "toggle.falseMs", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Random Bool p</span>
                        <input className="workbench-input" type="number" min={0} max={1} step={0.01} value={createSimulationDraft.randomBool?.trueProbability ?? ""} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "randomBool.trueProbability", toOptionalNumber(event.target.value)))} />
                      </label>
                      <label className="workbench-field">
                        <span className="workbench-field__label">Variation</span>
                        <select className="workbench-select" value={createSimulationDraft.variationMode ?? "perTagSeed"} onChange={(event) => setCreateSimulationDraft((prev) => setSimulationFieldValue(prev, "variationMode", event.target.value))}>
                          <option value="perTagSeed">Per-tag Seed</option>
                          <option value="same">Same</option>
                          <option value="perTagPhase">Per-tag Phase</option>
                          <option value="perTagOffset">Per-tag Offset</option>
                          <option value="perTagNoise">Per-tag Noise</option>
                        </select>
                      </label>
                    </div>
                    <div className="screen-editor-simulation-create-summary">
                      <div>Driver: <strong>{simulationDrivers[0]?.name ?? simulationDrivers[0]?.id ?? "no simulated driver"}</strong></div>
                      <div>Preview: <strong>{createSimulationNamePreview.join(", ")}</strong></div>
                    </div>
                  </div>
                  <div className="screen-editor-simulation-create-footer">
                    <WorkbenchButton onClick={() => setCreateSimulationOpen(false)}>Cancel</WorkbenchButton>
                    <WorkbenchButton variant="primary" onClick={() => void applyCreateSimulationTags()}>Create</WorkbenchButton>
                  </div>
                </div>
              </WorkbenchWindow>
            </div>,
            document.body,
          )
        : null}

      <Modal
        title="Duplicate simulation tag names"
        open={createSimulationDuplicateState !== null}
        onCancel={() => !createSimulationDuplicateBusy && setCreateSimulationDuplicateState(null)}
        footer={[
          <WorkbenchButton
            key="cancel"
            onClick={() => setCreateSimulationDuplicateState(null)}
            disabled={createSimulationDuplicateBusy}
          >
            Cancel
          </WorkbenchButton>,
          <WorkbenchButton
            key="suffix"
            onClick={() => void resolveCreateSimulationDuplicates("suffix")}
            disabled={createSimulationDuplicateBusy}
          >
            Create with _1 suffix
          </WorkbenchButton>,
          <WorkbenchButton
            key="overwrite"
            variant="danger"
            onClick={() => void resolveCreateSimulationDuplicates("overwrite")}
            disabled={createSimulationDuplicateBusy}
          >
            Overwrite existing
          </WorkbenchButton>,
        ]}
      >
        {createSimulationDuplicateState ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div>Found {createSimulationDuplicateState.duplicates.length} existing name(s).</div>
            <div>
              Examples: {createSimulationDuplicateState.duplicates.slice(0, 8).join(", ")}
              {createSimulationDuplicateState.duplicates.length > 8 ? "..." : ""}
            </div>
            <div>Choose overwrite or create new tags with `_1` / `_2` suffixes.</div>
          </div>
        ) : null}
      </Modal>

      {opcBrowseOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="screen-editor-opc-browser-layer">
              <WorkbenchWindow
                id="opcUaBrowser"
                title="BROWSE OPC UA"
                rect={opcBrowserRect}
                zIndex={opcBrowserZIndex}
                minWidth={OPC_BROWSER_MIN_WIDTH}
                minHeight={OPC_BROWSER_MIN_HEIGHT}
                onClose={closeOpcBrowseDialog}
                onFocus={focusOpcBrowserWindow}
                onMove={(x, y) =>
                  setOpcBrowserRect((prev) =>
                    clampOpcBrowserRect({ ...prev, x, y }),
                  )}
                onResize={(rect) => setOpcBrowserRect(clampOpcBrowserRect(rect))}
              >
                <OpcUaBrowserContent
                  opcUaDrivers={opcUaDrivers}
                  mode={opcBrowseMode}
                  driverId={opcBrowseDriverId}
                  nodeId={opcBrowseNodeId}
                  search={opcBrowseSearch}
                  loading={opcBrowseLoading}
                  error={opcBrowseError}
                  nodes={opcBrowseNodes}
                  selectedNodeIds={opcBrowseSelectedNodeIds}
                  focusNodeId={opcBrowseFocusNodeId}
                  historyLength={opcBrowseHistory.length}
                  canGoUp={Boolean(opcBrowseParentNodeId)}
                  onDriverChange={handleOpcDriverChange}
                  onBack={goBackOpcNode}
                  onUp={goUpOpcNode}
                  onRoot={goRootOpcNode}
                  onRefresh={() => void browseOpcUaNodes()}
                  onSearchChange={setOpcBrowseSearch}
                  onRowClick={handleOpcNodeRowClick}
                  onRowDoubleClick={handleOpcNodeRowDoubleClick}
                  onToggleSelection={toggleOpcBrowseNodeSelection}
                  onSingleSelect={(nodeId) => {
                    setOpcBrowseSelectedNodeIds(new Set([nodeId]));
                    setOpcBrowseFocusNodeId(nodeId);
                  }}
                  onOpenNode={openOpcBrowseNode}
                  onSelectNode={handleOpcLeafSelect}
                  onCancel={closeOpcBrowseDialog}
                  onConfirmSingle={confirmSingleOpcNodeSelection}
                  onConfirmMulti={importSelectedOpcUaNodes}
                  subtreeImportBusy={opcImportSubtreeBusy}
                  subtreeImportEnabled={canImportOpcBrowseSubtree}
                  subtreeImportOverwrite={opcImportSubtreeOverwrite}
                  subtreeImportRootName={opcImportSubtreeRootName}
                  subtreeImportScanRateMs={opcImportSubtreeScanRateMs}
                  subtreeImportMaxNodes={opcImportSubtreeMaxNodes}
                  onSubtreeImportOverwriteChange={setOpcImportSubtreeOverwrite}
                  onSubtreeImportRootNameChange={setOpcImportSubtreeRootName}
                  onSubtreeImportScanRateMsChange={setOpcImportSubtreeScanRateMs}
                  onSubtreeImportMaxNodesChange={setOpcImportSubtreeMaxNodes}
                  onImportSubtree={() => void importOpcUaSubtree()}
                />
              </WorkbenchWindow>
            </div>,
            document.body,
          )
        : null}

      <div className="screen-editor-tags-pagination">
        <span>
          Rows: {totalRows} · Page {safePage} / {totalPages}
        </span>
        <WorkbenchButton disabled={safePage <= 1} onClick={() => setPage(1)}>
          First
        </WorkbenchButton>
        <WorkbenchButton disabled={safePage <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
          Prev
        </WorkbenchButton>
        <WorkbenchButton disabled={safePage >= totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}>
          Next
        </WorkbenchButton>
        <WorkbenchButton disabled={safePage >= totalPages} onClick={() => setPage(totalPages)}>
          Last
        </WorkbenchButton>
        <select
          className="workbench-select screen-editor-tags-page-size"
          value={pageSize}
          onChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(1);
          }}
        >
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
          <option value={500}>500</option>
        </select>
      </div>
    </div>
  );
}

function parseCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseAddressCell(value: string | undefined): TagDefinition["address"] {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as TagDefinition["address"];
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // plain text address
  }
  return { raw: value };
}
