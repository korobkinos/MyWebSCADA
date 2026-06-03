import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScadaProject } from "@web-scada/shared";
import { ProjectService } from "./project-service";

function makeProject(): ScadaProject {
  return {
    name: "Project",
    version: 1,
    screens: [{ id: "screen", name: "Screen", kind: "screen", width: 800, height: 600, objects: [] }],
    tags: [],
    variables: [],
    drivers: [{ id: "opc", type: "opcua", enabled: true, endpointUrl: "opc.tcp://127.0.0.1:4840" }],
    macros: [],
  };
}

describe("ProjectService", () => {
  it("preserves OPC UA extended address fields when saving", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "web-scada-project-"));
    try {
      await mkdir(root, { recursive: true });
      const service = new ProjectService(path.join(root, "project.json"));
      const saved = await service.saveProject({
        ...makeProject(),
        tags: [
          {
            name: "Pid[0].down_out",
            sourceType: "opcua",
            dataType: "BOOL",
            driverId: "opc",
            nodeId: "ns=1;s=Pid",
            address: {
              nodeId: "ns=1;s=Pid",
              indexRange: "0",
              memberPath: ["down_out"],
            },
          },
        ],
      });

      expect(saved.tags[0]?.address).toEqual({
        nodeId: "ns=1;s=Pid",
        indexRange: "0",
        memberPath: ["down_out"],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
