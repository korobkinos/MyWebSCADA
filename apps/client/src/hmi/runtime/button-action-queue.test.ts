import { describe, expect, it, vi } from "vitest";
import type { ButtonActionStep } from "@web-scada/shared";
import { executeButtonActionQueue } from "./button-action-queue";

function step(id: string, patch: Partial<ButtonActionStep> = {}): ButtonActionStep {
  return {
    id,
    action: { type: "runMacro", macroId: id },
    ...patch,
  };
}

describe("executeButtonActionQueue", () => {
  it("executes enabled steps strictly in order", async () => {
    const completed: string[] = [];

    await executeButtonActionQueue({
      steps: [step("one"), step("disabled", { enabled: false }), step("two")],
      execute: async (item) => {
        await Promise.resolve();
        completed.push(item.id);
      },
    });

    expect(completed).toEqual(["one", "two"]);
  });

  it("continues after an error when configured", async () => {
    const completed: string[] = [];
    const warn = vi.fn();

    await executeButtonActionQueue({
      steps: [
        step("one", { onError: "continueQueue" }),
        step("two"),
      ],
      execute: async (item) => {
        if (item.id === "one") {
          throw new Error("failed");
        }
        completed.push(item.id);
      },
      onWarn: warn,
    });

    expect(completed).toEqual(["two"]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("stops and reports an error for showErrorAndStop", async () => {
    const completed: string[] = [];
    const showError = vi.fn();

    await executeButtonActionQueue({
      steps: [step("one"), step("two")],
      execute: async (item) => {
        if (item.id === "one") {
          throw new Error("failed");
        }
        completed.push(item.id);
      },
      onShowError: showError,
    });

    expect(completed).toEqual([]);
    expect(showError).toHaveBeenCalledOnce();
  });

  it("times out a step and continues when configured", async () => {
    vi.useFakeTimers();
    const completed: string[] = [];

    const promise = executeButtonActionQueue({
      steps: [
        step("slow", { timeoutMs: 100, onError: "continueQueue" }),
        step("two"),
      ],
      execute: async (item) => {
        if (item.id === "slow") {
          await new Promise(() => undefined);
        }
        completed.push(item.id);
      },
    });

    await vi.advanceTimersByTimeAsync(100);
    await promise;
    vi.useRealTimers();

    expect(completed).toEqual(["two"]);
  });
});
