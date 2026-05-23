import type { EventSound } from "@web-scada/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { eventSoundPlayer } from "./event-sound-player";

class MockAudio {
  public static instances: MockAudio[] = [];
  public static rejectNextPlayWith: Error | null = null;
  public paused = true;
  public loop = false;
  public currentTime = 0;
  public preload = "auto";
  public muted = false;

  public constructor(public readonly src = "") {
    MockAudio.instances.push(this);
  }

  public play(): Promise<void> {
    if (MockAudio.rejectNextPlayWith) {
      const error = MockAudio.rejectNextPlayWith;
      MockAudio.rejectNextPlayWith = null;
      return Promise.reject(error);
    }
    this.paused = false;
    return Promise.resolve();
  }

  public pause(): void {
    this.paused = true;
  }
}

describe("eventSoundPlayer seamless loop", () => {
  beforeEach(() => {
    MockAudio.instances = [];
    MockAudio.rejectNextPlayWith = null;
    globalThis.Audio = MockAudio as unknown as typeof Audio;
    eventSoundPlayer.stopAllSounds();
  });

  it("starts and stops seamless loop without creating duplicate players", async () => {
    const sounds: EventSound[] = [
      { id: "sound_case1_1", name: "Sound 1", url: "/sound-case1-1.mp3", enabled: true },
      { id: "sound_case1_2", name: "Sound 2", url: "/sound-case1-2.mp3", enabled: true },
    ];
    const started = await eventSoundPlayer.startSeamlessLoop("sound_case1_1", sounds);
    expect(started.ok).toBe(true);
    expect(eventSoundPlayer.getCurrentSoundId()).toBe("sound_case1_1");
    expect(eventSoundPlayer.isSeamlessLoopActive()).toBe(true);

    const restarted = await eventSoundPlayer.startSeamlessLoop("sound_case1_1", sounds);
    expect(restarted.ok).toBe(true);
    expect(MockAudio.instances.length).toBe(1);

    eventSoundPlayer.stopSeamlessLoop();
    expect(eventSoundPlayer.getCurrentSoundId()).toBeNull();
    expect(eventSoundPlayer.isSeamlessLoopActive()).toBe(false);
  });

  it("switches loop sound without overlap", async () => {
    const sounds: EventSound[] = [
      { id: "sound_case2_1", name: "Sound 1", url: "/sound-case2-1.mp3", enabled: true },
      { id: "sound_case2_2", name: "Sound 2", url: "/sound-case2-2.mp3", enabled: true },
    ];
    await eventSoundPlayer.startSeamlessLoop("sound_case2_1", sounds);
    const first = MockAudio.instances[0];
    expect(first?.paused).toBe(false);

    await eventSoundPlayer.startSeamlessLoop("sound_case2_2", sounds);
    const second = MockAudio.instances.find((item) => item.src === "/sound-case2-2.mp3");
    expect(eventSoundPlayer.getCurrentSoundId()).toBe("sound_case2_2");
    expect(first?.paused).toBe(true);
    expect(second?.paused).toBe(false);
  });
});
