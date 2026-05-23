import type { EventSound } from "./event-types";

const DEFAULT_EVENT_SOUND_IDS = {
  notification: "default_notification",
  warning: "default_warning",
  alarm: "default_alarm",
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

function createDefaultEventSounds(timestamp: string): EventSound[] {
  return [
    {
      id: DEFAULT_EVENT_SOUND_IDS.notification,
      name: "Notification",
      kind: "notification",
      fileName: "TODO_notification_placeholder.mp3",
      mimeType: "audio/mpeg",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: DEFAULT_EVENT_SOUND_IDS.warning,
      name: "Warning",
      kind: "warning",
      fileName: "TODO_warning_placeholder.mp3",
      mimeType: "audio/mpeg",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: DEFAULT_EVENT_SOUND_IDS.alarm,
      name: "Alarm",
      kind: "alarm",
      fileName: "TODO_alarm_placeholder.mp3",
      mimeType: "audio/mpeg",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

export function ensureDefaultEventSounds(sounds: EventSound[] | undefined, timestamp: string = nowIso()): EventSound[] {
  if (Array.isArray(sounds) && sounds.length > 0) {
    return sounds;
  }
  // TODO: replace placeholders with real bundled default audio files when they are added to the repository.
  return createDefaultEventSounds(timestamp);
}

export function isDefaultEventSoundId(soundId: string): boolean {
  return Object.values(DEFAULT_EVENT_SOUND_IDS).includes(soundId as (typeof DEFAULT_EVENT_SOUND_IDS)[keyof typeof DEFAULT_EVENT_SOUND_IDS]);
}

export { DEFAULT_EVENT_SOUND_IDS };
