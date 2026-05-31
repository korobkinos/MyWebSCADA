import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  DEFAULT_OPERATOR_ACTION_BUTTON_TEMPLATE,
  DEFAULT_OPERATOR_ACTION_CHECKBOX_TEMPLATE,
  DEFAULT_OPERATOR_ACTION_NUMERIC_INPUT_TEMPLATE,
  DEFAULT_OPERATOR_ACTION_SLIDER_TEMPLATE,
  DEFAULT_OPERATOR_ACTION_VALUE_CHANGE_TEMPLATE,
  extractIndexedAddressSlots,
  isOperatorActionEnabledForObject,
  resolveIndexedAddress,
  resolveLibraryElementInstanceBindingsDetailed,
} from "@web-scada/shared";
import { Button, ColorPicker, Divider, Form, Input, InputNumber, Select, Space, Switch, Tabs, Tag, Typography } from "antd";
import { TagPicker } from "./tag-picker";
import { IndexedAddressEditorWindow } from "./indexed-address-editor-window";
import { WorkbenchButton, WorkbenchWindow, type WorkbenchWindowRect, nextGlobalZIndex } from "./workbench";
import { TrendTagPickerDialog } from "../features/trends/TrendTagPickerDialog";
import { TrendSettingsPanel } from "../features/trends/TrendSettingsPanel";
import type { TrendTagInfo } from "../features/trends/trendTypes";
import { defaultTrendSettings } from "../features/trends/trendUtils";
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

type OperatorActionPreviewObject = Extract<
  HmiObject,
  { type: "button" | "checkbox" | "slider" | "numeric-input" | "select" | "radio-group" | "switch" | "valueSelect" | "value-input" }
