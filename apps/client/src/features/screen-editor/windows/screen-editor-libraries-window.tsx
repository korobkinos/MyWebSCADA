import { useEffect, useMemo, useRef, useState } from "react";
import { ColorPicker, Tree } from "antd";
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
  RuntimeAction,
  ScadaProject,
} from "@web-scada/shared";
import { api } from "../../../services/api";
import { WorkbenchButton, WorkbenchIconButton, WorkbenchSection, WorkbenchTabs, type WorkbenchTabItem } from "../../../components/workbench";
import {
  createObjectIoAction,
  getObjectIoActionMode,
  getObjectIoFields,
  supportsObjectIoAction,
  type ObjectIoActionMode,
  type ObjectIoFieldDefinition,
} from "../utils/object-io-fields";

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
type InterfaceDialogTab = "signals" | "visualRules" | "objectIo";
type VisualRuleClauseConditionType =
  | Exclude<ElementStateCase["condition"]["type"], "true" | "false">
  | "greaterOrEqual"
  | "lessOrEqual";
type VisualRuleLogicOperator = "AND" | "OR" | "XOR";
type VisualRuleValueKind = "string" | "number" | "boolean" | "color" | "asset";
type ApiErrorWithDetails = Error & { status?: number; details?: unknown };
const MAX_VISUAL_RULE_CONDITIONS = 8;

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

type VisualRuleConditionClauseDraft = {
  id: string;
  signalKey: string;
  condition: VisualRuleClauseConditionType;
  value: string;
  value2: string;
};

