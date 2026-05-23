import type { EventOccurrence, EventTableObject } from "@web-scada/shared";
import type { EventTableColumnId } from "./event-table-columns";
import { isAcknowledged, isCleared } from "./event-table-filters";

export function formatEventCellDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return "-";
  }
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return "-";
  }

  return new Date(parsed).toLocaleString("ru-RU", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatStatusClockTime(timestamp: number | null): string {
  if (!timestamp) {
    return "--:--:--";
  }
  return new Date(timestamp).toLocaleTimeString("ru-RU", {
    hour12: false,
  });
}

export function formatDbSizeLabel(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  return `${value.toFixed(2)} MB`;
}

export function formatRecordCountLabel(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  return Math.max(0, Math.round(value)).toLocaleString("ru-RU");
}

export function formatEventValue(value: unknown): string {
  if (value === null || typeof value === "undefined") {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "-";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  const text = String(value).trim();
  return text || "-";
}

function getRowStateLabel(item: EventOccurrence): string {
  if (!isCleared(item)) {
    return isAcknowledged(item) ? "active (ack)" : "active";
  }
  return isAcknowledged(item) ? "cleared (ack)" : "cleared";
}

export function getOccurrenceDisplayValue(item: EventOccurrence): unknown {
  return isCleared(item) ? item.valueAtClear : item.valueAtTrigger;
}

export function getOccurrenceRowColor(item: EventOccurrence, object: EventTableObject, fallback: string): string {
  if (isCleared(item)) {
    return isAcknowledged(item)
      ? (object.acknowledgedColor ?? "#73c991")
      : (object.clearedColor ?? "#8b949e");
  }

  const priority = typeof item.prioritySnapshot === "number" ? item.prioritySnapshot : 0;
  if (priority >= 3) {
    return object.criticalColor ?? "#f48771";
  }
  if (priority >= 2) {
    return object.warningColor ?? "#e6b450";
  }
  return object.activeAlarmColor ?? fallback;
}

export function getEventCellText(column: EventTableColumnId, item: EventOccurrence): string {
  if (column === "timestamp") {
    return formatEventCellDateTime(item.occurredAt);
  }
  if (column === "priority") {
    return typeof item.prioritySnapshot === "number" ? String(item.prioritySnapshot) : "-";
  }
  if (column === "category") {
    return item.categoryNameSnapshot?.trim() || item.categoryIdSnapshot?.trim() || "-";
  }
  if (column === "message") {
    return item.messageTextSnapshot?.trim() || "-";
  }
  if (column === "source") {
    return item.sourceTagNameSnapshot?.trim() || "-";
  }
  if (column === "value") {
    return formatEventValue(getOccurrenceDisplayValue(item));
  }
  if (column === "state") {
    return getRowStateLabel(item);
  }
  if (!item.acknowledgedAt) {
    return "-";
  }
  return formatEventCellDateTime(item.acknowledgedAt);
}

export function downloadCsvFile(name: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
