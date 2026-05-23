import { describe, expect, it } from "vitest";
import type { EventOccurrence, RuntimeAction, ScadaProject, TagDefinition } from "@web-scada/shared";
import { TagStore } from "../tags/tag-store.js";
import { EventEngine } from "./event-engine.js";

type BroadcastItem = {
  kind: "active" | "cleared" | "acknowledged";
  occurrence: EventOccurrence;
  actionsToRun?: RuntimeAction[];
  actionTrigger?: "active" | "cleared" | "ack";
};

class InMemoryArchiveService {
  private readonly occurrences = new Map<string, EventOccurrence>();
  private nextId = 1;
  private hydratedActive: EventOccurrence[] = [];

  public isEnabled(): boolean {
    return true;
  }

  public setHydratedActive(items: EventOccurrence[]): void {
    this.hydratedActive = items;
    for (const item of items) {
      this.occurrences.set(item.id, item);
    }
  }

  public async listActiveEvents(): Promise<EventOccurrence[]> {
    return this.hydratedActive.slice();
  }

  public async createEventOccurrence(input: {
    eventDefinitionId: string;
    occurredAt: Date;
    clearedAt?: Date | null;
    acknowledgedAt?: Date | null;
    acknowledgedBy?: string | null;
    state: "active" | "cleared" | "acknowledged";
    sourceTagNameSnapshot?: string | null;
    categoryIdSnapshot?: string | null;
    categoryNameSnapshot?: string | null;
    prioritySnapshot?: number | null;
    messageTextSnapshot?: string | null;
    valueAtTrigger?: boolean | number | string | null;
    valueAtClear?: boolean | number | string | null;
    quality?: string | null;
    runtimeSource?: string | null;
    serviceData?: Record<string, unknown> | null;
  }): Promise<EventOccurrence> {
    const id = `occ_${this.nextId++}`;
    const created: EventOccurrence = {
      id,
      eventDefinitionId: input.eventDefinitionId,
      occurredAt: input.occurredAt.toISOString(),
      clearedAt: input.clearedAt ? input.clearedAt.toISOString() : null,
      acknowledgedAt: input.acknowledgedAt ? input.acknowledgedAt.toISOString() : null,
      acknowledgedBy: input.acknowledgedBy ?? null,
      state: input.state,
      sourceTagNameSnapshot: input.sourceTagNameSnapshot ?? null,
      categoryIdSnapshot: input.categoryIdSnapshot ?? null,
      categoryNameSnapshot: input.categoryNameSnapshot ?? null,
      prioritySnapshot: input.prioritySnapshot ?? null,
      messageTextSnapshot: input.messageTextSnapshot ?? null,
      valueAtTrigger: input.valueAtTrigger,
      valueAtClear: input.valueAtClear,
      quality: input.quality ?? null,
      runtimeSource: input.runtimeSource ?? null,
      serviceData: input.serviceData ?? null,
      requireAck: false,
      createdAt: input.occurredAt.toISOString(),
      updatedAt: input.occurredAt.toISOString(),
    };
    this.occurrences.set(id, created);
    return created;
  }

  public async clearEventOccurrence(
    id: string,
    clearedAt: Date,
    valueAtClear: boolean | number | string | null,
  ): Promise<EventOccurrence | null> {
    const current = this.occurrences.get(id);
    if (!current) {
      return null;
    }
    const next: EventOccurrence = {
      ...current,
      state: "cleared",
      clearedAt: clearedAt.toISOString(),
      valueAtClear,
      updatedAt: clearedAt.toISOString(),
    };
    this.occurrences.set(id, next);
    return next;
  }

  public async getEventOccurrencesByIds(ids: string[]): Promise<EventOccurrence[]> {
    return ids.map((id) => this.occurrences.get(id)).filter((item): item is EventOccurrence => Boolean(item));
  }

  public async acknowledgeEventOccurrence(
    id: string,
    acknowledgedAt: Date,
    acknowledgedBy: string | null,
  ): Promise<EventOccurrence | null> {
    const current = this.occurrences.get(id);
    if (!current) {
      return null;
    }
    const next: EventOccurrence = {
      ...current,
      acknowledgedAt: acknowledgedAt.toISOString(),
      acknowledgedBy,
      state: current.clearedAt ? "acknowledged" : current.state,
      updatedAt: acknowledgedAt.toISOString(),
    };
    this.occurrences.set(id, next);
    return next;
  }
}

class RecordingWebSocketGateway {
  public readonly broadcasts: BroadcastItem[] = [];

  public broadcastEventUpdate(
    kind: "active" | "cleared" | "acknowledged",
    occurrence: EventOccurrence,
    options?: {
      actionsToRun?: RuntimeAction[];
      actionTrigger?: "active" | "cleared" | "ack";
    },
  ): void {
    this.broadcasts.push({
      kind,
      occurrence,
      actionsToRun: options?.actionsToRun,
      actionTrigger: options?.actionTrigger,
    });
  }
}

class RecordingCommandService {
  public readonly writes: Array<{ type: "tag" | "variable"; name: string; value: unknown }> = [];
  public readonly pulses: Array<{ name: string; value: unknown; durationMs: number }> = [];
  public readonly toggles: string[] = [];

  public async writeTag(name: string, value: unknown): Promise<void> {
    this.writes.push({ type: "tag", name, value });
  }

  public async writeVariable(name: string, value: unknown): Promise<void> {
    this.writes.push({ type: "variable", name, value });
  }

  public async pulseTag(name: string, value: unknown, durationMs: number): Promise<void> {
    this.pulses.push({ name, value, durationMs });
  }

