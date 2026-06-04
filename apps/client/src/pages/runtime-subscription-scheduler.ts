type ScheduleHandle = unknown;

type RuntimeSubscriptionSchedulerOptions = {
  intervalMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ScheduleHandle;
  cancel?: (handle: ScheduleHandle) => void;
};

type RuntimeSubscriptionScheduler = {
  request: (callback: () => void) => void;
  reset: () => void;
};

function defaultSchedule(callback: () => void, delayMs: number): ScheduleHandle {
  return setTimeout(callback, delayMs);
}

function defaultCancel(handle: ScheduleHandle): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

export function createRuntimeSubscriptionScheduler(
  options: RuntimeSubscriptionSchedulerOptions = {},
): RuntimeSubscriptionScheduler {
  const intervalMs = options.intervalMs ?? 200;
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? defaultSchedule;
  const cancel = options.cancel ?? defaultCancel;
  let lastRunAt: number | null = null;
  let scheduledHandle: ScheduleHandle | null = null;
  let pendingCallback: (() => void) | null = null;

  const flush = () => {
    scheduledHandle = null;
    const callback = pendingCallback;
    pendingCallback = null;
    if (!callback) {
      return;
    }
    lastRunAt = now();
    callback();
  };

  return {
    request(callback) {
      pendingCallback = callback;
      const elapsedMs = lastRunAt === null ? intervalMs : now() - lastRunAt;
      if (elapsedMs >= intervalMs) {
        if (scheduledHandle !== null) {
          cancel(scheduledHandle);
          scheduledHandle = null;
        }
        flush();
        return;
      }
      if (scheduledHandle === null) {
        scheduledHandle = schedule(flush, intervalMs - elapsedMs);
      }
    },
    reset() {
      pendingCallback = null;
      lastRunAt = null;
      if (scheduledHandle !== null) {
        cancel(scheduledHandle);
        scheduledHandle = null;
      }
    },
  };
}
