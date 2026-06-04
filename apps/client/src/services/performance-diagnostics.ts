const PERFORMANCE_DIAGNOSTICS_INTERVAL_MS = 10_000;
const PERFORMANCE_MEASURE_WARNING_LIMIT = 10_000;

export function startRuntimePerformanceDiagnostics(): () => void {
  if (!import.meta.env.DEV || typeof window === "undefined" || typeof performance === "undefined") {
    return () => undefined;
  }

  const reportAndClear = () => {
    const measureCount = performance.getEntriesByType("measure").length;
    if (measureCount > PERFORMANCE_MEASURE_WARNING_LIMIT) {
      // eslint-disable-next-line no-console
      console.warn("[PerformanceDiagnostics] PerformanceMeasure entries exceed 10000", {
        measures: measureCount,
      });
    }

    performance.clearMarks();
    performance.clearMeasures();
    performance.clearResourceTimings();
  };

  reportAndClear();
  const timer = window.setInterval(reportAndClear, PERFORMANCE_DIAGNOSTICS_INTERVAL_MS);
  return () => window.clearInterval(timer);
}