>;

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
const ROTATION_ANIMATION_SUPPORTED_TYPES = new Set<HmiObject["type"]>([
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
          onChangeComplete={(color) => {
            const rgb = color.toRgb();
            if (typeof rgb.a === "number" && rgb.a < 1) {
              onChange(color.toRgbString());
              return;
            }
            onChange(color.toHexString());
          }}
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

function roundToTenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatNumberArrayToTenths(values: number[]): string {
  return JSON.stringify(values.map((value) => roundToTenths(value)));
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
  allowClear = false,
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
  allowClear?: boolean;
  onChange: (nextValue: string) => void;
}) {
  const canClear = (value ?? "").trim().length > 0;
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
          {allowClear ? (
            <button
              type="button"
              className="workbench-button"
              onClick={() => onChange("")}
              disabled={!canClear}
            >
              <span className="workbench-button__label">Clear</span>
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

function RotationAnimationFields({
  project,
  object,
  bindings,
  buildIndexControl,
  onPatch,
}: {
  project: ScadaProject;
  object: HmiObject;
  bindings: ElementBindingDefinition[];
  buildIndexControl: (fieldName: string, fieldLabel: string, rawTagName: string | undefined) => {
    enabled: boolean;
    status: string;
    configureDisabled?: boolean;
    onConfigure: () => void;
    onToggleEnabled: (checked: boolean) => void;
  };
  onPatch: (patch: Partial<HmiObject>) => void;
}) {
  const rotationAnimation = object.rotationAnimation ?? {};
  const triggerMode = rotationAnimation.triggerMode ?? "truthy";
  const speedSource = rotationAnimation.speedSource ?? "fixed";
  const showTriggerValue = triggerMode === "equals" || triggerMode === "notEquals";
  const showSpeedTag = speedSource === "tag";

  const patchRotationAnimation = (patch: Record<string, unknown>) => {
    onPatch({
      rotationAnimation: {
        ...rotationAnimation,
        ...patch,
      },
    } as Partial<HmiObject>);
  };

  return (
    <>
      <Divider style={{ margin: "12px 0" }} />
      <Typography.Text strong>Rotation Animation</Typography.Text>
      <div style={{ marginTop: 8 }}>
        <Space style={{ marginBottom: 8 }}>
          <span>Enable Rotation Animation</span>
          <Switch
            checked={rotationAnimation.enabled === true}
            onChange={(checked) => patchRotationAnimation({ enabled: checked })}
          />
        </Space>
        <TagFieldWithBindingSource
          project={project}
          bindings={bindings}
          value={rotationAnimation.triggerTag ?? ""}
          bindingLabel="Rotation Trigger Binding"
          tagLabel="Rotation Trigger Tag"
          indexControl={buildIndexControl(
            "rotationAnimation.triggerTag",
            "Rotation Trigger Tag",
            rotationAnimation.triggerTag,
          )}
          onChange={(nextValue) => patchRotationAnimation({ triggerTag: nextValue })}
        />
        <Form.Item label="Trigger Mode">
          <Select
            value={triggerMode}
            options={[
              { label: "truthy", value: "truthy" },
              { label: "equals", value: "equals" },
              { label: "notEquals", value: "notEquals" },
            ]}
            onChange={(value) => patchRotationAnimation({ triggerMode: value })}
          />
        </Form.Item>
        {showTriggerValue ? (
          <Form.Item label="Trigger Value">
            <Input
              value={scalarToText(rotationAnimation.triggerValue)}
              onChange={(event) => patchRotationAnimation({ triggerValue: parseScalarToken(event.target.value) })}
            />
          </Form.Item>
        ) : null}
        <Space style={{ marginBottom: 8 }}>
          <span>Trigger Invert</span>
          <Switch
            checked={rotationAnimation.triggerInvert ?? false}
            onChange={(checked) => patchRotationAnimation({ triggerInvert: checked })}
          />
        </Space>
        <Form.Item label="Speed Source">
          <Select
            value={speedSource}
            options={[
              { label: "fixed", value: "fixed" },
              { label: "tag", value: "tag" },
            ]}
            onChange={(value) => patchRotationAnimation({ speedSource: value })}
          />
        </Form.Item>
        <Form.Item label="Fixed Speed (deg/s)">
          <InputNumber
            style={{ width: "100%" }}
            value={rotationAnimation.fixedSpeedDegPerSec ?? 90}
            onChange={(value) => patchRotationAnimation({ fixedSpeedDegPerSec: Number(value ?? 90) })}
          />
        </Form.Item>
        {showSpeedTag ? (
          <TagFieldWithBindingSource
            project={project}
            bindings={bindings}
            value={rotationAnimation.speedTag ?? ""}
            bindingLabel="Rotation Speed Binding"
            tagLabel="Rotation Speed Tag"
            indexControl={buildIndexControl(
              "rotationAnimation.speedTag",
              "Rotation Speed Tag",
              rotationAnimation.speedTag,
            )}
            onChange={(nextValue) => patchRotationAnimation({ speedTag: nextValue })}
          />
        ) : null}
        <Form.Item label="Min Speed (deg/s)">
          <InputNumber
            style={{ width: "100%" }}
            value={rotationAnimation.minSpeedDegPerSec ?? 0}
            onChange={(value) => patchRotationAnimation({ minSpeedDegPerSec: Number(value ?? 0) })}
          />
        </Form.Item>
        <Form.Item label="Max Speed (deg/s)">
          <InputNumber
            style={{ width: "100%" }}
            value={rotationAnimation.maxSpeedDegPerSec ?? 720}
            onChange={(value) => patchRotationAnimation({ maxSpeedDegPerSec: Number(value ?? 720) })}
          />
        </Form.Item>
        <Form.Item label="Direction">
          <Select
            value={rotationAnimation.direction ?? "clockwise"}
            options={[
              { label: "clockwise", value: "clockwise" },
              { label: "counterclockwise", value: "counterclockwise" },
            ]}
            onChange={(value) => patchRotationAnimation({ direction: value })}
          />
        </Form.Item>
        <Form.Item label="Pivot">
          <Select
            value={rotationAnimation.pivot ?? "center"}
            options={[
              { label: "center", value: "center" },
              { label: "origin", value: "origin" },
            ]}
            onChange={(value) => patchRotationAnimation({ pivot: value })}
          />
        </Form.Item>
      </div>
    </>
  );
}

function FlowAnimationFields({
  project,
  object,
  bindings,
  buildIndexControl,
  onPatch,
}: {
  project: ScadaProject;
  object: Extract<HmiObject, { type: "line" }>;
  bindings: ElementBindingDefinition[];
  buildIndexControl: (fieldName: string, fieldLabel: string, rawTagName: string | undefined) => {
    enabled: boolean;
    status: string;
    configureDisabled?: boolean;
    onConfigure: () => void;
    onToggleEnabled: (checked: boolean) => void;
  };
  onPatch: (patch: Partial<HmiObject>) => void;
}) {
  const ADVANCED_RECT_DEFAULT: WorkbenchWindowRect = { x: 220, y: 110, width: 560, height: 760 };
  const flowAnimation = object.flowAnimation ?? {};
  const triggerMode = flowAnimation.triggerMode ?? "truthy";
  const speedSource = flowAnimation.speedSource ?? "fixed";
  const defaultInnerStrokeWidth = Math.max(1, Math.min(object.strokeWidth, Math.max(2, object.strokeWidth * 0.35)));
  const useBaseStrokeWidth = flowAnimation.useBaseStrokeWidth ?? false;
  const effectType = flowAnimation.effectType ?? "dash";
  const showTriggerValue = triggerMode === "equals" || triggerMode === "notEquals";
  const showSpeedTag = speedSource === "tag";
  const showDashSettings = effectType === "dash" || effectType === "dots" || effectType === "arrows";
  const showGradientSettings = effectType === "gradientShift";
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedRect, setAdvancedRect] = useState<WorkbenchWindowRect>(ADVANCED_RECT_DEFAULT);
  const [advancedZIndex, setAdvancedZIndex] = useState(() => nextGlobalZIndex());

  const hasFlowAnimationSettings = (candidate: typeof flowAnimation): boolean => (
    candidate.triggerTag !== undefined
    || candidate.triggerMode !== undefined
    || candidate.triggerValue !== undefined
    || candidate.triggerInvert !== undefined
    || candidate.speedSource !== undefined
    || candidate.fixedSpeedPxPerSec !== undefined
    || candidate.speedTag !== undefined
    || candidate.minSpeedPxPerSec !== undefined
    || candidate.maxSpeedPxPerSec !== undefined
    || candidate.direction !== undefined
    || candidate.effectType !== undefined
    || candidate.color !== undefined
    || candidate.opacity !== undefined
    || candidate.strokeWidth !== undefined
    || candidate.useBaseStrokeWidth !== undefined
    || candidate.gradientStartColor !== undefined
    || candidate.gradientMidColor !== undefined
    || candidate.gradientEndColor !== undefined
    || candidate.gradientSpanPx !== undefined
    || candidate.dashLength !== undefined
    || candidate.gapLength !== undefined
  );

  const patchFlowAnimation = (patch: Record<string, unknown>) => {
    const next = {
      ...flowAnimation,
      ...patch,
    };
    if (typeof next.triggerTag === "string" && next.triggerTag.trim() === "") {
      next.triggerTag = undefined;
    }
    if (typeof next.speedTag === "string" && next.speedTag.trim() === "") {
      next.speedTag = undefined;
    }
    const shouldKeep = next.enabled === true || hasFlowAnimationSettings(next);
    onPatch({
      flowAnimation: shouldKeep ? next : undefined,
    } as Partial<HmiObject>);
  };

  useEffect(() => {
    setAdvancedOpen(false);
  }, [object.id]);

  const openAdvancedWindow = () => {
    setAdvancedZIndex(nextGlobalZIndex());
    setAdvancedOpen(true);
  };

  const focusAdvancedWindow = () => {
    setAdvancedZIndex(nextGlobalZIndex());
  };

  const applyFlowPreset = (preset: "pipeSoft" | "energySharp" | "airFast") => {
    if (preset === "pipeSoft") {
      patchFlowAnimation({
        enabled: true,
        effectType: "gradientShift",
        gradientStartColor: "#557a2c",
        gradientMidColor: "#d5ff62",
        gradientEndColor: "#557a2c",
        gradientSpanPx: 90,
        gapLength: 34,
        fixedSpeedPxPerSec: 70,
        direction: "forward",
        opacity: 0.95,
      });
      return;
    }
    if (preset === "energySharp") {
      patchFlowAnimation({
        enabled: true,
        effectType: "gradientShift",
        gradientStartColor: "#1f5f8f",
        gradientMidColor: "#7ce8ff",
        gradientEndColor: "#1f5f8f",
        gradientSpanPx: 68,
        gapLength: 24,
        fixedSpeedPxPerSec: 110,
        direction: "forward",
        opacity: 1,
      });
      return;
    }
    patchFlowAnimation({
      enabled: true,
      effectType: "gradientShift",
      gradientStartColor: "#6f6f6f",
      gradientMidColor: "#f0f0f0",
      gradientEndColor: "#6f6f6f",
      gradientSpanPx: 72,
      gapLength: 48,
      fixedSpeedPxPerSec: 140,
      direction: "forward",
      opacity: 0.85,
    });
  };

  const renderSection = (title: string, content: ReactNode) => (
    <section className="flow-animation-tuner-window__section">
      <header className="flow-animation-tuner-window__section-title">{title}</header>
      <div className="flow-animation-tuner-window__section-body">
        {content}
      </div>
    </section>
  );

  const renderDetailedControls = () => (
    <div className="flow-animation-tuner-window__sections object-property-tabs object-property-tabs--main">
      {renderSection("PRESETS", (
        <>
          <Typography.Text type="secondary" style={{ marginBottom: 8, display: "block" }}>
            Apply a quick base profile, then fine tune below.
          </Typography.Text>
          <div className="flow-animation-tuner-window__preset-actions">
            <WorkbenchButton onClick={() => applyFlowPreset("pipeSoft")}>Pipe Soft</WorkbenchButton>
            <WorkbenchButton onClick={() => applyFlowPreset("energySharp")}>Energy Sharp</WorkbenchButton>
            <WorkbenchButton onClick={() => applyFlowPreset("airFast")}>Air Fast</WorkbenchButton>
          </div>
        </>
      ))}
      {renderSection("TRIGGER", (
        <>
      <TagFieldWithBindingSource
        project={project}
        bindings={bindings}
        value={flowAnimation.triggerTag ?? ""}
        bindingLabel="Flow Trigger Binding"
        tagLabel="Flow Trigger Tag"
        indexControl={buildIndexControl(
          "flowAnimation.triggerTag",
          "Flow Trigger Tag",
          flowAnimation.triggerTag,
        )}
        onChange={(nextValue) => patchFlowAnimation({ triggerTag: nextValue })}
      />
      <Form.Item label="Trigger Mode">
        <Select
          value={triggerMode}
          options={[
            { label: "truthy", value: "truthy" },
            { label: "equals", value: "equals" },
            { label: "notEquals", value: "notEquals" },
          ]}
          onChange={(value) => patchFlowAnimation({ triggerMode: value })}
        />
      </Form.Item>
      {showTriggerValue ? (
        <Form.Item label="Trigger Value">
          <Input
            value={scalarToText(flowAnimation.triggerValue)}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw.trim() === "") {
                patchFlowAnimation({ triggerValue: undefined });
                return;
              }
              patchFlowAnimation({ triggerValue: parseScalarToken(raw) });
            }}
          />
        </Form.Item>
      ) : null}
      <Space style={{ marginBottom: 8 }}>
        <span>Trigger Invert</span>
        <Switch
          checked={flowAnimation.triggerInvert ?? false}
          onChange={(checked) => patchFlowAnimation({ triggerInvert: checked })}
        />
      </Space>
        </>
      ))}
      {renderSection("SPEED", (
        <>
      <Form.Item label="Speed Source">
        <Select
          value={speedSource}
          options={[
            { label: "fixed", value: "fixed" },
            { label: "tag", value: "tag" },
          ]}
          onChange={(value) => patchFlowAnimation({ speedSource: value })}
        />
      </Form.Item>
      <Form.Item label="Fixed Speed (px/s)">
        <InputNumber
          style={{ width: "100%" }}
          value={flowAnimation.fixedSpeedPxPerSec ?? 80}
          onChange={(value) => patchFlowAnimation({ fixedSpeedPxPerSec: Number(value ?? 80) })}
        />
      </Form.Item>
      {showSpeedTag ? (
        <TagFieldWithBindingSource
          project={project}
          bindings={bindings}
          value={flowAnimation.speedTag ?? ""}
          bindingLabel="Flow Speed Binding"
          tagLabel="Flow Speed Tag"
          indexControl={buildIndexControl(
            "flowAnimation.speedTag",
            "Flow Speed Tag",
            flowAnimation.speedTag,
          )}
          onChange={(nextValue) => patchFlowAnimation({ speedTag: nextValue })}
        />
      ) : null}
      <Form.Item label="Min Speed (px/s)">
        <InputNumber
          style={{ width: "100%" }}
          value={flowAnimation.minSpeedPxPerSec ?? 0}
          onChange={(value) => patchFlowAnimation({ minSpeedPxPerSec: Number(value ?? 0) })}
        />
      </Form.Item>
      <Form.Item label="Max Speed (px/s)">
        <InputNumber
          style={{ width: "100%" }}
          value={flowAnimation.maxSpeedPxPerSec ?? 500}
          onChange={(value) => patchFlowAnimation({ maxSpeedPxPerSec: Number(value ?? 500) })}
        />
      </Form.Item>
      <Form.Item label="Direction">
        <Select
          value={flowAnimation.direction ?? "forward"}
          options={[
            { label: "forward", value: "forward" },
            { label: "reverse", value: "reverse" },
          ]}
          onChange={(value) => patchFlowAnimation({ direction: value })}
        />
      </Form.Item>
        </>
      ))}
      {renderSection("VISUAL EFFECT", (
        <>
          <Form.Item label="Effect Type">
            <Select
              value={effectType}
              options={[
                { label: "dash", value: "dash" },
                { label: "arrows", value: "arrows" },
                { label: "dots", value: "dots" },
                { label: "gradientShift", value: "gradientShift" },
              ]}
              onChange={(value) => patchFlowAnimation({ effectType: value })}
            />
          </Form.Item>
      <ColorField
        label="Effect Color"
        value={flowAnimation.color}
        fallback={object.activeStroke ?? object.stroke ?? "#00bfff"}
        onChange={(next) => patchFlowAnimation({ color: next })}
      />
      <Form.Item label="Opacity">
        <InputNumber
          style={{ width: "100%" }}
          min={0}
          max={1}
          step={0.05}
          value={flowAnimation.opacity ?? 1}
          onChange={(value) => patchFlowAnimation({ opacity: Number(value ?? 1) })}
        />
      </Form.Item>
      <Space style={{ marginBottom: 8 }}>
        <span>Use Full Line Width</span>
        <Switch
          checked={useBaseStrokeWidth}
          onChange={(checked) => patchFlowAnimation({ useBaseStrokeWidth: checked })}
        />
      </Space>
      {!useBaseStrokeWidth ? (
        <Form.Item label="Stroke Width">
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            step={0.1}
            value={roundToTenths(flowAnimation.strokeWidth ?? defaultInnerStrokeWidth)}
            onChange={(value) => patchFlowAnimation({ strokeWidth: roundToTenths(Number(value ?? defaultInnerStrokeWidth)) })}
          />
        </Form.Item>
      ) : null}
        </>
      ))}
      {renderSection("GRADIENT / DASH SETTINGS", (
        <>
      <Form.Item label="Dash Length">
        <InputNumber
          style={{ width: "100%" }}
          min={1}
          value={flowAnimation.dashLength ?? 12}
          onChange={(value) => patchFlowAnimation({ dashLength: Number(value ?? 12) })}
        />
      </Form.Item>
      <Form.Item label="Gap Length / Wave Gap (px)">
        <InputNumber
          style={{ width: "100%" }}
          min={0}
          value={flowAnimation.gapLength ?? 8}
          onChange={(value) => patchFlowAnimation({ gapLength: Number(value ?? 8) })}
        />
      </Form.Item>
      <ColorField
        label="Gradient Start Color"
        value={flowAnimation.gradientStartColor}
        fallback={flowAnimation.gradientMidColor ?? flowAnimation.color ?? object.activeStroke ?? object.stroke ?? "#00bfff"}
        onChange={(next) => patchFlowAnimation({ gradientStartColor: next })}
      />
      <Space style={{ marginBottom: 8 }}>
        <span>Use Mid Color For Start</span>
        <Switch
          checked={flowAnimation.gradientStartColor === undefined}
          onChange={(checked) => patchFlowAnimation({
            gradientStartColor: checked
              ? undefined
              : (flowAnimation.gradientMidColor ?? flowAnimation.color ?? object.activeStroke ?? object.stroke ?? "#00bfff"),
          })}
        />
      </Space>
      <ColorField
        label="Gradient Mid Color"
        value={flowAnimation.gradientMidColor}
        fallback={flowAnimation.color ?? object.activeStroke ?? "#00bfff"}
        onChange={(next) => patchFlowAnimation({ gradientMidColor: next })}
      />
      <ColorField
        label="Gradient End Color"
        value={flowAnimation.gradientEndColor}
        fallback={flowAnimation.gradientMidColor ?? flowAnimation.color ?? object.activeStroke ?? object.stroke ?? "#00bfff"}
        onChange={(next) => patchFlowAnimation({ gradientEndColor: next })}
      />
      <Space style={{ marginBottom: 8 }}>
        <span>Use Mid Color For End</span>
        <Switch
          checked={flowAnimation.gradientEndColor === undefined}
          onChange={(checked) => patchFlowAnimation({
            gradientEndColor: checked
              ? undefined
              : (flowAnimation.gradientMidColor ?? flowAnimation.color ?? object.activeStroke ?? object.stroke ?? "#00bfff"),
          })}
        />
      </Space>
      <Form.Item label="Gradient Span (px)">
        <InputNumber
          style={{ width: "100%" }}
          min={8}
          value={flowAnimation.gradientSpanPx ?? 120}
          onChange={(value) => patchFlowAnimation({ gradientSpanPx: Number(value ?? 120) })}
        />
      </Form.Item>
        </>
      ))}
    </div>
  );

  return (
    <>
      <Space style={{ marginBottom: 8 }}>
        <span>Enable Flow Animation</span>
        <Switch
          checked={flowAnimation.enabled === true}
          onChange={(checked) => patchFlowAnimation({ enabled: checked })}
        />
      </Space>
      <Form.Item label="Effect Type">
        <Select
          value={effectType}
          options={[
            { label: "dash", value: "dash" },
            { label: "arrows", value: "arrows" },
            { label: "dots", value: "dots" },
            { label: "gradientShift", value: "gradientShift" },
          ]}
          onChange={(value) => patchFlowAnimation({ effectType: value })}
        />
      </Form.Item>
      <Form.Item label="Direction">
        <Select
          value={flowAnimation.direction ?? "forward"}
          options={[
            { label: "forward", value: "forward" },
            { label: "reverse", value: "reverse" },
          ]}
          onChange={(value) => patchFlowAnimation({ direction: value })}
        />
      </Form.Item>
      {showDashSettings ? (
        <Form.Item label="Dash Length">
          <InputNumber
            style={{ width: "100%" }}
            min={1}
            value={flowAnimation.dashLength ?? 12}
            onChange={(value) => patchFlowAnimation({ dashLength: Number(value ?? 12) })}
          />
        </Form.Item>
      ) : null}
      {showGradientSettings ? (
        <Form.Item label="Gradient Span (px)">
          <InputNumber
            style={{ width: "100%" }}
            min={8}
            value={flowAnimation.gradientSpanPx ?? 120}
            onChange={(value) => patchFlowAnimation({ gradientSpanPx: Number(value ?? 120) })}
          />
        </Form.Item>
      ) : null}
      <Form.Item>
        <WorkbenchButton onClick={openAdvancedWindow}>Open Flow Animation Tuner</WorkbenchButton>
      </Form.Item>

      {advancedOpen && typeof document !== "undefined"
        ? createPortal(
          <div className="workbench-window-layer" onMouseDown={(event) => event.stopPropagation()}>
            <WorkbenchWindow
              id="flowAnimationTuner"
              title={`Flow Animation Tuner (${object.name?.trim() || object.id})`}
              rect={advancedRect}
              zIndex={advancedZIndex}
              minWidth={460}
              minHeight={520}
              onClose={() => setAdvancedOpen(false)}
              onFocus={focusAdvancedWindow}
              onMove={(x, y) => setAdvancedRect((prev) => ({ ...prev, x: Math.max(0, x), y: Math.max(0, y) }))}
              onResize={(nextRect) => setAdvancedRect(nextRect)}
            >
              <div className="screen-editor-window-content screen-editor-object-properties-window flow-animation-tuner-window">
                <div className="screen-editor-object-properties-scroll flow-animation-tuner-window__scroll">
                  <div className="object-property-panel object-property-panel--workbench flow-animation-tuner-window__panel">
                    <Form layout="vertical" size="small">
                      {renderDetailedControls()}
                    </Form>
                  </div>
                </div>
              </div>
            </WorkbenchWindow>
          </div>,
          document.body,
        )
        : null}
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

const OPERATOR_ACTION_PREVIEW_TIMESTAMP = "2026-01-01T12:00:00.000Z";
const OPERATOR_ACTION_SUPPORTED_PLACEHOLDERS =
  "{user}, {role}, {objectName}, {description}, {objectId}, {objectType}, {screenName}, {screenId}, {target}, {oldValue}, {newValue}, {unit}, {timestamp}, {actionType}";

function formatOperatorActionPreviewValue(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function renderOperatorActionPreviewTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(user|role|objectName|description|objectId|objectType|screenName|screenId|target|oldValue|newValue|unit|timestamp|actionType)\}/g, (_full, key: string) => {
    return values[key] ?? "";
  });
}

