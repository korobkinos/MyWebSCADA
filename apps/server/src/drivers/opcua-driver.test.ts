import { AttributeIds, DataType, VariantArrayType } from "node-opcua";
import { describe, expect, it } from "vitest";
import type { TagDefinition, TagScalarValue } from "@web-scada/shared";
import {
  resolveOpcUaDataValueForTag,
  toOpcUaReadValueId,
  toOpcUaStructureFieldWriteValue,
  toOpcUaWriteValue,
} from "./opcua-driver";

function makeDataValue(value: unknown, options?: { dataType?: DataType; arrayType?: VariantArrayType }) {
  return {
    value: {
      value,
      ...(options?.dataType !== undefined ? { dataType: options.dataType } : {}),
      ...(options?.arrayType !== undefined ? { arrayType: options.arrayType } : {}),
    },
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

  it("reads scalar array elements from the parent array and unwraps indexRange", () => {
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
    });
    expect(readValueId.indexRange).toBeUndefined();
    expect(resolveOpcUaDataValueForTag(makeDataValue([42, 7]) as never, tag)).toBe(42);
  });

  it("keeps compatibility with one-element indexRange read responses", () => {
    const tag: TagDefinition = {
      name: "Array[2]",
      sourceType: "opcua",
      dataType: "REAL",
      address: { nodeId: "ns=1;s=Array", indexRange: "2" },
    };

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

    const readValueId = toOpcUaReadValueId(tag);
    expect(readValueId.indexRange).toBeUndefined();
    expect(resolveOpcUaDataValueForTag(makeDataValue([{ down_out: true }, { down_out: false }]) as never, tag)).toBe(true);
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

  it("writes scalar BOOL values as OPC UA Boolean", () => {
    const tag: TagDefinition = {
      name: "Open",
      sourceType: "opcua",
      dataType: "BOOL",
      writable: true,
      address: { nodeId: "ns=1;s=Open" },
    };

    const writeValue = toOpcUaWriteValue(tag, true);
    const variant = writeValue.value.value as { dataType?: DataType; value?: unknown };

    expect(variant.dataType).toBe(DataType.Boolean);
    expect(variant.value).toBe(true);
  });

  it("uses tag dataType for scalar array element writes", () => {
    const cases: Array<[TagDefinition["dataType"], TagScalarValue, DataType]> = [
      ["BOOL", false, DataType.Boolean],
      ["REAL", 12.5, DataType.Float],
      ["INT", 12, DataType.Int16],
      ["DINT", 1234, DataType.Int32],
    ];

    for (const [dataType, value, expectedDataType] of cases) {
      const tag: TagDefinition = {
        name: `Array_${dataType}[0]`,
        sourceType: "opcua",
        dataType,
        writable: true,
        address: { nodeId: `ns=1;s=Array_${dataType}`, indexRange: "0" },
      };

      const writeValue = toOpcUaWriteValue(tag, value);
      const variant = writeValue.value.value as { arrayType?: VariantArrayType; dataType?: DataType; value?: unknown };

      expect(writeValue.indexRange?.toString()).toBe("0");
      expect(variant.arrayType).toBe(VariantArrayType.Array);
      expect(variant.dataType).toBe(expectedDataType);
      expect(variant.value).toEqual([value]);
    }
  });

  it("builds read-modify-write payloads for structure array fields", () => {
    const tag: TagDefinition = {
      name: "Pid[0].down_out",
      sourceType: "opcua",
      dataType: "BOOL",
      writable: true,
      address: { nodeId: "ns=1;s=Pid", indexRange: "0", memberPath: ["down_out"] },
    };
    const currentValue = [{ down_out: false }, { down_out: false }];

    const writeValue = toOpcUaStructureFieldWriteValue(
      tag,
      makeDataValue(currentValue, { dataType: DataType.ExtensionObject, arrayType: VariantArrayType.Array }) as never,
      true,
    );

    const variant = writeValue.value.value as { arrayType?: VariantArrayType; dataType?: DataType; value?: unknown };
    expect(writeValue.nodeId).toBe("ns=1;s=Pid");
    expect("indexRange" in writeValue ? writeValue.indexRange : undefined).toBeUndefined();
    expect(variant.arrayType).toBe(VariantArrayType.Array);
    expect(variant.dataType).toBe(DataType.ExtensionObject);
    expect(variant.value).toEqual([{ down_out: true }, { down_out: false }]);
    expect(currentValue).toEqual([{ down_out: false }, { down_out: false }]);
  });
});
