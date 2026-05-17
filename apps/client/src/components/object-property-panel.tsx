import { useEffect, useState } from "react";
import { ACCESS_ROLE_LABELS_RU } from "@web-scada/shared";
import type {
  AccessRoleLevel,
  AppRole,
  Asset,
  CheckboxWriteMode,
  ElementBindingDefinition,
  ElementLibrary,
  HmiObject,
  IndexedTagAddress,
  HmiScreen,
  RuntimeAction,
  RuntimeResolveContext,
  ScadaProject,
  TextStyle,
} from "@web-scada/shared";
import {
  extractIndexedAddressSlots,
  resolveIndexedAddress,
  resolveLibraryElementInstanceBindingsDetailed,
} from "@web-scada/shared";
import { Button, ColorPicker, Divider, Form, Input, InputNumber, Select, Space, Switch, Tabs, Tag, Typography } from "antd";
import { TagPicker } from "./tag-picker";
import { IndexedAddressEditorWindow } from "./indexed-address-editor-window";
import { getAssetDisplayPath } from "../utils/asset-path";
import {
  buildIndexedAddressRuntimeValues,
  findTagByAddress,
  getObjectIndexedConfigForField,
  getTagAddressTemplate,
  resolveObjectTagField,
} from "../hmi/tags/indexed-address";

type Props = {
  project: ScadaProject;
  screen: HmiScreen;
  assets: Asset[];
  libraries: ElementLibrary[];
  object: HmiObject | null;
  elementBindings?: ElementBindingDefinition[];
  onPatch: (patch: Partial<HmiObject>) => void;
  onPatchObjectById?: (objectId: string, patch: Partial<HmiObject>) => void;
  onDelete: () => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
  onMoveForward?: () => void;
  onMoveBackward?: () => void;
};

type GroupEditableOption = {
  key: string;
  value: string;
  object: HmiObject;
  depth: number;
  label: string;
  isRoot: boolean;
};

const fontOptions = ["Arial", "Tahoma", "Verdana", "Consolas", "Segoe UI", "Roboto", "Noto Sans"];
const gradientDirectionOptions = [
  { label: "horizontal", value: "horizontal" },
  { label: "vertical", value: "vertical" },
  { label: "diagonal", value: "diagonal" },
  { label: "center-outward", value: "center-outward" },
  { label: "outside-inward", value: "outside-inward" },
] as const;
const shadowDirectionOptions = [
  { label: "right", value: "right" },
  { label: "left", value: "left" },
  { label: "top", value: "top" },
  { label: "bottom", value: "bottom" },
  { label: "top-left", value: "top-left" },
  { label: "top-right", value: "top-right" },
  { label: "bottom-left", value: "bottom-left" },
  { label: "bottom-right", value: "bottom-right" },
] as const;
const roleOptions: Array<{ label: string; value: AppRole }> = [
  { label: "admin", value: "admin" },
  { label: "engineer", value: "engineer" },
  { label: "operator", value: "operator" },
  { label: "viewer", value: "viewer" },
];
const accessRoleOptions: Array<{ label: string; value: AccessRoleLevel }> = [
  { label: `0 - ${ACCESS_ROLE_LABELS_RU[0]}`, value: 0 },
  { label: `1 - ${ACCESS_ROLE_LABELS_RU[1]}`, value: 1 },
  { label: `2 - ${ACCESS_ROLE_LABELS_RU[2]}`, value: 2 },
  { label: `3 - ${ACCESS_ROLE_LABELS_RU[3]}`, value: 3 },
  { label: `4 - ${ACCESS_ROLE_LABELS_RU[4]}`, value: 4 },
];

function getBindingKindLabel(kind: ElementBindingDefinition["kind"] | undefined): string {
  if (kind === "writeTag") {
    return "Write Tag";
  }
  if (kind === "command") {
    return "Command";
  }
  if (kind === "custom") {
    return "Custom";
  }
  return "State / Read Tag";
}

function getBindingTagLabel(kind: ElementBindingDefinition["kind"] | undefined): string {
  if (kind === "writeTag") {
    return "Write Tag";
  }
  if (kind === "command") {
    return "Command Tag";
  }
  if (kind === "custom") {
    return "Custom Tag";
  }
  return "State / Read Tag";
}

