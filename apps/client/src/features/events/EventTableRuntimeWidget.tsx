import { hasRoleAccess, type EventDefinition, type EventOccurrence, type EventTableObject, type HmiObject, type OperatorActionRecord } from "@web-scada/shared";
import {
  AudioMutedOutlined,
  CheckCircleOutlined,
  ExportOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LeftOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  SoundOutlined,
  FilterOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import { message, Spin } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { WorkbenchIconButton } from "../../components/workbench";
import { useScadaStore } from "../../store/scada-store";
import {
  DEFAULT_EVENT_TABLE_COLUMN_LABELS,
  type EventTableColumnId,
  normalizeEventTableColumnWidths,
} from "./event-table-columns";
import {
  resolveEventTableConfig,
  resolveEventOccurrenceSoundId,
} from "./event-table-config";
import { EventTableSettingsDialog } from "./EventTableSettingsDialog";
import {
  EventTableExportDialog,
  type EventTableExportOptions,
} from "./EventTableExportDialog";
import {
  buildEventTableHistoryQuery,
  hasMultiValueHistoryFilters,
  resolveEventTableHistoryRange,
} from "./event-table-history-query";
import {
  downloadCsvFile,
  formatEventCellDateTime,
  formatDbSizeLabel,
  formatRecordCountLabel,
  formatStatusClockTime,
  getEventCellText,
  getOccurrenceRowColor,
} from "./event-table-formatters";
import {
  filterOnlineEventRows,
  matchesCommonEventFilters,
  sortEventRows,
} from "./event-table-filters";
import { eventSoundPlayer } from "./event-sound-player";
import {
  pickLatestUnacknowledgedActiveOccurrence,
  shouldCommitOncePlayback,
  type OncePlaybackOutcome,
} from "./event-sound-replay";
import { eventRuntimeStore } from "./event-runtime-store";
import { api } from "../../services/api";
import { getConnectionSnapshot, subscribeConnectionState, type ConnectionState } from "../../services/connection-state";

type EventTableRuntimeWidgetProps = {
  object: EventTableObject;
  screenId?: string;
  userRoleLevel?: number;
  isAuthenticated?: boolean;
};

type ColumnResizeState = {
  column: EventTableColumnId;
  startX: number;
  startWidth: number;
} | null;

type EventTableEventRow = {
  rowType: "event";
  rowId: string;
  occurredAt: string;
  event: EventOccurrence;
};

type EventTableOperatorActionRow = {
  rowType: "operatorAction";
  rowId: string;
  occurredAt: string;
  action: OperatorActionRecord;
  categoryText: string;
  sourceText: string;
  resultText: string;
  priorityText: string;
  actionKind: string;
  username: string;
};

type EventTableRow = EventTableEventRow | EventTableOperatorActionRow;

const OPERATOR_ACTION_CATEGORY_LABEL = "Действие оператора";
const OPERATOR_ACTION_ONLINE_WINDOW_MS = 5 * 60 * 1000;
const OPERATOR_ACTION_ONLINE_POLL_MS = 3000;
const MAX_EVENT_TABLE_ROWS = 1000;
const MAX_EVENT_TABLE_PAGE_SIZE = 500;
const MAX_MIXED_SOURCE_ROWS = 1000;
const MAX_OPERATOR_ACTION_QUERY_LIMIT = 1000;
const ARCHIVE_STATUS_REFRESH_INTERVAL_MS = 30_000;
const DEBUG_LOG_INTERVAL_MS = 5000;
const DEFAULT_COLUMN_WIDTH_PX: Record<EventTableColumnId, number> = {
  timestamp: 180,
  priority: 110,
  category: 180,
  message: 320,
  source: 220,
  value: 140,
  state: 140,
  ack: 100,
};

type SoundStatusKind = "enabled" | "disabled" | "blocked" | "error";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function areColumnWidthsEqual(
  left: Partial<Record<EventTableColumnId, number>>,
  right: Partial<Record<EventTableColumnId, number>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    const column = key as EventTableColumnId;
    if (Number(left[column]) !== Number(right[column])) {
      return false;
    }
  }
  return true;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toSingleFilterValues<T extends string | number>(values: T[] | undefined): T[] {
  if (!values || values.length === 0) {
    return [];
  }
  return [values[0] as T];
}

function normalizeOccurrenceId(input: Pick<EventOccurrence, "id">): string {
  return String(input.id ?? "").trim();
}

function normalizeOperatorActionId(input: Pick<OperatorActionRecord, "id">): string {
  return String(input.id ?? "").trim();
}

function getEventRowId(occurrence: EventOccurrence): string {
  const id = normalizeOccurrenceId(occurrence);
  return id ? `event:${id}` : "";
}

function getOperatorActionRowId(action: OperatorActionRecord): string {
  const id = normalizeOperatorActionId(action);
  return id ? `operatorAction:${id}` : "";
}

function toSafeTimestamp(iso: string | null | undefined): number {
  const timestamp = Date.parse(iso ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareMixedRowsByTime(left: EventTableRow, right: EventTableRow, direction: "asc" | "desc"): number {
  const sortSign = direction === "asc" ? 1 : -1;
  const timestampResult = toSafeTimestamp(left.occurredAt) - toSafeTimestamp(right.occurredAt);
  if (timestampResult !== 0) {
    return timestampResult * sortSign;
  }
  return left.rowId.localeCompare(right.rowId) * sortSign;
}

function toOperatorActionSource(action: OperatorActionRecord): string {
  return action.objectDescription?.trim()
    || action.objectName?.trim()
    || action.targetName?.trim()
    || action.objectId?.trim()
    || "-";
}

function getOperatorActionPriorityText(result: OperatorActionRecord["result"]): string {
  return result === "failed" || result === "denied" ? "warning" : "info";
}

function toOperatorActionRow(action: OperatorActionRecord): EventTableOperatorActionRow | null {
  const rowId = getOperatorActionRowId(action);
  if (!rowId) {
    return null;
  }
  return {
    rowType: "operatorAction",
    rowId,
    occurredAt: action.occurredAt,
    action,
    categoryText: OPERATOR_ACTION_CATEGORY_LABEL,
    sourceText: toOperatorActionSource(action),
    resultText: action.result,
    priorityText: getOperatorActionPriorityText(action.result),
    actionKind: action.actionKind,
    username: action.username?.trim() || "-",
  };
}

function dedupeOperatorActionsById(items: OperatorActionRecord[]): OperatorActionRecord[] {
  if (items.length <= 1) {
    return items;
  }
  const byId = new Map<string, OperatorActionRecord>();
  for (const item of items) {
    const id = normalizeOperatorActionId(item);
    if (!id) {
      continue;
    }
    if (!byId.has(id)) {
      byId.set(id, item);
    }
  }
  return [...byId.values()];
}

function matchesOperatorActionFilters(action: OperatorActionRecord, object: EventTableObject): boolean {
  const categoryFilter = object.categoryFilter ?? [];
  if (categoryFilter.length > 0) {
    const hasCategoryMatch = categoryFilter.some((item) => item.trim() === OPERATOR_ACTION_CATEGORY_LABEL);
    if (!hasCategoryMatch) {
      return false;
    }
  }

  const sourceFilter = object.sourceTagFilter?.trim().toLowerCase();
  if (sourceFilter) {
    const source = toOperatorActionSource(action).toLowerCase();
    if (!source.includes(sourceFilter)) {
      return false;
    }
  }

  const searchText = object.searchText?.trim().toLowerCase();
  if (searchText) {
    const searchCorpus = [
      action.messageText,
      action.username,
      action.objectDescription,
      action.objectName,
      action.targetName,
    ]
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean)
      .join(" | ");
    if (!searchCorpus.includes(searchText)) {
      return false;
    }
  }

  return true;
}

function getRowCellText(column: EventTableColumnId, row: EventTableRow): string {
  if (row.rowType === "event") {
    return getEventCellText(column, row.event);
  }

  if (column === "timestamp") {
    return formatEventCellDateTime(row.occurredAt);
  }
  if (column === "priority") {
    return row.priorityText;
  }
  if (column === "category") {
    return row.categoryText;
  }
  if (column === "message") {
    return row.action.messageText?.trim() || "-";
  }
  if (column === "source") {
    return row.sourceText;
  }
  if (column === "value") {
    return row.actionKind || "-";
  }
  if (column === "state") {
    return row.resultText;
  }
  return "-";
}

function findObjectScreenId(project: ReturnType<typeof useScadaStore.getState>["project"], objectId: string): string | undefined {
  if (!project) {
    return undefined;
  }
  const visit = (items: HmiObject[]): boolean => {
    for (const item of items) {
      if (item.id === objectId) {
        return true;
      }
      if (item.type === "group" && visit(item.objects)) {
        return true;
      }
    }
    return false;
  };
  for (const screen of project.screens) {
    if (visit(screen.objects)) {
      return screen.id;
    }
  }
  return undefined;
}

function resolveTitleAlign(value: EventTableObject["titleAlign"]): "flex-start" | "center" | "flex-end" {
  if (value === "center") {
    return "center";
  }
  if (value === "right") {
    return "flex-end";
  }
  return "flex-start";
}

function normalizeColorValue(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

function parseColorToRgba(color: string, alpha: number): string | null {
  const trimmed = color.trim();
  const normalizedAlpha = clamp(alpha, 0, 1);

  const hex = trimmed.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    const body = hex[1]!;
    const six = body.length === 3
      ? `${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
      : body;
    const r = Number.parseInt(six.slice(0, 2), 16);
    const g = Number.parseInt(six.slice(2, 4), 16);
    const b = Number.parseInt(six.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
  }

  const rgb = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+\s*)?\)$/i);
  if (rgb) {
    const r = clamp(Math.round(Number(rgb[1])), 0, 255);
    const g = clamp(Math.round(Number(rgb[2])), 0, 255);
    const b = clamp(Math.round(Number(rgb[3])), 0, 255);
    return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
  }

  return null;
}

function escapeCsvCell(value: string): string {
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return `"${normalized.replaceAll("\"", "\"\"")}"`;
}

function escapeHtmlCell(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function downloadBlobFile(name: string, blob: Blob): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function printHtmlDocument(content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("Document is not available."));
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");

    const cleanup = () => {
      iframe.onload = null;
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    };

    let completed = false;
    const finish = (error?: Error) => {
      if (completed) {
        return;
      }
      completed = true;
      window.setTimeout(cleanup, 300);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    document.body.appendChild(iframe);
    const frameDocument = iframe.contentDocument;
    if (!frameDocument) {
      finish(new Error("Print frame document is unavailable."));
      return;
    }
    frameDocument.open();
    frameDocument.write(content);
    frameDocument.close();

    const targetWindow = iframe.contentWindow;
    if (!targetWindow) {
      finish(new Error("Print frame is unavailable."));
      return;
    }

    // Give layout engine time to render dynamic table content before printing.
    window.setTimeout(() => {
      targetWindow.focus();
      try {
        targetWindow.print();
        finish();
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        finish(new Error(text || "Failed to open print dialog."));
      }
    }, 220);
  });
}

