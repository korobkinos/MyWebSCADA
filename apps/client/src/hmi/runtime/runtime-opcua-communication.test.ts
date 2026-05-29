import { describe, expect, it } from "vitest";
import type { DriverStatus, ElementLibrary, HmiObject, ScadaProject, TagDefinition } from "@web-scada/shared";
import { collectRuntimeObjectResolvedTags } from "./runtime-tag-subscriptions";
import { diagnoseOpcUaCommunication, isDriverStatusAvailable } from "./runtime-opcua-communication";

function makeStatus(id: string, health: DriverStatus["health"]): DriverStatus {
  return {
    id,
    type: "opcua",
    health,
    updatedAt: Date.now(),
  };
}

function makeProject(objects: HmiObject[], tags: TagDefinition[]): ScadaProject {
  return {
    version: 1,
    name: "test",
    drivers: [],
    tags,
    screens: [{
      id: "main",
      name: "Main",
      kind: "screen",
      width: 1000,
      height: 700,
      background: "#111",
      objects,
    }],
    startScreenId: "main",
  };
}

describe("runtime OPC UA communication diagnostics", () => {
  it("treats running driver status as available", () => {
    expect(isDriverStatusAvailable(makeStatus("D1", "running"))).toBe(true);
  });

  it("flags reconnecting and error driver states as unavailable", () => {
    expect(isDriverStatusAvailable(makeStatus("D1", "reconnecting"))).toBe(false);
    expect(isDriverStatusAvailable(makeStatus("D1", "error"))).toBe(false);
  });

  it("does not flag non-OPC tags", () => {
    const result = diagnoseOpcUaCommunication({
      resolvedTags: ["LW10"],
      tagDefinitionsByName: new Map<string, TagDefinition>([[
        "LW10",
        {
          name: "LW10",
          dataType: "REAL",
          sourceType: "lw",
        },
      ]]),
      driverStatusesById: new Map<string, DriverStatus>(),
    });
    expect(result.bad).toBe(false);
  });

  it("flags object when at least one OPC UA tag uses unavailable driver", () => {
    const result = diagnoseOpcUaCommunication({
      resolvedTags: ["Pump.Opened", "Pump.Setpoint"],
      tagDefinitionsByName: new Map<string, TagDefinition>([
        [
          "Pump.Opened",
          {
            name: "Pump.Opened",
            dataType: "BOOL",
            sourceType: "opcua",
            driverId: "D1",
          },
        ],
        [
          "Pump.Setpoint",
          {
            name: "Pump.Setpoint",
            dataType: "REAL",
            sourceType: "opcua",
            driverId: "D2",
          },
        ],
      ]),
      driverStatusesById: new Map<string, DriverStatus>([
        ["D1", makeStatus("D1", "running")],
        ["D2", makeStatus("D2", "reconnecting")],
      ]),
    });

    expect(result.bad).toBe(true);
    expect(result.affectedTags).toEqual(["Pump.Setpoint"]);
    expect(result.affectedDrivers).toEqual(["D2"]);
  });

  it("resolves libraryElementInstance tags with tagPrefix and detects bad OPC UA driver", () => {
    const object: HmiObject = {
      id: "libinst-1",
      type: "libraryElementInstance",
      x: 0,
      y: 0,
      width: 120,
      height: 80,
      libraryId: "lib-1",
      elementId: "el-1",
      tagPrefix: "Pump_1",
    };

    const library: ElementLibrary = {
      id: "lib-1",
      name: "Library",
      version: "1.0.0",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      assets: [],
      elements: [
        {
          id: "el-1",
          libraryId: "lib-1",
          name: "Pump element",
          width: 120,
          height: 80,
          objects: [{
            id: "value-1",
            type: "value-display",
            x: 0,
            y: 0,
            width: 120,
            height: 24,
            tag: ".Opened",
            textStyle: {
              fontFamily: "Arial",
              fontSize: 12,
              color: "#fff",
              horizontalAlign: "left",
              verticalAlign: "middle",
            },
          }],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    const project = makeProject([object], [
      {
        name: "Pump_1.Opened",
        dataType: "BOOL",
        sourceType: "opcua",
        driverId: "D1",
      },
    ]);

    const resolvedTags = collectRuntimeObjectResolvedTags({
      project,
      libraries: [library],
      object,
      renderContext: {},
      tags: {},
    });
    expect(resolvedTags).toContain("Pump_1.Opened");

    const result = diagnoseOpcUaCommunication({
      resolvedTags,
      tagDefinitionsByName: new Map(project.tags.map((tag) => [tag.name, tag] as const)),
      driverStatusesById: new Map<string, DriverStatus>([["D1", makeStatus("D1", "error")]]),
    });
    expect(result.bad).toBe(true);
    expect(result.affectedTags).toContain("Pump_1.Opened");
  });

  it("treats missing OPC UA driver status as bad without crashing", () => {
    const result = diagnoseOpcUaCommunication({
      resolvedTags: ["Pump.Opened"],
      tagDefinitionsByName: new Map<string, TagDefinition>([[
        "Pump.Opened",
        {
          name: "Pump.Opened",
          dataType: "BOOL",
          sourceType: "opcua",
          driverId: "D404",
        },
      ]]),
      driverStatusesById: new Map<string, DriverStatus>(),
    });
    expect(result.bad).toBe(true);
    expect(result.affectedDrivers).toEqual(["D404"]);
  });

  it("ignores missing tag definition and does not crash", () => {
    const result = diagnoseOpcUaCommunication({
      resolvedTags: ["Missing.Tag"],
      tagDefinitionsByName: new Map<string, TagDefinition>(),
      driverStatusesById: new Map<string, DriverStatus>(),
    });
    expect(result.bad).toBe(false);
    expect(result.affectedTags).toEqual([]);
  });

  it("treats OPC UA tag without driverId as bad", () => {
    const result = diagnoseOpcUaCommunication({
      resolvedTags: ["Pump.Opened"],
      tagDefinitionsByName: new Map<string, TagDefinition>([[
        "Pump.Opened",
        {
          name: "Pump.Opened",
          dataType: "BOOL",
          sourceType: "opcua",
        },
      ]]),
      driverStatusesById: new Map<string, DriverStatus>(),
    });
    expect(result.bad).toBe(true);
    expect(result.affectedDrivers).toEqual(["__missing_driver_id__"]);
  });

  it("uses numeric-input errorTag in resolved tags for OPC UA diagnostics", () => {
    const object: HmiObject = {
      id: "num-input-1",
      type: "numeric-input",
      x: 0,
      y: 0,
      width: 120,
      height: 36,
      tag: "Pump.Setpoint",
      writeTag: "Pump.SetpointCmd",
      errorTag: "Pump.Error",
    };

    const project = makeProject([object], [
      {
        name: "Pump.Setpoint",
        dataType: "REAL",
        sourceType: "simulated",
      },
      {
        name: "Pump.SetpointCmd",
        dataType: "REAL",
        sourceType: "simulated",
      },
      {
        name: "Pump.Error",
        dataType: "BOOL",
        sourceType: "opcua",
        driverId: "D1",
      },
    ]);

    const resolvedTags = collectRuntimeObjectResolvedTags({
      project,
      libraries: [],
      object,
      renderContext: {},
      tags: {},
    });

    expect(resolvedTags).toContain("Pump.Error");

    const result = diagnoseOpcUaCommunication({
      resolvedTags,
      tagDefinitionsByName: new Map(project.tags.map((tag) => [tag.name, tag] as const)),
      driverStatusesById: new Map<string, DriverStatus>(),
    });

    expect(result.bad).toBe(true);
    expect(result.affectedTags).toContain("Pump.Error");
    expect(result.affectedDrivers).toEqual(["D1"]);
  });
});
