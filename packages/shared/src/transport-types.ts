import type { ManualCommandMeta } from "./runtime-command-types";
import type { EventOccurrence } from "./event-types";

export type TagUpdateMessage = {
  type: "tag-update";
  payload: {
    name: string;
    value: boolean | number | string | null;
    quality: "Good" | "Bad" | "Uncertain";
    timestamp: number;
    source?: string;
  };
};

export type TagBatchUpdateMessage = {
  type: "tag-batch";
  payload: {
    updates: Array<TagUpdateMessage["payload"]>;
  };
};

export type EventUpdateMessage = {
  type: "event-update";
  payload: {
    kind: "active" | "cleared" | "acknowledged";
    occurrence: EventOccurrence;
  };
};

export type WriteTagMessage = {
  type: "write-tag";
  payload: {
    name: string;
    value: boolean | number | string | null;
    commandMeta?: ManualCommandMeta;
  };
};

export type SubscribeTagsMessage = {
  type: "subscribe-tags";
  payload: {
    tags: string[];
  };
};

export type RuntimeWsServerMessage = TagUpdateMessage | TagBatchUpdateMessage | EventUpdateMessage;
export type RuntimeWsClientMessage = WriteTagMessage | SubscribeTagsMessage;
