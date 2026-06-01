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

  it("collects button disabledTag with relative prefix in popup context", () => {
    const screen: HmiScreen = {
      id: "popup-control",
      name: "Popup control",
      kind: "popup",
      width: 800,
      height: 600,
      background: "#1e1e1e",
      objects: [
        {
          id: "btn-open",
          type: "button",
          x: 10,
          y: 10,
          width: 120,
          height: 40,
          text: "Open",
          showText: true,
          disabledTag: ".DisableOpen",
          visibleTag: ".ShowOpen",
          textStyle: {
            fontFamily: "Arial",
            fontSize: 14,
            color: "#fff",
            horizontalAlign: "center",
            verticalAlign: "middle",
          },
          action: { type: "write", tag: ".OpenCmd", value: true },
        },
      ],
    };

    const rootScreen: HmiScreen = {
      id: "main",
      name: "Main",
      kind: "screen",
      width: 800,
      height: 600,
      background: "#1e1e1e",
      objects: [],
    };

    const project: ScadaProject = {
      version: 1,
      name: "Test project",
      drivers: [],
      tags: [],
      screens: [rootScreen, screen],
      startScreenId: rootScreen.id,
    };

    const subscriptions = collectRuntimeTagSubscriptions({
      project,
      libraries: [] as ElementLibrary[],
      screen: rootScreen,
      tags: {},
      popups: [{
        screen,
        tagPrefix: "VALVES.PZK_1",
      }],
    });

    expect(subscriptions).toContain("VALVES.PZK_1.DisableOpen");
    expect(subscriptions).toContain("VALVES.PZK_1.ShowOpen");
    expect(subscriptions).toContain("VALVES.PZK_1.OpenCmd");
  });

  it("collects rotation animation trigger/speed tags", () => {
    const screen: HmiScreen = {
      id: "screen-main",
      name: "Main",
      kind: "screen",
      width: 800,
      height: 600,
      background: "#1e1e1e",
      objects: [
        {
          id: "fan-image",
          type: "image",
          x: 20,
          y: 20,
          width: 120,
          height: 120,
          fit: "contain",
          preserveAspectRatio: true,
          rotationAnimation: {
            enabled: true,
            triggerTag: "Fan_1.Run",
            speedSource: "tag",
            speedTag: "Fan_1.Speed",
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
      libraries: [],
      screen,
      tags: {},
      popups: [],
    });

    expect(subscriptions).toContain("Fan_1.Run");
    expect(subscriptions).toContain("Fan_1.Speed");
  });

  it("collects group rotation animation trigger/speed tags", () => {
    const screen: HmiScreen = {
      id: "screen-main",
      name: "Main",
      kind: "screen",
      width: 800,
      height: 600,
      background: "#1e1e1e",
      objects: [
        {
          id: "group-1",
          type: "group",
          x: 100,
          y: 100,
          width: 200,
          height: 200,
          rotationAnimation: {
            enabled: true,
            triggerTag: "Motor_1.Run",
            speedSource: "tag",
            speedTag: "Motor_1.Speed",
          },
          objects: [],
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
      libraries: [],
      screen,
      tags: {},
      popups: [],
    });

    expect(subscriptions).toContain("Motor_1.Run");
    expect(subscriptions).toContain("Motor_1.Speed");
  });

  it("collects line flow animation trigger/speed tags", () => {
    const screen: HmiScreen = {
      id: "screen-main",
      name: "Main",
      kind: "screen",
      width: 800,
      height: 600,
      background: "#1e1e1e",
      objects: [
        {
          id: "line-1",
          type: "line",
          x: 50,
          y: 50,
          width: 200,
          height: 40,
          points: [0, 20, 200, 20],
          stroke: "#d9d9d9",
          strokeWidth: 4,
          flowAnimation: {
            enabled: true,
            triggerTag: "Pipe_1.FlowRun",
            speedSource: "tag",
            speedTag: "Pipe_1.FlowSpeed",
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
      libraries: [],
      screen,
      tags: {},
      popups: [],
    });

    expect(subscriptions).toContain("Pipe_1.FlowRun");
    expect(subscriptions).toContain("Pipe_1.FlowSpeed");
  });

  it("collects numeric-input errorTag along with tag/writeTag", () => {
    const screen: HmiScreen = {
      id: "screen-main",
      name: "Main",
      kind: "screen",
      width: 800,
      height: 600,
      background: "#1e1e1e",
      objects: [
        {
          id: "num-1",
          type: "numeric-input",
          x: 32,
          y: 24,
          width: 140,
          height: 36,
          tag: "Pump.Setpoint",
          writeTag: "Pump.SetpointCmd",
          errorTag: "Pump.Error",
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
      libraries: [],
      screen,
      tags: {},
      popups: [],
    });

    expect(subscriptions).toContain("Pump.Setpoint");
    expect(subscriptions).toContain("Pump.SetpointCmd");
    expect(subscriptions).toContain("Pump.Error");
  });

  it("excludes tags from objects fully offscreen to the right", () => {
    const screen: HmiScreen = {
      id: "screen-main",
      name: "Main",
      kind: "screen",
      width: 800,
      height: 600,
      background: "#1e1e1e",
      objects: [
        {
          id: "btn-offscreen",
          type: "button",
          x: 900,
          y: 10,
          width: 120,
          height: 40,
          text: "Offscreen",
          showText: true,
          disabledTag: "Tag.Offscreen",
          action: { type: "write", tag: "", value: "" },
          textStyle: {
            fontFamily: "Arial",
            fontSize: 14,
            color: "#fff",
            horizontalAlign: "center",
            verticalAlign: "middle",
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
      libraries: [],
      screen,
      tags: {},
      popups: [],
    });

    expect(subscriptions).not.toContain("Tag.Offscreen");
  });

  it("includes tags from partially on-screen objects", () => {
    const screen: HmiScreen = {
      id: "screen-main",
      name: "Main",
      kind: "screen",
      width: 800,
      height: 600,
      background: "#1e1e1e",
      objects: [
        {
          id: "btn-partial",
          type: "button",
          x: 750,
          y: 10,
          width: 120,
          height: 40,
          text: "Partial",
          showText: true,
          disabledTag: "Tag.Partial",
          action: { type: "write", tag: "", value: "" },
          textStyle: {
            fontFamily: "Arial",
            fontSize: 14,
            color: "#fff",
            horizontalAlign: "center",
            verticalAlign: "middle",
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
      libraries: [],
      screen,
      tags: {},
      popups: [],
    });

    expect(subscriptions).toContain("Tag.Partial");
  });

  it("excludes tags from objects fully above screen", () => {
    const screen: HmiScreen = {
      id: "screen-main",
      name: "Main",
      kind: "screen",
      width: 800,
      height: 600,
      background: "#1e1e1e",
      objects: [
        {
          id: "btn-above",
          type: "button",
          x: 100,
          y: -100,
          width: 120,
          height: 40,
          text: "Above",
          showText: true,
          disabledTag: "Tag.Above",
          action: { type: "write", tag: "", value: "" },
          textStyle: {
            fontFamily: "Arial",
            fontSize: 14,
            color: "#fff",
            horizontalAlign: "center",
            verticalAlign: "middle",
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
      libraries: [],
      screen,
      tags: {},
      popups: [],
    });

    expect(subscriptions).not.toContain("Tag.Above");
  });

  it("includes tags from fully on-screen objects", () => {
    const screen: HmiScreen = {
      id: "screen-main",
      name: "Main",
      kind: "screen",
      width: 800,
      height: 600,
      background: "#1e1e1e",
      objects: [
        {
          id: "btn-on",
          type: "button",
          x: 100,
          y: 100,
          width: 120,
          height: 40,
          text: "On Screen",
          showText: true,
          disabledTag: "Tag.OnScreen",
          action: { type: "write", tag: "", value: "" },
          textStyle: {
            fontFamily: "Arial",
            fontSize: 14,
            color: "#fff",
            horizontalAlign: "center",
            verticalAlign: "middle",
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
      libraries: [],
      screen,
      tags: {},
      popups: [],
    });

    expect(subscriptions).toContain("Tag.OnScreen");
  });

  it("collects frame-inherited indexed tags for read and action fields", () => {
    const templateScreen: HmiScreen = {
      id: "template-1",
      name: "Template 1",
      kind: "template",
      width: 800,
      height: 600,
      background: "#1e1e1e",
      objects: [
        {
          id: "switch-1",
          type: "switch",
          x: 20,
          y: 20,
          width: 120,
          height: 40,
          tag: "Burner[1].Pressure",
          textStyle: {
            fontFamily: "Arial",
            fontSize: 14,
            color: "#fff",
            horizontalAlign: "center",
            verticalAlign: "middle",
          },
        },
        {
          id: "button-1",
          type: "button",
          x: 20,
          y: 80,
          width: 120,
          height: 40,
          text: "Write",
          showText: true,
          textStyle: {
            fontFamily: "Arial",
            fontSize: 14,
            color: "#fff",
            horizontalAlign: "center",
            verticalAlign: "middle",
          },
          action: {
            type: "write",
            tag: "Burner[1].Cmd",
            value: true,
          },
        },
      ],
    };

    const runtimeScreen: HmiScreen = {
      id: "runtime-main",
      name: "Runtime Main",
      kind: "screen",
      width: 800,
      height: 600,
      background: "#1e1e1e",
      objects: [
        {
          id: "frame-1",
          type: "frame",
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          screenId: templateScreen.id,
          tagIndexRules: [
            {
              id: "rule-1",
              enabled: true,
              indexOffset: 1,
              indexMode: {
                type: "arrayIndex",
                occurrence: 0,
                operation: "add",
                valueFrom: "indexOffset",
              },
              conflictMode: "skipLocal",
            },
          ],
        },
      ],
    };

    const project: ScadaProject = {
      version: 1,
      name: "Frame index project",
      drivers: [],
      tags: [],
      screens: [runtimeScreen, templateScreen],
      startScreenId: runtimeScreen.id,
    };

    const subscriptions = collectRuntimeTagSubscriptions({
      project,
      libraries: [],
      screen: runtimeScreen,
      tags: {},
      popups: [],
    });

    expect(subscriptions).toContain("Burner[2].Pressure");
    expect(subscriptions).toContain("Burner[2].Cmd");
    expect(subscriptions).not.toContain("Burner[1].Pressure");
    expect(subscriptions).not.toContain("Burner[1].Cmd");
  });
});
