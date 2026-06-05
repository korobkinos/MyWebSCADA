import { describe, expect, it, vi } from "vitest";
import type { ScadaProject } from "@web-scada/shared";
import { createRuntimeProjectPoller } from "./runtime-project-sync";

const baseProject = {
  version: 1,
  name: "Project",
  screens: [{ id: "main", name: "Main", kind: "screen", width: 100, height: 100, objects: [] }],
  startScreenId: "main",
  tags: [],
  drivers: [],
} as ScadaProject;

describe("createRuntimeProjectPoller", () => {
  it("applies a changed project fetched from the backend", async () => {
    vi.useFakeTimers();
    const changedProject = {
      ...baseProject,
      screens: [{
        ...baseProject.screens[0],
        objects: [{ id: "rect", type: "rectangle", x: 12, y: 34, width: 40, height: 20, fill: "#000" }],
      }],
    } as ScadaProject;
    const applyProject = vi.fn();

    const poller = createRuntimeProjectPoller({
      fetchProject: vi.fn().mockResolvedValue(changedProject),
      applyProject,
      getCurrentProjectSignature: () => JSON.stringify(baseProject),
      setCurrentProjectSignature: vi.fn(),
      intervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);
    poller.close();

    expect(applyProject).toHaveBeenCalledWith(changedProject);
    vi.useRealTimers();
  });
});
