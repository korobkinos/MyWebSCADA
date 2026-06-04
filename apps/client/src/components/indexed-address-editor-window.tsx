import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  extractIndexedAddressSlots,
  resolveIndexedAddress,
  type IndexedAddressBinding,
  type IndexedTagAddress,
  type ScadaProject,
  type TagDefinition,
} from "@web-scada/shared";
import { TagPicker } from "./tag-picker";
import { WorkbenchWindow, type WorkbenchWindowRect, nextGlobalZIndex } from "./workbench";
import { findTagByAddressInTags, getTagAddressTemplate } from "../hmi/tags/indexed-address";

type IndexedAddressEditorWindowProps = {
  fieldName: string;
  fieldLabel?: string;
  open: boolean;
  project: ScadaProject;
  value?: IndexedTagAddress;
  selectedTag?: TagDefinition | null;
  runtimePreviewValues?: Record<string, unknown>;
  onApply: (fieldName: string, next: IndexedTagAddress) => void;
  onClose: () => void;
};

const DEFAULT_RECT: WorkbenchWindowRect = { x: 180, y: 120, width: 860, height: 620 };
const MIN_WIDTH = 620;
const MIN_HEIGHT = 420;
const RECT_STORAGE_KEY = "workbench.indexedAddressEditor.rect";

