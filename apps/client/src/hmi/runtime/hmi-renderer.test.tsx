import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HmiObject, HmiScreen, RenderContext, ScadaProject } from "@web-scada/shared";

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
  RUNTIME_COLOR_TRANSITION_MS,
  computeRuntimeColorTransitionFrame,
  flushRuntimeAnimationLayerDraws,
  requestRuntimeAnimationLayerDraw,
} from "./hmi-renderer";

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

describe("runtime color transition", () => {
  it("interpolates hex colors over the default duration", () => {
    const frame = computeRuntimeColorTransitionFrame({
      fromColor: "#808080",
      toColor: "#ffff00",
      startedAt: 1000,
      now: 1000 + RUNTIME_COLOR_TRANSITION_MS / 2,
      durationMs: RUNTIME_COLOR_TRANSITION_MS,
    });

    expect(frame).toEqual({
      color: "rgba(192, 192, 64, 1)",
      rgba: { r: 192, g: 192, b: 64, a: 1 },
      done: false,
    });
  });

  it("can start a new transition from the current interpolated color", () => {
    const firstFrame = computeRuntimeColorTransitionFrame({
      fromColor: "#808080",
      toColor: "#ffff00",
      startedAt: 0,
      now: 100,
      durationMs: RUNTIME_COLOR_TRANSITION_MS,
    });

    expect(firstFrame).not.toBeNull();

    const secondFrame = computeRuntimeColorTransitionFrame({
      fromColor: firstFrame!.rgba,
      toColor: "#ffffff",
      startedAt: 100,
      now: 125,
      durationMs: RUNTIME_COLOR_TRANSITION_MS,
    });

    expect(secondFrame?.color).toBe("rgba(187, 187, 95, 1)");
  });

  it("returns the target color exactly when the transition is complete", () => {
    const frame = computeRuntimeColorTransitionFrame({
      fromColor: "#808080",
      toColor: "#ffff00",
      startedAt: 0,
      now: RUNTIME_COLOR_TRANSITION_MS,
      durationMs: RUNTIME_COLOR_TRANSITION_MS,
    });

    expect(frame).toEqual({
      color: "#ffff00",
      rgba: { r: 255, g: 255, b: 0, a: 1 },
      done: true,
    });
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
});
