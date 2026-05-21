export type ClientConnectionState = "online" | "degraded" | "offline";

export type RuntimeDiagnosticsSnapshot = {
  activePollingLoops: number;
  activeWebSockets: number;
  inFlightRequests: number;
  trendPointsInMemory: number;
  cachedTrendRanges: number;
  lastBackendError: string | null;
  connectionState: ClientConnectionState;
};

type RuntimeDiagnosticsListener = (snapshot: RuntimeDiagnosticsSnapshot) => void;

const POLLING_LOOP_IDS = new Set<string>();
const LISTENERS = new Set<RuntimeDiagnosticsListener>();

const SNAPSHOT: RuntimeDiagnosticsSnapshot = {
  activePollingLoops: 0,
  activeWebSockets: 0,
  inFlightRequests: 0,
  trendPointsInMemory: 0,
  cachedTrendRanges: 0,
  lastBackendError: null,
  connectionState: "online",
};

function emitDiagnostics(): void {
  const next = getRuntimeDiagnosticsSnapshot();
  for (const listener of LISTENERS) {
    listener(next);
  }
}

export function getRuntimeDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
  return { ...SNAPSHOT };
}

export function subscribeRuntimeDiagnostics(listener: RuntimeDiagnosticsListener): () => void {
  LISTENERS.add(listener);
  listener(getRuntimeDiagnosticsSnapshot());
  return () => {
    LISTENERS.delete(listener);
  };
}

export function registerPollingLoop(loopId: string): () => void {
  if (!loopId || POLLING_LOOP_IDS.has(loopId)) {
    return () => undefined;
  }
  POLLING_LOOP_IDS.add(loopId);
  SNAPSHOT.activePollingLoops = POLLING_LOOP_IDS.size;
  emitDiagnostics();
  return () => {
    if (!POLLING_LOOP_IDS.delete(loopId)) {
      return;
    }
    SNAPSHOT.activePollingLoops = POLLING_LOOP_IDS.size;
    emitDiagnostics();
  };
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
