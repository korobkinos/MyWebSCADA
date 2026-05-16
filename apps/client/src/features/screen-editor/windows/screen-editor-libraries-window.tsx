import { useEffect, useMemo, useRef, useState } from "react";
import { Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import type {
  ElementBindingDefinition,
  ElementLibrary,
  ElementStateAction,
  ElementStateCase,
  HmiObject,
  LibraryElement,
  MacroDefinition,
  ProjectLibraryRef,
  ScadaProject,
} from "@web-scada/shared";
import { api } from "../../../services/api";
import { WorkbenchButton, WorkbenchSection } from "../../../components/workbench";

type ScreenEditorLibrariesWindowProps = {
  libraries: ElementLibrary[];
  attachedLibraries: ProjectLibraryRef[];
  selectedObjectsCount: number;
  libraryId: string;
  libraryName: string;
  project: ScadaProject | null;
  onUpdateProjectJson?: (project: ScadaProject) => void;
  onLibraryIdChange: (value: string) => void;
  onLibraryNameChange: (value: string) => void;
  onCreateLibrary: () => Promise<void>;
  onAttachLibrary: (libraryId: string) => Promise<void>;
  onDetachLibrary: (libraryId: string) => Promise<void>;
  onAddLibraryElementToScreen: (libraryId: string, element: LibraryElement | string) => void;
  onPrepareLibraryElementUpdate: (libraryId: string, element: LibraryElement) => Promise<{ libraryId: string; elementId: string; elementName: string; confirmationLines: string[]; flattenedCount: number; flattenedObjects: HmiObject[]; macroIds: string[]; } | null>;
  onExecuteLibraryElementUpdate: (payload: { libraryId: string; elementId: string; elementName: string; flattenedObjects: HmiObject[]; macroIds: string[]; }) => Promise<void>;
  onSaveLibraryElementCopyFromSelection: (libraryId: string, element: LibraryElement, copyName: string) => Promise<void>;
  onRefreshLibraries?: () => Promise<void>;
  projectMacros: MacroDefinition[];
};

type TabId = "elements" | "assets" | "macros" | "metadata" | "interface";
type VisualRuleConditionType = ElementStateCase["condition"]["type"];
type VisualRuleValueKind = "string" | "number" | "boolean" | "color" | "asset";
type ApiErrorWithDetails = Error & { status?: number; details?: unknown };

type SignalDialogState = {
  open: boolean;
  mode: "create" | "edit";
  originalKey?: string;
  draft: ElementBindingDefinition;
  keyEditedManually: boolean;
  validationError?: string;
};

type SignalDeleteDialogState = {
  open: boolean;
  signal: ElementBindingDefinition | null;
  referencedRuleCount: number;
  usedByInstancesCount: number;
};

type SignalKeyMigrationDialogState = {
  open: boolean;
  oldKey: string;
  draft: ElementBindingDefinition;
};

type VisualRuleActionDraft = {
  id: string;
  objectId: string;
  property: string;
  kind: VisualRuleValueKind;
  value: string;
};

type VisualRuleDialogState = {
  open: boolean;
  mode: "create" | "edit";
  editingRuleId?: string;
  signalKey: string;
  condition: VisualRuleConditionType;
  value: string;
  value2: string;
  actions: VisualRuleActionDraft[];
  validationError?: string;
};

type VisualRuleDeleteDialogState = {
  open: boolean;
  ruleId: string;
  title: string;
};

type PropertyPickerDialogState = {
  open: boolean;
  actionIndex: number;
  query: string;
};

type DeleteLibraryDialogState = {
  open: boolean;
  canForce: boolean;
  message: string;
};

type DeleteElementDialogState = {
  open: boolean;
  element: LibraryElement | null;
  canForce: boolean;
  usagePreview: string[];
  message: string;
};

type SaveCopyDialogState = {
  open: boolean;
  libraryId: string;
  element: LibraryElement | null;
  name: string;
};

type WorkbenchDialogProps = {
  title: string;
  open: boolean;
  onClose: () => void;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  children: React.ReactNode;
  actions?: React.ReactNode;
  bodyClassName?: string;
};

type FlatObjectOption = {
  id: string;
  type: HmiObject["type"];
  label: string;
};

type VisualRulePropertyOption = {
  path: string;
  label: string;
  kind: VisualRuleValueKind;
};

type PropertySearchRow = {
  objectId: string;
  objectType: HmiObject["type"];
  objectLabel: string;
  propertyPath: string;
  kind: VisualRuleValueKind;
  searchText: string;
};

type PropertySearchGroup = {
  objectId: string;
  objectLabel: string;
  objectType: HmiObject["type"];
  rows: PropertySearchRow[];
};

type PropertyPickerTreeNode = DataNode & {
  nodeType: "object" | "property";
  row?: PropertySearchRow;
};

type UpdateElementDialogState = {
  open: boolean;
  payload: {
    libraryId: string;
    elementId: string;
    elementName: string;
    confirmationLines: string[];
    flattenedCount: number;
    flattenedObjects: HmiObject[];
    macroIds: string[];
  } | null;
};

const DATA_TYPE_OPTIONS: Array<NonNullable<ElementBindingDefinition["dataType"]>> = ["BOOL", "INT", "UINT", "DINT", "UDINT", "REAL", "STRING"];
const COLOR_HEX_PATTERN = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const VISUAL_RULE_COLOR_PALETTE = [
  "#00ff00",
  "#ff0000",
  "#ffff00",
  "#808080",
  "#ffffff",
  "#000000",
  "#0e639c",
  "#3c3c3c",
  "#262626",
  "#d7ba7d",
];

function formatOneDecimal(value: number | undefined): string {
  if (!Number.isFinite(value)) {
    return "0.0";
  }
  const normalized = Math.trunc((value ?? 0) * 10) / 10;
  return normalized.toFixed(1);
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSignalKey(displayName: string): string {
  const normalized = displayName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || `signal_${Math.random().toString(36).slice(2, 6)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractBindingKeyFromRuleSource(rule: NonNullable<LibraryElement["stateRules"]>[number]): string | null {
  if (rule.source.type !== "tag") {
    return null;
  }
  const value = (rule.source.value ?? "").trim();
  if (!value.startsWith("$binding.")) {
    return null;
  }
  const key = value.slice("$binding.".length).trim();
  return key || null;
}

function ruleReferencesSignalKey(rule: NonNullable<LibraryElement["stateRules"]>[number], key: string): boolean {
  const pattern = new RegExp(`\\$binding\\.${escapeRegExp(key)}\\b`);
  if (rule.source.type === "tag" || rule.source.type === "expression") {
    return pattern.test(rule.source.value ?? "");
  }
  return false;
}

function replaceRuleSignalKey(rule: NonNullable<LibraryElement["stateRules"]>[number], oldKey: string, newKey: string) {
  const pattern = new RegExp(`\\$binding\\.${escapeRegExp(oldKey)}\\b`, "g");
  if (rule.source.type === "tag" || rule.source.type === "expression") {
    return {
      ...rule,
      source: {
        ...rule.source,
        value: (rule.source.value ?? "").replace(pattern, `$binding.${newKey}`),
      },
    };
  }
  return rule;
}

function parseScalarToken(rawValue: string): string | number | boolean {
  const trimmed = rawValue.trim();
  if (trimmed.toLowerCase() === "true") {
    return true;
  }
  if (trimmed.toLowerCase() === "false") {
    return false;
  }
  const asNumber = Number(trimmed);
  if (trimmed !== "" && Number.isFinite(asNumber)) {
    return asNumber;
  }
  return trimmed;
}

const ROOT_PROPERTY_BLOCKLIST = new Set([
  "id",
  "type",
  "name",
  "objects",
  "bindings",
  "bindingAssignments",
  "parameterValues",
  "action",
  "tagIndexing",
  "tagIndexingByField",
]);

const TYPE_PROPERTY_HINTS: Partial<Record<HmiObject["type"], Array<{ path: string; kind: VisualRuleValueKind }>>> = {
  group: [{ path: "visible", kind: "boolean" }, { path: "opacity", kind: "number" }],
  text: [{ path: "text", kind: "string" }, { path: "visible", kind: "boolean" }, { path: "textStyle.color", kind: "color" }, { path: "textStyle.fontSize", kind: "number" }],
  line: [{ path: "visible", kind: "boolean" }, { path: "stroke", kind: "color" }, { path: "fill", kind: "color" }, { path: "strokeWidth", kind: "number" }],
  rectangle: [{ path: "visible", kind: "boolean" }, { path: "fill", kind: "color" }, { path: "stroke", kind: "color" }, { path: "strokeWidth", kind: "number" }],
  "value-display": [{ path: "visible", kind: "boolean" }, { path: "suffix", kind: "string" }, { path: "textStyle.color", kind: "color" }],
  "value-input": [{ path: "visible", kind: "boolean" }, { path: "suffix", kind: "string" }, { path: "textStyle.color", kind: "color" }],
  "state-indicator": [{ path: "visible", kind: "boolean" }, { path: "trueColor", kind: "color" }, { path: "falseColor", kind: "color" }, { path: "textStyle.color", kind: "color" }],
  button: [{ path: "visible", kind: "boolean" }, { path: "text", kind: "string" }, { path: "backgroundColor", kind: "color" }, { path: "borderColor", kind: "color" }, { path: "textStyle.color", kind: "color" }],
  switch: [{ path: "visible", kind: "boolean" }, { path: "onText", kind: "string" }, { path: "offText", kind: "string" }, { path: "onColor", kind: "color" }, { path: "offColor", kind: "color" }],
  image: [{ path: "visible", kind: "boolean" }, { path: "assetId", kind: "asset" }, { path: "fit", kind: "string" }, { path: "opacity", kind: "number" }],
  stateImage: [{ path: "visible", kind: "boolean" }, { path: "defaultAssetId", kind: "asset" }, { path: "badQualityAssetId", kind: "asset" }, { path: "fit", kind: "string" }],
  valueSelect: [{ path: "visible", kind: "boolean" }, { path: "textStyle.color", kind: "color" }],
  frame: [{ path: "visible", kind: "boolean" }, { path: "showBorder", kind: "boolean" }, { path: "borderColor", kind: "color" }, { path: "borderWidth", kind: "number" }],
  checkbox: [{ path: "visible", kind: "boolean" }, { path: "label", kind: "string" }, { path: "checkedColor", kind: "color" }, { path: "uncheckedColor", kind: "color" }],
  slider: [{ path: "visible", kind: "boolean" }, { path: "fillColor", kind: "color" }, { path: "trackColor", kind: "color" }, { path: "thumbColor", kind: "color" }, { path: "fontSize", kind: "number" }],
  "progress-bar": [{ path: "visible", kind: "boolean" }, { path: "fillColor", kind: "color" }, { path: "trackColor", kind: "color" }, { path: "textColor", kind: "color" }, { path: "fontSize", kind: "number" }],
  select: [{ path: "visible", kind: "boolean" }, { path: "placeholder", kind: "string" }, { path: "backgroundColor", kind: "color" }, { path: "textColor", kind: "color" }, { path: "fontSize", kind: "number" }],
  "radio-group": [{ path: "visible", kind: "boolean" }, { path: "selectedColor", kind: "color" }, { path: "unselectedColor", kind: "color" }, { path: "labelColor", kind: "color" }, { path: "fontSize", kind: "number" }],
  "numeric-input": [{ path: "visible", kind: "boolean" }, { path: "placeholder", kind: "string" }, { path: "textColor", kind: "color" }, { path: "backgroundColor", kind: "color" }, { path: "fontSize", kind: "number" }],
  valve: [{ path: "visible", kind: "boolean" }, { path: "label", kind: "string" }],
  pump: [{ path: "visible", kind: "boolean" }, { path: "label", kind: "string" }],
};

function flattenElementObjects(objects: HmiObject[], depth = 0): FlatObjectOption[] {
  const rows: FlatObjectOption[] = [];
  for (const item of objects) {
    const indent = depth > 0 ? `${"  ".repeat(depth)}- ` : "";
    rows.push({
      id: item.id,
      type: item.type,
      label: `${indent}${item.name?.trim() || item.id} (${item.type})`,
    });
    if (item.type === "group") {
      rows.push(...flattenElementObjects(item.objects, depth + 1));
    }
  }
  return rows;
}

function flattenObjectMap(objects: HmiObject[]): Map<string, HmiObject> {
  const map = new Map<string, HmiObject>();
  const scan = (items: HmiObject[]) => {
    for (const item of items) {
      map.set(item.id, item);
      if (item.type === "group") {
        scan(item.objects);
      }
    }
  };
  scan(objects);
  return map;
}

function inferVisualRuleValueKind(path: string, rawValue: unknown): VisualRuleValueKind {
  if (typeof rawValue === "boolean") {
    return "boolean";
  }
  if (typeof rawValue === "number") {
    return "number";
  }
  const leaf = path.split(".").pop()?.toLowerCase() ?? "";
  if (leaf === "assetid" || leaf.endsWith("assetid")) {
    return "asset";
  }
  if (leaf.includes("color") || leaf === "fill" || leaf === "stroke") {
    return "color";
  }
  return "string";
}

function collectObjectScalarProperties(
  object: unknown,
  prefix = "",
  depth = 0,
  target: Array<{ path: string; kind: VisualRuleValueKind }> = [],
): Array<{ path: string; kind: VisualRuleValueKind }> {
  if (!object || typeof object !== "object" || Array.isArray(object) || depth > 2) {
    return target;
  }
  const rows = Object.entries(object as Record<string, unknown>);
  for (const [key, value] of rows) {
    if (!key) {
      continue;
    }
    if (depth === 0 && ROOT_PROPERTY_BLOCKLIST.has(key)) {
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      target.push({ path, kind: inferVisualRuleValueKind(path, value) });
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      collectObjectScalarProperties(value, path, depth + 1, target);
    }
  }
  return target;
}

function getObjectPropertyOptions(object: HmiObject | undefined): VisualRulePropertyOption[] {
  if (!object) {
    return [];
  }
  const dynamic = collectObjectScalarProperties(object).map((item) => ({
    path: item.path,
    label: item.path,
    kind: item.kind,
  }));
  const hinted = (TYPE_PROPERTY_HINTS[object.type] ?? []).map((item) => ({
    path: item.path,
    label: item.path,
    kind: item.kind,
  }));
  const map = new Map<string, VisualRulePropertyOption>();
  for (const option of [...hinted, ...dynamic]) {
    if (!map.has(option.path)) {
      map.set(option.path, option);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeValueForKind(kind: VisualRuleValueKind, raw: string): string {
  if (kind === "boolean") {
    return raw === "false" ? "false" : "true";
  }
  if (kind === "number") {
    const nextNumber = Number(raw);
    return Number.isFinite(nextNumber) ? String(nextNumber) : "0";
  }
  if (kind === "color") {
    return COLOR_HEX_PATTERN.test(raw) ? raw.toLowerCase() : "#ffffff";
  }
  return raw;
}

function normalizeColorInput(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("#")) {
    return normalized;
  }
  return `#${normalized}`;
}

function defaultValueForKind(kind: VisualRuleValueKind): string {
  if (kind === "boolean") {
    return "true";
  }
  if (kind === "number") {
    return "0";
  }
  if (kind === "color") {
    return "#ffffff";
  }
  return "";
}

function createDefaultVisualRuleAction(
  objectId: string,
  options: VisualRulePropertyOption[],
): VisualRuleActionDraft {
  const preferredOrder = ["fill", "stroke", "text", "assetId", "visible"];
  const selectedOption = preferredOrder
    .map((path) => options.find((option) => option.path === path))
    .find(Boolean)
    ?? options[0];
  const kind = selectedOption?.kind ?? "string";
  return {
    id: createId("action"),
    objectId,
    property: selectedOption?.path ?? "visible",
    kind,
    value: defaultValueForKind(kind),
  };
}

function toVisualActionDraft(action: ElementStateAction): VisualRuleActionDraft {
  if (action.type === "setVisible") {
    return {
      id: createId("act"),
      objectId: action.objectId,
      property: "visible",
      kind: "boolean",
      value: action.visible ? "true" : "false",
    };
  }
  if (action.type === "setAsset") {
    return {
      id: createId("act"),
      objectId: action.objectId,
      property: "assetId",
      kind: "asset",
      value: action.assetId,
    };
  }
  if (action.type === "setText") {
    return {
      id: createId("act"),
      objectId: action.objectId,
      property: "text",
      kind: "string",
      value: action.text,
    };
  }
  if (action.type === "setFill") {
    return {
      id: createId("act"),
      objectId: action.objectId,
      property: "fill",
      kind: "color",
      value: action.color,
    };
  }
  if (action.type === "setStroke") {
    return {
      id: createId("act"),
      objectId: action.objectId,
      property: "stroke",
      kind: "color",
      value: action.color,
    };
  }
  return {
    id: createId("act"),
    objectId: action.objectId,
    property: action.property,
    kind: inferVisualRuleValueKind(action.property, action.value),
    value: String(action.value ?? ""),
  };
}

function fromVisualActionDraft(action: VisualRuleActionDraft): ElementStateAction {
  if (action.kind === "boolean") {
    return {
      type: "setProperty",
      objectId: action.objectId,
      property: action.property,
      value: action.value === "true",
    };
  }
  if (action.kind === "number") {
    return {
      type: "setProperty",
      objectId: action.objectId,
      property: action.property,
      value: Number(action.value),
    };
  }
  return {
    type: "setProperty",
    objectId: action.objectId,
    property: action.property,
    value: action.value,
  };
}
function describeCondition(condition: ElementStateCase["condition"]): string {
  switch (condition.type) {
    case "true":
      return "true";
    case "false":
      return "false";
    case "equals":
      return `equals ${String(condition.value ?? "")}`;
    case "notEquals":
      return `not equals ${String(condition.value ?? "")}`;
    case "greaterThan":
      return `> ${condition.value}`;
    case "lessThan":
      return `< ${condition.value}`;
    case "between":
      return `between ${condition.min} .. ${condition.max}`;
    default:
      return "condition";
  }
}

function describeAction(action: ElementStateAction): string {
  if (action.type === "setVisible") {
    return `${action.objectId}.visible = ${String(action.visible)}`;
  }
  if (action.type === "setAsset") {
    return `${action.objectId}.asset = ${action.assetId || "<empty>"}`;
  }
  if (action.type === "setText") {
    return `${action.objectId}.text = ${action.text || "<empty>"}`;
  }
  if (action.type === "setFill") {
    return `${action.objectId}.fill = ${action.color || "<empty>"}`;
  }
  if (action.type === "setStroke") {
    return `${action.objectId}.stroke = ${action.color || "<empty>"}`;
  }
  return `${action.objectId}.${action.property} = ${String(action.value ?? "")}`;
}

function countSignalAssignmentsInProject(
  project: ScadaProject | null,
  libraryId: string,
  elementId: string,
  bindingKey: string,
): number {
  if (!project) {
    return 0;
  }
  let count = 0;
  const scan = (objects: HmiObject[]): void => {
    for (const item of objects) {
      if (item.type === "libraryElementInstance" && item.libraryId === libraryId && item.elementId === elementId) {
        if (item.bindingAssignments?.[bindingKey]) {
          count += 1;
        }
      }
      if (item.type === "group") {
        scan(item.objects);
      }
    }
  };

  for (const screen of project.screens) {
    scan(screen.objects);
  }

  return count;
}

function mutateProjectInstanceAssignments(
  project: ScadaProject,
  libraryId: string,
  elementId: string,
  updater: (assignments: Record<string, unknown>) => { changed: boolean; nextAssignments: Record<string, unknown> },
): { nextProject: ScadaProject; changedInstances: number } {
  const nextProject = structuredClone(project);
  let changedInstances = 0;

  const scan = (objects: HmiObject[]): void => {
    for (const item of objects) {
      if (item.type === "libraryElementInstance" && item.libraryId === libraryId && item.elementId === elementId) {
        const currentAssignments = (item.bindingAssignments ?? {}) as Record<string, unknown>;
        const updated = updater(currentAssignments);
        if (updated.changed) {
          item.bindingAssignments = updated.nextAssignments as never;
          changedInstances += 1;
        }
      }
      if (item.type === "group") {
        scan(item.objects);
      }
    }
  };

  for (const screen of nextProject.screens) {
    scan(screen.objects);
  }

  return { nextProject, changedInstances };
}

function WorkbenchDialog({
  title,
  open,
  onClose,
  width = 520,
  height,
  minWidth = 320,
  minHeight = 220,
  resizable = false,
  children,
  actions,
  bodyClassName,
}: WorkbenchDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number | null }>({ width, height: height ?? null });

  useEffect(() => {
    if (!open) {
      setPosition(null);
    }
    if (open) {
      setSize({ width, height: height ?? null });
    }
  }, [open, width, height]);

  if (!open) {
    return null;
  }

  const onHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    event.preventDefault();
    const startRect = dialog.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const containerRect = dialog.parentElement?.getBoundingClientRect();
    const base = {
      x: startRect.left - (containerRect?.left ?? 0),
      y: startRect.top - (containerRect?.top ?? 0),
    };
    setPosition(base);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      setPosition({ x: base.x + dx, y: base.y + dy });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const onResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizable) {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startRect = dialog.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const base = {
      width: startRect.width,
      height: startRect.height,
    };
    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      setSize({
        width: Math.max(minWidth, Math.round(base.width + dx)),
        height: Math.max(minHeight, Math.round(base.height + dy)),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const dialogStyle: React.CSSProperties = position
    ? { position: "absolute", left: position.x, top: position.y, margin: 0 }
    : {};
  dialogStyle.width = size.width;
  if (size.height !== null) {
    dialogStyle.height = size.height;
    dialogStyle.display = "flex";
    dialogStyle.flexDirection = "column";
  }
  dialogStyle.minWidth = minWidth;
  if (height !== undefined || resizable) {
    dialogStyle.minHeight = minHeight;
  }
  const bodyStyle: React.CSSProperties | undefined = size.height !== null
    ? { flex: "1 1 auto", minHeight: 0, overflow: "hidden" }
    : undefined;

  return (
    <div className="workbench-confirm-backdrop" onPointerDown={(event) => event.stopPropagation()}>
      <div
        ref={dialogRef}
        className="workbench-confirm-dialog"
        style={dialogStyle}
      >
        <div className="workbench-confirm-dialog__header" onPointerDown={onHeaderPointerDown} style={{ cursor: "move", justifyContent: "space-between" }}>
          <span>{title}</span>
          <button type="button" className="workbench-button" onClick={onClose} aria-label="Close" style={{ height: 22 }}>
            x
          </button>
        </div>
        <div
          className={bodyClassName ? `workbench-confirm-dialog__body ${bodyClassName}` : "workbench-confirm-dialog__body"}
          style={bodyStyle}
        >
          {children}
        </div>
        {actions ? <div className="workbench-confirm-dialog__actions">{actions}</div> : null}
        {resizable ? (
          <div
            className="workbench-window__resize-handle"
            onPointerDown={onResizePointerDown}
            style={{ position: "absolute", right: 0, bottom: 0 }}
          />
        ) : null}
      </div>
    </div>
  );
}

export function ScreenEditorLibrariesWindow(props: ScreenEditorLibrariesWindowProps) {
  const {
    libraries,
    attachedLibraries,
    selectedObjectsCount,
    libraryId,
    libraryName,
    project,
    onUpdateProjectJson,
    onLibraryIdChange,
    onLibraryNameChange,
    onCreateLibrary,
    onAttachLibrary,
    onDetachLibrary,
    onAddLibraryElementToScreen,
    onPrepareLibraryElementUpdate,
    onExecuteLibraryElementUpdate,
    onSaveLibraryElementCopyFromSelection,
    onRefreshLibraries,
    projectMacros,
  } = props;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>(libraries[0]?.id ?? "");
  const [selectedElementId, setSelectedElementId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabId>("elements");
  const [validation, setValidation] = useState<Awaited<ReturnType<typeof api.validateLibraryImport>> | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [replaceLibrary, setReplaceLibrary] = useState(false);
  const [importAsCopy, setImportAsCopy] = useState(false);
  const [importMacrosToProject, setImportMacrosToProject] = useState(false);
  const [macroConflictMode, setMacroConflictMode] = useState<"skip" | "overwrite" | "copy">("skip");
  const [metadataName, setMetadataName] = useState("");
  const [metadataDescription, setMetadataDescription] = useState("");
  const [metadataVersion, setMetadataVersion] = useState("");
  const [selectedProjectMacroId, setSelectedProjectMacroId] = useState("");
  const [savingInterface, setSavingInterface] = useState(false);
  const [interfaceError, setInterfaceError] = useState<string | null>(null);

  const [signalDialog, setSignalDialog] = useState<SignalDialogState>({
    open: false,
    mode: "create",
    draft: {
      id: createId("binding"),
      key: "",
      displayName: "",
      kind: "state",
      dataType: "BOOL",
      required: false,
      description: "",
    },
    keyEditedManually: false,
  });
  const [signalDeleteDialog, setSignalDeleteDialog] = useState<SignalDeleteDialogState>({
    open: false,
    signal: null,
    referencedRuleCount: 0,
    usedByInstancesCount: 0,
  });
  const [signalKeyMigrationDialog, setSignalKeyMigrationDialog] = useState<SignalKeyMigrationDialogState>({
    open: false,
    oldKey: "",
    draft: {
      id: "",
      key: "",
      displayName: "",
      kind: "state",
      dataType: "BOOL",
      required: false,
      description: "",
    },
  });

  const [visualRuleDialog, setVisualRuleDialog] = useState<VisualRuleDialogState>({
    open: false,
    mode: "create",
    signalKey: "",
    condition: "true",
    value: "",
    value2: "",
    actions: [],
  });
  const [visualRuleDeleteDialog, setVisualRuleDeleteDialog] = useState<VisualRuleDeleteDialogState>({
    open: false,
    ruleId: "",
    title: "",
  });
  const [propertyPickerDialog, setPropertyPickerDialog] = useState<PropertyPickerDialogState>({
    open: false,
    actionIndex: -1,
    query: "",
  });
  const [activeColorActionId, setActiveColorActionId] = useState<string | null>(null);
  const [propertyPickerExpandedObjectIds, setPropertyPickerExpandedObjectIds] = useState<string[]>([]);
  const [deleteLibraryDialog, setDeleteLibraryDialog] = useState<DeleteLibraryDialogState>({
    open: false,
    canForce: false,
    message: "",
  });
  const [deleteElementDialog, setDeleteElementDialog] = useState<DeleteElementDialogState>({
    open: false,
    element: null,
    canForce: false,
    usagePreview: [],
    message: "",
  });
  const [updateElementDialog, setUpdateElementDialog] = useState<UpdateElementDialogState>({
    open: false,
    payload: null,
  });
  const [saveCopyDialog, setSaveCopyDialog] = useState<SaveCopyDialogState>({
    open: false,
    libraryId: "",
    element: null,
    name: "",
  });

  useEffect(() => {
    if (!selectedLibraryId || !libraries.some((item) => item.id === selectedLibraryId)) {
      setSelectedLibraryId(libraries[0]?.id ?? "");
    }
  }, [libraries, selectedLibraryId]);

  useEffect(() => {
    setSelectedElementId("");
  }, [selectedLibraryId]);

  const attachedIds = useMemo(
    () =>
      new Set(
        attachedLibraries
          .filter((ref) => ref.enabled)
          .map((ref) => ref.libraryId),
      ),
    [attachedLibraries],
  );

  const selectedLibrary = useMemo(
    () => libraries.find((item) => item.id === selectedLibraryId),
    [libraries, selectedLibraryId],
  );
  const selectedElement = useMemo(
    () => selectedLibrary?.elements.find((item) => item.id === selectedElementId) ?? null,
    [selectedElementId, selectedLibrary],
  );

  const flatElementObjects = useMemo(
    () => flattenElementObjects(selectedElement?.objects ?? []),
    [selectedElement],
  );
  const flatElementObjectMap = useMemo(
    () => flattenObjectMap(selectedElement?.objects ?? []),
    [selectedElement],
  );
  const propertyOptionsByObjectId = useMemo(() => {
    const map = new Map<string, VisualRulePropertyOption[]>();
    for (const [objectId, object] of flatElementObjectMap.entries()) {
      map.set(objectId, getObjectPropertyOptions(object));
    }
    return map;
  }, [flatElementObjectMap]);
  const propertySearchRows = useMemo(() => {
    const rows: PropertySearchRow[] = [];
    for (const objectOption of flatElementObjects) {
      const options = propertyOptionsByObjectId.get(objectOption.id) ?? [];
      for (const option of options) {
        rows.push({
          objectId: objectOption.id,
          objectType: objectOption.type,
          objectLabel: objectOption.label,
          propertyPath: option.path,
          kind: option.kind,
          searchText: `${objectOption.label} ${objectOption.type} ${objectOption.id} ${option.path}`.toLowerCase(),
        });
      }
    }
    return rows;
  }, [flatElementObjects, propertyOptionsByObjectId]);
  const filteredPropertySearchRows = useMemo(() => {
    const query = propertyPickerDialog.query.trim().toLowerCase();
    const filtered = query
      ? propertySearchRows.filter((row) => row.searchText.includes(query))
      : propertySearchRows;
    return filtered.slice(0, 200);
  }, [propertySearchRows, propertyPickerDialog.query]);
  const filteredPropertySearchGroups = useMemo(() => {
    const map = new Map<string, PropertySearchGroup>();
    for (const row of filteredPropertySearchRows) {
      const current = map.get(row.objectId);
      if (!current) {
        map.set(row.objectId, {
          objectId: row.objectId,
          objectLabel: row.objectLabel,
          objectType: row.objectType,
          rows: [row],
        });
        continue;
      }
      current.rows.push(row);
    }
    return Array.from(map.values());
  }, [filteredPropertySearchRows]);
  const propertyPickerTreeData = useMemo<PropertyPickerTreeNode[]>(
    () =>
      filteredPropertySearchGroups.map((group) => ({
        key: `obj:${group.objectId}`,
        nodeType: "object",
        selectable: false,
        title: (
          <span className="screen-editor-setproperty-picker__tree-object">
            {group.objectLabel} ({group.objectType}) - {group.rows.length} properties
          </span>
        ),
        children: group.rows.map((row) => ({
          key: `prop:${row.objectId}:${row.propertyPath}`,
          nodeType: "property",
          row,
          title: (
            <span className="screen-editor-setproperty-picker__tree-property">
              <span className="screen-editor-setproperty-picker__property">{row.propertyPath}</span>
              <span className="screen-editor-setproperty-picker__kind">{row.kind.toUpperCase()}</span>
            </span>
          ),
          isLeaf: true,
        })),
      })),
    [filteredPropertySearchGroups],
  );
  const propertyPickerExpandedKeys = useMemo(
    () => (propertyPickerDialog.query.trim() ? filteredPropertySearchGroups.map((group) => `obj:${group.objectId}`) : propertyPickerExpandedObjectIds),
    [filteredPropertySearchGroups, propertyPickerDialog.query, propertyPickerExpandedObjectIds],
  );

  const signalUsedInRulesCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const binding of selectedElement?.bindings ?? []) {
      map.set(binding.key, 0);
    }
    for (const rule of selectedElement?.stateRules ?? []) {
      const key = extractBindingKeyFromRuleSource(rule);
      if (!key) {
        continue;
      }
      map.set(key, (map.get(key) ?? 0) + (rule.cases?.length ?? 0));
    }
    return map;
  }, [selectedElement]);

  const visualRuleCards = useMemo(() => {
    const rows: Array<{
      ruleId: string;
      name: string;
      signalKey: string;
      condition: ElementStateCase["condition"];
      actions: ElementStateAction[];
      editable: boolean;
      reason?: string;
    }> = [];
    for (const rule of selectedElement?.stateRules ?? []) {
      const signalKey = extractBindingKeyFromRuleSource(rule);
      const firstCase = rule.cases?.[0];
      const hasMultipleCases = (rule.cases?.length ?? 0) > 1;
      if (!signalKey || !firstCase || hasMultipleCases) {
        rows.push({
          ruleId: rule.id,
          name: rule.name,
          signalKey: signalKey ?? "",
          condition: firstCase?.condition ?? { type: "true" },
          actions: firstCase?.actions ?? [],
          editable: false,
          reason: !signalKey
            ? "Source is not a Signal"
            : hasMultipleCases
              ? "Rule has multiple cases"
              : "Rule has no case",
        });
        continue;
      }
      rows.push({
        ruleId: rule.id,
        name: rule.name,
        signalKey,
        condition: firstCase.condition,
        actions: firstCase.actions,
        editable: true,
      });
    }
    return rows;
  }, [selectedElement]);

  useEffect(() => {
    if (!selectedLibrary) {
      setSelectedElementId("");
      return;
    }
    if (selectedElementId && !selectedLibrary.elements.some((item) => item.id === selectedElementId)) {
      setSelectedElementId("");
    }
  }, [selectedElementId, selectedLibrary]);

  useEffect(() => {
    if (!selectedLibrary) {
      setMetadataName("");
      setMetadataDescription("");
      setMetadataVersion("");
      return;
    }
    setMetadataName(selectedLibrary.name);
    setMetadataDescription(selectedLibrary.description ?? "");
    setMetadataVersion(selectedLibrary.version ?? "1.0.0");
  }, [selectedLibrary]);

  const refresh = async (): Promise<void> => {
    await onRefreshLibraries?.();
  };

  const triggerImportDialog = (): void => {
    fileInputRef.current?.click();
  };

  const onImportFileSelected = async (file: File): Promise<void> => {
    setValidation(null);
    setImportFile(file);
    setIsValidating(true);
    try {
      const result = await api.validateLibraryImport(file);
      setValidation(result);
      setReplaceLibrary(Boolean(result.conflicts.libraryExists));
      setImportAsCopy(false);
    } catch (error) {
      setValidation({
        ok: true,
        valid: false,
        conflicts: { libraryExists: false, elementConflicts: [], assetConflicts: [], projectMacroConflicts: [] },
        warnings: [],
        errors: [{ code: "VALIDATION_FAILED", message: error instanceof Error ? error.message : "Validation failed" }],
      });
    } finally {
      setIsValidating(false);
    }
  };

  const confirmImport = async (): Promise<void> => {
    if (!importFile || !validation?.valid) {
      return;
    }
    try {
      await api.importLibrary(importFile, {
        replace: replaceLibrary,
        importAsCopy,
        importMacrosToProject,
        macroConflictMode,
      });
      setValidation(null);
      setImportFile(null);
      await refresh();
    } catch {
      // no-op
    }
  };

  const exportSelectedLibrary = async (): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    const exported = await api.exportLibrary(selectedLibrary.id);
    const url = URL.createObjectURL(exported.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exported.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const confirmDeleteLibrary = async (force = false): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    try {
      await api.deleteLibrary(selectedLibrary.id, force ? { force: true } : undefined);
      setDeleteLibraryDialog({ open: false, canForce: false, message: "" });
      await refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Failed to delete library";
      setDeleteLibraryDialog({
        open: true,
        canForce: !force,
        message: text,
      });
    }
  };

  const confirmDeleteElement = async (force = false): Promise<void> => {
    if (!selectedLibrary || !deleteElementDialog.element) {
      return;
    }
    try {
      await api.deleteLibraryElement(
        selectedLibrary.id,
        deleteElementDialog.element.id,
        force ? { force: true } : undefined,
      );
      setDeleteElementDialog({ open: false, element: null, canForce: false, usagePreview: [], message: "" });
      await refresh();
    } catch (error) {
      const apiError = error as ApiErrorWithDetails;
      if (!force && apiError.status === 409) {
        const usage =
          (apiError.details && typeof apiError.details === "object" && "usage" in apiError.details
            ? (apiError.details as { usage?: Array<{ screenName?: string; path?: string }> }).usage
            : undefined) ?? [];
        const usagePreview = usage
          .slice(0, 5)
          .map((item) => `${item.screenName ?? "Screen"}: ${item.path ?? "unknown path"}`);
        setDeleteElementDialog((prev) => ({
          ...prev,
          open: true,
          canForce: true,
          usagePreview,
          message: usage.length > 0
            ? `Element is used by ${usage.length} object(s).`
            : "Element is used in project.",
        }));
        return;
      }
      setDeleteElementDialog((prev) => ({
        ...prev,
        open: true,
        canForce: !force,
        message: apiError.message || "Failed to delete element",
      }));
    }
  };

  const saveMetadata = async (): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    await api.updateLibrary(selectedLibrary.id, {
      name: metadataName.trim(),
      description: metadataDescription,
      version: metadataVersion.trim() || "1.0.0",
    });
    await refresh();
  };

  const addProjectMacroToLibrary = async (): Promise<void> => {
    if (!selectedLibrary || !selectedProjectMacroId) {
      return;
    }
    const macro = projectMacros.find((item) => item.id === selectedProjectMacroId);
    if (!macro) {
      return;
    }
    await api.createLibraryMacro(selectedLibrary.id, macro);
    await refresh();
  };

  const importMacroToProject = async (macroId: string): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    try {
      await api.importLibraryMacroToProject(selectedLibrary.id, macroId);
    } catch {
      await api.importLibraryMacroToProject(selectedLibrary.id, macroId, { overwrite: true });
    }
  };

  const importAllMacrosToProject = async (): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    await api.importAllLibraryMacrosToProject(selectedLibrary.id, { overwrite: false });
  };

  const deleteMacroFromLibrary = async (macroId: string): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    await api.deleteLibraryMacro(selectedLibrary.id, macroId);
    await refresh();
  };

  const saveElementPatch = async (element: LibraryElement, patch: Partial<LibraryElement>): Promise<void> => {
    if (!selectedLibrary) {
      return;
    }
    setSavingInterface(true);
    setInterfaceError(null);
    try {
      await api.updateLibraryElement(selectedLibrary.id, element.id, patch);
      await refresh();
    } catch (error) {
      setInterfaceError(error instanceof Error ? error.message : "Failed to save interface.");
    } finally {
      setSavingInterface(false);
    }
  };

  const startCreateSignal = () => {
    if (!selectedElement) {
      return;
    }
    const keyBase = createSignalKey(`signal_${(selectedElement.bindings?.length ?? 0) + 1}`);
    setSignalDialog({
      open: true,
      mode: "create",
      draft: {
        id: createId("binding"),
        key: keyBase,
        displayName: "",
        kind: "state",
        dataType: "BOOL",
        required: false,
        description: "",
      },
      keyEditedManually: false,
    });
  };

  const startEditSignal = (signal: ElementBindingDefinition) => {
    setSignalDialog({
      open: true,
      mode: "edit",
      originalKey: signal.key,
      draft: {
        ...signal,
        description: signal.description ?? "",
        required: signal.required ?? false,
      },
      keyEditedManually: true,
    });
  };

  const validateSignalDraft = (draft: ElementBindingDefinition, mode: "create" | "edit", originalKey?: string): string | null => {
    if (!selectedElement) {
      return "No selected element.";
    }
    if (!draft.displayName.trim()) {
      return "Display name is required.";
    }
    if (!draft.key.trim()) {
      return "Key is required.";
    }
    if (!/^[a-zA-Z0-9_]+$/.test(draft.key.trim())) {
      return "Key supports only letters, numbers, underscore.";
    }
    const duplicate = (selectedElement.bindings ?? []).some((binding) => binding.key === draft.key && (mode !== "edit" || binding.key !== originalKey));
    if (duplicate) {
      return "Signal key must be unique in this element.";
    }
    return null;
  };

  const applySignalUpdate = async ({
    oldKey,
    draft,
    migrateAssignments,
  }: {
    oldKey: string | null;
    draft: ElementBindingDefinition;
    migrateAssignments: boolean;
  }) => {
    if (!selectedElement) {
      return;
    }

    const oldBindings = selectedElement.bindings ?? [];
    const nextBindings = oldKey
      ? oldBindings.map((binding) => (binding.key === oldKey ? draft : binding))
      : [...oldBindings, draft];

    const keyChanged = Boolean(oldKey && oldKey !== draft.key);

    const nextStateRules = keyChanged
      ? (selectedElement.stateRules ?? []).map((rule) => replaceRuleSignalKey(rule, oldKey!, draft.key))
      : (selectedElement.stateRules ?? []);

    if (keyChanged && project && onUpdateProjectJson && migrateAssignments && selectedLibrary) {
      const migrated = mutateProjectInstanceAssignments(project, selectedLibrary.id, selectedElement.id, (assignments) => {
        const oldAssignment = assignments[oldKey!];
        if (!oldAssignment) {
          return { changed: false, nextAssignments: assignments };
        }
        const nextAssignments = { ...assignments };
        if (nextAssignments[draft.key] === undefined) {
          nextAssignments[draft.key] = oldAssignment;
        }
        delete nextAssignments[oldKey!];
        return { changed: true, nextAssignments };
      });
      if (migrated.changedInstances > 0) {
        onUpdateProjectJson(migrated.nextProject);
      }
    }

    await saveElementPatch(selectedElement, {
      bindings: nextBindings,
      stateRules: nextStateRules,
    });

    setSignalDialog((prev) => ({ ...prev, open: false }));
    setSignalKeyMigrationDialog((prev) => ({ ...prev, open: false }));
  };

  const saveSignalDialog = async () => {
    if (!selectedElement) {
      return;
    }
    const draft = {
      ...signalDialog.draft,
      key: signalDialog.draft.key.trim(),
      displayName: signalDialog.draft.displayName.trim(),
      description: (signalDialog.draft.description ?? "").trim(),
      id: signalDialog.draft.id || createId("binding"),
    };
    const validationError = validateSignalDraft(draft, signalDialog.mode, signalDialog.originalKey);
    if (validationError) {
      setSignalDialog((prev) => ({ ...prev, validationError }));
      return;
    }

    if (signalDialog.mode === "edit" && signalDialog.originalKey && signalDialog.originalKey !== draft.key) {
      setSignalKeyMigrationDialog({
        open: true,
        oldKey: signalDialog.originalKey,
        draft,
      });
      return;
    }

    await applySignalUpdate({
      oldKey: signalDialog.mode === "edit" ? signalDialog.originalKey ?? null : null,
      draft,
      migrateAssignments: false,
    });
  };

  const startDeleteSignal = (signal: ElementBindingDefinition) => {
    if (!selectedElement || !selectedLibrary) {
      return;
    }
    const referencedRuleCount = (selectedElement.stateRules ?? []).filter((rule) => ruleReferencesSignalKey(rule, signal.key)).length;
    const usedByInstancesCount = countSignalAssignmentsInProject(project, selectedLibrary.id, selectedElement.id, signal.key);
    setSignalDeleteDialog({
      open: true,
      signal,
      referencedRuleCount,
      usedByInstancesCount,
    });
  };

  const confirmDeleteSignal = async () => {
    if (!selectedElement || !selectedLibrary || !signalDeleteDialog.signal) {
      return;
    }
    const signal = signalDeleteDialog.signal;
    const nextBindings = (selectedElement.bindings ?? []).filter((binding) => binding.key !== signal.key);
    const nextRules = (selectedElement.stateRules ?? []).filter((rule) => !ruleReferencesSignalKey(rule, signal.key));

    if (project && onUpdateProjectJson) {
      const cleaned = mutateProjectInstanceAssignments(project, selectedLibrary.id, selectedElement.id, (assignments) => {
        if (!(signal.key in assignments)) {
          return { changed: false, nextAssignments: assignments };
        }
        const nextAssignments = { ...assignments };
        delete nextAssignments[signal.key];
        return { changed: true, nextAssignments };
      });
      if (cleaned.changedInstances > 0) {
        onUpdateProjectJson(cleaned.nextProject);
      }
    }

    await saveElementPatch(selectedElement, {
      bindings: nextBindings,
      stateRules: nextRules,
    });
    setSignalDeleteDialog({ open: false, signal: null, referencedRuleCount: 0, usedByInstancesCount: 0 });
  };

  const updateVisualRuleAction = (actionIndex: number, patch: Partial<VisualRuleActionDraft>) => {
    setVisualRuleDialog((prev) => {
      const nextActions = [...prev.actions];
      const current = nextActions[actionIndex];
      if (!current) {
        return prev;
      }
      nextActions[actionIndex] = { ...current, ...patch };
      return { ...prev, actions: nextActions, validationError: undefined };
    });
  };

  const openPropertyPickerForAction = (actionIndex: number) => {
    setActiveColorActionId(null);
    setPropertyPickerDialog({
      open: true,
      actionIndex,
      query: "",
    });
    setPropertyPickerExpandedObjectIds([]);
  };

  const applyPropertyFromPicker = (row: PropertySearchRow) => {
    setVisualRuleDialog((prev) => {
      if (propertyPickerDialog.actionIndex < 0 || propertyPickerDialog.actionIndex >= prev.actions.length) {
        return prev;
      }
      const nextActions = [...prev.actions];
      const current = nextActions[propertyPickerDialog.actionIndex];
      if (!current) {
        return prev;
      }
      const nextValue = current.kind === row.kind
        ? normalizeValueForKind(row.kind, current.value)
        : defaultValueForKind(row.kind);
      nextActions[propertyPickerDialog.actionIndex] = {
        ...current,
        objectId: row.objectId,
        property: row.propertyPath,
        kind: row.kind,
        value: nextValue,
      };
      return { ...prev, actions: nextActions, validationError: undefined };
    });
    setPropertyPickerDialog((prev) => ({ ...prev, open: false }));
    setPropertyPickerExpandedObjectIds([]);
  };

  useEffect(() => {
    if (!propertyPickerDialog.open) {
      return;
    }
    if (propertyPickerDialog.actionIndex < 0 || propertyPickerDialog.actionIndex >= visualRuleDialog.actions.length) {
      setPropertyPickerDialog({ open: false, actionIndex: -1, query: "" });
      setPropertyPickerExpandedObjectIds([]);
    }
  }, [propertyPickerDialog, visualRuleDialog.actions.length]);

  useEffect(() => {
    if (!visualRuleDialog.open && propertyPickerDialog.open) {
      setPropertyPickerDialog({ open: false, actionIndex: -1, query: "" });
      setPropertyPickerExpandedObjectIds([]);
    }
  }, [propertyPickerDialog.open, visualRuleDialog.open]);

  useEffect(() => {
    if (!visualRuleDialog.open) {
      setActiveColorActionId(null);
      return;
    }
    if (activeColorActionId && visualRuleDialog.actions.every((action) => action.id !== activeColorActionId)) {
      setActiveColorActionId(null);
    }
  }, [activeColorActionId, visualRuleDialog.actions, visualRuleDialog.open]);

  const startCreateVisualRule = () => {
    if (!selectedElement) {
      return;
    }
    const signalKey = selectedElement.bindings?.[0]?.key ?? "";
    const defaultObject = flatElementObjects[0]?.id ?? "";
    const defaultOptions = defaultObject ? (propertyOptionsByObjectId.get(defaultObject) ?? []) : [];
    setVisualRuleDialog({
      open: true,
      mode: "create",
      signalKey,
      condition: "true",
      value: "",
      value2: "",
      actions: defaultObject
        ? [createDefaultVisualRuleAction(defaultObject, defaultOptions)]
        : [],
    });
  };

  const startEditVisualRule = (ruleId: string) => {
    const card = visualRuleCards.find((item) => item.ruleId === ruleId);
    if (!card || !card.editable) {
      return;
    }
    const condition = card.condition.type;
    const value =
      condition === "equals" || condition === "notEquals" || condition === "greaterThan" || condition === "lessThan"
        ? String((card.condition as { value?: unknown }).value ?? "")
        : "";
    const value2 = condition === "between" ? String((card.condition as { min: number; max: number }).max ?? "") : "";

    setVisualRuleDialog({
      open: true,
      mode: "edit",
      editingRuleId: card.ruleId,
      signalKey: card.signalKey,
      condition,
      value,
      value2,
      actions: card.actions.map((action) => toVisualActionDraft(action)),
    });
  };

  const validateVisualRuleDialog = (): string | null => {
    if (!selectedElement) {
      return "No selected element.";
    }
    if (!visualRuleDialog.signalKey) {
      return "Select a Signal.";
    }
    if ((selectedElement.bindings ?? []).every((binding) => binding.key !== visualRuleDialog.signalKey)) {
      return "Selected Signal no longer exists.";
    }
    if (visualRuleDialog.actions.length === 0) {
      return "Add at least one action.";
    }
    if (visualRuleDialog.actions.some((action) => !action.objectId)) {
      return "Choose object for each action.";
    }
    if (visualRuleDialog.actions.some((action) => !action.property.trim())) {
      return "Choose property for each action.";
    }
    if (visualRuleDialog.actions.some((action) => action.kind === "number" && !Number.isFinite(Number(action.value)))) {
      return "Number property value must be numeric.";
    }
    if (visualRuleDialog.actions.some((action) => action.kind === "color" && !COLOR_HEX_PATTERN.test(normalizeColorInput(action.value)))) {
      return "Color value must be HEX (#RRGGBB or #RGB).";
    }
    if ((visualRuleDialog.condition === "greaterThan" || visualRuleDialog.condition === "lessThan" || visualRuleDialog.condition === "between")
      && !Number.isFinite(Number(visualRuleDialog.value))) {
      return "Condition value must be a number.";
    }
    if (visualRuleDialog.condition === "between" && !Number.isFinite(Number(visualRuleDialog.value2))) {
      return "Max value must be a number.";
    }
    return null;
  };

  const saveVisualRuleDialog = async () => {
    if (!selectedElement) {
      return;
    }

    const validationError = validateVisualRuleDialog();
    if (validationError) {
      setVisualRuleDialog((prev) => ({ ...prev, validationError }));
      return;
    }

    const condition: ElementStateCase["condition"] = (() => {
      if (visualRuleDialog.condition === "true" || visualRuleDialog.condition === "false") {
        return { type: visualRuleDialog.condition };
      }
      if (visualRuleDialog.condition === "equals" || visualRuleDialog.condition === "notEquals") {
        return { type: visualRuleDialog.condition, value: parseScalarToken(visualRuleDialog.value) };
      }
      if (visualRuleDialog.condition === "greaterThan" || visualRuleDialog.condition === "lessThan") {
        return { type: visualRuleDialog.condition, value: Number(visualRuleDialog.value) };
      }
      return {
        type: "between",
        min: Number(visualRuleDialog.value),
        max: Number(visualRuleDialog.value2),
      };
    })();

    const nextRule: NonNullable<LibraryElement["stateRules"]>[number] = {
      id: visualRuleDialog.mode === "edit" ? visualRuleDialog.editingRuleId || createId("rule") : createId("rule"),
      name: visualRuleDialog.mode === "edit" ? "Visual Rule" : `Visual Rule ${(selectedElement.stateRules?.length ?? 0) + 1}`,
      source: {
        type: "tag",
        value: `$binding.${visualRuleDialog.signalKey}`,
      },
      cases: [
        {
          id: createId("case"),
          name: "when",
          condition,
          actions: visualRuleDialog.actions.map((action) => {
            if (action.kind !== "color") {
              return fromVisualActionDraft(action);
            }
            return fromVisualActionDraft({
              ...action,
              value: normalizeColorInput(action.value).toLowerCase(),
            });
          }),
        },
      ],
    };

    const existingRules = selectedElement.stateRules ?? [];
    const nextRules = visualRuleDialog.mode === "edit"
      ? existingRules.map((rule) => (rule.id === visualRuleDialog.editingRuleId ? nextRule : rule))
      : [...existingRules, nextRule];

    await saveElementPatch(selectedElement, { stateRules: nextRules });
    setVisualRuleDialog({
      open: false,
      mode: "create",
      signalKey: "",
      condition: "true",
      value: "",
      value2: "",
      actions: [],
    });
  };

  const startDeleteVisualRule = (ruleId: string, title: string) => {
    setVisualRuleDeleteDialog({
      open: true,
      ruleId,
      title,
    });
  };

  const confirmDeleteVisualRule = async () => {
    if (!selectedElement) {
      return;
    }
    const nextRules = (selectedElement.stateRules ?? []).filter((rule) => rule.id !== visualRuleDeleteDialog.ruleId);
    await saveElementPatch(selectedElement, { stateRules: nextRules });
    setVisualRuleDeleteDialog({ open: false, ruleId: "", title: "" });
  };

  return (
    <div className="screen-editor-window-content screen-editor-libraries-window">
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.webscada-library.zip"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void onImportFileSelected(file);
          }
        }}
      />

      <WorkbenchSection title="LIBRARY TOOLBAR">
        <div style={{ padding: "0 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <WorkbenchButton onClick={() => void onCreateLibrary()}>Create</WorkbenchButton>
          <WorkbenchButton onClick={triggerImportDialog}>Import</WorkbenchButton>
          <WorkbenchButton onClick={() => void exportSelectedLibrary()} disabled={!selectedLibrary}>Export</WorkbenchButton>
          <WorkbenchButton
            variant="danger"
            onClick={() => setDeleteLibraryDialog({
              open: true,
              canForce: false,
              message: selectedLibrary ? `Delete library "${selectedLibrary.name}"?` : "Delete selected library?",
            })}
            disabled={!selectedLibrary}
          >
            Delete
          </WorkbenchButton>
          <WorkbenchButton onClick={() => void refresh()}>Refresh</WorkbenchButton>
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="CREATE LIBRARY">
        <div style={{ padding: "0 10px", display: "grid", gap: 6 }}>
          <input
            className="workbench-input"
            value={libraryId}
            onChange={(event) => onLibraryIdChange(event.target.value)}
            placeholder="Library ID"
          />
          <input
            className="workbench-input"
            value={libraryName}
            onChange={(event) => onLibraryNameChange(event.target.value)}
            placeholder="Library name"
          />
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="LIBRARIES">
        <div className="screen-editor-library-list">
          {libraries.map((library) => {
            const isAttached = attachedIds.has(library.id);
            return (
              <div
                key={library.id}
                className="screen-editor-library-item"
                onClick={() => setSelectedLibraryId(library.id)}
                style={{ outline: selectedLibraryId === library.id ? "1px solid #4e8ff0" : undefined, cursor: "pointer" }}
              >
                <div className="screen-editor-item-title">{library.name}</div>
                <div className="screen-editor-item-meta">
                  {library.id} | v{library.version} | {library.elements.length} elements | {library.assets.length} assets | {(library.macros ?? []).length} macros
                </div>
                <div className="screen-editor-item-actions">
                  {isAttached ? (
                    <WorkbenchButton onClick={() => void onDetachLibrary(library.id)}>Detach</WorkbenchButton>
                  ) : (
                    <WorkbenchButton variant="primary" onClick={() => void onAttachLibrary(library.id)}>Attach</WorkbenchButton>
                  )}
                  <WorkbenchButton onClick={() => setSelectedLibraryId(library.id)}>Open</WorkbenchButton>
                </div>
              </div>
            );
          })}
        </div>
      </WorkbenchSection>

      {importFile ? (
        <WorkbenchSection title="IMPORT VALIDATION">
          <div style={{ padding: "0 10px", display: "grid", gap: 6 }}>
            <div className="screen-editor-item-meta">File: {importFile.name}</div>
            <div className="screen-editor-item-meta">{isValidating ? "Validating library archive..." : validation?.valid ? "Archive is valid" : "Archive is invalid"}</div>
            {validation?.errors?.map((item) => (
              <div key={`err-${item.code}-${item.path ?? ""}`} className="screen-editor-item-meta" style={{ color: "#ff9c9c" }}>
                {item.message}{item.path ? ` (${item.path})` : ""}
              </div>
            ))}
            {validation?.warnings?.map((item) => (
              <div key={`warn-${item.code}-${item.path ?? ""}`} className="screen-editor-item-meta" style={{ color: "#f5d283" }}>
                {item.message}{item.path ? ` (${item.path})` : ""}
              </div>
            ))}
            {validation?.valid ? (
              <>
                <label className="screen-editor-item-meta"><input type="checkbox" checked={replaceLibrary} onChange={(event) => setReplaceLibrary(event.target.checked)} /> Replace existing library</label>
                <label className="screen-editor-item-meta"><input type="checkbox" checked={importAsCopy} onChange={(event) => setImportAsCopy(event.target.checked)} /> Import as copy</label>
                <label className="screen-editor-item-meta"><input type="checkbox" checked={importMacrosToProject} onChange={(event) => setImportMacrosToProject(event.target.checked)} /> Import macros to project</label>
                <select className="workbench-select" value={macroConflictMode} onChange={(event) => setMacroConflictMode(event.target.value as "skip" | "overwrite" | "copy")}>
                  <option value="skip">Skip macro conflicts</option>
                  <option value="overwrite">Overwrite macro conflicts</option>
                  <option value="copy">Import macro conflicts as copies</option>
                </select>
                <div style={{ display: "flex", gap: 6 }}>
                  <WorkbenchButton variant="primary" onClick={() => void confirmImport()}>Confirm Import</WorkbenchButton>
                  <WorkbenchButton onClick={() => { setImportFile(null); setValidation(null); }}>Cancel</WorkbenchButton>
                </div>
              </>
            ) : null}
          </div>
        </WorkbenchSection>
      ) : null}

      {selectedLibrary ? (
        <WorkbenchSection title="LIBRARY DETAILS">
          <div style={{ padding: "0 10px", display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <WorkbenchButton onClick={() => setActiveTab("elements")}>Elements</WorkbenchButton>
              <WorkbenchButton onClick={() => setActiveTab("interface")}>Interface</WorkbenchButton>
              <WorkbenchButton onClick={() => setActiveTab("assets")}>Assets</WorkbenchButton>
              <WorkbenchButton onClick={() => setActiveTab("macros")}>Macros</WorkbenchButton>
              <WorkbenchButton onClick={() => setActiveTab("metadata")}>Metadata</WorkbenchButton>
            </div>

            {activeTab === "elements" ? (
              <div className="screen-editor-library-element-list">
                {!attachedIds.has(selectedLibrary.id) ? (
                  <div className="screen-editor-item-meta">Attach library to add elements to screen.</div>
                ) : null}
                {(selectedLibrary.elements ?? []).map((element) => (
                  <div
                    key={element.id}
                    className="screen-editor-library-element-item"
                    style={{ outline: selectedElementId === element.id ? "1px solid #4e8ff0" : undefined, cursor: "pointer" }}
                    onClick={() => setSelectedElementId(element.id)}
                  >
                    <div className="screen-editor-item-title">{element.name}</div>
                    <div className="screen-editor-item-meta">
                      {element.category ?? "General"} · {formatOneDecimal(element.width)}x{formatOneDecimal(element.height)}
                    </div>
                    {element.description?.trim() ? (
                      <div className="screen-editor-item-meta">{element.description.trim()}</div>
                    ) : null}
                  </div>
                ))}
                {selectedElement ? (
                  <div className="screen-editor-library-element-item">
                    <div className="screen-editor-item-title">Selected: {selectedElement.name}</div>
                    <div className="screen-editor-item-meta">Canvas selection: {selectedObjectsCount} object(s)</div>
                    <div className="screen-editor-item-actions">
                      <WorkbenchButton
                        variant="primary"
                        disabled={!attachedIds.has(selectedLibrary.id)}
                        onClick={() => onAddLibraryElementToScreen(selectedLibrary.id, selectedElement)}
                      >
                        Add to Screen
                      </WorkbenchButton>
                      <WorkbenchButton
                        disabled={selectedObjectsCount === 0}
                        onClick={async () => {
                          const payload = await onPrepareLibraryElementUpdate(selectedLibrary.id, selectedElement);
                          if (payload) {
                            setUpdateElementDialog({ open: true, payload });
                          }
                        }}
                      >
                        Update from Selection
                      </WorkbenchButton>
                      <WorkbenchButton
                        disabled={selectedObjectsCount === 0}
                        onClick={() => setSaveCopyDialog({
                          open: true,
                          libraryId: selectedLibrary.id,
                          element: selectedElement,
                          name: `${selectedElement.name} copy`,
                        })}
                      >
                        Save as Copy
                      </WorkbenchButton>
                      <WorkbenchButton
                        variant="danger"
                        onClick={() => setDeleteElementDialog({
                          open: true,
                          element: selectedElement,
                          canForce: false,
                          usagePreview: [],
                          message: `Delete element "${selectedElement.name}" from library "${selectedLibrary.name}"?`,
                        })}
                      >
                        Delete
                      </WorkbenchButton>
                    </div>
                  </div>
                ) : (
                  <div className="screen-editor-item-meta">Select an element to see actions.</div>
                )}
              </div>
            ) : null}

            {activeTab === "interface" ? (
              <div className="screen-editor-library-interface">
                {!selectedElement ? (
                  <div className="screen-editor-item-meta">Select an element to edit its interface.</div>
                ) : (
                  <>
                    <div className="screen-editor-library-element-item">
                      <div className="screen-editor-item-title">{selectedElement.name}</div>
                      <div className="screen-editor-item-meta">Element id: {selectedElement.id}</div>
                      <div className="screen-editor-item-meta">Element key: {selectedElement.elementKey ?? "-"}</div>
                      <div className="screen-editor-item-meta">Size: {formatOneDecimal(selectedElement.width)} x {formatOneDecimal(selectedElement.height)}</div>
                      <div className="screen-editor-item-meta">Internal objects: {flatElementObjects.length}</div>
                      <div className="screen-editor-item-meta">Signals: {selectedElement.bindings?.length ?? 0}</div>
                      <div className="screen-editor-item-meta">Visual Rules: {selectedElement.stateRules?.length ?? 0}</div>
                      <div className="screen-editor-item-meta">Parameters: {selectedElement.parameters?.length ?? 0}</div>
                    </div>

                    <div className="screen-editor-item-meta">
                      Signals define external tag inputs for this library element. Visual Rules define how these signals change internal objects.
                      When this element is placed on a screen, users map only these signals to real tags.
                    </div>

                    {interfaceError ? <div className="screen-editor-library-interface__error">{interfaceError}</div> : null}

                    <div className="screen-editor-library-interface__section">
                      <div className="screen-editor-library-interface__section-title">SIGNALS</div>
                      <div>
                        <WorkbenchButton onClick={startCreateSignal} disabled={savingInterface}>Add Signal</WorkbenchButton>
                      </div>
                      {(selectedElement.bindings ?? []).length === 0 ? (
                        <div className="screen-editor-item-meta">No Signals yet.</div>
                      ) : (
                        (selectedElement.bindings ?? []).map((signal) => (
                          <div key={signal.id} className="screen-editor-signal-card">
                            <div className="screen-editor-item-title">{signal.displayName}</div>
                            <div className="screen-editor-item-meta">key: {signal.key}</div>
                            <div className="screen-editor-item-meta">type: {signal.dataType ?? "-"}</div>
                            <div className="screen-editor-item-meta">used in rules: {signalUsedInRulesCount.get(signal.key) ?? 0}</div>
                            {selectedLibrary ? (
                              <div className="screen-editor-item-meta">
                                used by instances: {countSignalAssignmentsInProject(project, selectedLibrary.id, selectedElement.id, signal.key)}
                              </div>
                            ) : null}
                            <div className="screen-editor-item-actions">
                              <WorkbenchButton onClick={() => startEditSignal(signal)} disabled={savingInterface}>Edit</WorkbenchButton>
                              <WorkbenchButton variant="danger" onClick={() => startDeleteSignal(signal)} disabled={savingInterface}>Delete</WorkbenchButton>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="screen-editor-library-interface__section">
                      <div className="screen-editor-library-interface__section-title">VISUAL RULES</div>
                      <div>
                        <WorkbenchButton onClick={startCreateVisualRule} disabled={savingInterface || (selectedElement.bindings?.length ?? 0) === 0}>
                          Add Visual Rule
                        </WorkbenchButton>
                      </div>
                      {visualRuleCards.length === 0 ? (
                        <div className="screen-editor-item-meta">No Visual Rules yet.</div>
                      ) : (
                        visualRuleCards.map((rule) => (
                          <div key={rule.ruleId} className="screen-editor-visual-rule-card">
                            <div className="screen-editor-item-title">{rule.name || "Visual Rule"}</div>
                            <div className="screen-editor-item-meta">Signal: {rule.signalKey || "-"}</div>
                            <div className="screen-editor-item-meta">Condition: {describeCondition(rule.condition)}</div>
                            <div className="screen-editor-item-meta">Actions:</div>
                            <div className="screen-editor-library-interface__rule-actions">
                              {rule.actions.map((action, index) => (
                                <div key={`${rule.ruleId}-act-${index}`} className="screen-editor-item-meta">- {describeAction(action)}</div>
                              ))}
                            </div>
                            {!rule.editable ? (
                              <div className="screen-editor-item-meta" style={{ color: "#f5d283" }}>
                                Complex rule: {rule.reason}
                              </div>
                            ) : null}
                            <div className="screen-editor-item-actions">
                              <WorkbenchButton onClick={() => startEditVisualRule(rule.ruleId)} disabled={!rule.editable || savingInterface}>Edit</WorkbenchButton>
                              <WorkbenchButton variant="danger" onClick={() => startDeleteVisualRule(rule.ruleId, rule.name || "Visual Rule")} disabled={savingInterface}>Delete</WorkbenchButton>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {activeTab === "assets" ? (
              <div className="screen-editor-library-element-list">
                {(selectedLibrary.assets ?? []).map((asset) => (
                  <div key={asset.id} className="screen-editor-library-element-item">
                    <div className="screen-editor-item-title">{asset.name}</div>
                    <div className="screen-editor-item-meta">{asset.fileName} · {asset.mimeType}</div>
                  </div>
                ))}
              </div>
            ) : null}

            {activeTab === "macros" ? (
              <div className="screen-editor-library-element-list">
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <select className="workbench-select" value={selectedProjectMacroId} onChange={(event) => setSelectedProjectMacroId(event.target.value)}>
                    <option value="">Select project macro</option>
                    {projectMacros.map((macro) => (
                      <option key={macro.id} value={macro.id}>{macro.name}</option>
                    ))}
                  </select>
                  <WorkbenchButton onClick={() => void addProjectMacroToLibrary()}>Add Project Macro</WorkbenchButton>
                  <WorkbenchButton onClick={() => void importAllMacrosToProject()}>Import All</WorkbenchButton>
                </div>
                {(selectedLibrary.macros ?? []).map((macro) => (
                  <div key={macro.id} className="screen-editor-library-element-item">
                    <div className="screen-editor-item-title">{macro.name}</div>
                    <div className="screen-editor-item-meta">{macro.id} · {macro.enabled === false ? "disabled" : "enabled"}</div>
                    <div className="screen-editor-item-actions">
                      <WorkbenchButton onClick={() => void importMacroToProject(macro.id)}>Import To Project</WorkbenchButton>
                      <WorkbenchButton onClick={() => void deleteMacroFromLibrary(macro.id)}>Delete</WorkbenchButton>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {activeTab === "metadata" ? (
              <div style={{ display: "grid", gap: 6 }}>
                <input className="workbench-input" value={metadataName} onChange={(event) => setMetadataName(event.target.value)} placeholder="Name" />
                <input className="workbench-input" value={metadataVersion} onChange={(event) => setMetadataVersion(event.target.value)} placeholder="Version" />
                <textarea className="workbench-input" value={metadataDescription} onChange={(event) => setMetadataDescription(event.target.value)} placeholder="Description" style={{ minHeight: 72 }} />
                <WorkbenchButton variant="primary" onClick={() => void saveMetadata()}>Save Metadata</WorkbenchButton>
              </div>
            ) : null}
          </div>
        </WorkbenchSection>
      ) : null}

      <WorkbenchDialog
        title="Delete Library"
        open={deleteLibraryDialog.open}
        onClose={() => setDeleteLibraryDialog({ open: false, canForce: false, message: "" })}
        width={520}
        actions={(
          <>
            <WorkbenchButton onClick={() => setDeleteLibraryDialog({ open: false, canForce: false, message: "" })}>Cancel</WorkbenchButton>
            {deleteLibraryDialog.canForce ? (
              <WorkbenchButton variant="danger" onClick={() => void confirmDeleteLibrary(true)}>Force Delete</WorkbenchButton>
            ) : null}
            <WorkbenchButton variant="danger" onClick={() => void confirmDeleteLibrary(false)}>Delete</WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-item-meta">{deleteLibraryDialog.message}</div>
      </WorkbenchDialog>

      <WorkbenchDialog
        title="Delete Element"
        open={deleteElementDialog.open}
        onClose={() => setDeleteElementDialog({ open: false, element: null, canForce: false, usagePreview: [], message: "" })}
        width={620}
        actions={(
          <>
            <WorkbenchButton onClick={() => setDeleteElementDialog({ open: false, element: null, canForce: false, usagePreview: [], message: "" })}>Cancel</WorkbenchButton>
            {deleteElementDialog.canForce ? (
              <WorkbenchButton variant="danger" onClick={() => void confirmDeleteElement(true)}>Force Delete</WorkbenchButton>
            ) : null}
            <WorkbenchButton variant="danger" onClick={() => void confirmDeleteElement(false)}>Delete</WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-item-meta">{deleteElementDialog.message}</div>
        {deleteElementDialog.usagePreview.length ? (
          <div className="screen-editor-library-interface__warning">
            {deleteElementDialog.usagePreview.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}
      </WorkbenchDialog>

      <WorkbenchDialog
        title={signalDialog.mode === "create" ? "Add Signal" : "Edit Signal"}
        open={signalDialog.open}
        onClose={() => setSignalDialog((prev) => ({ ...prev, open: false }))}
        width={560}
        actions={(
          <>
            <WorkbenchButton onClick={() => setSignalDialog((prev) => ({ ...prev, open: false }))}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={() => void saveSignalDialog()} disabled={savingInterface}>Save</WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-library-interface__dialog-grid">
          <label>
            <span>Display name</span>
            <input
              className="workbench-input"
              value={signalDialog.draft.displayName}
              onChange={(event) => {
                const displayName = event.target.value;
                setSignalDialog((prev) => {
                  const nextKey = prev.mode === "create" && !prev.keyEditedManually
                    ? createSignalKey(displayName)
                    : prev.draft.key;
                  return {
                    ...prev,
                    validationError: undefined,
                    draft: {
                      ...prev.draft,
                      displayName,
                      key: nextKey,
                    },
                  };
                });
              }}
            />
          </label>
          <label>
            <span>Key</span>
            <input
              className="workbench-input"
              value={signalDialog.draft.key}
              onChange={(event) => {
                setSignalDialog((prev) => ({
                  ...prev,
                  keyEditedManually: true,
                  validationError: undefined,
                  draft: {
                    ...prev.draft,
                    key: event.target.value,
                  },
                }));
              }}
            />
          </label>
          <label>
            <span>Data type</span>
            <select
              className="workbench-select"
              value={signalDialog.draft.dataType ?? "BOOL"}
              onChange={(event) => setSignalDialog((prev) => ({
                ...prev,
                draft: {
                  ...prev.draft,
                  dataType: event.target.value as NonNullable<ElementBindingDefinition["dataType"]>,
                },
              }))}
            >
              {DATA_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label>
            <span>Description</span>
            <input
              className="workbench-input"
              value={signalDialog.draft.description ?? ""}
              onChange={(event) => setSignalDialog((prev) => ({
                ...prev,
                draft: {
                  ...prev.draft,
                  description: event.target.value,
                },
              }))}
            />
          </label>
          <label className="screen-editor-library-interface__checkbox">
            <input
              type="checkbox"
              checked={Boolean(signalDialog.draft.required)}
              onChange={(event) => setSignalDialog((prev) => ({
                ...prev,
                draft: {
                  ...prev.draft,
                  required: event.target.checked,
                },
              }))}
            />
            Required
          </label>
        </div>
        {signalDialog.validationError ? <div className="screen-editor-library-interface__error">{signalDialog.validationError}</div> : null}
      </WorkbenchDialog>

      <WorkbenchDialog
        title="Delete Signal"
        open={signalDeleteDialog.open}
        onClose={() => setSignalDeleteDialog({ open: false, signal: null, referencedRuleCount: 0, usedByInstancesCount: 0 })}
        width={520}
        actions={(
          <>
            <WorkbenchButton onClick={() => setSignalDeleteDialog({ open: false, signal: null, referencedRuleCount: 0, usedByInstancesCount: 0 })}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="danger" onClick={() => void confirmDeleteSignal()} disabled={savingInterface}>Remove Signal</WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-item-meta">Signal: {signalDeleteDialog.signal?.displayName}</div>
        <div className="screen-editor-item-meta">Key: {signalDeleteDialog.signal?.key}</div>
        <div className="screen-editor-item-meta">Referenced visual rules: {signalDeleteDialog.referencedRuleCount}</div>
        <div className="screen-editor-item-meta">Instance mappings: {signalDeleteDialog.usedByInstancesCount}</div>
        <div className="screen-editor-library-interface__warning">
          This signal may be used by existing instances. Remove this signal and clear corresponding mappings from all instances?
        </div>
      </WorkbenchDialog>

      <WorkbenchDialog
        title="Signal Key Changed"
        open={signalKeyMigrationDialog.open}
        onClose={() => setSignalKeyMigrationDialog((prev) => ({ ...prev, open: false }))}
        width={620}
        actions={(
          <>
            <WorkbenchButton onClick={() => setSignalKeyMigrationDialog((prev) => ({ ...prev, open: false }))}>Cancel</WorkbenchButton>
            <WorkbenchButton onClick={() => void applySignalUpdate({ oldKey: signalKeyMigrationDialog.oldKey, draft: signalKeyMigrationDialog.draft, migrateAssignments: false })}>
              Keep as New Signal
            </WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={() => void applySignalUpdate({ oldKey: signalKeyMigrationDialog.oldKey, draft: signalKeyMigrationDialog.draft, migrateAssignments: true })}>
              Migrate Mappings
            </WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-item-meta">
          Signal key changed from <strong>{signalKeyMigrationDialog.oldKey}</strong> to <strong>{signalKeyMigrationDialog.draft.key}</strong>.
        </div>
        <div className="screen-editor-item-meta">Migrate existing instance tag mappings?</div>
        <div className="screen-editor-library-interface__warning">
          Keep as New Signal will keep old instance mappings unchanged. They may become obsolete under Advanced.
        </div>
      </WorkbenchDialog>

      <WorkbenchDialog
        title={visualRuleDialog.mode === "create" ? "Add Visual Rule" : "Edit Visual Rule"}
        open={visualRuleDialog.open}
        onClose={() => setVisualRuleDialog((prev) => ({ ...prev, open: false }))}
        width={760}
        actions={(
          <>
            <WorkbenchButton onClick={() => setVisualRuleDialog((prev) => ({ ...prev, open: false }))}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={() => void saveVisualRuleDialog()} disabled={savingInterface}>Save</WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-library-interface__dialog-grid">
          <label>
            <span>Signal</span>
            <select
              className="workbench-select"
              value={visualRuleDialog.signalKey}
              onChange={(event) => setVisualRuleDialog((prev) => ({ ...prev, signalKey: event.target.value, validationError: undefined }))}
            >
              <option value="">Select signal</option>
              {(selectedElement?.bindings ?? []).map((binding) => (
                <option key={binding.id} value={binding.key}>{binding.displayName} ({binding.key})</option>
              ))}
            </select>
          </label>
          <label>
            <span>Condition</span>
            <select
              className="workbench-select"
              value={visualRuleDialog.condition}
              onChange={(event) => setVisualRuleDialog((prev) => ({
                ...prev,
                condition: event.target.value as VisualRuleConditionType,
                validationError: undefined,
              }))}
            >
              <option value="true">true</option>
              <option value="false">false</option>
              <option value="equals">equals</option>
              <option value="notEquals">notEquals</option>
              <option value="greaterThan">greaterThan</option>
              <option value="lessThan">lessThan</option>
              <option value="between">between</option>
            </select>
          </label>
          {visualRuleDialog.condition !== "true" && visualRuleDialog.condition !== "false" ? (
            <label>
              <span>Value</span>
              <input
                className="workbench-input"
                value={visualRuleDialog.value}
                onChange={(event) => setVisualRuleDialog((prev) => ({ ...prev, value: event.target.value, validationError: undefined }))}
              />
            </label>
          ) : null}
          {visualRuleDialog.condition === "between" ? (
            <label>
              <span>Value 2</span>
              <input
                className="workbench-input"
                value={visualRuleDialog.value2}
                onChange={(event) => setVisualRuleDialog((prev) => ({ ...prev, value2: event.target.value, validationError: undefined }))}
              />
            </label>
          ) : null}
        </div>

        <div className="screen-editor-library-interface__section-title" style={{ marginTop: 8 }}>Then Actions</div>
        <div className="screen-editor-library-interface__rule-actions-editor">
          {visualRuleDialog.actions.map((action, index) => (
            <div key={action.id} className="screen-editor-library-interface__rule-action-row">
              <div className="screen-editor-library-interface__action-target">
                <div className="screen-editor-item-meta">
                  {action.objectId ? (flatElementObjectMap.get(action.objectId)?.name?.trim() || action.objectId) : "Object not selected"}
                </div>
                <div className="screen-editor-item-meta">
                  {action.property || "Property not selected"}
                </div>
              </div>
              <WorkbenchButton onClick={() => openPropertyPickerForAction(index)}>
                Set Property...
              </WorkbenchButton>

              {action.kind === "boolean" ? (
                <select
                  className="workbench-select"
                  value={action.value}
                  onChange={(event) => updateVisualRuleAction(index, { value: event.target.value })}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : null}

              {action.kind === "asset" ? (
                <select
                  className="workbench-select"
                  value={action.value}
                  onChange={(event) => updateVisualRuleAction(index, { value: event.target.value })}
                >
                  <option value="">Select asset</option>
                  {(selectedLibrary?.assets ?? []).map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.name}</option>
                  ))}
                </select>
              ) : null}

              {action.kind === "number" ? (
                <input
                  className="workbench-input"
                  value={action.value}
                  type="number"
                  onChange={(event) => updateVisualRuleAction(index, { value: event.target.value })}
                />
              ) : null}

              {action.kind === "string" ? (
                <input
                  className="workbench-input"
                  value={action.value}
                  type="text"
                  onChange={(event) => updateVisualRuleAction(index, { value: event.target.value })}
                />
              ) : null}

              {action.kind === "color" ? (
                <div className="screen-editor-library-interface__color-field">
                  <button
                    type="button"
                    className="screen-editor-library-interface__color-swatch"
                    style={{ backgroundColor: COLOR_HEX_PATTERN.test(normalizeColorInput(action.value)) ? normalizeColorInput(action.value) : "#000000" }}
                    onClick={() => setActiveColorActionId((prev) => (prev === action.id ? null : action.id))}
                    title="Pick color"
                  />
                  <input
                    className="workbench-input"
                    value={action.value}
                    type="text"
                    placeholder="#00ff00"
                    onChange={(event) => updateVisualRuleAction(index, { value: normalizeColorInput(event.target.value) })}
                  />
                  {activeColorActionId === action.id ? (
                    <div className="screen-editor-library-interface__color-popover">
                      <div className="screen-editor-library-interface__color-grid">
                        {VISUAL_RULE_COLOR_PALETTE.map((hex) => (
                          <button
                            key={`${action.id}-${hex}`}
                            type="button"
                            className="screen-editor-library-interface__color-chip"
                            style={{ backgroundColor: hex }}
                            title={hex}
                            onClick={() => {
                              updateVisualRuleAction(index, { value: hex });
                              setActiveColorActionId(null);
                            }}
                          />
                        ))}
                      </div>
                      <div className="screen-editor-library-interface__color-popover-actions">
                        <WorkbenchButton onClick={() => setActiveColorActionId(null)}>Close</WorkbenchButton>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <WorkbenchButton
                variant="danger"
                onClick={() => {
                  setVisualRuleDialog((prev) => ({
                    ...prev,
                    actions: prev.actions.filter((_, actionIndex) => actionIndex !== index),
                  }));
                  if (activeColorActionId === action.id) {
                    setActiveColorActionId(null);
                  }
                }}
              >
                Delete
              </WorkbenchButton>
            </div>
          ))}
        </div>
        <WorkbenchButton
          onClick={() => setVisualRuleDialog((prev) => ({
            ...prev,
            actions: (() => {
              const objectId = flatElementObjects[0]?.id ?? "";
              if (!objectId) {
                return prev.actions;
              }
              const options = propertyOptionsByObjectId.get(objectId) ?? [];
              return [...prev.actions, createDefaultVisualRuleAction(objectId, options)];
            })(),
          }))}
        >
          Add Action
        </WorkbenchButton>
        {visualRuleDialog.validationError ? <div className="screen-editor-library-interface__error">{visualRuleDialog.validationError}</div> : null}
      </WorkbenchDialog>

      <WorkbenchDialog
        title="SetProperty Picker"
        open={propertyPickerDialog.open}
        onClose={() => {
          setPropertyPickerDialog({ open: false, actionIndex: -1, query: "" });
          setPropertyPickerExpandedObjectIds([]);
        }}
        width={700}
        height={460}
        minWidth={520}
        minHeight={320}
        resizable
        bodyClassName="screen-editor-opc-browser-content screen-editor-setproperty-picker"
        actions={(
          <>
            <WorkbenchButton
              onClick={() => {
                setPropertyPickerDialog({ open: false, actionIndex: -1, query: "" });
                setPropertyPickerExpandedObjectIds([]);
              }}
            >
              Close
            </WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-opc-browser-toolbar">
          <input
            className="workbench-input screen-editor-opc-browser-toolbar__search"
            value={propertyPickerDialog.query}
            onChange={(event) => setPropertyPickerDialog((prev) => ({ ...prev, query: event.target.value }))}
            placeholder="Search object, id, type, property..."
          />
        </div>
        <div className="screen-editor-opc-browser-list screen-editor-setproperty-picker__list">
          <div className="screen-editor-setproperty-picker__tree">
            <Tree
              treeData={propertyPickerTreeData}
              expandedKeys={propertyPickerExpandedKeys}
              onExpand={(keys) => {
                if (propertyPickerDialog.query.trim()) {
                  return;
                }
                setPropertyPickerExpandedObjectIds(keys.map((key) => String(key)));
              }}
              onSelect={(_, info) => {
                const node = info.node as PropertyPickerTreeNode;
                if (node.nodeType === "property" && node.row) {
                  applyPropertyFromPicker(node.row);
                }
              }}
            />
            {filteredPropertySearchRows.length === 0 ? (
              <div className="screen-editor-empty-state">Nothing found.</div>
            ) : null}
          </div>
        </div>
        <div className="screen-editor-setproperty-picker__footer">
          <span>Objects: {filteredPropertySearchGroups.length} | Properties: {filteredPropertySearchRows.length} / {propertySearchRows.length}</span>
        </div>
      </WorkbenchDialog>

      <WorkbenchDialog
        title="Delete Visual Rule"
        open={visualRuleDeleteDialog.open}
        onClose={() => setVisualRuleDeleteDialog({ open: false, ruleId: "", title: "" })}
        width={460}
        actions={(
          <>
            <WorkbenchButton onClick={() => setVisualRuleDeleteDialog({ open: false, ruleId: "", title: "" })}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="danger" onClick={() => void confirmDeleteVisualRule()} disabled={savingInterface}>Delete</WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-item-meta">Delete visual rule "{visualRuleDeleteDialog.title}"?</div>
      </WorkbenchDialog>

      <WorkbenchDialog
        title="Update Library Element"
        open={updateElementDialog.open}
        onClose={() => setUpdateElementDialog({ open: false, payload: null })}
        width={480}
        actions={(
          <>
            <WorkbenchButton onClick={() => setUpdateElementDialog({ open: false, payload: null })}>
              Cancel
            </WorkbenchButton>
            <WorkbenchButton
              variant="primary"
              onClick={async () => {
                if (updateElementDialog.payload) {
                  await onExecuteLibraryElementUpdate(updateElementDialog.payload);
                  setUpdateElementDialog({ open: false, payload: null });
                }
              }}
            >
              Update
            </WorkbenchButton>
          </>
        )}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {updateElementDialog.payload?.confirmationLines.map((line, i) => (
            <div key={i} className="screen-editor-item-meta" style={{ color: i === 0 ? "white" : undefined }}>
              {line}
            </div>
          ))}
          {updateElementDialog.payload && updateElementDialog.payload.flattenedCount > 0 ? (
            <div className="screen-editor-item-meta" style={{ color: "#f5d283", marginTop: 8 }}>
              Note: Selection contains {updateElementDialog.payload.flattenedCount} instance(s) of this element which will be expanded to avoid recursion.
            </div>
          ) : null}
        </div>
      </WorkbenchDialog>

      <WorkbenchDialog
        title="Save Element as Copy"
        open={saveCopyDialog.open}
        onClose={() => setSaveCopyDialog({ open: false, libraryId: "", element: null, name: "" })}
        width={520}
        actions={(
          <>
            <WorkbenchButton onClick={() => setSaveCopyDialog({ open: false, libraryId: "", element: null, name: "" })}>
              Cancel
            </WorkbenchButton>
            <WorkbenchButton
              variant="primary"
              onClick={async () => {
                if (!saveCopyDialog.element || !saveCopyDialog.libraryId) {
                  return;
                }
                await onSaveLibraryElementCopyFromSelection(
                  saveCopyDialog.libraryId,
                  saveCopyDialog.element,
                  saveCopyDialog.name,
                );
                setSaveCopyDialog({ open: false, libraryId: "", element: null, name: "" });
              }}
            >
              Save
            </WorkbenchButton>
          </>
        )}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="screen-editor-item-meta">Element name</span>
            <input
              className="workbench-input"
              value={saveCopyDialog.name}
              onChange={(event) => setSaveCopyDialog((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Copy name"
              autoFocus
            />
          </label>
        </div>
      </WorkbenchDialog>
    </div>
  );
}


