import { describe, expect, it } from "vitest";
import { shouldShowManualCommandToast, shouldSuppressManualCommandError } from "./runtime-command-errors";

describe("shouldSuppressManualCommandError", () => {
  it("suppresses AbortError for superseded slider write commands", () => {
    const error = new DOMException("The operation was aborted", "AbortError");

    expect(shouldSuppressManualCommandError(error, "superseded")).toBe(true);
  });

  it("does not suppress real timeout errors", () => {
    const error = Object.assign(new Error("Command timeout after 10000 ms"), { reason: "timeout" });

    expect(shouldSuppressManualCommandError(error, undefined)).toBe(false);
  });
});

describe("shouldShowManualCommandToast", () => {
  it("hides timeout toasts for slider latest-write commands", () => {
    expect(shouldShowManualCommandToast("timeout", {
      parameters: {
        __operatorActionKind: "slider",
        __allowConcurrentWrite: true,
      },
    })).toBe(false);
  });

  it("keeps timeout toasts for non-slider commands", () => {
    expect(shouldShowManualCommandToast("timeout", {
      parameters: {
        __operatorActionKind: "button",
      },
    })).toBe(true);
  });
});
