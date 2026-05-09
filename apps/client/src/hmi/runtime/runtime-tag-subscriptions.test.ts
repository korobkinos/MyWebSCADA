import { describe, expect, it } from "vitest";
import type { ElementLibrary, HmiScreen, ScadaProject } from "@web-scada/shared";
import { collectRuntimeTagSubscriptions } from "./runtime-tag-subscriptions";

describe("collectRuntimeTagSubscriptions", () => {
  it("collects expression dependencies and resolved binding tags for library element instances", () => {
    const library: ElementLibrary = {
      id: "lib-basic",
      name: "Basic library",
      version: "1.0.0",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      assets: [],
      elements: [
        {
          id: "valve-element",
          libraryId: "lib-basic",
          name: "Valve element",
          width: 120,
          height: 80,
          objects: [
            {
              id: "state-image-1",
              type: "stateImage",
              name: "Valve state image",
              x: 0,
              y: 0,
              width: 120,
              height: 80,
              tag: "$binding.visualState",
              states: [],
              fit: "contain",
              preserveAspectRatio: true,
            },
          ],
          bindings: [
            {
              id: "binding-visual-state",
              key: "visualState",
              displayName: "Visual state",
              kind: "state",
              dataType: "INT",
              required: true,
              defaultBaseTag: "GVL_VALVE.valves[0].VisualState",
            },
          ],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    const screen: HmiScreen = {
      id: "screen-main",
      name: "Main screen",
      kind: "screen",
      width: 1920,
      height: 1080,
      background: "#1e1e1e",
      objects: [
        {
          id: "valve-instance-1",
          type: "libraryElementInstance",
          name: "Valve instance 1",
          x: 100,
          y: 100,
          width: 120,
          height: 80,
          libraryId: "lib-basic",
          elementId: "valve-element",
          bindingAssignments: {
            visualState: {
              baseTag: "GVL_VALVE.valves[0].VisualState",
              indexOffsetSource: {
                type: "expression",
                expression: "lw(20) * 32 + lw(10)",
              },
              indexMode: {
                type: "arrayIndex",
                occurrence: 0,
                operation: "add",
                valueFrom: "indexOffset",
              },
            },
          },
        },
      ],
    };

    const project: ScadaProject = {
      version: 1,
      name: "Test project",
      drivers: [],
      tags: [],
      screens: [screen],
      startScreenId: screen.id,
    };

    const subscriptions = collectRuntimeTagSubscriptions({
      project,
      libraries: [library],
      screen,
      tags: {
        LW20: {
          name: "LW20",
          value: 2,
          quality: "Good",
          timestamp: 1,
          source: "test",
        },
        LW10: {
          name: "LW10",
          value: 5,
          quality: "Good",
          timestamp: 1,
          source: "test",
        },
      },
      popups: [],
    });

    expect(subscriptions).toContain("LW20");
    expect(subscriptions).toContain("LW10");
    expect(subscriptions).toContain("GVL_VALVE.valves[69].VisualState");
  });
});