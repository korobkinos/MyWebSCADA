import { describe, expect, it, vi } from "vitest";
import { TrendQueryRateLimiter } from "./trendQueryRateLimiter";

describe("TrendQueryRateLimiter", () => {
  it("runs first query immediately", async () => {
    const limiter = new TrendQueryRateLimiter(2000);
    const run = vi.fn(async () => "ok");

    await expect(limiter.schedule(run)).resolves.toBe("ok");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("coalesces queries requested before the minimum interval", async () => {
    vi.useFakeTimers();
    try {
      let now = 10_000;
      const limiter = new TrendQueryRateLimiter(2000, () => now);
      const first = vi.fn(async () => "first");
      const second = vi.fn(async () => "second");
      const third = vi.fn(async () => "third");

      await expect(limiter.schedule(first)).resolves.toBe("first");
      now += 500;
      const secondPromise = limiter.schedule(second);
      const thirdPromise = limiter.schedule(third);

      await vi.advanceTimersByTimeAsync(1499);
      expect(second).not.toHaveBeenCalled();
      expect(third).not.toHaveBeenCalled();

      now += 1500;
      await vi.advanceTimersByTimeAsync(1);

      await expect(secondPromise).resolves.toBe("third");
      await expect(thirdPromise).resolves.toBe("third");
      expect(second).not.toHaveBeenCalled();
      expect(third).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
