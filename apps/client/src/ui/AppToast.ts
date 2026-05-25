import type { Intent, Toaster, ToastProps } from "@blueprintjs/core";

export type AppToastKind = "success" | "error" | "warning" | "info";

export type AppToastOptions = {
  details?: string;
  timeout?: number;
};

export type AppToastApi = {
  show: (kind: AppToastKind, message: string, options?: AppToastOptions) => void;
  success: (message: string, options?: AppToastOptions) => void;
  error: (message: string, options?: AppToastOptions) => void;
  warning: (message: string, options?: AppToastOptions) => void;
  info: (message: string, options?: AppToastOptions) => void;
};

type PendingToast = {
  kind: AppToastKind;
  message: string;
  options?: AppToastOptions;
};

const DEFAULT_TIMEOUT_MS = 3200;
const queue: PendingToast[] = [];
let toaster: Toaster | null = null;

function getIntent(kind: AppToastKind): Intent {
  if (kind === "success") {
    return "success";
  }
  if (kind === "error") {
    return "danger";
  }
  if (kind === "warning") {
    return "warning";
  }
  return "primary";
}

function getIcon(kind: AppToastKind): ToastProps["icon"] {
  if (kind === "success") {
    return "tick-circle";
  }
  if (kind === "error") {
    return "error";
  }
  if (kind === "warning") {
    return "warning-sign";
  }
  return "info-sign";
}

function toMessage(message: string, details?: string): ToastProps["message"] {
  if (!details) {
    return message;
  }
  return `${message}: ${details}`;
}

function dispatchToast(kind: AppToastKind, message: string, options?: AppToastOptions): void {
  if (!toaster) {
    queue.push({ kind, message, options });
    return;
  }
  toaster.show({
    className: "app-toast",
    intent: getIntent(kind),
    icon: getIcon(kind),
    message: toMessage(message, options?.details),
    timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
  });
}

export function setAppToaster(nextToaster: Toaster | null): void {
  toaster = nextToaster;
  if (!toaster || queue.length === 0) {
    return;
  }
  const pending = queue.splice(0, queue.length);
  for (const item of pending) {
    dispatchToast(item.kind, item.message, item.options);
  }
}

export const appToast: AppToastApi = {
  show(kind, message, options) {
    dispatchToast(kind, message, options);
  },
  success(message, options) {
    dispatchToast("success", message, options);
  },
  error(message, options) {
    dispatchToast("error", message, options);
  },
  warning(message, options) {
    dispatchToast("warning", message, options);
  },
  info(message, options) {
    dispatchToast("info", message, options);
  },
};

export const AppToast = appToast;

export function useAppToast(): AppToastApi {
  return appToast;
}
