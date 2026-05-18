const MAX_LOG_ENTRIES = 500;

type TrendDiagnosticsEntry = {
  ts: string;
  event: string;
  payload?: unknown;
};

const trendDiagnosticsBuffer: TrendDiagnosticsEntry[] = [];

function safeClone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

export function logTrendDiagnostics(event: string, payload?: unknown): void {
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
