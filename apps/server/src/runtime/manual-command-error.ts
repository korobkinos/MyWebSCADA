import type { ManualCommandRejectReason } from "@web-scada/shared";

export class ManualCommandError extends Error {
  public constructor(
    public readonly reason: ManualCommandRejectReason,
    message: string,
  ) {
    super(message);
    this.name = "ManualCommandError";
  }
}

export function toManualCommandStatusCode(reason: ManualCommandRejectReason): number {
  if (reason === "timeout") {
    return 408;
  }
  if (reason === "busy" || reason === "already_pending") {
    return 409;
  }
  if (reason === "expired") {
    return 410;
  }
  if (reason === "driver_offline") {
    return 503;
  }
  return 500;
}