function buildClientCsv(
  rows: EventTableRow[],
  columns: EventTableColumnId[],
  columnLabels: Partial<Record<EventTableColumnId, string>> | undefined,
  delimiter: string,
  includeHeaders: boolean,
  statusSummary: string | null,
): string {
  const header = columns.map((column) => {
    const label = columnLabels?.[column]?.trim() || DEFAULT_EVENT_TABLE_COLUMN_LABELS[column] || column;
    return escapeCsvCell(label);
  }).join(delimiter);

  const lines = rows.map((row) => columns
    .map((column) => escapeCsvCell(getRowCellText(column, row)))
    .join(delimiter));

  const contentLines: string[] = [];
  if (statusSummary) {
    contentLines.push(escapeCsvCell(statusSummary));
  }
  if (includeHeaders) {
    contentLines.push(header);
  }
  contentLines.push(...lines);

  return `\uFEFF${contentLines.join("\n")}`;
}

function buildHtmlExport(
  rows: EventTableRow[],
  columns: EventTableColumnId[],
  columnLabels: Partial<Record<EventTableColumnId, string>> | undefined,
  includeHeaders: boolean,
  title: string,
  statusSummary: string | null,
  pageOrientation: "portrait" | "landscape",
): string {
  const headerHtml = includeHeaders
    ? `<thead><tr>${columns
      .map((column) => {
        const label = columnLabels?.[column]?.trim() || DEFAULT_EVENT_TABLE_COLUMN_LABELS[column] || column;
        return `<th>${escapeHtmlCell(label)}</th>`;
      })
      .join("")}</tr></thead>`
    : "";

  const bodyHtml = rows
    .map((row) => `<tr>${columns
      .map((column) => `<td>${escapeHtmlCell(getRowCellText(column, row))}</td>`)
      .join("")}</tr>`)
    .join("");

  const statusHtml = statusSummary
    ? `<div class=\"event-export-summary\">${escapeHtmlCell(statusSummary)}</div>`
    : "";

  return `<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <title>${escapeHtmlCell(title)}</title>
    <style>
      @page { size: ${pageOrientation}; margin: 12mm; }
      body { font-family: "Segoe UI", Tahoma, sans-serif; margin: 0; color: #1e1e1e; }
      h1 { margin: 0 0 8px 0; font-size: 18px; }
      .event-export-summary { margin: 0 0 10px 0; font-size: 12px; color: #4b5563; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { border: 1px solid #9ca3af; padding: 4px 6px; font-size: 11px; vertical-align: top; word-break: break-word; }
      th { background: #e5e7eb; text-align: left; }
    </style>
  </head>
  <body>
    <h1>${escapeHtmlCell(title)}</h1>
    ${statusHtml}
    <table>
      ${headerHtml}
      <tbody>${bodyHtml}</tbody>
    </table>
  </body>
</html>`;
}

function resolveEventMessageVisual(definition: EventDefinition | undefined): {
  textColor: string | null;
  backgroundColor: string | null;
  backgroundBlinkEnabled: boolean;
  backgroundBlinkDurationMs: number;
  backgroundBlinkOpacity: number;
} {
  return {
    textColor: normalizeColorValue(definition?.textColor),
    backgroundColor: normalizeColorValue(definition?.backgroundColor),
    backgroundBlinkEnabled: definition?.backgroundBlinkEnabled === true,
    backgroundBlinkDurationMs: clamp(
      Math.round(toFiniteNumber(definition?.backgroundBlinkDurationMs, 1600)),
      300,
      10000,
    ),
    backgroundBlinkOpacity: clamp(
      toFiniteNumber(definition?.backgroundBlinkOpacity, 0.45),
      0,
      1,
    ),
  };
}

function isRussianUi(): boolean {
  if (typeof document !== "undefined") {
    const lang = document.documentElement.lang?.toLowerCase().trim();
    if (lang?.startsWith("ru")) {
      return true;
    }
  }
  if (typeof navigator !== "undefined") {
    return navigator.language.toLowerCase().startsWith("ru");
  }
  return false;
}

function isEventTableDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem("webscada:event-runtime-debug") === "1";
  } catch {
    return false;
  }
}

function getSoundStatusLabel(kind: SoundStatusKind, russianUi: boolean): string {
  if (russianUi) {
    if (kind === "disabled") {
      return "звук отключён";
    }
    if (kind === "blocked") {
      return "звук заблокирован";
    }
    if (kind === "error") {
      return "ошибка звука";
    }
    return "звук включён";
  }

  if (kind === "disabled") {
    return "sound disabled";
  }
  if (kind === "blocked") {
    return "sound blocked";
  }
  if (kind === "error") {
    return "sound error";
  }
  return "sound enabled";
}

