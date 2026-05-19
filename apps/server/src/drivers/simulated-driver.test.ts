import { afterEach, describe, expect, it, vi } from "vitest";
import type { SimulatedDriverConfig, TagDefinition } from "@web-scada/shared";
import { SimulatedDriver } from "./simulated-driver";

describe("SimulatedDriver ramp mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("updates numeric tags in ping-pong ramp mode", async () => {
    const config: SimulatedDriverConfig = {
      id: "sim_ramp",
      type: "simulated",
      enabled: true,
      updateIntervalMs: 1000,
      defaultMode: "manual",
    };
    const driver = new SimulatedDriver(config);
    const tag: TagDefinition = {
      name: "RampTag",
      sourceType: "simulated",
      dataType: "INT",
      driverId: "sim_ramp",
      simulation: {
        enabled: true,
        profile: "ramp",
        updateIntervalMs: 1000,
        min: 0,
        max: 3,
        ramp: {
          step: 1,
          direction: "pingPong",
        },
        initialValue: 0,
      },
    };

    vi.useFakeTimers();
    await driver.start();

    const values: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const value = await driver.readTag(tag);
      values.push(Number(value.value));
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(values).toEqual([0, 1, 2, 3, 2, 1, 0]);
  });
});
