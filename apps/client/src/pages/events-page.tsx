import {
  BellOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SoundOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { ColorPicker, message } from "antd";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type {
  EventBitTrigger,
  EventDefinition,
  EventSound,
  RuntimeAction,
  EventWordOperator,
  HmiObject,
  TagScalarValue,
} from "@web-scada/shared";
import {
  ensureDefaultEventSounds,
  isDefaultEventSoundId,
} from "@web-scada/shared";
import { WorkbenchButton, WorkbenchTabs } from "../components/workbench";
import { TagPickerDialog } from "../components/tag-picker-dialog";
import {
  createProjectTagIndex,
  findMissingEventTagReferences,
  getEventTagWarnings,
  reconcileEventsWithProjectTags,
  type EventTagReferenceField,
  type EventTagWarning,
} from "../features/events/event-tag-utils";
import { eventSoundPlayer } from "../features/events/event-sound-player";
import { api } from "../services/api";
import { useScadaStore } from "../store/scada-store";
import { appToast } from "../ui";

type EventColumnId =
  | "enabled"
  | "category"
  | "message"
  | "priority"
  | "conditionMode"
  | "trigger"
  | "sourceTagName"
  | "wordValue"
  | "soundEnabled"
  | "soundId"
  | "requireAck"
  | "actions";

type EventColumnConfig = {
  id: EventColumnId;
  title: string;
  defaultWidth: number;
  minWidth: number;
};

type EventColumnVisibility = Record<EventColumnId, boolean>;

type EventManagerSection = "events" | "sounds";
type EventEditorMode = "view" | "add" | "edit";
type EventEditorTab = "general" | "message" | "statistics" | "security" | "actions";
type TagPickerTargetField = Extract<
  EventTagReferenceField,
  | "sourceTagName"
  | "ackTagName"
  | "notificationTagName"
  | "elapsedTimeTagName"
  | "securityTagName"
>;

type EventEditorDraft = {
  id: string;
  enabled: boolean;
  categoryId: string;
  categoryName: string;
  priority: number;
  startupDelayMs: number;
  sourceTagName: string;
  conditionMode: "bit" | "word";
  bitTrigger: EventBitTrigger;
  wordOperator: EventWordOperator;
  wordValue: string;
  message: string;
  textColor: string;
  backgroundColor: string;
  backgroundBlinkEnabled: boolean;
  backgroundBlinkDurationMs: number;
  backgroundBlinkOpacity: number;
  requireAck: boolean;
  ackValue: string;
  soundEnabled: boolean;
  soundId: string;
  ackTagName: string;
  notificationTagName: string;
  elapsedTimeTagName: string;
  securityEnabled: boolean;
  securityTagName: string;
  securityBitValue: "" | "true" | "false" | "1" | "0";
  onActiveActions: RuntimeAction[];
  onClearedActions: RuntimeAction[];
  onAckActions: RuntimeAction[];
};

type EventDraftErrors = Partial<Record<keyof EventEditorDraft, string>>;

type EventRow = {
  key: string;
  index: number;
  id: string;
  event: EventDefinition;
};

const EVENT_COLUMNS: EventColumnConfig[] = [
  { id: "enabled", title: "ON", defaultWidth: 54, minWidth: 44 },
  { id: "category", title: "CATEGORY", defaultWidth: 120, minWidth: 100 },
  { id: "message", title: "MESSAGE", defaultWidth: 280, minWidth: 160 },
  { id: "priority", title: "PRIORITY", defaultWidth: 90, minWidth: 76 },
  { id: "conditionMode", title: "MODE", defaultWidth: 78, minWidth: 66 },
  { id: "trigger", title: "TRIGGER / OP", defaultWidth: 120, minWidth: 96 },
  {
    id: "sourceTagName",
    title: "SOURCE TAG",
    defaultWidth: 150,
    minWidth: 110,
  },
  { id: "wordValue", title: "WORD VALUE", defaultWidth: 100, minWidth: 84 },
  { id: "soundEnabled", title: "SOUND", defaultWidth: 76, minWidth: 64 },
  { id: "soundId", title: "SOUND ID", defaultWidth: 130, minWidth: 94 },
  { id: "requireAck", title: "ACK", defaultWidth: 68, minWidth: 56 },
  { id: "actions", title: "ACTIONS", defaultWidth: 202, minWidth: 170 },
];

const EVENTS_COLUMNS_WIDTH_STORAGE_KEY = "screenEditor.events.columnWidths";
const EVENTS_COLUMN_VISIBILITY_STORAGE_KEY =
  "screenEditor.events.columnVisibility";
const EVENTS_PAGE_SIZE_STORAGE_KEY = "screenEditor.events.pageSize";
const EVENTS_DETAILS_WIDTH_STORAGE_KEY = "screenEditor.events.detailsWidth";
const DEFAULT_PAGE_SIZE = 50;
const MIN_DETAILS_WIDTH = 260;
const MAX_DETAILS_WIDTH = 640;
const DEFAULT_DETAILS_WIDTH = 360;

const PRIORITY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Low (0)" },
  { value: 1, label: "Warning (1)" },
  { value: 2, label: "Alarm (2)" },
  { value: 3, label: "Critical (3)" },
];

const CSV_HEADERS = [
  "id",
  "enabled",
  "categoryId",
  "categoryName",
  "message",
  "priority",
  "sourceTagName",
  "conditionMode",
  "bitTrigger",
  "wordOperator",
  "wordValue",
  "startupDelayMs",
  "requireAck",
  "ackValue",
  "soundEnabled",
  "soundId",
  "textColor",
  "backgroundColor",
  "backgroundBlinkEnabled",
  "backgroundBlinkDurationMs",
  "backgroundBlinkOpacity",
  "ackTagName",
  "notificationTagName",
  "elapsedTimeTagName",
  "securityEnabled",
  "securityTagName",
  "securityBitValue",
  "createdAt",
  "updatedAt",
];

function normalizeBlinkDurationMs(value: unknown, fallback = 1600): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(300, Math.min(10000, Math.round(parsed)));
}

function normalizeBlinkOpacity(value: unknown, fallback = 0.45): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, Math.round(parsed * 100) / 100));
}

function createDefaultColumnVisibility(): EventColumnVisibility {
  return EVENT_COLUMNS.reduce<EventColumnVisibility>(
    (acc, column) => ({ ...acc, [column.id]: true }),
    {
      enabled: true,
      category: true,
      message: true,
      priority: true,
      conditionMode: true,
      trigger: true,
      sourceTagName: true,
      wordValue: true,
      soundEnabled: true,
      soundId: true,
      requireAck: true,
      actions: true,
    },
  );
}

function createDefaultColumnWidths(): Record<EventColumnId, number> {
  return EVENT_COLUMNS.reduce<Record<EventColumnId, number>>(
    (acc, column) => ({ ...acc, [column.id]: column.defaultWidth }),
    {
      enabled: 0,
      category: 0,
      message: 0,
      priority: 0,
      conditionMode: 0,
      trigger: 0,
      sourceTagName: 0,
      wordValue: 0,
      soundEnabled: 0,
      soundId: 0,
      requireAck: 0,
      actions: 0,
    },
  );
}

function parseStoredColumnWidths(
  raw: string | null,
): Record<EventColumnId, number> {
  const defaults = createDefaultColumnWidths();
  if (!raw) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<EventColumnId, unknown>>;
    return EVENT_COLUMNS.reduce<Record<EventColumnId, number>>(
      (acc, column) => {
        const candidate = parsed[column.id];
        acc[column.id] =
          typeof candidate === "number" && Number.isFinite(candidate)
            ? Math.max(column.minWidth, candidate)
            : defaults[column.id];
        return acc;
      },
      { ...defaults },
    );
  } catch {
    return defaults;
  }
}

function parseStoredColumnVisibility(
  raw: string | null,
): EventColumnVisibility {
  const defaults = createDefaultColumnVisibility();
  if (!raw) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<EventColumnId, unknown>>;
    const next = EVENT_COLUMNS.reduce<EventColumnVisibility>(
      (acc, column) => {
        acc[column.id] = parsed[column.id] === false ? false : true;
        return acc;
      },
      { ...defaults },
    );
    next.message = true;
    if (!Object.values(next).some(Boolean)) {
      next.message = true;
    }
    return next;
  } catch {
    return defaults;
  }
}

function parseStoredPageSize(raw: string | null): number {
  const parsed = Number(raw);
  return parsed === 50 || parsed === 100 || parsed === 200 || parsed === 500
    ? parsed
    : DEFAULT_PAGE_SIZE;
}

function clampDetailsWidth(value: number): number {
  return Math.max(MIN_DETAILS_WIDTH, Math.min(MAX_DETAILS_WIDTH, value));
}

function clampPriority(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(3, Math.max(0, Math.round(value)));
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function createEventId(existingIds: Set<string>): string {
  let id = `event_${Math.random().toString(36).slice(2, 8)}`;
  while (existingIds.has(id)) {
    id = `event_${Math.random().toString(36).slice(2, 8)}`;
  }
  return id;
}

function parseOptionalNumber(value: string): number | undefined {
  const text = value.trim();
  if (!text) {
    return undefined;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBooleanText(value: string): boolean | undefined {
  const text = value.trim().toLowerCase();
  if (!text) {
    return undefined;
  }
  if (["1", "true", "yes", "on"].includes(text)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(text)) {
    return false;
  }
  return undefined;
}

function parseAckValueText(value: string): TagScalarValue | undefined {
  const text = value.trim();
  if (!text) {
    return undefined;
  }
  if (text.toLowerCase() === "null") {
    return null;
  }
  if (text.toLowerCase() === "true") {
    return true;
  }
  if (text.toLowerCase() === "false") {
    return false;
  }
  const parsed = Number(text);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return text;
}

function ackValueToText(value: TagScalarValue | undefined): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "undefined") {
    return "";
  }
  return String(value);
}

function securityBitValueToText(
  value: EventDefinition["securityBitValue"],
): EventEditorDraft["securityBitValue"] {
  if (value === true) {
    return "true";
  }
  if (value === false) {
    return "false";
  }
  if (value === 1) {
    return "1";
  }
  if (value === 0) {
    return "0";
  }
  return "";
}

function parseSecurityBitValue(
  value: EventEditorDraft["securityBitValue"],
): EventDefinition["securityBitValue"] {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "1") {
    return 1;
  }
  if (value === "0") {
    return 0;
  }
  return undefined;
}

function toDraft(event: EventDefinition, fallbackId: string): EventEditorDraft {
  const conditionMode = event.conditionMode === "word" ? "word" : "bit";
  return {
    id: normalizeId(event.id) || fallbackId,
    enabled: event.enabled !== false,
    categoryId: event.categoryId ?? "",
    categoryName: event.categoryName?.trim() || "Default",
    priority: clampPriority(
      typeof event.priority === "number" ? event.priority : 0,
    ),
    startupDelayMs:
      typeof event.startupDelayMs === "number" &&
      Number.isFinite(event.startupDelayMs)
        ? Math.max(0, Math.round(event.startupDelayMs))
        : 0,
    sourceTagName: event.sourceTagName ?? "",
    conditionMode,
    bitTrigger: event.bitTrigger ?? "ON",
    wordOperator: event.wordOperator ?? "=",
    wordValue:
      typeof event.wordValue === "number" && Number.isFinite(event.wordValue)
        ? String(event.wordValue)
        : "",
    message: event.message ?? "",
    textColor: event.textColor ?? "",
    backgroundColor: event.backgroundColor ?? "",
    backgroundBlinkEnabled: event.backgroundBlinkEnabled === true,
    backgroundBlinkDurationMs: normalizeBlinkDurationMs(
      event.backgroundBlinkDurationMs,
      1600,
    ),
    backgroundBlinkOpacity: normalizeBlinkOpacity(event.backgroundBlinkOpacity, 0.45),
    requireAck: event.requireAck === true,
    ackValue: ackValueToText(event.ackValue),
    soundEnabled: event.soundEnabled === true,
    soundId: event.soundId ?? "",
    ackTagName: event.ackTagName ?? "",
    notificationTagName: event.notificationTagName ?? "",
    elapsedTimeTagName: event.elapsedTimeTagName ?? "",
    securityEnabled: event.securityEnabled === true,
    securityTagName: event.securityTagName ?? "",
    securityBitValue: securityBitValueToText(event.securityBitValue),
    onActiveActions: (event.onActiveActions ?? []).map((action) => ({ ...action })),
    onClearedActions: (event.onClearedActions ?? []).map((action) => ({ ...action })),
    onAckActions: (event.onAckActions ?? []).map((action) => ({ ...action })),
  };
}

function createDefaultDraft(existingIds: Set<string>): EventEditorDraft {
  return {
    id: createEventId(existingIds),
    enabled: true,
    categoryId: "",
    categoryName: "Default",
    priority: 0,
    startupDelayMs: 0,
    sourceTagName: "",
    conditionMode: "bit",
    bitTrigger: "ON",
    wordOperator: "=",
    wordValue: "",
    message: "",
    textColor: "",
    backgroundColor: "",
    backgroundBlinkEnabled: false,
    backgroundBlinkDurationMs: 1600,
    backgroundBlinkOpacity: 0.45,
    requireAck: false,
    ackValue: "",
    soundEnabled: false,
    soundId: "",
    ackTagName: "",
    notificationTagName: "",
    elapsedTimeTagName: "",
    securityEnabled: false,
    securityTagName: "",
    securityBitValue: "",
    onActiveActions: [],
    onClearedActions: [],
    onAckActions: [],
  };
}

function getPriorityLabel(value: number | undefined): string {
  const priority = clampPriority(typeof value === "number" ? value : 0);
  if (priority === 0) {
    return "Low";
  }
  if (priority === 1) {
    return "Warning";
  }
  if (priority === 2) {
    return "Alarm";
  }
  return "Critical";
}

function getCategoryLabel(event: EventDefinition): string {
  const category = (event.categoryName ?? event.categoryId ?? "").trim();
  return category || "Default";
}

