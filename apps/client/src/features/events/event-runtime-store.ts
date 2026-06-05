import { type EventHistoryQuery, type EventOccurrence } from "@web-scada/shared";
import { api, type EventAcknowledgeResponse, type EventArchiveStatus } from "../../services/api";
import { createRuntimeSocket } from "../../services/ws";

type SocketState = "connecting" | "open" | "closed" | "error";

type HistoryBucket = {
  items: EventOccurrence[];
  total: number;
  limit: number;
  offset: number;
  loading: boolean;
  error: string | null;
  queryKey: string;
  updatedAt: number | null;
};

type EventRuntimeState = {
  activeEvents: EventOccurrence[];
  recentEvents: EventOccurrence[];
  onlineLoading: boolean;
  onlineError: string | null;
  onlineStatus: SocketState;
  lastUpdateAt: number | null;
  activeCount: number;
  unacknowledgedCount: number;
  clearedUnacknowledgedCount: number;
  historyByWidget: Record<string, HistoryBucket>;
  archiveStatus: EventArchiveStatus | null;
  archiveStatusError: string | null;
  archiveStatusLoading: boolean;
  soundStatusMessage: string | null;
};

type EventHistoryLoadOptions = {
  widgetId: string;
  query: EventHistoryQuery;
};

type RuntimeSocketController = ReturnType<typeof createRuntimeSocket>;

type Listener = () => void;

const DEFAULT_RECENT_BUFFER_LIMIT = 1000;
const DEFAULT_ONLINE_LIMIT = 200;
const DEFAULT_ONLINE_RETENTION_LIMIT = 2000;
const MIN_RECENT_BUFFER_LIMIT = 100;
const MAX_RECENT_BUFFER_LIMIT = 1000;
const MIN_ONLINE_RETENTION_LIMIT = 200;
const MAX_ONLINE_RETENTION_LIMIT = 2000;
const ONLINE_SNAPSHOT_FLUSH_INTERVAL_MS = 50;
const DEBUG_LOG_INTERVAL_MS = 5000;
const ARCHIVE_STATUS_REFRESH_MIN_INTERVAL_MS = 30_000;

const historyRequestSequence = new Map<string, number>();
const listeners = new Set<Listener>();
const onlineMap = new Map<string, EventOccurrence>();

let socket: RuntimeSocketController | null = null;
let started = false;
let recentBufferLimit = DEFAULT_RECENT_BUFFER_LIMIT;
let onlineRetentionLimit = DEFAULT_ONLINE_RETENTION_LIMIT;
let onlineSnapshotFlushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingOnlineSnapshotFlush = false;
let lastDebugLogAt = 0;
let archiveStatusLoadedAt: number | null = null;
let archiveStatusInFlight: Promise<void> | null = null;
let onlineArchiveSnapshotUnavailable = false;
let state: EventRuntimeState = {
  activeEvents: [],
  recentEvents: [],
  onlineLoading: false,
  onlineError: null,
  onlineStatus: "closed",
  lastUpdateAt: null,
  activeCount: 0,
  unacknowledgedCount: 0,
  clearedUnacknowledgedCount: 0,
  historyByWidget: {},
  archiveStatus: null,
  archiveStatusError: null,
  archiveStatusLoading: false,
  soundStatusMessage: null,
};

function normalizeOccurrenceId(input: Pick<EventOccurrence, "id">): string {
  return String(input.id ?? "").trim();
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isArchiveUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { status?: unknown; message?: unknown };
  return candidate.status === 503
    && typeof candidate.message === "string"
    && candidate.message.toLowerCase().includes("archive database is not configured");
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function isDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem("webscada:event-runtime-debug") === "1";
  } catch {
    return false;
  }
}

function logDebugSnapshot(reason: string): void {
  if (!isDebugEnabled()) {
    return;
  }
  const now = Date.now();
  if (now - lastDebugLogAt < DEBUG_LOG_INTERVAL_MS) {
    return;
  }
  lastDebugLogAt = now;
  console.debug("[event-runtime-store]", {
    reason,
    onlineMapSize: onlineMap.size,
    recentEventsLength: state.recentEvents.length,
    activeEventsLength: state.activeEvents.length,
    activeCount: state.activeCount,
    unacknowledgedCount: state.unacknowledgedCount,
    clearedUnacknowledgedCount: state.clearedUnacknowledgedCount,
  });
}

