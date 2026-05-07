import { useEffect, useMemo, useRef, useState } from "react";
import type { DockLayoutSettings, DockPanelState, ScadaProject } from "@web-scada/shared";
import { useScadaStore } from "../store/scada-store";

type UseDockLayoutOptions = {
  autoSaveMs?: number;
};

function mergePanels(defaultPanels: DockPanelState[], saved?: Record<string, DockPanelState>): Record<string, DockPanelState> {
  const next: Record<string, DockPanelState> = {};
  for (const panel of defaultPanels) {
    const existing = saved?.[panel.id];
    next[panel.id] = existing
      ? {
          ...panel,
          ...existing,
          id: panel.id,
          side: panel.side,
          size: Math.max(0, existing.size ?? panel.size),
          lastVisibleSize: Math.max(panel.size, existing.lastVisibleSize ?? panel.lastVisibleSize ?? panel.size),
        }
      : panel;
  }
  return next;
}

function withDockLayout(project: ScadaProject, dockLayout: DockLayoutSettings): ScadaProject {
  return {
    ...project,
    editorSettings: {
      ...(project.editorSettings ?? {}),
      dockLayout,
    },
  };
}

export function useDockLayout(defaultPanels: DockPanelState[], options?: UseDockLayoutOptions) {
  const project = useScadaStore((s) => s.project);
  const saveProject = useScadaStore((s) => s.saveProject);
  const autoSaveMs = options?.autoSaveMs ?? 900;
  const initializedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const persistTimerRef = useRef<number | null>(null);

  const [panels, setPanels] = useState<Record<string, DockPanelState>>(() =>
    mergePanels(defaultPanels, project?.editorSettings?.dockLayout?.panels),
  );

  useEffect(() => {
    if (!project) {
      return;
    }
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    setPanels(mergePanels(defaultPanels, project.editorSettings?.dockLayout?.panels));
  }, [defaultPanels, project]);

  useEffect(() => {
    if (!project || !initializedRef.current) {
      return;
    }
    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      useScadaStore.setState((state) => {
        if (!state.project) {
          return state;
        }
        const current = state.project.editorSettings?.dockLayout?.panels;
        const prevSerialized = JSON.stringify(current ?? {});
        const nextSerialized = JSON.stringify(panels);
        if (prevSerialized === nextSerialized) {
          return state;
        }
        return {
          ...state,
          project: withDockLayout(state.project, { panels }),
        };
      });
    }, 120);

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void saveProject().catch(() => undefined);
    }, autoSaveMs);

    return () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, [autoSaveMs, panels, project, saveProject]);

  const api = useMemo(() => {
    const getPanelState = (id: string): DockPanelState | undefined => panels[id];
    const setPanelState = (id: string, updater: (prev: DockPanelState) => DockPanelState): void => {
      setPanels((prev) => {
        const existing = prev[id];
        if (!existing) {
          return prev;
        }
        const next = updater(existing);
        return {
          ...prev,
          [id]: {
            ...next,
            id: existing.id,
            side: existing.side,
            size: Math.max(0, next.size),
            lastVisibleSize: Math.max(0, next.lastVisibleSize),
            detached: next.detached ?? false,
            x: next.x,
            y: next.y,
            width: next.width,
            height: next.height,
          },
        };
      });
    };
    const setPanelSize = (id: string, size: number): void => {
      setPanelState(id, (prev) => ({
        ...prev,
        size,
        lastVisibleSize: size > 0 ? size : prev.lastVisibleSize,
      }));
    };
    const setPanelHidden = (id: string, hidden: boolean): void => {
      setPanelState(id, (prev) => ({
        ...prev,
        hidden,
      }));
    };
    const togglePanelHidden = (id: string): void => {
      setPanelState(id, (prev) => ({
        ...prev,
        hidden: !prev.hidden,
      }));
    };
    const resetPanel = (id: string): void => {
      const def = defaultPanels.find((item) => item.id === id);
      if (!def) {
        return;
      }
      setPanels((prev) => ({ ...prev, [id]: def }));
    };
    const resetAllPanels = (): void => {
      setPanels(mergePanels(defaultPanels));
    };

    return {
      panels,
      getPanelState,
      setPanelState,
      setPanelSize,
      setPanelHidden,
      togglePanelHidden,
      resetPanel,
      resetAllPanels,
    };
  }, [defaultPanels, panels]);

  return api;
}