function getTriggerLabel(event: EventDefinition): string {
  if (event.conditionMode === "word") {
    return event.wordOperator ?? "-";
  }
  return event.bitTrigger ?? "-";
}

function getWordValueLabel(event: EventDefinition): string {
  if (event.conditionMode !== "word") {
    return "-";
  }
  return typeof event.wordValue === "number" && Number.isFinite(event.wordValue)
    ? String(event.wordValue)
    : "-";
}

function validateDraft(
  draft: EventEditorDraft,
  existingEvents: EventDefinition[],
  editingIndex: number | null,
): EventDraftErrors {
  const errors: EventDraftErrors = {};
  const id = draft.id.trim();
  if (!id) {
    errors.id = "ID is required";
  } else {
    const duplicateIndex = existingEvents.findIndex(
      (item, index) => normalizeId(item.id) === id && index !== editingIndex,
    );
    if (duplicateIndex >= 0) {
      errors.id = "ID must be unique";
    }
  }

  if (!draft.message.trim()) {
    errors.message = "Message is required";
  }
  if (!draft.sourceTagName.trim()) {
    errors.sourceTagName = "Source tag is required";
  }

  if (draft.conditionMode === "bit") {
    if (!draft.bitTrigger) {
      errors.bitTrigger = "Bit trigger is required";
    }
  } else {
    if (!draft.wordOperator) {
      errors.wordOperator = "Operator is required";
    }
    const word = parseOptionalNumber(draft.wordValue);
    if (typeof word !== "number") {
      errors.wordValue = "Word value is required";
    }
  }

  if (!Number.isFinite(draft.priority)) {
    errors.priority = "Priority is required";
  }

  return errors;
}

