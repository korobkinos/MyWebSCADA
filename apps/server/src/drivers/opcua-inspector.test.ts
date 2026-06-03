import { AttributeIds, NodeClass } from "node-opcua";
import { describe, expect, it } from "vitest";
import { browseOpcUaNode, collectOpcUaSubtreeVariables } from "./opcua-inspector";

type FakeNode = {
  nodeId: string;
  browseName: string;
  displayName?: string;
  nodeClass: number;
  dataType?: string;
  valueRank?: number;
  arrayDimensions?: number[];
  accessLevel?: number;
  userAccessLevel?: number;
  value?: unknown;
  children?: string[];
};

function makeDataValue(value: unknown) {
  return {
    value: { value },
    statusCode: {
      isGood: () => true,
      isNotGood: () => false,
    },
    serverTimestamp: new Date(0),
  };
}

function makeSession(nodes: Record<string, FakeNode>) {
  return {
    async browse(input: unknown) {
      const browseOne = (request: { nodeId: string }) => {
        const node = nodes[request.nodeId];
        return {
          references: (node?.children ?? []).map((childId) => {
            const child = nodes[childId]!;
            return {
              nodeId: { toString: () => child.nodeId },
              browseName: { name: child.browseName, toString: () => child.browseName },
              displayName: { text: child.displayName ?? child.browseName },
              nodeClass: child.nodeClass,
            };
          }),
        };
      };

      return Array.isArray(input) ? input.map((item) => browseOne(item as { nodeId: string })) : browseOne(input as { nodeId: string });
    },
    async read(input: unknown) {
      const readOne = (request: { nodeId: string; attributeId: number }) => {
        const node = nodes[request.nodeId];
        switch (request.attributeId) {
          case AttributeIds.BrowseName:
            return makeDataValue({ name: node?.browseName });
          case AttributeIds.DisplayName:
            return makeDataValue({ text: node?.displayName ?? node?.browseName });
          case AttributeIds.NodeClass:
            return makeDataValue(node?.nodeClass);
          case AttributeIds.DataType:
            return makeDataValue(node?.dataType);
          case AttributeIds.AccessLevel:
            return makeDataValue(node?.accessLevel);
          case AttributeIds.UserAccessLevel:
            return makeDataValue(node?.userAccessLevel ?? node?.accessLevel ?? 1);
          case AttributeIds.ValueRank:
            return makeDataValue(node?.valueRank ?? -1);
          case AttributeIds.ArrayDimensions:
            return makeDataValue(node?.arrayDimensions ?? []);
          case AttributeIds.Value:
            return makeDataValue(node?.value);
          default:
            return makeDataValue(undefined);
        }
      };

      return Array.isArray(input) ? input.map((item) => readOne(item as { nodeId: string; attributeId: number })) : readOne(input as { nodeId: string; attributeId: number });
    },
  };
}

describe("collectOpcUaSubtreeVariables", () => {
  it("keeps normal variable import behavior", async () => {
    const session = makeSession({
      root: { nodeId: "root", browseName: "Root", nodeClass: NodeClass.Object, children: ["level"] },
      level: { nodeId: "level", browseName: "Level", nodeClass: NodeClass.Variable, dataType: "ns=0;i=11" },
    });

    const result = await collectOpcUaSubtreeVariables(session as never, "root", "Application");

    expect(result.candidates).toEqual([
      {
        nodeId: "level",
        browsePath: "Application.Level",
        dataType: "ns=0;i=11",
        writable: false,
      },
    ]);
  });

  it("expands scalar arrays into indexRange candidates", async () => {
    const session = makeSession({
      root: { nodeId: "root", browseName: "Root", nodeClass: NodeClass.Object, children: ["arr"] },
      arr: {
        nodeId: "arr",
        browseName: "SomeArray",
        nodeClass: NodeClass.Variable,
        dataType: "ns=0;i=11",
        valueRank: 1,
        arrayDimensions: [3],
        accessLevel: 3,
        userAccessLevel: 1,
        value: [10, 20, 30],
      },
    });

    const result = await collectOpcUaSubtreeVariables(session as never, "root", "Application");

    expect(result.candidates.map((item) => ({
      browsePath: item.browsePath,
      indexRange: item.indexRange,
      memberPath: item.memberPath,
      writable: item.writable,
    }))).toEqual([
      { browsePath: "Application.SomeArray", indexRange: undefined, memberPath: undefined, writable: true },
      { browsePath: "Application.SomeArray[0]", indexRange: "0", memberPath: undefined, writable: true },
      { browsePath: "Application.SomeArray[1]", indexRange: "1", memberPath: undefined, writable: true },
      { browsePath: "Application.SomeArray[2]", indexRange: "2", memberPath: undefined, writable: true },
    ]);
  });

  it("expands arrays of structures into indexRange and memberPath candidates", async () => {
    const session = makeSession({
      root: { nodeId: "root", browseName: "Root", nodeClass: NodeClass.Object, children: ["pid"] },
      pid: {
        nodeId: "pid",
        browseName: "pid_control",
        nodeClass: NodeClass.Variable,
        dataType: "ns=4;i=5001",
        valueRank: 1,
        arrayDimensions: [2],
        accessLevel: 3,
        value: [
          { down_out: true, up_out: false, nested: { gain: 1.5 } },
          { down_out: false, up_out: true, nested: { gain: 2.5 } },
        ],
      },
    });

    const result = await collectOpcUaSubtreeVariables(session as never, "root", "Application.GVL_REGULATOR");

    expect(result.candidates.map((item) => ({
      browsePath: item.browsePath,
      indexRange: item.indexRange,
      memberPath: item.memberPath,
      writable: item.writable,
    }))).toEqual([
      { browsePath: "Application.GVL_REGULATOR.pid_control", indexRange: undefined, memberPath: undefined, writable: true },
      { browsePath: "Application.GVL_REGULATOR.pid_control[0].down_out", indexRange: "0", memberPath: ["down_out"], writable: false },
      { browsePath: "Application.GVL_REGULATOR.pid_control[0].up_out", indexRange: "0", memberPath: ["up_out"], writable: false },
      { browsePath: "Application.GVL_REGULATOR.pid_control[0].nested.gain", indexRange: "0", memberPath: ["nested", "gain"], writable: false },
      { browsePath: "Application.GVL_REGULATOR.pid_control[1].down_out", indexRange: "1", memberPath: ["down_out"], writable: false },
      { browsePath: "Application.GVL_REGULATOR.pid_control[1].up_out", indexRange: "1", memberPath: ["up_out"], writable: false },
      { browsePath: "Application.GVL_REGULATOR.pid_control[1].nested.gain", indexRange: "1", memberPath: ["nested", "gain"], writable: false },
    ]);
  });
});

describe("browseOpcUaNode", () => {
  it("uses AccessLevel CurrentWrite when UserAccessLevel does not include it", async () => {
    const session = makeSession({
      root: { nodeId: "root", browseName: "Root", nodeClass: NodeClass.Object, children: ["level"] },
      level: {
        nodeId: "level",
        browseName: "Level",
        nodeClass: NodeClass.Variable,
        dataType: "ns=0;i=11",
        accessLevel: 3,
        userAccessLevel: 1,
      },
    });

    const result = await browseOpcUaNode(session as never, "root");

    expect(result[0]).toMatchObject({ nodeId: "level", writable: true });
  });
});
