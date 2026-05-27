import { describe, expect, it } from "vitest";
import type { EventOccurrence } from "@web-scada/shared";
import {
  pickLatestUnacknowledgedActiveOccurrence,
  shouldCommitOncePlayback,
  type OncePlaybackOutcome,
} from "./event-sound-replay";

function occurrence(overrides: Partial<EventOccurrence> & Pick<EventOccurrence, "id" | "occurredAt">): EventOccurrence {
  return {
    ...overrides,
    id: overrides.id,
    eventDefinitionId: overrides.eventDefinitionId ?? "evt_1",
    occurredAt: overrides.occurredAt,
    state: overrides.state ?? "active",
    clearedAt: overrides.clearedAt ?? null,
    acknowledgedAt: overrides.acknowledgedAt ?? null,
  };
}

describe("EventTableRuntimeWidget sound replay helpers", () => {
  it("commits once-mode playback only for played or skipped outcomes", () => {
    const outcomes: OncePlaybackOutcome[] = ["played", "skipped", "autoplay_blocked", "error"];
    const committed = outcomes.filter((item) => shouldCommitOncePlayback(item));
    expect(committed).toEqual(["played", "skipped"]);
  });

  it("picks latest active unacknowledged occurrence", () => {
    const picked = pickLatestUnacknowledgedActiveOccurrence([
      occurrence({ id: "occ_old", occurredAt: "2026-05-26T10:00:00.000Z", clearedAt: null, acknowledgedAt: null }),
      occurrence({ id: "occ_ack", occurredAt: "2026-05-26T10:10:00.000Z", clearedAt: null, acknowledgedAt: "2026-05-26T10:11:00.000Z" }),
      occurrence({ id: "occ_cleared", occurredAt: "2026-05-26T10:20:00.000Z", clearedAt: "2026-05-26T10:21:00.000Z", acknowledgedAt: null }),
      occurrence({ id: "occ_new", occurredAt: "2026-05-26T10:30:00.000Z", clearedAt: null, acknowledgedAt: null }),
    ]);

    expect(picked?.id).toBe("occ_new");
  });

  it("returns null when no active unacknowledged occurrences exist", () => {
    const picked = pickLatestUnacknowledgedActiveOccurrence([
      occurrence({ id: "occ_ack", occurredAt: "2026-05-26T10:10:00.000Z", clearedAt: null, acknowledgedAt: "2026-05-26T10:11:00.000Z" }),
      occurrence({ id: "occ_cleared", occurredAt: "2026-05-26T10:20:00.000Z", clearedAt: "2026-05-26T10:21:00.000Z", acknowledgedAt: null }),
    ]);

    expect(picked).toBeNull();
  });
});
