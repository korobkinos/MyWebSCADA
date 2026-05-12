import type { ManualCommandMeta } from "./runtime-command-types";

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

export type RuntimeWsServerMessage = TagUpdateMessage | TagBatchUpdateMessage;
export type RuntimeWsClientMessage = WriteTagMessage | SubscribeTagsMessage;
