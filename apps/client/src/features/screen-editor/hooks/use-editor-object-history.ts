import { useCallback, useRef } from "react";
import type { HmiObject, HmiScreen } from "@web-scada/shared";
import { message } from "antd";
import { useSnapshotHistory } from "../../../hooks/use-snapshot-history";
import { useScadaStore } from "../../../store/scada-store";
import {
  bringToFront,
  sendToBack,
  moveForward,
  moveBackward,
  getNextZIndex,
  ensureNormalized,
} from "../../../hmi/editor/z-order";

type SelectionState = {
  selectedObjectIds: string[];
};

type UseEditorObjectHistoryParams = {
  screen: HmiScreen | null | undefined;
  selection: SelectionState;
  selectedUnlocked: HmiObject[];
  updateObject: (screenId: string, objectId: string, patch: Partial<HmiObject>) => void;
  updateObjectDeep: (screenId: string, objectId: string, patch: Partial<HmiObject>) => void;
  removeObject: (screenId: string, objectId: string) => void;
  addObject: (screenId: string, object: HmiObject) => void;
  moveObject: (screenId: string, objectId: string, x: number, y: number) => void;
  resizeObject: (screenId: string, objectId: string, patch: Partial<HmiObject>) => void;
  setScreenObjects: (screenId: string, objects: HmiObject[]) => void;
  setSelectedObjects: (ids: string[], activeId?: string) => void;
};

