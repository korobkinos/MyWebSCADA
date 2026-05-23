export type EventTableColumnId = "timestamp" | "priority" | "category" | "message" | "source" | "value" | "state" | "ack";

export const DEFAULT_EVENT_TABLE_COLUMNS: EventTableColumnId[] = [
  "timestamp",
  "priority",
  "category",
  "message",
  "source",
  "value",
  "state",
  "ack",
];

export const DEFAULT_EVENT_TABLE_COLUMN_LABELS: Record<EventTableColumnId, string> = {
  timestamp: "Timestamp",
  priority: "Priority",
  category: "Category",
  message: "Message",
  source: "Source",
  value: "Value",
  state: "State",
  ack: "Ack",
};

const LEGACY_COLUMN_MAP: Record<string, EventTableColumnId> = {
  time: "timestamp",
  occurredAt: "timestamp",
  date: "timestamp",
  pri: "priority",
  prioritySnapshot: "priority",
  categoryName: "category",
  cat: "category",
  msg: "message",
  text: "message",
  sourceTagName: "source",
  sourceTagNameSnapshot: "source",
  tag: "source",
  status: "state",
  acknowledged: "ack",
  acknowledgedAt: "ack",
};

export function normalizeEventTableColumns(columns: string[] | undefined): EventTableColumnId[] {
  const input = columns && columns.length > 0 ? columns : DEFAULT_EVENT_TABLE_COLUMNS;
  const normalized: EventTableColumnId[] = [];

  for (const raw of input) {
    const candidate = (raw ?? "").trim();
    if (!candidate) {
      continue;
    }

    const mapped = (DEFAULT_EVENT_TABLE_COLUMN_LABELS as Record<string, string>)[candidate]
      ? (candidate as EventTableColumnId)
      : LEGACY_COLUMN_MAP[candidate];

    if (!mapped || normalized.includes(mapped)) {
      continue;
    }
    normalized.push(mapped);
  }

  return normalized.length > 0 ? normalized.slice(0, 12) : [...DEFAULT_EVENT_TABLE_COLUMNS];
}
