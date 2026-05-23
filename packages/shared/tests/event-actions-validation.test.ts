import { describe, expect, it } from "vitest";
import { projectSchema } from "../src/validation";

describe("event action validation", () => {
  it("accepts onActiveActions/onClearedActions/onAckActions on events", () => {
    const parsed = projectSchema.parse({
      version: 1,
      name: "Event actions test",
      drivers: [],
      tags: [],
      screens: [
        {
          id: "screen_1",
          name: "Main",
          kind: "screen",
          width: 1280,
          height: 720,
          objects: [],
        },
      ],
      events: [
        {
          id: "ev_1",
          sourceTagName: "Tag1",
          message: "Test",
          onActiveActions: [
            { type: "write", tag: "Tag2", value: true },
          ],
          onClearedActions: [
            { type: "openPopup", popupScreenId: "popup_1" },
          ],
          onAckActions: [
            { type: "runMacro", macroId: "macro_1" },
          ],
        },
      ],
    });

    const event = parsed.events?.[0];
    expect(event?.onActiveActions?.[0]?.type).toBe("write");
    expect(event?.onClearedActions?.[0]?.type).toBe("openPopup");
    expect(event?.onAckActions?.[0]?.type).toBe("runMacro");
  });
});