export function IndexedAddressEditorWindow({
  fieldName,
  fieldLabel,
  open,
  project,
  value,
  selectedTag,
  runtimePreviewValues,
  onApply,
  onClose,
}: IndexedAddressEditorWindowProps) {
  const [rect, setRect] = useState<WorkbenchWindowRect>(() => loadRect());
  const [zIndex, setZIndex] = useState(() => nextGlobalZIndex());
  const [draft, setDraft] = useState<IndexedTagAddress>(() => createDraft(value, selectedTag));

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraft(createDraft(value, selectedTag));
  }, [open, value, selectedTag]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(RECT_STORAGE_KEY, JSON.stringify(rect));
  }, [rect]);

  const focusWindow = () => {
    setZIndex(nextGlobalZIndex());
  };

  const detectedSlots = useMemo(() => extractIndexedAddressSlots(draft.template), [draft.template]);
  const sortedBindings = useMemo(
    () => [...draft.bindings].sort((left, right) => left.slotIndex - right.slotIndex),
    [draft.bindings],
  );

  const previewLines = useMemo(
    () => buildPreviewLines(sortedBindings, detectedSlots, runtimePreviewValues, project.variables),
    [detectedSlots, project.variables, runtimePreviewValues, sortedBindings],
  );
  const previewValues = useMemo(
    () => buildResolverValues(previewLines),
    [previewLines],
  );
  const previewResult = useMemo(
    () => resolveIndexedAddress({
      config: draft,
      values: previewValues,
    }),
    [draft, previewValues],
  );
  const hasMissingRuntimeValues = previewLines.some((line) => line.runtimeValue === undefined);
  const resolvedAddress = hasMissingRuntimeValues ? undefined : previewResult.address;
  const matchingTag = resolvedAddress ? findTagByAddressInTags(project.tags, resolvedAddress) : undefined;
  const statusText = !detectedSlots.length
    ? "Not configured"
    : hasMissingRuntimeValues
      ? "Preview incomplete"
      : matchingTag
        ? "OK"
        : "Not found";

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="indexed-address-editor-window-layer"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <WorkbenchWindow
        id="indexedAddressEditor"
        title={`Indexed Address: ${formatFieldLabel(fieldName, fieldLabel)}`}
        rect={rect}
        zIndex={zIndex}
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        onClose={onClose}
        onFocus={focusWindow}
        onMove={(x, y) => setRect((prev) => clampRect({ ...prev, x, y }))}
        onResize={(nextRect) => setRect(clampRect(nextRect))}
      >
        <div className="indexed-address-editor-window">
          <div className="indexed-address-editor-toolbar">
            <button
              type="button"
              className="workbench-button"
              onClick={() => {
                const template = getTagAddressTemplate(selectedTag ?? undefined);
                if (!template) {
                  return;
                }
                setDraft((prev) => ({
                  ...prev,
                  template,
                  bindings: createBindingsFromSlots(extractIndexedAddressSlots(template), prev.bindings),
                }));
              }}
              disabled={!selectedTag}
            >
              <span className="workbench-button__label">Use selected tag address</span>
            </button>
            <button
              type="button"
              className="workbench-button"
              onClick={() => {
                setDraft((prev) => {
                  const slots = extractIndexedAddressSlots(prev.template);
                  return {
                    ...prev,
                    bindings: createBindingsFromSlots(slots, prev.bindings),
                  };
                });
              }}
            >
              <span className="workbench-button__label">Detect indexes</span>
            </button>
            <button
              type="button"
              className="workbench-button"
              onClick={() => {
                setDraft((prev) => {
                  const slots = extractIndexedAddressSlots(prev.template);
                  return {
                    ...prev,
                    bindings: createBindingsFromSlots(slots),
                  };
                });
              }}
            >
              <span className="workbench-button__label">Reset bindings</span>
            </button>
          </div>

          <div className="indexed-address-editor-body">
            <section className="indexed-address-editor-section">
              <div className="indexed-address-editor-section__title">Template</div>
              <textarea
                className="indexed-address-editor-template"
                value={draft.template}
                onChange={(event) => {
                  const template = event.target.value;
                  setDraft((prev) => ({
                    ...prev,
                    template,
                    bindings: createBindingsFromSlots(extractIndexedAddressSlots(template), prev.bindings),
                  }));
                }}
                spellCheck={false}
              />
              <div className="indexed-address-editor-hint">
                Detected index slots: {detectedSlots.length}
              </div>
            </section>

            <section className="indexed-address-editor-section">
              <div className="indexed-address-editor-table">
                <div className="indexed-address-editor-row indexed-address-editor-row--header">
                  <div className="indexed-address-editor-cell">Index</div>
                  <div className="indexed-address-editor-cell">Base</div>
                  <div className="indexed-address-editor-cell">Source</div>
                  <div className="indexed-address-editor-cell">Name / Value</div>
                  <div className="indexed-address-editor-cell">Offset</div>
                  <div className="indexed-address-editor-cell">Slot</div>
                  <div className="indexed-address-editor-cell">Result</div>
                </div>
                {sortedBindings.map((binding) => {
                  const line = previewLines.find((item) => item.slotIndex === binding.slotIndex);
                  return (
                    <div key={binding.key} className="indexed-address-editor-row">
                      <div className="indexed-address-editor-cell">{binding.key}</div>
                      <div className="indexed-address-editor-cell">{binding.baseValue}</div>
                      <div className="indexed-address-editor-cell">
                        <select
                          className="workbench-select"
                          value={binding.source}
                          onChange={(event) => {
                            const source = event.target.value as IndexedAddressBinding["source"];
                            setDraft((prev) => ({
                              ...prev,
                              bindings: prev.bindings.map((item) => (
                                item.slotIndex === binding.slotIndex
                                  ? { ...item, source }
                                  : item
                              )),
                            }));
                          }}
                        >
                          <option value="constant">Constant</option>
                          <option value="runtimeArg">Runtime Arg</option>
                          <option value="internalVariable">Internal Variable</option>
                          <option value="tag">Tag</option>
                        </select>
                      </div>
                      <div className="indexed-address-editor-cell">
                        {binding.source === "constant" ? (
                          <input
                            className="workbench-input"
                            type="number"
                            value={String(binding.constantValue ?? 0)}
                            onChange={(event) => {
                              const nextValue = Number(event.target.value);
                              setDraft((prev) => ({
                                ...prev,
                                bindings: prev.bindings.map((item) => (
                                  item.slotIndex === binding.slotIndex
                                    ? { ...item, constantValue: Number.isFinite(nextValue) ? nextValue : 0 }
                                    : item
                                )),
                              }));
                            }}
                          />
                        ) : binding.source === "tag" ? (
                          <TagPicker
                            project={project}
                            value={binding.sourceName ?? ""}
                            onChange={(nextValue) =>
                              setDraft((prev) => ({
                                ...prev,
                                bindings: prev.bindings.map((item) => (
                                  item.slotIndex === binding.slotIndex
                                    ? { ...item, sourceName: nextValue ?? "" }
                                    : item
                                )),
                              }))
                            }
                          />
                        ) : (
                          <input
                            className="workbench-input"
                            value={binding.sourceName ?? ""}
                            placeholder={binding.source === "runtimeArg" ? "udpCfgIndex" : "internalVarName"}
                            onChange={(event) =>
                              setDraft((prev) => ({
                                ...prev,
                                bindings: prev.bindings.map((item) => (
                                  item.slotIndex === binding.slotIndex
                                    ? { ...item, sourceName: event.target.value }
                                    : item
                                )),
                              }))
                            }
                          />
                        )}
                      </div>
                      <div className="indexed-address-editor-cell">
                        <input
                          className="workbench-input"
                          type="number"
                          value={String(binding.offset ?? 0)}
                          onChange={(event) => {
                            const nextValue = Number(event.target.value);
                            setDraft((prev) => ({
                              ...prev,
                              bindings: prev.bindings.map((item) => (
                                item.slotIndex === binding.slotIndex
                                  ? { ...item, offset: Number.isFinite(nextValue) ? nextValue : 0 }
                                  : item
                              )),
                            }));
                          }}
                        />
                      </div>
                      <div className="indexed-address-editor-cell">{binding.slotIndex + 1}</div>
                      <div className="indexed-address-editor-cell">{line?.resultLabel ?? "?"}</div>
                    </div>
                  );
                })}
                {sortedBindings.length === 0 ? (
                  <div className="indexed-address-editor-empty">No indexes detected. Click Detect indexes.</div>
                ) : null}
              </div>
            </section>
          </div>

          <section className="indexed-address-editor-preview">
            <div className="indexed-address-editor-preview__line">
              <strong>Status:</strong> {statusText}
            </div>
            {previewLines.map((line) => (
              <div key={line.key} className="indexed-address-editor-preview__line">
                {line.key}: base {line.baseValue} + {line.runtimeLabel} + offset {line.offset} = {line.resultLabel}
              </div>
            ))}
            <div className="indexed-address-editor-preview__line indexed-address-editor-preview__address">
              Template: {draft.template || "-"}
            </div>
            <div className="indexed-address-editor-preview__line indexed-address-editor-preview__address">
              Resolved: {resolvedAddress ?? buildUnresolvedPreview(draft.template, previewLines)}
            </div>
            <div className="indexed-address-editor-preview__line">
              Matching tag: {matchingTag?.name ?? (resolvedAddress ? "Not found. Import matching OPC UA tag first." : "Preview incomplete")}
            </div>
            {previewResult.errors.length > 0 ? (
              <div className="indexed-address-editor-preview__line indexed-address-editor-preview__warning">
                {previewResult.errors[0]}
              </div>
            ) : null}
          </section>

          <div className="indexed-address-editor-actions">
            <button type="button" className="workbench-button" onClick={onClose}>
              <span className="workbench-button__label">Cancel</span>
            </button>
            <button
              type="button"
              className="workbench-button"
              onClick={() => onApply(fieldName, normalizeDraft(draft))}
            >
              <span className="workbench-button__label">Apply</span>
            </button>
            <button
              type="button"
              className="workbench-button workbench-button--primary"
              onClick={() => {
                onApply(fieldName, normalizeDraft(draft));
                onClose();
              }}
            >
              <span className="workbench-button__label">Apply and Close</span>
            </button>
          </div>
        </div>
      </WorkbenchWindow>
    </div>,
    document.body,
  );
}

