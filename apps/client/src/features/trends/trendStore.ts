import type { TrendQueryCacheEntry, TrendQueryResponse } from "./trendTypes";

type CacheEntry = TrendQueryCacheEntry & {
  pointCount: number;
};

export class TrendQueryCache {
  private readonly entries = new Map<string, CacheEntry>();
  private totalPointCount = 0;

  public constructor(
    private readonly maxSize: number,
    private readonly maxTotalPoints = 400_000,
  ) {}

  public get(key: string): TrendQueryResponse | undefined {
    const hit = this.entries.get(key);
    if (!hit) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  public set(key: string, value: TrendQueryResponse): void {
    const pointCount = estimateResponsePointCount(value);
    const existing = this.entries.get(key);
    if (existing) {
      this.totalPointCount -= existing.pointCount;
      this.entries.delete(key);
    }
    this.entries.set(key, {
      key,
      value,
      createdAt: Date.now(),
      pointCount,
    });
    this.totalPointCount += pointCount;
    while (this.entries.size > this.maxSize || this.totalPointCount > this.maxTotalPoints) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) {
        break;
      }
      const removed = this.entries.get(oldest);
      if (removed) {
        this.totalPointCount -= removed.pointCount;
      }
      this.entries.delete(oldest);
    }
  }

  public clear(): void {
    this.entries.clear();
    this.totalPointCount = 0;
  }

  public getStats(): { entryCount: number; pointCount: number; maxSize: number; maxTotalPoints: number } {
    return {
      entryCount: this.entries.size,
      pointCount: this.totalPointCount,
      maxSize: this.maxSize,
      maxTotalPoints: this.maxTotalPoints,
    };
  }
}

function estimateResponsePointCount(response: TrendQueryResponse): number {
  return response.series.reduce((count, series) => count + series.points.length, 0);
}

export function buildTrendCacheKey(input: {
  tags: string[];
  from: number;
  to: number;
  maxPoints: number;
  aggregation: string;
}): string {
  return `${input.tags.join("|")}__${input.from}__${input.to}__${input.maxPoints}__${input.aggregation}`;
}