function ColorField({
  label,
  value,
  fallback = "#1677ff",
  disabled = false,
  onChange,
}: {
  label: string;
  value: string | undefined;
  fallback?: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const pickerValue = normalizePickerColor(value, fallback);
  return (
    <Form.Item label={label}>
      <Space.Compact style={{ width: "100%" }}>
        <ColorPicker
          value={pickerValue}
          disabled={disabled}
          onChangeComplete={(color) => onChange(color.toHexString())}
        />
        <Input
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={fallback}
        />
      </Space.Compact>
    </Form.Item>
  );
}

function GradientTabContent({
  enabled,
  direction,
  startColor,
  endColor,
  startFallback,
  endFallback,
  onPatch,
}: {
  enabled: boolean;
  direction: string | undefined;
  startColor: string | undefined;
  endColor: string | undefined;
  startFallback: string;
  endFallback: string;
  onPatch: (patch: Partial<HmiObject>) => void;
}) {
  return (
    <>
      <Space>
        <span>Enable Gradient</span>
        <Switch checked={enabled} onChange={(checked) => onPatch({ gradientEnabled: checked } as Partial<HmiObject>)} />
      </Space>
      <Form.Item label="Gradient Direction">
        <Select
          value={direction ?? "horizontal"}
          options={gradientDirectionOptions.map((item) => ({ label: item.label, value: item.value }))}
          onChange={(value) => onPatch({ gradientDirection: value } as Partial<HmiObject>)}
        />
      </Form.Item>
      <ColorField
        label="Gradient Start"
        value={startColor}
        fallback={startFallback}
        disabled={!enabled}
        onChange={(next) => onPatch({ gradientStartColor: next } as Partial<HmiObject>)}
      />
      <ColorField
        label="Gradient End"
        value={endColor}
        fallback={endFallback}
        disabled={!enabled}
        onChange={(next) => onPatch({ gradientEndColor: next } as Partial<HmiObject>)}
      />
    </>
  );
}

function optionsToMultilineText(options: Array<{ label: string; value: string | number | boolean }> | undefined): string {
  return (options ?? []).map((item) => `${item.label}|${String(item.value)}`).join("\n");
}

function parseOptionsMultiline(
  rawText: string,
): Array<{ label: string; value: string | number | boolean }> {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.map((line, index) => {
    const [labelToken, valueToken] = line.split("|");
    const label = (labelToken ?? `Option ${index + 1}`).trim();
    const rawValue = (valueToken ?? label).trim();
    let parsed: string | number | boolean = rawValue;
    const asNumber = Number(rawValue);
    if (rawValue !== "" && Number.isFinite(asNumber) && !rawValue.startsWith("0x")) {
      parsed = asNumber;
    }
    if (rawValue.toLowerCase() === "true") {
      parsed = true;
    }
    if (rawValue.toLowerCase() === "false") {
      parsed = false;
    }
    return { label, value: parsed };
  });
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
  if (trimmed !== "" && Number.isFinite(asNumber) && !trimmed.startsWith("0x")) {
    return asNumber;
  }
  return trimmed;
}

function scalarToText(value: string | number | boolean | undefined): string {
  if (value === undefined) {
    return "";
  }
  return String(value);
}

function extractBindingKey(tag: string | undefined): string | undefined {
  if (!tag || !tag.startsWith("$binding.")) {
    return undefined;
  }
  const key = tag.slice("$binding.".length).trim();
  return key || undefined;
}

function BindingQuickSelect({
  bindings,
  value,
  label = "Binding Source",
  onChange,
}: {
  bindings: ElementBindingDefinition[];
  value: string | undefined;
  label?: string;
  onChange: (nextValue: string) => void;
}) {
  if (!bindings.length) {
    return null;
  }
  const selectedBindingKey = extractBindingKey(value);
  return (
    <Form.Item label={label}>
      <Select
        value={selectedBindingKey ? `binding:${selectedBindingKey}` : "manual"}
        options={[
          { label: "Manual tag", value: "manual" },
          ...bindings.map((binding) => ({
            label: `${binding.displayName} (${binding.key})`,
            value: `binding:${binding.key}`,
          })),
        ]}
        onChange={(nextValue) => {
          if (nextValue === "manual") {
            if (selectedBindingKey) {
              onChange("");
            }
            return;
          }
          if (nextValue.startsWith("binding:")) {
            const bindingKey = nextValue.slice("binding:".length);
            onChange(`$binding.${bindingKey}`);
          }
        }}
      />
    </Form.Item>
  );
}

function TagFieldWithBindingSource({
  project,
  bindings,
  value,
  bindingLabel = "Binding Source",
  tagLabel = "Tag",
  indexControl,
  onChange,
}: {
  project: ScadaProject;
  bindings: ElementBindingDefinition[];
  value: string | undefined;
  bindingLabel?: string;
  tagLabel?: string;
  indexControl?: {
    enabled: boolean;
    status: string;
    configureDisabled?: boolean;
    onConfigure: () => void;
    onToggleEnabled: (checked: boolean) => void;
  };
  onChange: (nextValue: string) => void;
}) {
  return (
    <>
      <BindingQuickSelect bindings={bindings} value={value} label={bindingLabel} onChange={onChange} />
      <Form.Item label={tagLabel}>
        <div className="tag-field-with-indexing">
          <div className="tag-field-with-indexing__input">
            {extractBindingKey(value) ? (
              <Input value={value} onChange={(event) => onChange(event.target.value)} />
            ) : (
              <TagPicker project={project} value={value ?? ""} onChange={(tag) => onChange(tag ?? "")} />
            )}
          </div>
          {indexControl ? (
            <button
              type="button"
              className="workbench-button"
              onClick={indexControl.onConfigure}
              disabled={indexControl.configureDisabled}
            >
              <span className="workbench-button__label"># Indexes</span>
            </button>
          ) : null}
        </div>
        {indexControl ? (
          <div className="tag-field-with-indexing__meta">
            <Space size={6}>
              <span>Indexed</span>
              <Switch size="small" checked={indexControl.enabled} onChange={indexControl.onToggleEnabled} />
              <Tag color={indexControl.status === "OK" ? "green" : indexControl.status === "Not found" ? "gold" : "default"}>
                {indexControl.status}
              </Tag>
              {indexControl.configureDisabled ? (
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  Select tag first
                </Typography.Text>
              ) : null}
            </Space>
          </div>
        ) : null}
      </Form.Item>
    </>
  );
}

function buildEditorRuntimeTagValues(project: ScadaProject): Record<string, unknown> {
  const tagValues: Record<string, unknown> = {};
  for (const variable of project.variables ?? []) {
    const value = variable.currentValue ?? variable.initialValue ?? null;
    const normalized = variable.name.startsWith("LW.") ? variable.name : `LW.${variable.name}`;
    tagValues[normalized] = value;
    if (typeof variable.lwAddress === "number" && Number.isFinite(variable.lwAddress)) {
      tagValues[`LW${Math.max(0, Math.floor(variable.lwAddress))}`] = value;
    }
  }
  for (const [key, value] of Object.entries(project.lwStore?.values ?? {})) {
    const address = Number(key);
    if (Number.isFinite(address)) {
      tagValues[`LW${Math.max(0, Math.floor(address))}`] = value;
    }
  }
  return tagValues;
}

function ActionAccessFields({
  action,
  onChange,
}: {
  action: RuntimeAction | undefined;
  onChange: (nextAction: RuntimeAction) => void;
}) {
  if (!action) {
    return null;
  }
  return (
    <>
      <Form.Item label="Action Access Roles">
        <Select
          mode="multiple"
          allowClear
          value={action.requiredRoles ?? []}
          options={roleOptions}
          placeholder="empty = everyone"
          onChange={(value) => onChange({ ...action, requiredRoles: value as AppRole[] })}
        />
      </Form.Item>
      <Space style={{ marginBottom: 8 }}>
        <span>Action requires auth</span>
        <Switch checked={action.requireAuth ?? false} onChange={(checked) => onChange({ ...action, requireAuth: checked })} />
      </Space>
    </>
  );
}

function objectTypeLabel(type: HmiObject["type"]): string {
  switch (type) {
    case "stateImage":
      return "StateImage";
    case "libraryElementInstance":
      return "LibraryElementInstance";
    case "value-display":
      return "ValueDisplay";
    case "value-input":
      return "ValueInput";
    case "numeric-image-indicator":
      return "NumericImageIndicator";
    default:
      return type.slice(0, 1).toUpperCase() + type.slice(1);
  }
}

function buildGroupEditableOptions(group: Extract<HmiObject, { type: "group" }>): GroupEditableOption[] {
  const result: GroupEditableOption[] = [
    {
      key: group.id,
      value: group.id,
      object: group,
      depth: 0,
      label: "Group Root",
      isRoot: true,
    },
  ];

  const visit = (objects: HmiObject[], depth: number) => {
    for (const object of objects) {
      const name = object.name?.trim();
      const title = `${objectTypeLabel(object.type)} - ${name || object.id}`;
      result.push({
        key: object.id,
        value: object.id,
        object,
        depth,
        label: depth > 1 ? `${"  ".repeat(depth - 1)}${title}` : title,
        isRoot: false,
      });
      if (object.type === "group") {
        visit(object.objects, depth + 1);
      }
    }
  };

  visit(group.objects, 1);
  return result;
}

export function ObjectPropertyPanel(props: Props) {
  const { object, onPatch, onPatchObjectById } = props;
  const [activeEditableObjectId, setActiveEditableObjectId] = useState<string | null>(null);

  useEffect(() => {
    setActiveEditableObjectId(null);
  }, [object?.id]);

  if (!object) {
    return <div>Select object</div>;
  }

  if (object.type !== "group") {
    return <ObjectPropertyEditorContent {...props} />;
  }

  const options = buildGroupEditableOptions(object);
  const activeOption = options.find((item) => item.value === activeEditableObjectId) ?? options[0];
  const activeObject = activeOption?.object ?? object;
  const isRootEditing = activeOption?.isRoot ?? true;
  const canPatchNested = Boolean(onPatchObjectById);

  const patchTarget = (patch: Partial<HmiObject>) => {
    if (!activeOption) {
      return;
    }
    if (activeOption.isRoot) {
      onPatch(patch);
      return;
    }
    if (onPatchObjectById) {
      onPatchObjectById(activeOption.object.id, patch);
    }
  };

  return (
    <div className="object-property-panel-group-editor">
      <Form layout="vertical" size="small">
        <Form.Item label="Editing object" style={{ marginBottom: 8 }}>
          <Select
            size="small"
            value={activeOption?.value}
            options={options.map((item) => ({ value: item.value, label: item.label }))}
            onChange={(value) => setActiveEditableObjectId(value)}
          />
        </Form.Item>
      </Form>
      {!isRootEditing ? (
        <Typography.Text type={canPatchNested ? "secondary" : "warning"} style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
          {canPatchNested
            ? `Editing child object inside group (${activeObject.type} / ${activeObject.id}). Group remains selected on canvas.`
            : "Editing child object is not available in this context."}
        </Typography.Text>
      ) : null}
      <ObjectPropertyEditorContent
        {...props}
        object={activeObject}
        onPatch={patchTarget}
      />
    </div>
  );
}

function ObjectPropertyEditorContent({ project, assets, libraries, object, elementBindings, onPatch, onDelete, onBringToFront, onSendToBack, onMoveForward, onMoveBackward }: Props) {
  if (!object) {
    return <div>Select object</div>;
  }
  const templateBindings = elementBindings ?? [];
  const [indexedEditorTarget, setIndexedEditorTarget] = useState<{
    fieldName: string;
    fieldLabel: string;
    rawTagName?: string;
  } | null>(null);
  const editorRuntimeValues = buildIndexedAddressRuntimeValues({ variables: project.variables });

  useEffect(() => {
    setIndexedEditorTarget(null);
  }, [object.id]);

  const getFieldIndexedConfig = (fieldName: string, rawTagName: string | undefined): IndexedTagAddress => {
    const existing = getObjectIndexedConfigForField(object, fieldName);
    if (existing) {
      return existing;
    }
    const selectedTag = findTagByName(project, rawTagName);
    const template = getTagAddressTemplate(selectedTag);
    const slots = extractIndexedAddressSlots(template);
    return {
      enabled: false,
      template,
      bindings: createBindingsFromSlots(slots),
    };
  };

  const applyFieldIndexedConfig = (fieldName: string, next: IndexedTagAddress) => {
    const byField = {
      ...(object.tagIndexingByField ?? {}),
      [fieldName]: next,
    };
    onPatch({
      tagIndexingByField: byField,
      ...(fieldName === "tag" ? { tagIndexing: next } : {}),
    } as Partial<HmiObject>);
  };

  const setFieldIndexedEnabled = (fieldName: string, rawTagName: string | undefined, enabled: boolean) => {
    const current = getFieldIndexedConfig(fieldName, rawTagName);
    const template = normalizeTemplate(current.template, project, rawTagName);
    const slots = extractIndexedAddressSlots(template);
    const bindings = current.bindings.length > 0 ? current.bindings : createBindingsFromSlots(slots);
    applyFieldIndexedConfig(fieldName, {
      ...current,
      enabled,
      template,
      bindings,
    });
  };

  const getFieldIndexedStatus = (fieldName: string, rawTagName: string | undefined): string => {
    const config = getObjectIndexedConfigForField(object, fieldName);
    if (!config?.enabled) {
      return "Not configured";
    }
    const resolved = resolveObjectTagField({
      object,
      fieldName,
      project,
      context: {},
      rawTagName,
      tagValues: undefined,
    });
    if (!resolved.usedIndexedAddress) {
      return "Not configured";
    }
    if (resolved.errors.some((item) => item.includes("missing or non-numeric") || item.includes("sourceName is missing"))) {
      return "Preview incomplete";
    }
    return resolved.resolvedTagName ? "OK" : "Not found";
  };

  const buildIndexControl = (fieldName: string, fieldLabel: string, rawTagName: string | undefined) => {
    const config = getObjectIndexedConfigForField(object, fieldName);
    return {
      enabled: Boolean(config?.enabled),
      status: getFieldIndexedStatus(fieldName, rawTagName),
      configureDisabled: !(rawTagName?.trim()),
      onConfigure: () => setIndexedEditorTarget({ fieldName, fieldLabel, rawTagName }),
      onToggleEnabled: (checked: boolean) => setFieldIndexedEnabled(fieldName, rawTagName, checked),
    };
  };

  const applyTextStyle = (patch: Partial<TextStyle>) => {
    if (!hasTextStyle(object)) {
      return;
    }
    onPatch({ textStyle: { ...object.textStyle, ...patch } } as Partial<HmiObject>);
  };

  const generalContent = (
    <>
      <Form.Item label="ID">
        <Input value={object.id} disabled />
      </Form.Item>
      <Form.Item label="Name">
        <Input value={object.name ?? ""} onChange={(e) => onPatch({ name: e.target.value })} />
      </Form.Item>
      <Form.Item label="X">
        <InputNumber
          style={{ width: "100%" }}
          precision={1}
          value={toFixedPrecisionNumber(object.x, 1)}
          onChange={(v) => onPatch({ x: toFixedPrecisionNumber(v ?? 0, 1) })}
        />
      </Form.Item>
      <Form.Item label="Y">
        <InputNumber
          style={{ width: "100%" }}
          precision={1}
          value={toFixedPrecisionNumber(object.y, 1)}
          onChange={(v) => onPatch({ y: toFixedPrecisionNumber(v ?? 0, 1) })}
        />
      </Form.Item>
      <Form.Item label="Width">
        <InputNumber
          style={{ width: "100%" }}
          precision={1}
          value={toFixedPrecisionNumber(object.width, 1)}
          onChange={(v) => onPatch({ width: toFixedPrecisionNumber(v ?? 10, 1) })}
        />
      </Form.Item>
      <Form.Item label="Height">
        <InputNumber
          style={{ width: "100%" }}
          precision={1}
          value={toFixedPrecisionNumber(object.height, 1)}
          onChange={(v) => onPatch({ height: toFixedPrecisionNumber(v ?? 10, 1) })}
        />
      </Form.Item>
      <Form.Item label="Rotation">
        <InputNumber
          style={{ width: "100%" }}
          precision={1}
          value={toFixedPrecisionNumber(object.rotation ?? 0, 1)}
          onChange={(v) => onPatch({ rotation: toFixedPrecisionNumber(v ?? 0, 1) })}
        />
      </Form.Item>
      <Space>
        <span>Visible</span>
        <Switch checked={object.visible ?? true} onChange={(checked) => onPatch({ visible: checked })} />
      </Space>
      <Space style={{ marginLeft: 12 }}>
        <span>Locked</span>
        <Switch checked={object.locked ?? false} onChange={(checked) => onPatch({ locked: checked })} />
      </Space>
      <Form.Item label="Opacity (0..1)" style={{ marginTop: 8 }}>
        <InputNumber
          style={{ width: "100%" }}
          min={0}
          max={1}
          step={0.05}
          value={object.opacity ?? 1}
          onChange={(value) => onPatch({ opacity: clampOpacity(value) })}
        />
      </Form.Item>
    </>
  );

  const effectsContent = (
    <>
      <Space style={{ marginBottom: 8 }}>
        <span>Enable Shadow</span>
        <Switch checked={object.shadowEnabled ?? false} onChange={(checked) => onPatch({ shadowEnabled: checked } as Partial<HmiObject>)} />
      </Space>
      <ColorField
        label="Shadow Color"
        value={object.shadowColor ?? "#000000"}
        fallback="#000000"
        disabled={!(object.shadowEnabled ?? false)}
        onChange={(next) => onPatch({ shadowColor: next } as Partial<HmiObject>)}
      />
      <Form.Item label="Shadow Opacity (0..1)">
        <InputNumber
          style={{ width: "100%" }}
          min={0}
          max={1}
          step={0.05}
          disabled={!(object.shadowEnabled ?? false)}
          value={object.shadowOpacity ?? 0.35}
          onChange={(value) => onPatch({ shadowOpacity: clampOpacity(value) } as Partial<HmiObject>)}
        />
      </Form.Item>
      <Form.Item label="Shadow Size">
        <InputNumber
          style={{ width: "100%" }}
          min={0}
          max={100}
          disabled={!(object.shadowEnabled ?? false)}
          value={object.shadowBlur ?? 8}
          onChange={(value) => onPatch({ shadowBlur: Math.max(0, Number(value ?? 8)) } as Partial<HmiObject>)}
        />
      </Form.Item>
      <Form.Item label="Shadow Distance">
        <InputNumber
          style={{ width: "100%" }}
          min={0}
          max={100}
          disabled={!(object.shadowEnabled ?? false)}
          value={object.shadowDistance ?? 4}
          onChange={(value) => onPatch({ shadowDistance: Math.max(0, Number(value ?? 4)) } as Partial<HmiObject>)}
        />
      </Form.Item>
      <Form.Item label="Shadow Direction">
        <Select
          disabled={!(object.shadowEnabled ?? false)}
          value={object.shadowDirection ?? "bottom-right"}
          options={shadowDirectionOptions.map((item) => ({ label: item.label, value: item.value }))}
          onChange={(value) => onPatch({ shadowDirection: value } as Partial<HmiObject>)}
        />
      </Form.Item>
    </>
  );

  const objectContent = (
    <SpecificPropertyFields
      project={project}
      assets={assets}
      libraries={libraries}
      object={object}
      elementBindings={elementBindings}
      buildIndexControl={buildIndexControl}
      onPatch={onPatch}
    />
  );
  const numericValueContent = object.type === "numeric-input" ? (
    <SpecificPropertyFields
      project={project}
      assets={assets}
      libraries={libraries}
      object={object}
      elementBindings={elementBindings}
      buildIndexControl={buildIndexControl}
      numericInputSection="value"
      onPatch={onPatch}
    />
  ) : null;
  const numericAppearanceContent = object.type === "numeric-input" ? (
    <SpecificPropertyFields
      project={project}
      assets={assets}
      libraries={libraries}
      object={object}
      elementBindings={elementBindings}
      buildIndexControl={buildIndexControl}
      numericInputSection="appearance"
      onPatch={onPatch}
    />
  ) : null;
  const numericSignalErrorContent = object.type === "numeric-input" ? (
    <SpecificPropertyFields
      project={project}
      assets={assets}
      libraries={libraries}
      object={object}
      elementBindings={elementBindings}
      buildIndexControl={buildIndexControl}
      numericInputSection="error"
      onPatch={onPatch}
    />
  ) : null;
  const numericDialogContent = object.type === "numeric-input" ? (
    <SpecificPropertyFields
      project={project}
      assets={assets}
      libraries={libraries}
      object={object}
      elementBindings={elementBindings}
      buildIndexControl={buildIndexControl}
      numericInputSection="dialog"
      onPatch={onPatch}
    />
  ) : null;

  const hasRuntimeStateBinding = Boolean((object.visibleTag ?? "").trim() || (object.disabledTag ?? "").trim());
  const runtimeStateContent = (
    <>
      <TagFieldWithBindingSource
        project={project}
        bindings={templateBindings}
        value={object.visibleTag ?? ""}
        bindingLabel="Visible Binding"
        tagLabel="Visible Tag"
        indexControl={buildIndexControl("visibleTag", "Visible Tag", object.visibleTag)}
        onChange={(nextValue) => onPatch({ visibleTag: nextValue } as Partial<HmiObject>)}
      />
      <Space style={{ marginBottom: 8 }}>
        <span>Invert Visible</span>
        <Switch checked={object.visibleInvert ?? false} onChange={(checked) => onPatch({ visibleInvert: checked } as Partial<HmiObject>)} />
      </Space>
      <TagFieldWithBindingSource
        project={project}
        bindings={templateBindings}
        value={object.disabledTag ?? ""}
        bindingLabel="Disabled Binding"
        tagLabel="Disabled Tag"
        indexControl={buildIndexControl("disabledTag", "Disabled Tag", object.disabledTag)}
        onChange={(nextValue) => onPatch({ disabledTag: nextValue } as Partial<HmiObject>)}
      />
      <Space style={{ marginBottom: 8 }}>
        <span>Invert Disabled</span>
        <Switch checked={object.disabledInvert ?? false} onChange={(checked) => onPatch({ disabledInvert: checked } as Partial<HmiObject>)} />
      </Space>
      {hasRuntimeStateBinding ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Runtime visibility/disabled bindings are active for this object.
        </Typography.Text>
      ) : null}
    </>
  );

  const textContent = hasTextStyle(object) ? (
    <>
      <Form.Item label="Text Font">
        <Select
          value={object.textStyle.fontFamily}
          options={fontOptions.map((font) => ({ label: font, value: font }))}
          onChange={(value) => applyTextStyle({ fontFamily: value })}
        />
      </Form.Item>
      <Form.Item label="Text Size">
        <InputNumber
          style={{ width: "100%" }}
          value={object.textStyle.fontSize}
          onChange={(value) => applyTextStyle({ fontSize: Number(value ?? 12) })}
        />
      </Form.Item>
      <ColorField label="Text Color" value={object.textStyle.color} fallback="#ffffff" onChange={(next) => applyTextStyle({ color: next })} />
      <Form.Item label="Font Style">
        <Select
          value={object.textStyle.fontStyle ?? "normal"}
          options={[
            { label: "normal", value: "normal" },
            { label: "bold", value: "bold" },
            { label: "italic", value: "italic" },
            { label: "bold italic", value: "bold italic" },
          ]}
          onChange={(value) => applyTextStyle({ fontStyle: value })}
        />
      </Form.Item>
      <Form.Item label="Horizontal Align">
        <Select
          value={object.textStyle.horizontalAlign}
          options={[
            { label: "left", value: "left" },
            { label: "center", value: "center" },
            { label: "right", value: "right" },
          ]}
          onChange={(value) => applyTextStyle({ horizontalAlign: value })}
        />
      </Form.Item>
      <Form.Item label="Vertical Align">
        <Select
          value={object.textStyle.verticalAlign}
          options={[
            { label: "top", value: "top" },
            { label: "middle", value: "middle" },
            { label: "bottom", value: "bottom" },
          ]}
          onChange={(value) => applyTextStyle({ verticalAlign: value })}
        />
      </Form.Item>
      <Form.Item label="Padding">
        <InputNumber
          style={{ width: "100%" }}
          value={object.textStyle.padding ?? 0}
          onChange={(value) => applyTextStyle({ padding: Number(value ?? 0) })}
        />
      </Form.Item>

      {hasTextLayout(object) ? (
        <>
          <Form.Item label="Wrap">
            <Select
              value={object.wrap ?? "word"}
              options={[
                { label: "none", value: "none" },
                { label: "word", value: "word" },
                { label: "char", value: "char" },
              ]}
              onChange={(value) => onPatch({ wrap: value } as Partial<HmiObject>)}
            />
          </Form.Item>
          <Space>
            <span>Ellipsis</span>
            <Switch checked={object.ellipsis ?? false} onChange={(checked) => onPatch({ ellipsis: checked } as Partial<HmiObject>)} />
          </Space>
        </>
      ) : null}
    </>
  ) : null;

  const accessContent = (
    <>
      <Form.Item label="Macro On Press">
        <Select
          allowClear
          value={object.onPressMacroId}
          options={(project.macros ?? []).map((item) => ({ label: item.name, value: item.id }))}
          placeholder="none"
          onChange={(value) => onPatch({ onPressMacroId: value || undefined } as Partial<HmiObject>)}
        />
      </Form.Item>
      <Form.Item label="Macro On Release">
        <Select
          allowClear
          value={object.onReleaseMacroId}
          options={(project.macros ?? []).map((item) => ({ label: item.name, value: item.id }))}
          placeholder="none"
          onChange={(value) => onPatch({ onReleaseMacroId: value || undefined } as Partial<HmiObject>)}
        />
      </Form.Item>
      <Form.Item label="Visible Role">
        <Select
          value={(object.requiredVisibleRole ?? 0) as AccessRoleLevel}
          options={accessRoleOptions}
          onChange={(value) => onPatch({ requiredVisibleRole: Number(value) as AccessRoleLevel } as Partial<HmiObject>)}
        />
      </Form.Item>
      <Form.Item label="Action Role">
        <Select
          value={(object.requiredActionRole ?? 0) as AccessRoleLevel}
          options={accessRoleOptions}
          onChange={(value) => onPatch({ requiredActionRole: Number(value) as AccessRoleLevel } as Partial<HmiObject>)}
        />
      </Form.Item>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Action role is used only for interactive runtime actions.
      </Typography.Text>
      <Form.Item label="Legacy Visible For Roles" style={{ marginTop: 8 }}>
        <Select
          mode="multiple"
          allowClear
          value={object.visibleForRoles ?? []}
          options={roleOptions}
          placeholder="empty = visible for everyone"
          onChange={(value) => onPatch({ visibleForRoles: value as AppRole[] } as Partial<HmiObject>)}
        />
      </Form.Item>
    </>
  );

  const panelTabs = object.type === "numeric-input"
    ? [
        { key: "general", label: "General", children: generalContent },
        { key: "effects", label: "Effects", children: effectsContent },
        { key: "value", label: "Value", children: numericValueContent },
        { key: "appearance", label: "Appearance", children: numericAppearanceContent },
        { key: "error", label: "Signal Error", children: numericSignalErrorContent },
        { key: "dialog", label: "Dialog", children: numericDialogContent },
        { key: "runtime", label: "Runtime", children: runtimeStateContent },
        { key: "access", label: "Access", children: accessContent },
      ]
    : [
        { key: "general", label: "General", children: generalContent },
        { key: "effects", label: "Effects", children: effectsContent },
        { key: "specific", label: "Specific", children: objectContent },
        ...(textContent ? [{ key: "text", label: "Text", children: textContent }] : []),
        { key: "runtime", label: "Runtime", children: runtimeStateContent },
        { key: "access", label: "Access", children: accessContent },
      ];

  return (
    <div className="object-property-panel object-property-panel--workbench">
      <Form layout="vertical" size="small">
        <Tabs
          size="small"
          className="object-property-tabs object-property-tabs--main"
          items={panelTabs}
        />
      </Form>
      {indexedEditorTarget ? (
        <IndexedAddressEditorWindow
          fieldName={indexedEditorTarget.fieldName}
          fieldLabel={indexedEditorTarget.fieldLabel}
          open
          project={project}
          value={getFieldIndexedConfig(indexedEditorTarget.fieldName, indexedEditorTarget.rawTagName)}
          selectedTag={findTagByName(project, indexedEditorTarget.rawTagName) ?? null}
          runtimePreviewValues={editorRuntimeValues}
          onApply={(fieldName, next) => applyFieldIndexedConfig(fieldName, next)}
          onClose={() => setIndexedEditorTarget(null)}
        />
      ) : null}
    </div>
  );
}

