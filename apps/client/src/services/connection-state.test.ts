import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConnectionSnapshot,
  getConnectivityBackoffSequenceMs,
  markEndpointFailure,
  markEndpointSuccess,
  resetConnectionStateForTests,
} from "./connection-state";

describe("connection-state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    resetConnectionStateForTests();
  });

  it("uses expected backoff sequence with 30s cap", () => {
    const expected = getConnectivityBackoffSequenceMs();
    for (let index = 0; index < expected.length; index += 1) {
      markEndpointFailure("trendsQuery", `failure-${index}`);
      const snapshot = getConnectionSnapshot();
      const delay = snapshot.endpoints.trendsQuery.nextAllowedAt - Date.now();
      expect(delay).toBe(expected[index]);
    }
    markEndpointFailure("trendsQuery", "failure-cap");
    const cappedSnapshot = getConnectionSnapshot();
    const cappedDelay = cappedSnapshot.endpoints.trendsQuery.nextAllowedAt - Date.now();
    expect(cappedDelay).toBe(30_000);
  });

  it("moves online -> degraded -> offline and resets to online after success", () => {
    expect(getConnectionSnapshot().state).toBe("online");

    markEndpointFailure("runtimeStatus", "one");
    expect(getConnectionSnapshot().state).toBe("degraded");

    markEndpointFailure("runtimeStatus", "two");
    markEndpointFailure("runtimeStatus", "three");
    expect(getConnectionSnapshot().state).toBe("offline");

    markEndpointSuccess("runtimeStatus");
    const snapshot = getConnectionSnapshot();
    expect(snapshot.state).toBe("online");
    expect(snapshot.lastError).toBeNull();
    expect(snapshot.endpoints.runtimeStatus.failures).toBe(0);
  });
});