export function useEditorObjectHistory({
  screen,
  selection,
  selectedUnlocked,
  updateObject,
  updateObjectDeep,
  removeObject,
  addObject,
  moveObject,
  resizeObject,
  setScreenObjects,
  setSelectedObjects,
}: UseEditorObjectHistoryParams) {
  const history = useSnapshotHistory<HmiObject[]>({ maxSteps: 50 });
  const dragMoveSnapshotRef = useRef<HmiObject[] | null>(null);

  const captureObjects = useCallback((): HmiObject[] => structuredClone(screen?.objects ?? []), [screen?.objects]);

  const applyObjects = useCallback(
    (objects: HmiObject[]) => {
      if (!screen) {
        return;
      }
      setScreenObjects(screen.id, structuredClone(objects));
    },
    [screen, setScreenObjects],
  );

  const runWithHistory = useCallback(
    (label: string, mutate: () => void) => {
      if (!screen) {
        return;
      }
      const before = captureObjects();
      mutate();
      const latestProject = useScadaStore.getState().project;
      const latestScreen = latestProject?.screens.find((item) => item.id === screen.id);
      if (!latestScreen) {
        return;
      }
      history.pushEntry(label, before, latestScreen.objects);
    },
    [captureObjects, history, screen],
  );

  const updateObjectWithHistory = useCallback(
    (objectId: string, patch: Partial<HmiObject>, label: string) => {
      if (!screen) {
        return;
      }
      runWithHistory(label, () => updateObject(screen.id, objectId, patch));
    },
    [runWithHistory, screen, updateObject],
  );

  const updateObjectDeepWithHistory = useCallback(
    (objectId: string, patch: Partial<HmiObject>, label: string) => {
      if (!screen) {
        return;
      }
      runWithHistory(label, () => updateObjectDeep(screen.id, objectId, patch));
    },
    [runWithHistory, screen, updateObjectDeep],
  );

  const removeObjectWithHistory = useCallback(
    (objectId: string) => {
      if (!screen) {
        return;
      }
      runWithHistory("Delete object", () => removeObject(screen.id, objectId));
      const nextSelection = selection.selectedObjectIds.filter((id) => id !== objectId);
      setSelectedObjects(nextSelection, nextSelection[0]);
    },
    [removeObject, runWithHistory, screen, selection.selectedObjectIds, setSelectedObjects],
  );

  const addObjectWithHistory = useCallback(
    (object: HmiObject) => {
      if (!screen) {
        return;
      }
      const zIndex = getNextZIndex(screen.objects);
      runWithHistory("Add object", () => addObject(screen.id, { ...object, zIndex }));
      setSelectedObjects([object.id], object.id);
    },
    [addObject, runWithHistory, screen, setSelectedObjects],
  );

  const moveObjectWithHistory = useCallback(
    (objectId: string, x: number, y: number) => {
      if (!screen) {
        return;
      }
      const dragged = screen.objects.find((item) => item.id === objectId);
      if (!dragged || dragged.locked) {
        return;
      }

      const selectedIdSet = new Set(selection.selectedObjectIds);
      const selectedUnlockedIds = screen.objects
        .filter((item) => selectedIdSet.has(item.id) && !item.locked)
        .map((item) => item.id);
      const isGroupMove = selectedUnlockedIds.length > 1 && selectedIdSet.has(objectId);

      if (!isGroupMove) {
        runWithHistory("Move object", () => moveObject(screen.id, objectId, x, y));
        return;
      }

      const dx = x - dragged.x;
      const dy = y - dragged.y;
      if (dx === 0 && dy === 0) {
        return;
      }
      const movingIdSet = new Set(selectedUnlockedIds);
      runWithHistory("Move objects", () => {
        const next = screen.objects.map((item) => {
          if (!movingIdSet.has(item.id)) {
            return item;
          }
          return {
            ...item,
            x: item.x + dx,
            y: item.y + dy,
          };
        });
        setScreenObjects(screen.id, next);
      });
    },
    [moveObject, runWithHistory, screen, selection.selectedObjectIds, setScreenObjects],
  );

  const moveObjectLive = useCallback(
    (objectId: string, x: number, y: number) => {
      if (!screen) {
        return;
      }
      const dragged = screen.objects.find((item) => item.id === objectId);
      if (!dragged || dragged.locked) {
        return;
      }
      if (!dragMoveSnapshotRef.current) {
        dragMoveSnapshotRef.current = captureObjects();
      }

      const selectedIdSet = new Set(selection.selectedObjectIds);
      const selectedUnlockedIds = screen.objects
        .filter((item) => selectedIdSet.has(item.id) && !item.locked)
        .map((item) => item.id);
      const isGroupMove = selectedUnlockedIds.length > 1 && selectedIdSet.has(objectId);

      if (!isGroupMove) {
        moveObject(screen.id, objectId, x, y);
        return;
      }

      const dx = x - dragged.x;
      const dy = y - dragged.y;
      if (dx === 0 && dy === 0) {
        return;
      }
      const movingIdSet = new Set(selectedUnlockedIds);
      const next = screen.objects.map((item) => {
        if (!movingIdSet.has(item.id)) {
          return item;
        }
        return {
          ...item,
          x: item.x + dx,
          y: item.y + dy,
        };
      });
      setScreenObjects(screen.id, next);
    },
    [captureObjects, moveObject, screen, selection.selectedObjectIds, setScreenObjects],
  );

  const commitLiveMoveWithHistory = useCallback(() => {
    if (!screen) {
      dragMoveSnapshotRef.current = null;
      return;
    }
    const before = dragMoveSnapshotRef.current;
    dragMoveSnapshotRef.current = null;
    if (!before) {
      return;
    }
    const latestProject = useScadaStore.getState().project;
    const latestScreen = latestProject?.screens.find((item) => item.id === screen.id);
    if (!latestScreen) {
      return;
    }
    if (JSON.stringify(before) === JSON.stringify(latestScreen.objects)) {
      return;
    }
    history.pushEntry("Move objects", before, latestScreen.objects);
  }, [history, screen]);

  const resizeObjectWithHistory = useCallback(
    (objectId: string, patch: Partial<HmiObject>) => {
      runWithHistory("Resize object", () => resizeObject(screen?.id ?? "", objectId, patch));
    },
    [resizeObject, runWithHistory, screen?.id],
  );

  const undo = useCallback(() => {
    if (!screen) {
      return;
    }
    const previous = history.undo(screen.objects);
    if (previous) {
      applyObjects(previous);
    }
  }, [applyObjects, history, screen]);

  const redo = useCallback(() => {
    if (!screen) {
      return;
    }
    const next = history.redo(screen.objects);
    if (next) {
      applyObjects(next);
    }
  }, [applyObjects, history, screen]);

  const deleteSelectionWithHistory = useCallback(() => {
    if (!screen) {
      return;
    }
    if (!selectedUnlocked.length) {
      void message.warning("No unlocked objects selected");
      return;
    }
    runWithHistory("Delete selection", () => {
      const unlockedIds = selectedUnlocked.map((obj) => obj.id);
      for (const id of unlockedIds) {
        removeObject(screen.id, id);
      }
    });
    setSelectedObjects([], undefined);
  }, [removeObject, runWithHistory, screen, selectedUnlocked, setSelectedObjects]);

  const zOrderWithHistory = useCallback(
    (operation: "bringToFront" | "sendToBack" | "moveForward" | "moveBackward") => {
      if (!screen) {
        return;
      }
      const selectedIds = selection.selectedObjectIds;
      if (!selectedIds.length) {
        void message.warning("No objects selected");
        return;
      }
      const normalized = ensureNormalized(screen.objects);
      runWithHistory(`Z-order: ${operation}`, () => {
        let next: HmiObject[];
        switch (operation) {
          case "bringToFront":
            next = bringToFront(normalized, selectedIds);
            break;
          case "sendToBack":
            next = sendToBack(normalized, selectedIds);
            break;
          case "moveForward":
            next = moveForward(normalized, selectedIds);
            break;
          case "moveBackward":
            next = moveBackward(normalized, selectedIds);
            break;
          default:
            return;
        }
        setScreenObjects(screen.id, next);
      });
    },
    [runWithHistory, screen, selection.selectedObjectIds, setScreenObjects],
  );

  return {
    history,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo,
    redo,
    runWithHistory,
    updateObjectWithHistory,
    updateObjectDeepWithHistory,
    removeObjectWithHistory,
    addObjectWithHistory,
    moveObjectWithHistory,
    moveObjectLive,
    commitLiveMoveWithHistory,
    resizeObjectWithHistory,
    deleteSelectionWithHistory,
    zOrderWithHistory,
  };
}