function patchState(patch: Partial<EventRuntimeState>): void {
  state = {
    ...state,
    ...patch,
  };
  emit();
}

function updateRecentBuffer(occurrence: EventOccurrence): void {
  const id = normalizeOccurrenceId(occurrence);
  if (!id) {
    return;
  }

  const next = state.recentEvents.slice(0, recentBufferLimit);
  const existingIndex = next.findIndex((item) => normalizeOccurrenceId(item) === id);
  if (existingIndex >= 0) {
    next.splice(existingIndex, 1);
  }
  next.unshift(occurrence);
  if (next.length > recentBufferLimit) {
    next.length = recentBufferLimit;
  }
  state = {
    ...state,
    recentEvents: next,
  };
}

function pruneOnlineMap(): void {
  if (onlineMap.size <= onlineRetentionLimit) {
    return;
  }

  const rows = [...onlineMap.values()].sort((a, b) => {
    const aTs = Date.parse(a.occurredAt);
    const bTs = Date.parse(b.occurredAt);
    if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) {
      return aTs - bTs;
    }
    return normalizeOccurrenceId(a).localeCompare(normalizeOccurrenceId(b));
  });

  const evictable: EventOccurrence[] = rows.filter((item) => item.clearedAt && item.acknowledgedAt);
  for (const item of evictable) {
    if (onlineMap.size <= onlineRetentionLimit) {
      return;
    }
    onlineMap.delete(normalizeOccurrenceId(item));
  }

  for (const item of rows) {
    if (onlineMap.size <= onlineRetentionLimit) {
      return;
    }
    onlineMap.delete(normalizeOccurrenceId(item));
  }
}

function recalculateOnlineSnapshot(): void {
  const items = [...onlineMap.values()].sort((a, b) => {
    const aTs = Date.parse(a.occurredAt);
    const bTs = Date.parse(b.occurredAt);
    if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) {
      return bTs - aTs;
    }
    return normalizeOccurrenceId(b).localeCompare(normalizeOccurrenceId(a));
  });

  let activeCount = 0;
  let unacknowledgedCount = 0;
  let clearedUnacknowledgedCount = 0;

  for (const item of items) {
    if (!item.clearedAt) {
      activeCount += 1;
    }
    if (!item.acknowledgedAt) {
      unacknowledgedCount += 1;
    }
    if (item.clearedAt && !item.acknowledgedAt) {
      clearedUnacknowledgedCount += 1;
    }
  }

  state = {
    ...state,
    activeEvents: items,
    activeCount,
    unacknowledgedCount,
    clearedUnacknowledgedCount,
  };
}

function flushOnlineSnapshot(reason: string): void {
  pendingOnlineSnapshotFlush = false;
  pruneOnlineMap();
  recalculateOnlineSnapshot();
  state = {
    ...state,
    lastUpdateAt: Date.now(),
  };
  emit();
  logDebugSnapshot(reason);
}

function scheduleOnlineSnapshotFlush(reason: string): void {
  pendingOnlineSnapshotFlush = true;
  if (onlineSnapshotFlushTimer !== null) {
    return;
  }
  onlineSnapshotFlushTimer = setTimeout(() => {
    onlineSnapshotFlushTimer = null;
    flushOnlineSnapshot(reason);
    if (pendingOnlineSnapshotFlush) {
      scheduleOnlineSnapshotFlush("queued");
    }
  }, ONLINE_SNAPSHOT_FLUSH_INTERVAL_MS);
}

function flushOnlineSnapshotNow(reason: string): void {
  if (onlineSnapshotFlushTimer !== null) {
    clearTimeout(onlineSnapshotFlushTimer);
    onlineSnapshotFlushTimer = null;
  }
  flushOnlineSnapshot(reason);
}

function mergeOccurrence(_kind: "active" | "cleared" | "acknowledged", occurrence: EventOccurrence): void {
  const id = normalizeOccurrenceId(occurrence);
  if (!id) {
    return;
  }

  const previous = onlineMap.get(id);
  const next = previous ? { ...previous, ...occurrence } : occurrence;
  onlineMap.set(id, next);

  updateRecentBuffer(next);
  scheduleOnlineSnapshotFlush("socket-update");

  void _kind;
}