function SpecificPropertyFields({
  project,
  assets,
  libraries,
  object,
  elementBindings,
  buildIndexControl,
  numericInputSection,
  onPatch,
}: {
  project: ScadaProject;
  assets: Asset[];
  libraries: ElementLibrary[];
  object: HmiObject;
  elementBindings?: ElementBindingDefinition[];
  buildIndexControl: (fieldName: string, fieldLabel: string, rawTagName: string | undefined) => {
    enabled: boolean;
    status: string;
    configureDisabled?: boolean;
    onConfigure: () => void;
    onToggleEnabled: (checked: boolean) => void;
    };
  numericInputSection?: "value" | "appearance" | "error" | "dialog";
  onPatch: (patch: Partial<HmiObject>) => void;
}) {
  const [stateImagePreviewValue, setStateImagePreviewValue] = useState<string>("0");
  const [selectOptionsDraft, setSelectOptionsDraft] = useState<string>("");
  const [radioOptionsDraft, setRadioOptionsDraft] = useState<string>("");
  const assetOptions = assets.map((asset) => ({ label: getAssetDisplayPath(asset), value: asset.id }));
  const templateBindings = elementBindings ?? [];

  useEffect(() => {
    if (object.type === "select") {
      setSelectOptionsDraft(optionsToMultilineText(object.options));
      return;
    }
    if (object.type === "radio-group") {
      setRadioOptionsDraft(optionsToMultilineText(object.options));
      return;
    }
  }, [object.id, object.type]);
  if (object.type === "text") {
    return (
      <Form.Item label="Text">
        <Input.TextArea
          rows={3}
          value={object.text ?? ""}
          onChange={(e) => onPatch({ text: e.target.value } as Partial<HmiObject>)}
        />
      </Form.Item>
    );
  }

  if (object.type === "line") {
    const lineMainContent = (
      <>
        <Typography.Text strong>State</Typography.Text>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.stateTag ?? ""}
          bindingLabel="State Binding"
          tagLabel="State Tag"
          indexControl={buildIndexControl("stateTag", "State Tag", object.stateTag)}
          onChange={(nextValue) => onPatch({ stateTag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="Active Value">
          <Input
            value={scalarToText(object.activeValue)}
            placeholder="1 / true / ON"
            onChange={(event) => {
              const raw = event.target.value;
              if (raw.trim() === "") {
                onPatch({ activeValue: undefined } as Partial<HmiObject>);
                return;
              }
              onPatch({ activeValue: parseScalarToken(raw) } as Partial<HmiObject>);
            }}
          />
        </Form.Item>
        <ColorField label="Inactive Stroke" value={object.inactiveStroke ?? object.stroke} fallback="#d9d9d9" onChange={(next) => onPatch({ inactiveStroke: next } as Partial<HmiObject>)} />
        <ColorField label="Active Stroke" value={object.activeStroke ?? "#0e639c"} fallback="#0e639c" onChange={(next) => onPatch({ activeStroke: next } as Partial<HmiObject>)} />
        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Geometry</Typography.Text>
        <ColorField label="Stroke Color" value={object.stroke} fallback="#d9d9d9" onChange={(next) => onPatch({ stroke: next } as Partial<HmiObject>)} />
        <Form.Item label="Stroke Width">
          <InputNumber
            style={{ width: "100%" }}
            min={1}
            value={object.strokeWidth}
            onChange={(v) => onPatch({ strokeWidth: Math.max(1, Number(v ?? 1)) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Space>
          <span>Closed</span>
          <Switch checked={object.closed ?? false} onChange={(checked) => onPatch({ closed: checked } as Partial<HmiObject>)} />
        </Space>
        {object.closed ? (
          <ColorField label="Fill Color" value={object.fill ?? ""} fallback="#262626" onChange={(next) => onPatch({ fill: next } as Partial<HmiObject>)} />
        ) : null}
        <Form.Item label="Points (JSON [x1,y1,x2,y2,...])">
          <Input.TextArea
            rows={3}
            value={JSON.stringify(object.points)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value) as unknown;
                if (!Array.isArray(parsed)) {
                  return;
                }
                const points = parsed.map((item) => Number(item)).filter((item) => Number.isFinite(item));
                if (points.length >= 4 && points.length % 2 === 0) {
                  onPatch({ points } as Partial<HmiObject>);
                }
              } catch {
                // ignore invalid JSON while typing
              }
            }}
          />
        </Form.Item>
      </>
    );

    return (
      <Tabs
        size="small"
        className="object-property-tabs object-property-tabs--main"
        items={[
          { key: "main", label: "Main", children: lineMainContent },
          {
            key: "gradient",
            label: "Gradient",
            children: (
              <GradientTabContent
                enabled={object.gradientEnabled ?? false}
                direction={object.gradientDirection}
                startColor={object.gradientStartColor ?? object.inactiveStroke ?? object.stroke}
                endColor={object.gradientEndColor ?? object.activeStroke ?? object.stroke}
                startFallback={object.inactiveStroke ?? object.stroke ?? "#d9d9d9"}
                endFallback={object.activeStroke ?? object.stroke ?? "#0e639c"}
                onPatch={onPatch}
              />
            ),
          },
        ]}
      />
    );
  }

  if (object.type === "rectangle") {
    const rectangleMainContent = (
      <>
        <ColorField label="Fill Color" value={object.fill ?? ""} fallback="#262626" onChange={(next) => onPatch({ fill: next } as Partial<HmiObject>)} />
        <ColorField label="Stroke Color" value={object.stroke ?? ""} fallback="#8c8c8c" onChange={(next) => onPatch({ stroke: next } as Partial<HmiObject>)} />
        <Form.Item label="Stroke Width">
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            value={object.strokeWidth ?? 0}
            onChange={(v) => onPatch({ strokeWidth: Math.max(0, Number(v ?? 0)) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Corner Radius">
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            value={object.cornerRadius ?? 0}
            onChange={(v) => onPatch({ cornerRadius: Math.max(0, Number(v ?? 0)) } as Partial<HmiObject>)}
          />
        </Form.Item>
      </>
    );
    return (
      <Tabs
        size="small"
        className="object-property-tabs object-property-tabs--main"
        items={[
          { key: "main", label: "Main", children: rectangleMainContent },
          {
            key: "gradient",
            label: "Gradient",
            children: (
              <GradientTabContent
                enabled={object.gradientEnabled ?? false}
                direction={object.gradientDirection}
                startColor={object.gradientStartColor ?? object.fill}
                endColor={object.gradientEndColor ?? object.fill}
                startFallback={object.fill ?? "#262626"}
                endFallback={object.fill ?? "#3c3c3c"}
                onPatch={onPatch}
              />
            ),
          },
        ]}
      />
    );
  }

  if (object.type === "value-display") {
    return (
      <>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.tag}
          indexControl={buildIndexControl("tag", "Main Tag", object.tag)}
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="Suffix">
          <Input value={object.suffix ?? ""} onChange={(e) => onPatch({ suffix: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
      </>
    );
  }

  if (object.type === "value-input") {
    return (
      <>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.tag}
          indexControl={buildIndexControl("tag", "Main Tag", object.tag)}
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="Min">
          <InputNumber style={{ width: "100%" }} value={object.min} onChange={(v) => onPatch({ min: Number(v ?? 0) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Max">
          <InputNumber style={{ width: "100%" }} value={object.max} onChange={(v) => onPatch({ max: Number(v ?? 0) } as Partial<HmiObject>)} />
        </Form.Item>
      </>
    );
  }

  if (object.type === "state-indicator") {
    const stateIndicatorMainContent = (
      <>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.tag}
          indexControl={buildIndexControl("tag", "Main Tag", object.tag)}
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="True Text">
          <Input value={object.trueText} onChange={(e) => onPatch({ trueText: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="False Text">
          <Input value={object.falseText} onChange={(e) => onPatch({ falseText: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <ColorField label="True Color" value={object.trueColor} fallback="#389e0d" onChange={(next) => onPatch({ trueColor: next } as Partial<HmiObject>)} />
        <ColorField label="False Color" value={object.falseColor} fallback="#595959" onChange={(next) => onPatch({ falseColor: next } as Partial<HmiObject>)} />
        <ColorField label="Bad Color" value={object.badColor} fallback="#bfbfbf" onChange={(next) => onPatch({ badColor: next } as Partial<HmiObject>)} />
      </>
    );
    return (
      <Tabs
        size="small"
        className="object-property-tabs object-property-tabs--main"
        items={[
          { key: "main", label: "Main", children: stateIndicatorMainContent },
          {
            key: "gradient",
            label: "Gradient",
            children: (
              <GradientTabContent
                enabled={object.gradientEnabled ?? false}
                direction={object.gradientDirection}
                startColor={object.gradientStartColor ?? object.falseColor}
                endColor={object.gradientEndColor ?? object.trueColor}
                startFallback={object.falseColor ?? "#595959"}
                endFallback={object.trueColor ?? "#389e0d"}
                onPatch={onPatch}
              />
            ),
          },
        ]}
      />
    );
  }

  if (object.type === "button") {
    const runMacroAction = object.action.type === "runMacro" ? object.action : undefined;
    const writeAction = object.action.type === "write" ? object.action : undefined;
    const pulseAction = object.action.type === "pulse" ? object.action : undefined;
    const toggleAction = object.action.type === "toggle" ? object.action : undefined;
    const openScreenAction = object.action.type === "openScreen" ? object.action : undefined;
    const openPopupAction = object.action.type === "openPopup" ? object.action : undefined;
    const setInternalVarAction = object.action.type === "setInternalVar" ? object.action : undefined;
    const setLwAction = object.action.type === "setLW" ? object.action : undefined;
    const macro = runMacroAction
      ? (project.macros ?? []).find((item) => item.id === runMacroAction.macroId)
      : undefined;
    const buttonMainContent = (
      <>
        <Form.Item label="Text">
          <Input value={object.text ?? ""} onChange={(e) => onPatch({ text: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Space>
          <span>Show text</span>
          <Switch checked={object.showText ?? true} onChange={(checked) => onPatch({ showText: checked } as Partial<HmiObject>)} />
        </Space>
        <Form.Item label="Background Asset">
          <Select
            value={object.backgroundAssetId}
            allowClear
            options={assetOptions}
            onChange={(value) => onPatch({ backgroundAssetId: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Pressed Asset">
          <Select
            value={object.pressedBackgroundAssetId}
            allowClear
            options={assetOptions}
            onChange={(value) => onPatch({ pressedBackgroundAssetId: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <ColorField label="Background Color" value={object.backgroundColor ?? "#0958d9"} fallback="#0958d9" onChange={(next) => onPatch({ backgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Pressed Color" value={object.pressedBackgroundColor ?? "#0747b3"} fallback="#0747b3" onChange={(next) => onPatch({ pressedBackgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Disabled Color" value={object.disabledBackgroundColor ?? "#434343"} fallback="#434343" onChange={(next) => onPatch({ disabledBackgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Border Color" value={object.borderColor ?? "#0958d9"} fallback="#0958d9" onChange={(next) => onPatch({ borderColor: next } as Partial<HmiObject>)} />
        <Form.Item label="Border Width">
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            value={object.borderWidth ?? 1}
            onChange={(v) => onPatch({ borderWidth: Math.max(0, Number(v ?? 0)) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Action Type">
          <Select
            value={object.action.type}
            options={[
              { label: "write", value: "write" },
              { label: "pulse", value: "pulse" },
              { label: "toggle", value: "toggle" },
              { label: "openScreen", value: "openScreen" },
              { label: "openPopup", value: "openPopup" },
              { label: "runMacro", value: "runMacro" },
              { label: "setInternalVar", value: "setInternalVar" },
              { label: "setLW", value: "setLW" },
            ]}
            onChange={(value) => {
              if (value === "write") {
                onPatch({ action: { type: "write", tag: "", value: true } } as Partial<HmiObject>);
                return;
              }
              if (value === "pulse") {
                onPatch({ action: { type: "pulse", tag: "", value: true, durationMs: 500 } } as Partial<HmiObject>);
                return;
              }
              if (value === "toggle") {
                onPatch({ action: { type: "toggle", tag: "" } } as Partial<HmiObject>);
                return;
              }
              if (value === "openScreen") {
                onPatch({ action: { type: "openScreen", screenId: project.screens[0]?.id ?? "" } } as Partial<HmiObject>);
                return;
              }
              if (value === "openPopup") {
                const popup = project.screens.find((s) => s.kind === "popup");
                onPatch({ action: { type: "openPopup", popupScreenId: popup?.id ?? "" } } as Partial<HmiObject>);
                return;
              }
              if (value === "setInternalVar") {
                onPatch({ action: { type: "setInternalVar", name: "selectedBurnerPrefix", value: "_1" } } as Partial<HmiObject>);
                return;
              }
              if (value === "setLW") {
                onPatch({ action: { type: "setLW", address: 20, value: 0 } } as Partial<HmiObject>);
                return;
              }
              onPatch({ action: { type: "runMacro", macroId: "" } } as Partial<HmiObject>);
            }}
          />
        </Form.Item>
        <ActionAccessFields
          action={object.action}
          onChange={(nextAction) => onPatch({ action: nextAction } as Partial<HmiObject>)}
        />
        {writeAction ? (
          <>
            <TagFieldWithBindingSource
              project={project}
              bindings={templateBindings}
              value={writeAction.tag}
              bindingLabel="Action Binding"
              tagLabel="Action Tag"
              indexControl={buildIndexControl("action.tag", "Action Tag", writeAction.tag)}
              onChange={(nextValue) =>
                onPatch({
                  action: {
                    ...writeAction,
                    tag: nextValue,
                  },
                } as Partial<HmiObject>)
              }
            />
            <Form.Item label="Write Value">
              <Input
                value={stringifyRuntimeActionValue(writeAction.value)}
                onChange={(event) =>
                  onPatch({
                    action: {
                      ...writeAction,
                      value: parseRuntimeActionValue(event.target.value),
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
          </>
        ) : null}
        {pulseAction ? (
          <>
            <TagFieldWithBindingSource
              project={project}
              bindings={templateBindings}
              value={pulseAction.tag}
              bindingLabel="Action Binding"
              tagLabel="Action Tag"
              indexControl={buildIndexControl("action.tag", "Action Tag", pulseAction.tag)}
              onChange={(nextValue) =>
                onPatch({
                  action: {
                    ...pulseAction,
                    tag: nextValue,
                  },
                } as Partial<HmiObject>)
              }
            />
            <Form.Item label="Pulse Value">
              <Input
                value={stringifyRuntimeActionValue(pulseAction.value)}
                onChange={(event) =>
                  onPatch({
                    action: {
                      ...pulseAction,
                      value: parseRuntimeActionValue(event.target.value),
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
            <Form.Item label="Duration (ms)">
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                value={pulseAction.durationMs}
                onChange={(value) =>
                  onPatch({
                    action: {
                      ...pulseAction,
                      durationMs: Math.max(1, Number(value ?? 1)),
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
          </>
        ) : null}
        {toggleAction ? (
          <TagFieldWithBindingSource
            project={project}
            bindings={templateBindings}
            value={toggleAction.tag}
            bindingLabel="Action Binding"
            tagLabel="Action Tag"
            indexControl={buildIndexControl("action.tag", "Action Tag", toggleAction.tag)}
            onChange={(nextValue) =>
              onPatch({
                action: {
                  ...toggleAction,
                  tag: nextValue,
                },
              } as Partial<HmiObject>)
            }
          />
        ) : null}
        {openScreenAction ? (
          <Form.Item label="Screen">
            <Select
              value={openScreenAction.screenId}
              options={project.screens.map((screen) => ({ label: `${screen.name} (${screen.kind})`, value: screen.id }))}
              onChange={(value) =>
                onPatch({
                  action: {
                    ...openScreenAction,
                    screenId: value,
                  },
                } as Partial<HmiObject>)
              }
            />
          </Form.Item>
        ) : null}
        {openPopupAction ? (
          <>
            <Form.Item label="Popup">
              <Select
                value={openPopupAction.popupScreenId}
                options={project.screens
                  .filter((screen) => screen.kind === "popup")
                  .map((screen) => ({ label: screen.name, value: screen.id }))}
                onChange={(value) =>
                  onPatch({
                    action: {
                      ...openPopupAction,
                      popupScreenId: value,
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
            <Form.Item label="Popup Title">
              <Input
                value={openPopupAction.title ?? ""}
                placeholder="РЈРїСЂР°РІР»РµРЅРёРµ: {{valveName}}"
                onChange={(event) =>
                  onPatch({
                    action: {
                      ...openPopupAction,
                      title: event.target.value,
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
            <Form.Item label="Popup Tag Prefix">
              <Input
                value={openPopupAction.tagPrefix ?? ""}
                placeholder="VALVES.PZK_1 or .PZK_1"
                onChange={(event) =>
                  onPatch({
                    action: {
                      ...openPopupAction,
                      tagPrefix: event.target.value,
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
            <Form.Item label="Popup Args (JSON)">
              <Input.TextArea
                rows={3}
                value={JSON.stringify(openPopupAction.args ?? {}, null, 2)}
                onChange={(event) => {
                  try {
                    const parsed = JSON.parse(event.target.value) as Record<string, unknown>;
                    onPatch({
                      action: {
                        ...openPopupAction,
                        args: parsed,
                      },
                    } as Partial<HmiObject>);
                  } catch {
                    // ignore invalid JSON while typing
                  }
                }}
              />
            </Form.Item>
          </>
        ) : null}
        {runMacroAction ? (
          <>
            <Form.Item label="Macro">
              <Select
                value={runMacroAction.macroId}
                options={(project.macros ?? []).map((item) => ({ label: item.name, value: item.id }))}
                onChange={(value) =>
                  onPatch({
                    action: {
                      ...runMacroAction,
                      macroId: value,
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
            <Space>
              <Typography.Text type="secondary">Status:</Typography.Text>
              {!macro ? <Tag color="red">Missing</Tag> : null}
              {macro && (macro.enabled ?? true) ? <Tag color="green">Enabled</Tag> : null}
              {macro && (macro.enabled ?? true) === false ? <Tag color="gold">Disabled</Tag> : null}
            </Space>
            {macro && (macro.enabled ?? true) === false ? (
              <Typography.Text type="warning">
                This macro is disabled. It will not run in Runtime.
              </Typography.Text>
            ) : null}
          </>
        ) : null}
        {setInternalVarAction ? (
          <>
            <Form.Item label="Variable Name">
              <Input
                value={setInternalVarAction.name}
                onChange={(event) =>
                  onPatch({
                    action: {
                      ...setInternalVarAction,
                      name: event.target.value,
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
            <Form.Item label="Value">
              <Input
                value={stringifyRuntimeActionValue(setInternalVarAction.value)}
                onChange={(event) =>
                  onPatch({
                    action: {
                      ...setInternalVarAction,
                      value: parseRuntimeActionValue(event.target.value),
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
          </>
        ) : null}
        {setLwAction ? (
          <>
            <Form.Item label="LW Address">
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                value={setLwAction.address}
                onChange={(value) =>
                  onPatch({
                    action: {
                      ...setLwAction,
                      address: Math.max(0, Math.floor(Number(value ?? 0))),
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
            <Form.Item label="Value">
              <Input
                value={stringifyRuntimeActionValue(setLwAction.value)}
                onChange={(event) =>
                  onPatch({
                    action: {
                      ...setLwAction,
                      value: parseRuntimeActionValue(event.target.value),
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
          </>
        ) : null}
      </>
    );
    const buttonGradientContent = (
      <GradientTabContent
        enabled={object.gradientEnabled ?? false}
        direction={object.gradientDirection}
        startColor={object.gradientStartColor ?? object.backgroundColor}
        endColor={object.gradientEndColor ?? object.pressedBackgroundColor ?? object.backgroundColor}
        startFallback={object.backgroundColor ?? "#0958d9"}
        endFallback={object.pressedBackgroundColor ?? "#0747b3"}
        onPatch={onPatch}
      />
    );
    return (
      <Tabs
        size="small"
        className="object-property-tabs object-property-tabs--main"
        items={[
          { key: "main", label: "Main", children: buttonMainContent },
          { key: "gradient", label: "Gradient", children: buttonGradientContent },
        ]}
      />
    );
  }

  if (object.type === "switch") {
    const switchMainContent = (
      <>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.tag}
          indexControl={buildIndexControl("tag", "Main Tag", object.tag)}
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="ON Text">
          <Input value={object.onText ?? "ON"} onChange={(e) => onPatch({ onText: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="OFF Text">
          <Input value={object.offText ?? "OFF"} onChange={(e) => onPatch({ offText: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <ColorField label="ON Color" value={object.onColor ?? "#389e0d"} fallback="#389e0d" onChange={(next) => onPatch({ onColor: next } as Partial<HmiObject>)} />
        <ColorField label="OFF Color" value={object.offColor ?? "#434343"} fallback="#434343" onChange={(next) => onPatch({ offColor: next } as Partial<HmiObject>)} />
        <ColorField label="Border Color" value={object.borderColor ?? "#595959"} fallback="#595959" onChange={(next) => onPatch({ borderColor: next } as Partial<HmiObject>)} />
        <Form.Item label="Border Width">
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            value={object.borderWidth ?? 1}
            onChange={(v) => onPatch({ borderWidth: Math.max(0, Number(v ?? 0)) } as Partial<HmiObject>)}
          />
        </Form.Item>
      </>
    );
    return (
      <Tabs
        size="small"
        className="object-property-tabs object-property-tabs--main"
        items={[
          { key: "main", label: "Main", children: switchMainContent },
          {
            key: "gradient",
            label: "Gradient",
            children: (
              <GradientTabContent
                enabled={object.gradientEnabled ?? false}
                direction={object.gradientDirection}
                startColor={object.gradientStartColor ?? object.offColor}
                endColor={object.gradientEndColor ?? object.onColor}
                startFallback={object.offColor ?? "#434343"}
                endFallback={object.onColor ?? "#389e0d"}
                onPatch={onPatch}
              />
            ),
          },
        ]}
      />
    );
  }

  if (object.type === "valueSelect") {
    const optionsText = object.options.map((item) => `${item.label}|${String(item.value)}`).join("\n");
    return (
      <>
        <Form.Item label="Value Type">
          <Select
            value={object.valueType}
            options={[
              { label: "string", value: "string" },
              { label: "number", value: "number" },
              { label: "boolean", value: "boolean" },
            ]}
            onChange={(value) => onPatch({ valueType: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Target Type">
          <Select
            value={object.target.type}
            options={[
              { label: "internal", value: "internal" },
              { label: "lw", value: "lw" },
              { label: "tag", value: "tag" },
            ]}
            onChange={(value) => {
              if (value === "internal") {
                onPatch({ target: { type: "internal", name: "selectedBurnerPrefix" } } as Partial<HmiObject>);
                return;
              }
              if (value === "lw") {
                onPatch({ target: { type: "lw", address: 20 } } as Partial<HmiObject>);
                return;
              }
              onPatch({ target: { type: "tag", tag: "" } } as Partial<HmiObject>);
            }}
          />
        </Form.Item>
        {object.target.type === "internal" ? (
          <Form.Item label="Internal Name">
            <Input
              value={object.target.name}
              onChange={(event) => onPatch({ target: { ...object.target, name: event.target.value } } as Partial<HmiObject>)}
            />
          </Form.Item>
        ) : null}
        {object.target.type === "lw" ? (
          <Form.Item label="LW Address">
            <InputNumber
              style={{ width: "100%" }}
              min={0}
              value={object.target.address}
              onChange={(value) =>
                onPatch({ target: { ...object.target, address: Math.max(0, Math.floor(Number(value ?? 0))) } } as Partial<HmiObject>)
              }
            />
          </Form.Item>
        ) : null}
        {object.target.type === "tag" ? (
          <TagFieldWithBindingSource
            project={project}
            bindings={templateBindings}
            value={object.target.tag}
            bindingLabel="Target Binding"
            tagLabel="Target Tag"
            indexControl={buildIndexControl("target.tag", "Target Tag", object.target.tag)}
            onChange={(nextValue) => onPatch({ target: { ...object.target, tag: nextValue } } as Partial<HmiObject>)}
          />
        ) : null}
        <Form.Item label="Options (one per line: label|value)">
          <Input.TextArea
            rows={5}
            value={optionsText}
            onChange={(event) => {
              const lines = event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
              const options = lines.map((line, index) => {
                const [labelToken, valueToken] = line.split("|");
                const label = (labelToken ?? `Option ${index + 1}`).trim();
                const rawValue = (valueToken ?? label).trim();
                let parsed: string | number | boolean = rawValue;
                if (object.valueType === "number") {
                  parsed = Number(rawValue);
                } else if (object.valueType === "boolean") {
                  parsed = rawValue.toLowerCase() === "true";
                }
                return {
                  label,
                  value: parsed,
                };
              });
              onPatch({ options } as Partial<HmiObject>);
            }}
          />
        </Form.Item>
      </>
    );
  }

  if (object.type === "image") {
    const imageRunMacroAction = object.action?.type === "runMacro" ? object.action : undefined;
    const imageWriteAction = object.action?.type === "write" ? object.action : undefined;
    const imagePulseAction = object.action?.type === "pulse" ? object.action : undefined;
    const imageToggleAction = object.action?.type === "toggle" ? object.action : undefined;
    const imageOpenScreenAction = object.action?.type === "openScreen" ? object.action : undefined;
    const imageOpenPopupAction = object.action?.type === "openPopup" ? object.action : undefined;
    return (
      <>
        <Form.Item label="Asset">
          <Select
            value={object.assetId}
            allowClear
            options={assetOptions}
            onChange={(value) => onPatch({ assetId: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Fallback src">
          <Input value={object.src ?? ""} onChange={(e) => onPatch({ src: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Action Type">
          <Select
            value={object.action?.type ?? "none"}
            options={[
              { label: "none", value: "none" },
              { label: "write", value: "write" },
              { label: "pulse", value: "pulse" },
              { label: "toggle", value: "toggle" },
              { label: "openScreen", value: "openScreen" },
              { label: "openPopup", value: "openPopup" },
              { label: "runMacro", value: "runMacro" },
            ]}
            onChange={(value) => {
              if (value === "none") {
                onPatch({ action: undefined } as Partial<HmiObject>);
                return;
              }
              if (value === "write") {
                onPatch({ action: { type: "write", tag: "", value: true } } as Partial<HmiObject>);
                return;
              }
              if (value === "pulse") {
                onPatch({ action: { type: "pulse", tag: "", value: true, durationMs: 500 } } as Partial<HmiObject>);
                return;
              }
              if (value === "toggle") {
                onPatch({ action: { type: "toggle", tag: "" } } as Partial<HmiObject>);
                return;
              }
              if (value === "openScreen") {
                onPatch({ action: { type: "openScreen", screenId: project.screens[0]?.id ?? "" } } as Partial<HmiObject>);
                return;
              }
              if (value === "openPopup") {
                const popup = project.screens.find((s) => s.kind === "popup");
                onPatch({ action: { type: "openPopup", popupScreenId: popup?.id ?? "" } } as Partial<HmiObject>);
                return;
              }
              onPatch({ action: { type: "runMacro", macroId: "" } } as Partial<HmiObject>);
            }}
          />
        </Form.Item>
        <ActionAccessFields
          action={object.action}
          onChange={(nextAction) => onPatch({ action: nextAction } as Partial<HmiObject>)}
        />
        {imageWriteAction ? (
          <>
            <TagFieldWithBindingSource
              project={project}
              bindings={templateBindings}
              value={imageWriteAction.tag}
              bindingLabel="Action Binding"
              tagLabel="Action Tag"
              indexControl={buildIndexControl("action.tag", "Action Tag", imageWriteAction.tag)}
              onChange={(nextValue) =>
                onPatch({
                  action: {
                    ...imageWriteAction,
                    tag: nextValue,
                  },
                } as Partial<HmiObject>)
              }
            />
            <Form.Item label="Write Value">
              <Input
                value={stringifyRuntimeActionValue(imageWriteAction.value)}
                onChange={(event) =>
                  onPatch({
                    action: {
                      ...imageWriteAction,
                      value: parseRuntimeActionValue(event.target.value),
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
          </>
        ) : null}
        {imagePulseAction ? (
          <>
            <TagFieldWithBindingSource
              project={project}
              bindings={templateBindings}
              value={imagePulseAction.tag}
              bindingLabel="Action Binding"
              tagLabel="Action Tag"
              indexControl={buildIndexControl("action.tag", "Action Tag", imagePulseAction.tag)}
              onChange={(nextValue) =>
                onPatch({
                  action: {
                    ...imagePulseAction,
                    tag: nextValue,
                  },
                } as Partial<HmiObject>)
              }
            />
            <Form.Item label="Pulse Value">
              <Input
                value={stringifyRuntimeActionValue(imagePulseAction.value)}
                onChange={(event) =>
                  onPatch({
                    action: {
                      ...imagePulseAction,
                      value: parseRuntimeActionValue(event.target.value),
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
            <Form.Item label="Duration (ms)">
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                value={imagePulseAction.durationMs}
                onChange={(value) =>
                  onPatch({
                    action: {
                      ...imagePulseAction,
                      durationMs: Math.max(1, Number(value ?? 1)),
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
          </>
        ) : null}
        {imageToggleAction ? (
          <TagFieldWithBindingSource
            project={project}
            bindings={templateBindings}
            value={imageToggleAction.tag}
            bindingLabel="Action Binding"
            tagLabel="Action Tag"
            indexControl={buildIndexControl("action.tag", "Action Tag", imageToggleAction.tag)}
            onChange={(nextValue) =>
              onPatch({
                action: {
                  ...imageToggleAction,
                  tag: nextValue,
                },
              } as Partial<HmiObject>)
            }
          />
        ) : null}
        {imageOpenScreenAction ? (
          <Form.Item label="Screen">
            <Select
              value={imageOpenScreenAction.screenId}
              options={project.screens.map((screen) => ({ label: `${screen.name} (${screen.kind})`, value: screen.id }))}
              onChange={(value) =>
                onPatch({
                  action: {
                    ...imageOpenScreenAction,
                    screenId: value,
                  },
                } as Partial<HmiObject>)
              }
            />
          </Form.Item>
        ) : null}
        {imageOpenPopupAction ? (
          <>
            <Form.Item label="Popup">
              <Select
                value={imageOpenPopupAction.popupScreenId}
                options={project.screens
                  .filter((screen) => screen.kind === "popup")
                  .map((screen) => ({ label: screen.name, value: screen.id }))}
                onChange={(value) =>
                  onPatch({
                    action: {
                      ...imageOpenPopupAction,
                      popupScreenId: value,
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
            <Form.Item label="Popup Title">
              <Input
                value={imageOpenPopupAction.title ?? ""}
                onChange={(event) =>
                  onPatch({
                    action: {
                      ...imageOpenPopupAction,
                      title: event.target.value,
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
            <Form.Item label="Popup Tag Prefix">
              <Input
                value={imageOpenPopupAction.tagPrefix ?? ""}
                onChange={(event) =>
                  onPatch({
                    action: {
                      ...imageOpenPopupAction,
                      tagPrefix: event.target.value,
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
            <Form.Item label="Popup Args (JSON)">
              <Input.TextArea
                rows={3}
                value={JSON.stringify(imageOpenPopupAction.args ?? {}, null, 2)}
                onChange={(event) => {
                  try {
                    const parsed = JSON.parse(event.target.value) as Record<string, unknown>;
                    onPatch({
                      action: {
                        ...imageOpenPopupAction,
                        args: parsed,
                      },
                    } as Partial<HmiObject>);
                  } catch {
                    // ignore invalid JSON while typing
                  }
                }}
              />
            </Form.Item>
          </>
        ) : null}
        {imageRunMacroAction ? (
          <>
            <Form.Item label="Macro">
              <Select
                value={imageRunMacroAction.macroId}
                options={(project.macros ?? []).map((item) => ({ label: item.name, value: item.id }))}
                onChange={(value) =>
                  onPatch({
                    action: {
                      ...imageRunMacroAction,
                      macroId: value,
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
            {(() => {
              const macro = (project.macros ?? []).find((item) => item.id === imageRunMacroAction.macroId);
              if (!macro) {
                return <Tag color="red">Macro missing</Tag>;
              }
              if ((macro.enabled ?? true) === false) {
                return <Tag color="gold">Macro disabled</Tag>;
              }
              return <Tag color="green">Macro enabled</Tag>;
            })()}
          </>
        ) : null}
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.stateTag ?? ""}
          bindingLabel="State Binding"
          tagLabel="State Tag"
          indexControl={buildIndexControl("stateTag", "State Tag", object.stateTag)}
          onChange={(nextValue) => onPatch({ stateTag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="State Images (JSON)">
          <Input.TextArea
            rows={4}
            value={JSON.stringify(object.stateImages ?? [], null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value) as Array<{ state: string | number | boolean; assetId?: string; src?: string }>;
                onPatch({ stateImages: parsed } as Partial<HmiObject>);
              } catch {
                // ignore while typing invalid JSON
              }
            }}
          />
        </Form.Item>
        <Form.Item label="Fit">
          <Select
            value={object.fit}
            options={[
              { label: "contain", value: "contain" },
              { label: "cover", value: "cover" },
              { label: "stretch", value: "stretch" },
              { label: "none", value: "none" },
            ]}
            onChange={(value) => onPatch({ fit: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Space>
          <span>Preserve Aspect Ratio</span>
          <Switch
            checked={object.preserveAspectRatio ?? true}
            onChange={(checked) => onPatch({ preserveAspectRatio: checked } as Partial<HmiObject>)}
          />
        </Space>
      </>
    );
  }

  if (object.type === "stateImage") {
    const stateImageRunMacroAction = object.action?.type === "runMacro" ? object.action : undefined;
    const activeState = object.states.find((state) => matchStateImageCondition(state.condition, stateImagePreviewValue));
    const previewAssetId = activeState?.assetId ?? object.defaultAssetId;
    const previewAsset = assets.find((asset) => asset.id === previewAssetId);
    return (
      <>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.tag}
          bindingLabel="Source Binding"
          tagLabel="Source Tag"
          indexControl={buildIndexControl("tag", "Main Tag", object.tag)}
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="Default Asset">
          <Select
            value={object.defaultAssetId}
            allowClear
            options={assetOptions}
            onChange={(value) => onPatch({ defaultAssetId: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Bad Quality Asset">
          <Select
            value={object.badQualityAssetId}
            allowClear
            options={assetOptions}
            onChange={(value) => onPatch({ badQualityAssetId: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Typography.Text strong>States</Typography.Text>
        <Button
          size="small"
          onClick={() =>
            onPatch({
              states: [
                ...object.states,
                {
                  id: `state_${Math.random().toString(36).slice(2, 8)}`,
                  name: `State ${object.states.length}`,
                  condition: { type: "equals", value: object.states.length },
                  assetId: "",
                },
              ],
            } as Partial<HmiObject>)
          }
        >
          Add State
        </Button>
        {object.states.map((state) => (
          <Space key={state.id} direction="vertical" style={{ width: "100%", border: "1px solid #f0f0f0", borderRadius: 8, padding: 8 }}>
            <Space wrap style={{ width: "100%" }}>
              <Input
                style={{ width: 170 }}
                value={state.name}
                placeholder="State name"
                onChange={(event) =>
                  onPatch({
                    states: object.states.map((item) => (item.id === state.id ? { ...item, name: event.target.value } : item)),
                  } as Partial<HmiObject>)
                }
              />
              <Select
                style={{ width: 130 }}
                value={state.condition.type}
                options={[
                  { label: "equals", value: "equals" },
                  { label: "notEquals", value: "notEquals" },
                  { label: "true", value: "true" },
                  { label: "false", value: "false" },
                ]}
                onChange={(value) => {
                  if (value === "true" || value === "false") {
                    onPatch({
                      states: object.states.map((item) =>
                        item.id === state.id ? { ...item, condition: { type: value } } : item,
                      ),
                    } as Partial<HmiObject>);
                    return;
                  }
                  onPatch({
                    states: object.states.map((item) =>
                      item.id === state.id
                        ? { ...item, condition: { type: value, value: "value" } }
                        : item,
                    ),
                  } as Partial<HmiObject>);
                }}
              />
              {state.condition.type === "equals" || state.condition.type === "notEquals" ? (
                <Input
                  style={{ width: 120 }}
                  value={String(state.condition.value ?? "")}
                  placeholder="Value"
                  onChange={(event) =>
                    onPatch({
                      states: object.states.map((item) =>
                        item.id === state.id
                          ? {
                              ...item,
                              condition: {
                                ...item.condition,
                                value: parseConditionValue(event.target.value),
                              },
                            }
                          : item,
                      ),
                    } as Partial<HmiObject>)
                  }
                />
              ) : null}
              <Select
                style={{ minWidth: 220 }}
                value={state.assetId}
                placeholder="Select asset"
                options={assetOptions}
                onChange={(value) =>
                  onPatch({
                    states: object.states.map((item) => (item.id === state.id ? { ...item, assetId: value } : item)),
                  } as Partial<HmiObject>)
                }
              />
              <Button
                danger
                size="small"
                onClick={() =>
                  onPatch({
                    states: object.states.filter((item) => item.id !== state.id),
                  } as Partial<HmiObject>)
                }
              >
                Delete
              </Button>
            </Space>
          </Space>
        ))}
        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Preview</Typography.Text>
        <Input
          value={stateImagePreviewValue}
          placeholder="Test value"
          onChange={(event) => setStateImagePreviewValue(event.target.value)}
        />
        <Typography.Text type="secondary">
          Active state: {activeState?.name ?? "default"} | asset: {previewAsset ? getAssetDisplayPath(previewAsset) : previewAssetId ?? "none"}
        </Typography.Text>
        <Form.Item label="Action Type">
          <Select
            value={object.action?.type ?? "none"}
            options={[
              { label: "none", value: "none" },
              { label: "runMacro", value: "runMacro" },
            ]}
            onChange={(value) => {
              if (value === "none") {
                onPatch({ action: undefined } as Partial<HmiObject>);
                return;
              }
              onPatch({ action: { type: "runMacro", macroId: "" } } as Partial<HmiObject>);
            }}
          />
        </Form.Item>
        <ActionAccessFields
          action={object.action}
          onChange={(nextAction) => onPatch({ action: nextAction } as Partial<HmiObject>)}
        />
        {stateImageRunMacroAction ? (
          <>
            <Form.Item label="Macro">
              <Select
                value={stateImageRunMacroAction.macroId}
                options={(project.macros ?? []).map((item) => ({ label: item.name, value: item.id }))}
                onChange={(value) =>
                  onPatch({
                    action: {
                      ...stateImageRunMacroAction,
                      macroId: value,
                    },
                  } as Partial<HmiObject>)
                }
              />
            </Form.Item>
            {(() => {
              const macro = (project.macros ?? []).find((item) => item.id === stateImageRunMacroAction.macroId);
              if (!macro) {
                return <Tag color="red">Macro missing</Tag>;
              }
              if ((macro.enabled ?? true) === false) {
                return <Tag color="gold">Macro disabled</Tag>;
              }
              return <Tag color="green">Macro enabled</Tag>;
            })()}
          </>
        ) : null}
      </>
    );
  }

  if (object.type === "numeric-image-indicator") {
    const normalizedStates = (object.states ?? [])
      .slice(0, 100)
      .map((state) => ({
        index: Math.max(0, Math.floor(Number(state.index) || 0)),
        assetId: state.assetId,
      }))
      .sort((left, right) => left.index - right.index);
    const stateLimitReached = normalizedStates.length >= 100;
    const lastIndex = normalizedStates.length > 0 ? normalizedStates[normalizedStates.length - 1]!.index : -1;

    const numericImageGeneralContent = (
      <>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.tag ?? ""}
          bindingLabel="Source Binding"
          tagLabel="Source Tag"
          indexControl={buildIndexControl("tag", "Source Tag", object.tag)}
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="Default Asset">
          <Select
            value={object.defaultAssetId}
            allowClear
            options={assetOptions}
            onChange={(value) => onPatch({ defaultAssetId: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Bad Quality Asset">
          <Select
            value={object.badQualityAssetId}
            allowClear
            options={assetOptions}
            onChange={(value) => onPatch({ badQualityAssetId: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Fit">
          <Select
            value={object.fit}
            options={[
              { label: "contain", value: "contain" },
              { label: "cover", value: "cover" },
              { label: "stretch", value: "stretch" },
              { label: "none", value: "none" },
            ]}
            onChange={(value) => onPatch({ fit: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Space style={{ marginBottom: 8 }}>
          <span>Preserve Aspect Ratio</span>
          <Switch
            checked={object.preserveAspectRatio ?? true}
            onChange={(checked) => onPatch({ preserveAspectRatio: checked } as Partial<HmiObject>)}
          />
        </Space>
        <Form.Item label="Out of Range Mode">
          <Select
            value={object.outOfRangeMode ?? "default"}
            options={[
              { label: "default", value: "default" },
              { label: "clamp", value: "clamp" },
            ]}
            onChange={(value) => onPatch({ outOfRangeMode: value } as Partial<HmiObject>)}
          />
        </Form.Item>
      </>
    );

    const numericImageStatesContent = (
      <>
        <div className="object-property-panel__states-header">
          <Typography.Text strong>States (max 100)</Typography.Text>
          <Button
            size="small"
            disabled={stateLimitReached}
            onClick={() =>
              onPatch({
                states: [
                  ...normalizedStates,
                  {
                    index: lastIndex + 1,
                    assetId: undefined,
                  },
                ],
              } as Partial<HmiObject>)
            }
          >
            Add State
          </Button>
        </div>
        {stateLimitReached ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Maximum number of states reached.
          </Typography.Text>
        ) : null}
        {normalizedStates.map((state, rowIndex) => (
          <div key={`${state.index}-${rowIndex}`} className="object-property-panel__state-row">
            <InputNumber
              style={{ width: "100%" }}
              min={0}
              step={1}
              precision={0}
              value={state.index}
              onChange={(value) => {
                const nextStates = normalizedStates.map((item, index) => (index === rowIndex
                  ? { ...item, index: Math.max(0, Math.floor(Number(value ?? 0))) }
                  : item));
                onPatch({ states: nextStates.sort((left, right) => left.index - right.index) } as Partial<HmiObject>);
              }}
            />
            <Select
              style={{ width: "100%" }}
              allowClear
              value={state.assetId}
              placeholder="Select asset"
              options={assetOptions}
              onChange={(value) => {
                const nextStates = normalizedStates.map((item, index) => (index === rowIndex
                  ? { ...item, assetId: value }
                  : item));
                onPatch({ states: nextStates } as Partial<HmiObject>);
              }}
            />
            <button
              type="button"
              className="screen-editor-library-interface__row-delete"
              title="Delete state"
              aria-label="Delete state"
              onClick={() => onPatch({ states: normalizedStates.filter((_, index) => index !== rowIndex) } as Partial<HmiObject>)}
            >
              ×
            </button>
          </div>
        ))}
      </>
    );

    return (
      <Tabs
        size="small"
        className="object-property-tabs object-property-tabs--main"
        items={[
          { key: "general", label: "General", children: numericImageGeneralContent },
          { key: "states", label: "States", children: numericImageStatesContent },
        ]}
      />
    );
  }

  if (object.type === "libraryElementInstance") {
    const selectedLibrary = libraries.find((library) => library.id === object.libraryId);
    const selectedElement = selectedLibrary?.elements.find((element) => element.id === object.elementId);
    const parameterValues = object.parameterValues ?? {};
    const bindingAssignments = object.bindingAssignments ?? {};
    const bindingDefinitions = selectedElement?.bindings ?? [];
    const knownTags = new Set(project.tags.map((tag) => tag.name));
    const editorTagValues = buildEditorRuntimeTagValues(project);
    const runtimeResolveContext: RuntimeResolveContext = {
      tagValues: editorTagValues,
    };
    const bindingDebug = selectedElement
      ? resolveLibraryElementInstanceBindingsDetailed(selectedElement, object, runtimeResolveContext)
      : undefined;

    const patchBindingAssignment = (bindingKey: string, patch: Partial<NonNullable<typeof bindingAssignments>[string]>) => {
      const current = bindingAssignments[bindingKey] ?? {
        baseTag: "",
        prefixMode: { type: "none" as const },
        indexMode: { type: "none" as const },
      };
      onPatch({
        bindingAssignments: {
          ...bindingAssignments,
          [bindingKey]: {
            ...current,
            ...patch,
          },
        },
      } as Partial<HmiObject>);
    };

    const getConnectedTagStatus = (binding: ElementBindingDefinition) => {
      const debug = bindingDebug?.debug[binding.key];
      const resolvedTag = debug?.resolvedTag?.trim() || "";
      const required = binding.required ?? false;
      if (required && !resolvedTag) {
        return { label: "missing required", color: "red" as const };
      }
      if (!resolvedTag) {
        return { label: "not assigned", color: "default" as const };
      }
      if (knownTags.has(resolvedTag)) {
        return { label: "OK", color: "green" as const };
      }
      return { label: "tag not found", color: "gold" as const };
    };

    return (
      <>
        <Form.Item label="Scale Mode">
          <Select
            value={object.scaleMode ?? "fit"}
            options={[
              { label: "none", value: "none" },
              { label: "fit", value: "fit" },
              { label: "stretch", value: "stretch" },
            ]}
            onChange={(value) => onPatch({ scaleMode: value } as Partial<HmiObject>)}
          />
        </Form.Item>

        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Connected Tags</Typography.Text>
        {bindingDefinitions.length ? (
          <div className="screen-editor-connected-tags">
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              {bindingDefinitions.map((binding) => {
                const assignment = bindingAssignments[binding.key] ?? {
                  baseTag: "",
                  prefixMode: { type: "none" as const },
                  indexMode: { type: "none" as const },
                };
                const status = getConnectedTagStatus(binding);
                const debug = bindingDebug?.debug[binding.key];
                const indexEnabled = assignment.indexMode?.type === "arrayIndex" || assignment.indexMode?.type === "arrayIndexBySegment";
                const hasArrayIndexInTag = /\[-?\d+\]/.test(assignment.baseTag || "");

                return (
                  <Space key={binding.id} direction="vertical" style={{ width: "100%", border: "1px solid #303030", borderRadius: 8, padding: 8 }}>
                    <Space wrap>
                      <Typography.Text>{binding.displayName}</Typography.Text>
                      <Typography.Text type="secondary">({binding.key})</Typography.Text>
                      <Tag>{getBindingKindLabel(binding.kind)}</Tag>
                      {(binding.required ?? false) ? <Tag color="red">Required</Tag> : null}
                      <Tag color={status.color}>{status.label}</Tag>
                    </Space>
                    <TagFieldWithBindingSource
                      project={project}
                      bindings={[]}
                      value={assignment.baseTag}
                      tagLabel={getBindingTagLabel(binding.kind)}
                      indexControl={{
                        enabled: indexEnabled,
                        status: indexEnabled ? (hasArrayIndexInTag ? "OK" : "Not found") : "Not configured",
                        configureDisabled: !(assignment.baseTag?.trim()),
                        onConfigure: () => {
                          if (!indexEnabled) {
                            patchBindingAssignment(binding.key, {
                              indexMode: {
                                type: "arrayIndex",
                                occurrence: 0,
                                operation: "add",
                                valueFrom: "indexOffset",
                              },
                              indexOffset: assignment.indexOffset ?? 0,
                            });
                          }
                        },
                        onToggleEnabled: (checked: boolean) => {
                          if (!checked) {
                            patchBindingAssignment(binding.key, { indexMode: { type: "none" } });
                            return;
                          }
                          patchBindingAssignment(binding.key, {
                            indexMode: {
                              type: "arrayIndex",
                              occurrence: 0,
                              operation: "add",
                              valueFrom: "indexOffset",
                            },
                            indexOffset: assignment.indexOffset ?? 0,
                          });
                        },
                      }}
                      onChange={(nextValue) => patchBindingAssignment(binding.key, { baseTag: nextValue })}
                    />
                    {indexEnabled ? (
                      <Form.Item label="Index offset">
                        <InputNumber
                          style={{ width: "100%" }}
                          value={assignment.indexOffset ?? 0}
                          onChange={(value) => patchBindingAssignment(binding.key, { indexOffset: Number(value ?? 0) })}
                        />
                      </Form.Item>
                    ) : null}
                    {indexEnabled && !hasArrayIndexInTag ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        Index offset is enabled, but base tag has no array token like [0].
                      </Typography.Text>
                    ) : null}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Resolved: {debug?.resolvedTag?.trim() ? debug.resolvedTag : "—"}
                    </Typography.Text>
                  </Space>
                );
              })}
            </Space>
          </div>
        ) : (
          <Typography.Text type="secondary">
            This library element has no Signals. It can still be used visually, but there are no external tags to map for this instance.
            Add Signals in Libraries -&gt; Interface.
          </Typography.Text>
        )}

        {selectedElement?.parameters?.length ? (
          <>
            <Typography.Text type="secondary">
              Parameters
            </Typography.Text>
            {selectedElement.parameters.map((parameter) => {
              const currentValue = parameterValues[parameter.name] ?? parameter.defaultValue;
              if (parameter.type === "boolean") {
                return (
                  <Form.Item key={parameter.name} label={parameter.displayName ?? parameter.name}>
                    <Switch
                      checked={Boolean(currentValue)}
                      onChange={(checked) =>
                        onPatch({
                          parameterValues: {
                            ...parameterValues,
                            [parameter.name]: checked,
                          },
                        } as Partial<HmiObject>)
                      }
                    />
                  </Form.Item>
                );
              }

              if (parameter.type === "number" || parameter.type === "index") {
                return (
                  <Form.Item key={parameter.name} label={parameter.displayName ?? parameter.name}>
                    <InputNumber
                      style={{ width: "100%" }}
                      value={typeof currentValue === "number" ? currentValue : Number(currentValue ?? 0)}
                      onChange={(value) =>
                        onPatch({
                          parameterValues: {
                            ...parameterValues,
                            [parameter.name]: Number(value ?? 0),
                          },
                        } as Partial<HmiObject>)
                      }
                    />
                  </Form.Item>
                );
              }

              if (parameter.type === "tag") {
                return (
                  <Form.Item key={parameter.name} label={parameter.displayName ?? parameter.name}>
                    <Input
                      value={String(currentValue ?? "")}
                      placeholder='Tag name (supports relative ".State")'
                      onChange={(e) =>
                        onPatch({
                          parameterValues: {
                            ...parameterValues,
                            [parameter.name]: e.target.value,
                          },
                        } as Partial<HmiObject>)
                      }
                    />
                  </Form.Item>
                );
              }

              return (
                <Form.Item key={parameter.name} label={parameter.displayName ?? parameter.name}>
                  <Input
                    value={String(currentValue ?? "")}
                    onChange={(e) =>
                      onPatch({
                        parameterValues: {
                          ...parameterValues,
                          [parameter.name]: e.target.value,
                        },
                      } as Partial<HmiObject>)
                    }
                  />
                </Form.Item>
              );
            })}
          </>
        ) : (
          <Typography.Text type="secondary">No parameters.</Typography.Text>
        )}
      </>
    );
  }
  if (object.type === "valve") {
    return (
      <>
        <Form.Item label="Label">
          <Input value={object.label ?? ""} onChange={(e) => onPatch({ label: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.openTag ?? ""}
          bindingLabel="Open Binding"
          tagLabel="Open Tag"
          indexControl={buildIndexControl("openTag", "Open Tag", object.openTag)}
          onChange={(nextValue) => onPatch({ openTag: nextValue } as Partial<HmiObject>)}
        />
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.closedTag ?? ""}
          bindingLabel="Closed Binding"
          tagLabel="Closed Tag"
          indexControl={buildIndexControl("closedTag", "Closed Tag", object.closedTag)}
          onChange={(nextValue) => onPatch({ closedTag: nextValue } as Partial<HmiObject>)}
        />
      </>
    );
  }

  if (object.type === "pump") {
    return (
      <>
        <Form.Item label="Label">
          <Input value={object.label ?? ""} onChange={(e) => onPatch({ label: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.runTag ?? ""}
          bindingLabel="Run Binding"
          tagLabel="Run Tag"
          indexControl={buildIndexControl("runTag", "Run Tag", object.runTag)}
          onChange={(nextValue) => onPatch({ runTag: nextValue } as Partial<HmiObject>)}
        />
      </>
    );
  }

  if (object.type === "frame") {
    const options = project.screens.map((screen) => ({ label: `${screen.name} (${screen.kind})`, value: screen.id }));
    return (
      <>
        <Form.Item label="Frame Screen">
          <Select value={object.screenId} options={options} onChange={(value) => onPatch({ screenId: value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Tag Prefix">
          <Input value={object.tagPrefix ?? ""} onChange={(e) => onPatch({ tagPrefix: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Prefix is kept for compatibility. Use Indexed Address for arrays and structures.
        </Typography.Text>
        <Form.Item label="Scale Mode">
          <Select
            value={object.scaleMode ?? "fit"}
            options={[
              { label: "none", value: "none" },
              { label: "fit", value: "fit" },
              { label: "stretch", value: "stretch" },
            ]}
            onChange={(value) => onPatch({ scaleMode: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Space>
          <span>Clip</span>
          <Switch checked={object.clipContent ?? true} onChange={(checked) => onPatch({ clipContent: checked } as Partial<HmiObject>)} />
        </Space>
        <Space style={{ marginLeft: 12 }}>
          <span>Border</span>
          <Switch checked={object.showBorder ?? true} onChange={(checked) => onPatch({ showBorder: checked } as Partial<HmiObject>)} />
        </Space>
        <ColorField label="Border Color" value={object.borderColor ?? "#888"} fallback="#888888" onChange={(next) => onPatch({ borderColor: next } as Partial<HmiObject>)} />
        <Form.Item label="Border Width">
          <InputNumber style={{ width: "100%" }} value={object.borderWidth ?? 1} onChange={(v) => onPatch({ borderWidth: Number(v ?? 1) } as Partial<HmiObject>)} />
        </Form.Item>
      </>
    );
  }

  if (object.type === "checkbox") {
    const writeMode = object.writeMode ?? "toggleState";
    const isPulseWriteMode = writeMode === "pulseTrue" || writeMode === "pulseFalse";
    return (
      <>
        <Form.Item label="Label">
          <Input value={object.label ?? ""} onChange={(e) => onPatch({ label: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.tag ?? ""}
          bindingLabel="Tag Binding"
          tagLabel="Read Tag"
          indexControl={buildIndexControl("tag", "Read Tag", object.tag)}
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.writeTag ?? ""}
          bindingLabel="Write Binding"
          tagLabel="Write Tag"
          indexControl={buildIndexControl("writeTag", "Write Tag", object.writeTag)}
          onChange={(nextValue) => onPatch({ writeTag: nextValue } as Partial<HmiObject>)}
        />
        <Typography.Text strong>Command / Write</Typography.Text>
        <Form.Item label="Write Mode">
          <Select
            value={writeMode}
            options={[
              { label: "Toggle State", value: "toggleState" },
              { label: "Write True", value: "writeTrue" },
              { label: "Write False", value: "writeFalse" },
              { label: "Pulse True", value: "pulseTrue" },
              { label: "Pulse False", value: "pulseFalse" },
            ]}
            onChange={(value) => onPatch({ writeMode: value as CheckboxWriteMode } as Partial<HmiObject>)}
          />
        </Form.Item>
        {isPulseWriteMode ? (
          <Form.Item label="Pulse Duration (ms)">
            <InputNumber
              style={{ width: "100%" }}
              min={1}
              value={object.pulseDurationMs ?? 300}
              onChange={(value) => onPatch({ pulseDurationMs: Math.max(1, Math.floor(Number(value ?? 300))) } as Partial<HmiObject>)}
            />
          </Form.Item>
        ) : null}
        <Form.Item label="Checked Text">
          <Input value={object.checkedText ?? "On"} onChange={(e) => onPatch({ checkedText: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Unchecked Text">
          <Input value={object.uncheckedText ?? "Off"} onChange={(e) => onPatch({ uncheckedText: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <ColorField label="Checked Color" value={object.checkedColor ?? "#0e639c"} fallback="#0e639c" onChange={(next) => onPatch({ checkedColor: next } as Partial<HmiObject>)} />
        <ColorField label="Unchecked Color" value={object.uncheckedColor ?? "#3c3c3c"} fallback="#3c3c3c" onChange={(next) => onPatch({ uncheckedColor: next } as Partial<HmiObject>)} />
      </>
    );
  }

  if (object.type === "slider") {
    return (
      <>
        <Typography.Text strong>Value / Data</Typography.Text>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.tag ?? ""}
          bindingLabel="Tag Binding"
          tagLabel="Read Tag"
          indexControl={buildIndexControl("tag", "Read Tag", object.tag)}
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.writeTag ?? ""}
          bindingLabel="Write Binding"
          tagLabel="Write Tag"
          indexControl={buildIndexControl("writeTag", "Write Tag", object.writeTag)}
          onChange={(nextValue) => onPatch({ writeTag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="Min">
          <InputNumber style={{ width: "100%" }} value={object.min ?? 0} onChange={(v) => onPatch({ min: Number(v ?? 0) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Max">
          <InputNumber style={{ width: "100%" }} value={object.max ?? 100} onChange={(v) => onPatch({ max: Number(v ?? 100) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Step">
          <InputNumber style={{ width: "100%" }} value={object.step ?? 1} onChange={(v) => onPatch({ step: Number(v ?? 1) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Decimals">
          <InputNumber style={{ width: "100%" }} min={0} max={10} value={object.decimals ?? 1} onChange={(v) => onPatch({ decimals: Math.max(0, Number(v ?? 1)) } as Partial<HmiObject>)} />
        </Form.Item>
        <Space>
          <span>Write On Release</span>
          <Switch checked={object.writeOnRelease ?? false} onChange={(checked) => onPatch({ writeOnRelease: checked } as Partial<HmiObject>)} />
        </Space>
        <Form.Item label="Drag Write Interval (ms)">
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            max={1000}
            value={object.dragWriteIntervalMs ?? 50}
            onChange={(v) => onPatch({ dragWriteIntervalMs: Math.max(0, Number(v ?? 50)) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Release Sync Hold (ms)">
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            max={10000}
            value={object.releaseSyncHoldMs ?? 2500}
            onChange={(v) => onPatch({ releaseSyncHoldMs: Math.max(0, Number(v ?? 2500)) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Orientation">
          <Select
            value={object.orientation ?? "horizontal"}
            options={[{ label: "horizontal", value: "horizontal" }, { label: "vertical", value: "vertical" }]}
            onChange={(value) => onPatch({ orientation: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Unit">
          <Input value={object.unit ?? ""} onChange={(e) => onPatch({ unit: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Space>
          <span>Show Value</span>
          <Switch checked={object.showValue ?? true} onChange={(checked) => onPatch({ showValue: checked } as Partial<HmiObject>)} />
        </Space>
        <Form.Item label="Value Position">
          <Select
            value={object.valuePosition ?? "bottom"}
            options={[
              { label: "top", value: "top" },
              { label: "bottom", value: "bottom" },
              { label: "left", value: "left" },
              { label: "right", value: "right" },
              { label: "center", value: "center" },
              { label: "hidden", value: "hidden" },
            ]}
            onChange={(value) => onPatch({ valuePosition: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Space>
          <span>Show Min/Max</span>
          <Switch checked={object.showMinMax ?? false} onChange={(checked) => onPatch({ showMinMax: checked } as Partial<HmiObject>)} />
        </Space>
        <Form.Item label="Min/Max Font Size">
          <InputNumber style={{ width: "100%" }} min={6} max={48} value={object.minMaxFontSize ?? 10} onChange={(v) => onPatch({ minMaxFontSize: Number(v ?? 10) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Min Label Offset">
          <InputNumber style={{ width: "100%" }} min={0} max={40} value={object.minLabelOffset ?? 2} onChange={(v) => onPatch({ minLabelOffset: Number(v ?? 2) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Max Label Offset">
          <InputNumber style={{ width: "100%" }} min={0} max={40} value={object.maxLabelOffset ?? 2} onChange={(v) => onPatch({ maxLabelOffset: Number(v ?? 2) } as Partial<HmiObject>)} />
        </Form.Item>
        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Appearance</Typography.Text>
        <ColorField label="Fill Color" value={object.fillColor ?? "#0e639c"} fallback="#0e639c" onChange={(next) => onPatch({ fillColor: next } as Partial<HmiObject>)} />
        <ColorField label="Track Color" value={object.trackColor ?? "#2d2d2d"} fallback="#2d2d2d" onChange={(next) => onPatch({ trackColor: next } as Partial<HmiObject>)} />
        <ColorField label="Thumb Color" value={object.thumbColor ?? "#d9d9d9"} fallback="#d9d9d9" onChange={(next) => onPatch({ thumbColor: next } as Partial<HmiObject>)} />
        <ColorField label="Background Color" value={object.backgroundColor ?? "#1e1e1e"} fallback="#1e1e1e" onChange={(next) => onPatch({ backgroundColor: next } as Partial<HmiObject>)} />
        <Space style={{ marginBottom: 8 }}>
          <span>Transparent Background</span>
          <Switch checked={object.transparentBackground ?? false} onChange={(checked) => onPatch({ transparentBackground: checked } as Partial<HmiObject>)} />
        </Space>
        <ColorField label="Border Color" value={object.borderColor ?? "#3c3c3c"} fallback="#3c3c3c" onChange={(next) => onPatch({ borderColor: next } as Partial<HmiObject>)} />
        <Form.Item label="Border Width">
          <InputNumber style={{ width: "100%" }} min={0} max={6} value={object.borderWidth ?? 1} onChange={(v) => onPatch({ borderWidth: Number(v ?? 1) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Corner Radius">
          <InputNumber style={{ width: "100%" }} min={0} max={20} value={object.cornerRadius ?? 4} onChange={(v) => onPatch({ cornerRadius: Number(v ?? 4) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Track Thickness">
          <InputNumber style={{ width: "100%" }} min={1} max={24} value={object.trackThickness ?? 4} onChange={(v) => onPatch({ trackThickness: Number(v ?? 4) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Thumb Radius">
          <InputNumber style={{ width: "100%" }} min={2} max={32} value={object.thumbRadius ?? 7} onChange={(v) => onPatch({ thumbRadius: Number(v ?? 7) } as Partial<HmiObject>)} />
        </Form.Item>
        <ColorField label="Thumb Border Color" value={object.thumbBorderColor ?? "#3c3c3c"} fallback="#3c3c3c" onChange={(next) => onPatch({ thumbBorderColor: next } as Partial<HmiObject>)} />
        <ColorField label="Text Color" value={object.textColor ?? "#cccccc"} fallback="#cccccc" onChange={(next) => onPatch({ textColor: next } as Partial<HmiObject>)} />
        <Form.Item label="Font Family">
          <Select
            value={object.fontFamily ?? "Consolas"}
            options={fontOptions.map((font) => ({ label: font, value: font }))}
            onChange={(value) => onPatch({ fontFamily: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Font Size">
          <InputNumber style={{ width: "100%" }} min={8} max={48} value={object.fontSize ?? 12} onChange={(v) => onPatch({ fontSize: Number(v ?? 12) } as Partial<HmiObject>)} />
        </Form.Item>
        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Bad / Disabled</Typography.Text>
        <ColorField label="Bad Fill Color" value={object.badColor ?? "#a03030"} fallback="#a03030" onChange={(next) => onPatch({ badColor: next } as Partial<HmiObject>)} />
        <ColorField label="Bad Text Color" value={object.badTextColor ?? "#f14c4c"} fallback="#f14c4c" onChange={(next) => onPatch({ badTextColor: next } as Partial<HmiObject>)} />
        <ColorField label="Disabled Color" value={object.disabledColor ?? "#3d3d3d"} fallback="#3d3d3d" onChange={(next) => onPatch({ disabledColor: next } as Partial<HmiObject>)} />
        <ColorField label="Disabled Text Color" value={object.disabledTextColor ?? "#8c8c8c"} fallback="#8c8c8c" onChange={(next) => onPatch({ disabledTextColor: next } as Partial<HmiObject>)} />
      </>
    );
  }

  if (object.type === "progress-bar") {
    return (
      <>
        <Typography.Text strong>Value / Data</Typography.Text>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.tag ?? ""}
          bindingLabel="Tag Binding"
          tagLabel="Read Tag"
          indexControl={buildIndexControl("tag", "Read Tag", object.tag)}
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="Min">
          <InputNumber style={{ width: "100%" }} value={object.min ?? 0} onChange={(v) => onPatch({ min: Number(v ?? 0) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Max">
          <InputNumber style={{ width: "100%" }} value={object.max ?? 100} onChange={(v) => onPatch({ max: Number(v ?? 100) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Orientation">
          <Select
            value={object.orientation ?? "horizontal"}
            options={[{ label: "horizontal", value: "horizontal" }, { label: "vertical", value: "vertical" }]}
            onChange={(value) => onPatch({ orientation: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Unit">
          <Input value={object.unit ?? ""} onChange={(e) => onPatch({ unit: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Decimals">
          <InputNumber style={{ width: "100%" }} min={0} max={10} value={object.decimals ?? 1} onChange={(v) => onPatch({ decimals: Math.max(0, Number(v ?? 1)) } as Partial<HmiObject>)} />
        </Form.Item>
        <Space>
          <span>Show Value</span>
          <Switch checked={object.showValue ?? true} onChange={(checked) => onPatch({ showValue: checked } as Partial<HmiObject>)} />
        </Space>
        <Space>
          <span>Show Percent</span>
          <Switch checked={object.showPercent ?? false} onChange={(checked) => onPatch({ showPercent: checked } as Partial<HmiObject>)} />
        </Space>
        <Space>
          <span>Show Unit</span>
          <Switch checked={object.showUnit ?? false} onChange={(checked) => onPatch({ showUnit: checked } as Partial<HmiObject>)} />
        </Space>
        <Form.Item label="Fill Direction">
          <Select
            value={object.fillDirection ?? "left-to-right"}
            options={[
              { label: "left-to-right", value: "left-to-right" },
              { label: "right-to-left", value: "right-to-left" },
              { label: "bottom-to-top", value: "bottom-to-top" },
              { label: "top-to-bottom", value: "top-to-bottom" },
            ]}
            onChange={(value) => onPatch({ fillDirection: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Warning Min">
          <InputNumber style={{ width: "100%" }} value={object.warningMin as number | null | undefined} onChange={(v) => onPatch({ warningMin: v == null ? undefined : Number(v) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Warning Max">
          <InputNumber style={{ width: "100%" }} value={object.warningMax as number | null | undefined} onChange={(v) => onPatch({ warningMax: v == null ? undefined : Number(v) } as Partial<HmiObject>)} />
        </Form.Item>
        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Appearance</Typography.Text>
        <ColorField label="Fill Color" value={object.fillColor ?? "#0e639c"} fallback="#0e639c" onChange={(next) => onPatch({ fillColor: next } as Partial<HmiObject>)} />
        <ColorField label="Track Color" value={object.trackColor ?? "#2d2d2d"} fallback="#2d2d2d" onChange={(next) => onPatch({ trackColor: next } as Partial<HmiObject>)} />
        <ColorField label="Background Color" value={object.backgroundColor ?? "#1e1e1e"} fallback="#1e1e1e" onChange={(next) => onPatch({ backgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Border Color" value={object.borderColor ?? "#3c3c3c"} fallback="#3c3c3c" onChange={(next) => onPatch({ borderColor: next } as Partial<HmiObject>)} />
        <Form.Item label="Border Width">
          <InputNumber style={{ width: "100%" }} min={0} max={6} value={object.borderWidth ?? 1} onChange={(v) => onPatch({ borderWidth: Number(v ?? 1) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Corner Radius">
          <InputNumber style={{ width: "100%" }} min={0} max={20} value={object.cornerRadius ?? 4} onChange={(v) => onPatch({ cornerRadius: Number(v ?? 4) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Padding">
          <InputNumber style={{ width: "100%" }} min={0} max={20} value={object.padding ?? 2} onChange={(v) => onPatch({ padding: Number(v ?? 2) } as Partial<HmiObject>)} />
        </Form.Item>
        <ColorField label="Text Color" value={object.textColor ?? "#ffffff"} fallback="#ffffff" onChange={(next) => onPatch({ textColor: next } as Partial<HmiObject>)} />
        <Form.Item label="Font Family">
          <Select
            value={object.fontFamily ?? "Consolas"}
            options={fontOptions.map((font) => ({ label: font, value: font }))}
            onChange={(value) => onPatch({ fontFamily: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Font Size">
          <InputNumber style={{ width: "100%" }} min={8} max={48} value={object.fontSize ?? 12} onChange={(v) => onPatch({ fontSize: Number(v ?? 12) } as Partial<HmiObject>)} />
        </Form.Item>
        <ColorField label="Warning Color" value={object.warningColor ?? "#d7ba7d"} fallback="#d7ba7d" onChange={(next) => onPatch({ warningColor: next } as Partial<HmiObject>)} />
        <ColorField label="Alarm Color (Legacy BAD)" value={object.alarmColor ?? "#d9363e"} fallback="#d9363e" onChange={(next) => onPatch({ alarmColor: next } as Partial<HmiObject>)} />
        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Bad / Disabled</Typography.Text>
        <ColorField label="Bad Text Color" value={object.badTextColor ?? "#f14c4c"} fallback="#f14c4c" onChange={(next) => onPatch({ badTextColor: next } as Partial<HmiObject>)} />
        <ColorField label="Bad Background Color" value={object.badBackgroundColor ?? "#2b1a1a"} fallback="#2b1a1a" onChange={(next) => onPatch({ badBackgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Bad Border Color" value={object.badBorderColor ?? "#a03030"} fallback="#a03030" onChange={(next) => onPatch({ badBorderColor: next } as Partial<HmiObject>)} />
        <ColorField label="Disabled Background Color" value={object.disabledBackgroundColor ?? "#3d3d3d"} fallback="#3d3d3d" onChange={(next) => onPatch({ disabledBackgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Disabled Text Color" value={object.disabledTextColor ?? "#8c8c8c"} fallback="#8c8c8c" onChange={(next) => onPatch({ disabledTextColor: next } as Partial<HmiObject>)} />
      </>
    );
  }

  if (object.type === "select") {
    return (
      <>
        <Typography.Text strong>Value / Data</Typography.Text>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.tag ?? ""}
          bindingLabel="Tag Binding"
          tagLabel="Read Tag"
          indexControl={buildIndexControl("tag", "Read Tag", object.tag)}
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.writeTag ?? ""}
          bindingLabel="Write Binding"
          tagLabel="Write Tag"
          indexControl={buildIndexControl("writeTag", "Write Tag", object.writeTag)}
          onChange={(nextValue) => onPatch({ writeTag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="Placeholder">
          <Input value={object.placeholder ?? ""} onChange={(e) => onPatch({ placeholder: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Dropdown Max Height">
          <InputNumber style={{ width: "100%" }} min={60} max={600} value={object.dropdownMaxHeight ?? 200} onChange={(v) => onPatch({ dropdownMaxHeight: Number(v ?? 200) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Dropdown Offset Y">
          <InputNumber style={{ width: "100%" }} min={-8} max={24} value={object.dropdownOffsetY ?? 2} onChange={(v) => onPatch({ dropdownOffsetY: Number(v ?? 2) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Option Height">
          <InputNumber style={{ width: "100%" }} min={20} max={60} value={object.optionHeight ?? 28} onChange={(v) => onPatch({ optionHeight: Number(v ?? 28) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Options (one per line: label|value)">
          <Input.TextArea
            rows={8}
            value={selectOptionsDraft}
            placeholder={"A|0\nB|1\nC|2\nD|3"}
            onChange={(event) => {
              const rawText = event.target.value;
              setSelectOptionsDraft(rawText);
              onPatch({ options: parseOptionsMultiline(rawText) } as Partial<HmiObject>);
            }}
          />
        </Form.Item>
        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Appearance</Typography.Text>
        <ColorField label="Background Color" value={object.backgroundColor ?? "#1e1e1e"} fallback="#1e1e1e" onChange={(next) => onPatch({ backgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Border Color" value={object.borderColor ?? "#3c3c3c"} fallback="#3c3c3c" onChange={(next) => onPatch({ borderColor: next } as Partial<HmiObject>)} />
        <Form.Item label="Border Width">
          <InputNumber style={{ width: "100%" }} min={0} max={6} value={object.borderWidth ?? 1} onChange={(v) => onPatch({ borderWidth: Number(v ?? 1) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Corner Radius">
          <InputNumber style={{ width: "100%" }} min={0} max={20} value={object.cornerRadius ?? 4} onChange={(v) => onPatch({ cornerRadius: Number(v ?? 4) } as Partial<HmiObject>)} />
        </Form.Item>
        <ColorField label="Text Color" value={object.textColor ?? "#cccccc"} fallback="#cccccc" onChange={(next) => onPatch({ textColor: next } as Partial<HmiObject>)} />
        <ColorField label="Placeholder Color" value={object.placeholderColor ?? "#8c8c8c"} fallback="#8c8c8c" onChange={(next) => onPatch({ placeholderColor: next } as Partial<HmiObject>)} />
        <Form.Item label="Padding">
          <InputNumber style={{ width: "100%" }} min={0} max={24} value={object.padding ?? 8} onChange={(v) => onPatch({ padding: Number(v ?? 8) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Arrow Area Width">
          <InputNumber style={{ width: "100%" }} min={14} max={56} value={object.arrowAreaWidth ?? 24} onChange={(v) => onPatch({ arrowAreaWidth: Number(v ?? 24) } as Partial<HmiObject>)} />
        </Form.Item>
        <ColorField label="Arrow Color" value={object.arrowColor ?? "#cccccc"} fallback="#cccccc" onChange={(next) => onPatch({ arrowColor: next } as Partial<HmiObject>)} />
        <Form.Item label="Font Family">
          <Select
            value={object.fontFamily ?? "Consolas"}
            options={fontOptions.map((font) => ({ label: font, value: font }))}
            onChange={(value) => onPatch({ fontFamily: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Font Size">
          <InputNumber style={{ width: "100%" }} min={8} max={48} value={object.fontSize ?? 12} onChange={(v) => onPatch({ fontSize: Number(v ?? 12) } as Partial<HmiObject>)} />
        </Form.Item>
        <ColorField label="Dropdown Background" value={object.dropdownBackgroundColor ?? "#252526"} fallback="#252526" onChange={(next) => onPatch({ dropdownBackgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Dropdown Border" value={object.dropdownBorderColor ?? "#3c3c3c"} fallback="#3c3c3c" onChange={(next) => onPatch({ dropdownBorderColor: next } as Partial<HmiObject>)} />
        <ColorField label="Option Text Color" value={object.optionTextColor ?? "#cccccc"} fallback="#cccccc" onChange={(next) => onPatch({ optionTextColor: next } as Partial<HmiObject>)} />
        <ColorField label="Option Hover Color" value={object.optionHoverColor ?? "#2d2d2d"} fallback="#2d2d2d" onChange={(next) => onPatch({ optionHoverColor: next } as Partial<HmiObject>)} />
        <ColorField label="Option Selected Color" value={object.optionSelectedColor ?? "rgba(14, 99, 156, 0.3)"} fallback="rgba(14, 99, 156, 0.3)" onChange={(next) => onPatch({ optionSelectedColor: next } as Partial<HmiObject>)} />
        <ColorField label="Option Selected Text" value={object.optionSelectedTextColor ?? "#ffffff"} fallback="#ffffff" onChange={(next) => onPatch({ optionSelectedTextColor: next } as Partial<HmiObject>)} />
        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Bad / Disabled</Typography.Text>
        <ColorField label="Bad Text Color" value={object.badTextColor ?? "#f14c4c"} fallback="#f14c4c" onChange={(next) => onPatch({ badTextColor: next } as Partial<HmiObject>)} />
        <ColorField label="Bad Background Color" value={object.badBackgroundColor ?? "#2b1a1a"} fallback="#2b1a1a" onChange={(next) => onPatch({ badBackgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Bad Border Color" value={object.badBorderColor ?? "#a03030"} fallback="#a03030" onChange={(next) => onPatch({ badBorderColor: next } as Partial<HmiObject>)} />
        <ColorField label="Disabled Background Color" value={object.disabledBackgroundColor ?? "#3d3d3d"} fallback="#3d3d3d" onChange={(next) => onPatch({ disabledBackgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Disabled Text Color" value={object.disabledTextColor ?? "#8c8c8c"} fallback="#8c8c8c" onChange={(next) => onPatch({ disabledTextColor: next } as Partial<HmiObject>)} />
      </>
    );
  }

  if (object.type === "radio-group") {
    const radioMainContent = (
      <>
        <Typography.Text strong>Value / Data</Typography.Text>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.tag ?? ""}
          bindingLabel="Tag Binding"
          tagLabel="Read Tag"
          indexControl={buildIndexControl("tag", "Read Tag", object.tag)}
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.writeTag ?? ""}
          bindingLabel="Write Binding"
          tagLabel="Write Tag"
          indexControl={buildIndexControl("writeTag", "Write Tag", object.writeTag)}
          onChange={(nextValue) => onPatch({ writeTag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="Orientation">
          <Select
            value={object.orientation ?? "horizontal"}
            options={[{ label: "horizontal", value: "horizontal" }, { label: "vertical", value: "vertical" }]}
            onChange={(value) => onPatch({ orientation: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Style Mode">
          <Select
            value={object.styleMode === "card" ? "card" : "segmented"}
            options={[{ label: "segmented", value: "segmented" }, { label: "card", value: "card" }]}
            onChange={(value) => onPatch({ styleMode: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Options (one per line: label|value)">
          <Input.TextArea
            rows={8}
            value={radioOptionsDraft}
            placeholder={"A|0\nB|1\nC|2\nD|3"}
            onChange={(event) => {
              const rawText = event.target.value;
              setRadioOptionsDraft(rawText);
              onPatch({ options: parseOptionsMultiline(rawText) } as Partial<HmiObject>);
            }}
          />
        </Form.Item>
        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Appearance</Typography.Text>
        <ColorField label="Background Color" value={object.backgroundColor ?? "#1e1e1e"} fallback="#1e1e1e" onChange={(next) => onPatch({ backgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Border Color" value={object.borderColor ?? "#3c3c3c"} fallback="#3c3c3c" onChange={(next) => onPatch({ borderColor: next } as Partial<HmiObject>)} />
        <Form.Item label="Border Width">
          <InputNumber style={{ width: "100%" }} min={0} max={6} value={object.borderWidth ?? 1} onChange={(v) => onPatch({ borderWidth: Number(v ?? 1) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Corner Radius">
          <InputNumber style={{ width: "100%" }} min={0} max={20} value={object.cornerRadius ?? 4} onChange={(v) => onPatch({ cornerRadius: Number(v ?? 4) } as Partial<HmiObject>)} />
        </Form.Item>
        <Space style={{ marginBottom: 8 }}>
          <span>Transparent Background</span>
          <Switch checked={object.transparentBackground ?? true} onChange={(checked) => onPatch({ transparentBackground: checked } as Partial<HmiObject>)} />
        </Space>
        <Form.Item label="Item Gap">
          <InputNumber style={{ width: "100%" }} min={0} max={24} value={object.itemGap ?? 4} onChange={(v) => onPatch({ itemGap: Number(v ?? 4) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Item Padding">
          <InputNumber style={{ width: "100%" }} min={0} max={24} value={object.itemPadding ?? 6} onChange={(v) => onPatch({ itemPadding: Number(v ?? 6) } as Partial<HmiObject>)} />
        </Form.Item>
        <ColorField label="Selected Color" value={object.selectedColor ?? "#0e639c"} fallback="#0e639c" onChange={(next) => onPatch({ selectedColor: next } as Partial<HmiObject>)} />
        <ColorField label="Unselected Color" value={object.unselectedColor ?? "#3c3c3c"} fallback="#3c3c3c" onChange={(next) => onPatch({ unselectedColor: next } as Partial<HmiObject>)} />
        <ColorField label="Label Color" value={object.labelColor ?? "#cccccc"} fallback="#cccccc" onChange={(next) => onPatch({ labelColor: next } as Partial<HmiObject>)} />
        <ColorField label="Selected Label Color" value={object.selectedLabelColor ?? "#ffffff"} fallback="#ffffff" onChange={(next) => onPatch({ selectedLabelColor: next } as Partial<HmiObject>)} />
        <Form.Item label="Font Family">
          <Select
            value={object.fontFamily ?? "Consolas"}
            options={fontOptions.map((font) => ({ label: font, value: font }))}
            onChange={(value) => onPatch({ fontFamily: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Font Size">
          <InputNumber style={{ width: "100%" }} min={8} max={48} value={object.fontSize ?? 12} onChange={(v) => onPatch({ fontSize: Number(v ?? 12) } as Partial<HmiObject>)} />
        </Form.Item>
        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Bad / Disabled</Typography.Text>
        <ColorField label="Bad Text Color" value={object.badTextColor ?? "#f14c4c"} fallback="#f14c4c" onChange={(next) => onPatch({ badTextColor: next } as Partial<HmiObject>)} />
        <ColorField label="Bad Background Color" value={object.badBackgroundColor ?? "#2b1a1a"} fallback="#2b1a1a" onChange={(next) => onPatch({ badBackgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Disabled Color" value={object.disabledColor ?? "#3d3d3d"} fallback="#3d3d3d" onChange={(next) => onPatch({ disabledColor: next } as Partial<HmiObject>)} />
        <ColorField label="Disabled Text Color" value={object.disabledTextColor ?? "#8c8c8c"} fallback="#8c8c8c" onChange={(next) => onPatch({ disabledTextColor: next } as Partial<HmiObject>)} />
      </>
    );

    return (
      <Tabs
        size="small"
        className="object-property-tabs object-property-tabs--main"
        items={[
          { key: "main", label: "Main", children: radioMainContent },
          {
            key: "gradient",
            label: "Gradient",
            children: (
              <GradientTabContent
                enabled={object.gradientEnabled ?? false}
                direction={object.gradientDirection}
                startColor={object.gradientStartColor ?? object.selectedColor}
                endColor={object.gradientEndColor ?? object.unselectedColor}
                startFallback={object.selectedColor ?? "#0e639c"}
                endFallback={object.unselectedColor ?? "#3c3c3c"}
                onPatch={onPatch}
              />
            ),
          },
        ]}
      />
    );
  }

  if (object.type === "numeric-input") {
    const numericValueContent = (
      <>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.tag ?? ""}
          bindingLabel="Tag Binding"
          tagLabel="Read Tag"
          indexControl={buildIndexControl("tag", "Read Tag", object.tag)}
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.writeTag ?? ""}
          bindingLabel="Write Binding"
          tagLabel="Write Tag"
          indexControl={buildIndexControl("writeTag", "Write Tag", object.writeTag)}
          onChange={(nextValue) => onPatch({ writeTag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="Min">
          <InputNumber style={{ width: "100%" }} value={object.min ?? 0} onChange={(v) => onPatch({ min: Number(v ?? 0) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Max">
          <InputNumber style={{ width: "100%" }} value={object.max ?? 100} onChange={(v) => onPatch({ max: Number(v ?? 100) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Step">
          <InputNumber style={{ width: "100%" }} value={object.step ?? 1} onChange={(v) => onPatch({ step: Number(v ?? 1) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Format Mode">
          <Select
            value={object.formatMode ?? "decimals"}
            onChange={(v) => onPatch({ formatMode: v } as Partial<HmiObject>)}
            options={[
              { value: "decimals", label: "Fixed Decimals" },
              { value: "pattern", label: "Pattern" },
            ]}
          />
        </Form.Item>
        {object.formatMode !== "pattern" ? (
          <Form.Item label="Decimals">
            <InputNumber style={{ width: "100%" }} min={0} max={10} value={object.decimals ?? 0} onChange={(v) => onPatch({ decimals: Math.max(0, Number(v ?? 0)) } as Partial<HmiObject>)} />
          </Form.Item>
        ) : null}
        {object.formatMode === "pattern" ? (
          <Form.Item label="Pattern" help="e.g. #.##, 0.00, ###.#">
            <Input value={object.formatPattern ?? ""} onChange={(e) => onPatch({ formatPattern: e.target.value } as Partial<HmiObject>)} />
          </Form.Item>
        ) : null}
        <Form.Item label="Unit">
          <Input value={object.unit ?? ""} onChange={(e) => onPatch({ unit: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Show Unit">
          <Switch checked={object.showUnit ?? false} onChange={(v) => onPatch({ showUnit: v } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Placeholder">
          <Input value={object.placeholder ?? ""} onChange={(e) => onPatch({ placeholder: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
      </>
    );

    const numericAppearanceContent = (
      <>
        <Form.Item label="Text Color">
          <ColorPicker value={object.textColor ?? "#ffffff"} onChange={(c: any) => onPatch({ textColor: normalizePickerColor(c.toHexString?.() ?? c, "#ffffff") } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Font Size">
          <InputNumber style={{ width: "100%" }} min={8} max={48} value={object.fontSize ?? 12} onChange={(v) => onPatch({ fontSize: Number(v ?? 12) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Font Family">
          <Select
            value={object.fontFamily ?? "Consolas"}
            options={fontOptions.map((font) => ({ label: font, value: font }))}
            onChange={(value) => onPatch({ fontFamily: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Text Align">
          <Select
            value={object.textAlign ?? "right"}
            onChange={(v) => onPatch({ textAlign: v } as Partial<HmiObject>)}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" },
            ]}
          />
        </Form.Item>
        <Form.Item label="Background Color">
          <ColorPicker value={object.backgroundColor ?? "#1e1e1e"} onChange={(c: any) => onPatch({ backgroundColor: normalizePickerColor(c.toHexString?.() ?? c, "#1e1e1e") } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Border Color">
          <ColorPicker value={object.borderColor ?? "#3c3c3c"} onChange={(c: any) => onPatch({ borderColor: normalizePickerColor(c.toHexString?.() ?? c, "#3c3c3c") } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Border Width">
          <InputNumber style={{ width: "100%" }} min={0} max={4} value={object.borderWidth ?? 1} onChange={(v) => onPatch({ borderWidth: Number(v ?? 1) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Corner Radius">
          <InputNumber style={{ width: "100%" }} min={0} max={12} value={object.cornerRadius ?? 4} onChange={(v) => onPatch({ cornerRadius: Number(v ?? 4) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Show Meta (Step/Min/Max)">
          <Switch checked={object.showMeta ?? true} onChange={(v) => onPatch({ showMeta: v } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Step Button Uses Text Color">
          <Switch checked={object.stepButtonUseTextColor ?? true} onChange={(v) => onPatch({ stepButtonUseTextColor: v } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Step Button Text Color">
          <ColorPicker value={object.stepButtonTextColor ?? "#cccccc"} disabled={object.stepButtonUseTextColor !== false} onChange={(c: any) => onPatch({ stepButtonTextColor: normalizePickerColor(c.toHexString?.() ?? c, "#cccccc") } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Step Button Background">
          <ColorPicker value={object.stepButtonBackgroundColor ?? "#2d2d2d"} onChange={(c: any) => onPatch({ stepButtonBackgroundColor: normalizePickerColor(c.toHexString?.() ?? c, "#2d2d2d") } as Partial<HmiObject>)} />
        </Form.Item>
      </>
    );

    const numericSignalErrorContent = (
      <>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.errorTag ?? ""}
          bindingLabel="Error Binding"
          tagLabel="Error Bit Tag"
          indexControl={buildIndexControl("errorTag", "Error Bit Tag", object.errorTag)}
          onChange={(nextValue) => onPatch({ errorTag: nextValue } as Partial<HmiObject>)}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Applied when read tag/index is missing or signal quality is Bad.
        </Typography.Text>
        <Form.Item label="Error Text Color" style={{ marginTop: 8 }}>
          <ColorPicker value={object.badTextColor ?? "#f14c4c"} onChange={(c: any) => onPatch({ badTextColor: normalizePickerColor(c.toHexString?.() ?? c, "#f14c4c") } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Error Field Background">
          <ColorPicker value={object.badBackgroundColor ?? "#2b1a1a"} onChange={(c: any) => onPatch({ badBackgroundColor: normalizePickerColor(c.toHexString?.() ?? c, "#2b1a1a") } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Error Border Color">
          <ColorPicker value={object.badBorderColor ?? "#a03030"} onChange={(c: any) => onPatch({ badBorderColor: normalizePickerColor(c.toHexString?.() ?? c, "#a03030") } as Partial<HmiObject>)} />
        </Form.Item>
      </>
    );

    const numericDialogContent = (
      <>
        <Form.Item label="Dialog Title">
          <Input value={object.dialogTitle ?? ""} onChange={(e) => onPatch({ dialogTitle: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Dialog Width">
          <InputNumber style={{ width: "100%" }} min={220} max={800} value={object.dialogWidth ?? 300} onChange={(v) => onPatch({ dialogWidth: Number(v ?? 300) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Dialog Height">
          <InputNumber style={{ width: "100%" }} min={120} max={480} value={object.dialogHeight ?? 150} onChange={(v) => onPatch({ dialogHeight: Number(v ?? 150) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Dialog Position">
          <Select
            value={object.dialogPlacement ?? "custom"}
            onChange={(value) => onPatch({ dialogPlacement: value } as Partial<HmiObject>)}
            options={[
              { value: "custom", label: "Custom (X/Y)" },
              { value: "top", label: "Top of field" },
              { value: "right", label: "Right of field" },
              { value: "bottom", label: "Bottom of field" },
              { value: "left", label: "Left of field" },
            ]}
          />
        </Form.Item>
        <Form.Item label="Dialog Offset">
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            max={120}
            disabled={(object.dialogPlacement ?? "custom") === "custom"}
            value={object.dialogOffset ?? 12}
            onChange={(v) => onPatch({ dialogOffset: Math.max(0, Number(v ?? 12)) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Dialog X">
          <InputNumber
            style={{ width: "100%" }}
            disabled={(object.dialogPlacement ?? "custom") !== "custom"}
            value={object.dialogX ?? 200}
            onChange={(v) => onPatch({ dialogX: Number(v ?? 200) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Dialog Y">
          <InputNumber
            style={{ width: "100%" }}
            disabled={(object.dialogPlacement ?? "custom") !== "custom"}
            value={object.dialogY ?? 150}
            onChange={(v) => onPatch({ dialogY: Number(v ?? 150) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Dialog Background">
          <ColorPicker value={object.dialogBackgroundColor ?? "#252526"} onChange={(c: any) => onPatch({ dialogBackgroundColor: normalizePickerColor(c.toHexString?.() ?? c, "#252526") } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Dialog Text">
          <ColorPicker value={object.dialogTextColor ?? "#cccccc"} onChange={(c: any) => onPatch({ dialogTextColor: normalizePickerColor(c.toHexString?.() ?? c, "#cccccc") } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Dialog Border">
          <ColorPicker value={object.dialogBorderColor ?? "#3c3c3c"} onChange={(c: any) => onPatch({ dialogBorderColor: normalizePickerColor(c.toHexString?.() ?? c, "#3c3c3c") } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Close Button Text">
          <ColorPicker value={object.dialogCloseButtonTextColor ?? "#cccccc"} onChange={(c: any) => onPatch({ dialogCloseButtonTextColor: normalizePickerColor(c.toHexString?.() ?? c, "#cccccc") } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Close Button Background">
          <ColorPicker value={object.dialogCloseButtonBackgroundColor ?? "#2d2d2d"} onChange={(c: any) => onPatch({ dialogCloseButtonBackgroundColor: normalizePickerColor(c.toHexString?.() ?? c, "#2d2d2d") } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Set Button Text">
          <ColorPicker value={object.dialogSetButtonTextColor ?? "#ffffff"} onChange={(c: any) => onPatch({ dialogSetButtonTextColor: normalizePickerColor(c.toHexString?.() ?? c, "#ffffff") } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Set Button Background">
          <ColorPicker value={object.dialogSetButtonBackgroundColor ?? "#0e639c"} onChange={(c: any) => onPatch({ dialogSetButtonBackgroundColor: normalizePickerColor(c.toHexString?.() ?? c, "#0e639c") } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Set Button Border">
          <ColorPicker value={object.dialogSetButtonBorderColor ?? "#007acc"} onChange={(c: any) => onPatch({ dialogSetButtonBorderColor: normalizePickerColor(c.toHexString?.() ?? c, "#007acc") } as Partial<HmiObject>)} />
        </Form.Item>
      </>
    );

    if (numericInputSection === "value") {
      return <>{numericValueContent}</>;
    }
    if (numericInputSection === "appearance") {
      return <>{numericAppearanceContent}</>;
    }
    if (numericInputSection === "error") {
      return <>{numericSignalErrorContent}</>;
    }
    if (numericInputSection === "dialog") {
      return <>{numericDialogContent}</>;
    }
    return (
      <>
        {numericValueContent}
        <Divider style={{ margin: "10px 0" }} />
        {numericAppearanceContent}
        <Divider style={{ margin: "10px 0" }} />
        {numericSignalErrorContent}
        <Divider style={{ margin: "10px 0" }} />
        {numericDialogContent}
      </>
    );
  }

  if (object.type === "group") {
    return (
      <>
        <Form.Item label="Children">
          <Input value={String(object.objects.length)} disabled />
        </Form.Item>
      </>
    );
  }

  return <></>;
}

function findTagByName(project: ScadaProject, tagName: string | undefined) {
  if (!tagName) {
    return undefined;
  }
  const normalized = tagName.trim();
  if (!normalized) {
    return undefined;
  }
  return project.tags.find((tag) => tag.name === normalized);
}

function normalizeTemplate(currentTemplate: string, project: ScadaProject, tagName: string | undefined): string {
  const selectedTag = findTagByName(project, tagName);
  const fromSelected = getTagAddressTemplate(selectedTag);
  const normalizedCurrent = (currentTemplate ?? "").trim();
  if (normalizedCurrent) {
    return normalizedCurrent;
  }
  return fromSelected;
}

function createBindingsFromSlots(
  slots: ReturnType<typeof extractIndexedAddressSlots>,
  existing: IndexedTagAddress["bindings"] = [],
): IndexedTagAddress["bindings"] {
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

function parseConditionValue(value: string): string | number | boolean {
  const normalized = value.trim();
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

function parseRuntimeActionValue(value: string): boolean | number | string | null {
  const normalized = value.trim();
  if (normalized.toLowerCase() === "true") {
    return true;
  }
  if (normalized.toLowerCase() === "false") {
    return false;
  }
  if (normalized.toLowerCase() === "null") {
    return null;
  }
  const asNumber = Number(normalized);
  if (Number.isFinite(asNumber) && normalized !== "") {
    return asNumber;
  }
  return value;
}

function stringifyRuntimeActionValue(value: boolean | number | string | null): string {
  if (value === null) {
    return "null";
  }
  return String(value);
}

function clampOpacity(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 1);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  if (numeric < 0) {
    return 0;
  }
  if (numeric > 1) {
    return 1;
  }
  return numeric;
}

function toFixedPrecisionNumber(value: number | string | null | undefined, precision: number): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const multiplier = 10 ** Math.max(0, precision);
  return Math.round(numeric * multiplier) / multiplier;
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

function matchStateImageCondition(
  condition: { type: "equals" | "notEquals" | "true" | "false"; value?: string | number | boolean },
  rawValue: string,
): boolean {
  const parsed = parseConditionValue(rawValue);
  if (condition.type === "true") {
    return Boolean(parsed);
  }
  if (condition.type === "false") {
    return !Boolean(parsed);
  }
  if (condition.type === "equals") {
    return String(parsed) === String(condition.value);
  }
  return String(parsed) !== String(condition.value);
}

function hasTextStyle(
  object: HmiObject,
): object is Extract<HmiObject, { textStyle: TextStyle }> {
  return (
    object.type === "text" ||
    object.type === "value-display" ||
    object.type === "value-input" ||
    object.type === "state-indicator" ||
    object.type === "button" ||
    object.type === "switch" ||
    object.type === "valueSelect" ||
    object.type === "valve" ||
    object.type === "pump"
  );
}

function hasTextLayout(
  object: HmiObject,
): object is Extract<HmiObject, { wrap?: "none" | "word" | "char"; ellipsis?: boolean }> {
  return (
    object.type === "text" ||
    object.type === "value-display" ||
    object.type === "value-input" ||
    object.type === "state-indicator" ||
    object.type === "button" ||
    object.type === "switch" ||
    object.type === "valueSelect"
  );
}



