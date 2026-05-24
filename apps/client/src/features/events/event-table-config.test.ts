import type { EventOccurrence, EventSound, EventTableObject } from "@web-scada/shared";
import { describe, expect, it } from "vitest";
import { resolveEventOccurrenceSoundId, resolveEventTableConfig } from "./event-table-config";

function makeObject(patch: Partial<EventTableObject> = {}): EventTableObject {
  return {
    id: "evt_1",
    type: "eventTable",
    x: 0,
    y: 0,
    width: 300,
    height: 220,
    ...patch,
  };
}

function makeOccurrence(patch: Partial<EventOccurrence> = {}): EventOccurrence {
  return {
    id: "occ_1",
    eventDefinitionId: "evt_def_1",
    occurredAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    state: "active",
    ...patch,
  };
}

describe("resolveEventTableConfig", () => {
  it("maps legacy toolbar fields to new runtime flags", () => {
    const object = makeObject({
      enableSearchInToolbar: false,
      enableActiveOnlyToggle: false,
      enableUnackedOnlyToggle: true,
      enableAckButton: false,
      enableSilenceButton: true,
      enableSoundsButton: false,
      enableCsvExportButton: true,
    });

    const resolved = resolveEventTableConfig(object);
    expect(resolved.showSearch).toBe(false);
    expect(resolved.showActiveOnlyToggle).toBe(false);
    expect(resolved.showUnackedOnlyToggle).toBe(true);
    expect(resolved.showAckVisibleButton).toBe(false);
    expect(resolved.showSilenceButton).toBe(true);
    expect(resolved.showSoundMuteButton).toBe(true);
    expect(resolved.showEnableSoundsButton).toBe(false);
    expect(resolved.showCsvExportButton).toBe(true);
  });

  it("applies safe defaults for title/status/sound and legacy title visibility", () => {
    const hidden = resolveEventTableConfig(makeObject({ showTitle: false }));
    expect(hidden.titlePosition).toBe("hidden");
    expect(hidden.statusSingleLine).toBe(true);
    expect(hidden.soundPlaybackMode).toBe("once");
    expect(hidden.soundRepeatIntervalMs).toBe(5000);
    expect(hidden.stopSoundOnAck).toBe(true);
    expect(hidden.stopSoundOnSilence).toBe(true);
    expect(hidden.soundMuteMode).toBe("silenceCurrent");
    expect(hidden.settingsRequiredRole).toBeUndefined();
  });

  it("prefers explicit sound mute toggle field and keeps legacy aliases working", () => {
    const explicitOff = resolveEventTableConfig(makeObject({
      showSoundMuteButton: false,
      showSilenceButton: true,
      enableSilenceButton: true,
    }));
    expect(explicitOff.showSoundMuteButton).toBe(false);

    const legacy = resolveEventTableConfig(makeObject({
      showSilenceButton: false,
      enableSilenceButton: true,
    }));
    expect(legacy.showSoundMuteButton).toBe(false);
  });

  it("normalizes sound mute mode and settings required role", () => {
    const resolved = resolveEventTableConfig(makeObject({
      soundMuteMode: "disableUntilEnabled",
      settingsRequiredRole: 3,
    }));
    expect(resolved.soundMuteMode).toBe("disableUntilEnabled");
    expect(resolved.settingsRequiredRole).toBe(3);
  });

  it("defaults operator actions toggle to toolbar visibility unless overridden", () => {
    const visibleToolbar = resolveEventTableConfig(makeObject({ showToolbar: true, toolbarPosition: "top" }));
    expect(visibleToolbar.showOperatorActionsToggle).toBe(true);

    const hiddenToolbar = resolveEventTableConfig(makeObject({ showToolbar: false }));
    expect(hiddenToolbar.showOperatorActionsToggle).toBe(false);

    const explicitOff = resolveEventTableConfig(makeObject({ showToolbar: true, showOperatorActionsToggle: false }));
    expect(explicitOff.showOperatorActionsToggle).toBe(false);
  });
});

describe("resolveEventOccurrenceSoundId", () => {
  const sounds: EventSound[] = [
    { id: "snd_n", name: "n", kind: "notification", enabled: true },
    { id: "snd_w", name: "w", kind: "warning", enabled: true },
    { id: "snd_a", name: "a", kind: "alarm", enabled: true },
  ];

  it("uses direct occurrence sound id when present", () => {
    const soundId = resolveEventOccurrenceSoundId(
      makeOccurrence({ soundId: "direct_1", prioritySnapshot: 3 }),
      makeObject(),
      sounds,
    );
    expect(soundId).toBe("direct_1");
  });

  it("uses configured fallback ids by priority before catalog defaults", () => {
    const object = makeObject({
      fallbackAlarmSoundId: "snd_a",
      fallbackWarningSoundId: "snd_w",
      fallbackNotificationSoundId: "snd_n",
    });
    expect(resolveEventOccurrenceSoundId(makeOccurrence({ prioritySnapshot: 3 }), object, sounds)).toBe("snd_a");
    expect(resolveEventOccurrenceSoundId(makeOccurrence({ prioritySnapshot: 2 }), object, sounds)).toBe("snd_w");
    expect(resolveEventOccurrenceSoundId(makeOccurrence({ prioritySnapshot: 1 }), object, sounds)).toBe("snd_n");
  });

  it("returns undefined when fallback is disabled and no direct sound id exists", () => {
    const object = makeObject({ enableSoundFallbackByPriority: false });
    const soundId = resolveEventOccurrenceSoundId(makeOccurrence({ prioritySnapshot: 3 }), object, sounds);
    expect(soundId).toBeUndefined();
  });
});
