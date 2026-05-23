import type { EventOccurrence, EventTableObject } from "@web-scada/shared";
import { message } from "antd";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useScadaStore } from "../../store/scada-store";
import {
  DEFAULT_EVENT_TABLE_COLUMN_LABELS,
  normalizeEventTableColumns,
} from "./event-table-columns";
import {
  buildEventTableHistoryQuery,
  hasMultiValueHistoryFilters,
  resolveEventTableHistoryRange,
} from "./event-table-history-query";
import {
  downloadCsvFile,
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
import { eventRuntimeStore } from "./event-runtime-store";

type EventTableRuntimeWidgetProps = {
  object: EventTableObject;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  const columns = useMemo(() => normalizeEventTableColumns(object.columns), [object.columns]);
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
  const historyPreset = resolveEventTableHistoryRange(object);
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

  const historyFilterObject = useMemo(
    () => ({
      ...object,
      categoryFilter: toSingleFilterValues(object.categoryFilter),
      priorityFilter: toSingleFilterValues(object.priorityFilter),
    }),
    [object],
  );

  const onlineRows = useMemo(() => {
    const filtered = filterOnlineEventRows(runtimeEvents.activeEvents, object);
    const sorted = sortEventRows(filtered, object);
    return sorted.slice(0, maxRows);
  }, [maxRows, object, runtimeEvents.activeEvents]);

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
    () => buildEventTableHistoryQuery({ object, page: historyPage, pageSize, maxRows }),
    [historyPage, maxRows, object, pageSize],
  );

  useEffect(() => {
    if (mode !== "history") {
      return;
    }
    void eventRuntimeStore.loadHistory({ widgetId: object.id, query: historyQuery });
    void eventRuntimeStore.loadArchiveStatus();
  }, [historyQuery, mode, object.id]);

  useEffect(() => () => {
    eventRuntimeStore.clearHistory(object.id);
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
    const ids = visibleRows
      .filter((item) => !item.acknowledgedAt)
      .map((item) => String(item.id));
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
      downloadCsvFile(`event-history-${timestamp}.csv`, csvText);
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
    const onlineLineOne = `Event status: ${onlineStatusLabel} | active ${runtimeEvents.activeCount} | unacked ${runtimeEvents.unacknowledgedCount} | last update ${object.showLastUpdate === false ? "--:--:--" : formatStatusClockTime(runtimeEvents.lastUpdateAt)}`;
    const onlineLineTwo = `Mode: ${object.showModeIndicator === false ? "--" : "online"} | Rows: ${object.showRecordCount === false ? "--" : String(onlineRows.length)}`;

    const historyState = historyBucket.loading ? "loading" : historyBucket.error ? "error" : "ready";
    const historyLineOne = `Event archive: ${historyState} | period: ${historyPreset.label} | records ${historyTotalRows}`;
    const historyLineTwo = `DB: ${formatDbSizeLabel(runtimeEvents.archiveStatus?.dbSizeMb)} | Records: ${formatRecordCountLabel(runtimeEvents.archiveStatus?.recordsCount)}`;

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

  const hasSoundNote = soundStatusText
    || runtimeEvents.soundStatusMessage
    || (eventSoundPlayer.hasAutoplayBlock() ? "Sound playback was blocked by the browser. Click Enable sounds." : "");
  const historyFilterNote = mode === "history" && hasMultiValueHistoryFilters(object)
    ? "History filter uses single category and single priority value; extra values are ignored."
    : "";
  const statusNote = [hasSoundNote, historyFilterNote].filter(Boolean).join(" | ");

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
            <span style={{ fontSize: Math.max(9, fontSize - 2), color: object.showActiveOnly === true ? (object.activeAlarmColor ?? "#4ec94e") : mutedTextColor }}>
              Active {object.showActiveOnly === true ? "on" : "off"}
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
                {object.columnLabels?.[column]?.trim() || DEFAULT_EVENT_TABLE_COLUMN_LABELS[column] || column}
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
            <div style={{ padding: 12, color: mutedTextColor, fontSize: Math.max(10, fontSize - 1) }}>
              {mode === "history" ? "Loading history events..." : "Loading online events..."}
            </div>
          ) : null}

          {(mode === "online" && runtimeEvents.onlineError) || (mode === "history" && historyBucket.error) ? (
            <div style={{ padding: 12, color: object.criticalColor ?? "#f48771", fontSize: Math.max(10, fontSize - 1) }}>
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
                  const rowColor = getOccurrenceRowColor(row, object, textColor);

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
                        color: rowColor,
                        fontSize: Math.max(9, fontSize - 1),
                      }}
                    >
                      {columns.map((column, index) => {
                        const cellText = getEventCellText(column, row);
                        return (
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
                            title={cellText}
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

      {showBottomStatus ? renderStatus() : null}
    </div>
  );
}
