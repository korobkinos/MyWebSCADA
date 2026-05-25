import type { EventSound } from "./event-types";

const DEFAULT_EVENT_SOUND_IDS = {
  alarmInfo: "default_notification",
  alarmWarning: "default_warning",
  alarmCritical: "default_alarm",
  beepShort: "default_beep_short",
  beepDouble: "default_beep_double",
  sirenAttention: "default_siren_attention",
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

function createDefaultEventSounds(timestamp: string): EventSound[] {
  return [
    {
      id: DEFAULT_EVENT_SOUND_IDS.alarmCritical,
      name: "Alarm critical",
      kind: "alarm",
      fileName: "alarm-critical.wav",
      mimeType: "audio/wav",
      url: "/sounds/alarm-critical.wav",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: DEFAULT_EVENT_SOUND_IDS.alarmWarning,
      name: "Alarm warning",
      kind: "warning",
      fileName: "alarm-warning.wav",
      mimeType: "audio/wav",
      url: "/sounds/alarm-warning.wav",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: DEFAULT_EVENT_SOUND_IDS.alarmInfo,
      name: "Alarm info",
      kind: "notification",
      fileName: "alarm-info.wav",
      mimeType: "audio/wav",
      url: "/sounds/alarm-info.wav",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: DEFAULT_EVENT_SOUND_IDS.beepShort,
      name: "Beep short",
      kind: "notification",
      fileName: "beep-short.wav",
      mimeType: "audio/wav",
      url: "/sounds/beep-short.wav",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: DEFAULT_EVENT_SOUND_IDS.beepDouble,
      name: "Beep double",
      kind: "notification",
      fileName: "beep-double.wav",
      mimeType: "audio/wav",
      url: "/sounds/beep-double.wav",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: DEFAULT_EVENT_SOUND_IDS.sirenAttention,
      name: "Siren attention",
      kind: "alarm",
      fileName: "siren-attention.wav",
      mimeType: "audio/wav",
      url: "/sounds/siren-attention.wav",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

export function ensureDefaultEventSounds(
  sounds: EventSound[] | undefined,
  timestamp: string = nowIso(),
): EventSound[] {
  const defaults = createDefaultEventSounds(timestamp);
  if (!Array.isArray(sounds) || sounds.length === 0) {
    return defaults;
  }

  const defaultById = new Map(defaults.map((sound) => [sound.id, sound]));
  const merged = sounds.map((sound) => {
    const fallback = defaultById.get(sound.id);
    if (!fallback) {
      return sound;
    }
    return {
      ...fallback,
      ...sound,
      url: sound.url?.trim() || fallback.url,
      fileName: sound.fileName?.trim() || fallback.fileName,
      mimeType: sound.mimeType?.trim() || fallback.mimeType,
    };
  });

  const existingIds = new Set(merged.map((sound) => sound.id));
  for (const fallback of defaults) {
    if (!existingIds.has(fallback.id)) {
      merged.push(fallback);
    }
  }

  return merged;
}

export function isDefaultEventSoundId(soundId: string): boolean {
  return Object.values(DEFAULT_EVENT_SOUND_IDS).includes(
    soundId as (typeof DEFAULT_EVENT_SOUND_IDS)[keyof typeof DEFAULT_EVENT_SOUND_IDS],
  );
}

export { DEFAULT_EVENT_SOUND_IDS };
