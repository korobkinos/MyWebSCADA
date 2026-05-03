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
  };
};

export type RuntimeWsServerMessage = TagUpdateMessage | TagBatchUpdateMessage;
export type RuntimeWsClientMessage = WriteTagMessage;
