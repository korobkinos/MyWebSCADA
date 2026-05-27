import type { EventOccurrence } from "@web-scada/shared";

export type OncePlaybackOutcome = "played" | "autoplay_blocked" | "skipped" | "error";

function normalizeOccurrenceId(input: Pick<EventOccurrence, "id">): string {
  return String(input.id ?? "").trim();
}

export function shouldCommitOncePlayback(outcome: OncePlaybackOutcome): boolean {
  return outcome === "played" || outcome === "skipped";
}

export function pickLatestUnacknowledgedActiveOccurrence(items: EventOccurrence[]): EventOccurrence | null {
  const candidates = items.filter((item) => !item.acknowledgedAt && !item.clearedAt);
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => {
    const diff = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    if (diff !== 0) {
      return diff;
    }
    return normalizeOccurrenceId(b).localeCompare(normalizeOccurrenceId(a));
  });
  return candidates[0] ?? null;
}