  public async toggleTag(name: string): Promise<void> {
    this.toggles.push(name);
  }
}

function createProject(eventOverrides?: Record<string, unknown>): ScadaProject {
  return {
    version: 1,
    name: "Test",
    drivers: [],
    tags: [],
    screens: [
      {
        id: "screen_main",
        name: "Main",
        kind: "screen",
        width: 800,
        height: 600,
        objects: [],
      },
      {
        id: "popup_1",
        name: "Popup",
        kind: "popup",
        width: 300,
        height: 200,
        objects: [],
      },
    ],
    events: [
      {
        id: "event_1",
        enabled: true,
        sourceTagName: "Tag1",
        conditionMode: "bit",
        bitTrigger: "ON",
        message: "Event",
        ...eventOverrides,
      },
    ],
  };
}

function createTagStore(): TagStore {
  const tagStore = new TagStore();
  const definitions: TagDefinition[] = [
    {
      name: "Tag1",
      sourceType: "simulated",
      dataType: "BOOL",
      writable: true,
    },
  ];
  tagStore.setDefinitions(definitions);
  tagStore.upsertValue({
    name: "Tag1",
    value: false,
    quality: "Good",
    timestamp: Date.now(),
    source: "test",
  });
  return tagStore;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1200): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("event engine actions", () => {
  it("executes onActive actions only once per active transition and emits client actions", async () => {
    const tagStore = createTagStore();
    const archiveService = new InMemoryArchiveService();
    const wsGateway = new RecordingWebSocketGateway();
    const commandService = new RecordingCommandService();
    const engine = new EventEngine(
      tagStore,
      archiveService as unknown as any,
      wsGateway as unknown as any,
      commandService as unknown as any,
      { evaluationIntervalMs: 250 },
    );

    await engine.start(createProject({
      onActiveActions: [
        { type: "write", tag: "TagCmd", value: true },
        { type: "openPopup", popupScreenId: "popup_1" },
      ],
    }));

    tagStore.upsertValue({
      name: "Tag1",
      value: true,
      quality: "Good",
      timestamp: Date.now(),
      source: "test",
    });

    await waitFor(() => wsGateway.broadcasts.some((item) => item.kind === "active"));
    const afterFirstActivation = commandService.writes.length;

    tagStore.upsertValue({
      name: "Tag1",
      value: true,
      quality: "Good",
      timestamp: Date.now() + 1,
      source: "test",
    });
    await new Promise((resolve) => setTimeout(resolve, 120));

    const activeBroadcast = wsGateway.broadcasts.find((item) => item.kind === "active");
    expect(activeBroadcast?.actionTrigger).toBe("active");
    expect(activeBroadcast?.actionsToRun?.map((action) => action.type)).toEqual(["openPopup"]);
    expect(afterFirstActivation).toBe(1);
    expect(commandService.writes.length).toBe(1);

    await engine.stop();
  });

  it("does not execute onActive actions during startup hydration", async () => {
    const tagStore = createTagStore();
    tagStore.upsertValue({
      name: "Tag1",
      value: true,
      quality: "Good",
      timestamp: Date.now(),
      source: "test",
    });

    const archiveService = new InMemoryArchiveService();
    archiveService.setHydratedActive([
      {
        id: "occ_hydrated",
        eventDefinitionId: "event_1",
        occurredAt: new Date().toISOString(),
        state: "active",
      },
    ]);

    const wsGateway = new RecordingWebSocketGateway();
    const commandService = new RecordingCommandService();
    const engine = new EventEngine(
      tagStore,
      archiveService as unknown as any,
      wsGateway as unknown as any,
      commandService as unknown as any,
      { evaluationIntervalMs: 250 },
    );

    await engine.start(createProject({
      onActiveActions: [
        { type: "write", tag: "TagCmd", value: true },
      ],
    }));

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(commandService.writes.length).toBe(0);
    expect(wsGateway.broadcasts.length).toBe(0);

    await engine.stop();
  });

  it("executes onAck actions and includes client actions in acknowledged update", async () => {
    const tagStore = createTagStore();
    const archiveService = new InMemoryArchiveService();
    const wsGateway = new RecordingWebSocketGateway();
    const commandService = new RecordingCommandService();
    const engine = new EventEngine(
      tagStore,
      archiveService as unknown as any,
      wsGateway as unknown as any,
      commandService as unknown as any,
      { evaluationIntervalMs: 250 },
    );

    await engine.start(createProject({
      onAckActions: [
        { type: "write", tag: "TagAck", value: 1 },
        { type: "openScreen", screenId: "screen_main" },
      ],
    }));

    tagStore.upsertValue({
      name: "Tag1",
      value: true,
      quality: "Good",
      timestamp: Date.now(),
      source: "test",
    });
    await waitFor(() => wsGateway.broadcasts.some((item) => item.kind === "active"));

    const active = wsGateway.broadcasts.find((item) => item.kind === "active");
    const activeId = active?.occurrence.id;
    expect(activeId).toBeTruthy();

    const result = await engine.acknowledgeOccurrences([activeId as string], "tester");
    expect(result.acknowledged.length).toBe(1);

    const ackBroadcast = wsGateway.broadcasts.find((item) => item.kind === "acknowledged");
    expect(ackBroadcast?.actionTrigger).toBe("ack");
    expect(ackBroadcast?.actionsToRun?.map((action) => action.type)).toEqual(["openScreen"]);
    expect(commandService.writes.some((item) => item.name === "TagAck")).toBe(true);

    await engine.stop();
  });
});
