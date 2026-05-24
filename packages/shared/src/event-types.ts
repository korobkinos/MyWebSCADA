import type { TagScalarValue } from "./tag-types";
import type { RuntimeAction } from "./hmi-object-types";

export type EventConditionMode = "bit" | "word";
export type EventBitTrigger = "ON" | "OFF" | "OFF_TO_ON" | "ON_TO_OFF";
export type EventWordOperator = "<" | ">" | "=" | "<>" | ">=" | "<=";

export type EventCategory = {
  id: string;
  name: string;
  description?: string;
  color?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type EventSound = {
  id: string;
  name: string;
  kind?: "notification" | "warning" | "alarm" | "custom";
  fileName?: string;
  assetId?: string;
  url?: string;
  filePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  enabled?: boolean;
  volume?: number;
  loop?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type EventDefinition = {
  id: string;
  enabled?: boolean;
  categoryId?: string;
  categoryName?: string;
  message?: string;
  priority?: number;
  sourceTagName?: string;
  conditionMode?: EventConditionMode;
  bitTrigger?: EventBitTrigger;
  wordOperator?: EventWordOperator;
  wordValue?: number;
  startupDelayMs?: number;
  requireAck?: boolean;
  ackValue?: TagScalarValue;
  ackTagName?: string;
  notificationTagName?: string;
  elapsedTimeTagName?: string;
  soundEnabled?: boolean;
  soundId?: string;
  textColor?: string;
  backgroundColor?: string;
  backgroundBlinkEnabled?: boolean;
  backgroundBlinkDurationMs?: number;
  backgroundBlinkOpacity?: number;
  securityEnabled?: boolean;
  securityTagName?: string;
  securityBitValue?: boolean | 0 | 1;
  onActiveActions?: RuntimeAction[];
  onClearedActions?: RuntimeAction[];
  onAckActions?: RuntimeAction[];
  createdAt?: string;
  updatedAt?: string;
};

export type EventOccurrenceState = "active" | "cleared" | "acknowledged";

export type EventOccurrence = {
  id: string;
  eventDefinitionId: string;
  occurredAt: string;
  clearedAt?: string | null;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  state: EventOccurrenceState;
  sourceTagNameSnapshot?: string | null;
  categoryIdSnapshot?: string | null;
  categoryNameSnapshot?: string | null;
  prioritySnapshot?: number | null;
  messageTextSnapshot?: string | null;
  valueAtTrigger?: TagScalarValue;
  valueAtClear?: TagScalarValue;
  quality?: string | null;
  runtimeSource?: string | null;
  soundId?: string | null;
  requireAck?: boolean;
  createdAt?: string;
  updatedAt?: string;
  serviceData?: Record<string, unknown> | null;
};

export type EventHistoryRecord = EventOccurrence;

export type EventArchiveCleanupMode = "byAge" | "bySize" | "byAgeAndSize";

export type EventArchiveSettings = {
  enabled: boolean;
  retentionDays: number;
  maxDatabaseSizeMb: number;
  cleanupMode: EventArchiveCleanupMode;
  cleanupIntervalMinutes: number;
  optimizeAfterCleanup: boolean;
  deleteBatchSize?: number;
  maintenanceIntervalMs?: number;
  maxMaintenanceTickMs?: number;
  maxDeleteTransactionMs?: number;
  updatedAt?: string;
};

export type EventHistoryQuery = {
  from?: string;
  to?: string;
  category?: string;
  priority?: number;
  sourceTagName?: string;
  state?: EventOccurrenceState;
  search?: string;
  limit?: number;
  offset?: number;
};

export type EventHistoryPage = {
  items: EventHistoryRecord[];
  total: number;
  limit: number;
  offset: number;
};