function resolveOperatorActionPreviewKind(object: OperatorActionPreviewObject): string {
  if (object.type === "button") {
    if (object.action.type === "pulse") {
      return "pulse";
    }
    if (object.action.type === "toggle") {
      return "toggle";
    }
    if (object.action.type === "runMacro") {
      return "macro";
    }
    return "button";
  }
  if (object.type === "checkbox") {
    return "checkbox";
  }
  if (object.type === "slider") {
    return "slider";
  }
  if (object.type === "numeric-input") {
    return "numericInput";
  }
  if (object.type === "switch") {
    return "switch";
  }
  if (object.type === "value-input") {
    return "value-input";
  }
  if (object.type === "valueSelect") {
    return "valueSelect";
  }
  if (object.type === "radio-group") {
    return "radio-group";
  }
  return "select";
}

function resolveOperatorActionPreviewActionType(object: OperatorActionPreviewObject, kind: string): string {
  if (
    kind === "pulse"
    && object.type === "button"
    && object.action.type === "pulse"
    && Number.isFinite(object.action.durationMs)
  ) {
    return `pulse ${Math.max(1, Math.floor(object.action.durationMs))}ms`;
  }
  return kind;
}

function resolveOperatorActionPreviewTemplate(object: OperatorActionPreviewObject): string {
  const objectTemplate = object.operatorActionLogging?.messageTemplate;
  if (objectTemplate?.trim()) {
    return objectTemplate;
  }
  if (object.type === "button") {
    return DEFAULT_OPERATOR_ACTION_BUTTON_TEMPLATE;
  }
  if (object.type === "checkbox") {
    return DEFAULT_OPERATOR_ACTION_CHECKBOX_TEMPLATE;
  }
  if (object.type === "slider") {
    return DEFAULT_OPERATOR_ACTION_SLIDER_TEMPLATE;
  }
  if (object.type === "numeric-input") {
    return DEFAULT_OPERATOR_ACTION_NUMERIC_INPUT_TEMPLATE;
  }
  return DEFAULT_OPERATOR_ACTION_VALUE_CHANGE_TEMPLATE;
}

function resolveOperatorActionPreviewTarget(object: OperatorActionPreviewObject): string {
  if (object.type === "button") {
    if (object.action.type === "write" || object.action.type === "pulse" || object.action.type === "toggle") {
      return object.action.tag?.trim() || "Tag.Name";
    }
    if (object.action.type === "writeConst" || object.action.type === "setInternalVar") {
      return object.action.name?.trim() || "Tag.Name";
    }
    if (object.action.type === "setLW") {
      return `LW${Math.max(0, Math.floor(object.action.address))}`;
    }
    if (object.action.type === "runMacro") {
      return object.action.macroId?.trim() || "Tag.Name";
    }
    return "Tag.Name";
  }
  if (object.type === "checkbox") {
    return object.writeTag?.trim() || object.tag?.trim() || "Tag.Name";
  }
  if (object.type === "slider") {
    return object.writeTag?.trim() || object.tag?.trim() || "Tag.Name";
  }
  if (object.type === "valueSelect") {
    if (object.target.type === "tag") {
      return object.target.tag?.trim() || "Tag.Name";
    }
    if (object.target.type === "internal") {
      return object.target.name?.trim() || "Tag.Name";
    }
    return `LW${Math.max(0, Math.floor(object.target.address))}`;
  }
  const maybeTarget = (object as { targetTag?: string }).targetTag;
  const maybeWriteTag = (object as { writeTag?: string }).writeTag;
  const maybeTag = (object as { tag?: string }).tag;
  return maybeTarget?.trim() || maybeWriteTag?.trim() || maybeTag?.trim() || "Tag.Name";
}

