import { afterEach, describe, expect, it, vi } from "vitest";
import type { SimulatedDriverConfig, TagDefinition } from "@web-scada/shared";
import { SimulatedDriver } from "./simulated-driver";

describe("SimulatedDriver ramp mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
        mode: "ramp",
        intervalMs: 1000,
        min: 0,
        max: 3,
        step: 1,
        initialValue: 0,
      },
    };

    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await driver.start();

    const values: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const value = await driver.readTag(tag);
      values.push(Number(value.value));
      now += 1000;
    }

    expect(values).toEqual([0, 1, 2, 3, 2, 1, 0]);
  });
});
