import {
  DEFAULT_BUTTON_ACTION_TIMEOUT_MS,
  MIN_BUTTON_ACTION_TIMEOUT_MS,
  type ButtonActionStep,
} from "@web-scada/shared";

type ExecuteButtonActionQueueOptions = {
  steps: ButtonActionStep[];
  execute: (step: ButtonActionStep, index: number) => void | Promise<void>;
  onShowError?: (error: unknown, step: ButtonActionStep, index: number) => void;
  onWarn?: (error: unknown, step: ButtonActionStep, index: number) => void;
};

function executeWithTimeout(
  execute: () => void | Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Action timeout after ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(execute), timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export async function executeButtonActionQueue({
  steps,
  execute,
  onShowError,
  onWarn,
}: ExecuteButtonActionQueueOptions): Promise<void> {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step || step.enabled === false) {
      continue;
    }
    const timeoutMs = Math.max(
      MIN_BUTTON_ACTION_TIMEOUT_MS,
      Number.isFinite(step.timeoutMs) ? Math.floor(step.timeoutMs!) : DEFAULT_BUTTON_ACTION_TIMEOUT_MS,
    );
    try {
      await executeWithTimeout(() => execute(step, index), timeoutMs);
    } catch (error) {
      const policy = step.onError ?? "showErrorAndStop";
      if (policy === "continueQueue") {
        onWarn?.(error, step, index);
        continue;
      }
      if (policy === "showErrorAndStop") {
        onShowError?.(error, step, index);
      } else {
        onWarn?.(error, step, index);
      }
      break;
    }
  }
}
