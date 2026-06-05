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
        inheritedIndexRules: [
          {
            id: "rule-1",
            enabled: true,
            indexOffset: 3,
            indexMode: {
              type: "arrayIndex",
              occurrence: 0,
              operation: "add",
              valueFrom: "indexOffset",
            },
          },
        ],
        args: { valveName: "ПЗК-1" },
        modal: false,
        draggable: true,
        closable: true,
        resizable: false,
      },
    });

    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.zIndex).toBe(1);
    expect(next.items[0]?.inheritedIndexRules?.[0]?.indexOffset).toBe(3);
    expect(next.items[0]?.args).toEqual({ valveName: "ПЗК-1" });
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

  it("stores isolated context for multiple popup instances", () => {
    let state = createInitialPopupState();
    state = popupReducer(state, {
      type: "open",
      payload: {
        id: "p1",
        popupScreenId: "Popup_ValveControl",
        x: 100,
        y: 100,
        tagPrefix: "VALVES.PZK_1",
        args: { valveName: "ПЗК-1" },
        modal: false,
        draggable: true,
        closable: true,
        resizable: false,
      },
    });
    state = popupReducer(state, {
      type: "open",
      payload: {
        id: "p2",
        popupScreenId: "Popup_ValveControl",
        x: 140,
        y: 140,
        tagPrefix: "VALVES.PZK_2",
        args: { valveName: "ПЗК-2" },
        modal: false,
        draggable: true,
        closable: true,
        resizable: false,
      },
    });

    expect(state.items).toHaveLength(2);
    expect(state.items[0]?.popupScreenId).toBe("Popup_ValveControl");
    expect(state.items[1]?.popupScreenId).toBe("Popup_ValveControl");
    expect(state.items[0]?.tagPrefix).toBe("VALVES.PZK_1");
    expect(state.items[1]?.tagPrefix).toBe("VALVES.PZK_2");
    expect(state.items[0]?.args).toEqual({ valveName: "ПЗК-1" });
    expect(state.items[1]?.args).toEqual({ valveName: "ПЗК-2" });
  });

  it("updates and focuses an existing keyed popup instead of adding a duplicate", () => {
    const first = popupReducer(createInitialPopupState(), {
      type: "open",
      payload: {
        id: "popup_1",
        popupKey: "screen:ValvePopup",
        popupScreenId: "ValvePopup",
        title: "Valve 1",
        x: 100,
        y: 120,
        tagPrefix: "VALVE.1",
        args: { valve: 1 },
        modal: false,
        draggable: true,
        closable: true,
        resizable: false,
      },
    });

    const second = popupReducer(first, {
      type: "open",
      payload: {
        id: "popup_2",
        popupKey: "screen:ValvePopup",
        popupScreenId: "ValvePopup",
        title: "Valve 2",
        x: 200,
        y: 220,
        tagPrefix: "VALVE.2",
        args: { valve: 2 },
        modal: false,
        draggable: true,
        closable: true,
        resizable: false,
      },
    });

    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({
      id: "popup_1",
      popupKey: "screen:ValvePopup",
      title: "Valve 2",
      tagPrefix: "VALVE.2",
      args: { valve: 2 },
    });
    expect(second.items[0]?.zIndex).toBeGreaterThan(first.items[0]?.zIndex ?? 0);
  });
});
