import { useCallback, useEffect, useMemo, useState } from "react";
import { message } from "antd";
import type { ScadaProject, TagDefinition, TagSourceType } from "@web-scada/shared";
import type { WorkbenchWindowRect } from "./workbench";
import { nextGlobalZIndex } from "./workbench";
import { WorkbenchTagPickerWindow, type TagPickerWindowTag } from "./tag-picker-window";

type TagPickerProps = {
  project: ScadaProject;
  value?: string;
  onChange: (tag: string | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
  writableOnly?: boolean;
  allowedDataTypes?: string[];
  allowedSourceTypes?: TagSourceType[];
};

type PickerTag = TagDefinition & {
  sourceType: TagSourceType;
};

const DEFAULT_ALLOWED_SOURCES: TagSourceType[] = ["opcua", "simulated", "internal", "lw"];
const DEFAULT_RECT: WorkbenchWindowRect = { x: 140, y: 100, width: 900, height: 620 };
const MIN_WIDTH = 620;
const MIN_HEIGHT = 420;
const RECT_STORAGE_KEY = "workbench.tagPicker.rect";

const SOURCE_LABELS: Record<TagSourceType, string> = {
  opcua: "OPC UA",
  modbus: "Modbus",
  simulated: "Simulated",
  internal: "Internal",
  lw: "LW",
  computed: "Computed",
};

function normalizeSourceType(tag: TagDefinition): TagSourceType {
  return (tag.sourceType ?? "simulated") as TagSourceType;
}

function toLwTagName(address: number): string {
  return `LW${Math.max(0, Math.floor(address))}`;
}

function buildPickerTags(project: ScadaProject): PickerTag[] {
  const byName = new Map<string, PickerTag>();

  for (const tag of project.tags ?? []) {
    const sourceType = normalizeSourceType(tag);
    byName.set(tag.name, {
      ...tag,
      sourceType,
    });
  }

  for (const variable of project.variables ?? []) {
    const internalName = variable.name.startsWith("LW.") ? variable.name : `LW.${variable.name}`;
    if (!byName.has(internalName)) {
      byName.set(internalName, {
        name: internalName,
        description: variable.description,
        dataType: variable.dataType,
        sourceType: "internal",
        writable: variable.writable ?? true,
        persistent: variable.persistent,
        internalVariableName: variable.name,
      });
    }

    if (typeof variable.lwAddress === "number" && Number.isFinite(variable.lwAddress)) {
      const lwName = toLwTagName(variable.lwAddress);
      byName.set(lwName, {
        name: lwName,
        description: variable.description ?? variable.name,
        dataType: variable.dataType,
        sourceType: "lw",
        writable: variable.writable ?? true,
        persistent: variable.persistent,
        lwAddress: variable.lwAddress,
      });
    }
  }

  for (const [addressText] of Object.entries(project.lwStore?.values ?? {})) {
    const address = Number(addressText);
    if (!Number.isFinite(address)) {
      continue;
    }
    const lwName = toLwTagName(address);
    if (!byName.has(lwName)) {
      byName.set(lwName, {
        name: lwName,
        description: `LW address ${address}`,
        dataType: "INT",
        sourceType: "lw",
        writable: true,
        lwAddress: address,
        persistent: project.lwStore?.mode === "persistent",
      });
    }
  }

  return [...byName.values()];
}

function toAddressLabel(tag: PickerTag): string {
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
    if ("nodeId" in tag.address && typeof tag.address.nodeId === "string") {
      return tag.address.nodeId;
    }
    if ("address" in tag.address && typeof tag.address.address === "number") {
      return `Address ${tag.address.address}`;
    }
    if ("registerType" in tag.address && "address" in tag.address) {
      return `${String(tag.address.registerType)}:${String(tag.address.address)}`;
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

function loadRect(): WorkbenchWindowRect {
  if (typeof window === "undefined") {
    return DEFAULT_RECT;
  }

  try {
    const raw = window.localStorage.getItem(RECT_STORAGE_KEY);
    if (!raw) {
      return clampRect(DEFAULT_RECT);
    }
    const parsed = JSON.parse(raw) as Partial<WorkbenchWindowRect>;
    if (
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number"
    ) {
      return clampRect(DEFAULT_RECT);
    }
    return clampRect({ x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height });
  } catch {
    return clampRect(DEFAULT_RECT);
  }
}

export function TagPicker({
  project,
  value,
  onChange,
  disabled,
  placeholder,
  writableOnly,
  allowedDataTypes,
  allowedSourceTypes,
}: TagPickerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRect, setPickerRect] = useState<WorkbenchWindowRect>(() => loadRect());
  const [pickerZIndex, setPickerZIndex] = useState(() => nextGlobalZIndex());

  const tags = useMemo(() => buildPickerTags(project), [project]);
  const tagByName = useMemo(() => new Map(tags.map((tag) => [tag.name, tag])), [tags]);
  const tagRows = useMemo<TagPickerWindowTag[]>(
    () =>
      tags.map((tag) => ({
        key: tag.id ?? tag.name,
        name: tag.name,
        description: tag.description,
        sourceType: tag.sourceType,
        dataType: tag.dataType,
        driverId: tag.driverId,
        group: tag.group,
        writable: tag.writable,
        nodeOrAddress: toAddressLabel(tag),
      })),
    [tags],
  );

  const selectedValue = value ?? "";
  const selectedTag = selectedValue ? tagByName.get(selectedValue) : undefined;
  const isMissing = Boolean(selectedValue) && !selectedTag;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(RECT_STORAGE_KEY, JSON.stringify(pickerRect));
  }, [pickerRect]);

  const focusWindow = useCallback(() => {
    setPickerZIndex(nextGlobalZIndex());
  }, []);

  const openPicker = useCallback(() => {
    if (disabled) {
      return;
    }
    setPickerZIndex(nextGlobalZIndex());
    setPickerOpen(true);
  }, [disabled]);

  const handleCreateTag = useCallback(
    (tagName: string) => {
      onChange(tagName);
      setPickerOpen(false);
      void message.success(`Tag "${tagName}" selected (not yet saved to project)`);
    },
    [onChange],
  );

  const sourceLabel = selectedTag ? SOURCE_LABELS[selectedTag.sourceType] : undefined;

  return (
    <>
      <div className="tag-picker-field">
        <div
          className={[
            "tag-picker-field__value",
            disabled ? "tag-picker-field__value--disabled" : "",
          ].filter(Boolean).join(" ")}
          role="button"
          tabIndex={disabled ? -1 : 0}
          onClick={openPicker}
          onKeyDown={(event) => {
            if (disabled) {
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openPicker();
            }
          }}
          title={selectedValue || placeholder || "Select tag..."}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span className="tag-picker-field__name">{selectedValue || placeholder || "Select tag..."}</span>
          {selectedTag ? (
            <span className="tag-picker-field__badges">
              <span className="tag-picker-badge">{selectedTag.dataType}</span>
              <span className="tag-picker-badge">{sourceLabel}</span>
              {selectedTag.driverId ? <span className="tag-picker-badge">{selectedTag.driverId}</span> : null}
            </span>
          ) : isMissing ? (
            <span className="tag-picker-field__badges">
              <span className="tag-picker-badge tag-picker-badge--missing">missing</span>
            </span>
          ) : null}
        </div>

        <button
          type="button"
          className="workbench-button"
          disabled={disabled}
          onClick={openPicker}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span className="workbench-button__label">Browse...</span>
        </button>
      </div>

      <WorkbenchTagPickerWindow
        open={pickerOpen}
        rect={pickerRect}
        zIndex={pickerZIndex}
        tags={tagRows}
        selectedValue={selectedValue || undefined}
        writableOnly={writableOnly}
        allowedDataTypes={allowedDataTypes}
        allowedSourceTypes={allowedSourceTypes && allowedSourceTypes.length > 0 ? allowedSourceTypes : DEFAULT_ALLOWED_SOURCES}
        onClose={() => setPickerOpen(false)}
        onFocus={focusWindow}
        onMove={(x, y) => setPickerRect((prev) => clampRect({ ...prev, x, y }))}
        onResize={(rect) => setPickerRect(clampRect(rect))}
        onSelect={(tagName) => onChange(tagName)}
        onCreateTag={handleCreateTag}
      />
    </>
  );
}
