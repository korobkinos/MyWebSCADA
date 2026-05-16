import { describe, expect, it } from "vitest";
import type { ElementStateRule, HmiObject, RenderContext, TagValue } from "@web-scada/shared";
import { applyElementStateRules, evaluateElementStateCondition } from "./element-state-rules";

describe("element-state-rules", () => {
  it("applies setFill action when binding tag source matches equals condition", () => {
    const objects: HmiObject[] = [
      {
        id: "valve-body",
        type: "rectangle",
        name: "Valve body",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        fill: "#595959",
        stroke: "#d9d9d9",
        strokeWidth: 1,
      },
    ];

    const rules: ElementStateRule[] = [
      {
        id: "rule-visual-state",
        name: "Visual state rule",
        source: {
          type: "tag",
          value: "$binding.visualState",
        },
        cases: [
          {
            id: "case-opened",
            name: "Opened",
            condition: {
              type: "equals",
              value: 2,
            },
            actions: [
              {
                type: "setFill",
                objectId: "valve-body",
                color: "#52c41a",
              },
            ],
          },
        ],
      },
    ];

    const tags: Record<string, TagValue> = {
      "GVL_VALVE.valves[69].VisualState": {
        name: "GVL_VALVE.valves[69].VisualState",
        value: 2,
        quality: "Good",
        timestamp: 1,
        source: "test",
      },
    };

    const renderContext: RenderContext = {
      bindings: {
        visualState: "GVL_VALVE.valves[69].VisualState",
      },
    };

    const result = applyElementStateRules(objects, rules, {
      tags,
      renderContext,
      parameters: {},
    });

    const rectangle = result[0];
    expect(rectangle?.type).toBe("rectangle");
    if (rectangle?.type === "rectangle") {
      expect(rectangle.fill).toBe("#52c41a");
    }
  });

  it("does not mutate original objects", () => {
    const objects: HmiObject[] = [
      {
        id: "valve-body",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        fill: "#595959",
      },
    ];

    const rules: ElementStateRule[] = [
      {
        id: "rule-1",
        name: "Rule 1",
        source: {
          type: "parameter",
          value: "state",
        },
        cases: [
          {
            id: "case-1",
            name: "Case 1",
            condition: {
              type: "equals",
              value: 1,
            },
            actions: [
              {
                type: "setFill",
                objectId: "valve-body",
                color: "#52c41a",
              },
            ],
          },
        ],
      },
    ];

    const result = applyElementStateRules(objects, rules, {
      tags: {},
      renderContext: {},
      parameters: {
        state: 1,
      },
    });

    const original = objects[0];
    const patched = result[0];

    expect(original).not.toBe(patched);
    if (original?.type === "rectangle") {
      expect(original.fill).toBe("#595959");
    }
    if (patched?.type === "rectangle") {
      expect(patched.fill).toBe("#52c41a");
    }
  });

  it("evaluates numeric comparison conditions", () => {
    expect(evaluateElementStateCondition(10, { type: "greaterThan", value: 5 })).toBe(true);
    expect(evaluateElementStateCondition(10, { type: "lessThan", value: 5 })).toBe(false);
    expect(evaluateElementStateCondition(10, { type: "between", min: 5, max: 15 })).toBe(true);
  });

  it("returns original objects when rules are undefined", () => {
    const objects: HmiObject[] = [
      {
        id: "test",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        fill: "#595959",
      },
    ];

    const result = applyElementStateRules(objects, undefined, {
      tags: {},
      renderContext: {},
      parameters: {},
    });

    expect(result).toBe(objects);
  });

  it("returns original objects when rules are empty", () => {
    const objects: HmiObject[] = [
      {
        id: "test",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        fill: "#595959",
      },
    ];

    const result = applyElementStateRules(objects, [], {
      tags: {},
      renderContext: {},
      parameters: {},
    });

    expect(result).toBe(objects);
  });

  it("applies setStroke action to rectangle", () => {
    const objects: HmiObject[] = [
      {
        id: "rect-1",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        fill: "#595959",
        stroke: "#d9d9d9",
      },
    ];

    const rules: ElementStateRule[] = [
      {
        id: "rule-1",
        name: "Rule 1",
        source: { type: "parameter", value: "state" },
        cases: [
          {
            id: "case-1",
            name: "Case 1",
            condition: { type: "equals", value: 1 },
            actions: [
              {
                type: "setStroke",
                objectId: "rect-1",
                color: "#ff4d4f",
              },
            ],
          },
        ],
      },
    ];

    const result = applyElementStateRules(objects, rules, {
      tags: {},
      renderContext: {},
      parameters: { state: 1 },
    });

    const rect = result[0];
    if (rect?.type === "rectangle") {
      expect(rect.stroke).toBe("#ff4d4f");
    }
  });

  it("applies setVisible action", () => {
    const objects: HmiObject[] = [
      {
        id: "obj-1",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        fill: "#595959",
        visible: true,
      },
    ];

    const rules: ElementStateRule[] = [
      {
        id: "rule-1",
        name: "Rule 1",
        source: { type: "parameter", value: "hidden" },
        cases: [
          {
            id: "case-1",
            name: "Case 1",
            condition: { type: "equals", value: true },
            actions: [
              {
                type: "setVisible",
                objectId: "obj-1",
                visible: false,
              },
            ],
          },
        ],
      },
    ];

    const result = applyElementStateRules(objects, rules, {
      tags: {},
      renderContext: {},
      parameters: { hidden: true },
    });

    expect(result[0]?.visible).toBe(false);
  });

  it("does not apply action when condition does not match", () => {
    const objects: HmiObject[] = [
      {
        id: "rect-1",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        fill: "#595959",
      },
    ];

    const rules: ElementStateRule[] = [
      {
        id: "rule-1",
        name: "Rule 1",
        source: { type: "parameter", value: "state" },
        cases: [
          {
            id: "case-1",
            name: "Case 1",
            condition: { type: "equals", value: 2 },
            actions: [
              {
                type: "setFill",
                objectId: "rect-1",
                color: "#52c41a",
              },
            ],
          },
        ],
      },
    ];

    const result = applyElementStateRules(objects, rules, {
      tags: {},
      renderContext: {},
      parameters: { state: 1 },
    });

    const rect = result[0];
    if (rect?.type === "rectangle") {
      expect(rect.fill).toBe("#595959");
    }
  });

  it("applies action to nested object in group", () => {
    const objects: HmiObject[] = [
      {
        id: "group-1",
        type: "group",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        objects: [
          {
            id: "nested-rect",
            type: "rectangle",
            x: 0,
            y: 0,
            width: 50,
            height: 50,
            fill: "#595959",
          },
        ],
      },
    ];

    const rules: ElementStateRule[] = [
      {
        id: "rule-1",
        name: "Rule 1",
        source: { type: "parameter", value: "state" },
        cases: [
          {
            id: "case-1",
            name: "Case 1",
            condition: { type: "equals", value: 1 },
            actions: [
              {
                type: "setFill",
                objectId: "nested-rect",
                color: "#52c41a",
              },
            ],
          },
        ],
      },
    ];

    const result = applyElementStateRules(objects, rules, {
      tags: {},
      renderContext: {},
      parameters: { state: 1 },
    });

    const group = result[0];
    expect(group?.type).toBe("group");
    if (group?.type === "group") {
      const nested = group.objects[0];
      if (nested?.type === "rectangle") {
        expect(nested.fill).toBe("#52c41a");
      }
    }
  });

  it("applies setProperty action to nested scalar property", () => {
    const objects: HmiObject[] = [
      {
        id: "label-1",
        type: "text",
        x: 0,
        y: 0,
        width: 120,
        height: 24,
        text: "Valve",
        textStyle: {
          fontFamily: "Arial",
          fontSize: 14,
          color: "#ffffff",
          horizontalAlign: "left",
          verticalAlign: "middle",
        },
      },
    ];

    const rules: ElementStateRule[] = [
      {
        id: "rule-1",
        name: "Rule 1",
        source: { type: "parameter", value: "alarm" },
        cases: [
          {
            id: "case-1",
            name: "Case 1",
            condition: { type: "equals", value: true },
            actions: [
              {
                type: "setProperty",
                objectId: "label-1",
                property: "textStyle.color",
                value: "#ff4d4f",
              },
            ],
          },
        ],
      },
    ];

    const result = applyElementStateRules(objects, rules, {
      tags: {},
      renderContext: {},
      parameters: { alarm: true },
    });

    const text = result[0];
    if (text?.type === "text") {
      expect(text.textStyle.color).toBe("#ff4d4f");
    }
  });

  it("ignores unsafe setProperty path", () => {
    const objects: HmiObject[] = [
      {
        id: "rect-1",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        fill: "#595959",
      },
    ];

    const rules: ElementStateRule[] = [
      {
        id: "rule-1",
        name: "Rule 1",
        source: { type: "parameter", value: "state" },
        cases: [
          {
            id: "case-1",
            name: "Case 1",
            condition: { type: "equals", value: 1 },
            actions: [
              {
                type: "setProperty",
                objectId: "rect-1",
                property: "__proto__.polluted",
                value: "yes",
              },
            ],
          },
        ],
      },
    ];

    const result = applyElementStateRules(objects, rules, {
      tags: {},
      renderContext: {},
      parameters: { state: 1 },
    });

    const rect = result[0];
    if (rect?.type === "rectangle") {
      expect(rect.fill).toBe("#595959");
    }
  });
});
