import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScadaProject, TagDefinition, TagSourceType } from "@web-scada/shared";
import { nextGlobalZIndex, type WorkbenchWindowRect } from "./workbench";
import { WorkbenchTagPickerWindow, type TagPickerWindowTag } from "./tag-picker-window";
import { getProjectTags } from "../features/events/event-tag-utils";

type TagPickerDialogProps = {
  open: boolean;
  project: ScadaProject;
  selectedTagName?: string;
  onSelect: (tagName: string | undefined) => void;
  onClose: () => void;
  storageKey?: string;
  allowedSourceTypes?: TagSourceType[];
};

const DEFAULT_RECT: WorkbenchWindowRect = { x: 140, y: 100, width: 900, height: 620 };
const MIN_WIDTH = 620;
const MIN_HEIGHT = 420;

function normalizeSourceType(tag: TagDefinition): TagSourceType {
  return (tag.sourceType ?? "simulated") as TagSourceType;
}

function toAddressLabel(tag: TagDefinition): string {
  if (tag.nodeId) {
    return tag.nodeId;
  }
  if (typeof tag.lwAddress === "number") {
    return `LW ${tag.lwAddress}`;
  }
  if (tag.internalVariableName) {
    return tag.internalVariableName;
  }
  if (typeof tag.address === "string") {
    return tag.address;
  }
  if (typeof tag.address === "number") {
    return String(tag.address);
  }
  if (tag.address && typeof tag.address === "object") {
    const addressWithNodeId = tag.address as { nodeId?: unknown; raw?: unknown };
    if (typeof addressWithNodeId.nodeId === "string") {
      return addressWithNodeId.nodeId;
    }
    if (typeof addressWithNodeId.raw === "string") {
      return addressWithNodeId.raw;
    }
    return JSON.stringify(tag.address);
  }
  return "-";
}

function clampRect(rect: WorkbenchWindowRect): WorkbenchWindowRect {
  if (typeof window === "undefined") {
    return {
      x: rect.x,
      y: rect.y,
      width: Math.max(MIN_WIDTH, rect.width),
      height: Math.max(MIN_HEIGHT, rect.height),
    };
  }

  const width = Math.max(MIN_WIDTH, Math.min(window.innerWidth, rect.width));
  const height = Math.max(MIN_HEIGHT, Math.min(window.innerHeight, rect.height));
  const maxX = Math.max(0, window.innerWidth - width);
  const maxY = Math.max(0, window.innerHeight - height);

  return {
    x: Math.min(Math.max(0, rect.x), maxX),
    y: Math.min(Math.max(0, rect.y), maxY),
    width,
    height,
  };
}

function loadRect(storageKey: string): WorkbenchWindowRect {
  if (typeof window === "undefined") {
    return DEFAULT_RECT;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return clampRect(DEFAULT_RECT);
    }
    const parsed = JSON.parse(raw) as Partial<WorkbenchWindowRect>;
    if (
      typeof parsed.x !== "number"
      || typeof parsed.y !== "number"
      || typeof parsed.width !== "number"
      || typeof parsed.height !== "number"
    ) {
      return clampRect(DEFAULT_RECT);
    }
    return clampRect({ x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height });
  } catch {
    return clampRect(DEFAULT_RECT);
  }
}

export function TagPickerDialog({
  open,
  project,
  selectedTagName,
  onSelect,
  onClose,
  storageKey = "screenEditor.events.tagPicker.rect",
  allowedSourceTypes,
}: TagPickerDialogProps) {
  const [rect, setRect] = useState<WorkbenchWindowRect>(() => loadRect(storageKey));
  const [zIndex, setZIndex] = useState(() => nextGlobalZIndex());

  const rows = useMemo<TagPickerWindowTag[]>(() =>
    getProjectTags(project).map((tag) => ({
      key: tag.id ?? tag.name,
      name: tag.name,
      description: tag.description,
      sourceType: normalizeSourceType(tag),
      dataType: tag.dataType,
      driverId: tag.driverId,
      group: tag.group,
      writable: tag.writable,
      nodeOrAddress: toAddressLabel(tag),
    })),
  [project]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(rect));
  }, [rect, storageKey]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setZIndex(nextGlobalZIndex());
  }, [open]);

  const focusWindow = useCallback(() => {
    setZIndex(nextGlobalZIndex());
  }, []);

  return (
    <WorkbenchTagPickerWindow
      open={open}
      rect={rect}
      zIndex={zIndex}
      tags={rows}
      selectedValue={selectedTagName}
      allowedSourceTypes={allowedSourceTypes}
      onClose={onClose}
      onFocus={focusWindow}
      onMove={(x, y) => setRect((prev) => clampRect({ ...prev, x, y }))}
      onResize={(nextRect) => setRect(clampRect(nextRect))}
      onSelect={onSelect}
    />
  );
}
