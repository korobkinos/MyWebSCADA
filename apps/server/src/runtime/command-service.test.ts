import { afterEach, describe, expect, it, vi } from "vitest";
import { DriverManager } from "../drivers/driver-manager.js";
import { TagStore } from "../tags/tag-store.js";
import { InternalVariableService } from "./internal-variable-service.js";
import { CommandService } from "./command-service.js";

function createCommandService(): { commandService: CommandService; tagStore: TagStore } {
  const tagStore = new TagStore();
  tagStore.setDefinitions([
    { name: "Cmd", dataType: "BOOL", sourceType: "internal", writable: true },
  ]);
  const internalVariableService = new InternalVariableService(tagStore);
  return {
    commandService: new CommandService(tagStore, new DriverManager(), internalVariableService),
    tagStore,
  };
}

function lease(overrides: Partial<Parameters<CommandService["startPulseLease"]>[0]> = {}) {
  return {
    clientId: "client-a",
    screenInstanceId: "screen-main",
    objectId: "button-1",
    actionIndex: 0,
    tag: "Cmd",
    activeValue: true,
    resetValue: false,
    durationMs: 100,
    ...overrides,
  };
}

describe("CommandService runtime action leases", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pulse writes true then false after duration", async () => {
    vi.useFakeTimers();
    const { commandService, tagStore } = createCommandService();

    await commandService.startPulseLease(lease());

    expect(tagStore.getValue("Cmd")?.value).toBe(true);

    await vi.advanceTimersByTimeAsync(100);

    expect(tagStore.getValue("Cmd")?.value).toBe(false);
  });

  it("repeated pulse restarts timer", async () => {
    vi.useFakeTimers();
    const { commandService, tagStore } = createCommandService();

    await commandService.startPulseLease(lease());
    await vi.advanceTimersByTimeAsync(80);
    await commandService.startPulseLease(lease());
    await vi.advanceTimersByTimeAsync(80);

    expect(tagStore.getValue("Cmd")?.value).toBe(true);

    await vi.advanceTimersByTimeAsync(20);

    expect(tagStore.getValue("Cmd")?.value).toBe(false);
  });

  it("two clients pulsing same tag do not reset each other", async () => {
    vi.useFakeTimers();
    const { commandService, tagStore } = createCommandService();

    await commandService.startPulseLease(lease({ clientId: "client-a", durationMs: 100 }));
    await vi.advanceTimersByTimeAsync(50);
    await commandService.startPulseLease(lease({ clientId: "client-b", durationMs: 100 }));
    await vi.advanceTimersByTimeAsync(50);

    expect(tagStore.getValue("Cmd")?.value).toBe(true);

    await vi.advanceTimersByTimeAsync(50);

    expect(tagStore.getValue("Cmd")?.value).toBe(false);
  });

  it("hold release writes false", async () => {
    const { commandService, tagStore } = createCommandService();

    await commandService.startHoldLease({ ...lease(), ttlMs: 1000 });
    expect(tagStore.getValue("Cmd")?.value).toBe(true);

    await commandService.releaseHoldLease(lease());

    expect(tagStore.getValue("Cmd")?.value).toBe(false);
  });

  it("hold TTL expiry writes false after lost refresh", async () => {
    vi.useFakeTimers();
    const { commandService, tagStore } = createCommandService();

    await commandService.startHoldLease({ ...lease(), ttlMs: 100 });
    await vi.advanceTimersByTimeAsync(80);
    await commandService.refreshHoldLease({ ...lease(), ttlMs: 100 });
    await vi.advanceTimersByTimeAsync(80);

    expect(tagStore.getValue("Cmd")?.value).toBe(true);

    await vi.advanceTimersByTimeAsync(20);

    expect(tagStore.getValue("Cmd")?.value).toBe(false);
  });
});
