const PERF_FLAG = (process.env.SCADA_PERF_LOG ?? "").trim().toLowerCase();
const PERF_ENABLED = PERF_FLAG === "1" || PERF_FLAG === "true" || PERF_FLAG === "yes" || PERF_FLAG === "on";

function escapeValue(value: string): string {
  if (!value.includes(" ") && !value.includes('"')) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}

export function isPerfLoggingEnabled(): boolean {
  return PERF_ENABLED;
}

export function logPerf(fields: Record<string, string | number | boolean | null | undefined>): void {
  if (!PERF_ENABLED) {
    return;
  }
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    const text = typeof value === "string" ? escapeValue(value) : String(value);
    pairs.push(`${key}=${text}`);
  }
  if (pairs.length === 0) {
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[perf] ${pairs.join(" ")}`);
}
