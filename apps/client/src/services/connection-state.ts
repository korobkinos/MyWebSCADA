import { setRuntimeDiagnosticMetric } from "./runtime-diagnostics";

export type ConnectivityEndpoint = "project" | "runtimeStatus" | "trendTags" | "trendsQuery";
export type ConnectionState = "online" | "degraded" | "offline";

type ConnectionSnapshot = {
  state: ConnectionState;
  lastError: string | null;
  endpoints: Record<ConnectivityEndpoint, { failures: number; nextAllowedAt: number }>;
};

type ConnectionListener = (snapshot: ConnectionSnapshot) => void;

const BACKOFF_MS: number[] = [1000, 2000, 5000, 10000, 30000];
const ENDPOINTS: ConnectivityEndpoint[] = ["project", "runtimeStatus", "trendTags", "trendsQuery"];
const listeners = new Set<ConnectionListener>();

const endpointState: Record<ConnectivityEndpoint, { failures: number; nextAllowedAt: number }> = {
  project: { failures: 0, nextAllowedAt: 0 },
  runtimeStatus: { failures: 0, nextAllowedAt: 0 },
  trendTags: { failures: 0, nextAllowedAt: 0 },
  trendsQuery: { failures: 0, nextAllowedAt: 0 },
};

let connectionState: ConnectionState = "online";
let lastError: string | null = null;

setRuntimeDiagnosticMetric("connectionState", connectionState);

function computeConnectionState(): ConnectionState {
  let hasFailure = false;
  let hasOffline = false;
  for (const endpoint of ENDPOINTS) {
    const failures = endpointState[endpoint].failures;
    if (failures > 0) {
      hasFailure = true;
    }
    if (failures >= 3) {
      hasOffline = true;
    }
  }
  if (hasOffline) {
    return "offline";
  }
  if (hasFailure) {
    return "degraded";
  }
  return "online";
}

function emitConnectionState(): void {
  const snapshot = getConnectionSnapshot();
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function updateDerivedConnectionState(nextLastError?: string | null): void {
  connectionState = computeConnectionState();
  if (nextLastError !== undefined) {
    lastError = nextLastError;
  }
  setRuntimeDiagnosticMetric("connectionState", connectionState);
  setRuntimeDiagnosticMetric("lastBackendError", lastError);
  emitConnectionState();
}

function computeBackoffDelayMs(failures: number): number {
  if (failures <= 0) {
    return 0;
  }
  const index = Math.min(BACKOFF_MS.length - 1, failures - 1);
  return BACKOFF_MS[index] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 30000;
}

export function getConnectivityBackoffSequenceMs(): number[] {
  return [...BACKOFF_MS];
}

export function getConnectionSnapshot(): ConnectionSnapshot {
  return {
    state: connectionState,
    lastError,
    endpoints: {
      project: { ...endpointState.project },
      runtimeStatus: { ...endpointState.runtimeStatus },
      trendTags: { ...endpointState.trendTags },
      trendsQuery: { ...endpointState.trendsQuery },
    },
  };
}

export function subscribeConnectionState(listener: ConnectionListener): () => void {
  listeners.add(listener);
  listener(getConnectionSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function getEndpointBackoffDelay(endpoint: ConnectivityEndpoint, nowMs = Date.now()): number {
  const nextAllowedAt = endpointState[endpoint].nextAllowedAt;
  if (nextAllowedAt <= nowMs) {
    return 0;
  }
  return nextAllowedAt - nowMs;
}

export function canRequestEndpoint(endpoint: ConnectivityEndpoint, nowMs = Date.now()): { allowed: boolean; delayMs: number } {
  const delayMs = getEndpointBackoffDelay(endpoint, nowMs);
  return { allowed: delayMs <= 0, delayMs };
}

export function markEndpointSuccess(endpoint: ConnectivityEndpoint): void {
  const current = endpointState[endpoint];
  if (current.failures === 0 && current.nextAllowedAt === 0) {
    return;
  }
  current.failures = 0;
  current.nextAllowedAt = 0;
  const nextState = computeConnectionState();
  updateDerivedConnectionState(nextState === "online" ? null : lastError);
}

export function markEndpointFailure(endpoint: ConnectivityEndpoint, errorText?: string): void {
  const current = endpointState[endpoint];
  current.failures += 1;
  const delayMs = computeBackoffDelayMs(current.failures);
  current.nextAllowedAt = Date.now() + delayMs;
  updateDerivedConnectionState(errorText ?? lastError);
}

export function resetConnectionStateForTests(): void {
  for (const endpoint of ENDPOINTS) {
    endpointState[endpoint].failures = 0;
    endpointState[endpoint].nextAllowedAt = 0;
  }
  updateDerivedConnectionState(null);
}

export function mapRequestToConnectivityEndpoint(url: string, method: string): ConnectivityEndpoint | null {
  if (url === "/api/project" && method === "GET") {
    return "project";
  }
  if (url === "/api/runtime/status" && method === "GET") {
    return "runtimeStatus";
  }
  if (url === "/api/trends/tags" && method === "GET") {
    return "trendTags";
  }
  if (url === "/api/trends/query" && method === "POST") {
    return "trendsQuery";
  }
  return null;
}

export function isConnectivityFailure(error: unknown, status?: number): boolean {
  if (status !== undefined) {
    return status >= 500;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message) {
    return true;
  }
  const normalized = message.toLowerCase();
  return normalized.includes("network")
    || normalized.includes("failed to fetch")
    || normalized.includes("err_connection")
    || normalized.includes("timeout")
    || normalized.includes("econnrefused")
    || normalized.includes("connection refused");
}
