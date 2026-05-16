import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Divider, Form, Input, InputNumber, List, Modal, Select, Space, Switch, Tabs, Typography, message } from "antd";
import type {
  Asset,
  ElementBindingDefinition,
  HmiObject,
  HmiScreen,
  LibraryElement,
  LibraryParameter,
  TagValue,
} from "@web-scada/shared";
import { normalizeObjectsToGroup, resolveTagName, resolveTemplateString } from "@web-scada/shared";
import { ObjectPropertyPanel } from "../components/object-property-panel";
import { createObjectByType } from "../hmi/editor/default-object-factory";
import { importSvgAssetToPrimitives } from "../hmi/editor/svg-primitive-import";
import { useSnapshotHistory } from "../hooks/use-snapshot-history";
import { HmiStage } from "../hmi/runtime/hmi-stage";
import { api } from "../services/api";
import { useScadaStore } from "../store/scada-store";
import { isTextEditingTarget } from "../utils/keyboard";
import {
  ScadaWorkbenchLayout,
  WorkbenchButton,
  WorkbenchPanelToolbar,
  WorkbenchSection,
  WorkbenchTabs,
  WorkbenchTreeItem,
} from "../components/workbench";

function createElementId(name: string): string {
  return (name || "element")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createBindingKey(input: string): string {
  return (input || "binding")
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "binding";
}

function getInsertPosition(
  element: Pick<LibraryElement, "width" | "height">,
  index: number,
  objectWidth: number,
  objectHeight: number,
): { x: number; y: number } {
  const padding = 10;
  const step = 12;
  const maxX = Math.max(padding, element.width - objectWidth - padding);
  const maxY = Math.max(padding, element.height - objectHeight - padding);
  const x = Math.min(maxX, padding + index * step);
  const y = Math.min(maxY, padding + index * step);
  return { x, y };
}

type CreateElementMode = "empty" | "template";
type TemplateKind = "valve3" | "pump" | "indicator" | "button" | "custom";
type PrimitiveShapeKind = "square" | "circle" | "triangle";

type NewElementFormValues = {
  name: string;
  elementKey: string;
  description: string;
  category: string;
  width: number;
  height: number;
  creationMode: CreateElementMode;
  templateKind: TemplateKind;
};

type StateImageRowDraft = {
  id: string;
  value: string;
  name: string;
  assetId?: string;
};

type StateImageSourceMode = "manualTag" | "existingBinding" | "newBinding";

type DeleteElementDialogState =
  | {
      open: false;
    }
  | {
      open: true;
      mode: "discardDraft" | "deletePersisted";
      libraryId: string;
      elementId?: string;
      elementName: string;
      elementKey?: string;
      category?: string;
      localUsageCount?: number;
    };

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function createPrimitiveShape(kind: PrimitiveShapeKind): HmiObject {
  if (kind === "triangle") {
    return {
      id: makeId("tri"),
      type: "line",
      x: 110,
      y: 110,
      width: 90,
      height: 80,
      minWidth: 20,
      minHeight: 20,
      points: [45, 0, 90, 80, 0, 80],
      stroke: "#8c8c8c",
      strokeWidth: 2,
      closed: true,
      fill: "#262626",
      opacity: 1,
    };
  }
  if (kind === "circle") {
    return {
      id: makeId("circle"),
      type: "rectangle",
      x: 110,
      y: 110,
      width: 90,
      height: 90,
      minWidth: 20,
      minHeight: 20,
      fill: "#262626",
      stroke: "#8c8c8c",
      strokeWidth: 2,
      cornerRadius: 45,
      opacity: 1,
    };
  }
  return {
    id: makeId("square"),
    type: "rectangle",
    x: 110,
    y: 110,
    width: 90,
    height: 90,
    minWidth: 20,
    minHeight: 20,
    fill: "#262626",
    stroke: "#8c8c8c",
    strokeWidth: 2,
    cornerRadius: 0,
    opacity: 1,
  };
}

function createDefaultElement(input?: Partial<Pick<LibraryElement, "name" | "elementKey" | "description" | "category" | "width" | "height">>): LibraryElement {
  const now = new Date().toISOString();
  return {
    id: makeId("element"),
    elementKey: input?.elementKey ?? "",
    name: input?.name ?? "New Element",
    description: input?.description ?? "",
    category: input?.category ?? "",
    width: input?.width ?? 220,
    height: input?.height ?? 120,
    objects: [],
    bindings: [],
    parameters: [],
    stateRules: [],
    createdAt: now,
    updatedAt: now,
  };
}

function parseStateValue(raw: string): string | number | boolean {
  const normalized = raw.trim();
  if (normalized.toLowerCase() === "true") {
    return true;
  }
  if (normalized.toLowerCase() === "false") {
    return false;
  }
  const asNumber = Number(normalized);
  if (Number.isFinite(asNumber) && normalized !== "") {
    return asNumber;
  }
  return normalized;
}

function findAssetByToken(libraryAssets: Asset[], token: string): Asset | undefined {
  const lower = token.toLowerCase();
  return libraryAssets.find((asset) => `${asset.id} ${asset.name} ${asset.fileName}`.toLowerCase().includes(lower));
}

function createTemplateElement(base: LibraryElement, kind: TemplateKind, libraryAssets: Asset[]): LibraryElement {
  if (kind === "custom") {
    return base;
  }

  if (kind === "button") {
    const button = createObjectByType("button");
    button.x = 50;
    button.y = 38;
    button.width = 120;
    button.height = 44;
    return { ...base, objects: [button] };
  }

  if (kind === "indicator") {
    const indicator = createObjectByType("state-indicator");
    indicator.x = 30;
    indicator.y = 30;
    indicator.width = Math.max(160, base.width - 60);
    return { ...base, objects: [indicator] };
  }

  if (kind === "pump") {
    const pump = createObjectByType("pump");
    pump.x = 44;
    pump.y = 20;
    pump.width = 130;
    pump.height = 90;
    return { ...base, objects: [pump] };
  }

  const closed = findAssetByToken(libraryAssets, "closed") ?? libraryAssets[0];
  const open = findAssetByToken(libraryAssets, "open") ?? closed ?? libraryAssets[0];
  const middle = findAssetByToken(libraryAssets, "middle") ?? open ?? closed ?? libraryAssets[0];
  const fault = findAssetByToken(libraryAssets, "fault") ?? middle ?? open ?? closed ?? libraryAssets[0];

  const label = createObjectByType("text") as Extract<HmiObject, { type: "text" }>;
  label.name = "label";
  label.text = "{{label}}";
  label.x = 10;
  label.y = 0;
  label.width = Math.max(140, base.width - 20);
  label.height = 22;

  const stateImage = createObjectByType("stateImage") as Extract<HmiObject, { type: "stateImage" }>;
  stateImage.name = "state_image";
  stateImage.x = Math.max(0, Math.round((base.width - 90) / 2));
  stateImage.y = 28;
  stateImage.width = 90;
  stateImage.height = 56;
  stateImage.tag = "$binding.valveVisualState";
  stateImage.defaultAssetId = closed?.id;
  const fallbackAssetId = closed?.id ?? open?.id ?? middle?.id ?? fault?.id ?? "";
  stateImage.states = [
    { id: makeId("state"), name: "Closed", condition: { type: "equals", value: 0 }, assetId: closed?.id ?? fallbackAssetId },
    { id: makeId("state"), name: "Open", condition: { type: "equals", value: 1 }, assetId: open?.id ?? fallbackAssetId },
    { id: makeId("state"), name: "Middle", condition: { type: "equals", value: 2 }, assetId: middle?.id ?? fallbackAssetId },
    { id: makeId("state"), name: "Fault", condition: { type: "equals", value: 3 }, assetId: fault?.id ?? fallbackAssetId },
  ];

  return {
    ...base,
    objects: [label, stateImage],
    bindings: [
      {
        id: makeId("binding"),
        key: "valveVisualState",
        displayName: "Valve visual state",
        kind: "state",
        dataType: "INT",
        required: true,
        defaultBaseTag: ".State",
        overridable: true,
      },
    ],
    parameters: [{ name: "label", type: "string", defaultValue: "Valve", description: "Label text" }],
  };
}

function createVirtualScreen(element: LibraryElement): HmiScreen {
  return {
    id: `element_screen_${element.id}`,
    name: element.name,
    kind: "template",
    width: element.width,
    height: element.height,
    background: "#17212b",
    objects: element.objects,
  };
}

function updateObjectInList(objects: HmiObject[], objectId: string, updater: (current: HmiObject) => HmiObject): HmiObject[] {
  return objects.map((item) => {
    if (item.id === objectId) {
      return updater(item);
    }
    if (item.type === "group") {
      return { ...item, objects: updateObjectInList(item.objects, objectId, updater) };
    }
    return item;
  });
}

function removeObjectsInList(objects: HmiObject[], ids: Set<string>): HmiObject[] {
  return objects
    .filter((item) => !ids.has(item.id))
    .map((item) => (item.type === "group" ? { ...item, objects: removeObjectsInList(item.objects, ids) } : item));
}

function flattenObjectIds(objects: HmiObject[]): string[] {
  const ids: string[] = [];
  for (const object of objects) {
    ids.push(object.id);
    if (object.type === "group") {
      ids.push(...flattenObjectIds(object.objects));
    }
  }
  return ids;
}

function resolveParameterValue(param: LibraryParameter, raw: string): unknown {
  if (param.type === "number" || param.type === "index") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (param.type === "boolean") {
    return raw === "true" || raw === "1";
  }
  return raw;
}

function countElementUsages(project: ReturnType<typeof useScadaStore.getState>["project"], libraryId: string, elementId: string): number {
  if (!project) {
    return 0;
  }
  let count = 0;
  for (const screen of project.screens) {
    const queue = [...screen.objects];
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        continue;
      }
      if (item.type === "libraryElementInstance" && item.libraryId === libraryId && item.elementId === elementId) {
        count += 1;
      }
      if (item.type === "group") {
        queue.push(...item.objects);
      }
    }
  }
  return count;
}

function toActionErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const normalized = text.toLowerCase();
  if (
    normalized.includes("engineer auth required") ||
    normalized.includes("engineer authentication required") ||
    normalized.includes("401")
  ) {
    return "Authentication required. Please sign in again.";
  }
  if (normalized.includes("403") || normalized.includes("insufficient permissions") || normalized.includes("required:")) {
    return "Insufficient permissions for this action.";
  }
  return text;
}

