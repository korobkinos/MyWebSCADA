const MAX_LOG_ENTRIES = 500;
const TREND_PERF_DEBUG_LOCAL_STORAGE_KEY = "scada.debugTrendPerf";
const DEBUG_FLAG_REFRESH_MS = 2000;

type TrendDiagnosticsEntry = {
  ts: string;
  event: string;
  payload?: unknown;
};

const trendDiagnosticsBuffer: TrendDiagnosticsEntry[] = [];
let cachedDebugEnabled = false;
let lastDebugFlagCheckAt = 0;

export function isTrendPerfDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const now = Date.now();
  if (now - lastDebugFlagCheckAt >= DEBUG_FLAG_REFRESH_MS) {
    cachedDebugEnabled = window.localStorage.getItem(TREND_PERF_DEBUG_LOCAL_STORAGE_KEY) === "1";
    lastDebugFlagCheckAt = now;
  }
  return cachedDebugEnabled;
}

function safeClone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

export function logTrendDiagnostics(event: string, payload?: unknown): void {
  if (!isTrendPerfDebugEnabled()) {
    return;
  }
  const entry: TrendDiagnosticsEntry = {
    ts: new Date().toISOString(),
    event,
    payload: payload === undefined ? undefined : safeClone(payload),
  };
  trendDiagnosticsBuffer.push(entry);
  if (trendDiagnosticsBuffer.length > MAX_LOG_ENTRIES) {
    trendDiagnosticsBuffer.splice(0, trendDiagnosticsBuffer.length - MAX_LOG_ENTRIES);
  }
}

export function getTrendDiagnostics(): TrendDiagnosticsEntry[] {
  return trendDiagnosticsBuffer.map((item) => ({ ...item }));
}

export function exportTrendDiagnostics(context: Record<string, unknown> = {}): string {
  const payload = {
    generatedAt: new Date().toISOString(),
    context,
    entries: getTrendDiagnostics(),
  };
  return JSON.stringify(payload, null, 2);
}
