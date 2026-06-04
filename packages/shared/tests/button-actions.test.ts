import { describe, expect, it } from "vitest";
import { getButtonActionSteps } from "../src/button-actions";
import type { ButtonObject } from "../src/hmi-object-types";
import { hmiObjectSchema } from "../src/validation";

function createButton(patch: Partial<ButtonObject>): ButtonObject {
  return {
    id: "button-1",
    type: "button",
    x: 0,
    y: 0,
    width: 100,
    height: 30,
    textStyle: {
      fontFamily: "Arial",
      fontSize: 14,
      color: "#fff",
      horizontalAlign: "center",
      verticalAlign: "middle",
    },
    ...patch,
  };
}

describe("getButtonActionSteps", () => {
  it("prefers the configured action queue", () => {
    const actions = [
      {
        id: "step-1",
        action: { type: "write" as const, tag: "Cmd", value: true },
      },
    ];

    expect(getButtonActionSteps(createButton({
      action: { type: "write", tag: "Legacy", value: false },
      actions,
    }))).toBe(actions);
  });

  it("wraps a legacy action with queue defaults", () => {
    expect(getButtonActionSteps(createButton({
      action: { type: "runMacro", macroId: "prepare" },
    }))).toEqual([
      {
        id: "legacy-action",
        enabled: true,
        action: { type: "runMacro", macroId: "prepare" },
        onError: "showErrorAndStop",
        timeoutMs: 5000,
      },
    ]);
  });

  it("allows a button without actions", () => {
    expect(getButtonActionSteps(createButton({}))).toEqual([]);
  });

  it("validates legacy and queued buttons while rejecting buttons without actions", () => {
    expect(hmiObjectSchema.safeParse(createButton({
      action: { type: "write", tag: "Cmd", value: true },
    })).success).toBe(true);
    expect(hmiObjectSchema.safeParse(createButton({
      actions: [{
        id: "step-1",
        action: { type: "write", tag: "Cmd", value: true },
        timeoutMs: 100,
      }],
    })).success).toBe(true);
    expect(hmiObjectSchema.safeParse(createButton({})).success).toBe(false);
  });
});
