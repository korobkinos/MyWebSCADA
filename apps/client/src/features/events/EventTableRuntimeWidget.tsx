import type { EventHistoryQuery, EventOccurrence, EventTableObject } from "@web-scada/shared";
import { message } from "antd";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useScadaStore } from "../../store/scada-store";
import { eventSoundPlayer } from "./event-sound-player";
import { eventRuntimeStore } from "./event-runtime-store";

type EventTableRuntimeWidgetProps = {
  object: EventTableObject;
};

type EventTableColumnId = "timestamp" | "priority" | "category" | "message" | "source" | "value" | "state" | "ack";

const DEFAULT_COLUMNS: EventTableColumnId[] = ["timestamp", "priority", "category", "message", "source", "value", "state", "ack"];
const DEFAULT_COLUMN_LABELS: Record<EventTableColumnId, string> = {
  timestamp: "Timestamp",
  priority: "Priority",
  category: "Category",
  message: "Message",
  source: "Source",
  value: "Value",
  state: "State",
  ack: "Ack",
};

const LEGACY_COLUMN_MAP: Record<string, EventTableColumnId> = {
  time: "timestamp",
  occurredAt: "timestamp",
  date: "timestamp",
  pri: "priority",
  prioritySnapshot: "priority",
  categoryName: "category",
  cat: "category",
  msg: "message",
  text: "message",
  sourceTagName: "source",
  sourceTagNameSnapshot: "source",
  tag: "source",
  status: "state",
  acknowledged: "ack",
  acknowledgedAt: "ack",
};

