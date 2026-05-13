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
});
