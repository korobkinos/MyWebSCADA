import type { TagValue } from "@web-scada/shared";
import { describe, expect, it } from "vitest";
import { createTagValueBatcher } from "./tag-value-batcher";

function tag(name: string, value: TagValue["value"]): TagValue {
  return {
    name,
    value,
    quality: "Good",
    timestamp: Date.now(),
    source: "ws",
  };
}

describe("createTagValueBatcher", () => {
  it("merges packets by tag name and flushes only the latest value", () => {
    const scheduled: Array<() => void> = [];
    const flushed: TagValue[][] = [];
    const batcher = createTagValueBatcher((values) => flushed.push(values), {
      schedule: (callback) => {
        scheduled.push(callback);
        return callback;
      },
      cancel: () => undefined,
    });

    batcher.push([tag("A", 1), tag("B", 2)]);
    batcher.push([tag("A", 3)]);

    expect(flushed).toEqual([]);
    expect(scheduled).toHaveLength(1);

    expect(scheduled[0]).toBeDefined();
    scheduled[0]!();

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.map((item) => [item.name, item.value])).toEqual([
      ["A", 3],
      ["B", 2],
    ]);
  });

  it("does not flush after close", () => {
    const scheduled: Array<() => void> = [];
    const flushed: TagValue[][] = [];
    const batcher = createTagValueBatcher((values) => flushed.push(values), {
      schedule: (callback) => {
        scheduled.push(callback);
        return callback;
      },
      cancel: () => undefined,
    });

    batcher.push([tag("A", 1)]);
    batcher.close();
    expect(scheduled[0]).toBeDefined();
    scheduled[0]!();

    expect(flushed).toEqual([]);
  });
});
