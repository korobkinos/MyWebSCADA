import { describe, expect, it } from "vitest";
import { extractIndexedAddressSlots, resolveIndexedAddress, type IndexedTagAddress } from "./indexed-address";

describe("indexed-address", () => {
  it("extracts numeric slots by occurrence", () => {
    const slots = extractIndexedAddressSlots("a[1].b[1].c[i].d[12]");
    expect(slots.map((slot) => ({ key: slot.key, slotIndex: slot.slotIndex, baseValue: slot.baseValue }))).toEqual([
      { key: "INDEX_1", slotIndex: 0, baseValue: 1 },
      { key: "INDEX_2", slotIndex: 1, baseValue: 1 },
      { key: "INDEX_3", slotIndex: 2, baseValue: 12 },
    ]);
  });

  it("resolves each numeric slot independently", () => {
    const config: IndexedTagAddress = {
      enabled: true,
      template: "ns=2;s=Application.GVL_UDP.udp_cfg[1].local_port[1]",
      bindings: [
        {
          key: "INDEX_1",
          slotIndex: 0,
          baseValue: 1,
          source: "runtimeArg",
          sourceName: "udpCfgIndex",
        },
        {
          key: "INDEX_2",
          slotIndex: 1,
          baseValue: 1,
          source: "runtimeArg",
          sourceName: "portIndex",
        },
      ],
    };

    const result = resolveIndexedAddress({
      config,
      values: {
        udpCfgIndex: 2,
        portIndex: 4,
      },
    });

    expect(result.address).toBe("ns=2;s=Application.GVL_UDP.udp_cfg[3].local_port[5]");
    expect(result.errors).toEqual([]);
  });

  it("supports any number of slots and reports missing runtime values", () => {
    const config: IndexedTagAddress = {
      enabled: true,
      template: "a[1].b[2].c[3].d[4].e[5].f[6].g[7].h[8].i[9]",
      bindings: Array.from({ length: 9 }, (_, index) => ({
        key: `INDEX_${index + 1}`,
        slotIndex: index,
        baseValue: index + 1,
        source: "runtimeArg" as const,
        sourceName: index % 2 === 0 ? `v${index}` : undefined,
        offset: 1,
      })),
    };

    const result = resolveIndexedAddress({
      config,
      values: {
        v0: 1,
        v2: 2,
        v4: 3,
        v6: 4,
        v8: 5,
      },
    });

    expect(result.parts).toHaveLength(9);
    expect(result.address).toBe("a[3].b[3].c[6].d[5].e[9].f[7].g[12].h[9].i[15]");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("converts tag source values to numbers (number/string/boolean)", () => {
    const config: IndexedTagAddress = {
      enabled: true,
      template: "x[0].y[0].z[0].w[0]",
      bindings: [
        { key: "INDEX_1", slotIndex: 0, baseValue: 0, source: "tag", sourceName: "n" },
        { key: "INDEX_2", slotIndex: 1, baseValue: 0, source: "tag", sourceName: "s" },
        { key: "INDEX_3", slotIndex: 2, baseValue: 0, source: "tag", sourceName: "t" },
        { key: "INDEX_4", slotIndex: 3, baseValue: 0, source: "tag", sourceName: "f" },
      ],
    };

    const result = resolveIndexedAddress({
      config,
      values: {
        n: 4,
        s: "5",
        t: true,
        f: false,
      },
    });

    expect(result.address).toBe("x[4].y[5].z[1].w[0]");
    expect(result.errors).toEqual([]);
  });

  it("resolves Counter=4 to template index [4]", () => {
    const config: IndexedTagAddress = {
      enabled: true,
      template: "ns=2;s=Application.GVL_UDP.udp_channel_modbus[0].state.packet_count",
      bindings: [
        {
          key: "INDEX_1",
          slotIndex: 0,
          baseValue: 0,
          source: "tag",
          sourceName: "Counter",
          offset: 0,
        },
      ],
    };

    const result = resolveIndexedAddress({
      config,
      values: {
        Counter: 4,
      },
    });

    expect(result.address).toBe("ns=2;s=Application.GVL_UDP.udp_channel_modbus[4].state.packet_count");
    expect(result.errors).toEqual([]);
  });

  it("resolves tag sources from primitive and object payload values", () => {
    const config: IndexedTagAddress = {
      enabled: true,
      template: "a[0].b[1]",
      bindings: [
        {
          key: "INDEX_1",
          slotIndex: 0,
          baseValue: 0,
          source: "tag",
          sourceName: "Counter",
          offset: 0,
        },
        {
          key: "INDEX_2",
          slotIndex: 1,
          baseValue: 1,
          source: "tag",
          sourceName: "CounterObj",
          offset: 0,
        },
      ],
    };

    const result = resolveIndexedAddress({
      config,
      values: {
        Counter: 4,
        CounterObj: { value: 2, quality: "Good" },
      },
    });

    expect(result.address).toBe("a[4].b[3]");
    expect(result.parts[0]?.runtimeValue).toBe(4);
    expect(result.parts[1]?.runtimeValue).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it("accepts string slotIndex values and still resolves tag source", () => {
    const config: IndexedTagAddress = {
      enabled: true,
      template: "a[0]",
      bindings: [
        {
          key: "INDEX_1",
          slotIndex: "0" as unknown as number,
          baseValue: 0,
          source: "tag",
          sourceName: "Counter",
          offset: 0,
        },
      ],
    };

    const result = resolveIndexedAddress({
      config,
      values: {
        Counter: 4,
      },
    });

    expect(result.address).toBe("a[4]");
    expect(result.parts[0]?.runtimeValue).toBe(4);
    expect(result.errors).toEqual([]);
  });
});