function buildEventFromDraft(
  draft: EventEditorDraft,
  previous?: EventDefinition,
): EventDefinition {
  const id = draft.id.trim();
  const conditionMode = draft.conditionMode === "word" ? "word" : "bit";
  const wordValue = parseOptionalNumber(draft.wordValue);
  const ackValue = parseAckValueText(draft.ackValue);

  return {
    ...(previous ?? {}),
    id,
    enabled: draft.enabled,
    categoryId: draft.categoryId.trim() || undefined,
    categoryName: draft.categoryName.trim() || "Default",
    message: draft.message.trim(),
    priority: clampPriority(draft.priority),
    sourceTagName: draft.sourceTagName.trim(),
    startupDelayMs: Math.max(0, Math.round(draft.startupDelayMs || 0)),
    conditionMode,
    bitTrigger: conditionMode === "bit" ? draft.bitTrigger : undefined,
    wordOperator: conditionMode === "word" ? draft.wordOperator : undefined,
    wordValue: conditionMode === "word" ? wordValue : undefined,
    requireAck: draft.requireAck,
    ackValue,
    soundEnabled: draft.soundEnabled,
    soundId: draft.soundEnabled ? draft.soundId.trim() || undefined : undefined,
    textColor: draft.textColor.trim() || undefined,
    backgroundColor: draft.backgroundColor.trim() || undefined,
    backgroundBlinkEnabled: draft.backgroundBlinkEnabled === true,
    backgroundBlinkDurationMs: draft.backgroundBlinkEnabled
      ? normalizeBlinkDurationMs(draft.backgroundBlinkDurationMs, 1600)
      : undefined,
    backgroundBlinkOpacity: draft.backgroundBlinkEnabled
      ? normalizeBlinkOpacity(draft.backgroundBlinkOpacity, 0.45)
      : undefined,
    ackTagName: draft.ackTagName.trim() || undefined,
    notificationTagName: draft.notificationTagName.trim() || undefined,
    elapsedTimeTagName: draft.elapsedTimeTagName.trim() || undefined,
    securityEnabled: draft.securityEnabled,
    securityTagName: draft.securityEnabled
      ? draft.securityTagName.trim() || undefined
      : undefined,
    securityBitValue: draft.securityEnabled
      ? parseSecurityBitValue(draft.securityBitValue)
      : undefined,
    onActiveActions: draft.onActiveActions.length > 0 ? draft.onActiveActions.map((action) => ({ ...action })) : undefined,
    onClearedActions: draft.onClearedActions.length > 0 ? draft.onClearedActions.map((action) => ({ ...action })) : undefined,
    onAckActions: draft.onAckActions.length > 0 ? draft.onAckActions.map((action) => ({ ...action })) : undefined,
    createdAt: previous?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
}

function escapeCsvCell(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function parseCsvText(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (ch === '"') {
      if (inQuotes && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && input[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += ch;
  }

  if (inQuotes) {
    throw new Error("CSV parse error: unterminated quoted field");
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((candidate) =>
    candidate.some((cell) => cell.trim().length > 0),
  );
}

function parseLooseCsvValue(raw: string): unknown {
  const text = raw.trim();
  if (!text) {
    return "";
  }
  if (text.toLowerCase() === "null") {
    return null;
  }
  if (text.toLowerCase() === "true") {
    return true;
  }
  if (text.toLowerCase() === "false") {
    return false;
  }
  const parsed = Number(text);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return text;
}

const EVENT_ACTION_ROLE_OPTIONS = [
  { value: "admin", label: "admin" },
  { value: "engineer", label: "engineer" },
  { value: "operator", label: "operator" },
  { value: "viewer", label: "viewer" },
] as const;

const EVENT_ACTION_LEVEL_OPTIONS = [
  { value: 0, label: "0" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
];

function parseRequiredRoleLevel(value: string): RuntimeAction["requiredRoleLevel"] {
  if (value === "0") {
    return 0;
  }
  if (value === "1") {
    return 1;
  }
  if (value === "2") {
    return 2;
  }
  if (value === "3") {
    return 3;
  }
  if (value === "4") {
    return 4;
  }
  return undefined;
}

function parseRuntimeActionValue(value: string): boolean | number | string | null {
  const text = value.trim();
  if (!text) {
    return "";
  }
  if (text.toLowerCase() === "null") {
    return null;
  }
  if (text.toLowerCase() === "true") {
    return true;
  }
  if (text.toLowerCase() === "false") {
    return false;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return value;
}

function stringifyRuntimeActionValue(value: boolean | number | string | null): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function makeDefaultRuntimeAction(
  type: RuntimeAction["type"],
  screenIds: string[],
  popupIds: string[],
  macroIds: string[],
): RuntimeAction {
  if (type === "write") {
    return { type: "write", tag: "", value: true };
  }
  if (type === "pulse") {
    return { type: "pulse", tag: "", value: true, durationMs: 500 };
  }
  if (type === "toggle") {
    return { type: "toggle", tag: "" };
  }
  if (type === "writeConst") {
    return { type: "writeConst", target: "tag", name: "", value: 0 };
  }
  if (type === "writeNumberPrompt") {
    return { type: "writeNumberPrompt", target: "tag", name: "" };
  }
  if (type === "openScreen") {
    return { type: "openScreen", screenId: screenIds[0] ?? "" };
  }
  if (type === "openPopup") {
    return { type: "openPopup", popupScreenId: popupIds[0] ?? "" };
  }
  if (type === "closePopup") {
    return { type: "closePopup" };
  }
  if (type === "openUrl") {
    return { type: "openUrl", url: "https://example.com", newTab: true };
  }
  if (type === "runMacro") {
    return { type: "runMacro", macroId: macroIds[0] ?? "" };
  }
  if (type === "setLW") {
    return { type: "setLW", address: 0, value: 0 };
  }
  return { type: "setInternalVar", name: "LW.someVar", value: 0 };
}

function parseActionArgs(value: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function describeRuntimeAction(action: RuntimeAction): string {
  if (action.type === "write") {
    return `write ${action.tag}=${stringifyRuntimeActionValue(action.value)}`;
  }
  if (action.type === "pulse") {
    return `pulse ${action.tag} ${action.durationMs}ms`;
  }
  if (action.type === "toggle") {
    return `toggle ${action.tag}`;
  }
  if (action.type === "writeConst") {
    return `writeConst ${action.target}:${action.name}`;
  }
  if (action.type === "writeNumberPrompt") {
    return `writeNumberPrompt ${action.target}:${action.name}`;
  }
  if (action.type === "openScreen") {
    return `openScreen ${action.screenId}`;
  }
  if (action.type === "openPopup") {
    return `openPopup ${action.popupScreenId}`;
  }
  if (action.type === "closePopup") {
    return "closePopup";
  }
  if (action.type === "openUrl") {
    return `openUrl ${action.url}`;
  }
  if (action.type === "runMacro") {
    return `runMacro ${action.macroId}`;
  }
  if (action.type === "setLW") {
    return `setLW ${action.address}`;
  }
  if (action.type === "hold" || action.type === "momentary") {
    return `${action.type} ${action.tag}`;
  }
  return `setInternalVar ${"name" in action ? action.name : ""}`;
}

type EventSoundWarning = {
  code:
    | "missing_sound_id"
    | "unknown_sound_id"
    | "placeholder_sound_file"
    | "missing_sound_file";
  message: string;
};

const SUPPORTED_SOUND_FILE_EXTENSIONS = new Set(["mp3", "wav", "ogg"]);
const DEFAULT_SOUND_PLACEHOLDER_MESSAGE =
  "Built-in SCADA sounds are ready. You can also upload custom sounds.";
const SOUND_FILE_NOT_AVAILABLE_MESSAGE =
  "Sound file is not available. Upload a custom sound or configure a valid sound file.";

function hasPlayableSoundFile(sound: EventSound): boolean {
  return Boolean(
    sound.url?.trim() || sound.assetId?.trim() || sound.filePath?.trim(),
  );
}

function getSoundStatusLabel(sound: EventSound): string {
  if (!hasPlayableSoundFile(sound)) {
    if (isDefaultEventSoundId(sound.id)) {
      return "Bundled file missing";
    }
    return "Missing file";
  }
  return "Ready";
}

function getEventSoundWarning(
  event: EventDefinition,
  soundsById: Map<string, EventSound>,
): EventSoundWarning | null {
  if (!event.soundEnabled) {
    return null;
  }
  const soundId = (event.soundId ?? "").trim();
  if (!soundId) {
    return {
      code: "missing_sound_id",
      message: "Sound is enabled, but Sound ID is not selected.",
    };
  }
  if (!soundsById.has(soundId)) {
    return {
      code: "unknown_sound_id",
      message: `Sound '${soundId}' is missing in project.eventSounds.`,
    };
  }
  const sound = soundsById.get(soundId);
  if (sound && !hasPlayableSoundFile(sound)) {
    if (isDefaultEventSoundId(sound.id)) {
      return {
        code: "placeholder_sound_file",
        message: SOUND_FILE_NOT_AVAILABLE_MESSAGE,
      };
    }
    return {
      code: "missing_sound_file",
      message: `Sound '${sound.name}' has no available file.`,
    };
  }
  return null;
}

function formatSoundKind(kind: EventSound["kind"]): string {
  if (kind === "alarm") {
    return "alarm";
  }
  if (kind === "warning") {
    return "warning";
  }
  if (kind === "custom") {
    return "custom";
  }
  return "notification";
}

function formatSoundSize(sizeBytes: number | undefined): string {
  if (
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes < 0
  ) {
    return "-";
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
}

function normalizeHexColor(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const body = trimmed.slice(1);
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  return fallback;
}

type EventManagerColorFieldProps = {
  label: string;
  value: string;
  fallback: string;
  onChange: (next: string) => void;
  onClear: () => void;
};

function EventManagerColorField({
  label,
  value,
  fallback,
  onChange,
  onClear,
}: EventManagerColorFieldProps) {
  const normalized = normalizeHexColor(value, fallback);
  const hasCustom = value.trim().length > 0;
  return (
    <label className="workbench-field">
      <span className="workbench-field__label">{label}</span>
      <div className="event-manager-color-field">
        <ColorPicker
          value={normalized}
          trigger="click"
          onChangeComplete={(color) => onChange(color.toHexString())}
        >
          <button
            type="button"
            className="trends-settings-color-button"
            title={`${label}: ${normalized}`}
            aria-label={label}
          >
            <span
              className="trends-settings-color-button__swatch"
              style={{ backgroundColor: normalized }}
            />
          </button>
        </ColorPicker>
        <WorkbenchButton
          onClick={onClear}
          disabled={!hasCustom}
          title="Reset to default"
        >
          Reset
        </WorkbenchButton>
      </div>
    </label>
  );
}

type EventTableSoundRuntimeSettings = {
  soundPlaybackMode: "once" | "loopUntilAcknowledged";
  soundRepeatIntervalMs: number;
  stopSoundOnAck: boolean;
  stopSoundOnSilence: boolean;
};

const DEFAULT_EVENT_TABLE_SOUND_RUNTIME_SETTINGS: EventTableSoundRuntimeSettings =
  {
    soundPlaybackMode: "once",
    soundRepeatIntervalMs: 5000,
    stopSoundOnAck: true,
    stopSoundOnSilence: true,
  };

function findFirstEventTableSoundSettings(
  objects: HmiObject[],
): EventTableSoundRuntimeSettings | null {
  for (const object of objects) {
    if (object.type === "eventTable") {
      return {
        soundPlaybackMode:
          object.soundPlaybackMode === "loopUntilAcknowledged"
            ? "loopUntilAcknowledged"
            : "once",
        soundRepeatIntervalMs: Math.max(
          1000,
          Math.min(60000, Math.round(object.soundRepeatIntervalMs ?? 5000)),
        ),
        stopSoundOnAck: object.stopSoundOnAck !== false,
        stopSoundOnSilence: object.stopSoundOnSilence !== false,
      };
    }
    if (object.type === "group") {
      const nested = findFirstEventTableSoundSettings(object.objects);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function patchEventTableSoundSettingsInObjects(
  objects: HmiObject[],
  patch: Partial<EventTableSoundRuntimeSettings>,
): { objects: HmiObject[]; updatedCount: number } {
  let updatedCount = 0;
  const next = objects.map((object) => {
    if (object.type === "eventTable") {
      updatedCount += 1;
      return {
        ...object,
        ...patch,
      };
    }
    if (object.type === "group") {
      const nested = patchEventTableSoundSettingsInObjects(object.objects, patch);
      updatedCount += nested.updatedCount;
      if (nested.updatedCount === 0) {
        return object;
      }
      return {
        ...object,
        objects: nested.objects,
      };
    }
    return object;
  });
  return { objects: next, updatedCount };
}

function isSupportedSoundFile(file: File): boolean {
  const extension = file.name.split(".").at(-1)?.trim().toLowerCase() ?? "";
  return SUPPORTED_SOUND_FILE_EXTENSIONS.has(extension);
}

export function EventsPage() {
  const project = useScadaStore((s) => s.project);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const saveProject = useScadaStore((s) => s.saveProject);

  const [search, setSearch] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<
    "all" | "enabled" | "disabled"
  >("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<
    "all" | "0" | "1" | "2" | "3"
  >("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_PAGE_SIZE;
    }
    return parseStoredPageSize(
      window.localStorage.getItem(EVENTS_PAGE_SIZE_STORAGE_KEY),
    );
  });
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(
    new Set(),
  );
  const [detailsWidth, setDetailsWidth] = useState<number>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_DETAILS_WIDTH;
    }
    const stored = Number(
      window.localStorage.getItem(EVENTS_DETAILS_WIDTH_STORAGE_KEY),
    );
    return Number.isFinite(stored)
      ? clampDetailsWidth(stored)
      : DEFAULT_DETAILS_WIDTH;
  });
  const [isDetailsResizeActive, setIsDetailsResizeActive] = useState(false);
  const [columnsPanelOpen, setColumnsPanelOpen] = useState(false);
  const [columnVisibility, setColumnVisibility] =
    useState<EventColumnVisibility>(() => {
      if (typeof window === "undefined") {
        return createDefaultColumnVisibility();
      }
      return parseStoredColumnVisibility(
        window.localStorage.getItem(EVENTS_COLUMN_VISIBILITY_STORAGE_KEY),
      );
    });
  const [columnWidths, setColumnWidths] = useState<
    Record<EventColumnId, number>
  >(() => {
    if (typeof window === "undefined") {
      return createDefaultColumnWidths();
    }
    return parseStoredColumnWidths(
      window.localStorage.getItem(EVENTS_COLUMNS_WIDTH_STORAGE_KEY),
    );
  });
  const [editorMode, setEditorMode] = useState<EventEditorMode>("view");
  const [editorTab, setEditorTab] = useState<EventEditorTab>("general");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftEvent, setDraftEvent] = useState<EventEditorDraft | null>(null);
  const [draftErrors, setDraftErrors] = useState<EventDraftErrors>({});
  const [selectedActionByTrigger, setSelectedActionByTrigger] = useState<{
    active: number;
    cleared: number;
    ack: number;
  }>({
    active: 0,
    cleared: 0,
    ack: 0,
  });
  const [tagPickerTargetField, setTagPickerTargetField] =
    useState<TagPickerTargetField | null>(null);
  const [activeSection, setActiveSection] =
    useState<EventManagerSection>("events");
  const [statusText, setStatusText] = useState<string>("");
  const [soundLibraryBusy, setSoundLibraryBusy] = useState(false);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const soundUploadInputRef = useRef<HTMLInputElement | null>(null);

  if (!project) {
    return (
      <div className="screen-editor-window-content screen-editor-tags-window">
        <div className="screen-editor-empty-state">Project is not loaded</div>
      </div>
    );
  }

  const events = project.events ?? [];
  const categories = project.eventCategories ?? [];
  const screenIds = useMemo(
    () => project.screens.filter((screen) => screen.kind === "screen").map((screen) => screen.id),
    [project.screens],
  );
  const popupIds = useMemo(
    () => project.screens.filter((screen) => screen.kind === "popup").map((screen) => screen.id),
    [project.screens],
  );
  const macroIds = useMemo(
    () => (project.macros ?? []).map((macro) => macro.id),
    [project.macros],
  );
  const sounds = useMemo(
    () => ensureDefaultEventSounds(project.eventSounds),
    [project.eventSounds],
  );
  const soundsById = useMemo(
    () => new Map(sounds.map((sound) => [sound.id, sound])),
    [sounds],
  );
  const eventTableSoundSettings = useMemo(() => {
    for (const screen of project.screens) {
      const found = findFirstEventTableSoundSettings(screen.objects);
      if (found) {
        return found;
      }
    }
    return DEFAULT_EVENT_TABLE_SOUND_RUNTIME_SETTINGS;
  }, [project.screens]);
  const projectTagIndex = useMemo(
    () => createProjectTagIndex(project),
    [project],
  );
  const missingReferencesAudit = useMemo(
    () => findMissingEventTagReferences(project),
    [project],
  );

  useEffect(() => {
    if (Array.isArray(project.eventSounds) && project.eventSounds.length > 0) {
      return;
    }
    updateProjectJson({
      ...project,
      eventSounds: sounds,
    });
  }, [project, sounds, updateProjectJson]);

  const rows = useMemo<EventRow[]>(() => {
    const seenKeys = new Map<string, number>();
    return events.map((event, index) => {
      const id = normalizeId(event.id);
      const base = id || `row_${index + 1}`;
      const count = (seenKeys.get(base) ?? 0) + 1;
      seenKeys.set(base, count);
      const key = count === 1 ? base : `${base}__${count}`;
      return { key, index, id, event };
    });
  }, [events]);

  const rowWarningsByKey = useMemo(() => {
    const map = new Map<string, EventTagWarning[]>();
    for (const row of rows) {
      map.set(row.key, getEventTagWarnings(row.event, projectTagIndex));
    }
    return map;
  }, [projectTagIndex, rows]);

  const rowMissingWarningsByKey = useMemo(() => {
    const map = new Map<string, EventTagWarning[]>();
    for (const [key, warnings] of rowWarningsByKey.entries()) {
      map.set(
        key,
        warnings.filter(
          (warning) =>
            warning.code === "missing_source" ||
            warning.code === "missing_security" ||
            warning.code === "missing_reference",
        ),
      );
    }
    return map;
  }, [rowWarningsByKey]);

  const rowSoundWarningsByKey = useMemo(() => {
    const map = new Map<string, EventSoundWarning>();
    for (const row of rows) {
      const warning = getEventSoundWarning(row.event, soundsById);
      if (warning) {
        map.set(row.key, warning);
      }
    }
    return map;
  }, [rows, soundsById]);

  const categoryOptions = useMemo(() => {
    const values = new Set<string>(["Default"]);
    for (const category of categories) {
      const byName = category.name?.trim();
      if (byName) {
        values.add(byName);
      }
    }
    for (const row of rows) {
      values.add(getCategoryLabel(row.event));
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [categories, rows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const event = row.event;
      if (enabledFilter === "enabled" && event.enabled === false) {
        return false;
      }
      if (enabledFilter === "disabled" && event.enabled !== false) {
        return false;
      }
      if (
        priorityFilter !== "all" &&
        clampPriority(
          typeof event.priority === "number" ? event.priority : 0,
        ) !== Number(priorityFilter)
      ) {
        return false;
      }
      if (
        categoryFilter !== "all" &&
        getCategoryLabel(event) !== categoryFilter
      ) {
        return false;
      }
      if (!term) {
        return true;
      }
      const fields = [
        row.id,
        getCategoryLabel(event),
        event.message ?? "",
        event.sourceTagName ?? "",
        event.soundId ?? "",
        event.ackTagName ?? "",
        event.notificationTagName ?? "",
      ];
      return fields.some((field) => field.toLowerCase().includes(term));
    });
  }, [categoryFilter, enabledFilter, priorityFilter, rows, search]);

  const filteredKeys = useMemo(
    () => new Set(filteredRows.map((row) => row.key)),
    [filteredRows],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      EVENTS_COLUMNS_WIDTH_STORAGE_KEY,
      JSON.stringify(columnWidths),
    );
  }, [columnWidths]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      EVENTS_COLUMN_VISIBILITY_STORAGE_KEY,
      JSON.stringify(columnVisibility),
    );
  }, [columnVisibility]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(EVENTS_PAGE_SIZE_STORAGE_KEY, String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      EVENTS_DETAILS_WIDTH_STORAGE_KEY,
      String(detailsWidth),
    );
  }, [detailsWidth]);

  useEffect(() => {
    setSelectedRowKeys((prev) => {
      const next = new Set<string>();
      for (const key of prev) {
        if (rows.some((row) => row.key === key)) {
          next.add(key);
        }
      }
      return next;
    });

    if (!activeRowKey || !rows.some((row) => row.key === activeRowKey)) {
      setActiveRowKey(rows[0]?.key ?? null);
      if (editorMode === "edit") {
        setEditorMode("view");
        setEditingIndex(null);
        setDraftEvent(null);
        setDraftErrors({});
      }
    }
  }, [activeRowKey, editorMode, rows]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    setPage((prev) => Math.min(Math.max(1, prev), totalPages));
  }, [filteredRows.length, pageSize]);

  const visibleColumns = EVENT_COLUMNS.filter(
    (column) => columnVisibility[column.id] !== false,
  );
  const tableGridTemplateColumns = [
    "42px",
    ...visibleColumns.map(
      (column) => `${Math.max(column.minWidth, columnWidths[column.id])}px`,
    ),
  ].join(" ");

  const totalRows = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageRows = filteredRows.slice(pageStart, pageStart + pageSize);

  const totalEnabledCount = events.filter(
    (item) => item.enabled !== false,
  ).length;
  const totalDisabledCount = events.length - totalEnabledCount;
  const selectedFilteredCount = [...selectedRowKeys].filter((key) =>
    filteredKeys.has(key),
  ).length;

  const activeRow =
    rows.find((row) => row.key === activeRowKey) ?? pageRows[0] ?? null;
  const activeRowMissingWarnings = activeRow
    ? (rowMissingWarningsByKey.get(activeRow.key) ?? [])
    : [];
  const activeRowSoundWarning = activeRow
    ? (rowSoundWarningsByKey.get(activeRow.key) ?? null)
    : null;
  const missingReferenceCount = missingReferencesAudit.length;

  const existingIds = useMemo(() => {
    const values = new Set<string>();
    for (const event of events) {
      const id = normalizeId(event.id);
      if (id) {
        values.add(id);
      }
    }
    return values;
  }, [events]);

  const saveEvents = useCallback(
    (nextEvents: EventDefinition[]) => {
      updateProjectJson({
        ...project,
        events: nextEvents,
      });
    },
    [project, updateProjectJson],
  );

  const saveEventSounds = useCallback(
    (nextSounds: EventSound[]) => {
      updateProjectJson({
        ...project,
        eventSounds: nextSounds,
      });
    },
    [project, updateProjectJson],
  );

  const applyEventTableSoundSettings = useCallback(
    (patch: Partial<EventTableSoundRuntimeSettings>) => {
      let updatedCount = 0;
      const nextScreens = project.screens.map((screen) => {
        const patched = patchEventTableSoundSettingsInObjects(
          screen.objects,
          patch,
        );
        updatedCount += patched.updatedCount;
        if (patched.updatedCount === 0) {
          return screen;
        }
        return {
          ...screen,
          objects: patched.objects,
        };
      });
      if (updatedCount === 0) {
        setStatusText("No EventTable objects found in project screens.");
        return;
      }
      updateProjectJson({
        ...project,
        screens: nextScreens,
      });
      setStatusText(`Updated EventTable sound mode in ${updatedCount} object(s).`);
    },
    [project, updateProjectJson],
  );

  const testSound = useCallback(
    async (soundId: string) => {
      const selectedSoundId = soundId.trim();
      if (!selectedSoundId) {
        setStatusText("Select a sound first.");
        return;
      }
      const selectedSound = soundsById.get(selectedSoundId);
      if (
        selectedSound &&
        isDefaultEventSoundId(selectedSound.id) &&
        !hasPlayableSoundFile(selectedSound)
      ) {
        setStatusText("Default bundled sound file is missing");
        return;
      }
      const result = await eventSoundPlayer.playSound(selectedSoundId, sounds);
      if (!result.ok) {
        if (result.reason === "autoplay_blocked") {
          setStatusText("Browser blocked playback. Click Enable sounds.");
          return;
        }
        setStatusText(result.message);
        return;
      }
      setStatusText(`Playing sound: ${selectedSoundId}`);
    },
    [sounds, soundsById],
  );

  const enableSounds = useCallback(async () => {
    const result = await eventSoundPlayer.enableSoundsWithUserGesture();
    if (!result.ok) {
      setStatusText(result.message);
      return;
    }
    setStatusText("Sounds are enabled for this browser session.");
  }, []);

  const uploadSound = useCallback(
    async (file: File) => {
      if (!isSupportedSoundFile(file)) {
        setStatusText("Unsupported file type");
        return;
      }
      setSoundLibraryBusy(true);
      try {
        const uploaded = await api.uploadEventSound(file);
        saveEventSounds([...sounds, uploaded]);
        setStatusText("Sound uploaded");
      } catch (error) {
        const text =
          error instanceof Error ? error.message : "Failed to upload sound";
        setStatusText(text);
      } finally {
        setSoundLibraryBusy(false);
      }
    },
    [saveEventSounds, sounds],
  );

  const renameSound = useCallback(
    async (sound: EventSound) => {
      if (sound.kind !== "custom" || isDefaultEventSoundId(sound.id)) {
        setStatusText("Only custom sounds can be renamed.");
        return;
      }
      const nextName = window.prompt("Rename sound", sound.name)?.trim() ?? "";
      if (!nextName || nextName === sound.name) {
        return;
      }
      setSoundLibraryBusy(true);
      try {
        const updated = await api.renameEventSound(sound.id, nextName);
        saveEventSounds(
          sounds.map((item) => (item.id === updated.id ? updated : item)),
        );
        setStatusText("Sound renamed");
      } catch (error) {
        const text =
          error instanceof Error ? error.message : "Failed to rename sound";
        setStatusText(text);
      } finally {
        setSoundLibraryBusy(false);
      }
    },
    [saveEventSounds, sounds],
  );

  const deleteSound = useCallback(
    async (sound: EventSound) => {
      if (sound.kind !== "custom" || isDefaultEventSoundId(sound.id)) {
        setStatusText("Only custom sounds can be deleted.");
        return;
      }
      if (!window.confirm(`Delete sound '${sound.name}'?`)) {
        return;
      }
      setSoundLibraryBusy(true);
      try {
        await api.deleteEventSound(sound.id);
        saveEventSounds(sounds.filter((item) => item.id !== sound.id));
        setStatusText("Sound deleted");
      } catch (error) {
        const text =
          error instanceof Error ? error.message : "Failed to delete sound";
        setStatusText(text);
      } finally {
        setSoundLibraryBusy(false);
      }
    },
    [saveEventSounds, sounds],
  );

  const refreshSounds = useCallback(async () => {
    setSoundLibraryBusy(true);
    try {
      const listed = await api.listEventSounds();
      saveEventSounds(ensureDefaultEventSounds(listed));
      setStatusText("Sound library refreshed");
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Failed to refresh sounds";
      setStatusText(text);
    } finally {
      setSoundLibraryBusy(false);
    }
  }, [saveEventSounds]);

  const openAdd = () => {
    setDraftEvent(createDefaultDraft(existingIds));
    setSelectedActionByTrigger({ active: 0, cleared: 0, ack: 0 });
    setDraftErrors({});
    setEditorMode("add");
    setEditorTab("general");
    setEditingIndex(null);
    setTagPickerTargetField(null);
  };

  const openEdit = useCallback(
    (row: EventRow) => {
      const fallbackId = row.id || createEventId(existingIds);
      setDraftEvent(toDraft(row.event, fallbackId));
      setSelectedActionByTrigger({ active: 0, cleared: 0, ack: 0 });
      setDraftErrors({});
      setEditorMode("edit");
      setEditorTab("general");
      setEditingIndex(row.index);
      setActiveRowKey(row.key);
      setTagPickerTargetField(null);
    },
    [existingIds],
  );

  const cancelEditor = () => {
    setEditorMode("view");
    setEditingIndex(null);
    setDraftEvent(null);
    setSelectedActionByTrigger({ active: 0, cleared: 0, ack: 0 });
    setDraftErrors({});
    setTagPickerTargetField(null);
  };

  const duplicateRow = useCallback(
    (row: EventRow) => {
      const ids = new Set(existingIds);
      const copyId = createEventId(ids);
      const baseDraft = toDraft(row.event, copyId);
      baseDraft.id = copyId;
      const nextEvent = buildEventFromDraft(baseDraft, undefined);
      const nextEvents = [...events];
      nextEvents.splice(row.index + 1, 0, nextEvent);
      saveEvents(nextEvents);
      setStatusText(
        `Duplicated event ${row.id || `(row ${row.index + 1})`} as ${copyId}`,
      );
    },
    [events, existingIds, saveEvents],
  );

  const deleteRowsByKey = useCallback(
    (keys: Set<string>, reason: string) => {
      if (keys.size === 0) {
        return;
      }
      const nextEvents = rows
        .filter((row) => !keys.has(row.key))
        .map((row) => row.event);
      saveEvents(nextEvents);
      setSelectedRowKeys((prev) => {
        const next = new Set<string>(prev);
        for (const key of keys) {
          next.delete(key);
        }
        return next;
      });
      setStatusText(reason);
    },
    [rows, saveEvents],
  );

  const deleteSelected = () => {
    if (selectedRowKeys.size === 0) {
      return;
    }
    if (!window.confirm(`Delete ${selectedRowKeys.size} selected event(s)?`)) {
      return;
    }
    deleteRowsByKey(
      new Set(selectedRowKeys),
      `Deleted ${selectedRowKeys.size} selected event(s)`,
    );
  };

  const deleteFiltered = () => {
    if (filteredRows.length === 0) {
      return;
    }
    if (!window.confirm(`Delete ${filteredRows.length} filtered event(s)?`)) {
      return;
    }
    deleteRowsByKey(
      new Set(filteredRows.map((row) => row.key)),
      `Deleted ${filteredRows.length} filtered event(s)`,
    );
  };

  const clearAll = () => {
    if (events.length === 0) {
      return;
    }
    if (!window.confirm(`Clear all ${events.length} events?`)) {
      return;
    }
    saveEvents([]);
    setSelectedRowKeys(new Set());
    setStatusText("Cleared all events");
  };

  const deleteOne = (row: EventRow) => {
    if (
      !window.confirm(`Delete event ${row.id || `(row ${row.index + 1})`}?`)
    ) {
      return;
    }
    deleteRowsByKey(
      new Set([row.key]),
      `Deleted event ${row.id || `(row ${row.index + 1})`}`,
    );
  };

  const startDetailsResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = detailsWidth;
      setIsDetailsResizeActive(true);
      const onMove = (moveEvent: MouseEvent) => {
        const delta = startX - moveEvent.clientX;
        const next = clampDetailsWidth(startWidth + delta);
        setDetailsWidth(next);
        bodyRef.current?.style.setProperty("--tags-details-width", `${next}px`);
      };
      const onUp = () => {
        setIsDetailsResizeActive(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [detailsWidth],
  );

  const startColumnResize = useCallback(
    (event: ReactMouseEvent<HTMLSpanElement>, columnId: EventColumnId) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = columnWidths[columnId];
      const minWidth =
        EVENT_COLUMNS.find((column) => column.id === columnId)?.minWidth ?? 80;
      const onMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        setColumnWidths((prev) => ({
          ...prev,
          [columnId]: Math.max(minWidth, startWidth + delta),
        }));
      };
      const onUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [columnWidths],
  );

  const toggleRowSelection = (key: string) => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    if (filteredRows.length === 0) {
      return;
    }
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      const allSelected = filteredRows.every((row) => next.has(row.key));
      if (allSelected) {
        for (const row of filteredRows) {
          next.delete(row.key);
        }
      } else {
        for (const row of filteredRows) {
          next.add(row.key);
        }
      }
      return next;
    });
  };

  const resetWidths = () => {
    setDetailsWidth(DEFAULT_DETAILS_WIDTH);
    setColumnWidths(createDefaultColumnWidths());
  };

  const setDraftPatch = (patch: Partial<EventEditorDraft>) => {
    setDraftEvent((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  type EventActionField = "onActiveActions" | "onClearedActions" | "onAckActions";
  type EventActionSelectionKey = "active" | "cleared" | "ack";

  const getActionSelectionIndex = (selection: EventActionSelectionKey, length: number): number => {
    const rawIndex = selectedActionByTrigger[selection];
    if (length <= 0) {
      return -1;
    }
    return Math.max(0, Math.min(length - 1, rawIndex));
  };

  const patchEventActionList = (field: EventActionField, updater: (list: RuntimeAction[]) => RuntimeAction[]) => {
    setDraftEvent((prev) => {
      if (!prev) {
        return prev;
      }
      const current = prev[field] ?? [];
      return {
        ...prev,
        [field]: updater(current),
      };
    });
  };

  const addEventAction = (field: EventActionField, selection: EventActionSelectionKey) => {
    patchEventActionList(field, (list) => [
      ...list,
      makeDefaultRuntimeAction("write", screenIds, popupIds, macroIds),
    ]);
    setSelectedActionByTrigger((prev) => ({
      ...prev,
      [selection]: (draftEvent?.[field].length ?? 0),
    }));
  };

  const updateEventAction = (
    field: EventActionField,
    index: number,
    updater: (action: RuntimeAction) => RuntimeAction,
  ) => {
    patchEventActionList(field, (list) =>
      list.map((action, actionIndex) => (actionIndex === index ? updater(action) : action)),
    );
  };

  const removeEventAction = (field: EventActionField, selection: EventActionSelectionKey, index: number) => {
    patchEventActionList(field, (list) => list.filter((_, actionIndex) => actionIndex !== index));
    setSelectedActionByTrigger((prev) => ({
      ...prev,
      [selection]: Math.max(0, prev[selection] - (index <= prev[selection] ? 1 : 0)),
    }));
  };

  const moveEventAction = (
    field: EventActionField,
    selection: EventActionSelectionKey,
    index: number,
    direction: -1 | 1,
  ) => {
    patchEventActionList(field, (list) => {
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= list.length) {
        return list;
      }
      const next = [...list];
      const current = next[index];
      const target = next[nextIndex];
      if (!current || !target) {
        return list;
      }
      next[index] = target;
      next[nextIndex] = current;
      return next;
    });
    setSelectedActionByTrigger((prev) => ({
      ...prev,
      [selection]: Math.max(0, prev[selection] + direction),
    }));
  };

  const renderEventActionFields = (
    field: EventActionField,
    index: number,
    action: RuntimeAction,
  ): ReactNode => {
    const patch = (nextAction: RuntimeAction) => {
      updateEventAction(field, index, () => nextAction);
    };

    return (
      <div className="event-actions-editor__fields">
        <label className="workbench-field">
          <span className="workbench-field__label">Action Type</span>
          <select
            className="workbench-select"
            value={action.type}
            onChange={(event) =>
              patch(
                makeDefaultRuntimeAction(
                  event.target.value as RuntimeAction["type"],
                  screenIds,
                  popupIds,
                  macroIds,
                ),
              )
            }
          >
            <option value="write">write</option>
            <option value="pulse">pulse</option>
            <option value="toggle">toggle</option>
            <option value="writeConst">writeConst</option>
            <option value="writeNumberPrompt">writeNumberPrompt</option>
            <option value="openScreen">openScreen</option>
            <option value="openPopup">openPopup</option>
            <option value="closePopup">closePopup</option>
            <option value="openUrl">openUrl</option>
            <option value="runMacro">runMacro</option>
            <option value="setLW">setLW</option>
            <option value="setInternalVar">setInternalVar</option>
          </select>
        </label>

        {action.type === "write" || action.type === "toggle" || action.type === "pulse" ? (
          <label className="workbench-field">
            <span className="workbench-field__label">Tag</span>
            <input
              className="workbench-input"
              value={action.tag}
              onChange={(event) => patch({ ...action, tag: event.target.value })}
            />
          </label>
        ) : null}

        {action.type === "write" || action.type === "pulse" ? (
          <label className="workbench-field">
            <span className="workbench-field__label">Value</span>
            <input
              className="workbench-input"
              value={stringifyRuntimeActionValue(action.value)}
              onChange={(event) => patch({ ...action, value: parseRuntimeActionValue(event.target.value) })}
            />
          </label>
        ) : null}

        {action.type === "pulse" ? (
          <label className="workbench-field">
            <span className="workbench-field__label">Duration (ms)</span>
            <input
              className="workbench-input"
              type="number"
              min={1}
              value={action.durationMs}
              onChange={(event) => patch({ ...action, durationMs: Math.max(1, Number(event.target.value) || 1) })}
            />
          </label>
        ) : null}

        {action.type === "writeConst" || action.type === "writeNumberPrompt" ? (
          <label className="workbench-field">
            <span className="workbench-field__label">Target</span>
            <select
              className="workbench-select"
              value={action.target}
              onChange={(event) => patch({ ...action, target: event.target.value as "tag" | "variable" })}
            >
              <option value="tag">tag</option>
              <option value="variable">variable</option>
            </select>
          </label>
        ) : null}

        {action.type === "writeConst" || action.type === "writeNumberPrompt" ? (
          <label className="workbench-field">
            <span className="workbench-field__label">Name</span>
            <input
              className="workbench-input"
              value={action.name}
              onChange={(event) => patch({ ...action, name: event.target.value })}
            />
          </label>
        ) : null}

        {action.type === "writeConst" ? (
          <label className="workbench-field">
            <span className="workbench-field__label">Value</span>
            <input
              className="workbench-input"
              value={stringifyRuntimeActionValue(action.value)}
              onChange={(event) => patch({ ...action, value: parseRuntimeActionValue(event.target.value) })}
            />
          </label>
        ) : null}

        {action.type === "writeNumberPrompt" ? (
          <div className="event-actions-editor__inline-grid">
            <label className="workbench-field">
              <span className="workbench-field__label">Min</span>
              <input
                className="workbench-input"
                type="number"
                value={typeof action.min === "number" ? action.min : ""}
                onChange={(event) => patch({
                  ...action,
                  min: event.target.value.trim() ? Number(event.target.value) : undefined,
                })}
              />
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Max</span>
              <input
                className="workbench-input"
                type="number"
                value={typeof action.max === "number" ? action.max : ""}
                onChange={(event) => patch({
                  ...action,
                  max: event.target.value.trim() ? Number(event.target.value) : undefined,
                })}
              />
            </label>
          </div>
        ) : null}

        {action.type === "openScreen" ? (
          <label className="workbench-field">
            <span className="workbench-field__label">Screen</span>
            <select
              className="workbench-select"
              value={action.screenId}
              onChange={(event) => patch({ ...action, screenId: event.target.value })}
            >
              <option value="">(none)</option>
              {screenIds.map((screenId) => (
                <option key={screenId} value={screenId}>
                  {screenId}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {action.type === "openPopup" ? (
          <>
            <label className="workbench-field">
              <span className="workbench-field__label">Popup</span>
              <select
                className="workbench-select"
                value={action.popupScreenId}
                onChange={(event) => patch({ ...action, popupScreenId: event.target.value })}
              >
                <option value="">(none)</option>
                {popupIds.map((popupId) => (
                  <option key={popupId} value={popupId}>
                    {popupId}
                  </option>
                ))}
              </select>
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Title</span>
              <input
                className="workbench-input"
                value={action.title ?? ""}
                onChange={(event) => patch({ ...action, title: event.target.value || undefined })}
              />
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Tag Prefix</span>
              <input
                className="workbench-input"
                value={action.tagPrefix ?? ""}
                onChange={(event) => patch({ ...action, tagPrefix: event.target.value || undefined })}
              />
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Args (JSON)</span>
              <textarea
                className="workbench-input event-actions-editor__textarea"
                rows={3}
                value={JSON.stringify(action.args ?? {}, null, 2)}
                onChange={(event) => patch({ ...action, args: parseActionArgs(event.target.value) })}
              />
            </label>
          </>
        ) : null}

        {action.type === "closePopup" ? (
          <label className="workbench-field">
            <span className="workbench-field__label">Popup Instance ID (optional)</span>
            <input
              className="workbench-input"
              value={action.popupInstanceId ?? ""}
              onChange={(event) => patch({ ...action, popupInstanceId: event.target.value || undefined })}
            />
          </label>
        ) : null}

        {action.type === "openUrl" ? (
          <>
            <label className="workbench-field">
              <span className="workbench-field__label">URL</span>
              <input
                className="workbench-input"
                value={action.url}
                onChange={(event) => patch({ ...action, url: event.target.value })}
              />
            </label>
            <label className="workbench-field">
              <label className="screen-editor-tags-checkbox-field">
                <input
                  type="checkbox"
                  checked={action.newTab !== false}
                  onChange={(event) => patch({ ...action, newTab: event.target.checked })}
                />
                <span>Open in new tab</span>
              </label>
            </label>
          </>
        ) : null}

        {action.type === "runMacro" ? (
          <>
            <label className="workbench-field">
              <span className="workbench-field__label">Macro</span>
              <select
                className="workbench-select"
                value={action.macroId}
                onChange={(event) => patch({ ...action, macroId: event.target.value })}
              >
                <option value="">(none)</option>
                {macroIds.map((macroId) => (
                  <option key={macroId} value={macroId}>
                    {macroId}
                  </option>
                ))}
              </select>
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Args (JSON)</span>
              <textarea
                className="workbench-input event-actions-editor__textarea"
                rows={3}
                value={JSON.stringify(action.args ?? {}, null, 2)}
                onChange={(event) => patch({ ...action, args: parseActionArgs(event.target.value) })}
              />
            </label>
            <label className="workbench-field">
              <label className="screen-editor-tags-checkbox-field">
                <input
                  type="checkbox"
                  checked={action.allowRepeat === true}
                  onChange={(event) => patch({ ...action, allowRepeat: event.target.checked || undefined })}
                />
                <span>Allow Repeat</span>
              </label>
            </label>
          </>
        ) : null}

        {action.type === "setLW" ? (
          <>
            <label className="workbench-field">
              <span className="workbench-field__label">Address</span>
              <input
                className="workbench-input"
                type="number"
                min={0}
                value={action.address}
                onChange={(event) => patch({ ...action, address: Math.max(0, Number(event.target.value) || 0) })}
              />
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Value</span>
              <input
                className="workbench-input"
                value={stringifyRuntimeActionValue(action.value)}
                onChange={(event) => patch({ ...action, value: parseRuntimeActionValue(event.target.value) })}
              />
            </label>
          </>
        ) : null}

        {action.type === "setInternalVar" ? (
          <>
            <label className="workbench-field">
              <span className="workbench-field__label">Variable</span>
              <input
                className="workbench-input"
                value={action.name}
                onChange={(event) => patch({ ...action, name: event.target.value })}
              />
            </label>
            <label className="workbench-field">
              <span className="workbench-field__label">Value</span>
              <input
                className="workbench-input"
                value={stringifyRuntimeActionValue(action.value)}
                onChange={(event) => patch({ ...action, value: parseRuntimeActionValue(event.target.value) })}
              />
            </label>
          </>
        ) : null}

        <div className="event-actions-editor__inline-grid">
          <label className="workbench-field">
            <label className="screen-editor-tags-checkbox-field">
              <input
                type="checkbox"
                checked={action.requireAuth === true}
                onChange={(event) => patch({ ...action, requireAuth: event.target.checked || undefined })}
              />
              <span>Require Auth</span>
            </label>
          </label>
          <label className="workbench-field">
            <span className="workbench-field__label">Role Level</span>
            <select
              className="workbench-select"
              value={typeof action.requiredRoleLevel === "number" ? String(action.requiredRoleLevel) : ""}
              onChange={(event) => patch({
                ...action,
                requiredRoleLevel: parseRequiredRoleLevel(event.target.value),
              })}
            >
              <option value="">(none)</option>
              {EVENT_ACTION_LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="workbench-field">
          <span className="workbench-field__label">Required Roles</span>
          <select
            className="workbench-select"
            multiple
            value={action.requiredRoles ?? []}
            onChange={(event) => {
              const nextRoles = Array.from(event.target.selectedOptions).map((option) => option.value);
              patch({
                ...action,
                requiredRoles: nextRoles.length > 0 ? (nextRoles as RuntimeAction["requiredRoles"]) : undefined,
              });
            }}
          >
            {EVENT_ACTION_ROLE_OPTIONS.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  };

  const renderActionSection = (
    title: string,
    field: EventActionField,
    selection: EventActionSelectionKey,
  ): ReactNode => {
    if (!draftEvent) {
      return null;
    }
    const list = draftEvent[field];
    const selectedIndex = getActionSelectionIndex(selection, list.length);
    const selectedAction = selectedIndex >= 0 ? list[selectedIndex] : undefined;

    return (
      <div className="event-actions-editor__section">
        <div className="event-actions-editor__section-header">
          <strong>{title}</strong>
          <WorkbenchButton onClick={() => addEventAction(field, selection)}>Add Action</WorkbenchButton>
        </div>
        {list.length === 0 ? (
          <span className="screen-editor-tag-editor__hint">No actions configured.</span>
        ) : (
          <div className="event-actions-editor__list">
            {list.map((action, index) => (
              <button
                key={`${field}-${index}`}
                type="button"
                className={[
                  "event-actions-editor__item",
                  selectedIndex === index ? "event-actions-editor__item--active" : "",
                ].join(" ")}
                onClick={() => setSelectedActionByTrigger((prev) => ({ ...prev, [selection]: index }))}
              >
                <span>{index + 1}.</span>
                <span>{describeRuntimeAction(action)}</span>
              </button>
            ))}
          </div>
        )}

        {selectedAction ? (
          <div className="event-actions-editor__edit">
            <div className="event-actions-editor__controls">
              <WorkbenchButton
                onClick={() => moveEventAction(field, selection, selectedIndex, -1)}
                disabled={selectedIndex <= 0}
              >
                Up
              </WorkbenchButton>
              <WorkbenchButton
                onClick={() => moveEventAction(field, selection, selectedIndex, 1)}
                disabled={selectedIndex < 0 || selectedIndex >= list.length - 1}
              >
                Down
              </WorkbenchButton>
              <WorkbenchButton
                variant="danger"
                onClick={() => removeEventAction(field, selection, selectedIndex)}
              >
                Delete
              </WorkbenchButton>
            </div>
            {renderEventActionFields(field, selectedIndex, selectedAction)}
          </div>
        ) : null}
      </div>
    );
  };

  const draftEventWarnings = useMemo(() => {
    if (!draftEvent) {
      return [];
    }
    const preview = buildEventFromDraft(
      {
        ...draftEvent,
        categoryName: draftEvent.categoryName.trim() || "Default",
        priority: clampPriority(draftEvent.priority),
        conditionMode: draftEvent.conditionMode === "word" ? "word" : "bit",
      },
      editorMode === "edit" && editingIndex !== null
        ? events[editingIndex]
        : undefined,
    );
    return getEventTagWarnings(preview, projectTagIndex);
  }, [draftEvent, editorMode, editingIndex, events, projectTagIndex]);

  const draftSoundWarning = useMemo(() => {
    if (!draftEvent) {
      return null;
    }
    const preview = buildEventFromDraft(
      {
        ...draftEvent,
        categoryName: draftEvent.categoryName.trim() || "Default",
        priority: clampPriority(draftEvent.priority),
        conditionMode: draftEvent.conditionMode === "word" ? "word" : "bit",
      },
      editorMode === "edit" && editingIndex !== null
        ? events[editingIndex]
        : undefined,
    );
    return getEventSoundWarning(preview, soundsById);
  }, [draftEvent, editorMode, editingIndex, events, soundsById]);

  const draftWarningsByField = useMemo(() => {
    const map = new Map<EventTagReferenceField, EventTagWarning[]>();
    for (const warning of draftEventWarnings) {
      const existing = map.get(warning.field) ?? [];
      existing.push(warning);
      map.set(warning.field, existing);
    }
    return map;
  }, [draftEventWarnings]);

  const renderFieldError = (field: keyof EventEditorDraft) => {
    const error = draftErrors[field];
    if (!error) {
      return null;
    }
    return <span className="workbench-field__error">{error}</span>;
  };

  const renderFieldWarnings = (field: EventTagReferenceField) => {
    const warnings = draftWarningsByField.get(field) ?? [];
    if (warnings.length === 0) {
      return null;
    }
    return (
      <>
        {warnings.map((warning, index) => (
          <span
            key={`${field}-${warning.code}-${index}`}
            className="screen-editor-tag-editor__hint screen-editor-tag-editor__hint--warning"
          >
            {warning.message}
          </span>
        ))}
      </>
    );
  };

  const openTagPickerForField = (field: TagPickerTargetField) => {
    setTagPickerTargetField(field);
  };

  const applyTagPickerSelection = (tagName: string | undefined) => {
    if (!tagPickerTargetField) {
      return;
    }
    setDraftPatch({
      [tagPickerTargetField]: tagName ?? "",
    } as Partial<EventEditorDraft>);
  };

  const renderTagReferenceInput = (
    field: TagPickerTargetField,
    label: string,
    options?: {
      disabled?: boolean;
      requiredErrorField?: keyof EventEditorDraft;
    },
  ) => {
    if (!draftEvent) {
      return null;
    }
    return (
      <label className="workbench-field">
        <span className="workbench-field__label">{label}</span>
        <div className="event-tag-reference-field">
          <input
            className="workbench-input event-tag-reference-field__input"
            value={draftEvent[field]}
            onChange={(event) =>
              setDraftPatch({
                [field]: event.target.value,
              } as Partial<EventEditorDraft>)
            }
            disabled={options?.disabled}
          />
          <button
            type="button"
            className="workbench-button"
            onClick={() => openTagPickerForField(field)}
            disabled={options?.disabled}
          >
            <span className="workbench-button__label">Select...</span>
          </button>
        </div>
        {options?.requiredErrorField
          ? renderFieldError(options.requiredErrorField)
          : null}
        {renderFieldWarnings(field)}
      </label>
    );
  };

  const saveDraft = () => {
    if (!draftEvent) {
      return;
    }

    const normalizedDraft: EventEditorDraft = {
      ...draftEvent,
      categoryName: draftEvent.categoryName.trim() || "Default",
      priority: clampPriority(draftEvent.priority),
      conditionMode: draftEvent.conditionMode === "word" ? "word" : "bit",
    };

    const errors = validateDraft(
      normalizedDraft,
      events,
      editorMode === "edit" ? editingIndex : null,
    );
    setDraftErrors(errors);
    if (Object.keys(errors).length > 0) {
      appToast.error("Save failed", { details: "Check highlighted fields" });
      return;
    }

    const nextEvent = buildEventFromDraft(
      normalizedDraft,
      editorMode === "edit" && editingIndex !== null
        ? events[editingIndex]
        : undefined,
    );

    if (editorMode === "edit" && editingIndex !== null) {
      const nextEvents = [...events];
      nextEvents[editingIndex] = nextEvent;
      const reconciled = reconcileEventsWithProjectTags(nextEvents, project);
      saveEvents(reconciled.nextEvents);
      const autoDisabledText = reconciled.changed
        ? " Source/security tag is missing, event was disabled."
        : "";
      setStatusText(`Updated event ${nextEvent.id}.${autoDisabledText}`);
      appToast.success("Saved");
    } else {
      const nextEvents = [...events, nextEvent];
      const reconciled = reconcileEventsWithProjectTags(nextEvents, project);
      saveEvents(reconciled.nextEvents);
      const autoDisabledText = reconciled.changed
        ? " Source/security tag is missing, event was disabled."
        : "";
      setStatusText(`Added event ${nextEvent.id}.${autoDisabledText}`);
      appToast.success("Saved");
    }

    setEditorMode("view");
    setEditingIndex(null);
    setDraftEvent(null);
    setDraftErrors({});
    setTagPickerTargetField(null);
  };

  const exportCsv = () => {
    const csv = [
      CSV_HEADERS,
      ...events.map((event) => [
        event.id,
        event.enabled === false ? "false" : "true",
        event.categoryId ?? "",
        event.categoryName ?? "",
        event.message ?? "",
        typeof event.priority === "number" ? event.priority : 0,
        event.sourceTagName ?? "",
        event.conditionMode ?? "bit",
        event.bitTrigger ?? "",
        event.wordOperator ?? "",
        typeof event.wordValue === "number" ? event.wordValue : "",
        typeof event.startupDelayMs === "number" ? event.startupDelayMs : 0,
        event.requireAck ? "true" : "false",
        ackValueToText(event.ackValue),
        event.soundEnabled ? "true" : "false",
        event.soundId ?? "",
        event.textColor ?? "",
        event.backgroundColor ?? "",
        event.backgroundBlinkEnabled ? "true" : "false",
        typeof event.backgroundBlinkDurationMs === "number"
          ? event.backgroundBlinkDurationMs
          : "",
        typeof event.backgroundBlinkOpacity === "number"
          ? event.backgroundBlinkOpacity
          : "",
        event.ackTagName ?? "",
        event.notificationTagName ?? "",
        event.elapsedTimeTagName ?? "",
        event.securityEnabled ? "true" : "false",
        event.securityTagName ?? "",
        typeof event.securityBitValue === "undefined"
          ? ""
          : String(event.securityBitValue),
        event.createdAt ?? "",
        event.updatedAt ?? "",
      ]),
    ]
      .map((line) => line.map((cell) => escapeCsvCell(cell)).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "events.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusText(`Exported ${events.length} event(s)`);
  };

  const importCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const rowsFromCsv = parseCsvText(text);
        if (rowsFromCsv.length === 0) {
          setStatusText("CSV file is empty");
          return;
        }

        const headers = (rowsFromCsv[0] ?? []).map((header) => header.trim());
        const headerIndexByLower = new Map<string, number>();
        headers.forEach((header, index) => {
          headerIndexByLower.set(header.toLowerCase(), index);
        });

        const nextEvents = [...events];
        const importErrors: string[] = [];
        const importWarnings: string[] = [];
        let created = 0;
        let updated = 0;
        let autoDisabledForMissingRequiredTags = 0;
        let missingSoundWarnings = 0;

        for (let rowIndex = 1; rowIndex < rowsFromCsv.length; rowIndex += 1) {
          const rowCells = rowsFromCsv[rowIndex] ?? [];
          const read = (name: string): string => {
            const index = headerIndexByLower.get(name.toLowerCase());
            if (typeof index !== "number") {
              return "";
            }
            return String(rowCells[index] ?? "").trim();
          };

          const parseBooleanField = (name: string): boolean | undefined => {
            const value = read(name);
            if (!value) {
              return undefined;
            }
            const parsed = parseBooleanText(value);
            if (typeof parsed === "undefined") {
              importErrors.push(
                `Row ${rowIndex + 1}: invalid boolean in ${name}`,
              );
            }
            return parsed;
          };

          const parseNumberField = (name: string): number | undefined => {
            const value = read(name);
            if (!value) {
              return undefined;
            }
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) {
              importErrors.push(
                `Row ${rowIndex + 1}: invalid number in ${name}`,
              );
              return undefined;
            }
            return parsed;
          };

          const rawId = read("id");
          const targetIndex = rawId
            ? nextEvents.findIndex((item) => normalizeId(item.id) === rawId)
            : -1;

          const idsForNew = new Set(
            nextEvents.map((item) => normalizeId(item.id)).filter(Boolean),
          );
          const base =
            targetIndex >= 0
              ? toDraft(
                  nextEvents[targetIndex]!,
                  rawId || createEventId(idsForNew),
                )
              : createDefaultDraft(idsForNew);

          const conditionModeRaw = read("conditionMode");
          const bitTriggerRaw = read("bitTrigger");
          const wordOperatorRaw = read("wordOperator");
          const securityBitRaw = read("securityBitValue");

          const knownPatch: Partial<EventEditorDraft> = {
            id: rawId || base.id,
            enabled: parseBooleanField("enabled") ?? base.enabled,
            categoryId: read("categoryId") || base.categoryId,
            categoryName: read("categoryName") || base.categoryName,
            message: read("message") || base.message,
            priority: parseNumberField("priority") ?? base.priority,
            sourceTagName: read("sourceTagName") || base.sourceTagName,
            conditionMode:
              conditionModeRaw === "word" || conditionModeRaw === "bit"
                ? conditionModeRaw
                : base.conditionMode,
            bitTrigger:
              bitTriggerRaw === "ON" ||
              bitTriggerRaw === "OFF" ||
              bitTriggerRaw === "OFF_TO_ON" ||
              bitTriggerRaw === "ON_TO_OFF"
                ? bitTriggerRaw
                : base.bitTrigger,
            wordOperator:
              wordOperatorRaw === "<" ||
              wordOperatorRaw === ">" ||
              wordOperatorRaw === "=" ||
              wordOperatorRaw === "<>" ||
              wordOperatorRaw === ">=" ||
              wordOperatorRaw === "<="
                ? wordOperatorRaw
                : base.wordOperator,
            wordValue: read("wordValue") || base.wordValue,
            startupDelayMs:
              parseNumberField("startupDelayMs") ?? base.startupDelayMs,
            requireAck: parseBooleanField("requireAck") ?? base.requireAck,
            ackValue: read("ackValue") || base.ackValue,
            soundEnabled:
              parseBooleanField("soundEnabled") ?? base.soundEnabled,
            soundId: read("soundId") || base.soundId,
            textColor: read("textColor") || base.textColor,
            backgroundColor: read("backgroundColor") || base.backgroundColor,
            backgroundBlinkEnabled:
              parseBooleanField("backgroundBlinkEnabled")
              ?? base.backgroundBlinkEnabled,
            backgroundBlinkDurationMs: normalizeBlinkDurationMs(
              parseNumberField("backgroundBlinkDurationMs")
              ?? base.backgroundBlinkDurationMs,
              base.backgroundBlinkDurationMs,
            ),
            backgroundBlinkOpacity: normalizeBlinkOpacity(
              parseNumberField("backgroundBlinkOpacity")
              ?? base.backgroundBlinkOpacity,
              base.backgroundBlinkOpacity,
            ),
            ackTagName: read("ackTagName") || base.ackTagName,
            notificationTagName:
              read("notificationTagName") || base.notificationTagName,
            elapsedTimeTagName:
              read("elapsedTimeTagName") || base.elapsedTimeTagName,
            securityEnabled:
              parseBooleanField("securityEnabled") ?? base.securityEnabled,
            securityTagName: read("securityTagName") || base.securityTagName,
            securityBitValue:
              securityBitRaw === "true" ||
              securityBitRaw === "false" ||
              securityBitRaw === "1" ||
              securityBitRaw === "0" ||
              securityBitRaw === ""
                ? (securityBitRaw as EventEditorDraft["securityBitValue"])
                : base.securityBitValue,
          };

          const draft: EventEditorDraft = {
            ...base,
            ...knownPatch,
          };

          const rowErrors = validateDraft(
            draft,
            nextEvents,
            targetIndex >= 0 ? targetIndex : null,
          );
          delete rowErrors.sourceTagName;
          if (Object.keys(rowErrors).length > 0) {
            const firstError =
              Object.values(rowErrors)[0] ?? "validation error";
            importErrors.push(`Row ${rowIndex + 1}: ${firstError}`);
            continue;
          }

          const normalized = buildEventFromDraft(
            draft,
            targetIndex >= 0 ? nextEvents[targetIndex] : undefined,
          );
          const extras: Record<string, unknown> = {};
          headers.forEach((header, index) => {
            const key = header.trim();
            if (!key || CSV_HEADERS.includes(key)) {
              return;
            }
            const cell = String(rowCells[index] ?? "");
            if (!cell.trim()) {
              return;
            }
            extras[key] = parseLooseCsvValue(cell);
          });

          const merged = {
            ...(targetIndex >= 0
              ? (nextEvents[targetIndex] as Record<string, unknown>)
              : {}),
            ...extras,
            ...normalized,
          } as EventDefinition;

          const hasMissingSourceTagName = !(merged.sourceTagName ?? "").trim();
          const hasMissingSecurityTagName =
            merged.securityEnabled === true &&
            !(merged.securityTagName ?? "").trim();
          if (hasMissingSourceTagName || hasMissingSecurityTagName) {
            merged.enabled = false;
            merged.updatedAt = nowIso();
            autoDisabledForMissingRequiredTags += 1;
          }

          const mergedSoundWarning = getEventSoundWarning(merged, soundsById);
          if (mergedSoundWarning) {
            importWarnings.push(
              `Row ${rowIndex + 1}: ${mergedSoundWarning.message}`,
            );
            missingSoundWarnings += 1;
          }

          if (targetIndex >= 0) {
            nextEvents[targetIndex] = merged;
            updated += 1;
          } else {
            nextEvents.push(merged);
            created += 1;
          }
        }

        const reconciled = reconcileEventsWithProjectTags(nextEvents, project);
        saveEvents(reconciled.nextEvents);
        const autoDisabledTotal =
          autoDisabledForMissingRequiredTags +
          (reconciled.changed ? reconciled.affectedEventCount : 0);
        const disabledSummary =
          autoDisabledTotal > 0
            ? `, auto-disabled ${autoDisabledTotal} event(s) due to missing source/security tags`
            : "";
        const soundSummary =
          missingSoundWarnings > 0
            ? `, sound warnings ${missingSoundWarnings}`
            : "";
        const summary = `CSV import finished: created ${created}, updated ${updated}${disabledSummary}${soundSummary}`;
        setStatusText(summary);

        if (importErrors.length > 0) {
          const preview = importErrors.slice(0, 15).join("\n");
          const suffix =
            importErrors.length > 15
              ? `\n... and ${importErrors.length - 15} more`
              : "";
          const warningPreview =
            importWarnings.length > 0
              ? `\n\nWarnings:\n${importWarnings.slice(0, 10).join("\n")}${importWarnings.length > 10 ? `\n... and ${importWarnings.length - 10} more` : ""}`
              : "";
          window.alert(
            `${summary}\n\nErrors:\n${preview}${suffix}${warningPreview}`,
          );
        } else if (importWarnings.length > 0) {
          const preview = importWarnings.slice(0, 10).join("\n");
          const suffix =
            importWarnings.length > 10
              ? `\n... and ${importWarnings.length - 10} more`
              : "";
          window.alert(`${summary}\n\nWarnings:\n${preview}${suffix}`);
        }
      } catch (error) {
        const textError =
          error instanceof Error ? error.message : "Failed to import CSV";
        window.alert(`CSV import failed: ${textError}`);
      }
    };
    reader.readAsText(file);
  };

  const isAllFilteredSelected =
    filteredRows.length > 0 &&
    filteredRows.every((row) => selectedRowKeys.has(row.key));

  const editorTabs = [
    { id: "general", title: "General" },
    { id: "message", title: "Message" },
    { id: "statistics", title: "Statistics" },
    { id: "security", title: "Security" },
    { id: "actions", title: "Actions" },
  ];
  const selectedPickerTagName =
    draftEvent && tagPickerTargetField
      ? draftEvent[tagPickerTargetField]
      : undefined;

  const renderEditorSection = (): ReactNode => {
    if (!draftEvent) {
      return null;
    }

    if (editorTab === "general") {
      return (
        <>
          <label className="workbench-field">
            <span className="workbench-field__label">ID</span>
            <input
              className="workbench-input"
              value={draftEvent.id}
              onChange={(event) => setDraftPatch({ id: event.target.value })}
            />
            {renderFieldError("id")}
          </label>

          <label className="workbench-field">
            <label className="screen-editor-tags-checkbox-field">
              <input
                type="checkbox"
                checked={draftEvent.enabled}
                onChange={(event) =>
                  setDraftPatch({ enabled: event.target.checked })
                }
              />
              <span>Enabled</span>
            </label>
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Category ID</span>
            <select
              className="workbench-select"
              value={draftEvent.categoryId}
              onChange={(event) => {
                const nextId = event.target.value;
                const matched = categories.find((item) => item.id === nextId);
                setDraftPatch({
                  categoryId: nextId,
                  categoryName: matched?.name ?? draftEvent.categoryName,
                });
              }}
            >
              <option value="">(none)</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} ({category.id})
                </option>
              ))}
            </select>
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Category Name</span>
            <input
              className="workbench-input"
              value={draftEvent.categoryName}
              onChange={(event) =>
                setDraftPatch({ categoryName: event.target.value })
              }
            />
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Priority</span>
            <select
              className="workbench-select"
              value={String(draftEvent.priority)}
              onChange={(event) =>
                setDraftPatch({
                  priority: clampPriority(Number(event.target.value)),
                })
              }
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {renderFieldError("priority")}
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Startup Delay (ms)</span>
            <input
              className="workbench-input"
              type="number"
              min={0}
              value={draftEvent.startupDelayMs}
              onChange={(event) =>
                setDraftPatch({
                  startupDelayMs: Math.max(0, Number(event.target.value) || 0),
                })
              }
            />
          </label>

          {renderTagReferenceInput("sourceTagName", "Source Tag Name", {
            requiredErrorField: "sourceTagName",
          })}

          <label className="workbench-field">
            <span className="workbench-field__label">Condition Mode</span>
            <select
              className="workbench-select"
              value={draftEvent.conditionMode}
              onChange={(event) =>
                setDraftPatch({
                  conditionMode: event.target
                    .value as EventEditorDraft["conditionMode"],
                })
              }
            >
              <option value="bit">bit</option>
              <option value="word">word</option>
            </select>
          </label>

          {draftEvent.conditionMode === "bit" ? (
            <label className="workbench-field">
              <span className="workbench-field__label">Bit Trigger</span>
              <select
                className="workbench-select"
                value={draftEvent.bitTrigger}
                onChange={(event) =>
                  setDraftPatch({
                    bitTrigger: event.target.value as EventBitTrigger,
                  })
                }
              >
                <option value="ON">ON</option>
                <option value="OFF">OFF</option>
                <option value="OFF_TO_ON">OFF_TO_ON</option>
                <option value="ON_TO_OFF">ON_TO_OFF</option>
              </select>
              {renderFieldError("bitTrigger")}
            </label>
          ) : (
            <>
              <label className="workbench-field">
                <span className="workbench-field__label">Word Operator</span>
                <select
                  className="workbench-select"
                  value={draftEvent.wordOperator}
                  onChange={(event) =>
                    setDraftPatch({
                      wordOperator: event.target.value as EventWordOperator,
                    })
                  }
                >
                  <option value="<">&lt;</option>
                  <option value=">">&gt;</option>
                  <option value="=">=</option>
                  <option value="<>">&lt;&gt;</option>
                  <option value=">=">&gt;=</option>
                  <option value="<=">&lt;=</option>
                </select>
                {renderFieldError("wordOperator")}
              </label>

              <label className="workbench-field">
                <span className="workbench-field__label">Word Value</span>
                <input
                  className="workbench-input"
                  value={draftEvent.wordValue}
                  onChange={(event) =>
                    setDraftPatch({ wordValue: event.target.value })
                  }
                />
                {renderFieldError("wordValue")}
              </label>
            </>
          )}
        </>
      );
    }

    if (editorTab === "message") {
      return (
        <>
          <label className="workbench-field">
            <span className="workbench-field__label">Message</span>
            <input
              className="workbench-input"
              value={draftEvent.message}
              onChange={(event) =>
                setDraftPatch({ message: event.target.value })
              }
            />
            {renderFieldError("message")}
          </label>

          <EventManagerColorField
            label="Text Color"
            value={draftEvent.textColor}
            fallback="#ffffff"
            onChange={(next) => setDraftPatch({ textColor: next })}
            onClear={() => setDraftPatch({ textColor: "" })}
          />

          <EventManagerColorField
            label="Background Color"
            value={draftEvent.backgroundColor}
            fallback="#ff0000"
            onChange={(next) => setDraftPatch({ backgroundColor: next })}
            onClear={() => setDraftPatch({ backgroundColor: "" })}
          />

          <label className="workbench-field">
            <label className="screen-editor-tags-checkbox-field">
              <input
                type="checkbox"
                checked={draftEvent.backgroundBlinkEnabled}
                onChange={(event) =>
                  setDraftPatch({ backgroundBlinkEnabled: event.target.checked })
                }
              />
              <span>Blink background (unacknowledged only)</span>
            </label>
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Blink duration (ms)</span>
            <input
              className="workbench-input"
              type="number"
              min={300}
              max={10000}
              step={100}
              value={draftEvent.backgroundBlinkDurationMs}
              onChange={(event) =>
                setDraftPatch({
                  backgroundBlinkDurationMs: normalizeBlinkDurationMs(
                    event.target.value,
                    draftEvent.backgroundBlinkDurationMs,
                  ),
                })
              }
              disabled={!draftEvent.backgroundBlinkEnabled}
            />
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Blink background opacity (0..1)</span>
            <input
              className="workbench-input"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={draftEvent.backgroundBlinkOpacity}
              onChange={(event) =>
                setDraftPatch({
                  backgroundBlinkOpacity: normalizeBlinkOpacity(
                    event.target.value,
                    draftEvent.backgroundBlinkOpacity,
                  ),
                })
              }
              disabled={!draftEvent.backgroundBlinkEnabled}
            />
          </label>

          <label className="workbench-field">
            <label className="screen-editor-tags-checkbox-field">
              <input
                type="checkbox"
                checked={draftEvent.requireAck}
                onChange={(event) =>
                  setDraftPatch({ requireAck: event.target.checked })
                }
              />
              <span>Require Acknowledge</span>
            </label>
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Ack Value</span>
            <input
              className="workbench-input"
              value={draftEvent.ackValue}
              onChange={(event) =>
                setDraftPatch({ ackValue: event.target.value })
              }
              placeholder="true / false / number / text / null"
            />
          </label>

          <label className="workbench-field">
            <label className="screen-editor-tags-checkbox-field">
              <input
                type="checkbox"
                checked={draftEvent.soundEnabled}
                onChange={(event) =>
                  setDraftPatch({ soundEnabled: event.target.checked })
                }
              />
              <span>Sound Enabled</span>
            </label>
          </label>

          <label className="workbench-field">
            <span className="workbench-field__label">Sound ID</span>
            <select
              className="workbench-select"
              value={draftEvent.soundId}
              onChange={(event) =>
                setDraftPatch({ soundId: event.target.value })
              }
              disabled={!draftEvent.soundEnabled}
            >
              <option value="">(none)</option>
              {draftEvent.soundId.trim() &&
              !soundsById.has(draftEvent.soundId.trim()) ? (
                <option value={draftEvent.soundId.trim()}>
                  Missing sound ({draftEvent.soundId.trim()})
                </option>
              ) : null}
              {sounds.map((sound) => (
                <option key={sound.id} value={sound.id}>
                  {sound.name} [{formatSoundKind(sound.kind)}]
                </option>
              ))}
            </select>
            {draftSoundWarning ? (
              <span className="screen-editor-tag-editor__hint screen-editor-tag-editor__hint--warning">
                {draftSoundWarning.code === "unknown_sound_id" ||
                draftSoundWarning.code === "placeholder_sound_file" ||
                draftSoundWarning.code === "missing_sound_file"
                  ? SOUND_FILE_NOT_AVAILABLE_MESSAGE
                  : draftSoundWarning.message}
              </span>
            ) : null}
          </label>

          <div className="event-sound-actions-row">
            <WorkbenchButton
              icon={<PlayCircleOutlined />}
              onClick={() => void testSound(draftEvent.soundId)}
              disabled={!draftEvent.soundEnabled || !draftEvent.soundId.trim()}
            >
              Test
            </WorkbenchButton>
            <WorkbenchButton
              icon={<SoundOutlined />}
              onClick={() => setActiveSection("sounds")}
            >
              Sound Library
            </WorkbenchButton>
            <WorkbenchButton onClick={() => void enableSounds()}>
              Enable sounds
            </WorkbenchButton>
          </div>

          {eventSoundPlayer.hasAutoplayBlock() ? (
            <span className="screen-editor-tag-editor__hint screen-editor-tag-editor__hint--warning">
              Browser blocked playback. Click Enable sounds.
            </span>
          ) : null}
          <label className="workbench-field">
            <span className="screen-editor-tag-editor__hint">
              Built-in SCADA sounds are available immediately. You can switch to
              Sound Library for upload and testing.
            </span>
          </label>
        </>
      );
    }

    if (editorTab === "statistics") {
      return (
        <>
          {renderTagReferenceInput("ackTagName", "Ack Tag Name")}
          {renderTagReferenceInput(
            "notificationTagName",
            "Notification Tag Name",
          )}
          {renderTagReferenceInput(
            "elapsedTimeTagName",
            "Elapsed Time Tag Name (optional)",
          )}
        </>
      );
    }

    if (editorTab === "actions") {
      return (
        <div className="event-actions-editor">
          {renderActionSection("On Active", "onActiveActions", "active")}
          {renderActionSection("On Cleared", "onClearedActions", "cleared")}
          {renderActionSection("On Acknowledge", "onAckActions", "ack")}
        </div>
      );
    }

    return (
      <>
        <label className="workbench-field">
          <label className="screen-editor-tags-checkbox-field">
            <input
              type="checkbox"
              checked={draftEvent.securityEnabled}
              onChange={(event) =>
                setDraftPatch({ securityEnabled: event.target.checked })
              }
            />
            <span>Security Enabled</span>
          </label>
        </label>

        {renderTagReferenceInput("securityTagName", "Security Tag Name", {
          disabled: !draftEvent.securityEnabled,
        })}

        <label className="workbench-field">
          <span className="workbench-field__label">Security Bit Value</span>
          <select
            className="workbench-select"
            value={draftEvent.securityBitValue}
            onChange={(event) =>
              setDraftPatch({
                securityBitValue: event.target
                  .value as EventEditorDraft["securityBitValue"],
              })
            }
            disabled={!draftEvent.securityEnabled}
          >
            <option value="">(unset)</option>
            <option value="true">true</option>
            <option value="false">false</option>
            <option value="1">1</option>
            <option value="0">0</option>
          </select>
        </label>
      </>
    );
  };

  return (
    <div className="screen-editor-window-content screen-editor-tags-window">
      <WorkbenchTabs
        items={[
          {
            id: "events",
            title: "Events",
            icon: <BellOutlined />,
            active: activeSection === "events",
            onClick: () => setActiveSection("events"),
          },
          {
            id: "sounds",
            title: "Sounds",
            icon: <SoundOutlined />,
            active: activeSection === "sounds",
            onClick: () => setActiveSection("sounds"),
          },
        ]}
      />

      {activeSection === "events" ? (
        <>
      <div className="screen-editor-tags-window__toolbar">
        <WorkbenchButton variant="primary" onClick={openAdd}>
          Add
        </WorkbenchButton>
        <WorkbenchButton
          onClick={() => activeRow && openEdit(activeRow)}
          disabled={!activeRow}
        >
          Edit
        </WorkbenchButton>
        <WorkbenchButton
          onClick={() => activeRow && duplicateRow(activeRow)}
          disabled={!activeRow}
        >
          Duplicate
        </WorkbenchButton>
        <WorkbenchButton
          variant="danger"
          onClick={deleteSelected}
          disabled={selectedRowKeys.size === 0}
        >
          Delete Selected
        </WorkbenchButton>
        <WorkbenchButton
          variant="danger"
          onClick={deleteFiltered}
          disabled={filteredRows.length === 0}
        >
          Delete Filtered
        </WorkbenchButton>
        <WorkbenchButton
          variant="danger"
          onClick={clearAll}
          disabled={events.length === 0}
        >
          Clear All
        </WorkbenchButton>
        <WorkbenchButton onClick={() => importInputRef.current?.click()}>
          Import CSV
        </WorkbenchButton>
        <WorkbenchButton onClick={exportCsv} disabled={events.length === 0}>
          Export CSV
        </WorkbenchButton>
        <WorkbenchButton onClick={() => void saveProject({ notify: true })}>
          Save Project
        </WorkbenchButton>
        <WorkbenchButton onClick={resetWidths}>Reset Widths</WorkbenchButton>
        <WorkbenchButton onClick={() => setColumnsPanelOpen((open) => !open)}>
          Columns
        </WorkbenchButton>
        <WorkbenchButton
          icon={<SoundOutlined />}
          onClick={() => setActiveSection("sounds")}
        >
          Sound Library
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
            importCsv(file);
          }}
        />

        <input
          className="workbench-input screen-editor-tags-window__toolbar-input"
          value={search}
          placeholder="Search id / message / source"
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          className="workbench-select screen-editor-tags-window__toolbar-select"
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
        >
          <option value="all">All categories</option>
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>

        <select
          className="workbench-select screen-editor-tags-window__toolbar-select"
          value={priorityFilter}
          onChange={(event) =>
            setPriorityFilter(
              event.target.value as "all" | "0" | "1" | "2" | "3",
            )
          }
        >
          <option value="all">All priorities</option>
          {PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          className="workbench-select screen-editor-tags-window__toolbar-select"
          value={enabledFilter}
          onChange={(event) =>
            setEnabledFilter(
              event.target.value as "all" | "enabled" | "disabled",
            )
          }
        >
          <option value="all">All states</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>

        <div className="screen-editor-tags-window__toolbar-meta">
          Total: {events.length} | Enabled: {totalEnabledCount} | Disabled:{" "}
          {totalDisabledCount} | Filtered: {filteredRows.length} | Selected:{" "}
          {selectedFilteredCount} | Missing refs: {missingReferenceCount}
        </div>
      </div>

      {columnsPanelOpen ? (
        <div className="screen-editor-tags-columns-panel">
          {EVENT_COLUMNS.map((column) => (
            <label key={column.id} className="screen-editor-tags-column-toggle">
              <input
                type="checkbox"
                checked={columnVisibility[column.id] !== false}
                disabled={column.id === "message"}
                onChange={(event) =>
                  setColumnVisibility((prev) => ({
                    ...prev,
                    [column.id]: event.target.checked,
                    message: true,
                  }))
                }
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
              style={{ gridTemplateColumns: tableGridTemplateColumns }}
            >
              <div className="screen-editor-tags-cell screen-editor-tags-header-cell">
                <input
                  type="checkbox"
                  checked={isAllFilteredSelected}
                  onChange={toggleSelectAllFiltered}
                  aria-label="Select all filtered"
                />
              </div>
              {visibleColumns.map((column) => (
                <div
                  key={column.id}
                  className="screen-editor-tags-cell screen-editor-tags-header-cell"
                >
                  <span>{column.title}</span>
                  <span
                    className="screen-editor-tags-column-resize-handle"
                    onMouseDown={(event) => startColumnResize(event, column.id)}
                  />
                </div>
              ))}
            </div>

            {pageRows.map((row) => {
              const event = row.event;
              const selected = row.key === activeRow?.key;
              const checked = selectedRowKeys.has(row.key);
              const rowWarnings = rowWarningsByKey.get(row.key) ?? [];
              const missingWarnings =
                rowMissingWarningsByKey.get(row.key) ?? [];
              const soundWarning = rowSoundWarningsByKey.get(row.key) ?? null;
              const hasCriticalMissingTag =
                missingWarnings.some(
                  (warning) =>
                    warning.code === "missing_source" ||
                    warning.code === "missing_security",
                ) || Boolean(soundWarning);
              const rowWarningTitle = [
                ...missingWarnings.map((warning) => warning.message),
                ...(soundWarning ? [soundWarning.message] : []),
              ].join(" | ");

              return (
                <div
                  key={row.key}
                  className={[
                    "screen-editor-tags-row",
                    selected ? "screen-editor-tags-row--selected" : "",
                    hasCriticalMissingTag
                      ? "screen-editor-event-row--warning"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ gridTemplateColumns: tableGridTemplateColumns }}
                  onClick={() => setActiveRowKey(row.key)}
                  title={rowWarningTitle || undefined}
                >
                  <div
                    className="screen-editor-tags-cell"
                    onClick={(eventCell) => eventCell.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRowSelection(row.key)}
                      aria-label={`Select ${row.id || `row ${row.index + 1}`}`}
                    />
                  </div>

                  {visibleColumns.map((column) => {
                    let content: ReactNode = null;
                    let title = "";

                    if (column.id === "enabled") {
                      title = event.enabled === false ? "OFF" : "ON";
                      content = title;
                    } else if (column.id === "category") {
                      title = getCategoryLabel(event);
                      content = title;
                    } else if (column.id === "message") {
                      title = event.message?.trim() || "-";
                      content =
                        missingWarnings.length > 0 ? (
                          <span className="screen-editor-event-cell-with-warning">
                            <span className="screen-editor-event-cell-with-warning__text">
                              {title}
                            </span>
                            <span
                              className="screen-editor-event-warning-marker"
                              title={missingWarnings
                                .map((warning) => warning.message)
                                .join(" | ")}
                            >
                              !
                            </span>
                          </span>
                        ) : (
                          title
                        );
                    } else if (column.id === "priority") {
                      title = `${getPriorityLabel(event.priority)} (${clampPriority(typeof event.priority === "number" ? event.priority : 0)})`;
                      content = title;
                    } else if (column.id === "conditionMode") {
                      title = event.conditionMode === "word" ? "word" : "bit";
                      content = title;
                    } else if (column.id === "trigger") {
                      title = getTriggerLabel(event);
                      content = title;
                    } else if (column.id === "sourceTagName") {
                      title = event.sourceTagName?.trim() || "-";
                      const sourceWarnings = rowWarnings.filter(
                        (warning) => warning.code === "missing_source",
                      );
                      if (sourceWarnings.length > 0) {
                        title = `${title} | ${sourceWarnings.map((warning) => warning.message).join(" | ")}`;
                        content = (
                          <span className="screen-editor-event-cell-with-warning">
                            <span className="screen-editor-event-cell-with-warning__text">
                              {event.sourceTagName?.trim() || "-"}
                            </span>
                            <span
                              className="screen-editor-event-warning-marker"
                              title={sourceWarnings
                                .map((warning) => warning.message)
                                .join(" | ")}
                            >
                              !
                            </span>
                          </span>
                        );
                      } else {
                        content = title;
                      }
                    } else if (column.id === "wordValue") {
                      title = getWordValueLabel(event);
                      content = title;
                    } else if (column.id === "soundEnabled") {
                      title = event.soundEnabled ? "Yes" : "No";
                      content = title;
                    } else if (column.id === "soundId") {
                      title = event.soundId ?? "-";
                      if (soundWarning) {
                        content = (
                          <span className="screen-editor-event-cell-with-warning">
                            <span className="screen-editor-event-cell-with-warning__text">
                              {title || "-"}
                            </span>
                            <span
                              className="screen-editor-event-warning-marker"
                              title={soundWarning.message}
                            >
                              !
                            </span>
                          </span>
                        );
                      } else {
                        content = title;
                      }
                    } else if (column.id === "requireAck") {
                      title = event.requireAck ? "Yes" : "No";
                      content = title;
                    } else {
                      content = (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                          onClick={(eventCell) => eventCell.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="workbench-button workbench-button--ghost"
                            style={{
                              height: 20,
                              padding: "0 6px",
                              fontSize: 11,
                            }}
                            onClick={() => openEdit(row)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="workbench-button workbench-button--ghost"
                            style={{
                              height: 20,
                              padding: "0 6px",
                              fontSize: 11,
                            }}
                            onClick={() => duplicateRow(row)}
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            className="workbench-button workbench-button--danger"
                            style={{
                              height: 20,
                              padding: "0 6px",
                              fontSize: 11,
                            }}
                            onClick={() => deleteOne(row)}
                          >
                            Delete
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={column.id}
                        className="screen-editor-tags-cell"
                        title={title}
                      >
                        {content}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {pageRows.length === 0 ? (
              <div className="screen-editor-empty-state">
                No events match the filters
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={[
            "screen-editor-tags-resize-handle",
            isDetailsResizeActive
              ? "screen-editor-tags-resize-handle--active"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onMouseDown={startDetailsResize}
        />

        <div className="screen-editor-tags-window__details">
          <div className="screen-editor-tag-editor">
            {editorMode === "view" ? (
              <>
                <div className="screen-editor-tag-editor__title">
                  Event Details
                </div>
                {activeRow ? (
                  <>
                    <div className="screen-editor-tag-editor__kv">
                      <span>ID</span>
                      <strong>{activeRow.id || "(missing)"}</strong>
                    </div>
                    <div className="screen-editor-tag-editor__kv">
                      <span>Enabled</span>
                      <strong>
                        {activeRow.event.enabled === false ? "No" : "Yes"}
                      </strong>
                    </div>
                    <div className="screen-editor-tag-editor__kv">
                      <span>Category</span>
                      <strong>{getCategoryLabel(activeRow.event)}</strong>
                    </div>
                    <div className="screen-editor-tag-editor__kv">
                      <span>Message</span>
                      <strong>{activeRow.event.message?.trim() || "-"}</strong>
                    </div>
                    <div className="screen-editor-tag-editor__kv">
                      <span>Priority</span>
                      <strong>
                        {getPriorityLabel(activeRow.event.priority)} (
                        {clampPriority(
                          typeof activeRow.event.priority === "number"
                            ? activeRow.event.priority
                            : 0,
                        )}
                        )
                      </strong>
                    </div>
                    <div className="screen-editor-tag-editor__kv">
                      <span>Condition</span>
                      <strong>
                        {activeRow.event.conditionMode === "word"
                          ? "word"
                          : "bit"}
                      </strong>
                    </div>
                    <div className="screen-editor-tag-editor__kv">
                      <span>Trigger / Operator</span>
                      <strong>{getTriggerLabel(activeRow.event)}</strong>
                    </div>
                    <div className="screen-editor-tag-editor__kv">
                      <span>Source Tag</span>
                      <strong>
                        {activeRow.event.sourceTagName?.trim() || "-"}
                      </strong>
                    </div>
                    <div className="screen-editor-tag-editor__kv">
                      <span>Word Value</span>
                      <strong>{getWordValueLabel(activeRow.event)}</strong>
                    </div>
                    <div className="screen-editor-tag-editor__kv">
                      <span>Require Ack</span>
                      <strong>
                        {activeRow.event.requireAck ? "Yes" : "No"}
                      </strong>
                    </div>
                    <div className="screen-editor-tag-editor__kv">
                      <span>Sound</span>
                      <strong>
                        {activeRow.event.soundEnabled
                          ? (activeRow.event.soundId ?? "On")
                          : "Off"}
                      </strong>
                    </div>
                    {activeRowSoundWarning ? (
                      <div className="screen-editor-tag-editor__hint screen-editor-tag-editor__hint--warning">
                        {activeRowSoundWarning.message}
                      </div>
                    ) : null}
                    {activeRowMissingWarnings.length > 0 ? (
                      <div className="screen-editor-tag-editor__warnings">
                        {activeRowMissingWarnings.map((warning, index) => (
                          <div
                            key={`${warning.field}-${warning.code}-${index}`}
                            className="screen-editor-tag-editor__hint screen-editor-tag-editor__hint--warning"
                          >
                            {warning.message}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="screen-editor-tag-editor-actions">
                      <WorkbenchButton onClick={() => openEdit(activeRow)}>
                        Edit
                      </WorkbenchButton>
                      <WorkbenchButton onClick={() => duplicateRow(activeRow)}>
                        Duplicate
                      </WorkbenchButton>
                      <WorkbenchButton
                        variant="danger"
                        onClick={() => deleteOne(activeRow)}
                      >
                        Delete
                      </WorkbenchButton>
                    </div>
                  </>
                ) : (
                  <div className="screen-editor-empty-state">
                    Select an event
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="screen-editor-tag-editor__title">
                  {editorMode === "add" ? "Add Event" : "Edit Event"}
                </div>

                <WorkbenchTabs
                  items={editorTabs.map((tab) => ({
                    id: tab.id,
                    title: tab.title,
                    active: editorTab === tab.id,
                    onClick: () => setEditorTab(tab.id as EventEditorTab),
                  }))}
                />

                {renderEditorSection()}

                <div className="screen-editor-tag-editor-actions">
                  <WorkbenchButton variant="primary" onClick={saveDraft}>
                    Save
                  </WorkbenchButton>
                  <WorkbenchButton onClick={cancelEditor}>
                    Cancel
                  </WorkbenchButton>
                </div>
              </>
            )}

            <div className="screen-editor-tag-editor__hint">
              {statusText ||
                "Event Manager editor updates project.events. Runtime execution is handled by Event Engine."}
            </div>
          </div>
        </div>
      </div>

          <TagPickerDialog
            open={Boolean(draftEvent && tagPickerTargetField)}
            project={project}
            selectedTagName={selectedPickerTagName}
            onClose={() => setTagPickerTargetField(null)}
            onSelect={applyTagPickerSelection}
          />

          <div className="screen-editor-tags-pagination">
            <span>
              Rows: {totalRows} | Page {safePage} / {totalPages}
            </span>
            <WorkbenchButton disabled={safePage <= 1} onClick={() => setPage(1)}>
              First
            </WorkbenchButton>
            <WorkbenchButton
              disabled={safePage <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Prev
            </WorkbenchButton>
            <WorkbenchButton
              disabled={safePage >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Next
            </WorkbenchButton>
            <WorkbenchButton
              disabled={safePage >= totalPages}
              onClick={() => setPage(totalPages)}
            >
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
        </>
      ) : (
        <div className="event-sounds-section">
          <div className="screen-editor-tags-window__toolbar">
            <WorkbenchButton
              variant="primary"
              icon={<UploadOutlined />}
              onClick={() => soundUploadInputRef.current?.click()}
              disabled={soundLibraryBusy}
            >
              Upload Sound
            </WorkbenchButton>
            <WorkbenchButton
              icon={<ReloadOutlined />}
              onClick={() => void refreshSounds()}
              disabled={soundLibraryBusy}
            >
              Refresh
            </WorkbenchButton>
            <WorkbenchButton onClick={() => void enableSounds()}>
              Enable sounds
            </WorkbenchButton>
            <WorkbenchButton
              icon={<BellOutlined />}
              onClick={() => setActiveSection("events")}
            >
              Back To Events
            </WorkbenchButton>

            <input
              ref={soundUploadInputRef}
              hidden
              type="file"
              accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (!file) {
                  return;
                }
                void uploadSound(file);
              }}
            />

          <div className="screen-editor-tags-window__toolbar-meta">
              Sound Library: {sounds.length} total | Defaults:{" "}
              {
                sounds.filter((sound) => isDefaultEventSoundId(sound.id)).length
              }{" "}
              | Custom:{" "}
              {sounds.filter((sound) => !isDefaultEventSoundId(sound.id)).length}
            </div>
          </div>

          <div className="event-manager-runtime-sound-mode">
            <div className="event-manager-runtime-sound-mode__title">
              EventTable Runtime Sound Mode
            </div>
            <div className="event-manager-runtime-sound-mode__grid">
              <label className="workbench-field">
                <span className="workbench-field__label">Playback mode</span>
                <select
                  className="workbench-select"
                  value={eventTableSoundSettings.soundPlaybackMode}
                  onChange={(event) =>
                    applyEventTableSoundSettings({
                      soundPlaybackMode: event.target.value as
                        | "once"
                        | "loopUntilAcknowledged",
                    })
                  }
                >
                  <option value="once">once</option>
                  <option value="loopUntilAcknowledged">
                    loopUntilAcknowledged
                  </option>
                </select>
              </label>
              <label className="workbench-field">
                <span className="workbench-field__label">
                  Repeat interval (ms)
                </span>
                <input
                  className="workbench-input"
                  type="number"
                  min={1000}
                  max={60000}
                  value={eventTableSoundSettings.soundRepeatIntervalMs}
                  onChange={(event) =>
                    applyEventTableSoundSettings({
                      soundRepeatIntervalMs: Math.max(
                        1000,
                        Math.min(60000, Math.round(Number(event.target.value) || 5000)),
                      ),
                    })
                  }
                />
              </label>
              <label className="screen-editor-tags-checkbox-field">
                <input
                  type="checkbox"
                  checked={eventTableSoundSettings.stopSoundOnAck}
                  onChange={(event) =>
                    applyEventTableSoundSettings({
                      stopSoundOnAck: event.target.checked,
                    })
                  }
                />
                <span>Stop sound on Ack</span>
              </label>
              <label className="screen-editor-tags-checkbox-field">
                <input
                  type="checkbox"
                  checked={eventTableSoundSettings.stopSoundOnSilence}
                  onChange={(event) =>
                    applyEventTableSoundSettings({
                      stopSoundOnSilence: event.target.checked,
                    })
                  }
                />
                <span>Stop sound on Silence</span>
              </label>
            </div>
            <div className="screen-editor-tag-editor__hint">
              These settings are applied to all EventTable widgets in project screens.
            </div>
          </div>

          <div className="event-sound-library-table">
            <div className="event-sound-library-table__header">
              <span>Name</span>
              <span>Kind</span>
              <span>fileName</span>
              <span>mimeType</span>
              <span>sizeBytes</span>
              <span>Status</span>
              <span>Actions</span>
            </div>

            {sounds.map((sound) => {
              const canEdit =
                sound.kind === "custom" && !isDefaultEventSoundId(sound.id);
              const status = getSoundStatusLabel(sound);
              const isWarningStatus =
                status === "Bundled file missing" || status === "Missing file";
              return (
                <div key={sound.id} className="event-sound-library-table__row">
                  <span title={sound.name}>{sound.name}</span>
                  <span title={formatSoundKind(sound.kind)}>
                    {formatSoundKind(sound.kind)}
                  </span>
                  <span title={sound.fileName ?? "-"}>
                    {sound.fileName ?? "-"}
                  </span>
                  <span title={sound.mimeType ?? "-"}>
                    {sound.mimeType ?? "-"}
                  </span>
                  <span title={formatSoundSize(sound.sizeBytes)}>
                    {formatSoundSize(sound.sizeBytes)}
                  </span>
                  <span
                    className={
                      isWarningStatus
                        ? "screen-editor-tag-editor__hint--warning"
                        : ""
                    }
                    title={status}
                  >
                    {status}
                  </span>
                  <span className="event-sound-library-table__actions">
                    <WorkbenchButton
                      icon={<PlayCircleOutlined />}
                      onClick={() => void testSound(sound.id)}
                      disabled={soundLibraryBusy}
                    >
                      Test
                    </WorkbenchButton>
                    <WorkbenchButton
                      onClick={() => void renameSound(sound)}
                      disabled={!canEdit || soundLibraryBusy}
                    >
                      Rename
                    </WorkbenchButton>
                    <WorkbenchButton
                      variant="danger"
                      icon={<DeleteOutlined />}
                      onClick={() => void deleteSound(sound)}
                      disabled={!canEdit || soundLibraryBusy}
                      title={
                        canEdit
                          ? "Delete custom sound"
                          : "Default sounds cannot be deleted"
                      }
                    >
                      Delete
                    </WorkbenchButton>
                  </span>
                </div>
              );
            })}

            {sounds.length === 0 ? (
              <div className="screen-editor-empty-state">No sounds found</div>
            ) : null}
          </div>

          {eventSoundPlayer.hasAutoplayBlock() ? (
            <div className="screen-editor-tag-editor__hint screen-editor-tag-editor__hint--warning">
              Browser blocked playback. Click Enable sounds.
            </div>
          ) : null}

          <div className="screen-editor-tag-editor__hint">
            {statusText || DEFAULT_SOUND_PLACEHOLDER_MESSAGE}
          </div>
        </div>
      )}
    </div>
  );
}

