import { describe, expect, it } from "vitest";
import { shouldSuppressManualCommandError } from "./runtime-command-errors";

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
