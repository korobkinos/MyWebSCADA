import type { TagValue } from "@web-scada/shared";

type ScheduleHandle = unknown;

type TagValueBatcherOptions = {
  schedule?: (callback: () => void) => ScheduleHandle;
  cancel?: (handle: ScheduleHandle) => void;
};

type TagValueBatcher = {
  push: (values: TagValue[]) => void;
  flush: () => void;
  close: () => void;
};

function defaultSchedule(callback: () => void): ScheduleHandle {
  return setTimeout(callback, 100);
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
  let scheduledHandle: ScheduleHandle | null = null;
  let closed = false;

  const flush = () => {
    scheduledHandle = null;
    if (closed || pending.size === 0) {
      return;
    }
    const values = [...pending.values()];
    pending.clear();
    onFlush(values);
  };

  const ensureScheduled = () => {
    if (scheduledHandle !== null) {
      return;
    }
    scheduledHandle = schedule(flush);
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
