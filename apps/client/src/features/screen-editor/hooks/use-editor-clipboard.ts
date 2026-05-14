import { useCallback, useState } from "react";
import type { HmiObject, HmiScreen } from "@web-scada/shared";
import { message } from "antd";
import { useScadaStore } from "../../../store/scada-store";
import { getNextZIndex } from "../../../hmi/editor/z-order";

type UseEditorClipboardParams = {
  selectedObjects: HmiObject[];
  screen: HmiScreen | null | undefined;
  runWithHistory: (label: string, mutate: () => void) => void;
  setScreenObjects: (screenId: string, objects: HmiObject[]) => void;
};

export function useEditorClipboard({
  selectedObjects,
  screen,
  runWithHistory,
  setScreenObjects,
}: UseEditorClipboardParams) {
  const [objectClipboard, setObjectClipboard] = useState<HmiObject[]>([]);
  const [pasteIteration, setPasteIteration] = useState(0);

  const copySelectionToClipboard = useCallback(() => {
    if (!selectedObjects.length) {
      return;
    }
    setObjectClipboard(selectedObjects.map((item) => structuredClone(item)));
    setPasteIteration(0);
    void message.success(`Copied ${selectedObjects.length} object(s)`);
  }, [selectedObjects]);

  const pasteFromClipboard = useCallback(() => {
    if (objectClipboard.length === 0 || !screen) {
      return;
    }
    const offsetStep = 20;
    const newIteration = pasteIteration + 1;
    const offsetX = offsetStep * newIteration;
    const offsetY = offsetStep * newIteration;
    const cloned = objectClipboard.map((item) => cloneForPaste(item, offsetX, offsetY));
    runWithHistory("Paste objects", () => {
      const currentScreen = useScadaStore.getState().project?.screens.find((item) => item.id === screen.id);
      if (!currentScreen) {
        return;
      }
      const baseZ = getNextZIndex(currentScreen.objects);
      const withZ = cloned.map((obj, i) => ({ ...obj, zIndex: baseZ + i }));
      setScreenObjects(screen.id, [...currentScreen.objects, ...withZ]);
    });
    setPasteIteration(newIteration);
    void message.success(`Pasted ${cloned.length} object(s)`);
  }, [objectClipboard, pasteIteration, runWithHistory, screen, setScreenObjects]);

  return {
    canCopy: selectedObjects.length > 0,
    canPaste: objectClipboard.length > 0,
    copySelectionToClipboard,
    pasteFromClipboard,
  };
}

function cloneForPaste(source: HmiObject, offsetX: number, offsetY: number): HmiObject {
  const cloned = structuredClone(source) as HmiObject;
  const shifted: HmiObject = {
    ...cloned,
    id: createId(cloned.type),
    x: cloned.x + offsetX,
    y: cloned.y + offsetY,
  };
  return regenerateIds(shifted);
}

function regenerateIds(object: HmiObject): HmiObject {
  if (object.type !== "group") {
    return object;
  }
  return {
    ...object,
    objects: object.objects.map((child) =>
      regenerateIds({
        ...child,
        id: createId(child.type),
      }),
    ),
  };
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}
