import type { TagDefinition, TagScalarValue, TagValue } from "@web-scada/shared";

export type DriverHealth = "disabled" | "stopped" | "starting" | "running" | "error" | "reconnecting";

export type DriverStatus = {
  id: string;
  type: string;
  health: DriverHealth;
  message?: string;
  updatedAt: number;
};

export interface Driver {
  id: string;
  type: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  readTag(tag: TagDefinition): Promise<TagValue>;
  writeTag(tag: TagDefinition, value: TagScalarValue): Promise<void>;
  getStatus(): DriverStatus;
}