function ensureSocket(): void {
  if (socket) {
    return;
  }
  socket = createRuntimeSocket(
    {
      onTagValues: () => undefined,
      onEventUpdate: (payload) => {
        mergeOccurrence(payload.kind, payload.occurrence);
      },
      onSocketStateChange: (nextState) => {
        patchState({ onlineStatus: nextState });
      },
    },
    { participateInGlobalSubscriptions: false },
  );
}

function maybeCloseSocket(): void {
  if (listeners.size > 0) {
    return;
  }
  socket?.close();
  socket = null;
  if (onlineSnapshotFlushTimer !== null) {
    clearTimeout(onlineSnapshotFlushTimer);
    onlineSnapshotFlushTimer = null;
  }
  pendingOnlineSnapshotFlush = false;
  patchState({ onlineStatus: "closed" });
}

function bumpHistorySequence(widgetId: string): number {
  const next = (historyRequestSequence.get(widgetId) ?? 0) + 1;
  historyRequestSequence.set(widgetId, next);
  return next;
}

function isLatestHistoryRequest(widgetId: string, sequence: number): boolean {
  return (historyRequestSequence.get(widgetId) ?? 0) === sequence;
}

function patchHistory(widgetId: string, patch: Partial<HistoryBucket>): void {
  const previous = state.historyByWidget[widgetId] ?? {
    items: [],
    total: 0,
    limit: 0,
    offset: 0,
    loading: false,
    error: null,
    queryKey: "",
    updatedAt: null,
  };
  state = {
    ...state,
    historyByWidget: {
      ...state.historyByWidget,
      [widgetId]: {
        ...previous,
        ...patch,
      },
    },
  };
  emit();
}

