import { useCallback } from "react";
import type { HmiObject, HmiScreen } from "@web-scada/shared";
import { message } from "antd";
import { useSnapshotHistory } from "../../../hooks/use-snapshot-history";
import { useScadaStore } from "../../../store/scada-store";

type SelectionState = {
  selectedObjectIds: string[];
};

type UseEditorObjectHistoryParams = {
  screen: HmiScreen | null | undefined;
  selection: SelectionState;
  selectedUnlocked: HmiObject[];
  updateObject: (screenId: string, objectId: string, patch: Partial<HmiObject>) => void;
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
  removeObject,
  addObject,
  moveObject,
  resizeObject,
  setScreenObjects,
  setSelectedObjects,
}: UseEditorObjectHistoryParams) {
  const history = useSnapshotHistory<HmiObject[]>({ maxSteps: 50 });

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
      runWithHistory("Add object", () => addObject(screen.id, object));
      setSelectedObjects([object.id], object.id);
    },
    [addObject, runWithHistory, screen, setSelectedObjects],
  );

  const moveObjectWithHistory = useCallback(
    (objectId: string, x: number, y: number) => {
      runWithHistory("Move object", () => moveObject(screen?.id ?? "", objectId, x, y));
    },
    [moveObject, runWithHistory, screen?.id],
  );

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

  return {
    history,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo,
    redo,
    runWithHistory,
    updateObjectWithHistory,
    removeObjectWithHistory,
    addObjectWithHistory,
    moveObjectWithHistory,
    resizeObjectWithHistory,
    deleteSelectionWithHistory,
  };
}
