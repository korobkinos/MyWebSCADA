export type ClientConnectionState = "online" | "degraded" | "offline";

export type RuntimeDiagnosticsSnapshot = {
  activePollingLoops: number;
  activePollingLoopIds: string[];
  activeWebSockets: number;
  inFlightRequests: number;
  trendPointsInMemory: number;
  cachedTrendRanges: number;
  lastBackendError: string | null;
  connectionState: ClientConnectionState;
};

export type RuntimeRateDiagnosticsSnapshot = {
  webSocketTagPackets: number;
  webSocketTagValues: number;
  setTagValuesCalls: number;
  setTagValuesValues: number;
};

type RuntimeDiagnosticsListener = (snapshot: RuntimeDiagnosticsSnapshot) => void;
type PollingLoopMeta = {
  count: number;
  registeredAt: number;
  duplicateCount: number;
};
export type TrendWidgetDiagnostics = {
  objectId: string;
  activeLoopCount: number;
  lastQueryTime: number | null;
  queryCountPerMinute: number;
  expectedQueryCountPerMinute?: number;
  inFlightQueryCount: number;
  pointsInState: number;
  pointsInChart: number;
  offlineBufferedPointCount: number;
  liveBufferedPointCount: number;
  cachePointCount: number;
  cacheEntryCount: number;
  echartsRenderedPointCount: number;
  livePendingPointCount: number;
  liveBootstrapPendingPointCount: number;
};

const POLLING_LOOP_IDS = new Map<string, PollingLoopMeta>();
const TREND_WIDGETS = new Map<string, TrendWidgetDiagnostics>();
const LISTENERS = new Set<RuntimeDiagnosticsListener>();
const RUNTIME_DIAGNOSTICS_DEBUG_LOCAL_STORAGE_KEY = "scada.debugRuntimeDiagnostics";

const SNAPSHOT: RuntimeDiagnosticsSnapshot = {
  activePollingLoops: 0,
  activePollingLoopIds: [],
  activeWebSockets: 0,
  inFlightRequests: 0,
  trendPointsInMemory: 0,
  cachedTrendRanges: 0,
  lastBackendError: null,
  connectionState: "online",
};

const RATE_SNAPSHOT: RuntimeRateDiagnosticsSnapshot = {
  webSocketTagPackets: 0,
  webSocketTagValues: 0,
  setTagValuesCalls: 0,
  setTagValuesValues: 0,
};

let rateReporterTimer: number | undefined;

function isRuntimeDiagnosticsConsoleEnabled(): boolean {
  return import.meta.env.DEV
    && typeof window !== "undefined"
    && window.localStorage.getItem(RUNTIME_DIAGNOSTICS_DEBUG_LOCAL_STORAGE_KEY) === "1";
}

function maybeStartRuntimeRateDiagnosticsReporter(): void {
  if (!import.meta.env.DEV || typeof window === "undefined" || rateReporterTimer) {
    return;
  }
  rateReporterTimer = window.setInterval(() => {
    const snapshot = getRuntimeRateDiagnosticsSnapshot();
    if (
      isRuntimeDiagnosticsConsoleEnabled()
      && (
        snapshot.webSocketTagPackets > 0
        || snapshot.webSocketTagValues > 0
        || snapshot.setTagValuesCalls > 0
        || snapshot.setTagValuesValues > 0
      )
    ) {
      // eslint-disable-next-line no-console
      console.debug("[RuntimeDiagnostics] tag update rates/sec", snapshot);
    }
    if (isRuntimeDiagnosticsConsoleEnabled() && snapshot.setTagValuesCalls > 10) {
      // eslint-disable-next-line no-console
      console.warn("[RuntimeDiagnostics] setTagValues called more than 10 times/sec", snapshot);
    }
    resetRuntimeRateDiagnostics();
  }, 1000);
}

function resetRuntimeRateDiagnostics(): void {
  RATE_SNAPSHOT.webSocketTagPackets = 0;
  RATE_SNAPSHOT.webSocketTagValues = 0;
  RATE_SNAPSHOT.setTagValuesCalls = 0;
  RATE_SNAPSHOT.setTagValuesValues = 0;
}

function emitDiagnostics(): void {
  const next = getRuntimeDiagnosticsSnapshot();
  for (const listener of LISTENERS) {
    listener(next);
  }
}

function getPollingLoopCount(): number {
  let count = 0;
  for (const item of POLLING_LOOP_IDS.values()) {
    count += item.count;
  }
  return count;
}

function syncPollingSnapshot(): void {
  SNAPSHOT.activePollingLoops = getPollingLoopCount();
  SNAPSHOT.activePollingLoopIds = [...POLLING_LOOP_IDS.entries()].flatMap(([id, meta]) => Array.from({ length: meta.count }, () => id));
}

export function getRuntimeDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
  return { ...SNAPSHOT, activePollingLoopIds: [...SNAPSHOT.activePollingLoopIds] };
}

export function subscribeRuntimeDiagnostics(listener: RuntimeDiagnosticsListener): () => void {
  LISTENERS.add(listener);
  listener(getRuntimeDiagnosticsSnapshot());
  return () => {
    LISTENERS.delete(listener);
  };
}

export function getRuntimeRateDiagnosticsSnapshot(): RuntimeRateDiagnosticsSnapshot {
  return { ...RATE_SNAPSHOT };
}

