import { describe, expect, it } from "vitest";
import type { ScadaProject } from "@web-scada/shared";
import { applyOpcUaImportCandidates } from "./opcua-import-utils";

function makeProject(): ScadaProject {
  return {
    version: 1,
    name: "Project",
    screens: [{ id: "screen", name: "Screen", kind: "screen", width: 800, height: 600, objects: [] }],
    drivers: [{ id: "opc", type: "opcua", enabled: true, endpointUrl: "opc.tcp://127.0.0.1:4840" }],
    tags: [
      {
        name: "FolderA.Tag",
        sourceType: "opcua",
        dataType: "REAL",
        driverId: "opc",
        nodeId: "old",
        address: { nodeId: "old" },
        writable: false,
      },
    ],
  };
}

describe("applyOpcUaImportCandidates", () => {
  it("overwrites matching names across multiple subtree batches", () => {
    const result = applyOpcUaImportCandidates(
      makeProject(),
      "opc",
      [
        { browsePath: "FolderA.Tag", nodeId: "new-a", dataType: "ns=0;i=11" },
        { browsePath: "FolderB.Tag", nodeId: "new-b", dataType: "ns=0;i=11", writable: true },
      ],
      { overwrite: true, scanRateMs: 250 },
    );

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.tags.find((tag) => tag.name === "FolderA.Tag")).toMatchObject({
      nodeId: "new-a",
      address: { nodeId: "new-a" },
      writable: false,
      scanRateMs: 250,
    });
    expect(result.tags.find((tag) => tag.name === "FolderB.Tag")).toMatchObject({
      nodeId: "new-b",
      address: { nodeId: "new-b" },
      writable: true,
    });
  });

  it("uses candidate writable and defaults missing writable to false", () => {
    const result = applyOpcUaImportCandidates(
      { ...makeProject(), tags: [] },
      "opc",
      [
        { browsePath: "Array[0]", nodeId: "array", indexRange: "0", writable: true },
        { browsePath: "StructArray[0].field", nodeId: "struct-array", indexRange: "0", memberPath: ["field"] },
        { browsePath: "StructArray[0].command", nodeId: "struct-array", indexRange: "0", memberPath: ["command"], writable: true },
      ],
      { overwrite: true },
    );

    expect(result.tags).toEqual([
      expect.objectContaining({ name: "Array[0]", writable: true }),
      expect.objectContaining({ name: "StructArray[0].field", writable: false }),
      expect.objectContaining({ name: "StructArray[0].command", writable: true }),
    ]);
  });

  it("inherits simple array element writable from parent array candidate", () => {
    const result = applyOpcUaImportCandidates(
      { ...makeProject(), tags: [] },
      "opc",
      [
        { browsePath: "Alarm", nodeId: "alarm", writable: true },
        { browsePath: "Alarm[0]", nodeId: "alarm", indexRange: "0" },
      ],
      { overwrite: true },
    );

    expect(result.tags).toEqual([
      expect.objectContaining({ name: "Alarm", writable: true }),
      expect.objectContaining({ name: "Alarm[0]", writable: true }),
    ]);
  });
});
