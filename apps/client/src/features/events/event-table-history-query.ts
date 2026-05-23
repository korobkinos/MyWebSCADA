import type { EventHistoryQuery, EventTableObject } from "@web-scada/shared";

export type EventTableHistoryRange = {
  from?: string;
  to?: string;
  label: string;
};

function formatHistoryPreset(preset: EventTableObject["historyPeriodPreset"]): string {
  switch (preset) {
    case "lastHour":
      return "last hour";
    case "shift":
      return "shift";
    case "day":
      return "day";
    case "week":
      return "week";
    case "custom":
      return "custom";
    default:
      return "last hour";
  }
}

export function resolveEventTableHistoryRange(object: EventTableObject): EventTableHistoryRange {
  const preset = object.historyPeriodPreset ?? "lastHour";
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  let fromMs = now - hourMs;
  let toMs = now;

  if (preset === "shift") {
    fromMs = now - 8 * hourMs;
  } else if (preset === "day") {
    fromMs = now - 24 * hourMs;
  } else if (preset === "week") {
    fromMs = now - 7 * 24 * hourMs;
  } else if (preset === "custom") {
    const customFrom = typeof object.historyFrom === "number" ? object.historyFrom : NaN;
    const customTo = typeof object.historyTo === "number" ? object.historyTo : NaN;

    if (Number.isFinite(customFrom)) {
      fromMs = customFrom;
    }
    if (Number.isFinite(customTo)) {
      toMs = customTo;
    }
    if (!Number.isFinite(customFrom) && !Number.isFinite(customTo)) {
      fromMs = now - hourMs;
      toMs = now;
    }
  }

  if (toMs < fromMs) {
    const swap = fromMs;
    fromMs = toMs;
    toMs = swap;
  }

  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    label: formatHistoryPreset(preset),
  };
}

function firstNonEmptyString(values: string[] | undefined): string | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  const found = values.find((item) => item.trim().length > 0);
  return found?.trim() || undefined;
}

function firstFiniteNumber(values: number[] | undefined): number | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  const found = values.find((item) => Number.isFinite(item));
  return typeof found === "number" ? found : undefined;
}

export function hasMultiValueHistoryFilters(object: EventTableObject): boolean {
  const categoryCount = (object.categoryFilter ?? []).filter((item) => item.trim().length > 0).length;
  const priorityCount = (object.priorityFilter ?? []).filter((item) => Number.isFinite(item)).length;
  return categoryCount > 1 || priorityCount > 1;
}

export function buildEventTableHistoryQuery(args: {
  object: EventTableObject;
  page: number;
  pageSize: number;
  maxRows: number;
}): EventHistoryQuery {
  const { object, page, pageSize, maxRows } = args;
  const period = resolveEventTableHistoryRange(object);
  const serverSidePagination = object.serverSidePagination !== false;

  const query: EventHistoryQuery = {
    from: period.from,
    to: period.to,
    category: firstNonEmptyString(object.categoryFilter),
    priority: firstFiniteNumber(object.priorityFilter),
    sourceTagName: object.sourceTagFilter?.trim() || undefined,
    search: object.searchText?.trim() || undefined,
  };

  if (serverSidePagination) {
    query.limit = pageSize;
    query.offset = Math.max(0, (page - 1) * pageSize);
  } else {
    query.limit = Math.max(pageSize, Math.min(1000, maxRows));
    query.offset = 0;
  }

  return query;
}
