import { describe, expect, it } from "vitest";
import { resolveParameters } from "../src/parameter-resolver";

describe("resolveParameters", () => {
  it("replaces template tokens in nested object fields", () => {
    const input = {
      text: "Насос {{label}}",
      action: {
        confirmText: "Запустить {{label}}?",
      },
    };
    const result = resolveParameters(input, { label: "Рециркуляции" }) as typeof input;
    expect(result.text).toBe("Насос Рециркуляции");
    expect(result.action.confirmText).toBe("Запустить Рециркуляции?");
  });
});