function StateRulesEditor({
  stateRules,
  objects,
  bindings,
  assets,
  onChange,
}: {
  stateRules: NonNullable<LibraryElement["stateRules"]>;
  objects: HmiObject[];
  bindings: ElementBindingDefinition[];
  assets: Asset[];
  onChange: (next: NonNullable<LibraryElement["stateRules"]>) => void;
}) {
  const firstBindingKey = bindings[0]?.key ?? "visualState";

  const setRule = (ruleIndex: number, rule: any) => {
    const next = [...stateRules];
    next[ruleIndex] = rule;
    onChange(next);
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={8}>
      <Typography.Text type="secondary">
        Define visual behavior based on binding values. Source supports <code>$binding.key</code> or direct tag.
      </Typography.Text>
      <Button
        size="small"
        onClick={() => {
          const nextRule: NonNullable<LibraryElement["stateRules"]>[number] = {
            id: makeId("rule"),
            name: "New Rule",
            source: { type: "tag", value: `$binding.${firstBindingKey}` },
            cases: [],
          };
          onChange([...stateRules, nextRule]);
        }}
      >
        Add State Rule
      </Button>
      {stateRules.length === 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>No state rules defined.</Typography.Text>
      ) : (
        stateRules.map((rule, ruleIndex) => (
          <div key={rule.id} style={{ border: "1px solid #303030", borderRadius: 6, padding: 8 }}>
            <Space direction="vertical" style={{ width: "100%" }} size={6}>
              <Space wrap style={{ width: "100%" }}>
                <Input
                  style={{ width: 160 }}
                  value={rule.name}
                  placeholder="Rule name"
                  onChange={(event) => setRule(ruleIndex, { ...rule, name: event.target.value })}
                />
                <Select
                  style={{ width: 130 }}
                  value={rule.source.type}
                  options={[
                    { label: "Tag", value: "tag" },
                    { label: "Parameter", value: "parameter" },
                    { label: "Expression", value: "expression" },
                  ]}
                  onChange={(value) => setRule(ruleIndex, { ...rule, source: { type: value as "tag" | "parameter" | "expression", value: rule.source.value } })}
                />
                <Input
                  style={{ width: 200 }}
                  value={rule.source.value}
                  placeholder={`$$binding.${firstBindingKey}`}
                  onChange={(event) => setRule(ruleIndex, { ...rule, source: { ...rule.source, value: event.target.value } })}
                />
                <Button size="small" danger onClick={() => onChange(stateRules.filter((_, i) => i !== ruleIndex))}>Delete Rule</Button>
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Cases
              </Typography.Text>
              <Button size="small" onClick={() => {
                const newCase = {
                  id: makeId("case"),
                  name: "New case",
                  condition: { type: "equals" as const, value: 0 },
                  actions: [],
                };
                setRule(ruleIndex, { ...rule, cases: [...(rule.cases ?? []), newCase] });
              }}>Add Case</Button>
              {(!rule.cases || rule.cases.length === 0) ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>No cases. Add at least one case with actions.</Typography.Text>
              ) : (
                rule.cases.map((stateCase, caseIndex) => (
                  <div key={stateCase.id} style={{ border: "1px solid #434343", borderRadius: 4, padding: 6, marginLeft: 8 }}>
                    <Space direction="vertical" style={{ width: "100%" }} size={4}>
                      <Space wrap style={{ width: "100%" }}>
                        <Input
                          style={{ width: 140 }}
                          value={stateCase.name}
                          placeholder="Case name"
                          onChange={(event) => {
                            const nextCases: any[] = [...(rule.cases ?? [])];
                            nextCases[caseIndex] = { ...nextCases[caseIndex], name: event.target.value };
                            setRule(ruleIndex, { ...rule, cases: nextCases });
                          }}
                        />
                        <Select
                          style={{ width: 130 }}
                          value={stateCase.condition.type}
                          options={[
                            { label: "equals", value: "equals" },
                            { label: "notEquals", value: "notEquals" },
                            { label: "greaterThan", value: "greaterThan" },
                            { label: "lessThan", value: "lessThan" },
                            { label: "between", value: "between" },
                            { label: "true", value: "true" },
                            { label: "false", value: "false" },
                          ]}
                          onChange={(value) => {
                            const nextCases: any[] = [...(rule.cases ?? [])];
                            const current = nextCases[caseIndex];
                            if (value === "true" || value === "false") {
                              nextCases[caseIndex] = { ...current, condition: { type: value } } as NonNullable<LibraryElement["stateRules"]>[number]["cases"][number];
                            } else if (value === "between") {
                              nextCases[caseIndex] = { ...current, condition: { type: value, min: 0, max: 10 } } as NonNullable<LibraryElement["stateRules"]>[number]["cases"][number];
                            } else {
                              nextCases[caseIndex] = { ...current, condition: { type: value, value: 0 } } as NonNullable<LibraryElement["stateRules"]>[number]["cases"][number];
                            }
                            setRule(ruleIndex, { ...rule, cases: nextCases });
                          }}
                        />
                        {(stateCase.condition.type === "equals" || stateCase.condition.type === "notEquals") && (
                          <InputNumber
                            style={{ width: 100 }}
                            value={Number(stateCase.condition.value ?? 0)}
                            onChange={(val) => {
                              const nextCases: any[] = [...(rule.cases ?? [])];
                              nextCases[caseIndex] = { ...nextCases[caseIndex], condition: { type: stateCase.condition.type, value: Number(val ?? 0) } };
                              setRule(ruleIndex, { ...rule, cases: nextCases });
                            }}
                          />
                        )}
                        {(stateCase.condition.type === "greaterThan" || stateCase.condition.type === "lessThan") && (
                          <InputNumber
                            style={{ width: 100 }}
                            value={Number(stateCase.condition.value ?? 0)}
                            onChange={(val) => {
                              const nextCases: any[] = [...(rule.cases ?? [])];
                              nextCases[caseIndex] = { ...nextCases[caseIndex], condition: { type: stateCase.condition.type, value: Number(val ?? 0) } };
                              setRule(ruleIndex, { ...rule, cases: nextCases });
                            }}
                          />
                        )}
                        {stateCase.condition.type === "between" && (
                          <Space>
                            <InputNumber
                              style={{ width: 80 }}
                              value={(stateCase.condition as { type: "between"; min: number; max: number }).min ?? 0}
                              onChange={(val) => {
                                const nextCases: any[] = [...(rule.cases ?? [])];
                                nextCases[caseIndex] = { ...nextCases[caseIndex], condition: { type: "between", min: Number(val ?? 0), max: (stateCase.condition as any).max ?? 10 } };
                                setRule(ruleIndex, { ...rule, cases: nextCases });
                              }}
                            />
                            <Typography.Text>—</Typography.Text>
                            <InputNumber
                              style={{ width: 80 }}
                              value={(stateCase.condition as { type: "between"; min: number; max: number }).max ?? 10}
                              onChange={(val) => {
                                const nextCases: any[] = [...(rule.cases ?? [])];
                                nextCases[caseIndex] = { ...nextCases[caseIndex], condition: { type: "between", min: (stateCase.condition as any).min ?? 0, max: Number(val ?? 0) } };
                                setRule(ruleIndex, { ...rule, cases: nextCases });
                              }}
                            />
                          </Space>
                        )}
                        <Button size="small" danger onClick={() => {
                          setRule(ruleIndex, { ...rule, cases: (rule.cases ?? []).filter((_, i) => i !== caseIndex) });
                        }}>Delete Case</Button>
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>Actions</Typography.Text>
                      <Button size="small" onClick={() => {
                        const newAction = {
                          type: "setVisible" as const,
                          objectId: objects[0]?.id ?? "",
                          visible: true,
                        };
                        const nextCases: any[] = [...(rule.cases ?? [])];
                        nextCases[caseIndex] = { ...nextCases[caseIndex], actions: [...((nextCases[caseIndex] as any)?.actions ?? []), newAction] };
                        setRule(ruleIndex, { ...rule, cases: nextCases });
                      }}>Add Action</Button>
                      {(!stateCase.actions || stateCase.actions.length === 0) ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>No actions.</Typography.Text>
                      ) : (
                        stateCase.actions.map((action, actionIndex) => (
                          <div key={actionIndex} style={{ border: "1px solid #555", borderRadius: 4, padding: 4, marginLeft: 12 }}>
                            <Space wrap style={{ width: "100%" }}>
                              <Select
                                style={{ width: 120 }}
                                value={action.type}
                                options={[
                                  { label: "setVisible", value: "setVisible" },
                                  { label: "setAsset", value: "setAsset" },
                                  { label: "setText", value: "setText" },
                                  { label: "setFill", value: "setFill" },
                                  { label: "setStroke", value: "setStroke" },
                                ]}
                                onChange={(value) => {
                                  const nextCases: any[] = [...(rule.cases ?? [])];
                                  const nextActions: any[] = [...((nextCases[caseIndex] as any)?.actions ?? [])];
                                  if (value === "setVisible") {
                                    nextActions[actionIndex] = { type: "setVisible", objectId: action.objectId, visible: true };
                                  } else if (value === "setAsset") {
                                    nextActions[actionIndex] = { type: "setAsset", objectId: action.objectId, assetId: "" };
                                  } else if (value === "setText") {
                                    nextActions[actionIndex] = { type: "setText", objectId: action.objectId, text: "" };
                                  } else {
                                    nextActions[actionIndex] = { type: value as "setFill" | "setStroke", objectId: action.objectId, color: "" };
                                  }
                                  nextCases[caseIndex] = { ...nextCases[caseIndex], actions: nextActions };
                                  setRule(ruleIndex, { ...rule, cases: nextCases });
                                }}
                              />
                              <Select
                                style={{ minWidth: 160 }}
                                value={action.objectId}
                                options={objects.map((obj) => ({ label: obj.name || obj.id, value: obj.id }))}
                                placeholder="Select object"
                                onChange={(value) => {
                                  const nextCases: any[] = [...(rule.cases ?? [])];
                                  const nextActions: any[] = [...((nextCases[caseIndex] as any)?.actions ?? [])];
                                  nextActions[actionIndex] = { ...nextActions[actionIndex], objectId: value };
                                  nextCases[caseIndex] = { ...nextCases[caseIndex], actions: nextActions };
                                  setRule(ruleIndex, { ...rule, cases: nextCases });
                                }}
                              />
                              {action.type === "setVisible" && (
                                <Switch
                                  checked={"visible" in action ? action.visible : true}
                                  onChange={(checked) => {
                                    const nextCases: any[] = [...(rule.cases ?? [])];
                                    const nextActions: any[] = [...((nextCases[caseIndex] as any)?.actions ?? [])];
                                    nextActions[actionIndex] = { ...nextActions[actionIndex], visible: checked };
                                    nextCases[caseIndex] = { ...nextCases[caseIndex], actions: nextActions };
                                    setRule(ruleIndex, { ...rule, cases: nextCases });
                                  }}
                                />
                              )}
                              {action.type === "setAsset" && (
                                <Select
                                  style={{ minWidth: 160 }}
                                  value={"assetId" in action ? action.assetId : ""}
                                  options={assets.map((a) => ({ label: a.name, value: a.id }))}
                                  placeholder="Select asset"
                                  onChange={(value) => {
                                    const nextCases: any[] = [...(rule.cases ?? [])];
                                    const nextActions: any[] = [...((nextCases[caseIndex] as any)?.actions ?? [])];
                                    nextActions[actionIndex] = { ...nextActions[actionIndex], assetId: value };
                                    nextCases[caseIndex] = { ...nextCases[caseIndex], actions: nextActions };
                                    setRule(ruleIndex, { ...rule, cases: nextCases });
                                  }}
                                />
                              )}
                              {action.type === "setText" && (
                                <Input
                                  style={{ width: 160 }}
                                  value={"text" in action ? action.text : ""}
                                  placeholder="Text value"
                                  onChange={(event) => {
                                    const nextCases: any[] = [...(rule.cases ?? [])];
                                    const nextActions: any[] = [...((nextCases[caseIndex] as any)?.actions ?? [])];
                                    nextActions[actionIndex] = { ...nextActions[actionIndex], text: event.target.value };
                                    nextCases[caseIndex] = { ...nextCases[caseIndex], actions: nextActions };
                                    setRule(ruleIndex, { ...rule, cases: nextCases });
                                  }}
                                />
                              )}
                              {(action.type === "setFill" || action.type === "setStroke") && (
                                <Input
                                  style={{ width: 120 }}
                                  value={"color" in action ? action.color : ""}
                                  placeholder="#ffffff"
                                  onChange={(event) => {
                                    const nextCases: any[] = [...(rule.cases ?? [])];
                                    const nextActions: any[] = [...((nextCases[caseIndex] as any)?.actions ?? [])];
                                    nextActions[actionIndex] = { ...nextActions[actionIndex], color: event.target.value };
                                    nextCases[caseIndex] = { ...nextCases[caseIndex], actions: nextActions };
                                    setRule(ruleIndex, { ...rule, cases: nextCases });
                                  }}
                                />
                              )}
                              <Button size="small" danger onClick={() => {
                                const nextCases: any[] = [...(rule.cases ?? [])];
                                nextCases[caseIndex] = { ...nextCases[caseIndex], actions: ((nextCases[caseIndex] as any)?.actions ?? []).filter((_: unknown, i: number) => i !== actionIndex) };
                                setRule(ruleIndex, { ...rule, cases: nextCases });
                              }}>Del</Button>
                            </Space>
                          </div>
                        ))
                      )}
                    </Space>
                  </div>
                ))
              )}
            </Space>
          </div>
        ))
      )}
    </Space>
  );
}

