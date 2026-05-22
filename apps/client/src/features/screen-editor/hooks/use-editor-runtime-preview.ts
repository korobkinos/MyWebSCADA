import { useEffect, useMemo, useRef, useState } from "react";
import type { ElementLibrary, HmiScreen, ScadaProject, TagValue } from "@web-scada/shared";
import { collectRuntimeTagSubscriptions, collectRuntimeTagSubscriptionPlan } from "../../../hmi/runtime/runtime-tag-subscriptions";
import { createTagValueBatcher } from "../../../services/tag-value-batcher";
import { createRuntimeSocket, updateRuntimeTagSubscriptions } from "../../../services/ws";

type UseEditorRuntimePreviewParams = {
  project: ScadaProject | null;
  screen: HmiScreen | null | undefined;
  libraries: ElementLibrary[];
  tags: Record<string, TagValue>;
  setTagValues: (values: TagValue[]) => void;
};

function serializeRuntimeTagForSignature(value: TagValue | undefined): string {
  if (!value) {
    return "null";
  }
  return `${String(value.value ?? "null")}|${value.quality ?? ""}|${value.source ?? ""}`;
}

export function useEditorRuntimePreview({
  project,
  screen,
  libraries,
  tags,
  setTagValues,
}: UseEditorRuntimePreviewParams) {
  const [previewMode, setPreviewMode] = useState(false);
  const tagsRef = useRef(tags);

  useEffect(() => {
    tagsRef.current = tags;
  }, [tags]);

  const runtimeSubscriptionPlan = useMemo(() => {
    if (!previewMode || !project || !screen) {
      return null;
    }
    return collectRuntimeTagSubscriptionPlan({
      project,
      libraries,
      screen,
      popups: [],
    });
  }, [libraries, previewMode, project, screen]);

  const runtimeDependencyTagSignature = useMemo(() => {
    const dependencyTags = runtimeSubscriptionPlan?.dependencyTags ?? [];
    if (dependencyTags.length === 0) {
      return "";
    }
    return dependencyTags
      .map((tagName) => `${tagName}=${serializeRuntimeTagForSignature(tags[tagName])}`)
      .join("|");
  }, [runtimeSubscriptionPlan?.dependencyTags, tags]);

  useEffect(() => {
    if (!previewMode || !project || !screen) {
      return;
    }
    const tagBatcher = createTagValueBatcher((values) => setTagValues(values));
    const socket = createRuntimeSocket({
      onTagValues: (values) => tagBatcher.push(values),
    });
    return () => {
      socket.close();
      tagBatcher.close();
    };
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
      tags: runtimeSubscriptionPlan && runtimeSubscriptionPlan.dependencyTags.length > 0 ? tagsRef.current : undefined,
      popups: [],
    });
    updateRuntimeTagSubscriptions(subscriptionTags);
    return () => {
      updateRuntimeTagSubscriptions([]);
    };
  }, [libraries, previewMode, project, runtimeDependencyTagSignature, runtimeSubscriptionPlan, screen]);

  return {
    previewMode,
    setPreviewMode,
  };
}
