import { AttributeIds, VariantArrayType } from "node-opcua";
import { describe, expect, it } from "vitest";
import type { TagDefinition } from "@web-scada/shared";
import { resolveOpcUaDataValueForTag, toOpcUaReadValueId, toOpcUaWriteValue } from "./opcua-driver";

function makeDataValue(value: unknown) {
  return {
    value: { value },
    statusCode: {
      isGood: () => true,
    },
  };
}

describe("OPC UA tag addressing", () => {
  it("keeps legacy nodeId-only reads unchanged", () => {
    const tag: TagDefinition = {
      name: "Level",
      sourceType: "opcua",
      dataType: "REAL",
      nodeId: "ns=1;s=Level",
    };

    expect(toOpcUaReadValueId(tag)).toEqual({
      nodeId: "ns=1;s=Level",
      attributeId: AttributeIds.Value,
    });
    expect(resolveOpcUaDataValueForTag(makeDataValue(12.5) as never, tag)).toBe(12.5);
  });

  it("passes indexRange to OPC UA reads and unwraps single-element arrays", () => {
    const tag: TagDefinition = {
      name: "Array[0]",
      sourceType: "opcua",
      dataType: "REAL",
      nodeId: "ns=1;s=Array",
      address: { nodeId: "ns=1;s=Array", indexRange: "0" },
    };

    const readValueId = toOpcUaReadValueId(tag);
    expect(readValueId).toEqual({
      nodeId: "ns=1;s=Array",
      attributeId: AttributeIds.Value,
      indexRange: expect.anything(),
    });
    expect(readValueId.indexRange?.toString()).toBe("0");
    expect(resolveOpcUaDataValueForTag(makeDataValue([42]) as never, tag)).toBe(42);
  });

  it("extracts structure fields after indexRange reads", () => {
    const tag: TagDefinition = {
      name: "Pid[0].down_out",
      sourceType: "opcua",
      dataType: "BOOL",
      nodeId: "ns=1;s=Pid",
      address: { nodeId: "ns=1;s=Pid", indexRange: "0", memberPath: ["down_out"] },
    };

    expect(resolveOpcUaDataValueForTag(makeDataValue([{ down_out: true }]) as never, tag)).toBe(true);
  });

  it("returns null when a memberPath cannot be resolved", () => {
    const tag: TagDefinition = {
      name: "Pid[0].missing",
      sourceType: "opcua",
      dataType: "BOOL",
      address: { nodeId: "ns=1;s=Pid", indexRange: "0", memberPath: ["missing"] },
    };

    expect(resolveOpcUaDataValueForTag(makeDataValue([{ down_out: true }]) as never, tag)).toBeNull();
  });

  it("writes indexRange scalar array elements as one-element arrays", () => {
    const tag: TagDefinition = {
      name: "Open[1]",
      sourceType: "opcua",
      dataType: "BOOL",
      writable: true,
      address: { nodeId: "ns=1;s=Open", indexRange: "1" },
    };

    const writeValue = toOpcUaWriteValue(tag, true);

    expect(writeValue.nodeId).toBe("ns=1;s=Open");
    expect(writeValue.indexRange?.toString()).toBe("1");
    const variant = writeValue.value.value as { arrayType?: VariantArrayType; value?: unknown };
    expect(variant.arrayType).toBe(VariantArrayType.Array);
    expect(variant.value).toEqual([true]);
  });

  it("keeps structure field writes read-only", () => {
    const tag: TagDefinition = {
      name: "Pid[0].down_out",
      sourceType: "opcua",
      dataType: "BOOL",
      writable: true,
      address: { nodeId: "ns=1;s=Pid", indexRange: "0", memberPath: ["down_out"] },
    };

    expect(() => toOpcUaWriteValue(tag, true)).toThrow("structure field addressing");
  });
});
