import { useCallback, useMemo, useRef, useState } from "react";
import type {
  WorkbenchWindowDefinition,
  WorkbenchWindowId,
  WorkbenchWindowRect,
  WorkbenchWindowState,
} from "./workbench-window.types";

export function useWorkbenchWindows() {
  const [windows, setWindows] = useState<WorkbenchWindowState[]>([]);
  const zCounterRef = useRef(10);

  const nextZ = useCallback(() => {
    zCounterRef.current += 1;
    return zCounterRef.current;
  }, []);

  const focusWindow = useCallback((id: WorkbenchWindowId) => {
    setWindows((prev) => {
      const target = prev.find((window) => window.id === id);
      if (!target) {
        return prev;
      }
      const topZ = prev.reduce((max, window) => Math.max(max, window.zIndex), Number.NEGATIVE_INFINITY);
      if (target.zIndex >= topZ) {
        return prev;
      }
      const next = nextZ();
      return prev.map((window) =>
        window.id === id ? { ...window, zIndex: next } : window,
      );
    });
  }, [nextZ]);

  const openWindow = useCallback((definition: WorkbenchWindowDefinition) => {
    const next = nextZ();
    const minWidth = Math.max(1, Math.round(definition.minWidth ?? 260));
    const minHeight = Math.max(1, Math.round(definition.minHeight ?? 160));
    const clampRect = (rect: WorkbenchWindowRect): WorkbenchWindowRect => ({
      ...rect,
      width: Math.max(minWidth, Math.round(rect.width)),
      height: Math.max(minHeight, Math.round(rect.height)),
    });

    setWindows((prev) => {
      const existing = prev.find((window) => window.id === definition.id);

      if (existing) {
        const nextRect = definition.resetRectOnOpen ? definition.defaultRect : existing.rect;
        return prev.map((window) =>
          window.id === definition.id
            ? {
                ...window,
                title: definition.title,
                rect: clampRect(nextRect),
                minWidth: definition.minWidth,
                minHeight: definition.minHeight,
                resizable: definition.resizable,
                isOpen: true,
                zIndex: next,
              }
            : window,
        );
      }

      return [
        ...prev,
        {
          id: definition.id,
          title: definition.title,
          rect: clampRect(definition.defaultRect),
          minWidth: definition.minWidth,
          minHeight: definition.minHeight,
          resizable: definition.resizable,
          zIndex: next,
          isOpen: true,
        },
      ];
    });
  }, [nextZ]);

  const closeWindow = useCallback((id: WorkbenchWindowId) => {
    setWindows((prev) =>
      prev.map((window) =>
        window.id === id ? { ...window, isOpen: false } : window,
      ),
    );
  }, []);

  const moveWindow = useCallback((id: WorkbenchWindowId, x: number, y: number) => {
    setWindows((prev) =>
      prev.map((window) =>
        window.id === id
          ? { ...window, rect: { ...window.rect, x, y } }
          : window,
      ),
    );
  }, []);

  const resizeWindow = useCallback(
    (id: WorkbenchWindowId, rect: WorkbenchWindowRect) => {
      setWindows((prev) =>
        prev.map((window) =>
          window.id === id ? { ...window, rect } : window,
        ),
      );
    },
    [],
  );

  const isWindowOpen = useCallback(
    (id: WorkbenchWindowId) =>
      windows.some((window) => window.id === id && window.isOpen),
    [windows],
  );

  const openWindows = useMemo(
    () => windows.filter((window) => window.isOpen),
    [windows],
  );

  return {
    windows,
    openWindows,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindow,
    resizeWindow,
    isWindowOpen,
  };
}
