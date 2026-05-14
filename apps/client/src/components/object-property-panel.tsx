import { useEffect, useState } from "react";
import { ACCESS_ROLE_LABELS_RU } from "@web-scada/shared";
import type {
  AccessRoleLevel,
  AppRole,
  Asset,
  ElementBindingDefinition,
  ElementLibrary,
  HmiObject,
  IndexedTagAddress,
  HmiScreen,
  RuntimeAction,
  RuntimeResolveContext,
  RuntimeValueSource,
  ScadaProject,
  TextStyle,
} from "@web-scada/shared";
import {
  extractIndexedAddressSlots,
  parseTagSegments,
  resolveElementBindingAssignment,
  resolveIndexedAddress,
  resolveLibraryElementInstanceBindingsDetailed,
  resolveRuntimeValueSync,
} from "@web-scada/shared";
import { Button, ColorPicker, Divider, Form, Input, InputNumber, Select, Space, Switch, Tag, Typography } from "antd";
import { TagPicker } from "./tag-picker";
import { IndexedAddressEditorWindow } from "./indexed-address-editor-window";
import { getAssetDisplayPath } from "../utils/asset-path";
import { WorkbenchCollapsibleSection } from "./workbench";
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
  onDelete: () => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
  onMoveForward?: () => void;
  onMoveBackward?: () => void;
};

const fontOptions = ["Arial", "Tahoma", "Verdana", "Consolas", "Segoe UI", "Roboto", "Noto Sans"];
const roleOptions: Array<{ label: string; value: AppRole }> = [
  { label: "admin", value: "admin" },
  { label: "engineer", value: "engineer" },
  { label: "operator", value: "operator" },
  { label: "viewer", value: "viewer" },
];
const accessRoleOptions: Array<{ label: string; value: AccessRoleLevel }> = [
  { label: `0 — ${ACCESS_ROLE_LABELS_RU[0]}`, value: 0 },
  { label: `1 — ${ACCESS_ROLE_LABELS_RU[1]}`, value: 1 },
  { label: `2 — ${ACCESS_ROLE_LABELS_RU[2]}`, value: 2 },
  { label: `3 — ${ACCESS_ROLE_LABELS_RU[3]}`, value: 3 },
  { label: `4 — ${ACCESS_ROLE_LABELS_RU[4]}`, value: 4 },
];

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

type RuntimeSourceMode = "none" | "static" | "internal" | "lw" | "tag" | "expression";

