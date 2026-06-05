import { afterEach, describe, expect, it, vi } from "vitest";
import type { TagValue } from "@web-scada/shared";
import { useScadaStore } from "./scada-store";

vi.mock("../services/api", () => ({
  api: {
    getEngineerToken: () => null,
    setEngineerToken: vi.fn(),
  },
  isAbortError: () => false,
}));

vi.mock("../ui", () => ({
  appToast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

function tag(name: string, value: number): TagValue {
  return {
    name,
    value,
    quality: "Good",
    timestamp: Date.now(),
    source: "test",
  };
}

describe("useScadaStore setTagValues", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useScadaStore.setState({ tags: {} });
  });

  it("does not copy the whole tag map for a small update batch", () => {
    const tags = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => {
      const name = `T${index}`;
      return [name, tag(name, index)];
    }));
    useScadaStore.setState({ tags });
    const assign = vi.spyOn(Object, "assign");

    useScadaStore.getState().setTagValues([tag("T10", 999)]);

    expect(assign.mock.calls.some((args) => args[1] === tags)).toBe(false);
    expect(useScadaStore.getState().tags.T10?.value).toBe(999);
    expect(useScadaStore.getState().tags.T999?.value).toBe(999);
  });
});