export function ElementEditorPage() {
  const project = useScadaStore((s) => s.project);
  const tags = useScadaStore((s) => s.tags);
  const libraries = useScadaStore((s) => s.libraries);
  const assets = useScadaStore((s) => s.assets);
  const loadLibraries = useScadaStore((s) => s.loadLibraries);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const canElementsWrite = useScadaStore((s) => s.hasPermission("elements.write"));
  const canElementsDelete = useScadaStore((s) => s.hasPermission("elements.delete"));
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>("");
  const [selectedElementId, setSelectedElementId] = useState<string>("");
  const [draftElement, setDraftElement] = useState<LibraryElement | null>(null);
  const [draftIsNew, setDraftIsNew] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number }>();
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [activeObjectId, setActiveObjectId] = useState<string>();
  const [stateRulesJson, setStateRulesJson] = useState<string>("[]");
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [previewStateTag, setPreviewStateTag] = useState(".State");
  const [previewStateValue, setPreviewStateValue] = useState<string>("0");
  const [newElementModalOpen, setNewElementModalOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetPickerTargetObjectId, setAssetPickerTargetObjectId] = useState<string>();
  const [stateImageWizardOpen, setStateImageWizardOpen] = useState(false);
  const [stateImageDraftRows, setStateImageDraftRows] = useState<StateImageRowDraft[]>([
    { id: makeId("state"), value: "0", name: "State 0", assetId: undefined },
  ]);
  const [stateImageWizardTag, setStateImageWizardTag] = useState(".State");
  const [stateImageWizardSourceMode, setStateImageWizardSourceMode] = useState<StateImageSourceMode>("manualTag");
  const [stateImageWizardBindingKey, setStateImageWizardBindingKey] = useState("stateBinding");
  const [stateImageWizardBindingDisplayName, setStateImageWizardBindingDisplayName] = useState("State binding");
  const [stateImageWizardBindingDataType, setStateImageWizardBindingDataType] = useState<"BOOL" | "INT" | "UINT" | "DINT" | "UDINT" | "REAL" | "STRING">("INT");
  const [stateImageWizardName, setStateImageWizardName] = useState("state_image");
  const [stateImageWizardWidth, setStateImageWizardWidth] = useState(90);
  const [stateImageWizardHeight, setStateImageWizardHeight] = useState(56);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [deletingElement, setDeletingElement] = useState(false);
  const [deleteElementDialog, setDeleteElementDialog] = useState<DeleteElementDialogState>({ open: false });
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [newElementForm] = Form.useForm<NewElementFormValues>();
  const creationMode = Form.useWatch("creationMode", newElementForm);
  const history = useSnapshotHistory<LibraryElement>({ maxSteps: 50 });

  const selectedLibrary = libraries.find((library) => library.id === selectedLibraryId) ?? null;
  const selectedLibraryAssets = selectedLibrary?.assets ?? [];
  const availableAssets = useMemo(() => {
    const byId = new Map<string, Asset>();
    for (const asset of assets) {
      byId.set(asset.id, asset);
    }
    for (const asset of selectedLibraryAssets) {
      byId.set(asset.id, asset);
    }
    for (const library of libraries) {
      for (const asset of library.assets) {
        if (!byId.has(asset.id)) {
          byId.set(asset.id, asset);
        }
      }
    }
    return [...byId.values()];
  }, [assets, libraries, selectedLibraryAssets]);
  const availableAssetMap = useMemo(() => new Map(availableAssets.map((asset) => [asset.id, asset])), [availableAssets]);
  const elementEditorProject = useMemo(() => {
    if (!project) {
      return null;
    }
    const projectAssets = project.assets ?? [];
    const mergedAssets = new Map(projectAssets.map((asset) => [asset.id, asset]));
    for (const asset of availableAssets) {
      mergedAssets.set(asset.id, asset);
    }
    return {
      ...project,
      assets: [...mergedAssets.values()],
    };
  }, [availableAssets, project]);
  const filteredElements = useMemo(() => {
    const list = selectedLibrary?.elements ?? [];
    const term = search.trim().toLowerCase();
    const byCategory =
      categoryFilter === "all"
        ? list
        : list.filter((item) => (item.category ?? "").toLowerCase() === categoryFilter.toLowerCase());
    if (!term) {
      return byCategory;
    }
    return byCategory.filter((item) => item.name.toLowerCase().includes(term) || item.id.toLowerCase().includes(term));
  }, [categoryFilter, search, selectedLibrary?.elements]);
  const displayElements = useMemo(() => {
    if (!draftIsNew || !draftElement) {
      return filteredElements.map((item) => ({ ...item, isDraft: false }));
    }
    return [
      { ...draftElement, id: draftElement.id || "__draft__", name: `${draftElement.name || "New Element"} *`, isDraft: true },
      ...filteredElements.filter((item) => item.id !== draftElement.id).map((item) => ({ ...item, isDraft: false })),
    ];
  }, [draftElement, draftIsNew, filteredElements]);

  const categoryOptions = useMemo(() => {
    const categories = new Set(
      (selectedLibrary?.elements ?? [])
        .map((item) => item.category?.trim())
        .filter((item): item is string => Boolean(item)),
    );
    return ["all", ...[...categories].sort((a, b) => a.localeCompare(b, "ru"))];
  }, [selectedLibrary?.elements]);

  const requestSwitchLibrary = (nextLibraryId: string) => {
    if (!dirty) {
      setSelectedLibraryId(nextLibraryId);
      setSelectedElementId("");
      setDraftElement(null);
      setDraftIsNew(false);
      return;
    }
    Modal.confirm({
      title: "Unsaved changes",
      content: "Discard current changes and switch library?",
      okText: "Discard",
      cancelText: "Cancel",
      onOk: () => {
        setDirty(false);
        setSelectedLibraryId(nextLibraryId);
        setSelectedElementId("");
        setDraftElement(null);
        setDraftIsNew(false);
      },
    });
  };

  const updateDraftWithHistory = (label: string, updater: (current: LibraryElement) => LibraryElement) => {
    setDraftElement((prev) => {
      if (!prev) {
        return prev;
      }
      const before = structuredClone(prev);
      const next = updater(prev);
      history.pushEntry(label, before, next);
      return next;
    });
    setDirty(true);
  };

  useEffect(() => {
    if (!selectedLibraryId && libraries[0]) {
      setSelectedLibraryId(libraries[0].id);
    }
  }, [libraries, selectedLibraryId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedLibrary) {
      return;
    }
    if (!selectedElementId) {
      if (!draftIsNew && selectedLibrary.elements[0]) {
        setSelectedElementId(selectedLibrary.elements[0].id);
      }
      return;
    }
    void (async () => {
      try {
        const element = await api.getLibraryElement(selectedLibrary.id, selectedElementId);
        if (cancelled) {
          return;
        }
        const clone = deepClone(element);
        setDraftElement(clone);
        setStateRulesJson(JSON.stringify(clone.stateRules ?? [], null, 2));
        setPreviewValues(
          Object.fromEntries((clone.parameters ?? []).map((param) => [param.name, String(param.defaultValue ?? "")])),
        );
        setSelectedObjectIds([]);
        setActiveObjectId(undefined);
        setDirty(false);
        setDraftIsNew(false);
        history.clear();
      } catch (error) {
        if (!cancelled) {
          void message.error(error instanceof Error ? error.message : "Failed to load element");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftIsNew, selectedElementId, selectedLibrary]);

  const activeObject = useMemo(() => {
    if (!draftElement || !activeObjectId) {
      return null;
    }
    const stack: HmiObject[] = [...draftElement.objects];
    while (stack.length > 0) {
      const item = stack.shift();
      if (!item) {
        continue;
      }
      if (item.id === activeObjectId) {
        return item;
      }
      if (item.type === "group") {
        stack.push(...item.objects);
      }
    }
    return null;
  }, [activeObjectId, draftElement]);

  const currentPersistedElementId = useMemo(() => {
    if (draftIsNew) {
      return "";
    }
    return selectedElementId || draftElement?.id || "";
  }, [draftElement?.id, draftIsNew, selectedElementId]);

  const selectedPersistedElement = useMemo(
    () =>
      selectedLibrary?.elements.find((item) => item.id === currentPersistedElementId) ??
      (draftElement && draftElement.id === currentPersistedElementId ? draftElement : null),
    [currentPersistedElementId, draftElement, selectedLibrary?.elements],
  );

  const deleteElementDisabledReason = useMemo(() => {
    if (!canElementsDelete) {
      return "Insufficient permissions: elements.delete";
    }
    if (deletingElement) {
      return "Deleting...";
    }
    if (!draftIsNew && !currentPersistedElementId) {
      return "Select element";
    }
    return undefined;
  }, [canElementsDelete, currentPersistedElementId, deletingElement, draftIsNew]);

  const deleteDialogUsageCount = deleteElementDialog.open ? (deleteElementDialog.localUsageCount ?? 0) : 0;

  const findObjectById = (objectId: string): HmiObject | null => {
    if (!draftElement) {
      return null;
    }
    const stack: HmiObject[] = [...draftElement.objects];
    while (stack.length > 0) {
      const item = stack.shift();
      if (!item) {
        continue;
      }
      if (item.id === objectId) {
        return item;
      }
      if (item.type === "group") {
        stack.push(...item.objects);
      }
    }
    return null;
  };

  const deleteSelectedElementObjects = (source: "keyboard" | "toolbar" | "properties") => {
    if (!draftElement) {
      return;
    }
    if (!canElementsDelete) {
      void message.warning("Insufficient permissions: elements.delete");
      return;
    }

    const sourceIds = selectedObjectIds.length > 0 ? selectedObjectIds : activeObjectId ? [activeObjectId] : [];
    if (sourceIds.length === 0) {
      return;
    }

    const existing = new Set(flattenObjectIds(draftElement.objects));
    const selectedIds = sourceIds.filter((id) => existing.has(id));
    if (selectedIds.length === 0) {
      return;
    }

    const lockedIds = selectedIds.filter((id) => Boolean(findObjectById(id)?.locked));
    const deletableIds = selectedIds.filter((id) => !lockedIds.includes(id));
    if (deletableIds.length === 0) {
      void message.warning("Selected objects are locked and cannot be deleted.");
      return;
    }
    const deletableSet = new Set(deletableIds);

    const hasStateRuleReferences = (draftElement.stateRules ?? []).some((rule) =>
      rule.cases.some((stateCase) => stateCase.actions.some((action) => deletableSet.has(action.objectId))),
    );

    const performDelete = () => {
      updateDraftWithHistory(`Delete objects (${source})`, (current) => ({
        ...current,
        objects: removeObjectsInList(current.objects, deletableSet),
        stateRules: (current.stateRules ?? []).map((rule) => ({
          ...rule,
          cases: rule.cases.map((stateCase) => ({
            ...stateCase,
            actions: stateCase.actions.filter((action) => !deletableSet.has(action.objectId)),
          })),
        })),
      }));
      setSelectedObjectIds([]);
      setActiveObjectId(undefined);
      if (lockedIds.length > 0) {
        void message.warning("Some locked objects were skipped.");
      }
    };

    if (hasStateRuleReferences) {
      Modal.confirm({
        title: "Object is referenced by state rules",
        content: "Delete object and remove references from state rules?",
        okText: "Delete",
        okButtonProps: { danger: true },
        onOk: performDelete,
      });
      return;
    }

    performDelete();
  };

  const previewParameters = useMemo(() => {
    if (!draftElement) {
      return {};
    }
    const result: Record<string, unknown> = {};
    for (const param of draftElement.parameters ?? []) {
      const raw = previewValues[param.name];
      if (raw === undefined || raw === "") {
        result[param.name] = param.defaultValue;
      } else {
        result[param.name] = resolveParameterValue(param, raw);
      }
    }
    return result;
  }, [draftElement, previewValues]);

  const previewTagPrefix = String(previewParameters.tagPrefix ?? "");

  const previewTags = useMemo(() => {
    const next: Record<string, TagValue> = { ...tags };
    const resolvedTag = resolveTagName(resolveTemplateString(previewStateTag, previewParameters), {
      tagPrefix: previewTagPrefix || undefined,
      parameters: previewParameters,
    });
    if (resolvedTag) {
      const numericValue = Number(previewStateValue);
      const parsedValue = Number.isFinite(numericValue) ? numericValue : previewStateValue;
      next[resolvedTag] = {
        name: resolvedTag,
        value: parsedValue,
        quality: "Good",
        timestamp: Date.now(),
        source: "preview",
      };
    }
    return next;
  }, [previewParameters, previewStateTag, previewStateValue, previewTagPrefix, tags]);
  const debugPerformance =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.localStorage.getItem("debugPerformance") === "1";

  useEffect(() => {
    if (!debugPerformance) {
      return;
    }
    // eslint-disable-next-line no-console
    console.debug("[Render] ElementEditor", {
      libraryId: selectedLibraryId,
      elementId: draftElement?.id,
      objects: draftElement?.objects.length ?? 0,
      selected: selectedObjectIds.length,
      history: {
        undo: history.canUndo,
        redo: history.canRedo,
      },
    });
  }, [debugPerformance, draftElement?.id, draftElement?.objects.length, history.canRedo, history.canUndo, selectedLibraryId, selectedObjectIds.length]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!draftElement) {
        return;
      }
      const ctrlOrMeta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const editing = isTextEditingTarget(event.target);

      if (ctrlOrMeta && key === "z" && !event.shiftKey) {
        event.preventDefault();
        const previous = history.undo(draftElement);
        if (previous) {
          setDraftElement(previous);
          setDirty(true);
        }
        return;
      }

      if (ctrlOrMeta && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        const next = history.redo(draftElement);
        if (next) {
          setDraftElement(next);
          setDirty(true);
        }
        return;
      }

      if (ctrlOrMeta && key === "s") {
        event.preventDefault();
        if (!canElementsWrite) {
          void message.warning("Insufficient permissions: elements.write");
          return;
        }
        void saveElement();
        return;
      }

      if (!editing && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        deleteSelectedElementObjects("keyboard");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canElementsWrite, deleteSelectedElementObjects, draftElement, history]);

  if (!project) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const applyDraftPatch = (patch: Partial<LibraryElement>) => {
    if (!draftElement) {
      return;
    }
    updateDraftWithHistory("Update element properties", (current) => ({ ...current, ...patch }));
  };

  const setObjects = (updater: (objects: HmiObject[]) => HmiObject[]) => {
    if (!draftElement) {
      return;
    }
    updateDraftWithHistory("Update element objects", (current) => ({
      ...current,
      objects: updater(current.objects),
    }));
  };

  const addObject = (type: HmiObject["type"]) => {
    if (!canElementsWrite) {
      void message.warning("Insufficient permissions: elements.write");
      return;
    }
    if (!draftElement) {
      return;
    }
    const object = createObjectByType(type);
    const position = getInsertPosition(draftElement, draftElement.objects.length, object.width, object.height);
    object.x = position.x;
    object.y = position.y;
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[ElementEditor] addObject", {
        object,
        elementSize: [draftElement.width, draftElement.height],
        objectsCount: draftElement.objects.length,
      });
    }
    setObjects((prev) => [...prev, object]);
    setSelectedObjectIds([object.id]);
    setActiveObjectId(object.id);
  };

  const addPrimitiveShape = (kind: PrimitiveShapeKind) => {
    if (!canElementsWrite) {
      void message.warning("Insufficient permissions: elements.write");
      return;
    }
    if (!draftElement) {
      return;
    }
    const object = createPrimitiveShape(kind);
    const position = getInsertPosition(draftElement, draftElement.objects.length, object.width, object.height);
    object.x = position.x;
    object.y = position.y;
    setObjects((prev) => [...prev, object]);
    setSelectedObjectIds([object.id]);
    setActiveObjectId(object.id);
  };

  const addImageFromAsset = (assetId: string, targetObjectId?: string) => {
    if (!canElementsWrite) {
      void message.warning("Insufficient permissions: elements.write");
      return;
    }
    const sourceAsset = availableAssetMap.get(assetId);
    if (!sourceAsset) {
      void message.error(`Asset not found in cache: ${assetId}`);
      return;
    }
    if (targetObjectId) {
      setObjects((prev) =>
        updateObjectInList(prev, targetObjectId, (item) => {
          if (item.type === "image") {
            return {
              ...item,
              assetId,
              width: sourceAsset?.width ?? item.width ?? 80,
              height: sourceAsset?.height ?? item.height ?? 80,
            };
          }
          if (item.type === "stateImage") {
            return {
              ...item,
              defaultAssetId: assetId,
            };
          }
          return item;
        }),
      );
      setAssetPickerOpen(false);
      setAssetPickerTargetObjectId(undefined);
      return;
    }

    if (!draftElement) {
      return;
    }

    const image = createObjectByType("image") as Extract<HmiObject, { type: "image" }>;
    image.assetId = assetId;
    image.width = sourceAsset?.width ?? 80;
    image.height = sourceAsset?.height ?? 80;
    const position = getInsertPosition(draftElement, draftElement.objects.length, image.width, image.height);
    image.x = position.x;
    image.y = position.y;
    setObjects((prev) => [...prev, image]);
    setSelectedObjectIds([image.id]);
    setActiveObjectId(image.id);
    setAssetPickerOpen(false);
    setAssetPickerTargetObjectId(undefined);
  };

  const addSvgPrimitivesFromAsset = async (asset: Asset) => {
    if (!canElementsWrite) {
      void message.warning("Insufficient permissions: elements.write");
      return;
    }
    if (!draftElement) {
      return;
    }
    try {
      const imported = await importSvgAssetToPrimitives(asset);
      const { groupBounds, normalizedObjects } = normalizeObjectsToGroup(imported.objects);
      const group: Extract<HmiObject, { type: "group" }> = {
        id: makeId("group"),
        type: "group",
        name: `svg:${asset.name}`,
        x: 10,
        y: 10,
        width: Math.max(1, groupBounds.width),
        height: Math.max(1, groupBounds.height),
        minWidth: 10,
        minHeight: 10,
        objects: normalizedObjects,
      };
      const position = getInsertPosition(draftElement, draftElement.objects.length, group.width, group.height);
      group.x = position.x;
      group.y = position.y;
      setObjects((prev) => [...prev, group]);
      setSelectedObjectIds([group.id]);
      setActiveObjectId(group.id);
      if (imported.warnings.length) {
        void message.warning(imported.warnings.join(" | "));
      } else {
        void message.success(`SVG imported as primitives: ${asset.name}`);
      }
      setAssetPickerOpen(false);
      setAssetPickerTargetObjectId(undefined);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to import SVG as primitives");
    }
  };

  const openAssetPicker = (targetObjectId?: string) => {
    if (!canElementsWrite) {
      void message.warning("Insufficient permissions: elements.write");
      return;
    }
    if (!draftElement) {
      return;
    }
    setAssetPickerTargetObjectId(targetObjectId);
    setAssetPickerOpen(true);
  };

  const uploadAssetToLibrary = async (file: File) => {
    if (!selectedLibraryId) {
      void message.warning("Select library first");
      return;
    }
    setUploadingAsset(true);
    try {
      await api.uploadLibraryAsset(selectedLibraryId, file);
      await loadLibraries();
      void message.success("Asset uploaded");
    } catch (error) {
      void message.error(toActionErrorMessage(error) || "Failed to upload asset");
    } finally {
      setUploadingAsset(false);
    }
  };

  const openStateImageWizard = () => {
    if (!canElementsWrite) {
      void message.warning("Insufficient permissions: elements.write");
      return;
    }
    if (!draftElement) {
      return;
    }
    setStateImageWizardOpen(true);
    setStateImageWizardName(`state_image_${(draftElement.objects.length ?? 0) + 1}`);
    setStateImageWizardTag(".State");
    const firstBinding = (draftElement.bindings ?? [])[0];
    if (firstBinding) {
      setStateImageWizardSourceMode("existingBinding");
      setStateImageWizardBindingKey(firstBinding.key);
      setStateImageWizardBindingDisplayName(firstBinding.displayName);
      setStateImageWizardBindingDataType(firstBinding.dataType ?? "INT");
    } else {
      setStateImageWizardSourceMode("newBinding");
      setStateImageWizardBindingKey(`stateBinding${(draftElement.bindings?.length ?? 0) + 1}`);
      setStateImageWizardBindingDisplayName("State binding");
      setStateImageWizardBindingDataType("INT");
    }
    setStateImageWizardWidth(90);
    setStateImageWizardHeight(56);
    setStateImageDraftRows([{ id: makeId("state"), value: "0", name: "State 0" }]);
  };

  const createStateImageFromWizard = () => {
    if (!draftElement) {
      return;
    }
    const normalizedRows = stateImageDraftRows.filter((row) => row.value.trim() !== "" && row.assetId);
    if (!normalizedRows.length) {
      void message.warning("Add at least one state with selected asset");
      return;
    }
    if (stateImageWizardSourceMode === "existingBinding") {
      const key = createBindingKey(stateImageWizardBindingKey);
      const existing = (draftElement.bindings ?? []).find((binding) => binding.key === key);
      if (!existing) {
        void message.warning(`Binding "${key}" not found`);
        return;
      }
    }
    const object = createObjectByType("stateImage") as Extract<HmiObject, { type: "stateImage" }>;
    object.name = stateImageWizardName.trim() || "state_image";
    object.width = Math.max(20, Number(stateImageWizardWidth || 90));
    object.height = Math.max(20, Number(stateImageWizardHeight || 56));
    object.states = normalizedRows.map((row) => ({
      id: row.id || makeId("state"),
      name: row.name.trim() || `State ${row.value}`,
      condition: { type: "equals", value: parseStateValue(row.value) },
      assetId: row.assetId ?? "",
    }));
    object.defaultAssetId = normalizedRows[0]?.assetId;

    updateDraftWithHistory("Add state image", (current) => {
      const currentBindings = [...(current.bindings ?? [])];
      let resolvedTag = stateImageWizardTag.trim() || ".State";

      if (stateImageWizardSourceMode === "existingBinding") {
        const key = createBindingKey(stateImageWizardBindingKey);
        resolvedTag = `$binding.${key}`;
      } else if (stateImageWizardSourceMode === "newBinding") {
        const baseKey = createBindingKey(stateImageWizardBindingKey);
        let key = baseKey;
        let suffix = 2;
        while (currentBindings.some((binding) => binding.key === key)) {
          key = `${baseKey}_${suffix}`;
          suffix += 1;
        }
        const definition: ElementBindingDefinition = {
          id: makeId("binding"),
          key,
          displayName: stateImageWizardBindingDisplayName.trim() || key,
          kind: "state",
          dataType: stateImageWizardBindingDataType,
          required: true,
          defaultBaseTag: (stateImageWizardTag.trim() || ".State"),
          overridable: true,
        };
        currentBindings.push(definition);
        resolvedTag = `$binding.${key}`;
      }

      object.tag = resolvedTag;
      const position = getInsertPosition(current, current.objects.length, object.width, object.height);
      object.x = position.x;
      object.y = position.y;

      return {
        ...current,
        bindings: currentBindings,
        objects: [...current.objects, object],
      };
    });
    setSelectedObjectIds([object.id]);
    setActiveObjectId(object.id);
    setPreviewStateTag(object.tag);
    setPreviewStateValue(normalizedRows[0]?.value ?? "0");
    setStateImageWizardOpen(false);
    void message.success("State image added");
  };

  const applyNewDraft = (next: LibraryElement, asNew: boolean) => {
    setDraftElement(next);
    setSelectedElementId(asNew ? "" : next.id);
    setDraftIsNew(asNew);
    setSelectedObjectIds([]);
    setActiveObjectId(undefined);
    setStateRulesJson(JSON.stringify(next.stateRules ?? [], null, 2));
    setPreviewValues(
      Object.fromEntries((next.parameters ?? []).map((param) => [param.name, String(param.defaultValue ?? "")])),
    );
    setDirty(true);
    history.clear();
  };

  const openNewElementDialog = (mode: CreateElementMode) => {
    const current = draftElement;
    const seed: NewElementFormValues = {
      name: current?.name || "New Element",
      elementKey: "",
      description: "",
      category: "",
      width: current?.width ?? 220,
      height: current?.height ?? 120,
      creationMode: mode,
      templateKind: "valve3",
    };
    newElementForm.setFieldsValue(seed);
    setNewElementModalOpen(true);
  };

  const createNewElement = () => {
    const values = newElementForm.getFieldsValue();
    const base = createDefaultElement({
      name: values.name || "New Element",
      elementKey: values.elementKey ?? "",
      description: values.description ?? "",
      category: values.category ?? "",
      width: Number(values.width ?? 220),
      height: Number(values.height ?? 120),
    });
    const next =
      values.creationMode === "template"
        ? createTemplateElement(base, values.templateKind ?? "valve3", selectedLibraryAssets)
        : base;
    applyNewDraft(next, true);
    setNewElementModalOpen(false);
    if (values.creationMode === "template") {
      void message.success("Template draft created");
    } else {
      void message.success("Empty element draft created");
    }
  };

  const newElement = (mode: CreateElementMode = "empty") => {
    if (dirty) {
      Modal.confirm({
        title: "Unsaved changes",
        content: "Discard current draft and create new element?",
        okText: "Discard",
        cancelText: "Cancel",
        onOk: () => openNewElementDialog(mode),
      });
      return;
    }
    openNewElementDialog(mode);
  };

  async function saveElement() {
    if (!canElementsWrite) {
      void message.warning("Insufficient permissions: elements.write");
      return;
    }
    if (!selectedLibraryId) {
      void message.warning("Select library first");
      return;
    }
    if (!draftElement) {
      return;
    }
    if (!draftElement.name.trim()) {
      void message.warning("Element name is required");
      return;
    }
    let parsedRules = draftElement.stateRules ?? [];
    try {
      parsedRules = JSON.parse(stateRulesJson) as NonNullable<LibraryElement["stateRules"]>;
    } catch {
      void message.error("State rules JSON is invalid");
      return;
    }

    const normalized: LibraryElement = {
      ...draftElement,
      id: draftElement.id?.trim() || createElementId(draftElement.name),
      elementKey: draftElement.elementKey?.trim() || createElementId(draftElement.name),
      libraryId: selectedLibraryId,
      name: draftElement.name.trim(),
      width: Math.max(20, draftElement.width),
      height: Math.max(20, draftElement.height),
      stateRules: parsedRules,
      updatedAt: new Date().toISOString(),
      createdAt: draftElement.createdAt || new Date().toISOString(),
    };

    try {
      const existing = selectedLibrary?.elements.find((item) => item.id === normalized.id);
      if (existing) {
        await api.updateLibraryElement(selectedLibraryId, normalized.id, normalized);
      } else {
        await api.createLibraryElement(selectedLibraryId, normalized);
      }
      await loadLibraries();
      setSelectedElementId(normalized.id);
      setDraftElement(normalized);
      setDraftIsNew(false);
      setDirty(false);
      void message.success("Element saved");
    } catch (error) {
      void message.error(toActionErrorMessage(error) || "Failed to save element");
      return;
    }
  }

  const deleteCurrentLibraryElement = async () => {
    // eslint-disable-next-line no-console
    console.log("[ElementEditor] deleteCurrentLibraryElement start", {
      selectedElement: selectedPersistedElement,
      draftElement,
      selectedLibraryId,
      draftIsNew,
      currentPersistedElementId,
      canElementsDelete,
    });
    if (!canElementsDelete) {
      void message.warning("Insufficient permissions: elements.delete");
      return;
    }
    if (!selectedLibraryId) {
      void message.warning("Select library first");
      return;
    }

    if (draftIsNew || !currentPersistedElementId) {
      if (!draftElement) {
        void message.warning("No element selected");
        return;
      }
      setDeleteElementDialog({
        open: true,
        mode: "discardDraft",
        libraryId: selectedLibraryId,
        elementName: draftElement.name,
      });
      return;
    }

    const selectedElement = selectedPersistedElement;
    if (!selectedElement) {
      void message.warning("Selected element is not available");
      return;
    }

    const localUsageCount = countElementUsages(project, selectedLibraryId, currentPersistedElementId);

    setDeleteElementDialog({
      open: true,
      mode: "deletePersisted",
      libraryId: selectedLibraryId,
      elementId: currentPersistedElementId,
      elementName: selectedElement.name,
      elementKey: selectedElement.elementKey,
      category: selectedElement.category,
      localUsageCount,
    });
  };

  const confirmDeleteElementDialog = async () => {
    if (!deleteElementDialog.open) {
      return;
    }

    if (deleteElementDialog.mode === "discardDraft") {
      setDraftElement(null);
      setDraftIsNew(false);
      setDirty(false);
      setSelectedObjectIds([]);
      setActiveObjectId(undefined);
      history.clear();
      setDeleteElementDialog({ open: false });
      void message.success("Draft discarded");
      return;
    }

    const deletingId = deleteElementDialog.elementId;
    if (!deletingId) {
      void message.error("Element id is empty");
      return;
    }

    const forceDeleteByUsage = (deleteElementDialog.localUsageCount ?? 0) > 0;
    const url = `/api/libraries/${encodeURIComponent(deleteElementDialog.libraryId)}/elements/${encodeURIComponent(deletingId)}`;
    // eslint-disable-next-line no-console
      console.log("[ElementEditor] sending DELETE", {
        libraryId: deleteElementDialog.libraryId,
        elementId: deletingId,
        elementKey: deleteElementDialog.elementKey,
        elementName: deleteElementDialog.elementName,
        forceDeleteByUsage,
        url,
      });

    setDeletingElement(true);
    try {
      const deleteResult = await api.deleteLibraryElement(deleteElementDialog.libraryId, deletingId, {
        force: forceDeleteByUsage,
      });
      // eslint-disable-next-line no-console
      console.log("[ElementEditor] DELETE success", { elementId: deletingId, deleteResult });
      const remainingElements = (selectedLibrary?.elements ?? []).filter((item) => item.id !== deletingId);
      const nextId = remainingElements[0]?.id ?? "";
      await loadLibraries();
      setSelectedElementId(nextId);
      setDraftElement(null);
      setDraftIsNew(false);
      setDirty(false);
      setSelectedObjectIds([]);
      setActiveObjectId(undefined);
      history.clear();
      setDeleteElementDialog({ open: false });
      if (forceDeleteByUsage) {
        void message.success(`Element deleted with instances removed: ${deleteResult.removedUsages ?? 0}`);
      } else {
        void message.success("Element deleted");
      }
    } catch (error) {
      const knownError = error as Error & {
        status?: number;
        details?: { usage?: Array<{ screenName?: string; objectId: string }> };
      };
      // eslint-disable-next-line no-console
      console.error("[ElementEditor] DELETE failed", knownError);
      if (knownError.status === 409 && Array.isArray(knownError.details?.usage)) {
        setDeleteElementDialog({ open: false });
        const lines = knownError.details.usage
          .slice(0, 12)
          .map((item, index) => `${index + 1}. ${item.screenName || "Screen"} / ${item.objectId}`);
        Modal.confirm({
          title: "Element is used in screens",
          content: (
            <div>
              <div>This element is referenced by instances:</div>
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{lines.join("\n")}</pre>
              <div style={{ marginTop: 8 }}>
                Delete element together with all listed instances from project screens?
              </div>
            </div>
          ),
          okText: "Delete With Instances",
          okButtonProps: { danger: true },
          cancelText: "Cancel",
          onOk: async () => {
            try {
              const result = await api.deleteLibraryElement(deleteElementDialog.libraryId, deletingId, { force: true });
              const nextProject = await api.getProject();
              updateProjectJson(nextProject);
              await loadLibraries();
              setSelectedElementId("");
              setDraftElement(null);
              setDraftIsNew(false);
              setDirty(false);
              setSelectedObjectIds([]);
              setActiveObjectId(undefined);
              history.clear();
              setDeleteElementDialog({ open: false });
              void message.success(`Element deleted. Removed usages: ${result.removedUsages ?? 0}`);
            } catch (forceError) {
              void message.error(toActionErrorMessage(forceError) || "Failed to force delete element");
            }
          },
        });
        return;
      }
      void message.error(toActionErrorMessage(knownError) || "Failed to delete element");
    } finally {
      setDeletingElement(false);
    }
  };

  const duplicateElement = async () => {
    if (!selectedLibraryId || !draftElement) {
      return;
    }
    const copyId = `${createElementId(draftElement.name)}-${Math.random().toString(36).slice(2, 6)}`;
    const copy: LibraryElement = {
      ...deepClone(draftElement),
      id: copyId,
      elementKey: copyId,
      name: `${draftElement.name} Copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await api.createLibraryElement(selectedLibraryId, copy);
      await loadLibraries();
      setSelectedElementId(copy.id);
      setDraftIsNew(false);
      void message.success("Element duplicated");
    } catch (error) {
      void message.error(toActionErrorMessage(error) || "Failed to duplicate element");
    }
  };

  const attachLibrary = async () => {
    if (!selectedLibraryId) {
      return;
    }
    try {
      const next = await api.attachLibrary(selectedLibraryId);
      updateProjectJson(next);
      void message.success("Library attached to project");
    } catch (error) {
      void message.error(toActionErrorMessage(error) || "Failed to attach library");
    }
  };

  const handleDropAsset = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canElementsWrite) {
      return;
    }
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/web-scada-asset");
    if (!raw) {
      return;
    }
    try {
      const payload = JSON.parse(raw) as { assetId: string };
      const sourceAsset = availableAssetMap.get(payload.assetId);
      const image = createObjectByType("image") as Extract<HmiObject, { type: "image" }>;
      image.assetId = payload.assetId;
      image.width = sourceAsset?.width ?? image.width;
      image.height = sourceAsset?.height ?? image.height;
      image.x = clamp(Math.max(0, event.nativeEvent.offsetX - image.width / 2), 0, Math.max(0, (draftElement?.width ?? image.width) - image.width));
      image.y = clamp(Math.max(0, event.nativeEvent.offsetY - image.height / 2), 0, Math.max(0, (draftElement?.height ?? image.height) - image.height));
      setObjects((prev) => [...prev, image]);
      setSelectedObjectIds([image.id]);
      setActiveObjectId(image.id);
    } catch {
      // ignore malformed payload
    }
  };

  const virtualScreen = draftElement ? createVirtualScreen(draftElement) : null;

  const activityItems = [
    { id: "elements", title: "Elements", icon: "🧩", active: true },
    { id: "assets", title: "Assets", icon: "📦" },
    { id: "states", title: "States", icon: "🔀" },
    { id: "preview", title: "Preview", icon: "▶️" },
  ];

  return (
    <div className="element-editor-workbench-page">
      <ScadaWorkbenchLayout
        autoSaveId="my-web-scada-element-editor"
        leftTitle="Elements"
        rightTitle="Properties"
        bottomTitle="Validation"
        activityItems={activityItems}
        leftPanel={{
          defaultSize: 22,
          minSize: 14,
          maxSize: 36,
          collapsible: true,
          collapsedSize: 0,
        }}
        rightPanel={{
          defaultSize: 26,
          minSize: 16,
          maxSize: 42,
          collapsible: true,
          collapsedSize: 0,
        }}
        bottomPanel={{
          defaultSize: 22,
          minSize: 10,
          maxSize: 38,
          collapsible: true,
          collapsedSize: 0,
        }}
        left={
          <div className="element-editor-side-panel">
            <WorkbenchSection title="ELEMENTS">
              <Select
                value={selectedLibraryId || undefined}
                onChange={requestSwitchLibrary}
                placeholder="Select library"
                options={libraries.map((item) => ({ label: item.name, value: item.id }))}
              />
              <div style={{ height: 4 }} />
              <input
                className="workbench-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search elements"
              />
              <div style={{ height: 4 }} />
              <select
                className="workbench-select"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                {categoryOptions.map((item) => (
                  <option key={item} value={item}>{item === "all" ? "All categories" : item}</option>
                ))}
              </select>
              <div style={{ height: 4 }} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "0 10px" }}>
                <WorkbenchButton onClick={() => newElement("empty")}>New</WorkbenchButton>
                <WorkbenchButton onClick={() => newElement("template")}>Template</WorkbenchButton>
                <WorkbenchButton onClick={() => void duplicateElement()} disabled={!draftElement}>Duplicate</WorkbenchButton>
                <WorkbenchButton
                  variant="danger"
                  onClick={() => void deleteCurrentLibraryElement()}
                  disabled={deletingElement || !draftElement}
                >
                  {draftIsNew ? "Discard" : "Delete"}
                </WorkbenchButton>
                <WorkbenchButton onClick={() => void attachLibrary()} disabled={!selectedLibraryId}>Attach</WorkbenchButton>
              </div>
            </WorkbenchSection>
            <WorkbenchSection title="ELEMENT LIST">
              {displayElements.map((item) => (
                <WorkbenchTreeItem
                  key={item.id}
                  active={item.isDraft ? draftIsNew : selectedElementId === item.id}
                  onClick={() => {
                    if (item.isDraft) {
                      setDraftIsNew(true);
                      setSelectedElementId("");
                      return;
                    }
                    if (dirty) {
                      Modal.confirm({
                        title: "Unsaved changes",
                        content: "Save current element before switching?",
                        okText: "Save and switch",
                        cancelText: "Discard",
                        onOk: async () => {
                          await saveElement();
                          setSelectedElementId(item.id);
                          setDraftIsNew(false);
                        },
                        onCancel: () => {
                          setDirty(false);
                          setSelectedElementId(item.id);
                          setDraftIsNew(false);
                        },
                      });
                      return;
                    }
                    setSelectedElementId(item.id);
                    setDraftIsNew(false);
                  }}
                >
                  {item.name}
                </WorkbenchTreeItem>
              ))}
            </WorkbenchSection>
          </div>
        }
        center={
          <div className="element-editor-center">
            <WorkbenchTabs
              items={[
                {
                  id: "element",
                  title: draftElement ? draftElement.name : "Element",
                  active: true,
                  dirty: dirty,
                },
              ]}
            />
            <WorkbenchPanelToolbar
              left={
                <>
                  <WorkbenchButton
                    onClick={() => {
                      if (!draftElement) { return; }
                      const previous = history.undo(draftElement);
                      if (previous) { setDraftElement(previous); setDirty(true); }
                    }}
                    disabled={!draftElement || !history.canUndo}
                  >
                    ↩
                  </WorkbenchButton>
                  <WorkbenchButton
                    onClick={() => {
                      if (!draftElement) { return; }
                      const next = history.redo(draftElement);
                      if (next) { setDraftElement(next); setDirty(true); }
                    }}
                    disabled={!draftElement || !history.canRedo}
                  >
                    ↪
                  </WorkbenchButton>
                  <WorkbenchButton
                    variant="primary"
                    onClick={() => void saveElement()}
                    disabled={!draftElement || !canElementsWrite}
                  >
                    Save
                  </WorkbenchButton>
                </>
              }
              center={
                <>
                  <Switch checked={previewMode} onChange={setPreviewMode} checkedChildren="Preview" unCheckedChildren="Edit" />
                  <Typography.Text type={dirty ? "warning" : "secondary"} style={{ fontSize: 12, color: dirty ? "#d7ba7d" : "#969696" }}>
                    {dirty ? "Unsaved" : "Saved"}
                  </Typography.Text>
                </>
              }
              right={
                <>
                  <WorkbenchButton onClick={() => addObject("text")} disabled={!draftElement || !canElementsWrite}>Text</WorkbenchButton>
                  <WorkbenchButton onClick={() => addObject("line")} disabled={!draftElement || !canElementsWrite}>Line</WorkbenchButton>
                  <WorkbenchButton onClick={() => addObject("rectangle")} disabled={!draftElement || !canElementsWrite}>Rect</WorkbenchButton>
                  <WorkbenchButton onClick={() => addPrimitiveShape("square")} disabled={!draftElement || !canElementsWrite}>Square</WorkbenchButton>
                  <WorkbenchButton onClick={() => addPrimitiveShape("circle")} disabled={!draftElement || !canElementsWrite}>Circle</WorkbenchButton>
                  <WorkbenchButton onClick={() => addPrimitiveShape("triangle")} disabled={!draftElement || !canElementsWrite}>Triangle</WorkbenchButton>
                  <WorkbenchButton onClick={() => addObject("state-indicator")} disabled={!draftElement || !canElementsWrite}>Indicator</WorkbenchButton>
                  <WorkbenchButton onClick={() => openAssetPicker()} disabled={!draftElement || !canElementsWrite}>Add Image</WorkbenchButton>
                  <WorkbenchButton onClick={() => openStateImageWizard()} disabled={!draftElement || !canElementsWrite}>Add State Image</WorkbenchButton>
                </>
              }
            />
            <div
              className="element-editor-canvas-host"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDropAsset}
            >
              {virtualScreen ? (
                <HmiStage
                  project={elementEditorProject ?? project}
                  mode={previewMode ? "runtime" : "editor"}
                  screen={virtualScreen}
                  tags={previewTags}
                  libraries={libraries}
                  renderContext={{ tagPrefix: previewTagPrefix || undefined, parameters: previewParameters }}
                  selectedObjectIds={selectedObjectIds}
                  activeObjectId={activeObjectId}
                  selectionRect={selectionRect}
                  onSelectionRectChange={(rect) => setSelectionRect(rect)}
                  onSelectObject={({ objectId, additive }) => {
                    if (previewMode) { return; }
                    if (additive) {
                      setSelectedObjectIds((prev) =>
                        prev.includes(objectId) ? prev.filter((id) => id !== objectId) : [...prev, objectId],
                      );
                      setActiveObjectId(objectId);
                    } else {
                      setSelectedObjectIds([objectId]);
                      setActiveObjectId(objectId);
                    }
                  }}
                  onSelectObjects={(ids, active) => {
                    if (previewMode) { return; }
                    setSelectedObjectIds(ids);
                    setActiveObjectId(active);
                  }}
                  onMoveObject={(id, x, y) => {
                    if (previewMode) { return; }
                    setObjects((objects) => updateObjectInList(objects, id, (item) => ({ ...item, x, y })));
                  }}
                  onResizeObject={(id, patch) => {
                    if (previewMode) { return; }
                    setObjects((objects) =>
                      updateObjectInList(objects, id, (item) => ({ ...item, ...patch } as HmiObject)),
                    );
                  }}
                  onContextMenuObject={({ objectId }) => {
                    if (previewMode) { return; }
                    const object = findObjectById(objectId);
                    if (object?.type === "image" || object?.type === "stateImage") {
                      setSelectedObjectIds([objectId]);
                      setActiveObjectId(objectId);
                      openAssetPicker(objectId);
                    }
                  }}
                />
              ) : (
                <Typography.Text type="secondary">Create or open element to start editing</Typography.Text>
              )}
            </div>
          </div>
        }
        right={
          <div className="element-editor-inspector">
            <Tabs
              size="small"
              style={{ height: "100%" }}
              items={[
              {
                key: "element",
                label: "Element",
                children: draftElement ? (
                  <Form layout="vertical" size="small">
                    <Form.Item label="Element ID">
                      <Input value={draftElement.id} onChange={(event) => applyDraftPatch({ id: event.target.value })} />
                    </Form.Item>
                    <Form.Item label="Element Key">
                      <Input value={draftElement.elementKey ?? ""} onChange={(event) => applyDraftPatch({ elementKey: event.target.value })} />
                    </Form.Item>
                    <Form.Item label="Name">
                      <Input value={draftElement.name} onChange={(event) => applyDraftPatch({ name: event.target.value })} />
                    </Form.Item>
                    <Form.Item label="Description">
                      <Input value={draftElement.description ?? ""} onChange={(event) => applyDraftPatch({ description: event.target.value })} />
                    </Form.Item>
                    <Form.Item label="Category">
                      <Input value={draftElement.category ?? ""} onChange={(event) => applyDraftPatch({ category: event.target.value })} />
                    </Form.Item>
                    <Space style={{ width: "100%" }} direction="vertical">
                      <Typography.Text strong>Canvas size</Typography.Text>
                      <Space>
                        <InputNumber min={20} value={draftElement.width} onChange={(value) => applyDraftPatch({ width: Number(value ?? 20) })} />
                        <InputNumber min={20} value={draftElement.height} onChange={(value) => applyDraftPatch({ height: Number(value ?? 20) })} />
                      </Space>
                    </Space>
                    <Divider />
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Typography.Text strong>Parameters</Typography.Text>
                      <Space wrap>
                        <Button
                          size="small"
                          onClick={() => {
                            const next: LibraryParameter = { name: `param_${(draftElement.parameters?.length ?? 0) + 1}`, type: "string", defaultValue: "" };
                            applyDraftPatch({ parameters: [...(draftElement.parameters ?? []), next] });
                          }}
                        >
                          Add Parameter
                        </Button>
                      </Space>
                      <List
                        size="small"
                        dataSource={draftElement.parameters ?? []}
                        renderItem={(param, index) => (
                          <List.Item
                            actions={[
                              <Button
                                key="remove"
                                size="small"
                                danger
                                onClick={() =>
                                  applyDraftPatch({
                                    parameters: (draftElement.parameters ?? []).filter((_, i) => i !== index),
                                  })
                                }
                              >
                                Del
                              </Button>,
                            ]}
                          >
                            <Space direction="vertical" style={{ width: "100%" }}>
                              <Input
                                value={param.name}
                                placeholder="name"
                                onChange={(event) => {
                                  const next = [...(draftElement.parameters ?? [])];
                                  const current = next[index];
                                  if (!current) { return; }
                                  next[index] = { ...current, name: event.target.value };
                                  applyDraftPatch({ parameters: next });
                                }}
                              />
                              <Select
                                value={param.type}
                                options={["string", "number", "boolean", "color", "tag", "tagPrefix", "index"].map((type) => ({
                                  label: type,
                                  value: type,
                                }))}
                                onChange={(value) => {
                                  const next = [...(draftElement.parameters ?? [])];
                                  const current = next[index];
                                  if (!current) { return; }
                                  next[index] = { ...current, type: value };
                                  applyDraftPatch({ parameters: next });
                                }}
                              />
                              <Input
                                value={String(param.defaultValue ?? "")}
                                placeholder="default"
                                onChange={(event) => {
                                  const next = [...(draftElement.parameters ?? [])];
                                  const current = next[index];
                                  if (!current) { return; }
                                  next[index] = { ...current, defaultValue: event.target.value };
                                  applyDraftPatch({ parameters: next });
                                }}
                              />
                            </Space>
                          </List.Item>
                        )}
                      />
                    </Space>
                  </Form>
                ) : (
                  <Typography.Text type="secondary">Select element</Typography.Text>
                ),
              },
              {
                key: "bindings",
                label: "Bindings",
                children: draftElement ? (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Typography.Text type="secondary">
                      Define external connection points used by objects via <code>$binding.key</code>.
                    </Typography.Text>
                    <Button
                      size="small"
                      onClick={() => {
                        const nextIndex = (draftElement.bindings?.length ?? 0) + 1;
                        const nextBinding: ElementBindingDefinition = {
                          id: makeId("binding"),
                          key: `binding${nextIndex}`,
                          displayName: `Binding ${nextIndex}`,
                          kind: "state",
                          dataType: "INT",
                          required: true,
                          defaultBaseTag: ".State",
                          overridable: true,
                        };
                        applyDraftPatch({ bindings: [...(draftElement.bindings ?? []), nextBinding] });
                      }}
                    >
                      Add Binding
                    </Button>
                    <List
                      size="small"
                      dataSource={draftElement.bindings ?? []}
                      locale={{ emptyText: "No bindings. Add binding and reference it from StateImage tag as $binding.key" }}
                      renderItem={(binding, index) => (
                        <List.Item
                          actions={[
                            <Button
                              key="delete"
                              danger
                              size="small"
                              onClick={() =>
                                applyDraftPatch({
                                  bindings: (draftElement.bindings ?? []).filter((_, itemIndex) => itemIndex !== index),
                                })
                              }
                            >
                              Delete
                            </Button>,
                          ]}
                        >
                          <Space direction="vertical" style={{ width: "100%" }}>
                            <Input
                              addonBefore="Key"
                              value={binding.key}
                              onChange={(event) => {
                                const next = [...(draftElement.bindings ?? [])];
                                const current = next[index];
                                if (!current) { return; }
                                next[index] = { ...current, key: createBindingKey(event.target.value) };
                                applyDraftPatch({ bindings: next });
                              }}
                            />
                            <Input
                              addonBefore="Name"
                              value={binding.displayName}
                              onChange={(event) => {
                                const next = [...(draftElement.bindings ?? [])];
                                const current = next[index];
                                if (!current) { return; }
                                next[index] = { ...current, displayName: event.target.value };
                                applyDraftPatch({ bindings: next });
                              }}
                            />
                            <Select
                              value={binding.kind}
                              options={[
                                { label: "State / Read Tag", value: "state" },
                                { label: "Write Tag", value: "writeTag" },
                                { label: "Command", value: "command" },
                                { label: "Custom", value: "custom" },
                                { label: "Tag", value: "tag" },
                              ]}
                              onChange={(value) => {
                                const next = [...(draftElement.bindings ?? [])];
                                const current = next[index];
                                if (!current) { return; }
                                next[index] = { ...current, kind: value };
                                applyDraftPatch({ bindings: next });
                              }}
                            />
                            <Input
                              addonBefore="Default Tag"
                              value={binding.defaultBaseTag ?? ""}
                              onChange={(event) => {
                                const next = [...(draftElement.bindings ?? [])];
                                const current = next[index];
                                if (!current) { return; }
                                next[index] = { ...current, defaultBaseTag: event.target.value };
                                applyDraftPatch({ bindings: next });
                              }}
                            />
                            <Space>
                              <Switch
                                checked={binding.required}
                                onChange={(checked) => {
                                  const next = [...(draftElement.bindings ?? [])];
                                  const current = next[index];
                                  if (!current) { return; }
                                  next[index] = { ...current, required: checked };
                                  applyDraftPatch({ bindings: next });
                                }}
                              />
                              <Typography.Text>Required</Typography.Text>
                            </Space>
                            <Space>
                              <Switch
                                checked={binding.overridable}
                                onChange={(checked) => {
                                  const next = [...(draftElement.bindings ?? [])];
                                  const current = next[index];
                                  if (!current) { return; }
                                  next[index] = { ...current, overridable: checked };
                                  applyDraftPatch({ bindings: next });
                                }}
                              />
                              <Typography.Text>Overridable</Typography.Text>
                            </Space>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Space>
                ) : (
                  <Typography.Text type="secondary">Select element</Typography.Text>
                ),
              },
              {
                key: "object",
                label: "Object",
                children: draftElement && activeObject ? (
                  <ObjectPropertyPanel
                    project={project}
                    screen={virtualScreen!}
                    assets={availableAssets}
                    libraries={libraries}
                    object={activeObject}
                    elementBindings={draftElement?.bindings ?? []}
                    onPatch={(patch) => {
                      if (!activeObject) { return; }
                      setObjects((objects) =>
                        updateObjectInList(objects, activeObject.id, (item) => ({ ...item, ...patch } as HmiObject)),
                      );
                    }}
                    onPatchObjectById={(objectId, patch) => {
                      setObjects((objects) =>
                        updateObjectInList(objects, objectId, (item) => ({ ...item, ...patch } as HmiObject)),
                      );
                    }}
                    onDelete={() => {
                      deleteSelectedElementObjects("properties");
                    }}
                  />
                ) : (
                  <Typography.Text type="secondary">Select an object on canvas</Typography.Text>
                ),
              },
              {
                key: "stateRules",
                label: "State Rules",
                children: draftElement ? (
                  <StateRulesEditor
                    stateRules={draftElement.stateRules ?? []}
                    objects={draftElement.objects}
                    bindings={draftElement.bindings ?? []}
                    assets={availableAssets}
                    onChange={(next) => {
                      applyDraftPatch({ stateRules: next });
                    }}
                  />
                ) : (
                  <Typography.Text type="secondary">Select element</Typography.Text>
                ),
              },
              {
                key: "preview",
                label: "Preview",
                children: draftElement ? (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Typography.Text strong>Preview Parameters</Typography.Text>
                    <Typography.Text type="secondary">
                      Override parameters to preview element with custom values.
                    </Typography.Text>
                    {(draftElement.parameters ?? []).map((param) => (
                      <Form.Item key={param.name} label={param.displayName || param.name} style={{ marginBottom: 8 }}>
                        <Input
                          value={previewValues[param.name] ?? ""}
                          onChange={(event) =>
                            setPreviewValues((prev) => ({ ...prev, [param.name]: event.target.value }))
                          }
                        />
                      </Form.Item>
                    ))}
                  </Space>
                ) : (
                  <Typography.Text type="secondary">Select element</Typography.Text>
                ),
              },
              ]}
            />
          </div>
        }
        bottom={
          <div className="element-editor-bottom-panel">
            <div>[info] Element Editor migrated to Workbench layout</div>
            <div>[info] Drag panel borders to resize layout</div>
            <div>[info] Layout is saved with autoSaveId=my-web-scada-element-editor</div>
            {draftElement ? (
              <>
                <div>[object] Selected: {activeObjectId || "none"}</div>
                <div>[object] Objects count: {draftElement.objects.length}</div>
              </>
            ) : null}
            <div>[state] {dirty ? "Unsaved changes" : "All changes saved"}</div>
          </div>
        }
      />

      <Modal
        open={deleteElementDialog.open}
        title={deleteElementDialog.open && deleteElementDialog.mode === "discardDraft" ? "Discard unsaved draft" : "Delete element"}
        onCancel={() => setDeleteElementDialog({ open: false })}
        onOk={() => void confirmDeleteElementDialog()}
        okText={
          deleteElementDialog.open && deleteElementDialog.mode === "discardDraft"
            ? "Discard"
            : deleteDialogUsageCount > 0
              ? "Delete With Instances"
              : "Delete"
        }
        okButtonProps={{ danger: true, loading: deletingElement }}
        cancelText="Cancel"
        zIndex={5000}
      >
        {deleteElementDialog.open && deleteElementDialog.mode === "discardDraft" ? (
          <Typography.Text>
            Discard unsaved element "{deleteElementDialog.elementName}"?
          </Typography.Text>
        ) : deleteElementDialog.open ? (
          <div>
            <div>Name: {deleteElementDialog.elementName}</div>
            <div>Element Key: {deleteElementDialog.elementKey || "-"}</div>
            <div>Library: {selectedLibrary?.name ?? deleteElementDialog.libraryId}</div>
            <div>Category: {deleteElementDialog.category || "-"}</div>
            <div>Current local usage count: {deleteDialogUsageCount}</div>
            <div style={{ marginTop: 8 }}>
              {deleteDialogUsageCount > 0
                ? "Element is used in screens. You can delete it together with all instances."
                : "Delete this element permanently?"}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        title="Create Element"
        open={newElementModalOpen}
        onCancel={() => setNewElementModalOpen(false)}
        onOk={createNewElement}
        okText="Create"
      >
        <Form form={newElementForm} layout="vertical" size="small">
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Name is required" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="elementKey" label="Element Key">
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input />
          </Form.Item>
          <Form.Item name="category" label="Category">
            <Input />
          </Form.Item>
          <Space style={{ width: "100%" }}>
            <Form.Item name="width" label="Canvas Width" style={{ flex: 1 }}>
              <InputNumber min={20} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="height" label="Canvas Height" style={{ flex: 1 }}>
              <InputNumber min={20} style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Form.Item name="creationMode" label="Creation Mode">
            <Select
              options={[
                { label: "Empty", value: "empty" },
                { label: "From Template", value: "template" },
              ]}
            />
          </Form.Item>
          {creationMode === "template" ? (
            <Form.Item name="templateKind" label="Template">
              <Select
                options={[
                  { label: "Valve 3 States", value: "valve3" },
                  { label: "Pump", value: "pump" },
                  { label: "Indicator", value: "indicator" },
                  { label: "Button", value: "button" },
                  { label: "Custom template", value: "custom" },
                ]}
              />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>

      <Modal
        title={assetPickerTargetObjectId ? "Replace image" : "Add image"}
        open={assetPickerOpen}
        onCancel={() => {
          setAssetPickerOpen(false);
          setAssetPickerTargetObjectId(undefined);
        }}
        footer={null}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Button onClick={() => uploadInputRef.current?.click()} loading={uploadingAsset} disabled={!selectedLibraryId}>
            Upload Asset
          </Button>
          <List
            size="small"
            dataSource={availableAssets}
            locale={{ emptyText: "No assets in this library. Upload image first." }}
            renderItem={(asset) => (
              <List.Item
                actions={[
                  <Button key="use" size="small" type="primary" onClick={() => addImageFromAsset(asset.id, assetPickerTargetObjectId)}>
                    {assetPickerTargetObjectId ? "Replace" : "Add"}
                  </Button>,
                  !assetPickerTargetObjectId && asset.type === "svg" ? (
                    <Button key="import-svg" size="small" onClick={() => void addSvgPrimitivesFromAsset(asset)}>
                      Add SVG Primitives
                    </Button>
                  ) : null,
                ]}
              >
                <Space direction="vertical" size={0}>
                  <Typography.Text>{asset.name}</Typography.Text>
                  <Typography.Text type="secondary">{asset.fileName}</Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        </Space>
      </Modal>

      <Modal
        title="Add State Image"
        open={stateImageWizardOpen}
        onCancel={() => setStateImageWizardOpen(false)}
        onOk={createStateImageFromWizard}
        okText="Create"
        width={780}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Form layout="vertical" size="small">
            <Form.Item label="Object name">
              <Input value={stateImageWizardName} onChange={(event) => setStateImageWizardName(event.target.value)} />
            </Form.Item>
            <Form.Item label="Source">
              <Select
                value={stateImageWizardSourceMode}
                options={[
                  { label: "Manual tag", value: "manualTag" },
                  { label: "Existing binding", value: "existingBinding" },
                  { label: "New binding", value: "newBinding" },
                ]}
                onChange={(value) => setStateImageWizardSourceMode(value as StateImageSourceMode)}
              />
            </Form.Item>
            {stateImageWizardSourceMode === "existingBinding" ? (
              <Form.Item label="Binding key">
                <Select
                  value={stateImageWizardBindingKey}
                  options={(draftElement?.bindings ?? []).map((binding) => ({
                    label: `${binding.displayName} (${binding.key})`,
                    value: binding.key,
                  }))}
                  onChange={setStateImageWizardBindingKey}
                />
              </Form.Item>
            ) : null}
            {stateImageWizardSourceMode === "newBinding" ? (
              <>
                <Form.Item label="Binding key">
                  <Input value={stateImageWizardBindingKey} onChange={(event) => setStateImageWizardBindingKey(event.target.value)} />
                </Form.Item>
                <Form.Item label="Binding name">
                  <Input value={stateImageWizardBindingDisplayName} onChange={(event) => setStateImageWizardBindingDisplayName(event.target.value)} />
                </Form.Item>
                <Form.Item label="Binding data type">
                  <Select
                    value={stateImageWizardBindingDataType}
                    options={["BOOL", "INT", "UINT", "DINT", "UDINT", "REAL", "STRING"].map((item) => ({ label: item, value: item }))}
                    onChange={(value) =>
                      setStateImageWizardBindingDataType(value as "BOOL" | "INT" | "UINT" | "DINT" | "UDINT" | "REAL" | "STRING")
                    }
                  />
                </Form.Item>
              </>
            ) : null}
            <Form.Item label="Source tag">
              <Input value={stateImageWizardTag} onChange={(event) => setStateImageWizardTag(event.target.value)} placeholder=".State" />
            </Form.Item>
            <Space style={{ width: "100%" }}>
              <Form.Item label="Width" style={{ flex: 1 }}>
                <InputNumber min={20} style={{ width: "100%" }} value={stateImageWizardWidth} onChange={(value) => setStateImageWizardWidth(Number(value ?? 90))} />
              </Form.Item>
              <Form.Item label="Height" style={{ flex: 1 }}>
                <InputNumber min={20} style={{ width: "100%" }} value={stateImageWizardHeight} onChange={(value) => setStateImageWizardHeight(Number(value ?? 56))} />
              </Form.Item>
            </Space>
          </Form>
          <Button
            onClick={() =>
              setStateImageDraftRows((prev) => [...prev, { id: makeId("state"), value: String(prev.length), name: `State ${prev.length}` }])
            }
          >
            Add State
          </Button>
          <List
            size="small"
            dataSource={stateImageDraftRows}
            renderItem={(row) => (
              <List.Item
                actions={[
                  <Button key="del" danger size="small" onClick={() => setStateImageDraftRows((prev) => prev.filter((item) => item.id !== row.id))}>
                    Delete
                  </Button>,
                ]}
              >
                <Space wrap style={{ width: "100%" }}>
                  <Input
                    style={{ width: 110 }}
                    placeholder="Value"
                    value={row.value}
                    onChange={(event) =>
                      setStateImageDraftRows((prev) =>
                        prev.map((item) => (item.id === row.id ? { ...item, value: event.target.value } : item)),
                      )
                    }
                  />
                  <Input
                    style={{ width: 170 }}
                    placeholder="State name"
                    value={row.name}
                    onChange={(event) =>
                      setStateImageDraftRows((prev) =>
                        prev.map((item) => (item.id === row.id ? { ...item, name: event.target.value } : item)),
                      )
                    }
                  />
                  <Select
                    style={{ minWidth: 260 }}
                    value={row.assetId}
                    placeholder="Select asset"
                    options={availableAssets.map((asset) => ({ label: asset.name, value: asset.id }))}
                    onChange={(value) =>
                      setStateImageDraftRows((prev) =>
                        prev.map((item) => (item.id === row.id ? { ...item, assetId: value } : item)),
                      )
                    }
                  />
                </Space>
              </List.Item>
            )}
          />
        </Space>
      </Modal>

      <input
        ref={uploadInputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (!file) { return; }
          void uploadAssetToLibrary(file);
        }}
      />
    </div>
  );
}