export function EventTableRuntimeWidget({
  object,
  screenId,
  userRoleLevel = 0,
  isAuthenticated = false,
}: EventTableRuntimeWidgetProps) {
  const runtimeEvents = useSyncExternalStore(
    eventRuntimeStore.subscribe,
    eventRuntimeStore.getSnapshot,
    eventRuntimeStore.getSnapshot,
  );
  const project = useScadaStore((store) => store.project);
  const currentScreenId = useScadaStore((store) => store.currentScreenId);
  const updateObjectDeep = useScadaStore((store) => store.updateObjectDeep);
  const projectEventSounds = useScadaStore((store) => store.project?.eventSounds ?? []);

  const [soundStatusText, setSoundStatusText] = useState<string>("");
  const [busyAck, setBusyAck] = useState(false);
  const [busyExport, setBusyExport] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [runtimeColumnWidths, setRuntimeColumnWidths] = useState<Record<string, number>>({});
  const [soundSilenced, setSoundSilenced] = useState(false);
  const [soundDisabledUntilEnabled, setSoundDisabledUntilEnabled] = useState(false);
  const [showOperatorActions, setShowOperatorActions] = useState(object.showOperatorActions === true);
  const [connectionState, setConnectionState] = useState<ConnectionState>(() => getConnectionSnapshot().state);
  const [operatorActionHistory, setOperatorActionHistory] = useState<{
    items: OperatorActionRecord[];
    total: number;
    limit: number;
    offset: number;
    loading: boolean;
    error: string | null;
    updatedAt: number | null;
  }>({
    items: [],
    total: 0,
    limit: 0,
    offset: 0,
    loading: false,
    error: null,
    updatedAt: null,
  });

  const oncePlayedIdsRef = useRef<Set<string>>(new Set());
  const silenceBlockedRef = useRef(false);
  const silenceSnapshotActiveIdsRef = useRef<Set<string>>(new Set());
  const soundLoopRetryTimerRef = useRef<number | null>(null);
  const columnResizeRef = useRef<ColumnResizeState>(null);
  const persistenceWarningShownRef = useRef(false);
  const operatorActionRequestSeqRef = useRef(0);
  const debugLogAtRef = useRef(0);

  useEffect(() => subscribeConnectionState((snapshot) => {
    setConnectionState(snapshot.state);
  }), []);

  const config = useMemo(() => resolveEventTableConfig(object), [object]);
  const russianUi = useMemo(() => isRussianUi(), []);
  const usesPersistentSoundDisable = config.soundMuteMode === "disableUntilEnabled";
  const soundMuteActive = usesPersistentSoundDisable ? soundDisabledUntilEnabled : soundSilenced;
  const soundPlaybackDisabled = usesPersistentSoundDisable ? soundDisabledUntilEnabled : false;
  const settingsRoleAllowed = hasRoleAccess(userRoleLevel, config.settingsRequiredRole);
  const canOpenSettings = config.showSettingsButton && settingsRoleAllowed && (config.settingsRequiredRole ? isAuthenticated : true);

  const title = object.title?.trim() || "Event Table";
  const columns = config.columns;
  const textColor = object.textColor ?? "#d4d4d4";
  const mutedTextColor = object.mutedTextColor ?? "#9ea6ad";
  const backgroundColor = object.backgroundColor ?? "#1f2328";
  const headerBackgroundColor = object.headerBackgroundColor ?? "#2a3038";
  const headerTextColor = object.headerTextColor ?? "#ced8df";
  const borderColor = object.borderColor ?? "#3c3c3c";
  const gridLineColor = object.gridLineColor ?? "#30363d";
  const fontSize = clamp(toFiniteNumber(object.fontSize, 12), 10, 24);
  const rowHeight = clamp(toFiniteNumber(object.rowHeight, 26), 20, 52);
  const headerHeight = clamp(toFiniteNumber(object.headerHeight, 28), 20, 60);
  const titleHeight = clamp(toFiniteNumber(object.titleHeight, object.headerHeight ?? 28), 16, 80);
  const titleFontSize = clamp(toFiniteNumber(object.titleFontSize, fontSize + 1), 8, 32);
  const borderRadius = clamp(toFiniteNumber(object.borderRadius, 6), 0, 24);
  const borderWidth = clamp(toFiniteNumber(object.borderWidth, 1), 0, 4);
  const mode = object.mode ?? (object.enableHistoryMode ? "history" : "online");
  const historyPreset = resolveEventTableHistoryRange(object);
  const statusPosition = object.statusPosition ?? "bottom";
  const statusStyle = object.statusStyle ?? "archiveLike";
  const showStatus = object.showStatusBar !== false && statusStyle !== "hidden" && statusPosition !== "hidden";
  const showTopStatus = showStatus && statusPosition === "top";
  const showBottomStatus = showStatus && statusPosition === "bottom";
  const showHeader = object.showHeader !== false;
  const maxRows = Math.min(MAX_EVENT_TABLE_ROWS, Math.max(1, Math.round(object.maxRows ?? 100)));
  const pageSize = Math.min(MAX_EVENT_TABLE_PAGE_SIZE, Math.max(1, Math.round(object.pageSize ?? 50)));
  const compactMode = object.compactMode ?? false;
  const showGridLines = object.showGridLines !== false;
  const transparentBackground = object.transparentBackground === true;
  const tableBackground = transparentBackground ? "transparent" : backgroundColor;

  const showTitleTop = config.titlePosition === "top";
  const showTitleBottom = config.titlePosition === "bottom";
  const showToolbarTop = config.showToolbar && config.toolbarPosition === "top";
  const showToolbarBottom = config.showToolbar && config.toolbarPosition === "bottom";
  const canShowOperatorActionsToggle = config.showToolbar;
  const showOperatorActionsInOnline = mode === "online" && showOperatorActions;
  const showOperatorActionsInHistory = mode === "history" && showOperatorActions;
  const showOperatorActionsInMode = showOperatorActionsInOnline || showOperatorActionsInHistory;

  const resolvedScreenId = useMemo(
    () => screenId ?? currentScreenId ?? findObjectScreenId(project, object.id),
    [currentScreenId, object.id, project, screenId],
  );

  const patchObject = useCallback((patch: Partial<EventTableObject>) => {
    if (!project || !resolvedScreenId) {
      // TODO(event-table): provide a dedicated runtime object-config persistence API for overlay contexts without screen binding.
      if (!persistenceWarningShownRef.current) {
        persistenceWarningShownRef.current = true;
        void message.warning("EventTable runtime persistence is unavailable in this context.");
      }
      return;
    }
    updateObjectDeep(resolvedScreenId, object.id, patch as Partial<HmiObject>);
  }, [object.id, project, resolvedScreenId, updateObjectDeep]);

  const historyBucket = runtimeEvents.historyByWidget[object.id] ?? {
    items: [] as EventOccurrence[],
    total: 0,
    limit: 0,
    offset: 0,
    loading: false,
    error: null as string | null,
    queryKey: "",
    updatedAt: null as number | null,
  };

  const eventDefinitionById = useMemo(() => {
    const map = new Map<string, EventDefinition>();
    for (const definition of project?.events ?? []) {
      const id = definition.id?.trim();
      if (id) {
        map.set(id, definition);
      }
    }
    return map;
  }, [project?.events]);

  const historyFilterObject = useMemo(
    () => ({
      ...object,
      categoryFilter: toSingleFilterValues(object.categoryFilter),
      priorityFilter: toSingleFilterValues(object.priorityFilter),
    }),
    [object],
  );

  const onlineSortedRows = useMemo(() => {
    const filtered = filterOnlineEventRows(runtimeEvents.activeEvents, object);
    return sortEventRows(filtered, object);
  }, [object, runtimeEvents.activeEvents]);

  const onlineRows = useMemo(
    () => onlineSortedRows.slice(0, maxRows),
    [maxRows, onlineSortedRows],
  );

  const onlineEventTableRows = useMemo<EventTableRow[]>(
    () => onlineRows
      .map((event) => {
        const rowId = getEventRowId(event);
        if (!rowId) {
          return null;
        }
        return {
          rowType: "event",
          rowId,
          occurredAt: event.occurredAt,
          event,
        } as EventTableEventRow;
      })
      .filter((item): item is EventTableEventRow => Boolean(item)),
    [onlineRows],
  );

  const onlineEventRowsForMix = useMemo(
    () => onlineRows
      .map((event) => {
        const rowId = getEventRowId(event);
        if (!rowId) {
          return null;
        }
        return {
          rowType: "event",
          rowId,
          occurredAt: event.occurredAt,
          event,
        } as EventTableEventRow;
      })
      .filter((item): item is EventTableEventRow => Boolean(item)),
    [onlineRows],
  );

  const historySortedRows = useMemo(() => {
    const filtered = historyBucket.items.filter((item) => matchesCommonEventFilters(item, historyFilterObject));
    return sortEventRows(filtered, object);
  }, [historyBucket.items, historyFilterObject, object]);

  const historyTotalRows = object.serverSidePagination !== false
    ? historyBucket.total
    : historySortedRows.length;

  const historyRows = useMemo(() => {
    if (object.serverSidePagination !== false) {
      return historySortedRows;
    }
    const start = Math.max(0, (historyPage - 1) * pageSize);
    return historySortedRows.slice(start, start + pageSize);
  }, [historyPage, historySortedRows, object.serverSidePagination, pageSize]);

  const historyEventRowsForMix = useMemo(
    () => historySortedRows.slice(0, Math.max(pageSize, Math.min(MAX_MIXED_SOURCE_ROWS, maxRows))),
    [historySortedRows, maxRows, pageSize],
  );

  const historyEventTableRows = useMemo<EventTableRow[]>(
    () => historyRows
      .map((event) => {
        const rowId = getEventRowId(event);
        if (!rowId) {
          return null;
        }
        return {
          rowType: "event",
          rowId,
          occurredAt: event.occurredAt,
          event,
        } as EventTableEventRow;
      })
      .filter((item): item is EventTableEventRow => Boolean(item)),
    [historyRows],
  );

  const mixedHistoryRows = useMemo<EventTableRow[]>(() => {
    if (!showOperatorActionsInHistory) {
      return [];
    }

    const eventRows = historyEventRowsForMix
      .map((event) => {
        const rowId = getEventRowId(event);
        if (!rowId) {
          return null;
        }
        return {
          rowType: "event",
          rowId,
          occurredAt: event.occurredAt,
          event,
        } as EventTableEventRow;
      })
      .filter((item): item is EventTableEventRow => Boolean(item));
    const operatorRows = operatorActionHistory.items
      .filter((item) => matchesOperatorActionFilters(item, historyFilterObject))
      .slice(0, MAX_MIXED_SOURCE_ROWS)
      .map((item) => toOperatorActionRow(item))
      .filter((item): item is EventTableOperatorActionRow => Boolean(item));

    // Mixed pagination is approximate when server pagination is enabled:
    // each API endpoint pages independently before merge.
    return [...eventRows, ...operatorRows].sort((left, right) => compareMixedRowsByTime(left, right, object.sortDirection ?? "desc"));
  }, [historyEventRowsForMix, historyFilterObject, object.sortDirection, operatorActionHistory.items, showOperatorActionsInHistory]);

  const mixedHistoryVisibleRows = useMemo<EventTableRow[]>(() => {
    if (!showOperatorActionsInHistory) {
      return [];
    }
    if (object.serverSidePagination !== false) {
      return mixedHistoryRows.slice(0, pageSize);
    }
    const start = Math.max(0, (historyPage - 1) * pageSize);
    return mixedHistoryRows.slice(start, start + pageSize);
  }, [historyPage, mixedHistoryRows, object.serverSidePagination, pageSize, showOperatorActionsInHistory]);

  const mixedOnlineRows = useMemo<EventTableRow[]>(() => {
    if (!showOperatorActionsInOnline) {
      return [];
    }
    const operatorRows = operatorActionHistory.items
      .filter((item) => matchesOperatorActionFilters(item, object))
      .slice(0, MAX_MIXED_SOURCE_ROWS)
      .map((item) => toOperatorActionRow(item))
      .filter((item): item is EventTableOperatorActionRow => Boolean(item));
    return [...onlineEventRowsForMix, ...operatorRows]
      .sort((left, right) => compareMixedRowsByTime(left, right, object.sortDirection ?? "desc"));
  }, [object, onlineEventRowsForMix, operatorActionHistory.items, showOperatorActionsInOnline]);

  const onlineTableRows = useMemo(
    () => (showOperatorActionsInOnline ? mixedOnlineRows.slice(0, maxRows) : onlineEventTableRows),
    [maxRows, mixedOnlineRows, onlineEventTableRows, showOperatorActionsInOnline],
  );
  const historyTableRows = useMemo(
    () => (showOperatorActionsInHistory ? mixedHistoryVisibleRows : historyEventTableRows),
    [historyEventTableRows, mixedHistoryVisibleRows, showOperatorActionsInHistory],
  );
  const visibleRowsRaw = useMemo(
    () => (mode === "history" ? historyTableRows : onlineTableRows),
    [historyTableRows, mode, onlineTableRows],
  );
  const visibleRows = useMemo(
    () => visibleRowsRaw.slice(0, Math.max(pageSize, maxRows)),
    [maxRows, pageSize, visibleRowsRaw],
  );

  const historyTotalRowsForMode = showOperatorActionsInHistory
    ? (object.serverSidePagination !== false
      ? historyTotalRows + operatorActionHistory.total
      : mixedHistoryRows.length)
    : historyTotalRows;

  const totalPages = useMemo(() => {
    const total = mode === "history" ? historyTotalRowsForMode : visibleRows.length;
    return Math.max(1, Math.ceil(Math.max(1, total) / Math.max(1, pageSize)));
  }, [historyTotalRowsForMode, mode, pageSize, visibleRows.length]);

  const selectedEventCount = useMemo(
    () => visibleRows.filter((item) => item.rowType === "event" && selectedIds.has(item.rowId)).length,
    [selectedIds, visibleRows],
  );

  useEffect(() => {
    setSelectedIds((previous) => {
      const visibleIds = new Set(visibleRows.map((item) => item.rowId));
      if (previous.size === 0 && visibleIds.size === 0) {
        return previous;
      }
      const next = new Set<string>();
      for (const id of previous) {
        if (visibleIds.has(id)) {
          next.add(id);
        }
      }
      if (next.size === previous.size) {
        let equal = true;
        for (const id of next) {
          if (!previous.has(id)) {
            equal = false;
            break;
          }
        }
        if (equal) {
          return previous;
        }
      }
      return next;
    });
  }, [visibleRows]);

  useEffect(() => {
    setHistoryPage(1);
  }, [
    mode,
    object.historyPeriodPreset,
    object.historyFrom,
    object.historyTo,
    object.searchText,
    object.sourceTagFilter,
    object.categoryFilter,
    object.priorityFilter,
    pageSize,
    showOperatorActions,
  ]);

  useEffect(() => {
    setShowOperatorActions(object.showOperatorActions === true);
  }, [object.id, object.showOperatorActions]);

  useEffect(() => {
    if (usesPersistentSoundDisable) {
      if (soundSilenced) {
        setSoundSilenced(false);
      }
      silenceBlockedRef.current = false;
      silenceSnapshotActiveIdsRef.current.clear();
      return;
    }
    if (soundDisabledUntilEnabled) {
      setSoundDisabledUntilEnabled(false);
    }
  }, [soundDisabledUntilEnabled, soundSilenced, usesPersistentSoundDisable]);

  useEffect(() => {
    if (settingsOpen && !canOpenSettings) {
      setSettingsOpen(false);
    }
  }, [canOpenSettings, settingsOpen]);

  useEffect(() => {
    const normalized = normalizeEventTableColumnWidths(object.columnWidths);
    setRuntimeColumnWidths((previous) => (areColumnWidthsEqual(previous, normalized) ? previous : normalized));
  }, [object.columnWidths, object.id]);

  useEffect(() => {
    eventRuntimeStore.setRecentBufferLimit(maxRows);
    eventRuntimeStore.setOnlineRetentionLimit(Math.max(1000, maxRows * 4));
  }, [maxRows]);

  useEffect(() => {
    if (mode !== "online") {
      return;
    }
    void eventRuntimeStore.initializeOnline();
    void eventRuntimeStore.reloadOnline(Math.min(1000, Math.max(200, maxRows * 2)));
  }, [maxRows, mode]);

  const historyQuery = useMemo(
    () => buildEventTableHistoryQuery({ object, page: historyPage, pageSize, maxRows }),
    [historyPage, maxRows, object, pageSize],
  );

  useEffect(() => {
    if (mode !== "history") {
      return;
    }
    void eventRuntimeStore.loadHistory({ widgetId: object.id, query: historyQuery });
  }, [historyQuery, mode, object.id]);

  useEffect(() => {
    if (mode !== "history") {
      return;
    }
    void eventRuntimeStore.loadArchiveStatus({ minIntervalMs: ARCHIVE_STATUS_REFRESH_INTERVAL_MS });
    const timer = window.setInterval(() => {
      void eventRuntimeStore.loadArchiveStatus({ minIntervalMs: ARCHIVE_STATUS_REFRESH_INTERVAL_MS });
    }, ARCHIVE_STATUS_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [mode]);

  const operatorActionQueryLimit = useMemo(
    () => Math.min(MAX_OPERATOR_ACTION_QUERY_LIMIT, Math.max(pageSize, maxRows)),
    [maxRows, pageSize],
  );
  const operatorActionHistoryFrom = mode === "history" ? historyQuery.from : null;
  const operatorActionHistoryTo = mode === "history" ? historyQuery.to : null;
  const operatorActionHistoryLimit = mode === "history"
    ? Math.min(operatorActionQueryLimit, Math.max(1, historyQuery.limit ?? operatorActionQueryLimit))
    : null;
  const operatorActionHistoryOffset = mode === "history" ? historyQuery.offset : null;

  useEffect(() => {
    if (mode !== "history" || showOperatorActionsInHistory) {
      return;
    }
    setOperatorActionHistory((previous) => {
      if (previous.items.length === 0 && previous.total === 0) {
        return previous;
      }
      return {
        ...previous,
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
        loading: false,
        error: null,
      };
    });
  }, [mode, showOperatorActionsInHistory]);

  useEffect(() => {
    if (!showOperatorActionsInMode) {
      setOperatorActionHistory((previous) => {
        if (
          previous.items.length === 0
          && previous.total === 0
          && previous.limit === 0
          && previous.offset === 0
          && previous.loading === false
          && previous.error === null
          && previous.updatedAt === null
        ) {
          return previous;
        }
        return {
          ...previous,
          items: [],
          total: 0,
          limit: 0,
          offset: 0,
          loading: false,
          error: null,
          updatedAt: null,
        };
      });
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const loadOperatorActions = () => {
      const requestSeq = operatorActionRequestSeqRef.current + 1;
      operatorActionRequestSeqRef.current = requestSeq;
      setOperatorActionHistory((previous) => {
        const nextLoading = mode === "history" || previous.updatedAt === null;
        if (previous.loading === nextLoading && previous.error === null) {
          return previous;
        }
        return {
          ...previous,
          loading: nextLoading,
          error: null,
        };
      });

      const query = mode === "history"
        ? {
          from: operatorActionHistoryFrom ?? undefined,
          to: operatorActionHistoryTo ?? undefined,
          search: object.searchText?.trim() || undefined,
          limit: operatorActionHistoryLimit ?? undefined,
          offset: operatorActionHistoryOffset ?? undefined,
        }
        : {
          from: new Date(Date.now() - OPERATOR_ACTION_ONLINE_WINDOW_MS).toISOString(),
          to: new Date().toISOString(),
          search: object.searchText?.trim() || undefined,
          limit: operatorActionQueryLimit,
          offset: 0,
        };

      void api.getOperatorActionHistory(query)
        .then((page) => {
          if (cancelled || operatorActionRequestSeqRef.current !== requestSeq) {
            return;
          }
          const deduped = dedupeOperatorActionsById(page.items ?? []);
          setOperatorActionHistory({
            items: deduped,
            total: page.total ?? deduped.length,
            limit: page.limit ?? 0,
            offset: page.offset ?? 0,
            loading: false,
            error: null,
            updatedAt: Date.now(),
          });
        })
        .catch((error: unknown) => {
          if (cancelled || operatorActionRequestSeqRef.current !== requestSeq) {
            return;
          }
          const text = error instanceof Error ? error.message : String(error);
          setOperatorActionHistory((previous) => ({
            ...previous,
            loading: false,
            error: text,
          }));
        });
    };

    loadOperatorActions();
    if (mode === "online") {
      timer = window.setInterval(loadOperatorActions, OPERATOR_ACTION_ONLINE_POLL_MS);
    }
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
    };
  }, [
    maxRows,
    mode,
    object.searchText,
    operatorActionQueryLimit,
    operatorActionHistoryFrom,
    operatorActionHistoryLimit,
    operatorActionHistoryOffset,
    operatorActionHistoryTo,
    pageSize,
    showOperatorActionsInMode,
  ]);

  useEffect(() => {
    if (!isEventTableDebugEnabled()) {
      return;
    }
    const now = Date.now();
    if (now - debugLogAtRef.current < DEBUG_LOG_INTERVAL_MS) {
      return;
    }
    debugLogAtRef.current = now;
    console.debug("[EventTableRuntimeWidget]", {
      widgetId: object.id,
      mode,
      activeEventsLength: runtimeEvents.activeEvents.length,
      recentEventsLength: runtimeEvents.recentEvents.length,
      historyRowsLoaded: historyBucket.items.length,
      operatorActionRowsLoaded: operatorActionHistory.items.length,
      visibleRowsLength: visibleRows.length,
    });
  }, [
    historyBucket.items.length,
    mode,
    object.id,
    operatorActionHistory.items.length,
    runtimeEvents.activeEvents.length,
    runtimeEvents.recentEvents.length,
    visibleRows.length,
  ]);

  useEffect(() => () => {
    eventRuntimeStore.clearHistory(object.id);
  }, [object.id]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const state = columnResizeRef.current;
      if (!state) {
        return;
      }
      const delta = event.clientX - state.startX;
      const nextWidth = clamp(Math.round(state.startWidth + delta), 40, 1400);
      setRuntimeColumnWidths((previous) => ({
        ...previous,
        [state.column]: nextWidth,
      }));
    };

    const handleUp = () => {
      const state = columnResizeRef.current;
      if (!state) {
        return;
      }
      columnResizeRef.current = null;
      if (typeof document !== "undefined") {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
      const width = Number(runtimeColumnWidths[state.column]);
      if (!Number.isFinite(width)) {
        return;
      }
      patchObject({
        columnWidths: {
          ...(object.columnWidths ?? {}),
          [state.column]: clamp(Math.round(width), 40, 1400),
        },
      });
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("blur", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("blur", handleUp);
    };
  }, [object.columnWidths, patchObject, runtimeColumnWidths]);

  const toggleRowSelection = useCallback((occurrenceId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(occurrenceId)) {
        next.delete(occurrenceId);
      } else {
        next.add(occurrenceId);
      }
      return next;
    });
  }, []);

  const playSoundForOccurrence = useCallback(async (occurrence: EventOccurrence): Promise<OncePlaybackOutcome> => {
    if (soundPlaybackDisabled) {
      return "skipped";
    }
    const soundId = resolveEventOccurrenceSoundId(occurrence, object, projectEventSounds);
    if (!soundId) {
      return "skipped";
    }

    const result = await eventSoundPlayer.playSound(soundId, projectEventSounds);
    if (!result.ok) {
      if (result.reason === "autoplay_blocked") {
        const autoplayText = "Sound playback was blocked by the browser. Click Enable sounds.";
        setSoundStatusText(autoplayText);
        eventRuntimeStore.setSoundStatusMessage(autoplayText);
        return "autoplay_blocked";
      }
      setSoundStatusText(result.message);
      eventRuntimeStore.setSoundStatusMessage(result.message);
      return "error";
    }

    if (runtimeEvents.soundStatusMessage) {
      eventRuntimeStore.setSoundStatusMessage(null);
    }
    if (soundStatusText) {
      setSoundStatusText("");
    }
    return "played";
  }, [object, projectEventSounds, runtimeEvents.soundStatusMessage, soundPlaybackDisabled, soundStatusText]);

  const startLoopSoundForOccurrence = useCallback(async (occurrence: EventOccurrence) => {
    if (soundPlaybackDisabled) {
      return { ok: false as const, reason: "sound_disabled" as const };
    }
    const soundId = resolveEventOccurrenceSoundId(occurrence, object, projectEventSounds);
    if (!soundId) {
      return { ok: false as const, reason: "missing_sound_id" as const };
    }

    const result = await eventSoundPlayer.startSeamlessLoop(soundId, projectEventSounds);
    if (!result.ok) {
      if (result.reason === "autoplay_blocked") {
        const autoplayText = "Sound playback was blocked by the browser. Click Enable sounds.";
        setSoundStatusText(autoplayText);
        eventRuntimeStore.setSoundStatusMessage(autoplayText);
        return { ok: false as const, reason: "autoplay_blocked" as const };
      }
      setSoundStatusText(result.message);
      eventRuntimeStore.setSoundStatusMessage(result.message);
      return { ok: false as const, reason: "playback_failed" as const };
    }

    if (runtimeEvents.soundStatusMessage) {
      eventRuntimeStore.setSoundStatusMessage(null);
    }
    if (soundStatusText) {
      setSoundStatusText("");
    }
    return { ok: true as const };
  }, [object, projectEventSounds, runtimeEvents.soundStatusMessage, soundPlaybackDisabled, soundStatusText]);

  useEffect(() => {
    if (mode !== "online" || config.soundPlaybackMode !== "once") {
      return;
    }

    const newActive = runtimeEvents.activeEvents
      .filter((item) => !item.clearedAt)
      .filter((item) => {
        const id = normalizeOccurrenceId(item);
        return id && !oncePlayedIdsRef.current.has(id);
      })
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

    if (newActive.length === 0) {
      return;
    }

    const newest = newActive[newActive.length - 1];
    if (newest) {
      void playSoundForOccurrence(newest).then((result) => {
        // Only seal this occurrence after a successful playback (or explicit skip without sound).
        // If autoplay is blocked, keep it pending so it can be replayed after user enables sounds.
        if (!shouldCommitOncePlayback(result)) {
          return;
        }
        for (const item of newActive) {
          const id = normalizeOccurrenceId(item);
          if (id) {
            oncePlayedIdsRef.current.add(id);
          }
        }
        if (oncePlayedIdsRef.current.size > 20000) {
          const trimmed = [...oncePlayedIdsRef.current].slice(-10000);
          oncePlayedIdsRef.current = new Set(trimmed);
        }
      });
    }
  }, [config.soundPlaybackMode, mode, playSoundForOccurrence, runtimeEvents.activeEvents]);

  const clearSoundLoopRetryTimer = useCallback(() => {
    if (soundLoopRetryTimerRef.current !== null) {
      window.clearTimeout(soundLoopRetryTimerRef.current);
      soundLoopRetryTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (mode !== "online" || config.soundPlaybackMode !== "loopUntilAcknowledged") {
      clearSoundLoopRetryTimer();
      eventSoundPlayer.stopSeamlessLoop();
      return;
    }

    const unackedActiveIds = new Set(
      runtimeEvents.activeEvents
        .filter((item) => !item.acknowledgedAt && !item.clearedAt)
        .map((item) => normalizeOccurrenceId(item))
        .filter(Boolean),
    );

    if (!usesPersistentSoundDisable && silenceBlockedRef.current) {
      const hasNewUnackedActive = [...unackedActiveIds].some((id) => !silenceSnapshotActiveIdsRef.current.has(id));
      if (hasNewUnackedActive) {
        silenceBlockedRef.current = false;
        silenceSnapshotActiveIdsRef.current.clear();
        setSoundSilenced(false);
      }
    }

    const loopCandidates = runtimeEvents.activeEvents.filter((item) => !item.acknowledgedAt);

    if (loopCandidates.length === 0) {
      clearSoundLoopRetryTimer();
      if (config.stopSoundOnAck) {
        eventSoundPlayer.stopSeamlessLoop();
        eventSoundPlayer.stopCurrentSound();
      }
      return;
    }

    if (soundPlaybackDisabled) {
      clearSoundLoopRetryTimer();
      eventSoundPlayer.stopSeamlessLoop();
      eventSoundPlayer.stopCurrentSound();
      return;
    }

    if (!usesPersistentSoundDisable && silenceBlockedRef.current) {
      clearSoundLoopRetryTimer();
      eventSoundPlayer.stopSeamlessLoop();
      return;
    }

    const pickCurrentCandidate = () => {
      const sorted = [...loopCandidates].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
      return sorted[0] ?? null;
    };

    const candidate = pickCurrentCandidate();
    if (!candidate) {
      clearSoundLoopRetryTimer();
      return;
    }

    let cancelled = false;
    const run = () => {
      if (cancelled) {
        return;
      }
      void startLoopSoundForOccurrence(candidate).then((result) => {
        if (cancelled || result.ok) {
          return;
        }
        clearSoundLoopRetryTimer();
        soundLoopRetryTimerRef.current = window.setTimeout(run, config.soundRepeatIntervalMs);
      });
    };

    clearSoundLoopRetryTimer();
    run();

    return () => {
      cancelled = true;
      clearSoundLoopRetryTimer();
    };
  }, [
    clearSoundLoopRetryTimer,
    config.soundPlaybackMode,
    config.soundRepeatIntervalMs,
    config.stopSoundOnAck,
    mode,
    soundPlaybackDisabled,
    soundSilenced,
    startLoopSoundForOccurrence,
    usesPersistentSoundDisable,
    runtimeEvents.activeEvents,
  ]);

  const acknowledgeRows = useCallback(async (ids: string[]) => {
    const unique = [...new Set(ids.map((item) => item.trim()).filter(Boolean))];
    if (unique.length === 0) {
      void message.info("No unacknowledged events to acknowledge.");
      return;
    }

    setBusyAck(true);
    try {
      const response = await eventRuntimeStore.acknowledgeOccurrences(unique);
      const acknowledgedCount = response.acknowledged.length;
      if (acknowledgedCount > 0) {
        void message.success(`Acknowledged ${acknowledgedCount} event${acknowledgedCount === 1 ? "" : "s"}.`);
      }
      if (response.notFoundIds.length > 0 || response.ackTagWriteFailures.length > 0) {
        const details = [
          response.notFoundIds.length > 0 ? `not found: ${response.notFoundIds.length}` : "",
          response.ackTagWriteFailures.length > 0 ? `ack tag write failures: ${response.ackTagWriteFailures.length}` : "",
        ]
          .filter(Boolean)
          .join(" | ");
        if (details) {
          void message.warning(`Acknowledge completed with partial issues (${details}).`);
        }
      }

      if (config.stopSoundOnAck) {
        eventSoundPlayer.stopSeamlessLoop();
        eventSoundPlayer.stopAllSounds();
      }

      setSelectedIds((previous) => {
        if (previous.size === 0) {
          return previous;
        }
        const next = new Set(previous);
        for (const id of unique) {
          next.delete(`event:${id}`);
        }
        return next;
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void message.error(`Failed to acknowledge events: ${text}`);
    } finally {
      setBusyAck(false);
    }
  }, [config.stopSoundOnAck]);

  const handleAcknowledgeVisible = useCallback(() => {
    const ids = visibleRows
      .filter((item): item is EventTableEventRow => item.rowType === "event" && !item.event.acknowledgedAt)
      .map((item) => String(item.event.id));
    void acknowledgeRows(ids);
  }, [acknowledgeRows, visibleRows]);

  const handleAcknowledgeSelected = useCallback(() => {
    const ids = visibleRows
      .filter((item): item is EventTableEventRow => (
        item.rowType === "event"
        && selectedIds.has(item.rowId)
        && !item.event.acknowledgedAt
      ))
      .map((item) => String(item.event.id));
    void acknowledgeRows(ids);
  }, [acknowledgeRows, selectedIds, visibleRows]);

  const handleAcknowledgeSingle = useCallback((occurrenceId: string, acknowledgedAt: string | null | undefined) => {
    if (acknowledgedAt || busyAck) {
      return;
    }
    void acknowledgeRows([occurrenceId]);
  }, [acknowledgeRows, busyAck]);

  const resolveExportRows = useCallback((selectedOnly: boolean) => {
    if (!selectedOnly) {
      return visibleRows;
    }
    return visibleRows.filter((item) => selectedIds.has(item.rowId));
  }, [selectedIds, visibleRows]);

  const buildExportStatusSummary = useCallback(() => {
    if (mode === "history") {
      return `Mode: history | Period: ${historyPreset.label} | Rows: ${historyTotalRowsForMode}`;
    }
    const onlineStatusLabel = connectionState === "offline"
      ? "offline"
      : runtimeEvents.onlineStatus === "open"
        ? "online"
        : runtimeEvents.onlineStatus;
    return `Mode: online (${onlineStatusLabel}) | Active: ${runtimeEvents.activeCount} | Unacked: ${runtimeEvents.unacknowledgedCount} | Rows: ${visibleRows.length}`;
  }, [connectionState, historyPreset.label, historyTotalRowsForMode, mode, runtimeEvents.activeCount, runtimeEvents.onlineStatus, runtimeEvents.unacknowledgedCount, visibleRows.length]);

  const handleExport = useCallback(async (options: EventTableExportOptions) => {
    if (object.enableCsvExport === false) {
      void message.info("CSV export is disabled in widget settings.");
      return;
    }

    const rows = resolveExportRows(options.selectedOnly);
    if (rows.length === 0) {
      void message.info(options.selectedOnly ? "No selected rows to export." : "No messages to export.");
      return;
    }

    const statusSummary = options.includeStatusLine ? buildExportStatusSummary() : null;
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const baseName = mode === "history" ? `event-history-${timestamp}` : `event-online-${timestamp}`;

    setBusyExport(true);
    try {
      const useArchiveCsv = options.format === "csv"
        && mode === "history"
        && !showOperatorActionsInHistory
        && options.csvSource === "archiveQuery"
        && !options.selectedOnly
        && options.includeHeaders
        && options.csvDelimiter === ","
        && !options.includeStatusLine;

      if (useArchiveCsv) {
        const csvText = await eventRuntimeStore.exportHistoryCsv(historyQuery);
        downloadCsvFile(`${baseName}.csv`, csvText);
        void message.success("CSV export started.");
        return;
      }

      if (options.format === "csv") {
        const csvText = buildClientCsv(
          rows,
          columns,
          object.columnLabels,
          options.csvDelimiter,
          options.includeHeaders,
          statusSummary,
        );
        downloadCsvFile(`${baseName}.csv`, csvText);
        void message.success(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"} to CSV.`);
        return;
      }

      const html = buildHtmlExport(
        rows,
        columns,
        object.columnLabels,
        options.includeHeaders,
        title,
        statusSummary,
        options.pdfOrientation,
      );

      if (options.format === "excel") {
        const excelBlob = new Blob([`\uFEFF${html}`], { type: "application/vnd.ms-excel;charset=utf-8" });
        downloadBlobFile(`${baseName}.xls`, excelBlob);
        void message.success(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"} to Excel.`);
        return;
      }

      await printHtmlDocument(html);
      void message.success("PDF print dialog opened.");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void message.error(`Export failed: ${text}`);
    } finally {
      setBusyExport(false);
    }
  }, [buildExportStatusSummary, columns, historyQuery, mode, object.columnLabels, object.enableCsvExport, resolveExportRows, showOperatorActionsInHistory, title]);

  const muteSounds = useCallback(() => {
    eventSoundPlayer.stopSeamlessLoop();
    eventSoundPlayer.stopAllSounds();
    if (usesPersistentSoundDisable) {
      silenceBlockedRef.current = false;
      silenceSnapshotActiveIdsRef.current.clear();
      setSoundSilenced(false);
      setSoundDisabledUntilEnabled(true);
    } else {
      setSoundSilenced(true);
      silenceBlockedRef.current = true;
      silenceSnapshotActiveIdsRef.current = new Set(
        runtimeEvents.activeEvents
          .filter((item) => !item.acknowledgedAt && !item.clearedAt)
          .map((item) => normalizeOccurrenceId(item))
          .filter(Boolean),
      );
    }
    setSoundStatusText("");
    eventRuntimeStore.setSoundStatusMessage(null);
  }, [runtimeEvents.activeEvents, usesPersistentSoundDisable]);

  const unsilenceSounds = useCallback(() => {
    silenceBlockedRef.current = false;
    silenceSnapshotActiveIdsRef.current.clear();
    setSoundSilenced(false);
    setSoundDisabledUntilEnabled(false);
    setSoundStatusText("");
    eventRuntimeStore.setSoundStatusMessage(null);
  }, []);

  const soundStatusKind: SoundStatusKind = useMemo(() => {
    const statusText = (runtimeEvents.soundStatusMessage || soundStatusText || "").trim();
    if (soundMuteActive) {
      return "disabled";
    }
    if (eventSoundPlayer.hasAutoplayBlock()) {
      return "blocked";
    }
    if (statusText) {
      return "error";
    }
    return "enabled";
  }, [runtimeEvents.soundStatusMessage, soundMuteActive, soundStatusText]);

  const soundStatusLabel = useMemo(
    () => getSoundStatusLabel(soundStatusKind, russianUi),
    [russianUi, soundStatusKind],
  );

  const historyFilterNote = mode === "history" && hasMultiValueHistoryFilters(object)
    ? "History filter uses single category and single priority value; extra values are ignored."
    : "";
  const operatorActionModeNote = mode === "online" && showOperatorActions
    ? "Operator actions are shown in online mode for the last 5 minutes."
    : "";
  const statusNote = [historyFilterNote, operatorActionModeNote].filter(Boolean).join(" | ");

  const openSettingsDialog = useCallback(() => {
    if (!canOpenSettings) {
      return;
    }
    setSettingsOpen(true);
  }, [canOpenSettings]);

  const renderStatus = () => {
    if (!showStatus) {
      return null;
    }

    const modeLoading = mode === "history"
      ? (historyBucket.loading || (showOperatorActionsInHistory && operatorActionHistory.loading))
      : (runtimeEvents.onlineLoading || (showOperatorActionsInOnline && operatorActionHistory.loading));
    const modeError = mode === "history"
      ? (historyBucket.error || (showOperatorActionsInHistory ? operatorActionHistory.error : null))
      : (runtimeEvents.onlineError || (showOperatorActionsInOnline ? operatorActionHistory.error : null));
    const modeLoadingNote = modeLoading
      ? (mode === "history"
        ? (showOperatorActionsInHistory ? "Loading history events and operator actions..." : "Loading history events...")
        : (showOperatorActionsInOnline ? "Loading online events and operator actions..." : "Loading online events..."))
      : "";
    const modeErrorNote = modeError ? `Error: ${modeError}` : "";

    const onlineStatusLabel = connectionState === "offline"
      ? "offline"
      : runtimeEvents.onlineStatus === "open"
        ? "online"
        : runtimeEvents.onlineStatus;
    const onlineSegments = [
      `Event status: ${onlineStatusLabel}`,
      `active ${runtimeEvents.activeCount}`,
      `unacked ${runtimeEvents.unacknowledgedCount}`,
      soundStatusLabel,
      object.showLastUpdate === false ? "update --:--:--" : `update ${formatStatusClockTime(runtimeEvents.lastUpdateAt)}`,
      object.showModeIndicator === false ? "mode --" : "mode online",
      object.showRecordCount === false ? "rows --" : `rows ${onlineRows.length}`,
      ...(statusNote ? [statusNote] : []),
      ...(modeLoadingNote ? [modeLoadingNote] : []),
      ...(modeErrorNote ? [modeErrorNote] : []),
    ];

    const historyState = historyBucket.loading ? "loading" : historyBucket.error ? "error" : "ready";
    const historySegments = [
      `Event archive: ${historyState}`,
      `period ${historyPreset.label}`,
      `records ${historyTotalRowsForMode}`,
      soundStatusLabel,
      object.showDatabaseStatus === false ? "DB --" : `DB ${formatDbSizeLabel(runtimeEvents.archiveStatus?.dbSizeMb)}`,
      object.showDatabaseStatus === false ? "total --" : `total ${formatRecordCountLabel(runtimeEvents.archiveStatus?.recordsCount)}`,
      ...(statusNote ? [statusNote] : []),
      ...(modeLoadingNote ? [modeLoadingNote] : []),
      ...(modeErrorNote ? [modeErrorNote] : []),
    ];

    const text = mode === "history" ? historySegments.join(" | ") : onlineSegments.join(" | ");
    const tone = mode === "history" ? (object.warningColor ?? "#e6b450") : (object.activeAlarmColor ?? "#4ec94e");
    const isCompactStyle = statusStyle === "compact";

    if (isCompactStyle) {
      return (
        <div
          className="event-table-status"
          style={{
            minHeight: Math.max(20, rowHeight - 2),
            padding: compactMode ? "3px 8px" : "4px 8px",
            borderTop: showBottomStatus ? `1px solid ${gridLineColor}` : "none",
            borderBottom: showTopStatus ? `1px solid ${gridLineColor}` : "none",
            color: tone,
            fontSize: Math.max(10, fontSize - 1),
          }}
          title={text}
        >
          {text}
        </div>
      );
    }

    const lineOne = mode === "history"
      ? `Event archive: ${historyState} | period ${historyPreset.label} | records ${historyTotalRowsForMode} | ${soundStatusLabel}`
      : `Event status: ${onlineStatusLabel} | active ${runtimeEvents.activeCount} | unacked ${runtimeEvents.unacknowledgedCount} | ${soundStatusLabel}`;
    const lineTwo = mode === "history"
      ? (object.showDatabaseStatus === false
        ? "DB -- | total --"
        : `DB ${formatDbSizeLabel(runtimeEvents.archiveStatus?.dbSizeMb)} | total ${formatRecordCountLabel(runtimeEvents.archiveStatus?.recordsCount)}`)
      : `${object.showLastUpdate === false ? "update --:--:--" : `update ${formatStatusClockTime(runtimeEvents.lastUpdateAt)}`} | ${object.showRecordCount === false ? "rows --" : `rows ${onlineRows.length}`}`;
    const lineTwoWithNote = [lineTwo, statusNote, modeLoadingNote, modeErrorNote].filter(Boolean).join(" | ");

    const archiveLikeContainerStyle: CSSProperties = {
      minHeight: Math.max(24, rowHeight),
      padding: compactMode ? "4px 8px" : "5px 10px",
      borderTop: showBottomStatus ? `1px solid ${gridLineColor}` : "none",
      borderBottom: showTopStatus ? `1px solid ${gridLineColor}` : "none",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: 1,
      overflow: "hidden",
      background: "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 100%)",
    };

    if (config.statusSingleLine) {
      return (
        <div style={archiveLikeContainerStyle} className="event-table-status">
          <div style={{ color: tone, fontWeight: 600, fontSize: Math.max(10, fontSize - 1), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {lineOne}
          </div>
        </div>
      );
    }

    return (
      <div style={archiveLikeContainerStyle}>
        <div style={{ color: tone, fontWeight: 600, fontSize: Math.max(10, fontSize - 1), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {lineOne}
        </div>
        <div style={{ color: mutedTextColor, opacity: 0.9, fontSize: Math.max(9, fontSize - 2), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {lineTwoWithNote}
        </div>
      </div>
    );
  };

  const effectiveColumnWidths = useMemo(() => ({
    ...normalizeEventTableColumnWidths(object.columnWidths),
    ...normalizeEventTableColumnWidths(runtimeColumnWidths),
  }), [object.columnWidths, runtimeColumnWidths]);

  const gridTemplateColumns = useMemo(
    () => columns
      .map((column) => {
        const manualWidth = Number(effectiveColumnWidths[column]);
        if (Number.isFinite(manualWidth) && manualWidth > 32) {
          return `${manualWidth}px`;
        }
        const defaultWidth = Number(DEFAULT_COLUMN_WIDTH_PX[column]);
        if (Number.isFinite(defaultWidth) && defaultWidth > 32) {
          return `${defaultWidth}px`;
        }
        return "minmax(80px, 1fr)";
      })
      .join(" "),
    [columns, effectiveColumnWidths],
  );

  const historyCanPrev = historyPage > 1;
  const historyCanNext = historyPage < totalPages;
  const csvTooltipTitle = `${mode === "history" ? "Export history records" : "Export online messages"}${object.enableCsvExport === false ? " (disabled)" : ""}`;
  const historyLoading = historyBucket.loading || (showOperatorActionsInHistory && operatorActionHistory.loading);
  const onlineLoading = runtimeEvents.onlineLoading || (showOperatorActionsInOnline && operatorActionHistory.loading);
  const historyError = historyBucket.error || (showOperatorActionsInHistory ? operatorActionHistory.error : null);
  const onlineError = runtimeEvents.onlineError || (showOperatorActionsInOnline ? operatorActionHistory.error : null);

  const startColumnResize = (event: ReactMouseEvent<HTMLDivElement>, column: EventTableColumnId) => {
    event.preventDefault();
    event.stopPropagation();
    const current = Number(effectiveColumnWidths[column]);
    const startWidth = Number.isFinite(current) && current > 32 ? current : 120;
    columnResizeRef.current = {
      column,
      startX: event.clientX,
      startWidth,
    };
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    }
  };

  const titleBlock = (
    <div
      style={{
        minHeight: compactMode ? Math.max(20, titleHeight - 4) : titleHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: resolveTitleAlign(config.titleAlign),
        padding: "0 10px",
        background: object.titleBackgroundColor ?? headerBackgroundColor,
        color: object.titleTextColor ?? headerTextColor,
        borderBottom: showTitleTop ? `1px solid ${gridLineColor}` : "none",
        borderTop: showTitleBottom ? `1px solid ${gridLineColor}` : "none",
        fontWeight: 600,
        letterSpacing: 0.2,
        fontSize: titleFontSize,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
      title={title}
    >
      {title}
    </div>
  );

  const toolbarNode = (
    <div className="event-table-toolbar">
      {config.showSearch ? (
        <label className="event-table-toolbar__search" title="Search">
          <SearchOutlined />
          <input
            value={object.searchText ?? ""}
            onChange={(event) => patchObject({ searchText: event.target.value })}
            placeholder="Search..."
          />
        </label>
      ) : null}

      {config.showActiveOnlyToggle ? (
        <WorkbenchIconButton
          title={`Active only (${object.showActiveOnly === true ? "on" : "off"})`}
          active={object.showActiveOnly === true}
          onClick={() => patchObject({ showActiveOnly: object.showActiveOnly !== true })}
          icon={<FilterOutlined />}
        />
      ) : null}

      {config.showUnackedOnlyToggle ? (
        <WorkbenchIconButton
          title={object.showUnacknowledgedOnly === true ? "Show acknowledged rows" : "Hide acknowledged rows"}
          active={object.showUnacknowledgedOnly !== true}
          onClick={() => patchObject({ showUnacknowledgedOnly: object.showUnacknowledgedOnly !== true })}
          icon={object.showUnacknowledgedOnly === true ? <EyeInvisibleOutlined /> : <EyeOutlined />}
        />
      ) : null}

      {canShowOperatorActionsToggle ? (
        <WorkbenchIconButton
          title={showOperatorActions ? "Hide operator actions" : "Show operator actions"}
          active={showOperatorActions}
          onClick={() => setShowOperatorActions((previous) => !previous)}
          icon={<UserSwitchOutlined />}
        />
      ) : null}

      {config.showAckVisibleButton ? (
        <WorkbenchIconButton
          title="Acknowledge visible"
          onClick={handleAcknowledgeVisible}
          disabled={busyAck}
          icon={<CheckCircleOutlined />}
        />
      ) : null}

      {object.enableAckSelectedButton ? (
        <WorkbenchIconButton
          title={`Acknowledge selected (${selectedEventCount})`}
          onClick={handleAcknowledgeSelected}
          disabled={busyAck}
          icon={<span>{selectedEventCount}</span>}
        />
      ) : null}

      {config.showSoundMuteButton ? (
        <WorkbenchIconButton
          title={soundMuteActive
            ? (russianUi ? "Звук отключён до ручного включения" : "Sound disabled until manually enabled")
            : (russianUi ? "Отключить звук" : "Disable sounds")}
          active={soundMuteActive}
          onClick={() => {
            if (soundMuteActive) {
              unsilenceSounds();
              return;
            }
            muteSounds();
          }}
          icon={<AudioMutedOutlined />}
        />
      ) : null}

      {config.showEnableSoundsButton ? (
        <WorkbenchIconButton
          title={soundMuteActive
            ? (russianUi ? "Включить звук" : "Enable sounds")
            : (russianUi ? "Звук включён" : "Sounds enabled")}
          active={!soundMuteActive}
          onClick={() => {
            if (soundMuteActive) {
              unsilenceSounds();
            }
            void eventSoundPlayer.enableSoundsWithUserGesture().then((result) => {
              if (!result.ok) {
                setSoundStatusText(result.message);
                eventRuntimeStore.setSoundStatusMessage(result.message);
                return;
              }
              setSoundStatusText("");
              eventRuntimeStore.setSoundStatusMessage(null);
              // Re-play current alarm sound after gesture unlock, including alarms that were active before page reload.
              const latest = pickLatestUnacknowledgedActiveOccurrence(runtimeEvents.activeEvents);
              if (!latest) {
                return;
              }
              if (config.soundPlaybackMode === "loopUntilAcknowledged") {
                void startLoopSoundForOccurrence(latest);
                return;
              }
              void playSoundForOccurrence(latest).then((playResult) => {
                if (shouldCommitOncePlayback(playResult)) {
                  const id = normalizeOccurrenceId(latest);
                  if (id) {
                    oncePlayedIdsRef.current.add(id);
                  }
                }
              });
            });
          }}
          icon={<SoundOutlined />}
        />
      ) : null}

      {canOpenSettings ? (
        <WorkbenchIconButton
          title="Settings"
          onClick={openSettingsDialog}
          icon={<SettingOutlined />}
        />
      ) : null}

      {config.showCsvExportButton ? (
        <WorkbenchIconButton
          title={csvTooltipTitle}
          onClick={() => {
            setExportOpen(true);
          }}
          disabled={busyExport || object.enableCsvExport === false}
          icon={<ExportOutlined />}
        />
      ) : null}

      {mode === "history" && object.showHistoryToolbar !== false ? (
        <>
          <WorkbenchIconButton
            title="Previous page"
            onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
            disabled={!historyCanPrev}
            icon={<LeftOutlined />}
          />
          <WorkbenchIconButton
            title="Next page"
            onClick={() => setHistoryPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={!historyCanNext}
            icon={<RightOutlined />}
          />
        </>
      ) : null}

      {mode === "history" && object.showHistoryToolbar !== false ? (
        <div className="event-table-toolbar__meta" title={`Period ${historyPreset.label} | Page ${historyPage}/${totalPages}`}>
          Period {historyPreset.label} | Page {historyPage}/{totalPages}
        </div>
      ) : null}

      {busyAck || busyExport ? <Spin size="small" /> : null}
    </div>
  );

  return (
    <>
      <div
        className="event-table-widget"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          border: `${borderWidth}px solid ${borderColor}`,
          borderRadius,
          background: tableBackground,
          color: textColor,
          boxSizing: "border-box",
          fontFamily: "Segoe UI, Tahoma, sans-serif",
          fontSize,
          overflow: "hidden",
        }}
      >
        {showTitleTop ? titleBlock : null}
        {showTopStatus ? renderStatus() : null}

        {showToolbarTop ? (
          <div style={{ borderBottom: `1px solid ${gridLineColor}` }}>
            {toolbarNode}
          </div>
        ) : null}

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {showHeader ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns,
                alignItems: "center",
                minHeight: headerHeight,
                background: headerBackgroundColor,
                color: headerTextColor,
                borderBottom: `1px solid ${gridLineColor}`,
                fontWeight: 600,
                fontSize: Math.max(9, fontSize - 1),
                letterSpacing: 0.25,
                overflow: "hidden",
              }}
            >
              {columns.map((column, index) => (
                <div
                  key={column}
                  style={{
                    padding: `0 ${config.cellPadding}px`,
                    borderRight: showGridLines && index < columns.length - 1 ? `1px solid ${gridLineColor}` : "none",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    position: "relative",
                  }}
                  title={column}
                >
                  {object.columnLabels?.[column]?.trim() || DEFAULT_EVENT_TABLE_COLUMN_LABELS[column] || column}
                  {index < columns.length - 1 ? (
                    <div className="event-table-column-resize-handle" onMouseDown={(event) => startColumnResize(event, column)} />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              background: object.zebraRows
                ? "linear-gradient(180deg, rgba(255,255,255,0.01) 0%, rgba(255,255,255,0) 100%)"
                : "transparent",
              overflow: "hidden",
            }}
          >
            {!showStatus && ((mode === "online" && onlineLoading) || (mode === "history" && historyLoading)) ? (
              <div style={{ padding: 12, color: mutedTextColor, fontSize: Math.max(10, fontSize - 1) }}>
                {mode === "history"
                  ? (showOperatorActionsInHistory ? "Loading history events and operator actions..." : "Loading history events...")
                  : (showOperatorActionsInOnline ? "Loading online events and operator actions..." : "Loading online events...")}
              </div>
            ) : null}

            {!showStatus && ((mode === "online" && onlineError) || (mode === "history" && historyError)) ? (
              <div style={{ padding: 12, color: object.criticalColor ?? "#f48771", fontSize: Math.max(10, fontSize - 1) }}>
                {mode === "history" ? historyError : onlineError}
              </div>
            ) : null}

            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              {visibleRows.length === 0 ? (
                <div
                  style={{
                    minHeight: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: mutedTextColor,
                    textAlign: "center",
                    padding: 12,
                  }}
                >
                  {mode === "history"
                    ? "No history records for the selected period."
                    : (showOperatorActionsInOnline ? "No online events or operator actions." : "No online events.")}
                </div>
              ) : (
                <div style={{ minWidth: "100%" }}>
                  {visibleRows.map((row, rowIndex) => {
                    const rowId = row.rowId;
                    const selected = selectedIds.has(rowId);
                    const isEventRow = row.rowType === "event";
                    const eventRow = isEventRow ? row.event : null;
                    const operatorResult = row.rowType === "operatorAction" ? row.action.result : null;
                    const eventDefinition = eventRow ? eventDefinitionById.get(eventRow.eventDefinitionId) : undefined;
                    const messageVisual = eventRow
                      ? resolveEventMessageVisual(eventDefinition)
                      : {
                        textColor: null,
                        backgroundColor: operatorResult === "success" ? "rgba(110, 128, 150, 0.10)" : "rgba(230, 180, 80, 0.14)",
                        backgroundBlinkEnabled: false,
                        backgroundBlinkDurationMs: 1600,
                        backgroundBlinkOpacity: 0.25,
                      };
                    const operatorRowColor = operatorResult === "failed" || operatorResult === "denied"
                      ? (object.warningColor ?? "#e6b450")
                      : textColor;
                    const rowDefaultColor = eventRow
                      ? getOccurrenceRowColor(eventRow, object, textColor)
                      : operatorRowColor;
                    const rowColor = messageVisual.textColor ?? rowDefaultColor;
                    const rowIsUnacknowledged = Boolean(eventRow && !eventRow.acknowledgedAt);
                    const customBackgroundColor = messageVisual.backgroundColor;
                    const shouldBlinkBackground = Boolean(
                      messageVisual.backgroundBlinkEnabled
                      && rowIsUnacknowledged,
                    ) && !selected;
                    const baseRowBackground = selected
                      ? (object.selectedRowColor ?? "#223248")
                      : (customBackgroundColor
                        ?? (object.zebraRows && rowIndex % 2 === 1 ? "rgba(255,255,255,0.02)" : "transparent"));
                    const blinkFromBackground = baseRowBackground;
                    const blinkToBackground = parseColorToRgba(
                      customBackgroundColor ?? (object.warningColor ?? "#f48771"),
                      messageVisual.backgroundBlinkOpacity,
                    ) ?? "rgba(244, 135, 113, 0.45)";

                    const handleRowActivate = () => {
                      if (eventRow && !eventRow.acknowledgedAt) {
                        handleAcknowledgeSingle(String(eventRow.id), eventRow.acknowledgedAt);
                        return;
                      }
                      toggleRowSelection(rowId);
                    };

                    return (
                      <div
                        key={rowId}
                        role="button"
                        tabIndex={0}
                        onClick={handleRowActivate}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleRowActivate();
                          }
                        }}
                        style={{
                          display: "grid",
                          gridTemplateColumns,
                          alignItems: "center",
                          minHeight: rowHeight,
                          backgroundColor: baseRowBackground,
                          borderBottom: `1px solid ${gridLineColor}`,
                          cursor: "pointer",
                          color: rowColor,
                          fontSize: Math.max(9, fontSize - 1),
                          animation: shouldBlinkBackground
                            ? `event-table-row-background-pulse ${messageVisual.backgroundBlinkDurationMs}ms ease-in-out infinite`
                            : "none",
                          ["--event-row-blink-from" as "--event-row-blink-from"]: blinkFromBackground,
                          ["--event-row-blink-to" as "--event-row-blink-to"]: blinkToBackground,
                        } as CSSProperties}
                        className={shouldBlinkBackground ? "event-table-row--blinking" : ""}
                      >
                        {columns.map((column, index) => {
                          const cellText = getRowCellText(column, row);
                          const textAlign = config.columnAlignments[column];
                          const isMessageCell = column === "message";
                          const isAckByClickAvailable = Boolean(isMessageCell && eventRow && !eventRow.acknowledgedAt);
                          return (
                            <div
                              key={`${rowId}-${column}`}
                              onClick={isMessageCell
                                ? (event) => {
                                  if (!eventRow || eventRow.acknowledgedAt) {
                                    return;
                                  }
                                  event.stopPropagation();
                                  handleAcknowledgeSingle(String(eventRow.id), eventRow.acknowledgedAt);
                                }
                                : undefined}
                              style={{
                                padding: `2px ${config.cellPadding}px`,
                                borderRight: showGridLines && index < columns.length - 1 ? `1px solid ${gridLineColor}` : "none",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                userSelect: "none",
                                textAlign,
                                cursor: isAckByClickAvailable ? "pointer" : undefined,
                              }}
                              title={isAckByClickAvailable ? `${cellText} (click to acknowledge)` : cellText}
                            >
                              {cellText}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {showToolbarBottom ? (
          <div style={{ borderTop: `1px solid ${gridLineColor}` }}>
            {toolbarNode}
          </div>
        ) : null}

        {showTitleBottom ? titleBlock : null}
        {showBottomStatus ? renderStatus() : null}
      </div>

      <EventTableSettingsDialog
        open={settingsOpen && canOpenSettings}
        object={object}
        onClose={() => setSettingsOpen(false)}
        onPatch={patchObject}
      />

      <EventTableExportDialog
        open={exportOpen}
        mode={mode}
        selectedCount={selectedIds.size}
        busy={busyExport}
        onClose={() => setExportOpen(false)}
        onExport={(options) => {
          setExportOpen(false);
          void handleExport(options);
        }}
      />
    </>
  );
}