function createDraft(value: IndexedTagAddress | undefined, selectedTag: TagDefinition | null | undefined): IndexedTagAddress {
  const template = (value?.template ?? "").trim() || getTagAddressTemplate(selectedTag ?? undefined);
  const slots = extractIndexedAddressSlots(template);
  return {
    enabled: value?.enabled ?? false,
    template,
    bindings: createBindingsFromSlots(slots, value?.bindings ?? []),
  };
}

function createBindingsFromSlots(
  slots: ReturnType<typeof extractIndexedAddressSlots>,
  existing: IndexedAddressBinding[] = [],
): IndexedAddressBinding[] {
  const existingBySlot = new Map(existing.map((item) => [item.slotIndex, item]));
  return slots.map((slot) => {
    const previous = existingBySlot.get(slot.slotIndex);
    return {
      key: slot.key,
      slotIndex: slot.slotIndex,
      baseValue: slot.baseValue,
      source: previous?.source ?? "constant",
      sourceName: previous?.sourceName,
      constantValue: previous?.constantValue ?? 0,
      offset: previous?.offset ?? 0,
    };
  });
}

function normalizeDraft(draft: IndexedTagAddress): IndexedTagAddress {
  const slots = extractIndexedAddressSlots(draft.template);
  return {
    ...draft,
    template: draft.template.trim(),
    bindings: createBindingsFromSlots(slots, draft.bindings),
  };
}

function toNumeric(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value === "object" && "value" in value) {
    return toNumeric((value as { value: unknown }).value);
  }
  return undefined;
}