function formatHistoryPreset(preset: EventTableObject["historyPeriodPreset"]): string {
  switch (preset) {
    case "lastHour":
      return "last hour";
    case "shift":
      return "shift";
    case "day":
      return "day";
    case "week":
      return "week";
    case "custom":
      return "custom";
    default:
      return "last hour";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeColumns(columns: string[] | undefined): EventTableColumnId[] {
  const input = columns && columns.length > 0 ? columns : DEFAULT_COLUMNS;
  const normalized: EventTableColumnId[] = [];

  for (const raw of input) {
    const candidate = (raw ?? "").trim();
    if (!candidate) {
      continue;
    }
    const mapped = (DEFAULT_COLUMN_LABELS as Record<string, string>)[candidate]
      ? (candidate as EventTableColumnId)
      : LEGACY_COLUMN_MAP[candidate];
    if (!mapped || normalized.includes(mapped)) {
      continue;
    }
    normalized.push(mapped);
  }

  return normalized.length > 0 ? normalized.slice(0, 12) : [...DEFAULT_COLUMNS];
}

function formatCellDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return "-";
  }
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return new Date(parsed).toLocaleString("ru-RU", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatStatusTime(timestamp: number | null): string {
  if (!timestamp) {
    return "--:--:--";
  }
  return new Date(timestamp).toLocaleTimeString("ru-RU", {
    hour12: false,
  });
}

function formatDbSize(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  return `${value.toFixed(2)} MB`;
}

function formatRecordCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  return Math.max(0, Math.round(value)).toLocaleString("ru-RU");
}

function toText(value: unknown): string {
  if (value === null || typeof value === "undefined") {
    return "";
  }
  return String(value);
}

function formatEventValue(value: unknown): string {
  if (value === null || typeof value === "undefined") {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "-";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  const text = String(value).trim();
  return text || "-";
}

function isCleared(item: EventOccurrence): boolean {
  return Boolean(item.clearedAt);
}

function isAcknowledged(item: EventOccurrence): boolean {
  return Boolean(item.acknowledgedAt);
}

function buildSearchText(item: EventOccurrence): string {
  return [
    item.messageTextSnapshot,
    item.sourceTagNameSnapshot,
    item.categoryNameSnapshot,
    item.eventDefinitionId,
    item.id,
  ]
    .map((candidate) => toText(candidate).trim().toLowerCase())
    .filter(Boolean)
    .join(" |");
}

function matchesCommonFilters(item: EventOccurrence, object: EventTableObject): boolean {
  if (object.categoryFilter && object.categoryFilter.length > 0) {
    const category = (item.categoryNameSnapshot ?? item.categoryIdSnapshot ?? "").trim();
    if (!object.categoryFilter.some((candidate) => candidate.trim() === category)) {
      return false;
    }
  }

  if (object.priorityFilter && object.priorityFilter.length > 0) {
    const priority = typeof item.prioritySnapshot === "number" ? item.prioritySnapshot : null;
    if (priority === null || !object.priorityFilter.includes(priority)) {
      return false;
    }
  }

  const sourceFilter = object.sourceTagFilter?.trim().toLowerCase();
  if (sourceFilter) {
    const source = (item.sourceTagNameSnapshot ?? "").toLowerCase();
    if (!source.includes(sourceFilter)) {
      return false;
    }
  }

  const searchText = object.searchText?.trim().toLowerCase();
  if (searchText && !buildSearchText(item).includes(searchText)) {
    return false;
  }

  return true;
}

function filterOnlineRows(rows: EventOccurrence[], object: EventTableObject): EventOccurrence[] {
  return rows.filter((item) => {
    if (!matchesCommonFilters(item, object)) {
      return false;
    }

    if (object.showActiveOnly !== false && isCleared(item)) {
      return false;
    }

    if (object.showUnacknowledgedOnly && isAcknowledged(item)) {
      return false;
    }

    if (object.showCleared === false && isCleared(item)) {
      return false;
    }

    return true;
  });
}

function compareNullableNumbers(a: number | null, b: number | null): number {
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a - b;
}

function compareText(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

function sortRows(rows: EventOccurrence[], object: EventTableObject): EventOccurrence[] {
  const direction = object.sortDirection === "asc" ? 1 : -1;
  const sortBy = object.sortBy ?? "time";
  return [...rows].sort((left, right) => {
    let result = 0;

    if (sortBy === "priority") {
      result = compareNullableNumbers(
        typeof left.prioritySnapshot === "number" ? left.prioritySnapshot : null,
        typeof right.prioritySnapshot === "number" ? right.prioritySnapshot : null,
      );
    } else if (sortBy === "category") {
      result = compareText(left.categoryNameSnapshot, right.categoryNameSnapshot);
    } else if (sortBy === "message") {
      result = compareText(left.messageTextSnapshot, right.messageTextSnapshot);
    } else if (sortBy === "sourceTagName") {
      result = compareText(left.sourceTagNameSnapshot, right.sourceTagNameSnapshot);
    } else {
      const leftTs = Date.parse(left.occurredAt);
      const rightTs = Date.parse(right.occurredAt);
      const safeLeft = Number.isFinite(leftTs) ? leftTs : 0;
      const safeRight = Number.isFinite(rightTs) ? rightTs : 0;
      result = safeLeft - safeRight;
    }

    if (result === 0) {
      result = compareText(left.id, right.id);
    }

    return result * direction;
  });
}

function resolveHistoryRange(object: EventTableObject): { from?: string; to?: string; label: string } {
  const preset = object.historyPeriodPreset ?? "lastHour";
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  let fromMs = now - hourMs;
  let toMs = now;

  if (preset === "shift") {
    fromMs = now - 8 * hourMs;
  } else if (preset === "day") {
    fromMs = now - 24 * hourMs;
  } else if (preset === "week") {
    fromMs = now - 7 * 24 * hourMs;
  } else if (preset === "custom") {
    const customFrom = typeof object.historyFrom === "number" ? object.historyFrom : NaN;
    const customTo = typeof object.historyTo === "number" ? object.historyTo : NaN;
    if (Number.isFinite(customFrom)) {
      fromMs = customFrom;
    }
    if (Number.isFinite(customTo)) {
      toMs = customTo;
    }
    if (!Number.isFinite(customFrom) && !Number.isFinite(customTo)) {
      fromMs = now - hourMs;
      toMs = now;
    }
  }

  if (toMs < fromMs) {
    const swap = fromMs;
    fromMs = toMs;
    toMs = swap;
  }

  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    label: formatHistoryPreset(preset),
  };
}

function buildHistoryQuery(args: {
  object: EventTableObject;
  page: number;
  pageSize: number;
  maxRows: number;
}): EventHistoryQuery {
  const { object, page, pageSize, maxRows } = args;
  const period = resolveHistoryRange(object);
  const sourceTagName = object.sourceTagFilter?.trim();
  const category = object.categoryFilter && object.categoryFilter.length > 0 ? object.categoryFilter[0] : undefined;
  const priority = object.priorityFilter && object.priorityFilter.length > 0 ? object.priorityFilter[0] : undefined;
  const serverSidePagination = object.serverSidePagination !== false;

  const query: EventHistoryQuery = {
    from: period.from,
    to: period.to,
    category: category?.trim() || undefined,
    priority: typeof priority === "number" ? priority : undefined,
    sourceTagName: sourceTagName || undefined,
    search: object.searchText?.trim() || undefined,
  };

  if (serverSidePagination) {
    query.limit = pageSize;
    query.offset = Math.max(0, (page - 1) * pageSize);
  } else {
    query.limit = Math.max(pageSize, Math.min(1000, maxRows));
    query.offset = 0;
  }

  return query;
}

function getRowStateLabel(item: EventOccurrence): string {
  if (!isCleared(item)) {
    return isAcknowledged(item) ? "active (ack)" : "active";
  }
  return isAcknowledged(item) ? "cleared (ack)" : "cleared";
}

function getRowValue(item: EventOccurrence): unknown {
  return isCleared(item) ? item.valueAtClear : item.valueAtTrigger;
}

function getRowColor(item: EventOccurrence, object: EventTableObject, fallback: string): string {
  if (isCleared(item)) {
    return isAcknowledged(item)
      ? (object.acknowledgedColor ?? "#73c991")
      : (object.clearedColor ?? "#8b949e");
  }

  const priority = typeof item.prioritySnapshot === "number" ? item.prioritySnapshot : 0;
  if (priority >= 3) {
    return object.criticalColor ?? "#f48771";
  }
  if (priority >= 2) {
    return object.warningColor ?? "#e6b450";
  }
  return object.activeAlarmColor ?? fallback;
}

function getCellText(column: EventTableColumnId, item: EventOccurrence): string {
  if (column === "timestamp") {
    return formatCellDateTime(item.occurredAt);
  }
  if (column === "priority") {
    return typeof item.prioritySnapshot === "number" ? String(item.prioritySnapshot) : "-";
  }
  if (column === "category") {
    return item.categoryNameSnapshot?.trim() || item.categoryIdSnapshot?.trim() || "-";
  }
  if (column === "message") {
    return item.messageTextSnapshot?.trim() || "-";
  }
  if (column === "source") {
    return item.sourceTagNameSnapshot?.trim() || "-";
  }
  if (column === "value") {
    return formatEventValue(getRowValue(item));
  }
  if (column === "state") {
    return getRowStateLabel(item);
  }
  if (!item.acknowledgedAt) {
    return "-";
  }
  const who = item.acknowledgedBy?.trim();
  return who ? `${formatCellDateTime(item.acknowledgedAt)} | ${who}` : formatCellDateTime(item.acknowledgedAt);
}

function makeDownloadFile(name: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function EventTableRuntimeWidget({ object }: EventTableRuntimeWidgetProps) {
  const runtimeEvents = useSyncExternalStore(
    eventRuntimeStore.subscribe,
    eventRuntimeStore.getSnapshot,
    eventRuntimeStore.getSnapshot,
  );
  const projectEventSounds = useScadaStore((store) => store.project?.eventSounds ?? []);
  const [soundStatusText, setSoundStatusText] = useState<string>("");
  const [busyAck, setBusyAck] = useState(false);
  const [busyCsv, setBusyCsv] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const title = object.title?.trim() || "Event Table";
  const columns = useMemo(() => normalizeColumns(object.columns), [object.columns]);
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
  const borderRadius = clamp(toFiniteNumber(object.borderRadius, 6), 0, 24);
  const borderWidth = clamp(toFiniteNumber(object.borderWidth, 1), 0, 4);
  const mode = object.mode ?? (object.enableHistoryMode ? "history" : "online");
  const historyPreset = resolveHistoryRange(object);
  const statusPosition = object.statusPosition ?? "bottom";
  const statusStyle = object.statusStyle ?? "archiveLike";
  const showStatus = object.showStatusBar !== false && statusStyle !== "hidden" && statusPosition !== "hidden";
  const showTopStatus = showStatus && statusPosition === "top";
  const showBottomStatus = showStatus && statusPosition === "bottom";
  const showToolbar = object.showToolbar !== false;
  const showHeader = object.showHeader !== false;
  const showTitle = object.showTitle !== false;
  const maxRows = Math.max(1, Math.round(object.maxRows ?? 100));
  const pageSize = Math.max(1, Math.round(object.pageSize ?? 50));
  const compactMode = object.compactMode ?? false;
  const showGridLines = object.showGridLines !== false;
  const transparentBackground = object.transparentBackground === true;
  const tableBackground = transparentBackground ? "transparent" : backgroundColor;

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

  const onlineRows = useMemo(() => {
    const filtered = filterOnlineRows(runtimeEvents.activeEvents, object);
    const sorted = sortRows(filtered, object);
    return sorted.slice(0, maxRows);
  }, [maxRows, object, runtimeEvents.activeEvents]);

  const historySortedRows = useMemo(() => {
    const filtered = historyBucket.items.filter((item) => matchesCommonFilters(item, object));
    return sortRows(filtered, object);
  }, [historyBucket.items, object]);

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

  const visibleRows = mode === "history" ? historyRows : onlineRows;

  const totalPages = useMemo(() => {
    const total = mode === "history" ? historyTotalRows : visibleRows.length;
    return Math.max(1, Math.ceil(Math.max(1, total) / Math.max(1, pageSize)));
  }, [historyTotalRows, mode, pageSize, visibleRows.length]);

  useEffect(() => {
    setSelectedIds((previous) => {
      const visibleIds = new Set(visibleRows.map((item) => String(item.id)));
      const next = new Set<string>();
      for (const id of previous) {
        if (visibleIds.has(id)) {
          next.add(id);
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
  ]);

  useEffect(() => {
    eventRuntimeStore.setSoundCatalog(projectEventSounds, { enablePriorityFallback: true });
  }, [projectEventSounds]);

  useEffect(() => {
    eventRuntimeStore.setRecentBufferLimit(Math.max(1000, maxRows));
    eventRuntimeStore.setOnlineRetentionLimit(Math.max(2000, maxRows * 8));
  }, [maxRows]);

  useEffect(() => {
    if (mode !== "online") {
      return;
    }
    void eventRuntimeStore.initializeOnline();
    void eventRuntimeStore.reloadOnline(Math.max(200, maxRows * 2));
  }, [maxRows, mode]);

  const historyQuery = useMemo(
    () => buildHistoryQuery({ object, page: historyPage, pageSize, maxRows }),
    [historyPage, maxRows, object, pageSize],
  );

  useEffect(() => {
    if (mode !== "history") {
      return;
    }
    void eventRuntimeStore.loadHistory({ widgetId: object.id, query: historyQuery });
    void eventRuntimeStore.loadArchiveStatus();
  }, [historyQuery, mode, object.id]);

  useEffect(() => {
    return () => {
      eventRuntimeStore.clearHistory(object.id);
    };
  }, [object.id]);

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
      setSelectedIds((previous) => {
        if (previous.size === 0) {
          return previous;
        }
        const next = new Set(previous);
        for (const id of unique) {
          next.delete(id);
        }
        return next;
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void message.error(`Failed to acknowledge events: ${text}`);
    } finally {
      setBusyAck(false);
    }
  }, []);

  const handleAcknowledgeVisible = useCallback(() => {
    const ids = visibleRows.filter((item) => !item.acknowledgedAt).map((item) => String(item.id));
    void acknowledgeRows(ids);
  }, [acknowledgeRows, visibleRows]);

  const handleAcknowledgeSelected = useCallback(() => {
    const ids = visibleRows
      .filter((item) => selectedIds.has(String(item.id)) && !item.acknowledgedAt)
      .map((item) => String(item.id));
    void acknowledgeRows(ids);
  }, [acknowledgeRows, selectedIds, visibleRows]);

  const handleExportCsv = useCallback(async () => {
    if (mode !== "history") {
      // Simpler and safer behavior: online mode export is intentionally not implemented server-side.
      void message.info("CSV export is available in history mode only.");
      return;
    }
    setBusyCsv(true);
    try {
      const csvText = await eventRuntimeStore.exportHistoryCsv(historyQuery);
      const timestamp = new Date().toISOString().replaceAll(":", "-");
      makeDownloadFile(`event-history-${timestamp}.csv`, csvText);
      void message.success("CSV export started.");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void message.error(`CSV export failed: ${text}`);
    } finally {
      setBusyCsv(false);
    }
  }, [historyQuery, mode]);

  const renderStatus = () => {
    if (!showStatus) {
      return null;
    }

    const onlineStatusLabel = runtimeEvents.onlineStatus === "open" ? "online" : runtimeEvents.onlineStatus;
    const onlineLineOne = `Event status: ${onlineStatusLabel} | active ${runtimeEvents.activeCount} | unacked ${runtimeEvents.unacknowledgedCount} | last update ${object.showLastUpdate === false ? "--:--:--" : formatStatusTime(runtimeEvents.lastUpdateAt)}`;
    const onlineLineTwo = `Mode: ${object.showModeIndicator === false ? "--" : "online"} | Rows: ${object.showRecordCount === false ? "--" : String(onlineRows.length)}`;

    const historyState = historyBucket.loading ? "loading" : historyBucket.error ? "error" : "ready";
    const historyLineOne = `Event archive: ${historyState} | period: ${historyPreset.label} | records ${historyTotalRows}`;
    const historyLineTwo = `DB: ${formatDbSize(runtimeEvents.archiveStatus?.dbSizeMb)} | Records: ${formatRecordCount(runtimeEvents.archiveStatus?.recordsCount)}`;

    const lineOne = mode === "history" ? historyLineOne : onlineLineOne;
    const lineTwo = mode === "history"
      ? (object.showDatabaseStatus === false ? "DB: -- | Records: --" : historyLineTwo)
      : onlineLineTwo;

    const statusTone = mode === "history"
      ? (object.warningColor ?? "#e6b450")
      : (object.activeAlarmColor ?? "#4ec94e");

    if (statusStyle === "compact") {
      return (
        <div
          style={{
            minHeight: Math.max(20, rowHeight - 2),
            padding: "4px 8px",
            borderTop: showBottomStatus ? `1px solid ${gridLineColor}` : "none",
            borderBottom: showTopStatus ? `1px solid ${gridLineColor}` : "none",
            color: mutedTextColor,
            fontSize: Math.max(10, fontSize - 1),
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {lineOne}
        </div>
      );
    }

    return (
      <div
        style={{
          minHeight: Math.max(24, rowHeight),
          padding: compactMode ? "4px 8px" : "5px 10px",
          borderTop: showBottomStatus ? `1px solid ${gridLineColor}` : "none",
          borderBottom: showTopStatus ? `1px solid ${gridLineColor}` : "none",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 1,
          overflow: "hidden",
        }}
      >
        <div style={{ color: statusTone, fontSize: Math.max(10, fontSize - 1), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {lineOne}
        </div>
        <div style={{ color: mutedTextColor, opacity: 0.9, fontSize: Math.max(9, fontSize - 2), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {lineTwo}
        </div>
      </div>
    );
  };

  const gridTemplateColumns = useMemo(
    () => columns
      .map((column) => {
        const width = Number(object.columnWidths?.[column]);
        return Number.isFinite(width) && width > 32 ? `${width}px` : "minmax(70px, 1fr)";
      })
      .join(" "),
    [columns, object.columnWidths],
  );

  const statusNote = soundStatusText
    || runtimeEvents.soundStatusMessage
    || (eventSoundPlayer.hasAutoplayBlock() ? "Sound playback was blocked by the browser. Click Enable sounds." : "");

  const historyCanPrev = historyPage > 1;
  const historyCanNext = historyPage < totalPages;

  return (
    <div
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
      {showTitle ? (
        <div
          style={{
            minHeight: compactMode ? Math.max(20, headerHeight - 4) : headerHeight,
            display: "flex",
            alignItems: "center",
            padding: "0 10px",
            background: headerBackgroundColor,
            color: headerTextColor,
            borderBottom: `1px solid ${gridLineColor}`,
            fontWeight: 600,
            letterSpacing: 0.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>
      ) : null}

      {showTopStatus ? renderStatus() : null}

      {showToolbar ? (
        <div
          style={{
            minHeight: compactMode ? Math.max(20, rowHeight - 4) : rowHeight,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 8px",
            borderBottom: `1px solid ${gridLineColor}`,
            color: mutedTextColor,
            flexWrap: "wrap",
            overflow: "hidden",
            alignContent: "center",
          }}
        >
          {object.enableSearchInToolbar !== false ? (
            <div
              style={{
                minWidth: 110,
                maxWidth: 200,
                height: 20,
                border: `1px solid ${gridLineColor}`,
                borderRadius: 3,
                padding: "0 6px",
                color: mutedTextColor,
                display: "flex",
                alignItems: "center",
                fontSize: Math.max(9, fontSize - 2),
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {object.searchText?.trim() ? object.searchText : "Search..."}
            </div>
          ) : null}

          {object.enableActiveOnlyToggle !== false ? (
            <span style={{ fontSize: Math.max(9, fontSize - 2), color: object.showActiveOnly !== false ? (object.activeAlarmColor ?? "#4ec94e") : mutedTextColor }}>
              Active {object.showActiveOnly !== false ? "on" : "off"}
            </span>
          ) : null}

          {object.enableUnackedOnlyToggle !== false ? (
            <span style={{ fontSize: Math.max(9, fontSize - 2), color: object.showUnacknowledgedOnly ? (object.warningColor ?? "#e6b450") : mutedTextColor }}>
              Unacked {object.showUnacknowledgedOnly ? "on" : "off"}
            </span>
          ) : null}

          {mode === "history" && object.showHistoryToolbar !== false ? (
            <span style={{ fontSize: Math.max(9, fontSize - 2) }}>
              Period {historyPreset.label} | Page size {pageSize} | Page {historyPage}/{totalPages}
            </span>
          ) : null}

          {mode === "history" && object.showHistoryToolbar !== false ? (
            <>
              <button
                type="button"
                style={{
                  height: 20,
                  border: `1px solid ${gridLineColor}`,
                  background: "transparent",
                  color: mutedTextColor,
                  borderRadius: 3,
                  padding: "0 6px",
                  fontSize: Math.max(9, fontSize - 2),
                  cursor: historyCanPrev ? "pointer" : "default",
                  opacity: historyCanPrev ? 1 : 0.45,
                }}
                onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                disabled={!historyCanPrev}
              >
                Prev
              </button>
              <button
                type="button"
                style={{
                  height: 20,
                  border: `1px solid ${gridLineColor}`,
                  background: "transparent",
                  color: mutedTextColor,
                  borderRadius: 3,
                  padding: "0 6px",
                  fontSize: Math.max(9, fontSize - 2),
                  cursor: historyCanNext ? "pointer" : "default",
                  opacity: historyCanNext ? 1 : 0.45,
                }}
                onClick={() => setHistoryPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={!historyCanNext}
              >
                Next
              </button>
            </>
          ) : null}

          {object.enableAckButton ? (
            <button
              type="button"
              style={{
                height: 20,
                border: `1px solid ${gridLineColor}`,
                background: "transparent",
                color: mutedTextColor,
                borderRadius: 3,
                padding: "0 6px",
                fontSize: Math.max(9, fontSize - 2),
                cursor: busyAck ? "default" : "pointer",
                opacity: busyAck ? 0.6 : 1,
              }}
              onClick={handleAcknowledgeVisible}
              disabled={busyAck}
            >
              Ack visible
            </button>
          ) : null}

          {object.enableAckSelectedButton ? (
            <button
              type="button"
              style={{
                height: 20,
                border: `1px solid ${gridLineColor}`,
                background: "transparent",
                color: mutedTextColor,
                borderRadius: 3,
                padding: "0 6px",
                fontSize: Math.max(9, fontSize - 2),
                cursor: busyAck ? "default" : "pointer",
                opacity: busyAck ? 0.6 : 1,
              }}
              onClick={handleAcknowledgeSelected}
              disabled={busyAck}
            >
              Ack selected ({selectedIds.size})
            </button>
          ) : null}

          {object.enableSilenceButton ? (
            <button
              type="button"
              style={{
                height: 20,
                border: `1px solid ${gridLineColor}`,
                background: "transparent",
                color: mutedTextColor,
                borderRadius: 3,
                padding: "0 6px",
                fontSize: Math.max(9, fontSize - 2),
                cursor: "pointer",
              }}
              onClick={() => {
                eventSoundPlayer.stopAllSounds();
                setSoundStatusText("Sound playback stopped.");
                eventRuntimeStore.setSoundStatusMessage(null);
              }}
            >
              Silence
            </button>
          ) : null}

          {object.enableSoundsButton !== false ? (
            <button
              type="button"
              style={{
                height: 20,
                border: `1px solid ${gridLineColor}`,
                background: "transparent",
                color: mutedTextColor,
                borderRadius: 3,
                padding: "0 6px",
                fontSize: Math.max(9, fontSize - 2),
                cursor: "pointer",
              }}
              onClick={() => {
                void eventSoundPlayer.enableSoundsWithUserGesture().then((result) => {
                  if (!result.ok) {
                    setSoundStatusText(result.message);
                    eventRuntimeStore.setSoundStatusMessage(result.message);
                    return;
                  }
                  setSoundStatusText("Sounds enabled.");
                  eventRuntimeStore.setSoundStatusMessage(null);
                });
              }}
            >
              Enable sounds
            </button>
          ) : null}

          {object.enableCsvExportButton && object.enableCsvExport ? (
            <button
              type="button"
              style={{
                height: 20,
                border: `1px solid ${gridLineColor}`,
                background: "transparent",
                color: mutedTextColor,
                borderRadius: 3,
                padding: "0 6px",
                fontSize: Math.max(9, fontSize - 2),
                cursor: busyCsv ? "default" : "pointer",
                opacity: busyCsv ? 0.6 : 1,
              }}
              onClick={() => {
                void handleExportCsv();
              }}
              disabled={busyCsv}
            >
              CSV Export
            </button>
          ) : null}
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
              textTransform: "uppercase",
              letterSpacing: 0.45,
              overflow: "hidden",
            }}
          >
            {columns.map((column, index) => (
              <div
                key={column}
                style={{
                  padding: "0 8px",
                  borderRight: showGridLines && index < columns.length - 1 ? `1px solid ${gridLineColor}` : "none",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={column}
              >
                {object.columnLabels?.[column]?.trim() || DEFAULT_COLUMN_LABELS[column] || column}
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
            background: object.zebraRows ? "linear-gradient(180deg, rgba(255,255,255,0.01) 0%, rgba(255,255,255,0) 100%)" : "transparent",
            overflow: "hidden",
          }}
        >
          {statusNote ? (
            <div
              style={{
                padding: "6px 10px",
                borderBottom: `1px solid ${gridLineColor}`,
                color: object.warningColor ?? "#e6b450",
                fontSize: Math.max(10, fontSize - 1),
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                overflow: "hidden",
              }}
            >
              {statusNote}
            </div>
          ) : null}

          {(mode === "online" && runtimeEvents.onlineLoading) || (mode === "history" && historyBucket.loading) ? (
            <div
              style={{
                padding: 12,
                color: mutedTextColor,
                fontSize: Math.max(10, fontSize - 1),
              }}
            >
              {mode === "history" ? "Loading history events..." : "Loading online events..."}
            </div>
          ) : null}

          {(mode === "online" && runtimeEvents.onlineError) || (mode === "history" && historyBucket.error) ? (
            <div
              style={{
                padding: 12,
                color: object.criticalColor ?? "#f48771",
                fontSize: Math.max(10, fontSize - 1),
              }}
            >
              {mode === "history" ? historyBucket.error : runtimeEvents.onlineError}
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
                {mode === "history" ? "No history records for the selected period." : "No online events."}
              </div>
            ) : (
              <div style={{ minWidth: "100%" }}>
                {visibleRows.map((row, rowIndex) => {
                  const rowId = String(row.id);
                  const selected = selectedIds.has(rowId);
                  const baseColor = getRowColor(row, object, textColor);
                  return (
                    <div
                      key={rowId}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleRowSelection(rowId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleRowSelection(rowId);
                        }
                      }}
                      style={{
                        display: "grid",
                        gridTemplateColumns,
                        alignItems: "center",
                        minHeight: rowHeight,
                        background: selected
                          ? (object.selectedRowColor ?? "#223248")
                          : (object.zebraRows && rowIndex % 2 === 1 ? "rgba(255,255,255,0.02)" : "transparent"),
                        borderBottom: `1px solid ${gridLineColor}`,
                        cursor: "pointer",
                        color: baseColor,
                        fontSize: Math.max(9, fontSize - 1),
                      }}
                    >
                      {columns.map((column, index) => (
                        <div
                          key={`${rowId}-${column}`}
                          style={{
                            padding: "2px 8px",
                            borderRight: showGridLines && index < columns.length - 1 ? `1px solid ${gridLineColor}` : "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            userSelect: "none",
                          }}
                          title={getCellText(column, row)}
                        >
                          {getCellText(column, row)}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {showBottomStatus ? renderStatus() : null}
    </div>
  );
}
