import type { TagDefinition, TagScalarValue, TagValue } from "@web-scada/shared";

export type DriverHealth = "disabled" | "stopped" | "starting" | "running" | "error" | "reconnecting";

export type DriverStatus = {
  id: string;
  type: string;
  health: DriverHealth;
  message?: string;
  updatedAt: number;
  lastConnectedAt?: number;
  lastDisconnectedAt?: number;
  lastError?: string;
  lastErrorAt?: number;
  reconnectAttempt?: number;
  endpointUrl?: string;
  clockWarning?: string;
  lastPollAt?: number;
  lastPollDurationMs?: number;
  lastPollTagCount?: number;
  lastPollBatchCount?: number;
  pollingSkipped?: boolean;
  pollingSkipReason?: string;
  readMode?: "polling" | "subscription";
  subscriptionActive?: boolean;
  subscribedTagCount?: number;
  lastSubscriptionUpdateAt?: number;
  subscriptionError?: string;
  subscriptionState?: "inactive" | "creating" | "active" | "error";
};

export interface Driver {
  id: string;
  type: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  readTag(tag: TagDefinition): Promise<TagValue>;
  readTags?(tags: TagDefinition[]): Promise<TagValue[]>;
  subscribeTags?(tags: TagDefinition[], onValues: (values: TagValue[]) => void): Promise<void>;
  unsubscribe?(): Promise<void>;
  writeTag(tag: TagDefinition, value: TagScalarValue): Promise<void>;
  getStatus(): DriverStatus;
  isAvailable?(): boolean;
}