function buildPreviewLines(
  bindings: IndexedAddressBinding[],
  slots: ReturnType<typeof extractIndexedAddressSlots>,
  runtimePreviewValues: Record<string, unknown> | undefined,
  variables: ScadaProject["variables"] | undefined,
) {
  const bindingBySlot = new Map(bindings.map((binding) => [binding.slotIndex, binding]));
  const variableValues = new Map((variables ?? []).map((variable) => [variable.name, variable.currentValue ?? variable.initialValue]));
  return slots.map((slot) => {
    const binding = bindingBySlot.get(slot.slotIndex) ?? {
      key: slot.key,
      slotIndex: slot.slotIndex,
      baseValue: slot.baseValue,
      source: "constant" as const,
      constantValue: 0,
      offset: 0,
    };
    const offset = toNumeric(binding.offset) ?? 0;
    if (binding.source === "constant") {
      const runtimeValue = toNumeric(binding.constantValue) ?? 0;
      return {
        key: binding.key,
        slotIndex: binding.slotIndex,
        source: binding.source,
        sourceName: binding.sourceName,
        baseValue: slot.baseValue,
        runtimeValue,
        runtimeLabel: String(runtimeValue),
        offset,
        resultLabel: String(Math.round(slot.baseValue + runtimeValue + offset)),
      };
    }

    let runtimeValue: number | undefined;
    if (binding.source === "runtimeArg" || binding.source === "tag") {
      runtimeValue = binding.sourceName ? toNumeric(runtimePreviewValues?.[binding.sourceName]) : undefined;
    } else if (binding.source === "internalVariable") {
      runtimeValue = binding.sourceName ? toNumeric(variableValues.get(binding.sourceName)) : undefined;
    }

    const sourceToken = (binding.sourceName ?? "").trim() || "?";
    return {
      key: binding.key,
      slotIndex: binding.slotIndex,
      source: binding.source,
      sourceName: binding.sourceName,
      baseValue: slot.baseValue,
      runtimeValue,
      runtimeLabel: binding.source === "tag" ? `tag(${sourceToken})` : sourceToken,
      offset,
      resultLabel: runtimeValue === undefined ? "?" : String(Math.round(slot.baseValue + runtimeValue + offset)),
    };
  });
}

function buildResolverValues(lines: ReturnType<typeof buildPreviewLines>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of lines) {
    if (line.runtimeValue === undefined || !line.sourceName || line.source === "constant") {
      continue;
    }
    out[line.sourceName] = line.runtimeValue;
  }
  return out;
}

function buildUnresolvedPreview(
  template: string,
  lines: Array<{ runtimeValue?: number; runtimeLabel: string; offset: number }>,
): string {
  const slots = extractIndexedAddressSlots(template);
  if (!slots.length) {
    return template;
  }
  let output = "";
  let cursor = 0;
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index]!;
    const line = lines[index];
    output += template.slice(cursor, slot.start);
    if (!line) {
      output += slot.token;
    } else if (typeof line.runtimeValue === "number") {
      output += `[${Math.round(slot.baseValue + line.runtimeValue + line.offset)}]`;
    } else {
      output += `[${slot.baseValue} + ${line.runtimeLabel} + ${line.offset}]`;
    }
    cursor = slot.end;
  }
  output += template.slice(cursor);
  return output;
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
      typeof parsed.x !== "number"
      || typeof parsed.y !== "number"
      || typeof parsed.width !== "number"
      || typeof parsed.height !== "number"
    ) {
      return clampRect(DEFAULT_RECT);
    }
    return clampRect({
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
    });
  } catch {
    return clampRect(DEFAULT_RECT);
  }
}

function formatFieldLabel(fieldName: string | undefined, fieldLabel: string | undefined): string {
  const normalizedLabel = typeof fieldLabel === "string" ? fieldLabel.trim() : "";
  if (normalizedLabel && normalizedLabel.toLowerCase() !== "undefined") {
    return normalizedLabel;
  }
  const normalizedFieldName = typeof fieldName === "string" ? fieldName.trim() : "";
  if (normalizedFieldName && normalizedFieldName.toLowerCase() !== "undefined") {
    const readable = normalizedFieldName
      .replace(/^tag$/i, "Tag")
      .replace(/^visibleTag$/i, "Visible Tag")
      .replace(/^disabledTag$/i, "Disabled Tag")
      .replace(/^stateTag$/i, "State Tag")
      .replace(/^openTag$/i, "Open Tag")
      .replace(/^closedTag$/i, "Closed Tag")
      .replace(/^errorTag$/i, "Error Tag")
      .replace(/^runTag$/i, "Run Tag")
      .replace(/^faultTag$/i, "Fault Tag")
      .replace(/^commandOpenTag$/i, "Command Open Tag")
      .replace(/^commandCloseTag$/i, "Command Close Tag")
      .replace(/^commandStartTag$/i, "Command Start Tag")
      .replace(/^commandStopTag$/i, "Command Stop Tag")
      .replace(/^target\.tag$/i, "Target Tag");
    return readable;
  }
  return "Tag";
}
