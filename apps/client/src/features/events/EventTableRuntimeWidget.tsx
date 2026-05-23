import type { EventDefinition, EventOccurrence, EventTableObject, HmiObject } from "@web-scada/shared";
import {
  AudioMutedOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LeftOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  SoundOutlined,
  FilterOutlined,
} from "@ant-design/icons";
import { message, Spin } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { WorkbenchIconButton } from "../../components/workbench";
import { useScadaStore } from "../../store/scada-store";
import {
  DEFAULT_EVENT_TABLE_COLUMN_LABELS,
  type EventTableColumnId,
} from "./event-table-columns";
import {
  resolveEventTableConfig,
  resolveEventOccurrenceSoundId,
} from "./event-table-config";
import { EventTableSettingsDialog } from "./EventTableSettingsDialog";
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
  screenId?: string;
};

type ColumnResizeState = {
  column: EventTableColumnId;
  startX: number;
  startWidth: number;
} | null;

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

function normalizeOccurrenceId(input: Pick<EventOccurrence, "id">): string {
  return String(input.id ?? "").trim();
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

export function EventTableRuntimeWidget({ object, screenId }: EventTableRuntimeWidgetProps) {
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
  const [busyCsv, setBusyCsv] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [runtimeColumnWidths, setRuntimeColumnWidths] = useState<Record<string, number>>({});
  const [soundSilenced, setSoundSilenced] = useState(false);

  const oncePlayedIdsRef = useRef<Set<string>>(new Set());
  const silenceBlockedRef = useRef(false);
  const silenceSnapshotActiveIdsRef = useRef<Set<string>>(new Set());
  const soundLoopRetryTimerRef = useRef<number | null>(null);
  const columnResizeRef = useRef<ColumnResizeState>(null);
  const persistenceWarningShownRef = useRef(false);

  const config = useMemo(() => resolveEventTableConfig(object), [object]);

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
  const maxRows = Math.max(1, Math.round(object.maxRows ?? 100));
  const pageSize = Math.max(1, Math.round(object.pageSize ?? 50));
  const compactMode = object.compactMode ?? false;
  const showGridLines = object.showGridLines !== false;
  const transparentBackground = object.transparentBackground === true;
  const tableBackground = transparentBackground ? "transparent" : backgroundColor;

  const showTitleTop = config.titlePosition === "top";
  const showTitleBottom = config.titlePosition === "bottom";
  const showToolbarTop = config.showToolbar && config.toolbarPosition === "top";
  const showToolbarBottom = config.showToolbar && config.toolbarPosition === "bottom";

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
    setRuntimeColumnWidths(object.columnWidths ?? {});
  }, [object.columnWidths, object.id]);

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

  const playSoundForOccurrence = useCallback(async (occurrence: EventOccurrence) => {
    const soundId = resolveEventOccurrenceSoundId(occurrence, object, projectEventSounds);
    if (!soundId) {
      return;
    }

    const result = await eventSoundPlayer.playSound(soundId, projectEventSounds);
    if (!result.ok) {
      if (result.reason === "autoplay_blocked") {
        const autoplayText = "Sound playback was blocked by the browser. Click Enable sounds.";
        setSoundStatusText(autoplayText);
        eventRuntimeStore.setSoundStatusMessage(autoplayText);
        return;
      }
      setSoundStatusText(result.message);
      eventRuntimeStore.setSoundStatusMessage(result.message);
      return;
    }

    if (runtimeEvents.soundStatusMessage) {
      eventRuntimeStore.setSoundStatusMessage(null);
    }
    if (soundStatusText) {
      setSoundStatusText("");
    }
  }, [object, projectEventSounds, runtimeEvents.soundStatusMessage, soundStatusText]);

  const startLoopSoundForOccurrence = useCallback(async (occurrence: EventOccurrence) => {
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
  }, [object, projectEventSounds, runtimeEvents.soundStatusMessage, soundStatusText]);

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

    const newest = newActive[newActive.length - 1];
    if (newest) {
      void playSoundForOccurrence(newest);
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

    if (silenceBlockedRef.current) {
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

    if (silenceBlockedRef.current) {
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
    soundSilenced,
    startLoopSoundForOccurrence,
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
  }, [config.stopSoundOnAck]);

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

  const handleAcknowledgeSingle = useCallback((occurrenceId: string, acknowledgedAt: string | null | undefined) => {
    if (acknowledgedAt || busyAck) {
      return;
    }
    void acknowledgeRows([occurrenceId]);
  }, [acknowledgeRows, busyAck]);

  const handleExportCsv = useCallback(async () => {
    if (mode !== "history") {
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
    const onlineSegments = [
      `Event status: ${onlineStatusLabel}`,
      `active ${runtimeEvents.activeCount}`,
      `unacked ${runtimeEvents.unacknowledgedCount}`,
      object.showLastUpdate === false ? "update --:--:--" : `update ${formatStatusClockTime(runtimeEvents.lastUpdateAt)}`,
      object.showModeIndicator === false ? "mode --" : "mode online",
      object.showRecordCount === false ? "rows --" : `rows ${onlineRows.length}`,
    ];

    const historyState = historyBucket.loading ? "loading" : historyBucket.error ? "error" : "ready";
    const historySegments = [
      `Event archive: ${historyState}`,
      `period ${historyPreset.label}`,
      `records ${historyTotalRows}`,
      object.showDatabaseStatus === false ? "DB --" : `DB ${formatDbSizeLabel(runtimeEvents.archiveStatus?.dbSizeMb)}`,
      object.showDatabaseStatus === false ? "total --" : `total ${formatRecordCountLabel(runtimeEvents.archiveStatus?.recordsCount)}`,
    ];

    const text = mode === "history" ? historySegments.join(" | ") : onlineSegments.join(" | ");
    const tone = mode === "history" ? (object.warningColor ?? "#e6b450") : (object.activeAlarmColor ?? "#4ec94e");

    if (config.statusSingleLine || statusStyle === "compact") {
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
      ? `Event archive: ${historyState} | period ${historyPreset.label} | records ${historyTotalRows}`
      : `Event status: ${onlineStatusLabel} | active ${runtimeEvents.activeCount} | unacked ${runtimeEvents.unacknowledgedCount}`;
    const lineTwo = mode === "history"
      ? (object.showDatabaseStatus === false
        ? "DB -- | total --"
        : `DB ${formatDbSizeLabel(runtimeEvents.archiveStatus?.dbSizeMb)} | total ${formatRecordCountLabel(runtimeEvents.archiveStatus?.recordsCount)}`)
      : `${object.showLastUpdate === false ? "update --:--:--" : `update ${formatStatusClockTime(runtimeEvents.lastUpdateAt)}`} | ${object.showRecordCount === false ? "rows --" : `rows ${onlineRows.length}`}`;

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
        <div style={{ color: tone, fontSize: Math.max(10, fontSize - 1), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {lineOne}
        </div>
        <div style={{ color: mutedTextColor, opacity: 0.9, fontSize: Math.max(9, fontSize - 2), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {lineTwo}
        </div>
      </div>
    );
  };

  const effectiveColumnWidths = useMemo(() => ({
    ...(object.columnWidths ?? {}),
    ...runtimeColumnWidths,
  }), [object.columnWidths, runtimeColumnWidths]);

  const gridTemplateColumns = useMemo(
    () => columns
      .map((column) => {
        const width = Number(effectiveColumnWidths[column]);
        return Number.isFinite(width) && width > 32 ? `${width}px` : "minmax(80px, 1fr)";
      })
      .join(" "),
    [columns, effectiveColumnWidths],
  );

  const hasSoundNote = (soundSilenced ? "Sound is silenced." : "")
    || soundStatusText
    || runtimeEvents.soundStatusMessage
    || (eventSoundPlayer.hasAutoplayBlock() ? "Sound playback was blocked by the browser. Click Enable sounds." : "");
  const historyFilterNote = mode === "history" && hasMultiValueHistoryFilters(object)
    ? "History filter uses single category and single priority value; extra values are ignored."
    : "";
  const statusNote = [hasSoundNote, historyFilterNote].filter(Boolean).join(" | ");

  const historyCanPrev = historyPage > 1;
  const historyCanNext = historyPage < totalPages;

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
          title={`Show acknowledged rows (${object.showUnacknowledgedOnly === true ? "off" : "on"})`}
          active={object.showUnacknowledgedOnly !== true}
          onClick={() => patchObject({ showUnacknowledgedOnly: object.showUnacknowledgedOnly !== true })}
          icon={object.showUnacknowledgedOnly === true ? <EyeInvisibleOutlined /> : <EyeOutlined />}
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
          title={`Acknowledge selected (${selectedIds.size})`}
          onClick={handleAcknowledgeSelected}
          disabled={busyAck}
          icon={<span>{selectedIds.size}</span>}
        />
      ) : null}

      {config.showSilenceButton ? (
        <WorkbenchIconButton
          title={soundSilenced ? "Silenced" : "Silence sounds"}
          active={soundSilenced}
          onClick={() => {
            eventSoundPlayer.stopSeamlessLoop();
            eventSoundPlayer.stopAllSounds();
            setSoundSilenced(true);
            // Explicit operator mute: stay muted until operator turns sound back on.
            silenceBlockedRef.current = true;
            silenceSnapshotActiveIdsRef.current = new Set(
              runtimeEvents.activeEvents
                .filter((item) => !item.acknowledgedAt && !item.clearedAt)
                .map((item) => normalizeOccurrenceId(item))
                .filter(Boolean),
            );
            setSoundStatusText("Sound playback stopped.");
            eventRuntimeStore.setSoundStatusMessage(null);
          }}
          icon={<AudioMutedOutlined />}
        />
      ) : null}

      {config.showEnableSoundsButton ? (
        <WorkbenchIconButton
          title={soundSilenced ? "Enable sounds" : "Sounds enabled"}
          active={!soundSilenced}
          onClick={() => {
            void eventSoundPlayer.enableSoundsWithUserGesture().then((result) => {
              if (!result.ok) {
                setSoundStatusText(result.message);
                eventRuntimeStore.setSoundStatusMessage(result.message);
                return;
              }
              silenceBlockedRef.current = false;
              silenceSnapshotActiveIdsRef.current.clear();
              setSoundSilenced(false);
              setSoundStatusText("Sounds enabled.");
              eventRuntimeStore.setSoundStatusMessage(null);
            });
          }}
          icon={<SoundOutlined />}
        />
      ) : null}

      {config.showSettingsButton ? (
        <WorkbenchIconButton
          title="Settings"
          onClick={() => setSettingsOpen(true)}
          icon={<SettingOutlined />}
        />
      ) : null}

      {config.showCsvExportButton && object.enableCsvExport ? (
        <WorkbenchIconButton
          title="CSV export"
          onClick={() => {
            void handleExportCsv();
          }}
          disabled={busyCsv}
          icon={<DownloadOutlined />}
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

      {busyAck || busyCsv ? <Spin size="small" /> : null}
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
            {statusNote ? (
              <div
                style={{
                  padding: "4px 10px",
                  borderBottom: `1px solid ${gridLineColor}`,
                  color: object.warningColor ?? "#e6b450",
                  fontSize: Math.max(10, fontSize - 2),
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
                    const eventDefinition = eventDefinitionById.get(row.eventDefinitionId);
                    const messageVisual = resolveEventMessageVisual(eventDefinition);
                    const rowDefaultColor = getOccurrenceRowColor(row, object, textColor);
                    const rowColor = messageVisual.textColor ?? rowDefaultColor;
                    const rowIsUnacknowledged = !row.acknowledgedAt;
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
                          const cellText = getEventCellText(column, row);
                          const textAlign = config.columnAlignments[column];
                          const isMessageCell = column === "message";
                          const isAckByClickAvailable = isMessageCell && !row.acknowledgedAt;
                          return (
                            <div
                              key={`${rowId}-${column}`}
                              onClick={isMessageCell
                                ? (event) => {
                                  event.stopPropagation();
                                  handleAcknowledgeSingle(rowId, row.acknowledgedAt);
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
        open={settingsOpen}
        object={object}
        onClose={() => setSettingsOpen(false)}
        onPatch={patchObject}
      />
    </>
  );
}
