import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRuntimeDiagnosticsSnapshot,
  getRuntimeRateDiagnosticsSnapshot,
  recordSetTagValuesCall,
  recordWebSocketTagPacket,
  registerPollingLoop,
  resetRuntimeRateDiagnosticsForTest,
} from "./runtime-diagnostics";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runtime diagnostics polling loop registry", () => {
  it("counts duplicate loop registrations without logging by default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const unregisterA = registerPollingLoop("trend-live-archive:widget-1");
      const unregisterB = registerPollingLoop("trend-live-archive:widget-1");

      expect(getRuntimeDiagnosticsSnapshot().activePollingLoops).toBe(2);
      expect(warn).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();

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

describe("runtime diagnostics rate counters", () => {
  it("does not start the periodic reporter when console diagnostics are disabled", () => {
    const setInterval = vi.fn(() => 1);
    vi.stubGlobal("window", {
      localStorage: { getItem: vi.fn(() => null) },
      setInterval,
    });

    recordWebSocketTagPacket(1);

    expect(setInterval).not.toHaveBeenCalled();
  });

  it("counts websocket packets, tag values, and setTagValues calls", () => {
    resetRuntimeRateDiagnosticsForTest();

    recordWebSocketTagPacket(3);
    recordWebSocketTagPacket(2);
    recordSetTagValuesCall(4);

    expect(getRuntimeRateDiagnosticsSnapshot()).toEqual({
      webSocketTagPackets: 2,
      webSocketTagValues: 5,
      setTagValuesCalls: 1,
      setTagValuesValues: 4,
    });
  });
});
