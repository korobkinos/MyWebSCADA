import type { EventOccurrence, EventSound, EventTableObject } from "@web-scada/shared";
import { ensureDefaultEventSounds } from "@web-scada/shared";
import {
  DEFAULT_EVENT_TABLE_COLUMNS,
  type EventTableColumnId,
  normalizeEventTableColumns,
} from "./event-table-columns";

export type EventTableColumnAlign = "left" | "center" | "right";
export type EventTableSoundPlaybackMode = "once" | "loopUntilAcknowledged";

export type ResolvedEventTableConfig = {
  titlePosition: "top" | "bottom" | "hidden";
  titleAlign: "left" | "center" | "right";
  toolbarPosition: "top" | "bottom" | "hidden";
  showToolbar: boolean;
  showSearch: boolean;
  showActiveOnlyToggle: boolean;
  showUnackedOnlyToggle: boolean;
  showOperatorActionsToggle: boolean;
  showAckVisibleButton: boolean;
  showSilenceButton: boolean;
  showEnableSoundsButton: boolean;
  showSettingsButton: boolean;
  showCsvExportButton: boolean;
  statusSingleLine: boolean;
  soundPlaybackMode: EventTableSoundPlaybackMode;
  soundRepeatIntervalMs: number;
  stopSoundOnAck: boolean;
  stopSoundOnSilence: boolean;
  enableSoundFallbackByPriority: boolean;
  fallbackNotificationSoundId?: string;
  fallbackWarningSoundId?: string;
  fallbackAlarmSoundId?: string;
  cellPadding: number;
  columns: EventTableColumnId[];
  columnAlignments: Record<string, EventTableColumnAlign>;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveToggle(
  directValue: boolean | undefined,
  legacyEnabledValue: boolean | undefined,
  defaultValue: boolean,
): boolean {
  if (typeof directValue === "boolean") {
    return directValue;
  }
  if (typeof legacyEnabledValue === "boolean") {
    return legacyEnabledValue;
  }
  return defaultValue;
}

function resolveColumnAlign(raw: unknown, fallback: EventTableColumnAlign): EventTableColumnAlign {
  if (raw === "left" || raw === "center" || raw === "right") {
    return raw;
  }
  return fallback;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function resolveEventTableConfig(object: EventTableObject): ResolvedEventTableConfig {
  const columns = normalizeEventTableColumns(object.columns);
  const titlePosition = object.titlePosition ?? (object.showTitle === false ? "hidden" : "top");
  const toolbarPosition = object.toolbarPosition ?? (object.showToolbar === false ? "hidden" : "top");
  const showToolbar = object.showToolbar !== false && toolbarPosition !== "hidden";
  const showOperatorActionsToggle = typeof object.showOperatorActionsToggle === "boolean"
    ? object.showOperatorActionsToggle
    : showToolbar;

  const columnAlignments: Record<string, EventTableColumnAlign> = {};
  const fallbackAlign = resolveColumnAlign(object.cellTextAlign, "left");
  for (const column of DEFAULT_EVENT_TABLE_COLUMNS) {
    columnAlignments[column] = resolveColumnAlign(object.columnAlignments?.[column], fallbackAlign);
  }

  return {
    titlePosition,
    titleAlign: object.titleAlign ?? "left",
    toolbarPosition,
    showToolbar,
    showSearch: resolveToggle(object.showSearch, object.enableSearchInToolbar, true),
    showActiveOnlyToggle: resolveToggle(object.showActiveOnlyToggle, object.enableActiveOnlyToggle, true),
    showUnackedOnlyToggle: resolveToggle(object.showUnackedOnlyToggle, object.enableUnackedOnlyToggle, true),
    showOperatorActionsToggle,
    showAckVisibleButton: resolveToggle(object.showAckVisibleButton, object.enableAckButton, true),
    showSilenceButton: resolveToggle(object.showSilenceButton, object.enableSilenceButton, true),
    showEnableSoundsButton: resolveToggle(object.showEnableSoundsButton, object.enableSoundsButton, true),
    showSettingsButton: resolveToggle(object.showSettingsButton, undefined, true),
    showCsvExportButton: resolveToggle(object.showCsvExportButton, object.enableCsvExportButton, true),
    statusSingleLine: object.statusSingleLine !== false,
    soundPlaybackMode: object.soundPlaybackMode === "loopUntilAcknowledged" ? "loopUntilAcknowledged" : "once",
    soundRepeatIntervalMs: clamp(Math.round(toFiniteNumber(object.soundRepeatIntervalMs, 5000)), 1000, 60000),
    stopSoundOnAck: object.stopSoundOnAck !== false,
    stopSoundOnSilence: object.stopSoundOnSilence !== false,
    enableSoundFallbackByPriority: object.enableSoundFallbackByPriority !== false,
    fallbackNotificationSoundId: trimOrUndefined(object.fallbackNotificationSoundId),
    fallbackWarningSoundId: trimOrUndefined(object.fallbackWarningSoundId),
    fallbackAlarmSoundId: trimOrUndefined(object.fallbackAlarmSoundId),
    cellPadding: clamp(Math.round(toFiniteNumber(object.cellPadding, 8)), 2, 24),
    columns,
    columnAlignments,
  };
}

function getPrioritySoundKind(priority: number | null | undefined): EventSound["kind"] {
  if (priority === 2) {
    return "warning";
  }
  if (priority === 3) {
    return "alarm";
  }
  return "notification";
}

function resolveFromOccurrence(occurrence: EventOccurrence): string | undefined {
  const direct = trimOrUndefined(occurrence.soundId);
  if (direct) {
    return direct;
  }
  const fromServiceData = trimOrUndefined(occurrence.serviceData?.soundId);
  if (fromServiceData) {
    return fromServiceData;
  }
  return undefined;
}

export function resolveEventOccurrenceSoundId(
  occurrence: EventOccurrence,
  object: EventTableObject,
  soundsInput: EventSound[],
): string | undefined {
  const direct = resolveFromOccurrence(occurrence);
  if (direct) {
    return direct;
  }
  const config = resolveEventTableConfig(object);
  if (!config.enableSoundFallbackByPriority) {
    return undefined;
  }
  const sounds = ensureDefaultEventSounds(soundsInput ?? []);
  const kind = getPrioritySoundKind(occurrence.prioritySnapshot ?? null);

  const configuredId = kind === "alarm"
    ? config.fallbackAlarmSoundId
    : kind === "warning"
      ? config.fallbackWarningSoundId
      : config.fallbackNotificationSoundId;
  if (configuredId) {
    const configured = sounds.find((item) => item.id === configuredId && item.enabled !== false);
    if (configured?.id?.trim()) {
      return configured.id.trim();
    }
  }

  const fallback = sounds.find((item) => item.kind === kind && item.enabled !== false);
  return trimOrUndefined(fallback?.id);
}
