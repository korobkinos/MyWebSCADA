import type { TrendQueryCacheEntry, TrendQueryResponse } from "./trendTypes";

export class TrendQueryCache {
  private readonly entries = new Map<string, TrendQueryCacheEntry>();

  public constructor(private readonly maxSize: number) {}

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
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, {
      key,
      value,
      createdAt: Date.now(),
    });
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  public clear(): void {
    this.entries.clear();
  }
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
