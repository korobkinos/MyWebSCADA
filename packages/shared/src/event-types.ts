import type { TagScalarValue } from "./tag-types";

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
  assetId?: string;
  filePath?: string;
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
  soundEnabled?: boolean;
  soundId?: string;
  textColor?: string;
  backgroundColor?: string;
  securityEnabled?: boolean;
  securityTagName?: string;
  securityBitValue?: boolean | 0 | 1;
  createdAt?: string;
  updatedAt?: string;
};
