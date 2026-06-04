import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Konva as KonvaGlobal } from "konva/lib/Global";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriverStatus, ElementLibrary, HmiObject, HmiScreen, RenderContext, ScadaProject, TagDefinition } from "@web-scada/shared";

vi.mock("antd", () => ({
  message: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("react-konva", async () => {
  const React = await import("react");
  const makeNode = (name: string) => {
    return function MockKonvaNode({
      children,
      id,
      opacity,
      fill,
      strokeWidth,
      onClick,
    }: {
      children?: React.ReactNode;
      id?: string;
      opacity?: number;
      fill?: string;
      strokeWidth?: number;
      onClick?: unknown;
    }) {
      return React.createElement(
        "div",
        {
          "data-konva-node": name,
          "data-fill": fill,
          "data-has-on-click": typeof onClick === "function" ? "true" : undefined,
          "data-opacity": opacity,
          "data-stroke-width": strokeWidth,
          id,
        },
        children,
      );
    };
  };

  return {
    Circle: makeNode("Circle"),
    Group: makeNode("Group"),
    Image: makeNode("Image"),
    Line: makeNode("Line"),
    Path: makeNode("Path"),
    Rect: makeNode("Rect"),
    Shape: makeNode("Shape"),
    Text: makeNode("Text"),
  };
});

vi.mock("../../features/trends/TrendRuntimeWidget", async () => {
  const React = await import("react");
  return {
    TrendRuntimeWidget: () => React.createElement("div", { "data-widget": "trend" }),
  };
});

vi.mock("../../features/events/EventTableRuntimeWidget", async () => {
  const React = await import("react");
  return {
    EventTableRuntimeWidget: () => React.createElement("div", { "data-widget": "event-table" }),
  };
});

import {
  HmiRenderer,
  areObjectNodePropsEqual,
  flushRuntimeAnimationLayerDraws,
  requestRuntimeAnimationLayerDraw,
  runRuntimeAnimationHandlers,
  subscribeGlobalAnimationTick,
} from "./hmi-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderContext: RenderContext = {
  screenId: "screen-main",
};

function renderRenderer(screen: HmiScreen, disableOffscreenCulling = false): string {
  const project: ScadaProject = {
    version: 1,
    name: "Test project",
    drivers: [],
    tags: [],
    screens: [screen],
    startScreenId: screen.id,
  };

  return renderToStaticMarkup(
    createElement(HmiRenderer, {
      project,
      screen,
      mode: "runtime",
      tags: {},
      renderContext,
      disableOffscreenCulling,
    }),
  );
}

describe("HmiRenderer offscreen culling", () => {
  it("keeps runtime culling enabled by default", () => {
    const screen: HmiScreen = {
      id: "screen-main",
      name: "Main",
      kind: "screen",
      width: 100,
      height: 100,
      background: "transparent",
      objects: [
        {
          id: "rect-offscreen",
          type: "rectangle",
          x: 140,
          y: 10,
          width: 20,
          height: 20,
        } as HmiObject,
      ],
    };

    expect(renderRenderer(screen)).not.toContain("hmi-rect-offscreen");
  });

  it("can disable runtime culling for nested virtual renderers", () => {
    const screen: HmiScreen = {
      id: "screen-main",
      name: "Main",
      kind: "template",
      width: 100,
      height: 100,
      background: "transparent",
      objects: [
        {
          id: "rect-offscreen",
          type: "rectangle",
          x: 140,
          y: 10,
          width: 20,
          height: 20,
        } as HmiObject,
      ],
    };

    expect(renderRenderer(screen, true)).toContain("hmi-rect-offscreen");
  });
});

describe("HmiRenderer button opacity", () => {
  it("keeps an opacity zero runtime button clickable while hiding its visuals", () => {
    const screen: HmiScreen = {
      id: "screen-main",
      name: "Main",
      kind: "screen",
      width: 200,
      height: 100,
      background: "transparent",
      objects: [
        {
          id: "button-invisible",
          type: "button",
          x: 10,
          y: 10,
          width: 80,
          height: 30,
          opacity: 0,
          text: "",
          showText: false,
          borderWidth: 0,
          backgroundColor: "#0958d9",
          action: { type: "write", tag: "Cmd", value: true },
          textStyle: {
            fontFamily: "Arial",
            fontSize: 14,
            color: "#fff",
            horizontalAlign: "center",
            verticalAlign: "middle",
          },
        } as HmiObject,
      ],
    };

    const html = renderRenderer(screen);

    expect(html).toContain('id="hmi-button-invisible"');
    expect(html).toContain('data-has-on-click="true"');
    expect(html).toContain('data-opacity="0"');
    expect(html).toContain('data-fill="rgba(0,0,0,0.001)"');
    expect(html).toContain('data-stroke-width="0"');
    expect(html).not.toContain('data-opacity="0" id="hmi-button-invisible"');
  });
});

describe("runtime animation layer draw scheduler", () => {
  function createLayer(attached = true) {
    return {
      batchDraw: vi.fn(),
      getStage: vi.fn(() => attached ? {} : null),
    };
  }

  it("flushes one draw for repeated requests to the same layer", () => {
    const layer = createLayer();

    requestRuntimeAnimationLayerDraw(layer as never);
    requestRuntimeAnimationLayerDraw(layer as never);

    expect(layer.batchDraw).not.toHaveBeenCalled();

    flushRuntimeAnimationLayerDraws();

    expect(layer.batchDraw).toHaveBeenCalledTimes(1);
  });

  it("flushes each dirty layer and allows drawing it again after flush", () => {
    const firstLayer = createLayer();
    const secondLayer = createLayer();

    requestRuntimeAnimationLayerDraw(firstLayer as never);
    requestRuntimeAnimationLayerDraw(secondLayer as never);
    flushRuntimeAnimationLayerDraws();

    expect(firstLayer.batchDraw).toHaveBeenCalledTimes(1);
    expect(secondLayer.batchDraw).toHaveBeenCalledTimes(1);

    requestRuntimeAnimationLayerDraw(firstLayer as never);
    flushRuntimeAnimationLayerDraws();

    expect(firstLayer.batchDraw).toHaveBeenCalledTimes(2);
    expect(secondLayer.batchDraw).toHaveBeenCalledTimes(1);
  });

  it("skips layers detached before flush", () => {
    const layer = createLayer(false);

    requestRuntimeAnimationLayerDraw(layer as never);
    flushRuntimeAnimationLayerDraws();

    expect(layer.batchDraw).not.toHaveBeenCalled();
  });

  it("disables Konva auto draw while animation handlers mutate nodes", () => {
    const layer = createLayer();
    KonvaGlobal.autoDrawEnabled = true;

    runRuntimeAnimationHandlers([
      () => {
        expect(KonvaGlobal.autoDrawEnabled).toBe(false);
        requestRuntimeAnimationLayerDraw(layer as never);
      },
    ], 1000);

    expect(KonvaGlobal.autoDrawEnabled).toBe(true);
    expect(layer.batchDraw).toHaveBeenCalledTimes(1);
  });

  it("reads the runtime debug flag only when the global ticker starts", () => {
    const callbacks: FrameRequestCallback[] = [];
    const getItem = vi.fn(() => "1");
    vi.stubGlobal("window", { localStorage: { getItem } });
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const unsubscribe = subscribeGlobalAnimationTick(() => undefined);
    callbacks[0]?.(1000);
    callbacks[1]?.(2000);
    unsubscribe();

    expect(getItem).toHaveBeenCalledTimes(1);
  });
});

describe("areObjectNodePropsEqual", () => {
  const object = {
    id: "value",
    type: "value-display",
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    tag: "PV",
  } as HmiObject;
  const project: ScadaProject = {
    version: 1,
    name: "Test project",
    drivers: [],
    tags: [],
    screens: [],
  };
  const drivers: DriverStatus[] = [];
  const tagDefinitionsByName = new Map<string, TagDefinition>();
  const driverStatusesById = new Map<string, DriverStatus>();
  const libraries: ElementLibrary[] = [];
  const frameStack: string[] = [];
  const instanceStack: string[] = [];

  function createNodeProps(timestamp: number, value: number, quality: "Good" | "Bad" = "Good") {
    return {
      object,
      project,
      mode: "runtime",
      tags: {
        PV: {
          name: "PV",
          value,
          quality,
          timestamp,
          source: "test",
        },
      },
      drivers,
      tagDefinitionsByName,
      driverStatusesById,
      libraries,
      renderContext,
      frameStack,
      instanceStack,
      interactive: false,
      inheritedDisabled: false,
      selected: false,
      selectedObjectCount: 0,
      showObjectFrames: false,
      shadowDisabled: false,
      renderFlowMode: "all",
    };
  }

  it("ignores tag timestamp changes for regular object memo comparison", () => {
    expect(areObjectNodePropsEqual(createNodeProps(1, 10) as never, createNodeProps(2, 10) as never)).toBe(true);
  });

  it("keeps value and quality changes observable", () => {
    expect(areObjectNodePropsEqual(createNodeProps(1, 10) as never, createNodeProps(1, 11) as never)).toBe(false);
    expect(areObjectNodePropsEqual(createNodeProps(1, 10) as never, createNodeProps(1, 10, "Bad") as never)).toBe(false);
  });
});
