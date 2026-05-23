import type { EventOccurrence, EventTableObject } from "@web-scada/shared";

export function isCleared(item: EventOccurrence): boolean {
  return Boolean(item.clearedAt);
}

export function isAcknowledged(item: EventOccurrence): boolean {
  return Boolean(item.acknowledgedAt);
}

function toText(value: unknown): string {
  if (value === null || typeof value === "undefined") {
    return "";
  }
  return String(value);
}

function buildSearchText(item: EventOccurrence): string {
  return [
    item.messageTextSnapshot,
    item.sourceTagNameSnapshot,
    item.categoryNameSnapshot,
    item.eventDefinitionId,
    item.id,
  ]
    .map((candidate) => toText(candidate).trim().toLowerCase())
    .filter(Boolean)
    .join(" |");
}

export function matchesCommonEventFilters(item: EventOccurrence, object: EventTableObject): boolean {
  const categoryFilter = object.categoryFilter ?? [];
  if (categoryFilter.length > 0) {
    const category = (item.categoryNameSnapshot ?? item.categoryIdSnapshot ?? "").trim();
    if (!categoryFilter.some((candidate) => candidate.trim() === category)) {
      return false;
    }
  }

  const priorityFilter = object.priorityFilter ?? [];
  if (priorityFilter.length > 0) {
    const priority = typeof item.prioritySnapshot === "number" ? item.prioritySnapshot : null;
    if (priority === null || !priorityFilter.includes(priority)) {
      return false;
    }
  }

  const sourceFilter = object.sourceTagFilter?.trim().toLowerCase();
  if (sourceFilter) {
    const source = (item.sourceTagNameSnapshot ?? "").toLowerCase();
    if (!source.includes(sourceFilter)) {
      return false;
    }
  }

  const searchText = object.searchText?.trim().toLowerCase();
  if (searchText && !buildSearchText(item).includes(searchText)) {
    return false;
  }

  return true;
}

export function filterOnlineEventRows(rows: EventOccurrence[], object: EventTableObject): EventOccurrence[] {
  const strictActiveOnly = object.showActiveOnly === true;
  const showUnacknowledgedOnly = object.showUnacknowledgedOnly === true;
  const showClearedAcknowledged = object.showCleared === true;

  return rows.filter((item) => {
    if (!matchesCommonEventFilters(item, object)) {
      return false;
    }

    const cleared = isCleared(item);
    const acknowledged = isAcknowledged(item);

    // Strict mode explicitly hides all cleared rows.
    if (strictActiveOnly && cleared) {
      return false;
    }

    if (showUnacknowledgedOnly && acknowledged) {
      return false;
    }

    // Operator-friendly default: keep cleared-but-unacknowledged rows visible.
    if (cleared && !acknowledged) {
      return true;
    }

    // Cleared+acknowledged rows are shown only when requested.
    if (cleared && acknowledged) {
      return showClearedAcknowledged;
    }

    return true;
  });
}

function compareNullableNumbers(a: number | null, b: number | null): number {
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a - b;
}

function compareText(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

export function sortEventRows(rows: EventOccurrence[], object: EventTableObject): EventOccurrence[] {
  const direction = object.sortDirection === "asc" ? 1 : -1;
  const sortBy = object.sortBy ?? "time";

  return [...rows].sort((left, right) => {
    let result = 0;

    if (sortBy === "priority") {
      result = compareNullableNumbers(
        typeof left.prioritySnapshot === "number" ? left.prioritySnapshot : null,
        typeof right.prioritySnapshot === "number" ? right.prioritySnapshot : null,
      );
    } else if (sortBy === "category") {
      result = compareText(left.categoryNameSnapshot, right.categoryNameSnapshot);
    } else if (sortBy === "message") {
      result = compareText(left.messageTextSnapshot, right.messageTextSnapshot);
    } else if (sortBy === "sourceTagName") {
      result = compareText(left.sourceTagNameSnapshot, right.sourceTagNameSnapshot);
    } else {
      const leftTs = Date.parse(left.occurredAt);
      const rightTs = Date.parse(right.occurredAt);
      const safeLeft = Number.isFinite(leftTs) ? leftTs : 0;
      const safeRight = Number.isFinite(rightTs) ? rightTs : 0;
      result = safeLeft - safeRight;
    }

    if (result === 0) {
      result = compareText(left.id, right.id);
    }

    return result * direction;
  });
}