export const eventRuntimeStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      maybeCloseSocket();
    };
  },

  getSnapshot(): EventRuntimeState {
    return state;
  },

  setRecentBufferLimit(nextLimit: number): void {
    recentBufferLimit = Math.min(
      MAX_RECENT_BUFFER_LIMIT,
      Math.max(MIN_RECENT_BUFFER_LIMIT, Math.round(nextLimit) || DEFAULT_RECENT_BUFFER_LIMIT),
    );
    if (state.recentEvents.length > recentBufferLimit) {
      patchState({
        recentEvents: state.recentEvents.slice(0, recentBufferLimit),
      });
    }
  },

  setOnlineRetentionLimit(nextLimit: number): void {
    onlineRetentionLimit = Math.min(
      MAX_ONLINE_RETENTION_LIMIT,
      Math.max(MIN_ONLINE_RETENTION_LIMIT, Math.round(nextLimit) || DEFAULT_ONLINE_RETENTION_LIMIT),
    );
    flushOnlineSnapshotNow("retention-limit-change");
  },

  setSoundStatusMessage(messageText: string | null): void {
    patchState({ soundStatusMessage: messageText });
  },

  clearHistory(widgetId: string): void {
    if (!state.historyByWidget[widgetId]) {
      return;
    }
    const next = { ...state.historyByWidget };
    delete next[widgetId];
    state = {
      ...state,
      historyByWidget: next,
    };
    emit();
  },

  async initializeOnline(options?: { hydrateFromArchive?: boolean }): Promise<void> {
    ensureSocket();
    if (started) {
      return;
    }
    started = true;
    if (options?.hydrateFromArchive === false) {
      patchState({
        onlineLoading: false,
        onlineError: null,
      });
      return;
    }
    patchState({
      onlineLoading: true,
      onlineError: null,
    });

    try {
      const active = await api.getActiveEvents({
        limit: DEFAULT_ONLINE_LIMIT,
        includeClearedUnacknowledged: true,
      });
      onlineArchiveSnapshotUnavailable = false;

      onlineMap.clear();
      for (const item of active) {
        const id = normalizeOccurrenceId(item);
        if (!id) {
          continue;
        }
        onlineMap.set(id, item);
      }
      flushOnlineSnapshotNow("initialize-online");
      patchState({
        onlineLoading: false,
        onlineError: null,
      });
    } catch (error) {
      if (isArchiveUnavailableError(error)) {
        onlineArchiveSnapshotUnavailable = true;
        onlineMap.clear();
        flushOnlineSnapshotNow("initialize-online-archive-unavailable");
        patchState({
          onlineLoading: false,
          onlineError: null,
        });
        return;
      }
      patchState({
        onlineLoading: false,
        onlineError: formatError(error),
      });
    }
  },

  async reloadOnline(limit?: number): Promise<void> {
    if (onlineArchiveSnapshotUnavailable) {
      return;
    }
    patchState({ onlineLoading: true, onlineError: null });
    try {
      const active = await api.getActiveEvents({
        limit: Math.max(1, Math.round(limit ?? DEFAULT_ONLINE_LIMIT)),
        includeClearedUnacknowledged: true,
      });
      for (const item of active) {
        const id = normalizeOccurrenceId(item);
        if (!id) {
          continue;
        }
        onlineMap.set(id, item);
      }
      flushOnlineSnapshotNow("reload-online");
      patchState({
        onlineLoading: false,
        onlineError: null,
      });
    } catch (error) {
      patchState({ onlineLoading: false, onlineError: formatError(error) });
    }
  },

  async loadHistory(options: EventHistoryLoadOptions): Promise<void> {
    const widgetId = options.widgetId;
    const sequence = bumpHistorySequence(widgetId);
    const queryKey = JSON.stringify(options.query);
    patchHistory(widgetId, {
      loading: true,
      error: null,
      queryKey,
    });

    try {
      const page = await api.getEventHistory(options.query);
      if (!isLatestHistoryRequest(widgetId, sequence)) {
        return;
      }
      patchHistory(widgetId, {
        loading: false,
        error: null,
        items: page.items,
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        updatedAt: Date.now(),
      });
    } catch (error) {
      if (!isLatestHistoryRequest(widgetId, sequence)) {
        return;
      }
      patchHistory(widgetId, {
        loading: false,
        error: formatError(error),
      });
    }
  },

  async loadArchiveStatus(options?: { force?: boolean; minIntervalMs?: number }): Promise<void> {
    const force = options?.force === true;
    const minIntervalMs = Math.max(1000, Math.round(options?.minIntervalMs ?? ARCHIVE_STATUS_REFRESH_MIN_INTERVAL_MS));
    const now = Date.now();
    if (!force && archiveStatusLoadedAt !== null && (now - archiveStatusLoadedAt) < minIntervalMs) {
      return;
    }
    if (archiveStatusInFlight) {
      return archiveStatusInFlight;
    }

    patchState({ archiveStatusLoading: true, archiveStatusError: null });
    archiveStatusInFlight = (async () => {
      try {
        const archiveStatus = await api.getEventArchiveStatus();
        archiveStatusLoadedAt = Date.now();
        patchState({ archiveStatus, archiveStatusLoading: false, archiveStatusError: null });
      } catch (error) {
        patchState({ archiveStatusLoading: false, archiveStatusError: formatError(error) });
      } finally {
        archiveStatusInFlight = null;
      }
    })();

    return archiveStatusInFlight;
  },

  async acknowledgeOccurrences(ids: string[]): Promise<EventAcknowledgeResponse> {
    const response = await api.acknowledgeEvents(ids);
    const acknowledged = response.acknowledged ?? [];

    for (const item of acknowledged) {
      const id = normalizeOccurrenceId(item);
      if (!id) {
        continue;
      }
      const previous = onlineMap.get(id);
      onlineMap.set(id, previous ? { ...previous, ...item } : item);
    }

    if (acknowledged.length > 0) {
      flushOnlineSnapshotNow("acknowledged");

      const nextHistoryByWidget: Record<string, HistoryBucket> = {};
      const updatedById = new Map(acknowledged.map((item) => [normalizeOccurrenceId(item), item]));

      for (const [key, bucket] of Object.entries(state.historyByWidget)) {
        const nextItems = bucket.items.map((item) => {
          const replacement = updatedById.get(normalizeOccurrenceId(item));
          return replacement ? { ...item, ...replacement } : item;
        });
        nextHistoryByWidget[key] = {
          ...bucket,
          items: nextItems,
        };
      }

      state = {
        ...state,
        historyByWidget: nextHistoryByWidget,
      };
      emit();
    }

    return response;
  },

  async exportHistoryCsv(query: EventHistoryQuery): Promise<string> {
    return api.exportEventHistoryCsv(query);
  },
};
