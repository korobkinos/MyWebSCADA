import type { EventSound } from "@web-scada/shared";

type PlaybackFailureReason = "missing_sound" | "missing_url" | "load_failed" | "autoplay_blocked" | "unknown";

export type PlaybackResult =
  | { ok: true }
  | { ok: false; reason: PlaybackFailureReason; message: string };

type CachedEntry = {
  audio: HTMLAudioElement;
  sourceUrl: string;
};

function resolveSoundUrl(sound: EventSound | undefined): string | undefined {
  if (!sound) {
    return undefined;
  }
  const directUrl = sound.url?.trim();
  if (directUrl) {
    return directUrl;
  }
  const fromAsset = sound.assetId?.trim();
  if (fromAsset) {
    return `/api/assets/${encodeURIComponent(fromAsset)}/file`;
  }
  const fromPath = sound.filePath?.trim();
  if (fromPath) {
    return fromPath.startsWith("/") ? fromPath : `/${fromPath}`;
  }
  return undefined;
}

class EventSoundPlayer {
  private readonly cache = new Map<string, CachedEntry>();
  private currentSoundId: string | null = null;
  private userGestureUnlocked = false;
  private blockedByAutoplay = false;

  public hasAutoplayBlock(): boolean {
    return this.blockedByAutoplay;
  }

  public getCurrentSoundId(): string | null {
    return this.currentSoundId;
  }

  public async enableSoundsWithUserGesture(): Promise<PlaybackResult> {
    if (typeof window === "undefined") {
      return { ok: false, reason: "unknown", message: "Window is not available." };
    }
    const probe = new Audio();
    probe.muted = true;
    probe.preload = "auto";
    try {
      await probe.play();
      probe.pause();
      this.userGestureUnlocked = true;
      this.blockedByAutoplay = false;
      return { ok: true };
    } catch (error) {
      this.blockedByAutoplay = true;
      const text = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: "autoplay_blocked",
        message: text || "Sound playback was blocked by the browser. Click Enable sounds.",
      };
    }
  }

  public preload(soundId: string, sounds: EventSound[]): PlaybackResult {
    if (!soundId) {
      return { ok: false, reason: "missing_sound", message: "Sound is not selected." };
    }
    const sound = sounds.find((item) => item.id === soundId);
    if (!sound) {
      return { ok: false, reason: "missing_sound", message: `Sound '${soundId}' was not found.` };
    }
    const url = resolveSoundUrl(sound);
    if (!url) {
      return { ok: false, reason: "missing_url", message: `Sound '${sound.name}' does not have a playable file yet.` };
    }

    const cached = this.cache.get(soundId);
    if (cached && cached.sourceUrl === url) {
      return { ok: true };
    }

    return this.preloadByUrl(soundId, url);
  }

  public preloadByUrl(cacheKey: string, url: string): PlaybackResult {
    if (!cacheKey.trim()) {
      return { ok: false, reason: "unknown", message: "Sound cache key is required." };
    }
    const targetUrl = url.trim();
    if (!targetUrl) {
      return { ok: false, reason: "missing_url", message: "Sound URL is empty." };
    }
    const cached = this.cache.get(cacheKey);
    if (cached && cached.sourceUrl === targetUrl) {
      return { ok: true };
    }
    const audio = new Audio(targetUrl);
    audio.preload = "auto";
    this.cache.set(cacheKey, { audio, sourceUrl: targetUrl });
    return { ok: true };
  }

  public async playSound(soundId: string, sounds: EventSound[]): Promise<PlaybackResult> {
    const preloadResult = this.preload(soundId, sounds);
    if (!preloadResult.ok) {
      return preloadResult;
    }
    const cached = this.cache.get(soundId);
    if (!cached) {
      return { ok: false, reason: "unknown", message: "Sound cache is unavailable." };
    }
    this.stopCurrentSound();
    this.currentSoundId = soundId;
    cached.audio.currentTime = 0;
    try {
      await cached.audio.play();
      this.blockedByAutoplay = false;
      return { ok: true };
    } catch (error) {
      this.currentSoundId = null;
      const text = error instanceof Error ? error.message : String(error);
      const blocked = !this.userGestureUnlocked || /notallowederror/i.test(text);
      if (blocked) {
        this.blockedByAutoplay = true;
        return {
          ok: false,
          reason: "autoplay_blocked",
          message: "Sound playback was blocked by the browser. Click Enable sounds.",
        };
      }
      return {
        ok: false,
        reason: "load_failed",
        message: text || "Failed to play the selected sound.",
      };
    }
  }

  public stopCurrentSound(): void {
    if (!this.currentSoundId) {
      return;
    }
    const cached = this.cache.get(this.currentSoundId);
    if (cached) {
      cached.audio.pause();
      cached.audio.currentTime = 0;
    }
    this.currentSoundId = null;
  }

  public stopAllSounds(): void {
    this.stopCurrentSound();
    for (const cached of this.cache.values()) {
      cached.audio.pause();
      cached.audio.currentTime = 0;
    }
  }
}

export const eventSoundPlayer = new EventSoundPlayer();
