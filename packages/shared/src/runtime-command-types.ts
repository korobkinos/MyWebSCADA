export const COMMAND_TIMEOUT_MS = 5000;

export type ManualCommandMeta = {
  commandId: string;
  commandKey: string;
  createdAt: number;
  ttlMs: number;
};

export type ManualCommandRejectReason =
  | "already_pending"
  | "busy"
  | "expired"
  | "timeout"
  | "driver_offline"
  | "error";

export type MacroRunSkipReason = "disabled" | "already_running" | "invalid";

export type MacroRunReason = ManualCommandRejectReason | MacroRunSkipReason;
