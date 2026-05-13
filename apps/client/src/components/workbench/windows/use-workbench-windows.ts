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
    const next = nextZ();
    setWindows((prev) =>
      prev.map((window) =>
        window.id === id ? { ...window, zIndex: next } : window,
      ),
    );
  }, [nextZ]);

  const openWindow = useCallback((definition: WorkbenchWindowDefinition) => {
    const next = nextZ();

    setWindows((prev) => {
      const existing = prev.find((window) => window.id === definition.id);

      if (existing) {
        return prev.map((window) =>
          window.id === definition.id
            ? { ...window, isOpen: true, zIndex: next }
            : window,
        );
      }

      return [
        ...prev,
        {
          id: definition.id,
          title: definition.title,
          rect: definition.defaultRect,
          minWidth: definition.minWidth,
          minHeight: definition.minHeight,
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