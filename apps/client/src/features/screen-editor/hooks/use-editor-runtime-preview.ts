import { useEffect, useState } from "react";
import type { ElementLibrary, HmiScreen, ScadaProject, TagValue } from "@web-scada/shared";
import { collectRuntimeTagSubscriptions } from "../../../hmi/runtime/runtime-tag-subscriptions";
import { createRuntimeSocket, updateRuntimeTagSubscriptions } from "../../../services/ws";

type UseEditorRuntimePreviewParams = {
  project: ScadaProject | null;
  screen: HmiScreen | null | undefined;
  libraries: ElementLibrary[];
  tags: Record<string, TagValue>;
  setTagValues: (values: TagValue[]) => void;
};

export function useEditorRuntimePreview({
  project,
  screen,
  libraries,
  tags,
  setTagValues,
}: UseEditorRuntimePreviewParams) {
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    if (!previewMode || !project || !screen) {
      return;
    }
    const socket = createRuntimeSocket({
      onTagValues: (values) => setTagValues(values),
    });
    return () => socket.close();
  }, [previewMode, project, screen, setTagValues]);

  useEffect(() => {
    if (!previewMode || !project || !screen) {
      updateRuntimeTagSubscriptions([]);
      return;
    }
    const subscriptionTags = collectRuntimeTagSubscriptions({
      project,
      libraries,
      screen,
      tags,
      popups: [],
    });
    updateRuntimeTagSubscriptions(subscriptionTags);
    return () => {
      updateRuntimeTagSubscriptions([]);
    };
  }, [libraries, previewMode, project, screen, tags]);

  return {
    previewMode,
    setPreviewMode,
  };
}