function buildOperatorActionPreviewMessage(object: OperatorActionPreviewObject): string {
  const actionKind = resolveOperatorActionPreviewKind(object);
  const description = object.description?.trim() || object.name?.trim() || object.id;
  const unit = "unit" in object && typeof object.unit === "string" ? object.unit : "";
  const values = {
    user: "admin",
    role: "engineer",
    objectName: object.name ?? "",
    description,
    objectId: object.id,
    objectType: object.type,
    screenName: "Main",
    screenId: "main",
    target: resolveOperatorActionPreviewTarget(object),
    oldValue: formatOperatorActionPreviewValue(10),
    newValue: formatOperatorActionPreviewValue(25),
    unit: unit ?? "",
    timestamp: OPERATOR_ACTION_PREVIEW_TIMESTAMP,
    actionType: resolveOperatorActionPreviewActionType(object, actionKind),
  };
  const template = resolveOperatorActionPreviewTemplate(object);
  const preview = renderOperatorActionPreviewTemplate(template, values);
  return preview || renderOperatorActionPreviewTemplate(DEFAULT_OPERATOR_ACTION_VALUE_CHANGE_TEMPLATE, values);
}

function OperatorActionLogSection({
  project,
  object,
  onPatch,
}: {
  project: ScadaProject;
  object: OperatorActionPreviewObject;
  onPatch: (patch: Partial<HmiObject>) => void;
}) {
  const loggingConfig = object.operatorActionLogging;
  const effectiveLoggingEnabled = isOperatorActionEnabledForObject(object, project);
  const loggingStatus = project.operatorActionSettings?.enabled === false
    ? "Disabled by project settings"
    : loggingConfig?.enabled === true
      ? "Explicitly enabled"
      : loggingConfig?.enabled === false
        ? "Explicitly disabled"
        : effectiveLoggingEnabled
          ? "Enabled by default"
          : "Disabled by default";
  const preview = buildOperatorActionPreviewMessage(object);
  return (
    <>
      <Divider style={{ margin: "10px 0" }} />
      <Typography.Text strong>Operator Action Log</Typography.Text>
      <Space wrap style={{ marginTop: 8, marginBottom: 8 }}>
        <span>Enable logging</span>
        <Switch
          checked={effectiveLoggingEnabled}
          onChange={(checked) =>
            onPatch({
              operatorActionLogging: {
                ...(loggingConfig ?? {}),
                enabled: checked,
              },
            } as Partial<HmiObject>)
          }
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {loggingStatus}
        </Typography.Text>
      </Space>
      <Form.Item label="Message template">
        <Input.TextArea
          rows={3}
          value={loggingConfig?.messageTemplate ?? ""}
          placeholder={resolveOperatorActionPreviewTemplate(object)}
          onChange={(event) => {
            const nextTemplate = event.target.value;
            if (loggingConfig?.enabled === undefined && !nextTemplate.trim()) {
              onPatch({ operatorActionLogging: undefined } as Partial<HmiObject>);
              return;
            }
            onPatch({
              operatorActionLogging: {
                ...(loggingConfig ?? {}),
                messageTemplate: nextTemplate.trim() ? nextTemplate : undefined,
              },
            } as Partial<HmiObject>);
          }}
        />
      </Form.Item>
      <Form.Item label="Preview">
        <Input.TextArea rows={3} value={preview} readOnly />
      </Form.Item>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Supported placeholders: {OPERATOR_ACTION_SUPPORTED_PLACEHOLDERS}
      </Typography.Text>
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
  const [trendTagPickerOpen, setTrendTagPickerOpen] = useState(false);
  const [trendSettingsOpen, setTrendSettingsOpen] = useState(false);
  const [trendSettingsInitialTab, setTrendSettingsInitialTab] = useState<"appearance" | "performance" | "axes" | "series" | "table" | "toolbar">("appearance");
  const editorRuntimeValues = buildIndexedAddressRuntimeValues({ variables: project.variables });
  const driverById = useMemo(
    () => new Map(project.drivers.map((driver) => [driver.id, driver] as const)),
    [project.drivers],
  );
  const trendAvailableTags = useMemo<TrendTagInfo[]>(
    () => project.tags.map((tag): TrendTagInfo => ({
      id: tag.id ?? tag.name,
      name: tag.name,
      displayName: tag.name,
      unit: tag.unit,
      dataType: tag.dataType === "BOOL"
        ? "boolean"
        : tag.dataType === "STRING"
          ? "string"
          : "number",
      description: tag.description,
      group: tag.group,
      min: tag.min,
      max: tag.max,
      sourceType: tag.sourceType,
      driverType: tag.driverId ? driverById.get(tag.driverId)?.type : undefined,
    })),
    [driverById, project.tags],
  );

  useEffect(() => {
    setIndexedEditorTarget(null);
    setTrendTagPickerOpen(false);
    setTrendSettingsOpen(false);
    setTrendSettingsInitialTab("appearance");
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
  const supportsRotationAnimation = ROTATION_ANIMATION_SUPPORTED_TYPES.has(object.type);

  const generalContent = (
    <>
      <Form.Item label="ID">
        <Input value={object.id} disabled />
      </Form.Item>
      <Form.Item label="Name">
        <Input value={object.name ?? ""} onChange={(e) => onPatch({ name: e.target.value })} />
      </Form.Item>
      <Form.Item label="Description">
        <Input.TextArea
          rows={2}
          value={object.description ?? ""}
          onChange={(event) => {
            const nextDescription = event.target.value;
            onPatch({ description: nextDescription.trim() ? nextDescription : undefined });
          }}
        />
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
      {supportsRotationAnimation ? (
        <RotationAnimationFields
          project={project}
          object={object}
          bindings={templateBindings}
          buildIndexControl={buildIndexControl}
          onPatch={onPatch}
        />
      ) : null}
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
      onOpenTrendTagPicker={() => setTrendTagPickerOpen(true)}
      onOpenTrendSettings={(tab) => {
        setTrendSettingsInitialTab(tab ?? "appearance");
        setTrendSettingsOpen(true);
      }}
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
        allowClear
        onChange={(nextValue) => onPatch({ visibleTag: nextValue } as Partial<HmiObject>)}
      />
      <Space className="object-property-panel__runtime-switch-row">
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
        allowClear
        onChange={(nextValue) => onPatch({ disabledTag: nextValue } as Partial<HmiObject>)}
      />
      <Space className="object-property-panel__runtime-switch-row">
        <span>Invert Disabled</span>
        <Switch checked={object.disabledInvert ?? false} onChange={(checked) => onPatch({ disabledInvert: checked } as Partial<HmiObject>)} />
      </Space>
      {hasRuntimeStateBinding ? (
        <div className="object-property-panel__runtime-hint">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Runtime visibility/disabled bindings are active for this object.
          </Typography.Text>
        </div>
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
      {object.type === "trendChart" ? (
        <>
          <TrendTagPickerDialog
            open={trendTagPickerOpen}
            tags={trendAvailableTags}
            selectedTags={object.selectedTags ?? []}
            axes={object.axes ?? []}
            onClose={() => setTrendTagPickerOpen(false)}
            onApply={(nextTags, nextAxes) => {
              onPatch({
                selectedTags: nextTags,
                axes: nextAxes,
              } as Partial<HmiObject>);
              setTrendTagPickerOpen(false);
            }}
          />
          <TrendSettingsPanel
            open={trendSettingsOpen}
            settings={{ ...defaultTrendSettings(), ...(object.settings ?? {}), renderer: "echarts" }}
            axes={object.axes ?? []}
            selectedTags={object.selectedTags ?? []}
            initialTab={trendSettingsInitialTab}
            onClose={() => setTrendSettingsOpen(false)}
            onSettingsChange={(next) => onPatch({ settings: next } as Partial<HmiObject>)}
            onAxesChange={(next) => onPatch({ axes: next } as Partial<HmiObject>)}
            onSelectedTagsChange={(next) => onPatch({ selectedTags: next } as Partial<HmiObject>)}
          />
        </>
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
  onOpenTrendTagPicker,
  onOpenTrendSettings,
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
  onOpenTrendTagPicker?: () => void;
  onOpenTrendSettings?: (tab?: "appearance" | "performance" | "axes" | "series" | "table" | "toolbar") => void;
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
            step={0.1}
            value={roundToTenths(object.strokeWidth)}
            onChange={(v) => onPatch({ strokeWidth: roundToTenths(Math.max(1, Number(v ?? 1))) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Line Cap">
          <Select
            value={object.lineCap ?? "round"}
            options={[
              { label: "butt", value: "butt" },
              { label: "round", value: "round" },
              { label: "square", value: "square" },
            ]}
            onChange={(value) => onPatch({ lineCap: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Line Join">
          <Select
            value={object.lineJoin ?? "round"}
            options={[
              { label: "miter", value: "miter" },
              { label: "round", value: "round" },
              { label: "bevel", value: "bevel" },
            ]}
            onChange={(value) => onPatch({ lineJoin: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Corner Radius / Connection Radius">
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            step={0.5}
            value={Math.max(0, object.cornerRadius ?? 0)}
            onChange={(v) => onPatch({ cornerRadius: Math.max(0, Number(v ?? 0)) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Typography.Text type="secondary">Use Merge Lines to convert connected line segments into one pipe/polyline.</Typography.Text>
        <Divider style={{ margin: "10px 0" }} />
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
            value={formatNumberArrayToTenths(object.points)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value) as unknown;
                if (!Array.isArray(parsed)) {
                  return;
                }
                const points = parsed
                  .map((item) => Number(item))
                  .filter((item) => Number.isFinite(item))
                  .map((item) => roundToTenths(item));
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
          {
            key: "flowAnimation",
            label: "Flow Animation",
            children: (
              <FlowAnimationFields
                project={project}
                object={object}
                bindings={templateBindings}
                buildIndexControl={buildIndexControl}
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
            step={0.1}
            value={roundToTenths(object.strokeWidth ?? 0)}
            onChange={(v) => onPatch({ strokeWidth: roundToTenths(Math.max(0, Number(v ?? 0))) } as Partial<HmiObject>)}
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

  if (object.type === "compoundShape") {
    const patternStyleOptions = [
      { label: "solid", value: "solid" },
      { label: "beveledHatch", value: "beveledHatch" },
      { label: "beveledHatchDense", value: "beveledHatchDense" },
      { label: "beveledHatchWide", value: "beveledHatchWide" },
      { label: "beveledCrosshatch", value: "beveledCrosshatch" },
      { label: "beveledZigzag", value: "beveledZigzag" },
    ];
    const applyCompoundPreset = (preset: "metal" | "warning" | "glass") => {
      if (preset === "metal") {
        onPatch({
          fill: "#1f242a",
          fillPatternStyle: "beveledHatchWide",
          fillPatternColor: "#4f5a66",
          stroke: "#a7b2bc",
          strokeWidth: 7,
          strokePatternStyle: "beveledCrosshatch",
          strokePatternColor: "#f0c000",
        } as Partial<HmiObject>);
        return;
      }
      if (preset === "warning") {
        onPatch({
          fill: "#202020",
          fillPatternStyle: "beveledHatchDense",
          fillPatternColor: "#4a4a4a",
          stroke: "#a8a8a8",
          strokeWidth: 7,
          strokePatternStyle: "beveledZigzag",
          strokePatternColor: "#f2b400",
        } as Partial<HmiObject>);
        return;
      }
      onPatch({
        fill: "#131c25",
        fillPatternStyle: "beveledHatch",
        fillPatternColor: "#3a6f93",
        stroke: "#b8d8ea",
        strokeWidth: 6,
        strokePatternStyle: "beveledHatchWide",
        strokePatternColor: "#90bddb",
      } as Partial<HmiObject>);
    };
    return (
      <>
        <Form.Item label="Quick Preset">
          <Space size={8} wrap>
            <WorkbenchButton onClick={() => applyCompoundPreset("metal")}>Metal</WorkbenchButton>
            <WorkbenchButton onClick={() => applyCompoundPreset("warning")}>Warning</WorkbenchButton>
            <WorkbenchButton onClick={() => applyCompoundPreset("glass")}>Glass</WorkbenchButton>
          </Space>
        </Form.Item>
        <ColorField label="Fill Color" value={object.fill ?? ""} fallback="#262626" onChange={(next) => onPatch({ fill: next } as Partial<HmiObject>)} />
        <Form.Item label="Fill Style">
          <Select
            value={object.fillPatternStyle ?? "solid"}
            options={patternStyleOptions}
            onChange={(value) => onPatch({ fillPatternStyle: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <ColorField
          label="Fill Style Color"
          value={object.fillPatternColor ?? ""}
          fallback={object.stroke ?? "#8c8c8c"}
          onChange={(next) => onPatch({ fillPatternColor: next } as Partial<HmiObject>)}
        />
        <ColorField label="Stroke Color" value={object.stroke ?? ""} fallback="#8c8c8c" onChange={(next) => onPatch({ stroke: next } as Partial<HmiObject>)} />
        <Form.Item label="Stroke Style">
          <Select
            value={object.strokePatternStyle ?? "solid"}
            options={patternStyleOptions}
            onChange={(value) => onPatch({ strokePatternStyle: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <ColorField
          label="Stroke Style Color"
          value={object.strokePatternColor ?? ""}
          fallback={object.stroke ?? "#8c8c8c"}
          onChange={(next) => onPatch({ strokePatternColor: next } as Partial<HmiObject>)}
        />
        <Form.Item label="Stroke Width">
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            step={0.1}
            value={roundToTenths(object.strokeWidth ?? 0)}
            onChange={(v) => onPatch({ strokeWidth: roundToTenths(Math.max(0, Number(v ?? 0))) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Fill Rule">
          <Select
            value={object.fillRule ?? "nonzero"}
            options={[
              { label: "nonzero", value: "nonzero" },
              { label: "evenodd", value: "evenodd" },
            ]}
            onChange={(value) => onPatch({ fillRule: value } as Partial<HmiObject>)}
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
        <OperatorActionLogSection project={project} object={object} onPatch={onPatch} />
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
        <OperatorActionLogSection project={project} object={object} onPatch={onPatch} />
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
        <OperatorActionLogSection project={project} object={object} onPatch={onPatch} />
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
        <OperatorActionLogSection project={project} object={object} onPatch={onPatch} />
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
              ?
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
    const templateOptions = project.screens
      .filter((screen) => screen.kind === "template")
      .map((screen) => ({ label: `${screen.name} (${screen.kind})`, value: screen.id }));
    const selectedScreen = project.screens.find((screen) => screen.id === object.screenId);
    const isLegacySelection = Boolean(selectedScreen && selectedScreen.kind !== "template");
    const options = isLegacySelection && selectedScreen
      ? [{ label: `${selectedScreen.name} (${selectedScreen.kind}) [legacy]`, value: selectedScreen.id }, ...templateOptions]
      : templateOptions;

    return (
      <>
        <Form.Item label="Frame Screen">
          <Select value={object.screenId} options={options} onChange={(value) => onPatch({ screenId: value } as Partial<HmiObject>)} />
        </Form.Item>
        {isLegacySelection ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Legacy frame target is preserved. New assignments are limited to template screens.
          </Typography.Text>
        ) : null}
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
        <Space size={16} style={{ display: "flex", marginBottom: 8 }}>
          <Space>
            <span>Template Background</span>
            <Switch
              checked={object.showTemplateBackground ?? true}
              onChange={(checked) => onPatch({ showTemplateBackground: checked } as Partial<HmiObject>)}
            />
          </Space>
          <Space>
            <span>Clip</span>
            <Switch checked={object.clipContent ?? true} onChange={(checked) => onPatch({ clipContent: checked } as Partial<HmiObject>)} />
          </Space>
          <Space>
            <span>Border</span>
            <Switch checked={object.showBorder ?? true} onChange={(checked) => onPatch({ showBorder: checked } as Partial<HmiObject>)} />
          </Space>
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
        <OperatorActionLogSection project={project} object={object} onPatch={onPatch} />
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
        <OperatorActionLogSection project={project} object={object} onPatch={onPatch} />
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

  if (object.type === "trendChart") {
    const defaultSettings = defaultTrendSettings();
    const settings = { ...defaultSettings, ...(object.settings ?? {}) };
    const selectedTags = object.selectedTags ?? [];
    const axes = object.axes ?? [];
    return (
      <div className="object-property-trend">
        <div className="object-property-trend__section">
          <div className="object-property-trend__title">Series & Axes</div>
          <div className="object-property-trend__stat-row"><span>Selected series</span><strong>{selectedTags.length}</strong></div>
          <div className="object-property-trend__stat-row"><span>Axes</span><strong>{axes.length}</strong></div>
          <Form.Item style={{ marginTop: 8, marginBottom: 0 }}>
            <Space wrap>
              <WorkbenchButton variant="primary" onClick={() => onOpenTrendTagPicker?.()}>Add / Remove Tags...</WorkbenchButton>
              <WorkbenchButton onClick={() => onOpenTrendSettings?.("appearance")}>Trend Settings...</WorkbenchButton>
              <WorkbenchButton onClick={() => onOpenTrendSettings?.("axes")}>Axis Titles...</WorkbenchButton>
            </Space>
          </Form.Item>
        </div>

        <div className="object-property-trend__section">
          <div className="object-property-trend__title">Range & Live</div>
          <Form.Item label="Default Range">
            <Select
              value={object.rangePreset ?? "1h"}
              options={[
                { value: "5m", label: "Last 5 min" },
                { value: "15m", label: "Last 15 min" },
                { value: "1h", label: "Last 1 hour" },
                { value: "8h", label: "Last 8 hours" },
                { value: "24h", label: "Last 24 hours" },
                { value: "custom", label: "Custom" },
              ]}
              onChange={(value) => onPatch({ rangePreset: value } as Partial<HmiObject>)}
            />
          </Form.Item>
          {(object.rangePreset ?? "1h") === "custom" ? (
            <>
              <Form.Item label="Custom From (unix ms)">
                <InputNumber style={{ width: "100%" }} value={object.customFrom} onChange={(value) => onPatch({ customFrom: Number(value ?? Date.now() - 3600000) } as Partial<HmiObject>)} />
              </Form.Item>
              <Form.Item label="Custom To (unix ms)">
                <InputNumber style={{ width: "100%" }} value={object.customTo} onChange={(value) => onPatch({ customTo: Number(value ?? Date.now()) } as Partial<HmiObject>)} />
              </Form.Item>
            </>
          ) : null}
          <Space className="object-property-panel__runtime-switch-row">
            <span>Start Live Mode</span>
            <Switch checked={object.liveMode ?? false} onChange={(checked) => onPatch({ liveMode: checked } as Partial<HmiObject>)} />
          </Space>
          <Space className="object-property-panel__runtime-switch-row">
            <span>Show Toolbar</span>
            <Switch checked={object.showToolbar ?? true} onChange={(checked) => onPatch({ showToolbar: checked } as Partial<HmiObject>)} />
          </Space>
          <Space className="object-property-panel__runtime-switch-row">
            <span>Show Status Bar</span>
            <Switch checked={object.showStatusBar ?? true} onChange={(checked) => onPatch({ showStatusBar: checked } as Partial<HmiObject>)} />
          </Space>
        </div>

        <div className="object-property-trend__section">
          <div className="object-property-trend__title">Runtime Access</div>
          <Space className="object-property-panel__runtime-switch-row">
            <span>Show settings button in runtime</span>
            <Switch checked={object.showRuntimeSettingsButton ?? true} onChange={(checked) => onPatch({ showRuntimeSettingsButton: checked } as Partial<HmiObject>)} />
          </Space>
          <Space className="object-property-panel__runtime-switch-row">
            <span>Allow runtime settings editor</span>
            <Switch checked={object.allowRuntimeSettings ?? true} onChange={(checked) => onPatch({ allowRuntimeSettings: checked } as Partial<HmiObject>)} />
          </Space>
          <Form.Item label="Trend settings role">
            <Select
              value={(object.runtimeSettingsRequiredRole ?? 0) as AccessRoleLevel}
              options={accessRoleOptions}
              onChange={(value) => onPatch({ runtimeSettingsRequiredRole: Number(value) as AccessRoleLevel } as Partial<HmiObject>)}
            />
          </Form.Item>
        </div>

        <div className="object-property-trend__section">
          <div className="object-property-trend__title">Performance</div>
          <Form.Item label="Aggregation">
            <Select
              value={settings.aggregation}
              options={[
                { value: "auto", label: "auto" },
                { value: "raw", label: "raw" },
                { value: "minmax", label: "minmax" },
                { value: "avg", label: "avg" },
                { value: "lttb", label: "lttb" },
              ]}
              onChange={(value) => onPatch({ settings: { ...settings, aggregation: value } } as Partial<HmiObject>)}
            />
          </Form.Item>
          <Form.Item label="Max Points / Series">
            <InputNumber
              style={{ width: "100%" }}
              min={1000}
              max={8000}
              value={settings.maxVisiblePointsPerSeries}
              onChange={(value) => onPatch({ settings: { ...settings, maxVisiblePointsPerSeries: Math.max(1000, Math.min(8000, Number(value ?? 4000))) } } as Partial<HmiObject>)}
            />
          </Form.Item>
          <Form.Item label="Live Buffer Limit">
            <InputNumber style={{ width: "100%" }} min={200} max={20000} value={settings.maxLivePointsPerTag} onChange={(value) => onPatch({ settings: { ...settings, maxLivePointsPerTag: Math.max(200, Math.min(20000, Number(value ?? 5000))) } } as Partial<HmiObject>)} />
          </Form.Item>
          <Form.Item label="Max cached ranges">
            <InputNumber style={{ width: "100%" }} min={8} max={256} value={settings.maxCachedRanges} onChange={(value) => onPatch({ settings: { ...settings, maxCachedRanges: Math.max(8, Math.min(256, Number(value ?? 48))) } } as Partial<HmiObject>)} />
          </Form.Item>
          <Form.Item label="Axis offset step">
            <InputNumber style={{ width: "100%" }} min={8} max={220} value={settings.axisOffsetStep} onChange={(value) => onPatch({ settings: { ...settings, axisOffsetStep: Math.max(8, Math.min(220, Number(value ?? 46))) } } as Partial<HmiObject>)} />
          </Form.Item>
          <Form.Item label="Axis scale gap">
            <InputNumber style={{ width: "100%" }} min={0} max={64} value={settings.axisScaleGap} onChange={(value) => onPatch({ settings: { ...settings, axisScaleGap: Math.max(0, Math.min(64, Number(value ?? 6))) } } as Partial<HmiObject>)} />
          </Form.Item>
          <Space className="object-property-panel__runtime-switch-row">
            <span>Show bottom table</span>
            <Switch checked={settings.showSeriesTable} onChange={(checked) => onPatch({ settings: { ...settings, showSeriesTable: checked } } as Partial<HmiObject>)} />
          </Space>
          <Form.Item label="Bottom table rows">
            <InputNumber style={{ width: "100%" }} min={2} max={24} value={settings.seriesTableRows} onChange={(value) => onPatch({ settings: { ...settings, seriesTableRows: Math.max(2, Math.min(24, Number(value ?? 6))) } } as Partial<HmiObject>)} />
          </Form.Item>
          <Form.Item style={{ marginTop: 8, marginBottom: 0 }}>
            <WorkbenchButton onClick={() => onOpenTrendSettings?.("performance")}>Advanced Trend Settings...</WorkbenchButton>
          </Form.Item>
        </div>
      </div>
    );
  }

  if (object.type === "eventTable") {
    const mode = object.mode ?? (object.enableHistoryMode ? "history" : "online");
    const toolbarPosition = object.toolbarPosition ?? (object.showToolbar === false ? "hidden" : "top");
    const toolbarVisible = object.showToolbar !== false && toolbarPosition !== "hidden";
    const showOperatorActionsToggle = typeof object.showOperatorActionsToggle === "boolean"
      ? object.showOperatorActionsToggle
      : toolbarVisible;
    const defaultColumns: Array<{ key: string; label: string }> = [
      { key: "timestamp", label: "Timestamp" },
      { key: "priority", label: "Priority" },
      { key: "category", label: "Category" },
      { key: "message", label: "Message" },
      { key: "source", label: "Source" },
      { key: "value", label: "Value" },
      { key: "state", label: "State" },
      { key: "ack", label: "Ack" },
    ];
    const visibleColumns = object.columns ?? defaultColumns.map((item) => item.key);
    const columnRows = Array.from(new Set([...defaultColumns.map((item) => item.key), ...visibleColumns]));
    const updateSingleStringValue = (raw: string, onDone: (items: string[]) => void) => {
      const value = raw.trim();
      onDone(value ? [value] : []);
    };
    const updateSingleNumberValue = (raw: string, onDone: (items: number[]) => void) => {
      const value = raw.trim();
      if (!value) {
        onDone([]);
        return;
      }
      const parsed = Number(value);
      onDone(Number.isFinite(parsed) ? [parsed] : []);
    };

    return (
      <>
        <Typography.Text strong>Data</Typography.Text>
        <Form.Item label="Title">
          <Input value={object.title ?? ""} onChange={(e) => onPatch({ title: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Title Position">
          <Select
            value={object.titlePosition ?? (object.showTitle === false ? "hidden" : "top")}
            options={[
              { value: "top", label: "top" },
              { value: "bottom", label: "bottom" },
              { value: "hidden", label: "hidden" },
            ]}
            onChange={(value) => onPatch({ titlePosition: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Title Align">
          <Select
            value={object.titleAlign ?? "left"}
            options={[
              { value: "left", label: "left" },
              { value: "center", label: "center" },
              { value: "right", label: "right" },
            ]}
            onChange={(value) => onPatch({ titleAlign: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Mode">
          <Select
            value={mode}
            options={[
              { value: "online", label: "online" },
              { value: "history", label: "history" },
            ]}
            onChange={(value: "online" | "history") => onPatch({
              mode: value,
              enableHistoryMode: value === "history",
            } as Partial<HmiObject>)}
          />
        </Form.Item>
        <div className="object-property-panel__switch-list">
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Active Only</span>
            <Switch checked={object.showActiveOnly ?? false} onChange={(checked) => onPatch({ showActiveOnly: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Unacknowledged Only</span>
            <Switch checked={object.showUnacknowledgedOnly ?? false} onChange={(checked) => onPatch({ showUnacknowledgedOnly: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Cleared</span>
            <Switch checked={object.showCleared ?? false} onChange={(checked) => onPatch({ showCleared: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Показывать действия оператора по умолчанию</span>
            <Switch checked={object.showOperatorActions === true} onChange={(checked) => onPatch({ showOperatorActions: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Кнопка показа/скрытия действий оператора (legacy)</span>
            <Switch checked={showOperatorActionsToggle} disabled />
          </div>
        </div>
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
          Иконка показа/скрытия действий оператора теперь автоматически отображается, когда виден toolbar.
        </Typography.Text>
        <Form.Item label="Max Rows">
          <InputNumber
            style={{ width: "100%" }}
            min={1}
            max={5000}
            value={object.maxRows ?? 100}
            onChange={(value) => onPatch({ maxRows: Math.max(1, Math.min(5000, Number(value ?? 100))) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Category Filter (single value)">
          <Input
            value={object.categoryFilter?.[0] ?? ""}
            onChange={(event) => updateSingleStringValue(event.target.value, (next) => onPatch({ categoryFilter: next } as Partial<HmiObject>))}
          />
        </Form.Item>
        <Form.Item label="Priority Filter (single value)">
          <Input
            value={typeof object.priorityFilter?.[0] === "number" ? String(object.priorityFilter[0]) : ""}
            onChange={(event) => updateSingleNumberValue(event.target.value, (next) => onPatch({ priorityFilter: next } as Partial<HmiObject>))}
          />
        </Form.Item>
        <Form.Item label="Source Tag Filter">
          <Input value={object.sourceTagFilter ?? ""} onChange={(event) => onPatch({ sourceTagFilter: event.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Search Text">
          <Input value={object.searchText ?? ""} onChange={(event) => onPatch({ searchText: event.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Sort By">
          <Select
            value={object.sortBy ?? "time"}
            options={[
              { value: "time", label: "time" },
              { value: "priority", label: "priority" },
              { value: "category", label: "category" },
              { value: "message", label: "message" },
              { value: "sourceTagName", label: "sourceTagName" },
            ]}
            onChange={(value) => onPatch({ sortBy: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Sort Direction">
          <Select
            value={object.sortDirection ?? "desc"}
            options={[
              { value: "asc", label: "asc" },
              { value: "desc", label: "desc" },
            ]}
            onChange={(value) => onPatch({ sortDirection: value } as Partial<HmiObject>)}
          />
        </Form.Item>

        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Columns</Typography.Text>
        <div className="object-property-panel__switch-list">
          {columnRows.map((column) => {
            const isVisible = visibleColumns.includes(column);
            return (
              <div key={column} style={{ border: "1px solid #2d2d2d", padding: 8, background: "#202123" }}>
                <div className="object-property-panel__switch-item">
                  <span className="object-property-panel__switch-label">{column}</span>
                  <Switch
                    checked={isVisible}
                    onChange={(checked) => {
                      const next = checked
                        ? (visibleColumns.includes(column) ? visibleColumns : [...visibleColumns, column])
                        : visibleColumns.filter((item) => item !== column);
                      onPatch({ columns: next } as Partial<HmiObject>);
                    }}
                  />
                </div>
                <Form.Item label="Display Label" style={{ marginBottom: 8 }}>
                  <Input
                    value={object.columnLabels?.[column] ?? ""}
                    onChange={(event) => onPatch({
                      columnLabels: {
                        ...(object.columnLabels ?? {}),
                        [column]: event.target.value,
                      },
                    } as Partial<HmiObject>)}
                  />
                </Form.Item>
                <Form.Item label="Width (px)" style={{ marginBottom: 0 }}>
                  <InputNumber
                    style={{ width: "100%" }}
                    min={40}
                    max={1400}
                    value={object.columnWidths?.[column]}
                    onChange={(value) => {
                      const nextWidths = { ...(object.columnWidths ?? {}) };
                      if (value === null) {
                        delete nextWidths[column];
                      } else {
                        nextWidths[column] = Math.max(40, Math.min(1400, Number(value)));
                      }
                      onPatch({ columnWidths: nextWidths } as Partial<HmiObject>);
                    }}
                  />
                </Form.Item>
                <Form.Item label="Align" style={{ marginTop: 8, marginBottom: 0 }}>
                  <Select
                    value={object.columnAlignments?.[column] ?? object.cellTextAlign ?? "left"}
                    options={[
                      { value: "left", label: "left" },
                      { value: "center", label: "center" },
                      { value: "right", label: "right" },
                    ]}
                    onChange={(value) => onPatch({
                      columnAlignments: {
                        ...(object.columnAlignments ?? {}),
                        [column]: value,
                      },
                    } as Partial<HmiObject>)}
                  />
                </Form.Item>
              </div>
            );
          })}
        </div>

        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Appearance</Typography.Text>
        <div className="object-property-panel__switch-list">
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Title</span>
            <Switch
              checked={(object.titlePosition ?? (object.showTitle === false ? "hidden" : "top")) !== "hidden"}
              onChange={(checked) => onPatch({
                showTitle: checked,
                titlePosition: checked
                  ? ((object.titlePosition === "hidden" ? "top" : object.titlePosition) ?? "top")
                  : "hidden",
              } as Partial<HmiObject>)}
            />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Header</span>
            <Switch checked={object.showHeader ?? true} onChange={(checked) => onPatch({ showHeader: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Grid Lines</span>
            <Switch checked={object.showGridLines ?? true} onChange={(checked) => onPatch({ showGridLines: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Zebra Rows</span>
            <Switch checked={object.zebraRows ?? true} onChange={(checked) => onPatch({ zebraRows: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Compact Mode</span>
            <Switch checked={object.compactMode ?? false} onChange={(checked) => onPatch({ compactMode: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Transparent Background</span>
            <Switch checked={object.transparentBackground ?? false} onChange={(checked) => onPatch({ transparentBackground: checked } as Partial<HmiObject>)} />
          </div>
        </div>
        <Form.Item label="Font Size">
          <InputNumber style={{ width: "100%" }} min={8} max={28} value={object.fontSize ?? 12} onChange={(v) => onPatch({ fontSize: Number(v ?? 12) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Row Height">
          <InputNumber style={{ width: "100%" }} min={18} max={80} value={object.rowHeight ?? 26} onChange={(v) => onPatch({ rowHeight: Number(v ?? 26) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Header Height">
          <InputNumber style={{ width: "100%" }} min={18} max={80} value={object.headerHeight ?? 28} onChange={(v) => onPatch({ headerHeight: Number(v ?? 28) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Title Font Size">
          <InputNumber style={{ width: "100%" }} min={8} max={32} value={object.titleFontSize ?? 13} onChange={(v) => onPatch({ titleFontSize: Number(v ?? 13) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Title Height">
          <InputNumber style={{ width: "100%" }} min={16} max={80} value={object.titleHeight ?? 28} onChange={(v) => onPatch({ titleHeight: Number(v ?? 28) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Cell Padding">
          <InputNumber style={{ width: "100%" }} min={2} max={24} value={object.cellPadding ?? 8} onChange={(v) => onPatch({ cellPadding: Number(v ?? 8) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Cell Text Align">
          <Select
            value={object.cellTextAlign ?? "left"}
            options={[
              { value: "left", label: "left" },
              { value: "center", label: "center" },
              { value: "right", label: "right" },
            ]}
            onChange={(value) => onPatch({ cellTextAlign: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Border Radius">
          <InputNumber style={{ width: "100%" }} min={0} max={32} value={object.borderRadius ?? 6} onChange={(v) => onPatch({ borderRadius: Number(v ?? 6) } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Border Width">
          <InputNumber style={{ width: "100%" }} min={0} max={6} value={object.borderWidth ?? 1} onChange={(v) => onPatch({ borderWidth: Number(v ?? 1) } as Partial<HmiObject>)} />
        </Form.Item>
        <ColorField label="Background Color" value={object.backgroundColor ?? "#1f2328"} fallback="#1f2328" onChange={(next) => onPatch({ backgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Text Color" value={object.textColor ?? "#d6d6d6"} fallback="#d6d6d6" onChange={(next) => onPatch({ textColor: next } as Partial<HmiObject>)} />
        <ColorField label="Muted Text Color" value={object.mutedTextColor ?? "#9ea6ad"} fallback="#9ea6ad" onChange={(next) => onPatch({ mutedTextColor: next } as Partial<HmiObject>)} />
        <ColorField label="Header Background" value={object.headerBackgroundColor ?? "#2a3038"} fallback="#2a3038" onChange={(next) => onPatch({ headerBackgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Header Text Color" value={object.headerTextColor ?? "#ced8df"} fallback="#ced8df" onChange={(next) => onPatch({ headerTextColor: next } as Partial<HmiObject>)} />
        <ColorField label="Title Text Color" value={object.titleTextColor ?? object.headerTextColor ?? "#ced8df"} fallback="#ced8df" onChange={(next) => onPatch({ titleTextColor: next } as Partial<HmiObject>)} />
        <ColorField label="Title Background" value={object.titleBackgroundColor ?? object.headerBackgroundColor ?? "#2a3038"} fallback="#2a3038" onChange={(next) => onPatch({ titleBackgroundColor: next } as Partial<HmiObject>)} />
        <ColorField label="Border Color" value={object.borderColor ?? "#3c3c3c"} fallback="#3c3c3c" onChange={(next) => onPatch({ borderColor: next } as Partial<HmiObject>)} />
        <ColorField label="Grid Line Color" value={object.gridLineColor ?? "#30363d"} fallback="#30363d" onChange={(next) => onPatch({ gridLineColor: next } as Partial<HmiObject>)} />
        <ColorField label="Selected Row Color" value={object.selectedRowColor ?? "#223248"} fallback="#223248" onChange={(next) => onPatch({ selectedRowColor: next } as Partial<HmiObject>)} />
        <ColorField label="Active Alarm Color" value={object.activeAlarmColor ?? "#4ec94e"} fallback="#4ec94e" onChange={(next) => onPatch({ activeAlarmColor: next } as Partial<HmiObject>)} />
        <ColorField label="Warning Color" value={object.warningColor ?? "#e6b450"} fallback="#e6b450" onChange={(next) => onPatch({ warningColor: next } as Partial<HmiObject>)} />
        <ColorField label="Critical Color" value={object.criticalColor ?? "#f48771"} fallback="#f48771" onChange={(next) => onPatch({ criticalColor: next } as Partial<HmiObject>)} />
        <ColorField label="Acknowledged Color" value={object.acknowledgedColor ?? "#73c991"} fallback="#73c991" onChange={(next) => onPatch({ acknowledgedColor: next } as Partial<HmiObject>)} />
        <ColorField label="Cleared Color" value={object.clearedColor ?? "#8b949e"} fallback="#8b949e" onChange={(next) => onPatch({ clearedColor: next } as Partial<HmiObject>)} />

        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Toolbar / Status</Typography.Text>
        <div className="object-property-panel__switch-list">
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Toolbar</span>
            <Switch checked={object.showToolbar ?? true} onChange={(checked) => onPatch({ showToolbar: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Status Bar</span>
            <Switch checked={object.showStatusBar ?? true} onChange={(checked) => onPatch({ showStatusBar: checked } as Partial<HmiObject>)} />
          </div>
        </div>
        <Form.Item label="Toolbar Position">
          <Select
            value={toolbarPosition}
            options={[
              { value: "top", label: "top" },
              { value: "bottom", label: "bottom" },
              { value: "hidden", label: "hidden" },
            ]}
            onChange={(value) => onPatch({ toolbarPosition: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Status Position">
          <Select
            value={object.statusPosition ?? "bottom"}
            options={[
              { value: "top", label: "top" },
              { value: "bottom", label: "bottom" },
              { value: "hidden", label: "hidden" },
            ]}
            onChange={(value) => onPatch({ statusPosition: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Status Style">
          <Select
            value={object.statusStyle ?? "archiveLike"}
            options={[
              { value: "archiveLike", label: "archiveLike" },
              { value: "compact", label: "compact" },
              { value: "hidden", label: "hidden" },
            ]}
            onChange={(value) => onPatch({ statusStyle: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <div className="object-property-panel__switch-item">
          <span className="object-property-panel__switch-label">Status Single Line</span>
          <Switch checked={object.statusSingleLine !== false} onChange={(checked) => onPatch({ statusSingleLine: checked } as Partial<HmiObject>)} />
        </div>
        <div className="object-property-panel__switch-list">
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Last Update</span>
            <Switch checked={object.showLastUpdate ?? true} onChange={(checked) => onPatch({ showLastUpdate: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Record Count</span>
            <Switch checked={object.showRecordCount ?? true} onChange={(checked) => onPatch({ showRecordCount: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Database Status</span>
            <Switch checked={object.showDatabaseStatus ?? true} onChange={(checked) => onPatch({ showDatabaseStatus: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Mode Indicator</span>
            <Switch checked={object.showModeIndicator ?? true} onChange={(checked) => onPatch({ showModeIndicator: checked } as Partial<HmiObject>)} />
          </div>
        </div>

        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Actions</Typography.Text>
        <div className="object-property-panel__switch-list">
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Enable Ack Button</span>
            <Switch checked={object.enableAckButton ?? true} onChange={(checked) => onPatch({ enableAckButton: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Enable Ack Selected Button</span>
            <Switch checked={object.enableAckSelectedButton ?? true} onChange={(checked) => onPatch({ enableAckSelectedButton: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Enable Silence Button</span>
            <Switch checked={object.enableSilenceButton ?? true} onChange={(checked) => onPatch({ enableSilenceButton: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Enable Sounds Button</span>
            <Switch checked={object.enableSoundsButton ?? true} onChange={(checked) => onPatch({ enableSoundsButton: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Enable Search In Toolbar</span>
            <Switch checked={object.enableSearchInToolbar ?? true} onChange={(checked) => onPatch({ enableSearchInToolbar: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Search</span>
            <Switch checked={object.showSearch ?? object.enableSearchInToolbar ?? true} onChange={(checked) => onPatch({ showSearch: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Enable Active Only Toggle</span>
            <Switch checked={object.enableActiveOnlyToggle ?? true} onChange={(checked) => onPatch({ enableActiveOnlyToggle: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Active Only Toggle</span>
            <Switch checked={object.showActiveOnlyToggle ?? object.enableActiveOnlyToggle ?? true} onChange={(checked) => onPatch({ showActiveOnlyToggle: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Enable Unacked Only Toggle</span>
            <Switch checked={object.enableUnackedOnlyToggle ?? true} onChange={(checked) => onPatch({ enableUnackedOnlyToggle: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Unacked Toggle</span>
            <Switch checked={object.showUnackedOnlyToggle ?? object.enableUnackedOnlyToggle ?? true} onChange={(checked) => onPatch({ showUnackedOnlyToggle: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Enable CSV Export Button</span>
            <Switch checked={object.enableCsvExportButton ?? true} onChange={(checked) => onPatch({ enableCsvExportButton: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Ack Visible Button</span>
            <Switch checked={object.showAckVisibleButton ?? object.enableAckButton ?? true} onChange={(checked) => onPatch({ showAckVisibleButton: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Sound Mute Button</span>
            <Switch checked={object.showSoundMuteButton ?? object.showSilenceButton ?? object.enableSilenceButton ?? true} onChange={(checked) => onPatch({ showSoundMuteButton: checked, showSilenceButton: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Enable Sounds Button</span>
            <Switch checked={object.showEnableSoundsButton ?? object.enableSoundsButton ?? true} onChange={(checked) => onPatch({ showEnableSoundsButton: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show Settings Button</span>
            <Switch checked={object.showSettingsButton ?? true} onChange={(checked) => onPatch({ showSettingsButton: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show CSV Export Button</span>
            <Switch checked={object.showCsvExportButton ?? object.enableCsvExportButton ?? true} onChange={(checked) => onPatch({ showCsvExportButton: checked } as Partial<HmiObject>)} />
          </div>
        </div>
        <Form.Item label="Settings Required Role">
          <Select
            value={(object.settingsRequiredRole ?? 0) as AccessRoleLevel}
            options={accessRoleOptions}
            onChange={(value) => onPatch({ settingsRequiredRole: Number(value) as AccessRoleLevel } as Partial<HmiObject>)}
          />
        </Form.Item>

        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>Sound</Typography.Text>
        <Form.Item label="Playback Mode">
          <Select
            value={object.soundPlaybackMode ?? "once"}
            options={[
              { value: "once", label: "once" },
              { value: "loopUntilAcknowledged", label: "loopUntilAcknowledged" },
            ]}
            onChange={(value) => onPatch({ soundPlaybackMode: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Sound Mute Mode">
          <Select
            value={object.soundMuteMode ?? "silenceCurrent"}
            options={[
              { value: "silenceCurrent", label: "Silence current sound only" },
              { value: "disableUntilEnabled", label: "Disable sounds until manually enabled" },
            ]}
            onChange={(value) => onPatch({ soundMuteMode: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Repeat Interval (ms)">
          <InputNumber style={{ width: "100%" }} min={1000} max={60000} value={object.soundRepeatIntervalMs ?? 5000} onChange={(value) => onPatch({ soundRepeatIntervalMs: Math.max(1000, Math.min(60000, Number(value ?? 5000))) } as Partial<HmiObject>)} />
        </Form.Item>
        <div className="object-property-panel__switch-list">
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Stop Sound on Ack</span>
            <Switch checked={object.stopSoundOnAck !== false} onChange={(checked) => onPatch({ stopSoundOnAck: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Stop Sound on Silence</span>
            <Switch checked={object.stopSoundOnSilence !== false} onChange={(checked) => onPatch({ stopSoundOnSilence: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Fallback by Priority</span>
            <Switch checked={object.enableSoundFallbackByPriority !== false} onChange={(checked) => onPatch({ enableSoundFallbackByPriority: checked } as Partial<HmiObject>)} />
          </div>
        </div>
        <Form.Item label="Fallback Notification Sound Id">
          <Input value={object.fallbackNotificationSoundId ?? ""} onChange={(event) => onPatch({ fallbackNotificationSoundId: event.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Fallback Warning Sound Id">
          <Input value={object.fallbackWarningSoundId ?? ""} onChange={(event) => onPatch({ fallbackWarningSoundId: event.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Fallback Alarm Sound Id">
          <Input value={object.fallbackAlarmSoundId ?? ""} onChange={(event) => onPatch({ fallbackAlarmSoundId: event.target.value } as Partial<HmiObject>)} />
        </Form.Item>

        <Divider style={{ margin: "10px 0" }} />
        <Typography.Text strong>History</Typography.Text>
        <div className="object-property-panel__switch-list">
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Enable History Mode</span>
            <Switch
              checked={object.enableHistoryMode ?? false}
              onChange={(checked) => onPatch({
                enableHistoryMode: checked,
                mode: checked ? "history" : "online",
              } as Partial<HmiObject>)}
            />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Show History Toolbar</span>
            <Switch checked={object.showHistoryToolbar ?? true} onChange={(checked) => onPatch({ showHistoryToolbar: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Server-side Pagination</span>
            <Switch checked={object.serverSidePagination ?? true} onChange={(checked) => onPatch({ serverSidePagination: checked } as Partial<HmiObject>)} />
          </div>
          <div className="object-property-panel__switch-item">
            <span className="object-property-panel__switch-label">Enable CSV Export</span>
            <Switch checked={object.enableCsvExport ?? true} onChange={(checked) => onPatch({ enableCsvExport: checked } as Partial<HmiObject>)} />
          </div>
        </div>
        <Form.Item label="History Preset">
          <Select
            value={object.historyPeriodPreset ?? "lastHour"}
            options={[
              { value: "lastHour", label: "lastHour" },
              { value: "shift", label: "shift" },
              { value: "day", label: "day" },
              { value: "week", label: "week" },
              { value: "custom", label: "custom" },
            ]}
            onChange={(value) => onPatch({ historyPeriodPreset: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="History From (ms timestamp)">
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            value={object.historyFrom ?? undefined}
            onChange={(value) => onPatch({ historyFrom: value === null ? undefined : Number(value) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="History To (ms timestamp)">
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            value={object.historyTo ?? undefined}
            onChange={(value) => onPatch({ historyTo: value === null ? undefined : Number(value) } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Page Size">
          <InputNumber
            style={{ width: "100%" }}
            min={1}
            max={5000}
            value={object.pageSize ?? 50}
            onChange={(value) => onPatch({ pageSize: Math.max(1, Math.min(5000, Math.round(Number(value ?? 50)))) } as Partial<HmiObject>)}
          />
        </Form.Item>
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
        <OperatorActionLogSection project={project} object={object} onPatch={onPatch} />
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
        <OperatorActionLogSection project={project} object={object} onPatch={onPatch} />
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
        <OperatorActionLogSection project={project} object={object} onPatch={onPatch} />
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
