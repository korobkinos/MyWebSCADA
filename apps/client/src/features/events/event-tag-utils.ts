import type { EventDefinition, ScadaProject, TagDefinition } from "@web-scada/shared";

export type EventTagReferenceField =
  | "sourceTagName"
  | "securityTagName"
  | "ackTagName"
  | "notificationTagName"
  | "elapsedTimeTagName";

export type EventTagWarning = {
  field: EventTagReferenceField;
  message: string;
  tagName: string;
  code:
    | "missing_source"
    | "missing_security"
    | "missing_reference"
    | "source_type_bool_warning"
    | "source_type_numeric_warning";
};

export type EventTagAudit = {
  eventIndex: number;
  eventId: string;
  warnings: EventTagWarning[];
};

const NUMERIC_DATA_TYPES = new Set<TagDefinition["dataType"]>(["INT", "UINT", "DINT", "UDINT", "REAL"]);

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTagName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEventId(value: unknown, index: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || `row_${index + 1}`;
}

export function getProjectTags(project: Pick<ScadaProject, "tags">): TagDefinition[] {
  return project.tags ?? [];
}

export function createProjectTagIndex(project: Pick<ScadaProject, "tags">): Map<string, TagDefinition> {
  const index = new Map<string, TagDefinition>();
  for (const tag of getProjectTags(project)) {
    const name = normalizeTagName(tag.name);
    if (!name) {
      continue;
    }
    index.set(name, tag);
  }
  return index;
}

export function tagExists(project: Pick<ScadaProject, "tags">, tagName: string): boolean {
  return createProjectTagIndex(project).has(normalizeTagName(tagName));
}

export function getEventTagWarnings(
  event: EventDefinition,
  tagIndex: Map<string, TagDefinition>,
): EventTagWarning[] {
  const warnings: EventTagWarning[] = [];

  const sourceTagName = normalizeTagName(event.sourceTagName);
  const sourceTag = sourceTagName ? tagIndex.get(sourceTagName) : undefined;
  if (sourceTagName && !sourceTag) {
    warnings.push({
      field: "sourceTagName",
      tagName: sourceTagName,
      code: "missing_source",
      message: event.enabled === false
        ? "Source tag is missing. Event was disabled."
        : "Source tag is missing.",
    });
  }

  const securityTagName = normalizeTagName(event.securityTagName);
  const securityTag = securityTagName ? tagIndex.get(securityTagName) : undefined;
  if (event.securityEnabled && securityTagName && !securityTag) {
    warnings.push({
      field: "securityTagName",
      tagName: securityTagName,
      code: "missing_security",
      message: event.enabled === false
        ? "Security tag is missing. Event was disabled."
        : "Security tag is missing.",
    });
  }

  const passiveFields: EventTagReferenceField[] = ["ackTagName", "notificationTagName", "elapsedTimeTagName"];
  for (const field of passiveFields) {
    const tagName = normalizeTagName(event[field]);
    if (!tagName) {
      continue;
    }
    if (!tagIndex.has(tagName)) {
      warnings.push({
        field,
        tagName,
        code: "missing_reference",
        message: "Referenced tag is missing.",
      });
    }
  }

  if (sourceTag && event.conditionMode === "bit" && sourceTag.dataType !== "BOOL") {
    warnings.push({
      field: "sourceTagName",
      tagName: sourceTagName,
      code: "source_type_bool_warning",
      message: "Bit mode usually expects a BOOL source tag.",
    });
  }

  if (sourceTag && event.conditionMode === "word" && !NUMERIC_DATA_TYPES.has(sourceTag.dataType)) {
    warnings.push({
      field: "sourceTagName",
      tagName: sourceTagName,
      code: "source_type_numeric_warning",
      message: "Word mode usually expects a numeric source tag.",
    });
  }

  return warnings;
}

