import { describe, expect, it } from "vitest";
import type { SimulatedDriverConfig, TagDefinition } from "@web-scada/shared";
import { DriverManager } from "./driver-manager";

function makeStaticTag(name: string, driverId: string, value: number): TagDefinition {
  return {
    name,
    sourceType: "simulated",
    dataType: "REAL",
    driverId,
    address: {
      pattern: "static",
      value,
    },
    scanRateMs: 1000,
    writable: true,
  };
}

describe("DriverManager.readTags", () => {
  it("returns tag values in the same order as requested when tags are split by drivers", async () => {
    const manager = new DriverManager();

    const drivers: SimulatedDriverConfig[] = [
      {
        id: "sim_a",
        type: "simulated",
        enabled: true,
        name: "Simulator A",
      },
      {
        id: "sim_b",
        type: "simulated",
        enabled: true,
        name: "Simulator B",
      },
    ];

    manager.configure(drivers);
    await manager.startAll();

    const tags = [
      makeStaticTag("Tag_A1", "sim_a", 101),
      makeStaticTag("Tag_B1", "sim_b", 201),
      makeStaticTag("Tag_A2", "sim_a", 102),
      makeStaticTag("Tag_B2", "sim_b", 202),
    ];

    const values = await manager.readTags(tags);

    expect(values.map((value) => value.name)).toEqual([
      "Tag_A1",
      "Tag_B1",
      "Tag_A2",
      "Tag_B2",
    ]);

    expect(values.map((value) => value.value)).toEqual([101, 201, 102, 202]);

    await manager.stopAll();
  });

  it("uses default simulated driver when simulated tag has no driverId", async () => {
    const manager = new DriverManager();
    manager.configure([
      {
        id: "sim_default",
        type: "simulated",
        enabled: true,
        name: "Default Sim",
      },
    ]);
    await manager.startAll();

    const tag: TagDefinition = {
      name: "Sim_NoDriver",
      sourceType: "simulated",
      dataType: "REAL",
      address: {
        pattern: "static",
        value: 77,
      },
      writable: true,
    };

    const value = await manager.readTag(tag);
    expect(value.value).toBe(77);
    expect(value.quality).toBe("Good");
    expect(value.source).toBe("sim_default");

    await manager.writeTag(tag, 88);
    const updated = await manager.readTag(tag);
    expect(updated.value).toBe(88);

    await manager.stopAll();
  });
});
