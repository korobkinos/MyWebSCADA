import { describe, expect, it } from "vitest";
import type { OpcUaDriverConfig, ScadaProject, TagDefinition } from "@web-scada/shared";
import { collectAlwaysActiveEventTags, shouldSubscribeOpcUaTagAtStartup } from "./runtime-service.js";

function createProject(events: NonNullable<ScadaProject["events"]>): Pick<ScadaProject, "events"> {
  return { events };
}

describe("collectAlwaysActiveEventTags", () => {
  it("includes source and security tags for enabled events", () => {
    const tags = collectAlwaysActiveEventTags(createProject([
      {
        id: "evt_1",
        enabled: true,
        sourceTagName: " Pump.Fault ",
        conditionMode: "bit",
        bitTrigger: "ON",
        securityEnabled: true,
        securityTagName: "Perm.AlarmEnable",
      },
    ]));

    expect(tags).toEqual(["Pump.Fault", "Perm.AlarmEnable"]);
  });

  it("skips disabled events and ignores empty refs", () => {
    const tags = collectAlwaysActiveEventTags(createProject([
      {
        id: "evt_1",
        enabled: false,
        sourceTagName: "Tag.Disabled",
      },
      {
        id: "evt_2",
        enabled: true,
        sourceTagName: "   ",
        securityEnabled: true,
        securityTagName: "   ",
      },
      {
        id: "evt_3",
        enabled: true,
        sourceTagName: "Tag.Enabled",
      },
    ]));

    expect(tags).toEqual(["Tag.Enabled"]);
  });

  it("deduplicates repeated tags across events", () => {
    const tags = collectAlwaysActiveEventTags(createProject([
      {
        id: "evt_1",
        enabled: true,
        sourceTagName: "Tag.Common",
      },
      {
        id: "evt_2",
        enabled: true,
        sourceTagName: "Tag.Common",
        securityEnabled: true,
        securityTagName: "Tag.Common",
      },
    ]));

    expect(tags).toEqual(["Tag.Common"]);
  });
});

describe("shouldSubscribeOpcUaTagAtStartup", () => {
  const tag: TagDefinition = {
    name: "PV",
    dataType: "REAL",
    sourceType: "opcua",
    driverId: "opc",
    nodeId: "ns=1;s=PV",
  };
  const driver: OpcUaDriverConfig = {
    id: "opc",
    type: "opcua",
    enabled: true,
    endpointUrl: "opc.tcp://localhost:4840",
    readMode: "subscription",
  };

  it("keeps all-tags subscription as the default", () => {
    expect(shouldSubscribeOpcUaTagAtStartup(tag, driver, false)).toBe(true);
  });

  it("limits startup subscription to persistent active tags when configured", () => {
    expect(shouldSubscribeOpcUaTagAtStartup(tag, { ...driver, subscriptionScope: "active" }, false)).toBe(false);
    expect(shouldSubscribeOpcUaTagAtStartup(tag, { ...driver, subscriptionScope: "active" }, true)).toBe(true);
  });
});

