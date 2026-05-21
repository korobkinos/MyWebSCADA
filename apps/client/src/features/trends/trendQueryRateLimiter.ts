type PendingRequest<T> = {
  run: () => Promise<T>;
  waiters: Array<{
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
  }>;
};

export class TrendQueryRateLimiter<T = unknown> {
  private lastRunAt = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private pending: PendingRequest<T> | null = null;

  public constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public schedule(run: () => Promise<T>): Promise<T> {
    const delayMs = Math.max(0, this.minIntervalMs - (this.now() - this.lastRunAt));
    if (delayMs <= 0 && this.timerId === null) {
      this.lastRunAt = this.now();
      return run();
    }

    return new Promise<T>((resolve, reject) => {
      const previous = this.pending;
      if (previous) {
        previous.run = run;
        previous.waiters.push({ resolve, reject });
      } else {
        this.pending = { run, waiters: [{ resolve, reject }] };
      }
      if (this.timerId !== null) {
        return;
      }
      this.timerId = setTimeout(() => {
        this.timerId = null;
        void this.flush();
      }, delayMs);
    });
  }

  public cancel(value?: T, reason?: unknown): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    const pending = this.pending;
    this.pending = null;
    for (const waiter of pending?.waiters ?? []) {
      if (value !== undefined) {
        waiter.resolve(value);
      } else {
        waiter.reject(reason ?? new DOMException("The operation was aborted.", "AbortError"));
      }
    }
  }

  private async flush(): Promise<void> {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    this.pending = null;
    this.lastRunAt = this.now();
    try {
      const result = await pending.run();
      for (const waiter of pending.waiters) {
        waiter.resolve(result);
      }
    } catch (error) {
      for (const waiter of pending.waiters) {
        waiter.reject(error);
      }
    }
  }
}
