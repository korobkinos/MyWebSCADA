import { describe, expect, it, vi } from "vitest";
import { getRuntimeDiagnosticsSnapshot, registerPollingLoop } from "./runtime-diagnostics";

describe("runtime diagnostics polling loop registry", () => {
  it("counts duplicate loop registrations and unregisters each handle", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const unregisterA = registerPollingLoop("trend-live-archive:widget-1");
      const unregisterB = registerPollingLoop("trend-live-archive:widget-1");

      expect(getRuntimeDiagnosticsSnapshot().activePollingLoops).toBe(2);
      expect(warn).toHaveBeenCalled();

      unregisterA();
      expect(getRuntimeDiagnosticsSnapshot().activePollingLoops).toBe(1);

      unregisterB();
      expect(getRuntimeDiagnosticsSnapshot().activePollingLoops).toBe(0);
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });
});
