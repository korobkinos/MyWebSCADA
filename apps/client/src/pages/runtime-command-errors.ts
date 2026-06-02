export type RuntimeCommandAbortReason = "superseded" | "popup_closed";
export type RuntimeCommandToastReason =
  | "already_pending"
  | "busy"
  | "expired"
  | "timeout"
  | "driver_offline"
  | "error";

type RuntimeCommandToastContext = {
  parameters?: Record<string, unknown>;
};

function isSliderLatestWrite(context: RuntimeCommandToastContext): boolean {
  return context.parameters?.__operatorActionKind === "slider"
    && context.parameters.__allowConcurrentWrite === true;
}

export function shouldSuppressManualCommandError(
  error: unknown,
  abortReason: RuntimeCommandAbortReason | undefined,
): boolean {
  return abortReason !== undefined && error instanceof DOMException && error.name === "AbortError";
}

export function shouldShowManualCommandToast(
  reason: RuntimeCommandToastReason,
  context: RuntimeCommandToastContext,
): boolean {
  if (reason === "timeout" && isSliderLatestWrite(context)) {
    return false;
  }
  return true;
}

export function shouldReportManualCommandFailure(
  reason: RuntimeCommandToastReason,
  context: RuntimeCommandToastContext,
): boolean {
  if (reason === "timeout" && isSliderLatestWrite(context)) {
    return false;
  }
  return true;
}
