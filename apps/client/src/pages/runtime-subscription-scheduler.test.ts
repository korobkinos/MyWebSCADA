import { describe, expect, it } from "vitest";
import { createRuntimeSubscriptionScheduler } from "./runtime-subscription-scheduler";

describe("createRuntimeSubscriptionScheduler", () => {
  it("runs the latest recalculation after a dependency changes inside the throttle interval", () => {
    let now = 1_000;
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const runs: string[] = [];
    const scheduler = createRuntimeSubscriptionScheduler({
      now: () => now,
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return callback;
      },
      cancel: () => undefined,
    });

    scheduler.request(() => runs.push("initial"));

    now = 1_050;
    scheduler.request(() => runs.push("index-1"));
    now = 1_100;
    scheduler.request(() => runs.push("index-2"));

    expect(runs).toEqual(["initial"]);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delayMs).toBe(150);

    now = 1_200;
    scheduled[0]?.callback();

    expect(runs).toEqual(["initial", "index-2"]);
  });
});