export function recordWebSocketTagPacket(valueCount: number): void {
  maybeStartRuntimeRateDiagnosticsReporter();
  RATE_SNAPSHOT.webSocketTagPackets += 1;
  RATE_SNAPSHOT.webSocketTagValues += Math.max(0, Math.round(valueCount));
}

export function recordSetTagValuesCall(valueCount: number): void {
  maybeStartRuntimeRateDiagnosticsReporter();
  RATE_SNAPSHOT.setTagValuesCalls += 1;
  RATE_SNAPSHOT.setTagValuesValues += Math.max(0, Math.round(valueCount));
}

export function resetRuntimeRateDiagnosticsForTest(): void {
  resetRuntimeRateDiagnostics();
}

export function registerPollingLoop(loopId: string): () => void {
  if (!loopId) {
    return () => undefined;
  }
  const existing = POLLING_LOOP_IDS.get(loopId);
  if (existing) {
    existing.count += 1;
    existing.duplicateCount += 1;
    if (isRuntimeDiagnosticsConsoleEnabled()) {
      // eslint-disable-next-line no-console
      console.warn("[RuntimeDiagnostics] duplicate polling loop registered", {
        loopId,
        count: existing.count,
        duplicateCount: existing.duplicateCount,
        activePollingLoops: getPollingLoopCount(),
        activePollingLoopIds: [...POLLING_LOOP_IDS.keys()],
      });
    }
  } else {
    POLLING_LOOP_IDS.set(loopId, {
      count: 1,
      registeredAt: Date.now(),
      duplicateCount: 0,
    });
  }
  syncPollingSnapshot();
  if (isRuntimeDiagnosticsConsoleEnabled()) {
    // eslint-disable-next-line no-console
    console.info("[RuntimeDiagnostics] activePollingLoops", {
      activePollingLoops: SNAPSHOT.activePollingLoops,
      activePollingLoopIds: SNAPSHOT.activePollingLoopIds,
    });
  }
  emitDiagnostics();
  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    const current = POLLING_LOOP_IDS.get(loopId);
    if (!current) {
      return;
    }
    current.count -= 1;
    if (current.count <= 0) {
      POLLING_LOOP_IDS.delete(loopId);
    }
    syncPollingSnapshot();
    if (isRuntimeDiagnosticsConsoleEnabled()) {
      // eslint-disable-next-line no-console
      console.info("[RuntimeDiagnostics] activePollingLoops", {
        activePollingLoops: SNAPSHOT.activePollingLoops,
        activePollingLoopIds: SNAPSHOT.activePollingLoopIds,
      });
    }
    emitDiagnostics();
  };
}

export function setTrendWidgetDiagnostics(objectId: string, diagnostics: TrendWidgetDiagnostics): void {
  TREND_WIDGETS.set(objectId, { ...diagnostics });
  const expectedPerMinute = Number.isFinite(diagnostics.expectedQueryCountPerMinute)
    ? Math.max(1, Number(diagnostics.expectedQueryCountPerMinute))
    : 60_000 / 2000 + 2;
  if (isRuntimeDiagnosticsConsoleEnabled() && diagnostics.queryCountPerMinute > expectedPerMinute) {
    // eslint-disable-next-line no-console
    console.warn("[RuntimeDiagnostics] excessive trend query rate", diagnostics);
  }
}

export function clearTrendWidgetDiagnostics(objectId: string): void {
  TREND_WIDGETS.delete(objectId);
}

export function getTrendWidgetDiagnostics(): TrendWidgetDiagnostics[] {
  return [...TREND_WIDGETS.values()].map((item) => ({ ...item }));
}

export function setRuntimeDiagnosticMetric(
  metric: keyof RuntimeDiagnosticsSnapshot,
  value: number | string | null,
): void {
  if (metric === "connectionState") {
    if (value === "online" || value === "degraded" || value === "offline") {
      SNAPSHOT.connectionState = value;
      emitDiagnostics();
    }
    return;
  }

  if (metric === "lastBackendError") {
    SNAPSHOT.lastBackendError = typeof value === "string" && value.trim() ? value : null;
    emitDiagnostics();
    return;
  }

  const numericValue = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  switch (metric) {
    case "activePollingLoops":
      SNAPSHOT.activePollingLoops = numericValue;
      SNAPSHOT.activePollingLoopIds = [];
      break;
    case "activeWebSockets":
      SNAPSHOT.activeWebSockets = numericValue;
      break;
    case "inFlightRequests":
      SNAPSHOT.inFlightRequests = numericValue;
      break;
    case "trendPointsInMemory":
      SNAPSHOT.trendPointsInMemory = numericValue;
      break;
    case "cachedTrendRanges":
      SNAPSHOT.cachedTrendRanges = numericValue;
      break;
    default:
      break;
  }
  emitDiagnostics();
}

export function incrementRuntimeDiagnosticMetric(
  metric: "activeWebSockets" | "inFlightRequests",
  delta: number,
): void {
  const current = metric === "activeWebSockets" ? SNAPSHOT.activeWebSockets : SNAPSHOT.inFlightRequests;
  const next = Math.max(0, current + delta);
  if (metric === "activeWebSockets") {
    SNAPSHOT.activeWebSockets = next;
  } else {
    SNAPSHOT.inFlightRequests = next;
  }
  emitDiagnostics();
}
