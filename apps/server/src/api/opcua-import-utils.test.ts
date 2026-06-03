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
        { browsePath: "FolderB.Tag", nodeId: "new-b", dataType: "ns=0;i=11" },
      ],
      { overwrite: true, scanRateMs: 250 },
    );

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.tags.find((tag) => tag.name === "FolderA.Tag")).toMatchObject({
      nodeId: "new-a",
      address: { nodeId: "new-a" },
      writable: true,
      scanRateMs: 250,
    });
    expect(result.tags.find((tag) => tag.name === "FolderB.Tag")).toMatchObject({
      nodeId: "new-b",
      address: { nodeId: "new-b" },
    });
  });

  it("marks array and structure members writable by default", () => {
    const result = applyOpcUaImportCandidates(
      { ...makeProject(), tags: [] },
      "opc",
      [
        { browsePath: "Array[0]", nodeId: "array", indexRange: "0" },
        { browsePath: "StructArray[0].field", nodeId: "struct-array", indexRange: "0", memberPath: ["field"] },
      ],
      { overwrite: true },
    );

    expect(result.tags).toEqual([
      expect.objectContaining({ name: "Array[0]", writable: true }),
      expect.objectContaining({ name: "StructArray[0].field", writable: true }),
    ]);
  });
});
