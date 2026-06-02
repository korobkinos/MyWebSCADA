export type RuntimeCommandAbortReason = "superseded" | "popup_closed";

export function shouldSuppressManualCommandError(
  error: unknown,
  abortReason: RuntimeCommandAbortReason | undefined,
): boolean {
  return abortReason !== undefined && error instanceof DOMException && error.name === "AbortError";
}
