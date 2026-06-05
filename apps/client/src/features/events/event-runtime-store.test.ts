import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventOccurrence } from "@web-scada/shared";

function makeOccurrence(overrides: Partial<EventOccurrence> & Pick<EventOccurrence, "id">): EventOccurrence {
  return {
    ...overrides,
    id: overrides.id,
    eventDefinitionId: overrides.eventDefinitionId ?? "evt_1",
    occurredAt: overrides.occurredAt ?? "2026-05-26T10:00:00.000Z",
    state: overrides.state ?? "active",
    clearedAt: overrides.clearedAt ?? null,
    acknowledgedAt: overrides.acknowledgedAt ?? null,
  };
}

describe("eventRuntimeStore initializeOnline", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("hydrates active/unacknowledged events from backend snapshot on startup", async () => {
    const getActiveEvents = vi.fn().mockResolvedValue([
      makeOccurrence({ id: "occ_active", clearedAt: null, acknowledgedAt: null }),
      makeOccurrence({
        id: "occ_cleared_unacked",
        state: "cleared",
        clearedAt: "2026-05-26T10:05:00.000Z",
        acknowledgedAt: null,
      }),
    ]);
    const createRuntimeSocket = vi.fn(() => ({
      close: vi.fn(),
      writeTag: vi.fn(),
      subscribeTags: vi.fn(),
    }));

    vi.doMock("../../services/api", () => ({
      api: {
        getActiveEvents,
      },
    }));
    vi.doMock("../../services/ws", () => ({
      createRuntimeSocket,
    }));

    const { eventRuntimeStore } = await import("./event-runtime-store");
    await eventRuntimeStore.initializeOnline();

    const snapshot = eventRuntimeStore.getSnapshot();
    expect(createRuntimeSocket).toHaveBeenCalledTimes(1);
    expect(getActiveEvents).toHaveBeenCalledWith({
      limit: 200,
      includeClearedUnacknowledged: true,
    });
    expect(snapshot.onlineLoading).toBe(false);
    expect(snapshot.onlineError).toBeNull();
    expect(snapshot.activeEvents.map((item) => String(item.id))).toEqual(["occ_cleared_unacked", "occ_active"]);
    expect(snapshot.activeCount).toBe(1);
    expect(snapshot.unacknowledgedCount).toBe(2);
    expect(snapshot.clearedUnacknowledgedCount).toBe(1);
  });

  it("treats missing event archive as empty online snapshot and stops reload requests", async () => {
    const error = Object.assign(new Error("Event archive database is not configured"), { status: 503 });
    const getActiveEvents = vi.fn().mockRejectedValue(error);
    const createRuntimeSocket = vi.fn(() => ({
      close: vi.fn(),
      writeTag: vi.fn(),
      subscribeTags: vi.fn(),
    }));

    vi.doMock("../../services/api", () => ({
      api: {
        getActiveEvents,
      },
    }));
    vi.doMock("../../services/ws", () => ({
      createRuntimeSocket,
    }));

    const { eventRuntimeStore } = await import("./event-runtime-store");
    await eventRuntimeStore.initializeOnline();
    await eventRuntimeStore.reloadOnline(500);

    const snapshot = eventRuntimeStore.getSnapshot();
    expect(snapshot.onlineLoading).toBe(false);
    expect(snapshot.onlineError).toBeNull();
    expect(snapshot.activeEvents).toEqual([]);
    expect(getActiveEvents).toHaveBeenCalledTimes(1);
  });

  it("can start online socket without archive hydration request", async () => {
    const getActiveEvents = vi.fn();
    const createRuntimeSocket = vi.fn(() => ({
      close: vi.fn(),
      writeTag: vi.fn(),
      subscribeTags: vi.fn(),
    }));

    vi.doMock("../../services/api", () => ({
      api: {
        getActiveEvents,
      },
    }));
    vi.doMock("../../services/ws", () => ({
      createRuntimeSocket,
    }));

    const { eventRuntimeStore } = await import("./event-runtime-store");
    await eventRuntimeStore.initializeOnline({ hydrateFromArchive: false });

    const snapshot = eventRuntimeStore.getSnapshot();
    expect(createRuntimeSocket).toHaveBeenCalledTimes(1);
    expect(getActiveEvents).not.toHaveBeenCalled();
    expect(snapshot.onlineLoading).toBe(false);
    expect(snapshot.onlineError).toBeNull();
  });
});
