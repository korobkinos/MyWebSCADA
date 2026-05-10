import { useCallback, useMemo, useState } from "react";
import type {
  WorkbenchWindowDefinition,
  WorkbenchWindowId,
  WorkbenchWindowRect,
  WorkbenchWindowState,
} from "./workbench-window.types";

export function useWorkbenchWindows() {
  const [windows, setWindows] = useState<WorkbenchWindowState[]>([]);
  const [zCounter, setZCounter] = useState(10);

  const focusWindow = useCallback((id: WorkbenchWindowId) => {
    setZCounter((current) => {
      const next = current + 1;
      setWindows((prev) =>
        prev.map((window) =>
          window.id === id ? { ...window, zIndex: next } : window,
        ),
      );
      return next;
    });
  }, []);

  const openWindow = useCallback((definition: WorkbenchWindowDefinition) => {
    setZCounter((current) => {
      const next = current + 1;

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

      return next;
    });
  }, []);

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