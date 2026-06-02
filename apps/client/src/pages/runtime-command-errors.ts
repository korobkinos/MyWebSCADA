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
  const isSliderLatestWrite =
    context.parameters?.__operatorActionKind === "slider"
    && context.parameters.__allowConcurrentWrite === true;
  if (reason === "timeout" && isSliderLatestWrite) {
    return false;
  }
  return true;
}