export function findMissingEventTagReferences(project: Pick<ScadaProject, "events" | "tags">): EventTagAudit[] {
  const tagIndex = createProjectTagIndex(project);
  const audits: EventTagAudit[] = [];

  for (const [index, event] of (project.events ?? []).entries()) {
    const warnings = getEventTagWarnings(event, tagIndex).filter((item) =>
      item.code === "missing_source" || item.code === "missing_security" || item.code === "missing_reference",
    );
    if (warnings.length === 0) {
      continue;
    }
    audits.push({
      eventIndex: index,
      eventId: normalizeEventId(event.id, index),
      warnings,
    });
  }

  return audits;
}

export type ReconcileEventsResult = {
  nextEvents: EventDefinition[];
  changed: boolean;
  affectedEventCount: number;
  disabledBySourceCount: number;
  disabledBySecurityCount: number;
};

function reconcileEventsInternal(
  events: EventDefinition[],
  missingSourceTags: Set<string>,
  missingSecurityTags: Set<string>,
): ReconcileEventsResult {
  let changed = false;
  let affectedEventCount = 0;
  let disabledBySourceCount = 0;
  let disabledBySecurityCount = 0;

  const nextEvents = events.map((event) => {
    const sourceTagName = normalizeTagName(event.sourceTagName);
    const securityTagName = normalizeTagName(event.securityTagName);

    const missingSource = sourceTagName && missingSourceTags.has(sourceTagName);
    const missingSecurity = Boolean(event.securityEnabled && securityTagName && missingSecurityTags.has(securityTagName));

    if (!missingSource && !missingSecurity) {
      return event;
    }

    affectedEventCount += 1;
    if (missingSource) {
      disabledBySourceCount += 1;
    }
    if (missingSecurity) {
      disabledBySecurityCount += 1;
    }

    const nextEvent: EventDefinition = {
      ...event,
      enabled: false,
      updatedAt: nowIso(),
    };

    if (
      nextEvent.enabled !== event.enabled
      || nextEvent.updatedAt !== event.updatedAt
    ) {
      changed = true;
      return nextEvent;
    }

    return event;
  });

  return {
    nextEvents,
    changed,
    affectedEventCount,
    disabledBySourceCount,
    disabledBySecurityCount,
  };
}

export function reconcileEventsAfterTagDeletion(
  project: ScadaProject,
  deletedTagNames: Iterable<string>,
): {
  project: ScadaProject;
  changed: boolean;
  affectedEventCount: number;
  disabledBySourceCount: number;
  disabledBySecurityCount: number;
} {
  const deletedNames = [...deletedTagNames]
    .map((name) => normalizeTagName(name))
    .filter(Boolean);
  if (deletedNames.length === 0) {
    return {
      project,
      changed: false,
      affectedEventCount: 0,
      disabledBySourceCount: 0,
      disabledBySecurityCount: 0,
    };
  }

  const deletedSet = new Set(deletedNames);
  const result = reconcileEventsInternal(project.events ?? [], deletedSet, deletedSet);
  if (!result.changed) {
    return {
      project,
      changed: false,
      affectedEventCount: result.affectedEventCount,
      disabledBySourceCount: result.disabledBySourceCount,
      disabledBySecurityCount: result.disabledBySecurityCount,
    };
  }

  return {
    project: {
      ...project,
      events: result.nextEvents,
    },
    changed: true,
    affectedEventCount: result.affectedEventCount,
    disabledBySourceCount: result.disabledBySourceCount,
    disabledBySecurityCount: result.disabledBySecurityCount,
  };
}

export function reconcileEventsWithProjectTags(
  events: EventDefinition[],
  project: Pick<ScadaProject, "tags">,
): ReconcileEventsResult {
  const tagNames = new Set(getProjectTags(project).map((tag) => normalizeTagName(tag.name)).filter(Boolean));
  const missingSource = new Set<string>();
  const missingSecurity = new Set<string>();

  for (const event of events) {
    const source = normalizeTagName(event.sourceTagName);
    if (source && !tagNames.has(source)) {
      missingSource.add(source);
    }

    const security = normalizeTagName(event.securityTagName);
    if (event.securityEnabled && security && !tagNames.has(security)) {
      missingSecurity.add(security);
    }
  }

  return reconcileEventsInternal(events, missingSource, missingSecurity);
}
