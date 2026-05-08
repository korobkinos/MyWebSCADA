export type PopupInstance = {
  id: string;
  popupScreenId: string;
  popupKey?: string;
  title?: string;
  x: number;
  y: number;
  zIndex: number;
  tagPrefix?: string;
  args?: Record<string, unknown>;
  modal: boolean;
  draggable: boolean;
  closable: boolean;
  resizable: boolean;
};

export type PopupState = {
  items: PopupInstance[];
  nextZIndex: number;
};

export type PopupReducerAction =
  | {
      type: "open";
      payload: Omit<PopupInstance, "zIndex">;
    }
  | {
      type: "close";
      payload?: {
        id?: string;
      };
    }
  | {
      type: "focus";
      payload: {
        id: string;
      };
    }
  | {
      type: "move";
      payload: {
        id: string;
        x: number;
        y: number;
      };
    };

export function createInitialPopupState(): PopupState {
  return {
    items: [],
    nextZIndex: 1,
  };
}

export function popupReducer(state: PopupState, action: PopupReducerAction): PopupState {
  if (action.type === "open") {
    const next: PopupInstance = {
      ...action.payload,
      zIndex: state.nextZIndex,
    };
    return {
      items: [...state.items, next],
      nextZIndex: state.nextZIndex + 1,
    };
  }

  if (action.type === "close") {
    if (state.items.length === 0) {
      return state;
    }

    if (!action.payload?.id) {
      const last = [...state.items].sort((a, b) => b.zIndex - a.zIndex)[0];
      if (!last) {
        return state;
      }
      return {
        ...state,
        items: state.items.filter((item) => item.id !== last.id),
      };
    }

    const popupId = action.payload.id;
    return {
      ...state,
      items: state.items.filter((item) => item.id !== popupId),
    };
  }

  if (action.type === "focus") {
    return {
      items: state.items.map((item) => (item.id === action.payload.id ? { ...item, zIndex: state.nextZIndex } : item)),
      nextZIndex: state.nextZIndex + 1,
    };
  }

  if (action.type === "move") {
    return {
      ...state,
      items: state.items.map((item) =>
        item.id === action.payload.id
          ? {
              ...item,
              x: action.payload.x,
              y: action.payload.y,
            }
          : item,
      ),
    };
  }

  return state;
}
