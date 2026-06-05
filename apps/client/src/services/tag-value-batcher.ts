import type { TagValue } from "@web-scada/shared";

type ScheduleHandle = unknown;

type TagValueBatcherOptions = {
  schedule?: (callback: () => void, pendingCount: number) => ScheduleHandle;
  cancel?: (handle: ScheduleHandle) => void;
  maxValuesPerFlush?: number;
};

type TagValueBatcher = {
  push: (values: TagValue[]) => void;
  flush: () => void;
  close: () => void;
};

function defaultSchedule(callback: () => void, pendingCount: number): ScheduleHandle {
  const delayMs = pendingCount <= 50 ? 16 : pendingCount <= 500 ? 32 : 50;
  return setTimeout(callback, delayMs);
}

function defaultCancel(handle: ScheduleHandle): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

export function createTagValueBatcher(
  onFlush: (values: TagValue[]) => void,
  options: TagValueBatcherOptions = {},
): TagValueBatcher {
  const pending = new Map<string, TagValue>();
  const schedule = options.schedule ?? defaultSchedule;
  const cancel = options.cancel ?? defaultCancel;
  const maxValuesPerFlush = Math.max(1, options.maxValuesPerFlush ?? 250);
  let scheduledHandle: ScheduleHandle | null = null;
  let closed = false;

  const flush = () => {
    scheduledHandle = null;
    if (closed || pending.size === 0) {
      return;
    }
    const values: TagValue[] = [];
    for (const [name, value] of pending) {
      values.push(value);
      pending.delete(name);
      if (values.length >= maxValuesPerFlush) {
        break;
      }
    }
    onFlush(values);
    if (!closed && pending.size > 0) {
      ensureScheduled();
    }
  };

  const ensureScheduled = () => {
    if (scheduledHandle !== null) {
      return;
    }
    scheduledHandle = schedule(flush, pending.size);
  };

  return {
    push(values) {
      if (closed || values.length === 0) {
        return;
      }
      for (const value of values) {
        pending.set(value.name, value);
      }
      ensureScheduled();
    },
    flush,
    close() {
      closed = true;
      pending.clear();
      if (scheduledHandle !== null) {
        cancel(scheduledHandle);
        scheduledHandle = null;
      }
    },
  };
}