type VisualRuleDialogState = {
  open: boolean;
  mode: "create" | "edit";
  editingRuleId?: string;
  name: string;
  logic: VisualRuleLogicOperator;
  clauses: VisualRuleConditionClauseDraft[];
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
  zIndex?: number;
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

type ObjectIoPickerTreeNode = DataNode & {
  nodeType: "object";
  objectId?: string;
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

type RenameElementDialogState = {
  open: boolean;
  element: LibraryElement | null;
  nextName: string;
  error?: string;
};

type ObjectIoDialogState = {
  open: boolean;
  draftObjects: HmiObject[];
  selectedObjectId: string;
  dirty: boolean;
};

type ObjectIoSummaryCard = {
  objectId: string;
  objectType: HmiObject["type"];
  objectLabel: string;
  readTags: string[];
  writeTags: string[];
  statusTags: string[];
  actionTags: string[];
  modeText?: string;
};

const DATA_TYPE_OPTIONS: Array<NonNullable<ElementBindingDefinition["dataType"]>> = ["BOOL", "INT", "UINT", "DINT", "UDINT", "REAL", "STRING"];
const BINDING_KIND_OPTIONS: Array<{ label: string; value: ElementBindingDefinition["kind"] }> = [
  { label: "State / Read Tag", value: "state" },
  { label: "Write Tag", value: "writeTag" },
  { label: "Command", value: "command" },
  { label: "Custom", value: "custom" },
  { label: "Tag", value: "tag" },
];
const COLOR_HEX_PATTERN = /^#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})$/;

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

function formatBindingKindLabel(kind: ElementBindingDefinition["kind"] | undefined): string {
  if (kind === "writeTag") {
    return "Write Tag";
  }
  if (kind === "command") {
    return "Command";
  }
  if (kind === "custom") {
    return "Custom";
  }
  if (kind === "tag") {
    return "Tag";
  }
  return "State / Read Tag";
}

function isBoolSignalDataType(dataType: ElementBindingDefinition["dataType"] | undefined): boolean {
  return dataType === "BOOL";
}

function isBoolClauseCondition(condition: VisualRuleClauseConditionType): boolean {
  return condition === "equals" || condition === "notEquals";
}

function normalizeClauseBySignalDataType(
  clause: VisualRuleConditionClauseDraft,
  dataType: ElementBindingDefinition["dataType"] | undefined,
): VisualRuleConditionClauseDraft {
  if (!isBoolSignalDataType(dataType)) {
    return clause;
  }
  return {
    ...clause,
    condition: isBoolClauseCondition(clause.condition) ? clause.condition : "equals",
    value: clause.value === "false" ? "false" : "true",
    value2: "",
  };
}

function createDefaultVisualRuleClause(signalKey: string, dataType?: ElementBindingDefinition["dataType"]): VisualRuleConditionClauseDraft {
  const isBool = dataType === "BOOL";
  return {
    id: createId("cond"),
    signalKey,
    condition: "equals",
    value: isBool ? "true" : "0",
    value2: "",
  };
}

function conditionNeedsNumericValue(condition: VisualRuleClauseConditionType): boolean {
  return condition === "greaterThan" || condition === "lessThan" || condition === "greaterOrEqual" || condition === "lessOrEqual" || condition === "between";
}

function conditionNeedsSecondValue(condition: VisualRuleClauseConditionType): boolean {
  return condition === "between";
}

function toExpressionLiteral(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === null || value === undefined) {
    return "null";
  }
  return JSON.stringify(String(value));
}

function buildConditionClauseExpression(clause: VisualRuleConditionClauseDraft): string {
  const signalRef = `$binding.${clause.signalKey}`;
  if (clause.condition === "equals") {
    return `eq(tag(${JSON.stringify(signalRef)}), ${toExpressionLiteral(parseScalarToken(clause.value))})`;
  }
  if (clause.condition === "notEquals") {
    return `neq(tag(${JSON.stringify(signalRef)}), ${toExpressionLiteral(parseScalarToken(clause.value))})`;
  }
  if (clause.condition === "greaterThan") {
    return `gt(num(tag(${JSON.stringify(signalRef)})), ${Number(clause.value)})`;
  }
  if (clause.condition === "lessThan") {
    return `lt(num(tag(${JSON.stringify(signalRef)})), ${Number(clause.value)})`;
  }
  if (clause.condition === "greaterOrEqual") {
    return `gte(num(tag(${JSON.stringify(signalRef)})), ${Number(clause.value)})`;
  }
  if (clause.condition === "lessOrEqual") {
    return `lte(num(tag(${JSON.stringify(signalRef)})), ${Number(clause.value)})`;
  }
  return `between(num(tag(${JSON.stringify(signalRef)})), ${Number(clause.value)}, ${Number(clause.value2)})`;
}

function buildConditionsExpression(clauses: VisualRuleConditionClauseDraft[], logic: VisualRuleLogicOperator): string {
  if (clauses.length === 0) {
    return "false";
  }
  const parts = clauses.map((clause) => buildConditionClauseExpression(clause));
  if (parts.length === 1) {
    return parts[0] ?? "false";
  }
  if (logic === "AND") {
    return `and(${parts.join(", ")})`;
  }
  if (logic === "OR") {
    return `or(${parts.join(", ")})`;
  }
  return `xor(${parts.join(", ")})`;
}

function splitTopLevelArgs(source: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  for (const char of source) {
    if (quote) {
      current += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === "," && depth === 0) {
      if (current.trim()) {
        args.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    args.push(current.trim());
  }
  return args;
}

function parseFunctionCall(source: string): { name: string; args: string[] } | null {
  const trimmed = source.trim();
  const openIndex = trimmed.indexOf("(");
  if (openIndex <= 0 || !trimmed.endsWith(")")) {
    return null;
  }
  const name = trimmed.slice(0, openIndex).trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return null;
  }
  const inner = trimmed.slice(openIndex + 1, -1);
  return {
    name,
    args: splitTopLevelArgs(inner),
  };
}

function parseExpressionLiteralToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    return "";
  }
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      if (trimmed.startsWith("\"")) {
        return String(JSON.parse(trimmed));
      }
      return trimmed.slice(1, -1);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function parseSignalKeyFromTagArg(rawArg: string, allowNumWrapper: boolean): string | null {
  let targetArg = rawArg.trim();
  if (allowNumWrapper) {
    const maybeNum = parseFunctionCall(targetArg);
    if (!maybeNum || maybeNum.name !== "num" || maybeNum.args.length !== 1) {
      return null;
    }
    targetArg = maybeNum.args[0] ?? "";
  }
  const tagCall = parseFunctionCall(targetArg);
  if (!tagCall || tagCall.name !== "tag" || tagCall.args.length !== 1) {
    return null;
  }
  const tagValue = parseExpressionLiteralToken(tagCall.args[0] ?? "");
  if (!tagValue.startsWith("$binding.")) {
    return null;
  }
  const key = tagValue.slice("$binding.".length).trim();
  return key || null;
}

function parseGeneratedConditionClause(source: string): VisualRuleConditionClauseDraft | null {
  const call = parseFunctionCall(source);
  if (!call) {
    return null;
  }
  if (call.name === "eq" || call.name === "neq") {
    const signalKey = parseSignalKeyFromTagArg(call.args[0] ?? "", false);
    if (!signalKey) {
      return null;
    }
    return {
      id: createId("cond"),
      signalKey,
      condition: call.name === "eq" ? "equals" : "notEquals",
      value: parseExpressionLiteralToken(call.args[1] ?? ""),
      value2: "",
    };
  }
  if (call.name === "gt" || call.name === "lt") {
    const signalKey = parseSignalKeyFromTagArg(call.args[0] ?? "", true);
    if (!signalKey) {
      return null;
    }
    return {
      id: createId("cond"),
      signalKey,
      condition: call.name === "gt" ? "greaterThan" : "lessThan",
      value: parseExpressionLiteralToken(call.args[1] ?? ""),
      value2: "",
    };
  }
  if (call.name === "gte" || call.name === "lte") {
    const signalKey = parseSignalKeyFromTagArg(call.args[0] ?? "", true);
    if (!signalKey) {
      return null;
    }
    return {
      id: createId("cond"),
      signalKey,
      condition: call.name === "gte" ? "greaterOrEqual" : "lessOrEqual",
      value: parseExpressionLiteralToken(call.args[1] ?? ""),
      value2: "",
    };
  }
  if (call.name === "between") {
    const signalKey = parseSignalKeyFromTagArg(call.args[0] ?? "", true);
    if (!signalKey) {
      return null;
    }
    return {
      id: createId("cond"),
      signalKey,
      condition: "between",
      value: parseExpressionLiteralToken(call.args[1] ?? ""),
      value2: parseExpressionLiteralToken(call.args[2] ?? ""),
    };
  }
  return null;
}

function parseGeneratedConditionsExpression(source: string): { logic: VisualRuleLogicOperator; clauses: VisualRuleConditionClauseDraft[] } | null {
  const topLevel = parseFunctionCall(source);
  if (!topLevel) {
    return null;
  }
  if (topLevel.name === "and" || topLevel.name === "or" || topLevel.name === "xor") {
    const clauses: VisualRuleConditionClauseDraft[] = [];
    for (const item of topLevel.args) {
      const parsed = parseGeneratedConditionClause(item);
      if (!parsed) {
        return null;
      }
      clauses.push(parsed);
    }
    if (clauses.length < 2) {
      return null;
    }
    return {
      logic: topLevel.name.toUpperCase() as VisualRuleLogicOperator,
      clauses,
    };
  }
  const oneClause = parseGeneratedConditionClause(source);
  if (!oneClause) {
    return null;
  }
  return {
    logic: "AND",
    clauses: [oneClause],
  };
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
const ROTATION_ANIMATION_HINT_TYPES = new Set<HmiObject["type"]>([
  "group",
  "text",
  "line",
  "rectangle",
  "image",
  "stateImage",
  "numeric-image-indicator",
  "value-display",
  "state-indicator",
  "button",
]);
const ROTATION_ANIMATION_PROPERTY_HINTS: Array<{ path: string; kind: VisualRuleValueKind }> = [
  { path: "rotationAnimation.enabled", kind: "boolean" },
  { path: "rotationAnimation.triggerTag", kind: "string" },
  { path: "rotationAnimation.triggerMode", kind: "string" },
  { path: "rotationAnimation.triggerValue", kind: "string" },
  { path: "rotationAnimation.triggerInvert", kind: "boolean" },
  { path: "rotationAnimation.speedSource", kind: "string" },
  { path: "rotationAnimation.fixedSpeedDegPerSec", kind: "number" },
  { path: "rotationAnimation.speedTag", kind: "string" },
  { path: "rotationAnimation.minSpeedDegPerSec", kind: "number" },
  { path: "rotationAnimation.maxSpeedDegPerSec", kind: "number" },
  { path: "rotationAnimation.direction", kind: "string" },
  { path: "rotationAnimation.pivot", kind: "string" },
];
const FLOW_ANIMATION_PROPERTY_HINTS: Array<{ path: string; kind: VisualRuleValueKind }> = [
  { path: "flowAnimation.enabled", kind: "boolean" },
  { path: "flowAnimation.triggerTag", kind: "string" },
  { path: "flowAnimation.triggerMode", kind: "string" },
  { path: "flowAnimation.triggerValue", kind: "string" },
  { path: "flowAnimation.triggerInvert", kind: "boolean" },
  { path: "flowAnimation.speedSource", kind: "string" },
  { path: "flowAnimation.fixedSpeedPxPerSec", kind: "number" },
  { path: "flowAnimation.speedTag", kind: "string" },
  { path: "flowAnimation.minSpeedPxPerSec", kind: "number" },
  { path: "flowAnimation.maxSpeedPxPerSec", kind: "number" },
  { path: "flowAnimation.direction", kind: "string" },
  { path: "flowAnimation.effectType", kind: "string" },
  { path: "flowAnimation.color", kind: "color" },
  { path: "flowAnimation.opacity", kind: "number" },
  { path: "flowAnimation.strokeWidth", kind: "number" },
  { path: "flowAnimation.useBaseStrokeWidth", kind: "boolean" },
  { path: "flowAnimation.dashLength", kind: "number" },
  { path: "flowAnimation.gapLength", kind: "number" },
];

const TYPE_PROPERTY_HINTS: Partial<Record<HmiObject["type"], Array<{ path: string; kind: VisualRuleValueKind }>>> = {
  group: [{ path: "visible", kind: "boolean" }, { path: "opacity", kind: "number" }],
  text: [{ path: "text", kind: "string" }, { path: "visible", kind: "boolean" }, { path: "textStyle.color", kind: "color" }, { path: "textStyle.fontSize", kind: "number" }, { path: "rotationAnimation.enabled", kind: "boolean" }, { path: "rotationAnimation.triggerTag", kind: "string" }, { path: "rotationAnimation.speedTag", kind: "string" }, { path: "rotationAnimation.fixedSpeedDegPerSec", kind: "number" }, { path: "rotationAnimation.direction", kind: "string" }, { path: "rotationAnimation.pivot", kind: "string" }],
  line: [{ path: "visible", kind: "boolean" }, { path: "stroke", kind: "color" }, { path: "fill", kind: "color" }, { path: "strokeWidth", kind: "number" }, { path: "rotationAnimation.enabled", kind: "boolean" }, { path: "rotationAnimation.triggerTag", kind: "string" }, { path: "rotationAnimation.speedTag", kind: "string" }, { path: "rotationAnimation.fixedSpeedDegPerSec", kind: "number" }, { path: "rotationAnimation.direction", kind: "string" }, { path: "rotationAnimation.pivot", kind: "string" }],
  rectangle: [{ path: "visible", kind: "boolean" }, { path: "fill", kind: "color" }, { path: "stroke", kind: "color" }, { path: "strokeWidth", kind: "number" }, { path: "rotationAnimation.enabled", kind: "boolean" }, { path: "rotationAnimation.triggerTag", kind: "string" }, { path: "rotationAnimation.speedTag", kind: "string" }, { path: "rotationAnimation.fixedSpeedDegPerSec", kind: "number" }, { path: "rotationAnimation.direction", kind: "string" }, { path: "rotationAnimation.pivot", kind: "string" }],
  "value-display": [{ path: "visible", kind: "boolean" }, { path: "suffix", kind: "string" }, { path: "textStyle.color", kind: "color" }, { path: "rotationAnimation.enabled", kind: "boolean" }, { path: "rotationAnimation.triggerTag", kind: "string" }, { path: "rotationAnimation.speedTag", kind: "string" }, { path: "rotationAnimation.fixedSpeedDegPerSec", kind: "number" }, { path: "rotationAnimation.direction", kind: "string" }, { path: "rotationAnimation.pivot", kind: "string" }],
  "value-input": [{ path: "visible", kind: "boolean" }, { path: "suffix", kind: "string" }, { path: "textStyle.color", kind: "color" }],
  "state-indicator": [{ path: "visible", kind: "boolean" }, { path: "trueColor", kind: "color" }, { path: "falseColor", kind: "color" }, { path: "textStyle.color", kind: "color" }, { path: "rotationAnimation.enabled", kind: "boolean" }, { path: "rotationAnimation.triggerTag", kind: "string" }, { path: "rotationAnimation.speedTag", kind: "string" }, { path: "rotationAnimation.fixedSpeedDegPerSec", kind: "number" }, { path: "rotationAnimation.direction", kind: "string" }, { path: "rotationAnimation.pivot", kind: "string" }],
  button: [{ path: "visible", kind: "boolean" }, { path: "text", kind: "string" }, { path: "backgroundColor", kind: "color" }, { path: "borderColor", kind: "color" }, { path: "textStyle.color", kind: "color" }, { path: "rotationAnimation.enabled", kind: "boolean" }, { path: "rotationAnimation.triggerTag", kind: "string" }, { path: "rotationAnimation.speedTag", kind: "string" }, { path: "rotationAnimation.fixedSpeedDegPerSec", kind: "number" }, { path: "rotationAnimation.direction", kind: "string" }, { path: "rotationAnimation.pivot", kind: "string" }],
  switch: [{ path: "visible", kind: "boolean" }, { path: "onText", kind: "string" }, { path: "offText", kind: "string" }, { path: "onColor", kind: "color" }, { path: "offColor", kind: "color" }],
  image: [{ path: "visible", kind: "boolean" }, { path: "assetId", kind: "asset" }, { path: "fit", kind: "string" }, { path: "opacity", kind: "number" }, { path: "rotationAnimation.enabled", kind: "boolean" }, { path: "rotationAnimation.triggerTag", kind: "string" }, { path: "rotationAnimation.speedTag", kind: "string" }, { path: "rotationAnimation.fixedSpeedDegPerSec", kind: "number" }, { path: "rotationAnimation.direction", kind: "string" }, { path: "rotationAnimation.pivot", kind: "string" }],
  stateImage: [{ path: "visible", kind: "boolean" }, { path: "defaultAssetId", kind: "asset" }, { path: "badQualityAssetId", kind: "asset" }, { path: "fit", kind: "string" }, { path: "rotationAnimation.enabled", kind: "boolean" }, { path: "rotationAnimation.triggerTag", kind: "string" }, { path: "rotationAnimation.speedTag", kind: "string" }, { path: "rotationAnimation.fixedSpeedDegPerSec", kind: "number" }, { path: "rotationAnimation.direction", kind: "string" }, { path: "rotationAnimation.pivot", kind: "string" }],
  valueSelect: [{ path: "visible", kind: "boolean" }, { path: "textStyle.color", kind: "color" }],
  frame: [{ path: "visible", kind: "boolean" }, { path: "showBorder", kind: "boolean" }, { path: "borderColor", kind: "color" }, { path: "borderWidth", kind: "number" }],
  checkbox: [{ path: "visible", kind: "boolean" }, { path: "label", kind: "string" }, { path: "checkedColor", kind: "color" }, { path: "uncheckedColor", kind: "color" }],
  slider: [{ path: "visible", kind: "boolean" }, { path: "fillColor", kind: "color" }, { path: "trackColor", kind: "color" }, { path: "thumbColor", kind: "color" }, { path: "fontSize", kind: "number" }],
  "progress-bar": [{ path: "visible", kind: "boolean" }, { path: "fillColor", kind: "color" }, { path: "trackColor", kind: "color" }, { path: "textColor", kind: "color" }, { path: "fontSize", kind: "number" }],
  select: [{ path: "visible", kind: "boolean" }, { path: "placeholder", kind: "string" }, { path: "backgroundColor", kind: "color" }, { path: "textColor", kind: "color" }, { path: "fontSize", kind: "number" }],
  "radio-group": [{ path: "visible", kind: "boolean" }, { path: "selectedColor", kind: "color" }, { path: "unselectedColor", kind: "color" }, { path: "labelColor", kind: "color" }, { path: "fontSize", kind: "number" }],
  "numeric-input": [{ path: "visible", kind: "boolean" }, { path: "placeholder", kind: "string" }, { path: "textColor", kind: "color" }, { path: "backgroundColor", kind: "color" }, { path: "fontSize", kind: "number" }],
  "numeric-image-indicator": [{ path: "visible", kind: "boolean" }, { path: "defaultAssetId", kind: "asset" }, { path: "badQualityAssetId", kind: "asset" }, { path: "fit", kind: "string" }, { path: "rotationAnimation.enabled", kind: "boolean" }, { path: "rotationAnimation.triggerTag", kind: "string" }, { path: "rotationAnimation.speedTag", kind: "string" }, { path: "rotationAnimation.fixedSpeedDegPerSec", kind: "number" }, { path: "rotationAnimation.direction", kind: "string" }, { path: "rotationAnimation.pivot", kind: "string" }],
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

function findObjectDeepInList(objects: HmiObject[], objectId: string): HmiObject | null {
  for (const item of objects) {
    if (item.id === objectId) {
      return item;
    }
    if (item.type === "group") {
      const found = findObjectDeepInList(item.objects, objectId);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function updateObjectDeepInList(
  objects: HmiObject[],
  objectId: string,
  updater: (object: HmiObject) => HmiObject,
): HmiObject[] {
  return objects.map((item) => {
    if (item.id === objectId) {
      return updater(item);
    }
    if (item.type === "group") {
      return {
        ...item,
        objects: updateObjectDeepInList(item.objects, objectId, updater),
      };
    }
    return item;
  });
}

function extractBindingKey(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized.startsWith("$binding.")) {
    return "";
  }
  return normalized.slice("$binding.".length).trim();
}

function getDeepValue(target: unknown, fieldPath: string): unknown {
  const parts = fieldPath.split(".").filter(Boolean);
  let current: unknown = target;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setDeepValue<T extends Record<string, unknown>>(
  source: T,
  fieldPath: string,
  value: unknown,
): T {
  const result = structuredClone(source) as Record<string, unknown>;
  const parts = fieldPath.split(".").filter(Boolean);
  if (parts.length === 0) {
    return source;
  }
  let cursor: Record<string, unknown> = result;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!key) {
      continue;
    }
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  const leafKey = parts[parts.length - 1];
  if (!leafKey) {
    return result as T;
  }
  cursor[leafKey] = value;
  return result as T;
}

function getBindingDirectionBadge(kind: ElementBindingDefinition["kind"] | undefined): string {
  if (kind === "writeTag") {
    return "WRITE";
  }
  if (kind === "command") {
    return "COMMAND";
  }
  if (kind === "custom") {
    return "CUSTOM";
  }
  return "READ";
}

function toDisplayTagValue(rawValue: string, bindingsByKey: Map<string, ElementBindingDefinition>): string {
  const key = extractBindingKey(rawValue);
  if (key) {
    const binding = bindingsByKey.get(key);
    const badge = getBindingDirectionBadge(binding?.kind);
    return `${key} [${badge}]`;
  }
  return `Manual: ${rawValue}`;
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
  const rotationAnimationHinted = ROTATION_ANIMATION_HINT_TYPES.has(object.type)
    ? ROTATION_ANIMATION_PROPERTY_HINTS.map((item) => ({
      path: item.path,
      label: item.path,
      kind: item.kind,
    }))
    : [];
  const flowAnimationHinted = object.type === "line"
    ? FLOW_ANIMATION_PROPERTY_HINTS.map((item) => ({
      path: item.path,
      label: item.path,
      kind: item.kind,
    }))
    : [];
  const map = new Map<string, VisualRulePropertyOption>();
  for (const option of [...hinted, ...rotationAnimationHinted, ...flowAnimationHinted, ...dynamic]) {
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
    return isLikelyCssColor(raw.trim()) ? normalizeColorInput(raw) : "#ffffff";
  }
  return raw;
}

function normalizeColorInput(raw: string): string {
  const normalized = raw.trim();
  if (!normalized) {
    return "";
  }
  if (
    normalized.startsWith("rgb(") ||
    normalized.startsWith("rgba(") ||
    normalized.startsWith("hsl(") ||
    normalized.startsWith("hsla(")
  ) {
    return normalized;
  }
  if (normalized.startsWith("#")) {
    return normalized.toLowerCase();
  }
  if (/^[0-9a-fA-F]{3,8}$/.test(normalized)) {
    return `#${normalized.toLowerCase()}`;
  }
  if (/^[a-zA-Z]+$/.test(normalized)) {
    return normalized;
  }
  return normalized;
}

function normalizePickerColor(value: string | undefined, fallback: string): string {
  const token = (value ?? "").trim();
  if (!token) {
    return fallback;
  }
  if (isLikelyCssColor(token)) {
    return token;
  }
  return fallback;
}

function isLikelyCssColor(value: string): boolean {
  return (
    value.startsWith("#") ||
    value.startsWith("rgb(") ||
    value.startsWith("rgba(") ||
    value.startsWith("hsl(") ||
    value.startsWith("hsla(") ||
    /^[a-zA-Z]+$/.test(value)
  );
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
  zIndex,
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
    <div className="workbench-confirm-backdrop" style={zIndex !== undefined ? { zIndex } : undefined} onPointerDown={(event) => event.stopPropagation()}>
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
  const [objectIoDialog, setObjectIoDialog] = useState<ObjectIoDialogState>({
    open: false,
    draftObjects: [],
    selectedObjectId: "",
    dirty: false,
  });
  const [interfaceDialogOpen, setInterfaceDialogOpen] = useState(false);
  const [interfaceDialogTab, setInterfaceDialogTab] = useState<InterfaceDialogTab>("signals");
  const [objectIoSearchQuery, setObjectIoSearchQuery] = useState("");
  const [objectIoExpandedObjectIds, setObjectIoExpandedObjectIds] = useState<string[]>([]);
  const [objectIoLeftPaneWidth, setObjectIoLeftPaneWidth] = useState(320);

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
    name: "",
    logic: "AND",
    clauses: [],
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
  const [renameElementDialog, setRenameElementDialog] = useState<RenameElementDialogState>({
    open: false,
    element: null,
    nextName: "",
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
  const selectedElementBindingsByKey = useMemo(
    () => new Map((selectedElement?.bindings ?? []).map((binding) => [binding.key, binding])),
    [selectedElement],
  );

  const flatElementObjects = useMemo(
    () => flattenElementObjects(selectedElement?.objects ?? []),
    [selectedElement],
  );
  const flatObjectIoDraftObjects = useMemo(
    () => flattenElementObjects(objectIoDialog.draftObjects),
    [objectIoDialog.draftObjects],
  );
  const selectedObjectIoDraftObject = useMemo(
    () => findObjectDeepInList(objectIoDialog.draftObjects, objectIoDialog.selectedObjectId),
    [objectIoDialog.draftObjects, objectIoDialog.selectedObjectId],
  );
  const objectIoObjectRows = useMemo(
    () => flatObjectIoDraftObjects.map((objectOption) => ({
      objectId: objectOption.id,
      objectType: objectOption.type,
      objectLabel: objectOption.label.replace(/^\s*-\s*/, ""),
      searchText: `${objectOption.label.replace(/^\s*-\s*/, "")} ${objectOption.id} ${objectOption.type}`.toLowerCase(),
    })),
    [flatObjectIoDraftObjects],
  );
  const filteredObjectIoObjectRows = useMemo(() => {
    const query = objectIoSearchQuery.trim().toLowerCase();
    const filtered = query
      ? objectIoObjectRows.filter((row) => row.searchText.includes(query))
      : objectIoObjectRows;
    return filtered.slice(0, 300);
  }, [objectIoObjectRows, objectIoSearchQuery]);
  const objectIoTreeData = useMemo<ObjectIoPickerTreeNode[]>(() => {
    return filteredObjectIoObjectRows.map((row) => ({
      key: `obj:${row.objectId}`,
      nodeType: "object",
      objectId: row.objectId,
      title: (
        <span className="screen-editor-setproperty-picker__tree-object">
          {row.objectLabel} ({row.objectType})
        </span>
      ),
      isLeaf: true,
    }));
  }, [filteredObjectIoObjectRows]);
  const objectIoExpandedKeys = useMemo(
    () => (objectIoSearchQuery.trim() ? objectIoTreeData.map((node) => String(node.key)) : objectIoExpandedObjectIds),
    [objectIoExpandedObjectIds, objectIoSearchQuery, objectIoTreeData],
  );
  const flatElementObjectMap = useMemo(
    () => flattenObjectMap(selectedElement?.objects ?? []),
    [selectedElement],
  );
  const objectIoSummaryCards = useMemo<ObjectIoSummaryCard[]>(() => {
    if (!selectedElement) {
      return [];
    }
    const cards: ObjectIoSummaryCard[] = [];
    const addCard = (object: HmiObject) => {
      const fields = getObjectIoFields(object);
      const readTags: string[] = [];
      const writeTags: string[] = [];
      const statusTags: string[] = [];
      const actionTags: string[] = [];

      for (const field of fields) {
        if ((field.control ?? "tag") !== "tag") {
          continue;
        }
        const rawValue = getDeepValue(object, field.fieldPath);
        if (typeof rawValue !== "string" || !rawValue.trim()) {
          continue;
        }
        const displayValue = toDisplayTagValue(rawValue.trim(), selectedElementBindingsByKey);
        if (field.direction === "read") {
          readTags.push(displayValue);
        } else if (field.direction === "write") {
          writeTags.push(displayValue);
        } else if (field.direction === "status") {
          statusTags.push(displayValue);
        } else {
          actionTags.push(displayValue);
        }
      }

      let modeText: string | undefined;
      if (object.type === "checkbox" && (readTags.length > 0 || writeTags.length > 0 || statusTags.length > 0 || actionTags.length > 0)) {
        const mode = object.writeMode ?? "toggleState";
        if (mode === "pulseTrue" || mode === "pulseFalse") {
          modeText = `${mode}, ${Math.max(1, Math.floor(Number(object.pulseDurationMs ?? 300) || 300))} ms`;
        } else {
          modeText = mode;
        }
      }

      if (
        readTags.length === 0 &&
        writeTags.length === 0 &&
        statusTags.length === 0 &&
        actionTags.length === 0 &&
        !modeText
      ) {
        return;
      }

      cards.push({
        objectId: object.id,
        objectType: object.type,
        objectLabel: object.name?.trim() || object.id,
        readTags,
        writeTags,
        statusTags,
        actionTags,
        modeText,
      });
    };

    const scan = (objects: HmiObject[]) => {
      for (const object of objects) {
        addCard(object);
        if (object.type === "group") {
          scan(object.objects);
        }
      }
    };
    scan(selectedElement.objects);
    return cards;
  }, [selectedElement, selectedElementBindingsByKey]);
  const interfaceTabItems = useMemo<WorkbenchTabItem[]>(
    () => [
      { id: "signals", title: "Signals", active: interfaceDialogTab === "signals", onClick: () => setInterfaceDialogTab("signals") },
      { id: "visualRules", title: "Visual Rules", active: interfaceDialogTab === "visualRules", onClick: () => setInterfaceDialogTab("visualRules") },
      { id: "objectIo", title: "Object I/O", active: interfaceDialogTab === "objectIo", onClick: () => setInterfaceDialogTab("objectIo") },
    ],
    [interfaceDialogTab],
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
    const bindings = selectedElement?.bindings ?? [];
    const rules = selectedElement?.stateRules ?? [];
    for (const binding of bindings) {
      let count = 0;
      for (const rule of rules) {
        if (ruleReferencesSignalKey(rule, binding.key)) {
          count += rule.cases?.length ?? 0;
        }
      }
      map.set(binding.key, count);
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
      logic?: VisualRuleLogicOperator;
      clauses?: VisualRuleConditionClauseDraft[];
      editable: boolean;
      reason?: string;
    }> = [];
    for (const rule of selectedElement?.stateRules ?? []) {
      const firstCase = rule.cases?.[0];
      const hasMultipleCases = (rule.cases?.length ?? 0) > 1;
      if (!firstCase || hasMultipleCases) {
        rows.push({
          ruleId: rule.id,
          name: rule.name,
          signalKey: "",
          condition: firstCase?.condition ?? { type: "true" },
          actions: firstCase?.actions ?? [],
          editable: false,
          reason: hasMultipleCases ? "Rule has multiple cases" : "Rule has no case",
        });
        continue;
      }
      if (rule.source.type === "tag") {
        const signalKey = extractBindingKeyFromRuleSource(rule);
        const unsupportedCondition = firstCase.condition.type === "true" || firstCase.condition.type === "false";
        if (!signalKey || unsupportedCondition) {
          rows.push({
            ruleId: rule.id,
            name: rule.name,
            signalKey: signalKey ?? "",
            condition: firstCase.condition,
            actions: firstCase.actions,
            editable: false,
            reason: !signalKey
              ? "Source is not a Signal"
              : "Condition type is not supported in this editor",
          });
          continue;
        }
        rows.push({
          ruleId: rule.id,
          name: rule.name,
          signalKey,
          condition: firstCase.condition,
          actions: firstCase.actions,
          logic: "AND",
          clauses: [
            {
              id: createId("cond"),
              signalKey,
              condition: firstCase.condition.type as VisualRuleClauseConditionType,
              value:
                firstCase.condition.type === "equals" || firstCase.condition.type === "notEquals" || firstCase.condition.type === "greaterThan" || firstCase.condition.type === "lessThan"
                  ? String((firstCase.condition as { value?: unknown }).value ?? "")
                  : String((firstCase.condition as { min: number }).min ?? ""),
              value2: firstCase.condition.type === "between" ? String((firstCase.condition as { max: number }).max ?? "") : "",
            },
          ],
          editable: true,
        });
        continue;
      }

      if (rule.source.type === "expression" && firstCase.condition.type === "true") {
        const parsed = parseGeneratedConditionsExpression(rule.source.value ?? "");
        if (!parsed) {
          rows.push({
            ruleId: rule.id,
            name: rule.name,
            signalKey: "",
            condition: firstCase.condition,
            actions: firstCase.actions,
            editable: false,
            reason: "Expression format is not supported in this editor",
          });
          continue;
        }
        rows.push({
          ruleId: rule.id,
          name: rule.name,
          signalKey: parsed.clauses[0]?.signalKey ?? "",
          condition: firstCase.condition,
          actions: firstCase.actions,
          logic: parsed.logic,
          clauses: parsed.clauses,
          editable: true,
        });
        continue;
      }

      rows.push({
        ruleId: rule.id,
        name: rule.name,
        signalKey: "",
        condition: firstCase.condition,
        actions: firstCase.actions,
        editable: false,
        reason: "Source is not supported in this editor",
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
    if (!objectIoDialog.open) {
      return;
    }
    if (objectIoDialog.selectedObjectId && findObjectDeepInList(objectIoDialog.draftObjects, objectIoDialog.selectedObjectId)) {
      return;
    }
    setObjectIoDialog((prev) => ({
      ...prev,
      selectedObjectId: flattenElementObjects(prev.draftObjects)[0]?.id ?? "",
    }));
  }, [objectIoDialog]);

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

  const startRenameElement = (element: LibraryElement): void => {
    setRenameElementDialog({
      open: true,
      element,
      nextName: element.name,
      error: undefined,
    });
  };

  const confirmRenameElement = async (): Promise<void> => {
    if (!selectedLibrary || !renameElementDialog.element) {
      return;
    }
    const nextName = renameElementDialog.nextName.trim();
    if (!nextName) {
      setRenameElementDialog((prev) => ({ ...prev, error: "Element name is required." }));
      return;
    }
    try {
      await api.updateLibraryElement(selectedLibrary.id, renameElementDialog.element.id, { name: nextName });
      await refresh();
      setRenameElementDialog({ open: false, element: null, nextName: "", error: undefined });
    } catch (error) {
      setRenameElementDialog((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Failed to rename element.",
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

  const saveElementPatch = async (element: LibraryElement, patch: Partial<LibraryElement>): Promise<boolean> => {
    if (!selectedLibrary) {
      return false;
    }
    setSavingInterface(true);
    setInterfaceError(null);
    try {
      await api.updateLibraryElement(selectedLibrary.id, element.id, patch);
      await refresh();
      return true;
    } catch (error) {
      setInterfaceError(error instanceof Error ? error.message : "Failed to save interface.");
      return false;
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

  const openObjectIoDialog = (objectId?: string) => {
    if (!selectedElement) {
      return;
    }
    const nextDraftObjects = structuredClone(selectedElement.objects);
    const fallbackId = flattenElementObjects(nextDraftObjects)[0]?.id ?? "";
    const nextSelectedObjectId = objectId && findObjectDeepInList(nextDraftObjects, objectId) ? objectId : fallbackId;
    setObjectIoDialog({
      open: true,
      draftObjects: nextDraftObjects,
      selectedObjectId: nextSelectedObjectId,
      dirty: false,
    });
    setObjectIoSearchQuery("");
    setObjectIoExpandedObjectIds([]);
  };

  const openInterfaceDialog = (tab: InterfaceDialogTab = "signals") => {
    setInterfaceDialogTab(tab);
    setInterfaceDialogOpen(true);
  };

  const closeObjectIoDialog = () => {
    setObjectIoDialog((prev) => ({ ...prev, open: false }));
  };

  const startObjectIoPaneResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const baseWidth = objectIoLeftPaneWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const next = Math.max(220, Math.min(560, Math.round(baseWidth + dx)));
      setObjectIoLeftPaneWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const patchObjectIoField = (fieldPath: string, value: unknown) => {
    if (!objectIoDialog.selectedObjectId) {
      return;
    }
    setObjectIoDialog((prev) => ({
      ...prev,
      dirty: true,
      draftObjects: updateObjectDeepInList(prev.draftObjects, prev.selectedObjectId, (object) =>
        setDeepValue(object as unknown as Record<string, unknown>, fieldPath, value) as HmiObject),
    }));
  };

  const setObjectIoActionMode = (object: HmiObject, mode: ObjectIoActionMode) => {
    const currentAction = getDeepValue(object, "action") as RuntimeAction | undefined;
    if (mode === "none" && object.type === "button") {
      return;
    }
    const nextAction = createObjectIoAction(mode, currentAction);
    patchObjectIoField("action", nextAction);
  };

  const saveObjectIoDialog = async (): Promise<void> => {
    if (!selectedLibrary || !selectedElement) {
      return;
    }
    setSavingInterface(true);
    setInterfaceError(null);
    try {
      await api.updateLibraryElement(selectedLibrary.id, selectedElement.id, { objects: objectIoDialog.draftObjects });
      await refresh();
      setObjectIoDialog((prev) => ({ ...prev, open: false, dirty: false }));
    } catch (error) {
      setInterfaceError(error instanceof Error ? error.message : "Failed to save object I/O.");
    } finally {
      setSavingInterface(false);
    }
  };

  const buildBindingOptionsForField = (
    field: ObjectIoFieldDefinition,
    direction: ObjectIoFieldDefinition["direction"],
    currentBindingKey: string,
  ): Array<{ key: string; label: string }> => {
    const preferredKinds = direction === "write" || direction === "action"
      ? new Set<ElementBindingDefinition["kind"]>(["writeTag", "command", "custom"])
      : new Set<ElementBindingDefinition["kind"]>(["state", "tag", "custom"]);
    const allBindings = selectedElement?.bindings ?? [];
    const preferred = allBindings.filter((binding) => preferredKinds.has(binding.kind));
    const secondary = allBindings.filter((binding) => !preferredKinds.has(binding.kind));
    const preferNumericDataType = field.fieldPath === "rotationAnimation.speedTag" || field.fieldPath === "flowAnimation.speedTag";
    const numericTypes = new Set<NonNullable<ElementBindingDefinition["dataType"]>>(["REAL", "INT", "DINT", "UINT", "UDINT"]);
    const sortPreferred = (rows: ElementBindingDefinition[]) => {
      if (!preferNumericDataType) {
        return rows;
      }
      return [...rows].sort((left, right) => {
        const leftScore = left.dataType && numericTypes.has(left.dataType) ? 0 : 1;
        const rightScore = right.dataType && numericTypes.has(right.dataType) ? 0 : 1;
        if (leftScore !== rightScore) {
          return leftScore - rightScore;
        }
        return (left.displayName || left.key).localeCompare(right.displayName || right.key);
      });
    };
    const ordered = [...sortPreferred(preferred), ...secondary];
    const options: Array<{ key: string; label: string }> = [];
    const used = new Set<string>();
    for (const binding of ordered) {
      if (used.has(binding.key)) {
        continue;
      }
      used.add(binding.key);
      const badge = getBindingDirectionBadge(binding.kind);
      options.push({
        key: binding.key,
        label: `${binding.displayName || binding.key} (${binding.key}) [${badge}]`,
      });
    }
    if (currentBindingKey && !used.has(currentBindingKey)) {
      const existing = selectedElementBindingsByKey.get(currentBindingKey);
      if (existing) {
        const badge = getBindingDirectionBadge(existing.kind);
        options.unshift({
          key: existing.key,
          label: `${existing.displayName || existing.key} (${existing.key}) [${badge}]`,
        });
      } else {
        options.unshift({ key: currentBindingKey, label: `${currentBindingKey} (missing)` });
      }
    }
    return options;
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

  const startCreateVisualRule = () => {
    if (!selectedElement) {
      return;
    }
    const firstBinding = selectedElement.bindings?.[0];
    const signalKey = firstBinding?.key ?? "";
    const defaultObject = flatElementObjects[0]?.id ?? "";
    const defaultOptions = defaultObject ? (propertyOptionsByObjectId.get(defaultObject) ?? []) : [];
    setVisualRuleDialog({
      open: true,
      mode: "create",
      name: `Visual Rule ${(selectedElement.stateRules?.length ?? 0) + 1}`,
      logic: "AND",
      clauses: signalKey ? [createDefaultVisualRuleClause(signalKey, firstBinding?.dataType)] : [],
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

    setVisualRuleDialog({
      open: true,
      mode: "edit",
      editingRuleId: card.ruleId,
      name: card.name || "Visual Rule",
      logic: card.logic ?? "AND",
      clauses: (card.clauses ?? []).map((item) =>
        normalizeClauseBySignalDataType(
          { ...item, id: createId("cond") },
          selectedElementBindingsByKey.get(item.signalKey)?.dataType,
        )),
      actions: card.actions.map((action) => toVisualActionDraft(action)),
    });
  };

  const validateVisualRuleDialog = (): string | null => {
    if (!selectedElement) {
      return "No selected element.";
    }
    if (!visualRuleDialog.name.trim()) {
      return "Rule name is required.";
    }
    if (visualRuleDialog.clauses.length > MAX_VISUAL_RULE_CONDITIONS) {
      return `Maximum ${MAX_VISUAL_RULE_CONDITIONS} conditions allowed.`;
    }
    if (visualRuleDialog.clauses.length === 0) {
      return "Add at least one condition row.";
    }
    const knownSignals = new Set((selectedElement.bindings ?? []).map((binding) => binding.key));
    if (visualRuleDialog.clauses.some((clause) => !clause.signalKey)) {
      return "Select a Signal for each condition row.";
    }
    if (visualRuleDialog.clauses.some((clause) => !knownSignals.has(clause.signalKey))) {
      return "One or more selected Signals no longer exist.";
    }
    if (visualRuleDialog.clauses.some((clause) => {
      const dataType = selectedElementBindingsByKey.get(clause.signalKey)?.dataType;
      return isBoolSignalDataType(dataType) && !isBoolClauseCondition(clause.condition);
    })) {
      return "BOOL signals support only == or != conditions.";
    }
    if (visualRuleDialog.clauses.some((clause) => {
      const dataType = selectedElementBindingsByKey.get(clause.signalKey)?.dataType;
      return isBoolSignalDataType(dataType) && clause.value !== "true" && clause.value !== "false";
    })) {
      return "BOOL condition value must be true or false.";
    }
    if (visualRuleDialog.clauses.some((clause) => !clause.value.trim())) {
      return "Condition value is required.";
    }
    if (
      visualRuleDialog.clauses.some((clause) => conditionNeedsNumericValue(clause.condition) && !Number.isFinite(Number(clause.value)))
    ) {
      return "Numeric condition value is invalid.";
    }
    if (
      visualRuleDialog.clauses.some((clause) => clause.condition === "between" && !Number.isFinite(Number(clause.value2)))
    ) {
      return "Between max value is invalid.";
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
    if (visualRuleDialog.actions.some((action) => action.kind === "color" && !isLikelyCssColor(normalizeColorInput(action.value)))) {
      return "Color value is invalid.";
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

    const firstClause = visualRuleDialog.clauses[0]!;
    const nextRuleName = visualRuleDialog.name.trim() || "Visual Rule";
    const singleClauseNeedsExpression = firstClause.condition === "greaterOrEqual" || firstClause.condition === "lessOrEqual";
    const useExpressionSource = visualRuleDialog.clauses.length > 1 || singleClauseNeedsExpression;
    const source = useExpressionSource
      ? {
          type: "expression" as const,
          value: buildConditionsExpression(visualRuleDialog.clauses, visualRuleDialog.logic),
        }
      : {
          type: "tag" as const,
          value: `$binding.${firstClause.signalKey}`,
        };
    const condition: ElementStateCase["condition"] = !useExpressionSource
      ? (() => {
          if (firstClause.condition === "equals" || firstClause.condition === "notEquals") {
            return { type: firstClause.condition, value: parseScalarToken(firstClause.value) };
          }
          if (firstClause.condition === "greaterThan" || firstClause.condition === "lessThan") {
            return { type: firstClause.condition, value: Number(firstClause.value) };
          }
          return {
            type: "between",
            min: Number(firstClause.value),
            max: Number(firstClause.value2),
          };
        })()
      : { type: "true" };

    const nextRule: NonNullable<LibraryElement["stateRules"]>[number] = {
      id: visualRuleDialog.mode === "edit" ? visualRuleDialog.editingRuleId || createId("rule") : createId("rule"),
      name: nextRuleName,
      source,
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
              value: normalizeColorInput(action.value),
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
      name: "",
      logic: "AND",
      clauses: [],
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
              <WorkbenchButton onClick={() => openInterfaceDialog("signals")}>Interface</WorkbenchButton>
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
                        onClick={() => startRenameElement(selectedElement)}
                      >
                        Rename
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
                      Signals define read/state inputs and write/command targets for this library element.
                      Visual Rules define read-to-view behavior. When this element is placed on a screen, users map these signals to real tags.
                    </div>
                    <div className="screen-editor-item-meta">
                      Signals declare the external interface of the library element. Internal objects use $binding.&lt;key&gt; to read/write the mapped real tags of each instance.
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
                            <div className="screen-editor-item-meta">kind: {formatBindingKindLabel(signal.kind)}</div>
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

                    <div className="screen-editor-library-interface__section">
                      <div className="screen-editor-library-interface__section-title">OBJECT I/O</div>
                      <div className="screen-editor-item-actions">
                        <WorkbenchButton onClick={() => openObjectIoDialog()} disabled={savingInterface || flatElementObjects.length === 0}>
                          Edit Object I/O
                        </WorkbenchButton>
                      </div>
                      {objectIoSummaryCards.length === 0 ? (
                        <div className="screen-editor-item-meta">No configured Object I/O fields yet.</div>
                      ) : (
                        <div className="screen-editor-library-interface__object-io-summary">
                          {objectIoSummaryCards.map((card) => (
                            <div key={card.objectId} className="screen-editor-library-interface__object-io-card">
                              <div className="screen-editor-item-title">{card.objectLabel} ({card.objectType})</div>
                              {card.readTags.length > 0 ? <div className="screen-editor-item-meta">READ: {card.readTags.join(", ")}</div> : null}
                              {card.writeTags.length > 0 ? <div className="screen-editor-item-meta">WRITE: {card.writeTags.join(", ")}</div> : null}
                              {card.statusTags.length > 0 ? <div className="screen-editor-item-meta">STATUS: {card.statusTags.join(", ")}</div> : null}
                              {card.actionTags.length > 0 ? <div className="screen-editor-item-meta">ACTION: {card.actionTags.join(", ")}</div> : null}
                              {card.modeText ? <div className="screen-editor-item-meta">MODE: {card.modeText}</div> : null}
                              <div className="screen-editor-item-actions">
                                <WorkbenchButton onClick={() => openObjectIoDialog(card.objectId)} disabled={savingInterface}>Edit</WorkbenchButton>
                              </div>
                            </div>
                          ))}
                        </div>
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
        title="Rename Library Element"
        open={renameElementDialog.open}
        onClose={() => setRenameElementDialog({ open: false, element: null, nextName: "", error: undefined })}
        width={560}
        actions={(
          <>
            <WorkbenchButton onClick={() => setRenameElementDialog({ open: false, element: null, nextName: "", error: undefined })}>
              Cancel
            </WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={() => void confirmRenameElement()}>
              Rename
            </WorkbenchButton>
          </>
        )}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <div className="screen-editor-item-meta">
            Rename element "{renameElementDialog.element?.name ?? "-"}"?
          </div>
          <label style={{ display: "grid", gap: 4 }}>
            <span>New name</span>
            <input
              className="workbench-input"
              value={renameElementDialog.nextName}
              onChange={(event) => setRenameElementDialog((prev) => ({
                ...prev,
                nextName: event.target.value,
                error: undefined,
              }))}
              placeholder="Element name"
              autoFocus
            />
          </label>
          {renameElementDialog.error ? <div className="screen-editor-library-interface__error">{renameElementDialog.error}</div> : null}
        </div>
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
            <span>Kind</span>
            <select
              className="workbench-select"
              value={signalDialog.draft.kind}
              onChange={(event) => setSignalDialog((prev) => ({
                ...prev,
                draft: {
                  ...prev.draft,
                  kind: event.target.value as ElementBindingDefinition["kind"],
                },
              }))}
            >
              {BINDING_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
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
        title="INTERFACE"
        open={interfaceDialogOpen}
        onClose={() => setInterfaceDialogOpen(false)}
        width={940}
        height={640}
        minWidth={760}
        minHeight={500}
        resizable
        zIndex={4900}
        bodyClassName="screen-editor-library-interface-dialog-body"
        actions={(
          <>
            <WorkbenchButton onClick={() => setInterfaceDialogOpen(false)}>Close</WorkbenchButton>
          </>
        )}
      >
        {!selectedElement ? (
          <div className="screen-editor-item-meta">Select an element to edit interface.</div>
        ) : (
          <div className="screen-editor-library-interface">
            <WorkbenchTabs items={interfaceTabItems} />
            {interfaceError ? <div className="screen-editor-library-interface__error">{interfaceError}</div> : null}

            {interfaceDialogTab === "signals" ? (
              <div className="screen-editor-library-interface__section screen-editor-library-interface__tab-panel">
                <div className="screen-editor-item-actions">
                  <WorkbenchButton onClick={startCreateSignal} disabled={savingInterface}>Add Signal</WorkbenchButton>
                </div>
                {(selectedElement.bindings ?? []).length === 0 ? (
                  <div className="screen-editor-item-meta">No Signals yet.</div>
                ) : (
                  (selectedElement.bindings ?? []).map((signal) => (
                    <div key={signal.id} className="screen-editor-signal-card">
                      <div className="screen-editor-item-title">{signal.displayName}</div>
                      <div className="screen-editor-item-meta">key: {signal.key}</div>
                      <div className="screen-editor-item-meta">kind: {formatBindingKindLabel(signal.kind)}</div>
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
            ) : null}

            {interfaceDialogTab === "visualRules" ? (
              <div className="screen-editor-library-interface__section screen-editor-library-interface__tab-panel">
                <div className="screen-editor-item-actions">
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
            ) : null}

            {interfaceDialogTab === "objectIo" ? (
              <div className="screen-editor-library-interface__section screen-editor-library-interface__tab-panel">
                <div className="screen-editor-item-actions">
                  <WorkbenchButton onClick={() => openObjectIoDialog()} disabled={savingInterface || flatElementObjects.length === 0}>
                    Edit Object I/O
                  </WorkbenchButton>
                </div>
                {objectIoSummaryCards.length === 0 ? (
                  <div className="screen-editor-item-meta">No configured Object I/O fields yet.</div>
                ) : (
                  <div className="screen-editor-library-interface__object-io-summary">
                    {objectIoSummaryCards.map((card) => (
                      <div key={card.objectId} className="screen-editor-library-interface__object-io-card">
                        <div className="screen-editor-item-title">{card.objectLabel} ({card.objectType})</div>
                        {card.readTags.length > 0 ? <div className="screen-editor-item-meta">READ: {card.readTags.join(", ")}</div> : null}
                        {card.writeTags.length > 0 ? <div className="screen-editor-item-meta">WRITE: {card.writeTags.join(", ")}</div> : null}
                        {card.statusTags.length > 0 ? <div className="screen-editor-item-meta">STATUS: {card.statusTags.join(", ")}</div> : null}
                        {card.actionTags.length > 0 ? <div className="screen-editor-item-meta">ACTION: {card.actionTags.join(", ")}</div> : null}
                        {card.modeText ? <div className="screen-editor-item-meta">MODE: {card.modeText}</div> : null}
                        <div className="screen-editor-item-actions">
                          <WorkbenchButton onClick={() => openObjectIoDialog(card.objectId)} disabled={savingInterface}>Edit</WorkbenchButton>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </WorkbenchDialog>

      <WorkbenchDialog
        title="EDIT OBJECT I/O"
        open={objectIoDialog.open}
        onClose={closeObjectIoDialog}
        width={900}
        height={620}
        minWidth={760}
        minHeight={480}
        resizable
        bodyClassName="screen-editor-opc-browser-content screen-editor-setproperty-picker screen-editor-object-io-dialog-body"
        actions={(
          <>
            <WorkbenchButton onClick={closeObjectIoDialog}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={() => void saveObjectIoDialog()} disabled={savingInterface || !objectIoDialog.dirty}>
              Save
            </WorkbenchButton>
          </>
        )}
      >
        <div
          className="screen-editor-library-interface__object-io-dialog screen-editor-object-io-picker"
          style={{ ["--object-io-left-width" as string]: `${objectIoLeftPaneWidth}px` } as React.CSSProperties}
        >
          <div className="screen-editor-object-io-picker__left">
            <div className="screen-editor-opc-browser-toolbar">
              <input
                className="workbench-input screen-editor-opc-browser-toolbar__search"
                value={objectIoSearchQuery}
                onChange={(event) => setObjectIoSearchQuery(event.target.value)}
                placeholder="Search object or I/O field..."
              />
            </div>
            <div className="screen-editor-opc-browser-list screen-editor-setproperty-picker__list">
              <div className="screen-editor-setproperty-picker__tree">
                <Tree
                  treeData={objectIoTreeData}
                  expandedKeys={objectIoExpandedKeys}
                  onExpand={(keys) => {
                    if (objectIoSearchQuery.trim()) {
                      return;
                    }
                    setObjectIoExpandedObjectIds(keys.map((key) => String(key)));
                  }}
                  selectedKeys={objectIoDialog.selectedObjectId ? [`obj:${objectIoDialog.selectedObjectId}`] : []}
                  onSelect={(_, info) => {
                    const node = info.node as ObjectIoPickerTreeNode;
                    if (node.nodeType === "object" && node.objectId) {
                      setObjectIoDialog((prev) => ({ ...prev, selectedObjectId: node.objectId! }));
                    }
                  }}
                />
                {filteredObjectIoObjectRows.length === 0 ? (
                  <div className="screen-editor-empty-state">Nothing found.</div>
                ) : null}
              </div>
            </div>
            <div className="screen-editor-setproperty-picker__footer">
              <span>Objects: {filteredObjectIoObjectRows.length} / {objectIoObjectRows.length}</span>
            </div>
          </div>
          <div
            className="screen-editor-object-io-picker__splitter"
            onPointerDown={startObjectIoPaneResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize columns"
          />
          <div className="screen-editor-library-interface__object-io-editor screen-editor-object-io-picker__right">
            {!selectedObjectIoDraftObject ? (
              <div className="screen-editor-item-meta">Select an internal object.</div>
            ) : (
              <>
                <div className="screen-editor-item-title">{selectedObjectIoDraftObject.name?.trim() || selectedObjectIoDraftObject.id}</div>
                <div className="screen-editor-item-meta">Type: {selectedObjectIoDraftObject.type}</div>
                {(() => {
                  const fields = getObjectIoFields(selectedObjectIoDraftObject);
                  const hasTypeSpecificFields = fields.some((field) => field.fieldPath !== "visibleTag" && field.fieldPath !== "disabledTag");
                  const action = getDeepValue(selectedObjectIoDraftObject, "action") as RuntimeAction | undefined;
                  const actionMode = getObjectIoActionMode(action);
                  const actionSelectValue = actionMode === "unsupported" ? "__unsupported__" : actionMode;
                  const canEditAction = supportsObjectIoAction(selectedObjectIoDraftObject);
                  return (
                    <>
                      {canEditAction ? (
                        <label className="screen-editor-library-interface__object-io-field-row">
                          <span>Action Type</span>
                          <select
                            className="workbench-select"
                            value={actionSelectValue}
                            onChange={(event) => {
                              if (event.target.value === "__unsupported__") {
                                return;
                              }
                              setObjectIoActionMode(selectedObjectIoDraftObject, event.target.value as ObjectIoActionMode);
                            }}
                          >
                            {actionMode === "unsupported" ? <option value="__unsupported__">Keep current (non-I/O action)</option> : null}
                            {selectedObjectIoDraftObject.type !== "button" ? <option value="none">No I/O action</option> : null}
                            <option value="write">Write</option>
                            <option value="pulse">Pulse</option>
                            <option value="toggle">Toggle</option>
                            <option value="writeConstTag">Write Const (Tag)</option>
                            <option value="writeNumberPromptTag">Write Number Prompt (Tag)</option>
                          </select>
                        </label>
                      ) : null}

                      {!hasTypeSpecificFields ? (
                        <div className="screen-editor-item-meta">No I/O fields available for this object type yet.</div>
                      ) : null}

                      <div className="screen-editor-library-interface__object-io-fields">
                        {fields.map((field) => {
                          if (field.visibleWhen) {
                            const visibleWhenValue = String(getDeepValue(selectedObjectIoDraftObject, field.visibleWhen.fieldPath) ?? "");
                            if (!field.visibleWhen.values.includes(visibleWhenValue)) {
                              return null;
                            }
                          }
                          const rawValue = getDeepValue(selectedObjectIoDraftObject, field.fieldPath);
                          const control = field.control ?? "tag";
                          const key = `${selectedObjectIoDraftObject.id}:${field.fieldPath}`;

                          if (control === "tag") {
                            const tagValue = String(rawValue ?? "");
                            const bindingKey = extractBindingKey(tagValue);
                            const manualMode = !bindingKey;
                            const selectedBindingValue = manualMode ? "__manual__" : bindingKey;
                            const manualTagValue = manualMode ? tagValue : "";
                            const bindingOptions = buildBindingOptionsForField(field, field.direction, bindingKey);
                            return (
                              <div
                                key={key}
                                className="screen-editor-library-interface__object-io-field-card"
                              >
                                <label className="screen-editor-library-interface__object-io-field-row">
                                  <span>{field.label}</span>
                                  <select
                                    className="workbench-select"
                                    value={selectedBindingValue}
                                    onChange={(event) => {
                                      const nextValue = event.target.value;
                                      if (nextValue === "__manual__") {
                                        patchObjectIoField(field.fieldPath, manualTagValue);
                                        return;
                                      }
                                      patchObjectIoField(field.fieldPath, `$binding.${nextValue}`);
                                    }}
                                  >
                                    <option value="__manual__">Manual tag</option>
                                    {bindingOptions.map((option) => (
                                      <option key={`${key}:binding:${option.key}`} value={option.key}>{option.label}</option>
                                    ))}
                                  </select>
                                </label>
                                {manualMode ? (
                                  <label className="screen-editor-library-interface__object-io-field-row">
                                    <span>Manual Tag</span>
                                    <input
                                      className="workbench-input"
                                      value={manualTagValue}
                                      placeholder="Some.Real.Tag"
                                      onChange={(event) => patchObjectIoField(field.fieldPath, event.target.value)}
                                    />
                                  </label>
                                ) : null}
                              </div>
                            );
                          }

                          if (control === "boolean") {
                            const boolValue = Boolean(rawValue);
                            return (
                              <div
                                key={key}
                                className="screen-editor-library-interface__object-io-field-card"
                              >
                                <label className="screen-editor-library-interface__object-io-field-row">
                                  <span>{field.label}</span>
                                  <select
                                    className="workbench-select"
                                    value={boolValue ? "true" : "false"}
                                    onChange={(event) => patchObjectIoField(field.fieldPath, event.target.value === "true")}
                                  >
                                    <option value="true">true</option>
                                    <option value="false">false</option>
                                  </select>
                                </label>
                              </div>
                            );
                          }

                          if (control === "number") {
                            const numberValue = rawValue === undefined || rawValue === null ? "" : String(rawValue);
                            return (
                              <div
                                key={key}
                                className="screen-editor-library-interface__object-io-field-card"
                              >
                                <label className="screen-editor-library-interface__object-io-field-row">
                                  <span>{field.label}</span>
                                  <input
                                    className="workbench-input"
                                    type="number"
                                    min={field.min}
                                    max={field.max}
                                    step={field.step}
                                    value={numberValue}
                                    onChange={(event) => {
                                      const parsed = event.target.value === "" ? undefined : Number(event.target.value);
                                      patchObjectIoField(field.fieldPath, parsed);
                                    }}
                                  />
                                </label>
                              </div>
                            );
                          }

                          if (control === "select") {
                            const selectValue = String(rawValue ?? field.options?.[0]?.value ?? "");
                            return (
                              <div
                                key={key}
                                className="screen-editor-library-interface__object-io-field-card"
                              >
                                <label className="screen-editor-library-interface__object-io-field-row">
                                  <span>{field.label}</span>
                                  <select
                                    className="workbench-select"
                                    value={selectValue}
                                    onChange={(event) => patchObjectIoField(field.fieldPath, event.target.value)}
                                  >
                                    {(field.options ?? []).map((option) => (
                                      <option key={`${key}:option:${option.value}`} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                            );
                          }

                          const textValue = String(rawValue ?? "");
                          return (
                            <div
                              key={key}
                              className="screen-editor-library-interface__object-io-field-card"
                            >
                              <label className="screen-editor-library-interface__object-io-field-row">
                                <span>{field.label}</span>
                                <input
                                  className="workbench-input"
                                  value={textValue}
                                  onChange={(event) => {
                                    const nextValue = field.fieldPath === "action.value" ? parseScalarToken(event.target.value) : event.target.value;
                                    patchObjectIoField(field.fieldPath, nextValue);
                                  }}
                                />
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
                {objectIoDialog.dirty ? <div className="screen-editor-item-meta">Unsaved changes</div> : null}
              </>
            )}
          </div>
        </div>
      </WorkbenchDialog>

      <WorkbenchDialog
        title={visualRuleDialog.mode === "create" ? "Add Visual Rule" : "Edit Visual Rule"}
        open={visualRuleDialog.open}
        onClose={() => setVisualRuleDialog((prev) => ({ ...prev, open: false }))}
        width={900}
        height={620}
        minWidth={760}
        minHeight={480}
        resizable
        actions={(
          <>
            <WorkbenchButton onClick={() => setVisualRuleDialog((prev) => ({ ...prev, open: false }))}>Cancel</WorkbenchButton>
            <WorkbenchButton variant="primary" onClick={() => void saveVisualRuleDialog()} disabled={savingInterface}>Save</WorkbenchButton>
          </>
        )}
      >
        <div className="screen-editor-library-interface__dialog-grid">
          <label className="screen-editor-library-interface__rule-name-field">
            <span>Rule Name</span>
            <input
              className="workbench-input"
              value={visualRuleDialog.name}
              onChange={(event) => setVisualRuleDialog((prev) => ({
                ...prev,
                name: event.target.value,
                validationError: undefined,
              }))}
              placeholder="Visual Rule"
            />
          </label>
          <div className="screen-editor-library-interface__section-title">Condition</div>
          <div className="screen-editor-item-meta">Maximum conditions: {MAX_VISUAL_RULE_CONDITIONS}</div>
          <label className="screen-editor-library-interface__logic-field">
            <span>Combine conditions with</span>
            <select
              className="workbench-select"
              value={visualRuleDialog.logic}
              onChange={(event) => setVisualRuleDialog((prev) => ({
                ...prev,
                logic: event.target.value as VisualRuleLogicOperator,
                validationError: undefined,
              }))}
            >
              <option value="AND">AND</option>
              <option value="OR">OR</option>
              <option value="XOR">XOR</option>
            </select>
          </label>
          <div className="screen-editor-library-interface__condition-list">
            {visualRuleDialog.clauses.map((clause) => (
              <div key={clause.id} className="screen-editor-library-interface__condition-row">
                {(() => {
                  const selectedBinding = selectedElementBindingsByKey.get(clause.signalKey);
                  const boolSignal = isBoolSignalDataType(selectedBinding?.dataType);
                  return (
                    <>
                <select
                  className="workbench-select"
                  value={clause.signalKey}
                  onChange={(event) => setVisualRuleDialog((prev) => ({
                    ...prev,
                    clauses: prev.clauses.map((item) => {
                      if (item.id !== clause.id) {
                        return item;
                      }
                      const nextSignalKey = event.target.value;
                      const nextBinding = selectedElementBindingsByKey.get(nextSignalKey);
                      return normalizeClauseBySignalDataType({ ...item, signalKey: nextSignalKey }, nextBinding?.dataType);
                    }),
                    validationError: undefined,
                  }))}
                >
                  <option value="">Select signal</option>
                  {(selectedElement?.bindings ?? []).map((binding) => (
                    <option key={binding.id} value={binding.key}>{binding.displayName} ({binding.key})</option>
                  ))}
                </select>
                <select
                  className="workbench-select"
                  value={clause.condition}
                  onChange={(event) => setVisualRuleDialog((prev) => ({
                    ...prev,
                    clauses: prev.clauses.map((item) => (
                      item.id === clause.id
                        ? {
                            ...item,
                            condition: event.target.value as VisualRuleClauseConditionType,
                            value2: event.target.value === "between" ? item.value2 : "",
                          }
                        : item
                    )),
                    validationError: undefined,
                  }))}
                >
                  <option value="equals">==</option>
                  <option value="notEquals">!=</option>
                  {!boolSignal ? <option value="greaterThan">&gt;</option> : null}
                  {!boolSignal ? <option value="lessThan">&lt;</option> : null}
                  {!boolSignal ? <option value="greaterOrEqual">&gt;=</option> : null}
                  {!boolSignal ? <option value="lessOrEqual">&lt;=</option> : null}
                  {!boolSignal ? <option value="between">between</option> : null}
                </select>
                <div className="screen-editor-library-interface__condition-value-cell">
                  {boolSignal ? (
                    <select
                      className="workbench-select"
                      value={clause.value === "false" ? "false" : "true"}
                      onChange={(event) => setVisualRuleDialog((prev) => ({
                        ...prev,
                        clauses: prev.clauses.map((item) => (
                          item.id === clause.id
                            ? { ...item, value: event.target.value, value2: "" }
                            : item
                        )),
                        validationError: undefined,
                      }))}
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      className="workbench-input"
                      value={clause.value}
                      type={conditionNeedsNumericValue(clause.condition) ? "number" : "text"}
                      placeholder={clause.condition === "between" ? "Min" : "Value"}
                      onChange={(event) => setVisualRuleDialog((prev) => ({
                        ...prev,
                        clauses: prev.clauses.map((item) => (item.id === clause.id ? { ...item, value: event.target.value } : item)),
                        validationError: undefined,
                      }))}
                    />
                  )}
                  {!boolSignal && conditionNeedsSecondValue(clause.condition) ? (
                    <input
                      className="workbench-input"
                      value={clause.value2}
                      type="number"
                      placeholder="Max"
                      onChange={(event) => setVisualRuleDialog((prev) => ({
                        ...prev,
                        clauses: prev.clauses.map((item) => (item.id === clause.id ? { ...item, value2: event.target.value } : item)),
                        validationError: undefined,
                      }))}
                    />
                  ) : null}
                </div>
                <WorkbenchIconButton
                  className="screen-editor-library-interface__row-delete"
                  icon={"\u00d7"}
                  title="Delete condition"
                  disabled={visualRuleDialog.clauses.length <= 1}
                  onClick={() => setVisualRuleDialog((prev) => ({
                    ...prev,
                    clauses: prev.clauses.filter((item) => item.id !== clause.id),
                    validationError: undefined,
                  }))}
                />
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
          <div className="screen-editor-library-interface__inline-actions">
            <WorkbenchButton
              disabled={visualRuleDialog.clauses.length >= MAX_VISUAL_RULE_CONDITIONS}
              onClick={() => {
                const fallbackSignal = selectedElement?.bindings?.[0]?.key ?? "";
                setVisualRuleDialog((prev) => ({
                  ...prev,
                  clauses:
                    prev.clauses.length >= MAX_VISUAL_RULE_CONDITIONS
                      ? prev.clauses
                      : (() => {
                          const nextSignalKey = prev.clauses[0]?.signalKey || fallbackSignal;
                          const nextBinding = selectedElementBindingsByKey.get(nextSignalKey);
                          return [...prev.clauses, createDefaultVisualRuleClause(nextSignalKey, nextBinding?.dataType)];
                        })(),
                  validationError: undefined,
                }));
              }}
            >
              Add Condition
            </WorkbenchButton>
          </div>
        </div>

        <div className="screen-editor-library-interface__section-title" style={{ marginTop: 12 }}>Then Actions</div>
        <div className="screen-editor-library-interface__rule-actions-editor">
          {visualRuleDialog.actions.map((action, index) => (
            <div key={action.id} className="screen-editor-library-interface__rule-action-row">
              <button
                type="button"
                className="screen-editor-library-interface__action-target screen-editor-library-interface__action-target-button"
                onClick={() => openPropertyPickerForAction(index)}
                title="Select object property"
              >
                <span className="screen-editor-item-meta">
                  {(() => {
                    const objectLabel = action.objectId
                      ? (flatElementObjectMap.get(action.objectId)?.name?.trim() || action.objectId)
                      : "Object";
                    const propertyLabel = action.property || "property";
                    return `${objectLabel}.${propertyLabel}`;
                  })()}
                </span>
              </button>
              <div className="screen-editor-library-interface__action-value">
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
                    <ColorPicker
                      value={normalizePickerColor(action.value, "#ffffff")}
                      onChangeComplete={(color: any) => {
                        const next = color?.toHexString?.() ?? String(color ?? "");
                        updateVisualRuleAction(index, { value: normalizeColorInput(next) });
                      }}
                    />
                    <input
                      className="workbench-input"
                      value={action.value}
                      type="text"
                      placeholder="#00ff00"
                      onChange={(event) => updateVisualRuleAction(index, { value: normalizeColorInput(event.target.value) })}
                    />
                  </div>
                ) : null}
              </div>

              <WorkbenchIconButton
                className="screen-editor-library-interface__row-delete"
                icon={"\u00d7"}
                title="Delete action"
                onClick={() => {
                  setVisualRuleDialog((prev) => ({
                    ...prev,
                    actions: prev.actions.filter((_, actionIndex) => actionIndex !== index),
                  }));
                }}
              />
            </div>
          ))}
        </div>
        <div className="screen-editor-library-interface__inline-actions">
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
        </div>
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