function runtimeSourceModeOf(source: RuntimeValueSource | undefined): RuntimeSourceMode {
  if (!source) {
    return "none";
  }
  return source.type;
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

function RuntimeValueSourceEditor({
  label,
  value,
  valueType,
  project,
  onChange,
}: {
  label: string;
  value: RuntimeValueSource | undefined;
  valueType: "string" | "number";
  project: ScadaProject;
  onChange: (next: RuntimeValueSource | undefined) => void;
}) {
  const mode = runtimeSourceModeOf(value);
  const staticValue = value?.type === "static" ? value.value : undefined;
  const previewContext: RuntimeResolveContext = {
    tagValues: buildEditorRuntimeTagValues(project),
  };
  const previewWarnings: string[] = [];
  const previewValue = value
    ? resolveRuntimeValueSync(value, {
        ...previewContext,
        warn(warning) {
          previewWarnings.push(warning.message);
        },
      })
    : undefined;

  const expressionTemplates = valueType === "number"
    ? [
        {
          label: "Burner/valve index: lw(20) * 32 + lw(10)",
          value: "lw(20) * 32 + lw(10)",
        },
        {
          label: "Burner base index: lw(20) * 32",
          value: "lw(20) * 32",
        },
        {
          label: "Selected LW value: lw(20)",
          value: "lw(20)",
        },
        {
          label: "Tag numeric value: tag('Selected.Index')",
          value: "tag('Selected.Index')",
        },
        {
          label: "Internal numeric value: internal('SelectedIndex')",
          value: "internal('SelectedIndex')",
        },
      ]
    : [
        {
          label: "Burner prefix: 'Burner_' + str(lw(20))",
          value: "'Burner_' + str(lw(20))",
        },
        {
          label: "Suffix from LW: '_' + str(lw(20))",
          value: "'_' + str(lw(20))",
        },
        {
          label: "Tag string value: str(tag('Selected.Prefix'))",
          value: "str(tag('Selected.Prefix'))",
        },
        {
          label: "Internal string value: str(internal('SelectedPrefix'))",
          value: "str(internal('SelectedPrefix'))",
        },
      ];

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={6}>
      <Typography.Text type="secondary">{label} Source</Typography.Text>
      <Select
        value={mode}
        options={[
          { label: "Legacy static field", value: "none" },
          { label: "Static", value: "static" },
          { label: "From Internal Variable", value: "internal" },
          { label: "From LW", value: "lw" },
          { label: "From Tag", value: "tag" },
          { label: "Expression", value: "expression" },
        ]}
        onChange={(nextMode: RuntimeSourceMode) => {
          if (nextMode === "none") {
            onChange(undefined);
            return;
          }
          if (nextMode === "static") {
            onChange({ type: "static", value: valueType === "number" ? 0 : "" });
            return;
          }
          if (nextMode === "internal") {
            onChange({ type: "internal", name: "" });
            return;
          }
          if (nextMode === "lw") {
            onChange({ type: "lw", address: 0 });
            return;
          }
          if (nextMode === "tag") {
            onChange({ type: "tag", tag: "" });
            return;
          }
          if (nextMode === "expression") {
            onChange({
              type: "expression",
              expression: valueType === "number" ? "lw(20) * 32 + lw(10)" : "'Prefix_' + str(lw(20))",
            });
            return;
          }
        }}
      />
      {mode === "static" ? (
        valueType === "number" ? (
          <InputNumber
            style={{ width: "100%" }}
            value={typeof staticValue === "number" ? staticValue : Number(staticValue ?? 0)}
            onChange={(next) => onChange({ type: "static", value: Number(next ?? 0) })}
          />
        ) : (
          <Input
            value={typeof staticValue === "string" ? staticValue : String(staticValue ?? "")}
            onChange={(event) => onChange({ type: "static", value: event.target.value })}
          />
        )
      ) : null}
      {mode === "internal" ? (
        <Input
          placeholder="selectedBurnerPrefix"
          value={value?.type === "internal" ? value.name : ""}
          onChange={(event) => onChange({ type: "internal", name: event.target.value })}
        />
      ) : null}
      {mode === "lw" ? (
        <InputNumber
          style={{ width: "100%" }}
          min={0}
          value={value?.type === "lw" ? value.address : 0}
          onChange={(next) => onChange({ type: "lw", address: Math.max(0, Math.floor(Number(next ?? 0))) })}
        />
      ) : null}
      {mode === "tag" ? (
        <TagPicker
          project={project}
          value={value?.type === "tag" ? value.tag : ""}
          onChange={(tag) => onChange({ type: "tag", tag: tag ?? "" })}
        />
      ) : null}
      {mode === "expression" ? (
        <Space direction="vertical" style={{ width: "100%" }} size={4}>
          <Select
            placeholder="Insert expression template"
            value={undefined}
            options={expressionTemplates}
            onChange={(template) => {
              if (!template) {
                return;
              }
              onChange({
                type: "expression",
                expression: template,
              });
            }}
          />
          <Input.TextArea
            rows={3}
            value={value?.type === "expression" ? value.expression : ""}
            placeholder={valueType === "number" ? "lw(20) * 32 + lw(10)" : "'Prefix_' + str(lw(20))"}
            onChange={(event) =>
              onChange({
                type: "expression",
                expression: event.target.value,
              })
            }
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Available: lw(20), tag('Tag.Name'), internal('Name'), str(...), num(...), floor(...), ceil(...), round(...)
          </Typography.Text>
          {previewWarnings.length > 0 ? (
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              Expression error: {previewWarnings[0]}
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Preview result: {previewValue === undefined ? "—" : String(previewValue)}
            </Typography.Text>
          )}
        </Space>
      ) : null}
    </Space>
  );
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

export function ObjectPropertyPanel({ project, assets, libraries, object, elementBindings, onPatch, onDelete, onBringToFront, onSendToBack, onMoveForward, onMoveBackward }: Props) {
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
        <InputNumber style={{ width: "100%" }} value={object.x} onChange={(v) => onPatch({ x: Number(v ?? 0) })} />
      </Form.Item>
      <Form.Item label="Y">
        <InputNumber style={{ width: "100%" }} value={object.y} onChange={(v) => onPatch({ y: Number(v ?? 0) })} />
      </Form.Item>
      <Form.Item label="Width">
        <InputNumber style={{ width: "100%" }} value={object.width} onChange={(v) => onPatch({ width: Number(v ?? 10) })} />
      </Form.Item>
      <Form.Item label="Height">
        <InputNumber style={{ width: "100%" }} value={object.height} onChange={(v) => onPatch({ height: Number(v ?? 10) })} />
      </Form.Item>
      <Form.Item label="Rotation">
        <InputNumber style={{ width: "100%" }} value={object.rotation ?? 0} onChange={(v) => onPatch({ rotation: Number(v ?? 0) })} />
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
  ) : (
    <Typography.Text type="secondary">This object has no text style settings.</Typography.Text>
  );

  const accessContent = (
    <>
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

  const advancedContent = (
    <>
      <Typography.Text type="secondary">Danger zone</Typography.Text>
      <Divider style={{ margin: "10px 0" }} />
      <Button danger onClick={onDelete} block>
        Delete Object
      </Button>
    </>
  );

  return (
    <div className="object-property-panel object-property-panel--workbench">
      <Form layout="vertical" size="small">
        <WorkbenchCollapsibleSection title="GENERAL" storageKey={`object-panel.general.${object.type}`}>
          {generalContent}
        </WorkbenchCollapsibleSection>
        <WorkbenchCollapsibleSection title="LAYER / Z ORDER" storageKey={`object-panel.zorder.${object.type}`}>
          <Form.Item label="zIndex">
            <InputNumber
              value={object.zIndex ?? 0}
              onChange={(value) => onPatch({ zIndex: typeof value === "number" ? value : undefined })}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <Button size="small" onClick={onBringToFront} disabled={!onBringToFront}>
              Front
            </Button>
            <Button size="small" onClick={onSendToBack} disabled={!onSendToBack}>
              Back
            </Button>
            <Button size="small" onClick={onMoveForward} disabled={!onMoveForward}>
              Up
            </Button>
            <Button size="small" onClick={onMoveBackward} disabled={!onMoveBackward}>
              Down
            </Button>
          </div>
        </WorkbenchCollapsibleSection>
        <WorkbenchCollapsibleSection title="RUNTIME STATE" storageKey={`object-panel.runtime-state.${object.type}`}>
          {runtimeStateContent}
        </WorkbenchCollapsibleSection>
        <WorkbenchCollapsibleSection title="OBJECT / SPECIFIC" storageKey={`object-panel.specific.${object.type}`}>
          {objectContent}
        </WorkbenchCollapsibleSection>
        <WorkbenchCollapsibleSection title="TEXT" storageKey={`object-panel.text.${object.type}`} defaultCollapsed>
          {textContent}
        </WorkbenchCollapsibleSection>
        <WorkbenchCollapsibleSection title="ACCESS / SECURITY" storageKey={`object-panel.access.${object.type}`}>
          {accessContent}
        </WorkbenchCollapsibleSection>
        <WorkbenchCollapsibleSection title="ADVANCED" storageKey={`object-panel.advanced.${object.type}`} defaultCollapsed>
          {advancedContent}
        </WorkbenchCollapsibleSection>
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
  onPatch: (patch: Partial<HmiObject>) => void;
}) {
  const [stateImagePreviewValue, setStateImagePreviewValue] = useState<string>("0");
  const assetOptions = assets.map((asset) => ({ label: getAssetDisplayPath(asset), value: asset.id }));
  const templateBindings = elementBindings ?? [];
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
    return (
      <>
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
  }

  if (object.type === "rectangle") {
    return (
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
    return (
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
    return (
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
                placeholder="Управление: {{valveName}}"
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
  }

  if (object.type === "switch") {
    return (
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

  if (object.type === "libraryElementInstance") {
    const libraryOptions = libraries.map((library) => ({ label: library.name, value: library.id }));
    const selectedLibrary = libraries.find((library) => library.id === object.libraryId);
    const elementOptions = (selectedLibrary?.elements ?? []).map((element) => ({ label: element.name, value: element.id }));
    const selectedElement = selectedLibrary?.elements.find((element) => element.id === object.elementId);
    const parameterValues = object.parameterValues ?? {};
    const bindingAssignments = object.bindingAssignments ?? {};
    const bindingDefinitions = selectedElement?.bindings ?? [];
    const knownTags = new Set(project.tags.map((tag) => tag.name));
    const editorTagValues = buildEditorRuntimeTagValues(project);
    const editorRuntimeContext = {
      tagValues: editorTagValues,
    };
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

    const removeBindingAssignment = (bindingKey: string) => {
      const next = { ...bindingAssignments };
      delete next[bindingKey];
      onPatch({ bindingAssignments: next } as Partial<HmiObject>);
    };

    function createValveBindingAssignment(baseTag: string) {
      return {
        baseTag,
        indexOffsetSource: {
          type: "expression" as const,
          expression: "lw(20) * 32 + lw(10)",
        },
        indexMode: {
          type: "arrayIndex" as const,
          occurrence: 0,
          operation: "add" as const,
          valueFrom: "indexOffset" as const,
        },
      };
    }

    function createValveUniversalBindingAssignments() {
      return {
        visualState: createValveBindingAssignment("GVL_VALVE.valves[0].VisualState"),
        commandState: createValveBindingAssignment("GVL_VALVE.valves[0].CommandState"),
        openCmd: createValveBindingAssignment("GVL_VALVE.valves[0].OpenCmd"),
        closeCmd: createValveBindingAssignment("GVL_VALVE.valves[0].CloseCmd"),
        fault: createValveBindingAssignment("GVL_VALVE.valves[0].Fault"),
      };
    }

    const bindingKeys = new Set((selectedElement?.bindings ?? []).map((b) => b.key));
    const looksLikeValveElement =
      bindingKeys.has("visualState") ||
      bindingKeys.has("commandState") ||
      bindingKeys.has("openCmd") ||
      bindingKeys.has("closeCmd") ||
      bindingKeys.has("fault");

    return (
      <>
        <Form.Item label="Library">
          <Select
            value={object.libraryId}
            options={libraryOptions}
            onChange={(value) => onPatch({ libraryId: value, elementId: "" } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Element">
          <Select
            value={object.elementId}
            options={elementOptions}
            onChange={(value) => onPatch({ elementId: value } as Partial<HmiObject>)}
          />
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
        {looksLikeValveElement ? (
          <>
            <Divider orientation="left" style={{ marginTop: 16 }}>Binding Presets</Divider>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Button
                onClick={() => {
                  onPatch({
                    bindingAssignments: {
                      ...(object.bindingAssignments ?? {}),
                      ...createValveUniversalBindingAssignments(),
                    },
                  } as Partial<HmiObject>);
                }}
                block
              >
                Fill ValveUniversal bindings
              </Button>
              <Button
                onClick={() => {
                  const preset = createValveUniversalBindingAssignments();
                  onPatch({
                    bindingAssignments: {
                      ...preset,
                      ...(object.bindingAssignments ?? {}),
                    },
                  } as Partial<HmiObject>);
                }}
                block
              >
                Fill missing ValveUniversal bindings
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Uses index expression: lw(20) * 32 + lw(10)
              </Typography.Text>
            </Space>
          </>
        ) : null}
        <>
          <Divider style={{ margin: "10px 0" }} />
          <Typography.Text strong>Bindings</Typography.Text>
          {bindingDefinitions.length ? (
            bindingDefinitions.map((binding) => {
              const assignment = bindingAssignments[binding.key] ?? {
                baseTag: binding.defaultBaseTag ?? "",
                prefixMode: { type: "none" as const },
                indexMode: { type: "none" as const },
              };
              const segments = parseTagSegments(assignment.baseTag || binding.defaultBaseTag || "");
              const prefixModeValue =
                assignment.prefixMode?.type === "segment"
                  ? `segment:${assignment.prefixMode.segmentIndex}:${assignment.prefixMode.position}`
                  : assignment.prefixMode?.type === "segmentByName"
                    ? `segmentByName:${assignment.prefixMode.segmentName}:${assignment.prefixMode.position}`
                  : assignment.prefixMode?.type === "lastSegment"
                    ? `last:${assignment.prefixMode.position}`
                    : "none";
              const segmentNames = [...new Set(segments.map((segment) => segment.split("[")[0] ?? segment).filter(Boolean))];
              const arrayTargets = segments.flatMap((segment, segmentIndex) =>
                /\[-?\d+\]/.test(segment) ? [{ segment, segmentIndex }] : [],
              );
              const indexModeValue =
                assignment.indexMode?.type === "arrayIndex"
                  ? `arrayIndex:${assignment.indexMode.occurrence}`
                  : assignment.indexMode?.type === "arrayIndexBySegment"
                    ? `arrayBySegment:${assignment.indexMode.segmentName}`
                    : "none";
              const resolvedTag = resolveElementBindingAssignment(assignment, binding.defaultBaseTag, editorRuntimeContext);
              const tagExists = resolvedTag ? knownTags.has(resolvedTag) : false;
              const required = binding.required ?? false;
              const isMissingRequired = required && !resolvedTag;
              const canOverride = binding.overridable !== false;
              const prefixCurrentValue = assignment.prefixSource
                ? resolveRuntimeValueSync(assignment.prefixSource, editorRuntimeContext)
                : assignment.prefix;
              const indexCurrentValue = assignment.indexOffsetSource
                ? resolveRuntimeValueSync(assignment.indexOffsetSource, editorRuntimeContext)
                : assignment.indexOffset;

              const debug = bindingDebug?.debug[binding.key];
              const issue = bindingDebug?.issues.find((item) => item.key === binding.key);
              return (
                <Space
                  key={binding.id}
                  direction="vertical"
                  style={{ width: "100%", border: "1px solid #f0f0f0", borderRadius: 8, padding: 8 }}
                >
                  <Space wrap>
                    <Typography.Text>{binding.displayName} ({binding.key})</Typography.Text>
                    <Tag color="blue">{binding.kind}</Tag>
                    {binding.dataType ? <Tag color="geekblue">{binding.dataType}</Tag> : null}
                    {required ? <Tag color="red">Required</Tag> : <Tag>Optional</Tag>}
                  </Space>
                  {debug ? (
                    <Typography.Text copyable={Boolean(debug.resolvedTag)} type="secondary" style={{ fontSize: 12 }}>
                      Resolved: {debug.resolvedTag || "—"}
                    </Typography.Text>
                  ) : issue ? (
                    <Typography.Text type="danger" style={{ fontSize: 12 }}>
                      Missing required binding
                    </Typography.Text>
                  ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Resolved: —
                    </Typography.Text>
                  )}
                  {debug ? (
                    <Space size={6} wrap>
                      <Tag color={debug.tagExists === false ? "orange" : debug.tagExists === true ? "green" : "default"}>
                        {debug.tagExists === false ? "missing" : debug.tagExists === true ? "exists" : "unknown"}
                      </Tag>
                      {debug.tagQuality ? <Tag>{debug.tagQuality}</Tag> : null}
                      {debug.indexOffsetValue !== undefined ? <Tag>index {debug.indexOffsetValue}</Tag> : null}
                    </Space>
                  ) : null}
                  <Typography.Text type="secondary">Base tag</Typography.Text>
                  <TagPicker
                    project={project}
                    value={assignment.baseTag}
                    onChange={(tag) => patchBindingAssignment(binding.key, { baseTag: tag ?? "" })}
                  />
                  <Input
                    value={assignment.baseTag}
                    placeholder={binding.defaultBaseTag ?? ".State"}
                    onChange={(event) => patchBindingAssignment(binding.key, { baseTag: event.target.value })}
                  />
                  <Space wrap style={{ width: "100%" }}>
                    <Input
                      style={{ width: 130 }}
                      addonBefore="Prefix"
                      value={assignment.prefix ?? ""}
                      onChange={(event) => patchBindingAssignment(binding.key, { prefix: event.target.value })}
                    />
                    <Select
                      style={{ minWidth: 230 }}
                      value={prefixModeValue}
                      options={[
                        { label: "No prefix", value: "none" },
                        ...segments.map((segment, segmentIndex) => ({
                          label: `Segment ${segmentIndex}: ${segment} (append)`,
                          value: `segment:${segmentIndex}:append`,
                        })),
                        ...segments.map((segment, segmentIndex) => ({
                          label: `Segment ${segmentIndex}: ${segment} (prepend)`,
                          value: `segment:${segmentIndex}:prepend`,
                        })),
                        ...segmentNames.map((segmentName) => ({
                          label: `Segment "${segmentName}" (append)`,
                          value: `segmentByName:${segmentName}:append`,
                        })),
                        ...segmentNames.map((segmentName) => ({
                          label: `Segment "${segmentName}" (prepend)`,
                          value: `segmentByName:${segmentName}:prepend`,
                        })),
                        { label: "Last segment (append)", value: "last:append" },
                        { label: "Last segment (prepend)", value: "last:prepend" },
                      ]}
                      onChange={(value) => {
                        if (value === "none") {
                          patchBindingAssignment(binding.key, { prefixMode: { type: "none" } });
                          return;
                        }
                        if (value.startsWith("segment:")) {
                          const [, indexToken, positionToken] = value.split(":");
                          patchBindingAssignment(binding.key, {
                            prefixMode: {
                              type: "segment",
                              segmentIndex: Number(indexToken ?? 0),
                              position: positionToken === "prepend" ? "prepend" : "append",
                            },
                          });
                          return;
                        }
                        if (value.startsWith("segmentByName:")) {
                          const [, segmentNameToken, positionToken] = value.split(":");
                          patchBindingAssignment(binding.key, {
                            prefixMode: {
                              type: "segmentByName",
                              segmentName: segmentNameToken ?? "",
                              position: positionToken === "prepend" ? "prepend" : "append",
                            },
                          });
                          return;
                        }
                        if (value.startsWith("last:")) {
                          const [, positionToken] = value.split(":");
                          patchBindingAssignment(binding.key, {
                            prefixMode: {
                              type: "lastSegment",
                              position: positionToken === "prepend" ? "prepend" : "append",
                            },
                          });
                        }
                      }}
                    />
                  </Space>
                  <RuntimeValueSourceEditor
                    label="Prefix"
                    value={assignment.prefixSource}
                    valueType="string"
                    project={project}
                    onChange={(nextSource) => patchBindingAssignment(binding.key, { prefixSource: nextSource })}
                  />
                  <Space wrap style={{ width: "100%" }}>
                    <InputNumber
                      style={{ width: 130 }}
                      placeholder="Index offset"
                      value={assignment.indexOffset}
                      onChange={(value) => patchBindingAssignment(binding.key, { indexOffset: Number(value ?? 0) })}
                    />
                    <Select
                      style={{ minWidth: 260 }}
                      value={indexModeValue}
                      options={[
                        { label: "No index transform", value: "none" },
                        ...arrayTargets.map((target, targetIndex) => ({
                          label: `Array index ${targetIndex}: ${target.segment}`,
                          value: `arrayIndex:${targetIndex}`,
                        })),
                        ...arrayTargets.map((target) => {
                          const segmentName = target.segment.split("[")[0] ?? target.segment;
                          return {
                            label: `By segment ${segmentName}`,
                            value: `arrayBySegment:${segmentName}`,
                          };
                        }),
                      ]}
                      onChange={(value) => {
                        if (value === "none") {
                          patchBindingAssignment(binding.key, { indexMode: { type: "none" } });
                          return;
                        }
                        if (value.startsWith("arrayIndex:")) {
                          const [, occurrenceToken] = value.split(":");
                          patchBindingAssignment(binding.key, {
                            indexMode: {
                              type: "arrayIndex",
                              occurrence: Number(occurrenceToken ?? 0),
                              operation: "add",
                              valueFrom: "indexOffset",
                            },
                          });
                          return;
                        }
                        if (value.startsWith("arrayBySegment:")) {
                          const [, segmentName] = value.split(":");
                          patchBindingAssignment(binding.key, {
                            indexMode: {
                              type: "arrayIndexBySegment",
                              segmentName: segmentName ?? "",
                              operation: "add",
                              valueFrom: "indexOffset",
                            },
                          });
                        }
                      }}
                    />
                  </Space>
                  <RuntimeValueSourceEditor
                    label="Index Offset"
                    value={assignment.indexOffsetSource}
                    valueType="number"
                    project={project}
                    onChange={(nextSource) => patchBindingAssignment(binding.key, { indexOffsetSource: nextSource })}
                  />
                  <Typography.Text type="secondary">Override tag</Typography.Text>
                  <RuntimeValueSourceEditor
                    label="Override Tag"
                    value={assignment.overrideTagSource}
                    valueType="string"
                    project={project}
                    onChange={(nextSource) => patchBindingAssignment(binding.key, { overrideTagSource: nextSource })}
                  />
                  {canOverride ? (
                    <TagPicker
                      project={project}
                      value={assignment.overrideTag ?? ""}
                      onChange={(tag) => patchBindingAssignment(binding.key, { overrideTag: tag ?? "" })}
                    />
                  ) : null}
                  <Input
                    value={assignment.overrideTag ?? ""}
                    placeholder={canOverride ? "Optional exact resolved tag" : "Override is disabled for this binding"}
                    disabled={!canOverride}
                    onChange={(event) => patchBindingAssignment(binding.key, { overrideTag: event.target.value })}
                  />
                  <Space wrap>
                    <Typography.Text type="secondary">Resolved:</Typography.Text>
                    <Typography.Text code>{resolvedTag || "<empty>"}</Typography.Text>
                    <Tag color="blue">prefix: {prefixCurrentValue === undefined ? "<undefined>" : String(prefixCurrentValue)}</Tag>
                    <Tag color="geekblue">index: {indexCurrentValue === undefined ? "<undefined>" : String(indexCurrentValue)}</Tag>
                    {isMissingRequired ? (
                      <Tag color="red">Required binding is missing</Tag>
                    ) : resolvedTag ? (
                      <Tag color={tagExists ? "green" : "gold"}>{tagExists ? "Tag found" : "Tag not found"}</Tag>
                    ) : (
                      <Tag color="default">Not assigned</Tag>
                    )}
                  </Space>
                  <Button size="small" danger onClick={() => removeBindingAssignment(binding.key)}>
                    Clear assignment
                  </Button>
                </Space>
              );
            })
          ) : (
            <Typography.Text type="secondary">
              This element has no binding definitions. Add bindings in Element Editor, then return here to map tags.
            </Typography.Text>
          )}
          <Form.Item label="Binding Assignments (JSON advanced)">
            <Input.TextArea
              rows={5}
              value={JSON.stringify(bindingAssignments, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value) as Record<string, unknown>;
                  onPatch({ bindingAssignments: parsed } as Partial<HmiObject>);
                } catch {
                  // ignore invalid JSON while typing
                }
              }}
            />
          </Form.Item>
        </>
        <Divider orientation="left" style={{ marginTop: 16 }}>Resolved Bindings Debug</Divider>
        {!selectedElement ? (
          <Typography.Text type="secondary">Library element not found</Typography.Text>
        ) : null}
        {bindingDebug?.issues.length ? (
          <Space direction="vertical" style={{ width: "100%" }} size={4}>
            {bindingDebug.issues.map((issue) => (
              <Typography.Text key={issue.key} type="danger" style={{ fontSize: 12 }}>
                Missing required binding: {issue.displayName ?? issue.key}
              </Typography.Text>
            ))}
          </Space>
        ) : null}
        {bindingDebug && Object.keys(bindingDebug.debug).length > 0 ? (
          <Space direction="vertical" style={{ width: "100%" }} size={8}>
            {Object.entries(bindingDebug.debug).map(([key, debug]) => (
              <div
                key={key}
                style={{
                  border: "1px solid #303030",
                  borderRadius: 6,
                  padding: 8,
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <Space direction="vertical" style={{ width: "100%" }} size={2}>
                  <Typography.Text strong>{key}</Typography.Text>
                  <Typography.Text style={{ fontSize: 12 }}>Base: {debug.baseTag || "—"}</Typography.Text>
                  {debug.prefixValue !== undefined ? (
                    <Typography.Text style={{ fontSize: 12 }}>Prefix: {String(debug.prefixValue)}</Typography.Text>
                  ) : null}
                  {debug.indexOffsetValue !== undefined ? (
                    <Typography.Text style={{ fontSize: 12 }}>Index offset: {String(debug.indexOffsetValue)}</Typography.Text>
                  ) : null}
                  {debug.overrideTagValue !== undefined ? (
                    <Typography.Text style={{ fontSize: 12 }}>Override: {String(debug.overrideTagValue)}</Typography.Text>
                  ) : null}
                  <Typography.Text copyable style={{ fontSize: 12 }}>
                    Resolved: {debug.resolvedTag || "—"}
                  </Typography.Text>
                  <Typography.Text style={{ fontSize: 12 }}>
                    Exists: {debug.tagExists === undefined ? "unknown" : debug.tagExists ? "yes" : "no"}
                  </Typography.Text>
                  <Typography.Text style={{ fontSize: 12 }}>
                    Quality: {debug.tagQuality ?? "—"}
                  </Typography.Text>
                  <Typography.Text style={{ fontSize: 12 }}>
                    Value: {debug.tagValue === undefined ? "—" : JSON.stringify(debug.tagValue)}
                  </Typography.Text>
                </Space>
              </div>
            ))}
          </Space>
        ) : selectedElement ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            No resolved bindings yet. Check binding assignments and defaultBaseTag.
          </Typography.Text>
        ) : null}
        {selectedElement?.parameters?.length ? (
          <>
            <Typography.Text type="secondary">
              Element parameters
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
            <Form.Item label="Parameter Values (JSON advanced)">
              <Input.TextArea
                rows={4}
                value={JSON.stringify(parameterValues, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value) as Record<string, unknown>;
                    onPatch({ parameterValues: parsed } as Partial<HmiObject>);
                  } catch {
                    // ignore invalid JSON while typing
                  }
                }}
              />
            </Form.Item>
          </>
        ) : (
          <Form.Item label="Parameter Values (JSON)">
            <Input.TextArea
              rows={4}
              value={JSON.stringify(object.parameterValues ?? {}, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value) as Record<string, unknown>;
                  onPatch({ parameterValues: parsed } as Partial<HmiObject>);
                } catch {
                  // ignore invalid JSON while typing
                }
              }}
            />
          </Form.Item>
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
        <ColorField label="Fill Color" value={object.fillColor ?? "#0e639c"} fallback="#0e639c" onChange={(next) => onPatch({ fillColor: next } as Partial<HmiObject>)} />
        <ColorField label="Track Color" value={object.trackColor ?? "#1e1e1e"} fallback="#1e1e1e" onChange={(next) => onPatch({ trackColor: next } as Partial<HmiObject>)} />
        <ColorField label="Thumb Color" value={object.thumbColor ?? "#d9d9d9"} fallback="#d9d9d9" onChange={(next) => onPatch({ thumbColor: next } as Partial<HmiObject>)} />
      </>
    );
  }

  if (object.type === "progress-bar") {
    return (
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
        <Space>
          <span>Show Value</span>
          <Switch checked={object.showValue ?? true} onChange={(checked) => onPatch({ showValue: checked } as Partial<HmiObject>)} />
        </Space>
        <ColorField label="Fill Color" value={object.fillColor ?? "#0e639c"} fallback="#0e639c" onChange={(next) => onPatch({ fillColor: next } as Partial<HmiObject>)} />
        <ColorField label="Track Color" value={object.trackColor ?? "#1e1e1e"} fallback="#1e1e1e" onChange={(next) => onPatch({ trackColor: next } as Partial<HmiObject>)} />
        <ColorField label="Alarm Color (BAD)" value={object.alarmColor ?? "#d9363e"} fallback="#d9363e" onChange={(next) => onPatch({ alarmColor: next } as Partial<HmiObject>)} />
      </>
    );
  }

  if (object.type === "select") {
    const selectOptionsText = (object.options ?? []).map((item) => `${item.label}|${String(item.value)}`).join("\n");
    return (
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
        <Form.Item label="Placeholder">
          <Input value={object.placeholder ?? ""} onChange={(e) => onPatch({ placeholder: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Options (one per line: label|value)">
          <Input.TextArea
            rows={5}
            value={selectOptionsText}
            onChange={(event) => {
              const lines = event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
              const options = lines.map((line, index) => {
                const [labelToken, valueToken] = line.split("|");
                const label = (labelToken ?? `Option ${index + 1}`).trim();
                const rawValue = (valueToken ?? label).trim();
                let parsed: string | number | boolean = rawValue;
                const asNumber = Number(rawValue);
                if (rawValue !== "" && Number.isFinite(asNumber) && !rawValue.startsWith("0x")) {
                  parsed = asNumber;
                }
                if (rawValue.toLowerCase() === "true") { parsed = true; }
                if (rawValue.toLowerCase() === "false") { parsed = false; }
                return { label, value: parsed };
              });
              onPatch({ options } as Partial<HmiObject>);
            }}
          />
        </Form.Item>
      </>
    );
  }

  if (object.type === "radio-group") {
    const radioOptionsText = (object.options ?? []).map((item) => `${item.label}|${String(item.value)}`).join("\n");
    return (
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
        <Form.Item label="Orientation">
          <Select
            value={object.orientation ?? "horizontal"}
            options={[{ label: "horizontal", value: "horizontal" }, { label: "vertical", value: "vertical" }]}
            onChange={(value) => onPatch({ orientation: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Options (one per line: label|value)">
          <Input.TextArea
            rows={5}
            value={radioOptionsText}
            onChange={(event) => {
              const lines = event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
              const options = lines.map((line, index) => {
                const [labelToken, valueToken] = line.split("|");
                const label = (labelToken ?? `Option ${index + 1}`).trim();
                const rawValue = (valueToken ?? label).trim();
                let parsed: string | number | boolean = rawValue;
                const asNumber = Number(rawValue);
                if (rawValue !== "" && Number.isFinite(asNumber) && !rawValue.startsWith("0x")) {
                  parsed = asNumber;
                }
                if (rawValue.toLowerCase() === "true") { parsed = true; }
                if (rawValue.toLowerCase() === "false") { parsed = false; }
                return { label, value: parsed };
              });
              onPatch({ options } as Partial<HmiObject>);
            }}
          />
        </Form.Item>
      </>
    );
  }

  if (object.type === "numeric-input") {
    return (
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
        <Divider style={{ margin: "8px 0" }} />
        <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Style</Typography.Text>
        <Form.Item label="Text Color" style={{ marginTop: 4 }}>
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


