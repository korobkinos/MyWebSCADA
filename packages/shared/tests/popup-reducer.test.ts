import { describe, expect, it } from "vitest";
import { createInitialPopupState, popupReducer } from "../src/popup-reducer";

describe("popupReducer", () => {
  it("opens popup and increments z-index", () => {
    const state = createInitialPopupState();
    const next = popupReducer(state, {
      type: "open",
      payload: {
        id: "p1",
        popupScreenId: "valve_popup",
        x: 100,
        y: 120,
        title: "Valve",
        tagPrefix: "Burner_1.PZK_1",
        modal: false,
        draggable: true,
        closable: true,
        resizable: false,
      },
    });

    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.zIndex).toBe(1);
    expect(next.nextZIndex).toBe(2);
  });

  it("closes top popup when no id passed", () => {
    const state = {
      items: [
        {
          id: "p1",
          popupScreenId: "a",
          x: 0,
          y: 0,
          zIndex: 1,
          modal: false,
          draggable: true,
          closable: true,
          resizable: false,
        },
        {
          id: "p2",
          popupScreenId: "b",
          x: 0,
          y: 0,
          zIndex: 2,
          modal: false,
          draggable: true,
          closable: true,
          resizable: false,
        },
      ],
      nextZIndex: 3,
    };

    const next = popupReducer(state, { type: "close", payload: {} });
    expect(next.items.map((item) => item.id)).toEqual(["p1"]);
  });
});
