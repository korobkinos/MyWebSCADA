import { describe, expect, it, vi } from "vitest";
import type { RuntimeWsServerMessage, ScadaProject } from "@web-scada/shared";
import { handleRuntimeWsServerMessage } from "./ws";

const project = {
  version: 1,
  name: "Updated project",
  screens: [{ id: "main", name: "Main", kind: "screen", width: 100, height: 100, objects: [] }],
  startScreenId: "main",
  tags: [],
  drivers: [],
} as ScadaProject;

describe("handleRuntimeWsServerMessage", () => {
  it("notifies runtime clients about saved project updates", () => {
    const onProjectUpdate = vi.fn();
    const message: RuntimeWsServerMessage = {
      type: "project-update",
      payload: { project },
    };

    handleRuntimeWsServerMessage(message, {
      onTagValues: () => undefined,
      onProjectUpdate,
    });

    expect(onProjectUpdate).toHaveBeenCalledWith(project);
  });
});
