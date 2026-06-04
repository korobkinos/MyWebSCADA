import { describe, expect, it } from "vitest";
import type { HmiObject, RenderContext, ScadaProject, TagDefinition } from "@web-scada/shared";
import { findTagByAddress, getTagAddressTemplate, resolveObjectTagField } from "./indexed-address";

function createProject(tags: string[]): ScadaProject {
  return {
    version: 1,
    name: "test-project",
    drivers: [],
    tags: tags.map((name) => ({
      name,
      dataType: "INT",
      address: { nodeId: name },
    })),
    screens: [],
  };
}

function createBaseObject(id: string): Pick<HmiObject, "id" | "x" | "y" | "width" | "height"> {
  return {
    id,
    x: 0,
    y: 0,
    width: 100,
    height: 30,
  };
}

describe("resolveObjectTagField with frame inherited index rules", () => {
  it("finds matching tag by tag name", () => {
    const project: ScadaProject = {
      version: 1,
      name: "Name matching project",
      drivers: [],
      tags: [{
        name: "Application.GVL_BURNER_VALVE.open_state[1]",
        dataType: "BOOL",
        address: { nodeId: "Other.Format.OpenState1" },
      }],
      screens: [],
    };

    expect(findTagByAddress(project, "Application.GVL_BURNER_VALVE.open_state[1]")?.name)
      .toBe("Application.GVL_BURNER_VALVE.open_state[1]");
  });

  it("finds matching tag when nodeId has OPC UA prefix", () => {
    const project: ScadaProject = {
      version: 1,
      name: "Prefixed nodeId project",
      drivers: [],
      tags: [{
        name: "Open state 1",
        nodeId: "ns=2;s=Application.GVL_BURNER_VALVE.open_state[1]",
        dataType: "BOOL",
      }],
      screens: [],
    };

    expect(findTagByAddress(project, "Application.GVL_BURNER_VALVE.open_state[1]")?.name)
      .toBe("Open state 1");
  });

  it("prefers indexed address candidates for tag address templates", () => {
    const tag = {
      name: "Application.GVL_BURNER_VALVE.open",
      nodeId: "Application.GVL_BURNER_VALVE.open",
      addressRaw: "Application.GVL_BURNER_VALVE.open[0]",
      address: { nodeId: "Application.GVL_BURNER_VALVE.open[0]" },
      dataType: "BOOL",
    } as TagDefinition & { addressRaw: string };
    const template = getTagAddressTemplate(tag);

    expect(template).toBe("Application.GVL_BURNER_VALVE.open[0]");
  });

  it("applies inherited arrayIndex rule when local indexing is absent", () => {
    const object: HmiObject = {
      ...createBaseObject("text-1"),
      type: "text",
      text: "Value",
      tag: "Burner[1].Pressure",
      textStyle: {
        fontFamily: "Arial",
        fontSize: 12,
        color: "#fff",
        horizontalAlign: "left",
        verticalAlign: "middle",
      },
    };
    const context: RenderContext = {
      inheritedIndexRules: [
        {
          id: "frame-rule-1",
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
    };

    const resolved = resolveObjectTagField({
      object,
      fieldName: "tag",
      project: createProject(["Burner[1].Pressure", "Burner[2].Pressure"]),
      context,
      rawTagName: object.tag,
    });

    expect(resolved.resolvedTagName).toBe("Burner[2].Pressure");
    expect(resolved.usedIndexedAddress).toBe(true);
  });

  it("applies inherited arrayIndexBySegment only for target segment", () => {
    const object: HmiObject = {
      ...createBaseObject("text-2"),
      type: "text",
      text: "Value",
      tag: "Burner[1].Valve[3].Open",
      textStyle: {
        fontFamily: "Arial",
        fontSize: 12,
        color: "#fff",
        horizontalAlign: "left",
        verticalAlign: "middle",
      },
    };
    const context: RenderContext = {
      inheritedIndexRules: [
        {
          id: "frame-rule-2",
          enabled: true,
          indexOffset: 2,
          indexMode: {
            type: "arrayIndexBySegment",
            segmentName: "Burner",
            operation: "add",
            valueFrom: "indexOffset",
          },
          conflictMode: "skipLocal",
        },
      ],
    };

    const resolved = resolveObjectTagField({
      object,
      fieldName: "tag",
      project: createProject(["Burner[1].Valve[3].Open", "Burner[3].Valve[3].Open"]),
      context,
      rawTagName: object.tag,
    });

    expect(resolved.resolvedTagName).toBe("Burner[3].Valve[3].Open");
  });

  it("keeps local indexing precedence over inherited rules", () => {
    const object: HmiObject = {
      ...createBaseObject("text-3"),
      type: "text",
      text: "Value",
      tag: "Burner[1].Pressure",
      tagIndexing: {
        enabled: true,
        template: "Burner[0].Pressure",
        bindings: [
          {
            key: "INDEX_1",
            slotIndex: 0,
            baseValue: 0,
            source: "constant",
            constantValue: 2,
            offset: 0,
          },
        ],
      },
      textStyle: {
        fontFamily: "Arial",
        fontSize: 12,
        color: "#fff",
        horizontalAlign: "left",
        verticalAlign: "middle",
      },
    };
    const context: RenderContext = {
      inheritedIndexRules: [
        {
          id: "frame-rule-3",
          enabled: true,
          indexOffset: 5,
          indexMode: {
            type: "arrayIndex",
            occurrence: 0,
            operation: "add",
            valueFrom: "indexOffset",
          },
          conflictMode: "skipLocal",
        },
      ],
    };

    const resolved = resolveObjectTagField({
      object,
      fieldName: "tag",
      project: createProject(["Burner[1].Pressure", "Burner[2].Pressure", "Burner[6].Pressure"]),
      context,
      rawTagName: object.tag,
    });

    expect(resolved.resolvedTagName).toBe("Burner[2].Pressure");
  });

  it("applies inherited rules for action.tag field", () => {
    const object: HmiObject = {
      ...createBaseObject("button-1"),
      type: "button",
      text: "Write",
      showText: true,
      textStyle: {
        fontFamily: "Arial",
        fontSize: 12,
        color: "#fff",
        horizontalAlign: "center",
        verticalAlign: "middle",
      },
      action: {
        type: "write",
        tag: "Burner[1].Cmd",
        value: true,
      },
    };
    const context: RenderContext = {
      inheritedIndexRules: [
        {
          id: "frame-rule-4",
          enabled: true,
          indexOffset: 2,
          indexMode: {
            type: "arrayIndex",
            occurrence: 0,
            operation: "add",
            valueFrom: "indexOffset",
          },
          conflictMode: "skipLocal",
        },
      ],
    };

    const resolved = resolveObjectTagField({
      object,
      fieldName: "action.tag",
      project: createProject(["Burner[1].Cmd", "Burner[3].Cmd"]),
      context,
      rawTagName: "Burner[1].Cmd",
    });

    expect(resolved.resolvedTagName).toBe("Burner[3].Cmd");
    expect(resolved.usedIndexedAddress).toBe(true);
  });

  it("uses indexOffsetSource static value for inherited rule", () => {
    const object: HmiObject = {
      ...createBaseObject("text-4"),
      type: "text",
      text: "Value",
      tag: "Burner[1].Pressure",
      textStyle: {
        fontFamily: "Arial",
        fontSize: 12,
        color: "#fff",
        horizontalAlign: "left",
        verticalAlign: "middle",
      },
    };
    const context: RenderContext = {
      inheritedIndexRules: [
        {
          id: "frame-rule-source-static",
          enabled: true,
          indexOffset: 1,
          indexOffsetSource: {
            type: "static",
            value: 4,
          },
          indexMode: {
            type: "arrayIndex",
            occurrence: 0,
            operation: "add",
            valueFrom: "indexOffset",
          },
          conflictMode: "skipLocal",
        },
      ],
    };

    const resolved = resolveObjectTagField({
      object,
      fieldName: "tag",
      project: createProject(["Burner[1].Pressure", "Burner[5].Pressure"]),
      context,
      rawTagName: object.tag,
    });

    expect(resolved.resolvedTagName).toBe("Burner[5].Pressure");
  });

  it("falls back to indexOffset when source is non-numeric", () => {
    const object: HmiObject = {
      ...createBaseObject("text-5"),
      type: "text",
      text: "Value",
      tag: "Burner[1].Pressure",
      textStyle: {
        fontFamily: "Arial",
        fontSize: 12,
        color: "#fff",
        horizontalAlign: "left",
        verticalAlign: "middle",
      },
    };
    const context: RenderContext = {
      inheritedIndexRules: [
        {
          id: "frame-rule-source-fallback",
          enabled: true,
          indexOffset: 2,
          indexOffsetSource: {
            type: "expression",
            expression: "\"bad\"",
          },
          indexMode: {
            type: "arrayIndex",
            occurrence: 0,
            operation: "add",
            valueFrom: "indexOffset",
          },
          conflictMode: "skipLocal",
        },
      ],
    };

    const resolved = resolveObjectTagField({
      object,
      fieldName: "tag",
      project: createProject(["Burner[1].Pressure", "Burner[3].Pressure"]),
      context,
      rawTagName: object.tag,
    });

    expect(resolved.resolvedTagName).toBe("Burner[3].Pressure");
  });
});
