import { useCallback, useMemo, useState } from "react";
import type { HmiObject, HmiScreen, ScadaProject, ScreenKind } from "@web-scada/shared";
import { message } from "antd";
import { useScadaStore } from "../../../store/scada-store";
import { showProjectCleanupHint } from "../../../services/cleanup-hint";

type UseEditorScreensParams = {
  project: ScadaProject | null;
  currentScreenId?: string | null;
  setCurrentScreen: (screenId: string) => void;
  setScreenObjects: (screenId: string, objects: HmiObject[]) => void;
  updateProjectJson: (project: ScadaProject) => void;
};

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useEditorScreens({
  project,
  currentScreenId,
  setCurrentScreen,
  setScreenObjects,
  updateProjectJson,
}: UseEditorScreensParams) {
  const [pendingDeleteScreenId, setPendingDeleteScreenId] = useState<string | null>(null);
  const [newScreenKind, setNewScreenKind] = useState<ScreenKind>("screen");
  const [screenSearch, setScreenSearch] = useState("");
  const [screenKindFilter, setScreenKindFilter] = useState<"all" | ScreenKind>("all");
  const [screenViewMode, setScreenViewMode] = useState<"grid" | "list">("grid");

  const filteredScreens = useMemo(() => {
    const list = project?.screens ?? [];
    const term = screenSearch.trim().toLowerCase();
    const byKind = screenKindFilter === "all" ? list : list.filter((item) => item.kind === screenKindFilter);
    if (!term) {
      return byKind;
    }
    return byKind.filter((item) => item.name.toLowerCase().includes(term));
  }, [project?.screens, screenKindFilter, screenSearch]);

  const duplicateScreenLocal = useCallback(
    (source: HmiScreen) => {
      if (!project) {
        return;
      }
      const copy: HmiScreen = {
        ...structuredClone(source),
        id: createId("screen"),
        name: `${source.name} Copy`,
      };
      const existingScreens = useScadaStore.getState().project?.screens ?? [];
      const updatedProject = {
        ...project,
        screens: [...existingScreens, copy],
      } as ScadaProject;
      updateProjectJson(updatedProject);
      setScreenObjects(copy.id, copy.objects);
      setCurrentScreen(copy.id);
      void message.success(`Screen duplicated: ${copy.name}`);
    },
    [project, setCurrentScreen, setScreenObjects, updateProjectJson],
  );

  const requestDeleteScreen = useCallback((screenId: string) => {
    const currentProject = useScadaStore.getState().project;
    if (!currentProject) {
      return;
    }
    if (currentProject.screens.length <= 1) {
      void message.warning("Cannot delete the last screen");
      return;
    }
    const target = currentProject.screens.find((screen) => screen.id === screenId);
    if (!target) {
      void message.warning("Screen not found");
      return;
    }
    setPendingDeleteScreenId(screenId);
  }, []);

  const performDeleteScreen = useCallback(() => {
    if (!pendingDeleteScreenId) {
      return;
    }
    const latestProject = useScadaStore.getState().project;
    if (!latestProject) {
      setPendingDeleteScreenId(null);
      return;
    }
    const nextScreens = latestProject.screens.filter((screen) => screen.id !== pendingDeleteScreenId);
    if (nextScreens.length === latestProject.screens.length) {
      void message.warning("Screen not found");
      setPendingDeleteScreenId(null);
      return;
    }
    if (nextScreens.length === 0) {
      void message.warning("Cannot delete the last screen");
      setPendingDeleteScreenId(null);
      return;
    }
    const nextStartScreenId =
      latestProject.startScreenId === pendingDeleteScreenId
        ? nextScreens[0]?.id ?? null
        : latestProject.startScreenId;
    const previousCurrentScreenId = currentScreenId ?? useScadaStore.getState().currentScreenId;
    const nextProject = {
      ...latestProject,
      screens: nextScreens,
      startScreenId: nextStartScreenId,
    } as ScadaProject;
    updateProjectJson(nextProject);
    if (previousCurrentScreenId === pendingDeleteScreenId) {
      const fallbackId = nextScreens[0]?.id;
      if (fallbackId) {
        setCurrentScreen(fallbackId);
      }
    }
    setPendingDeleteScreenId(null);
    void message.success("Screen deleted");
    showProjectCleanupHint("Screen was deleted");
  }, [currentScreenId, pendingDeleteScreenId, setCurrentScreen, updateProjectJson]);

  const setStartScreen = useCallback(
    (screenId: string) => {
      if (!project) {
        return;
      }
      updateProjectJson({ ...project, startScreenId: screenId } as ScadaProject);
      void message.success("Start screen updated");
    },
    [project, updateProjectJson],
  );

  return {
    pendingDeleteScreenId,
    setPendingDeleteScreenId,
    newScreenKind,
    setNewScreenKind,
    screenSearch,
    setScreenSearch,
    screenKindFilter,
    setScreenKindFilter,
    screenViewMode,
    setScreenViewMode,
    filteredScreens,
    requestDeleteScreen,
    performDeleteScreen,
    duplicateScreenLocal,
    setStartScreen,
  };
}
