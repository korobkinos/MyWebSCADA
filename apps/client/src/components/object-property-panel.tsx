import { useState } from "react";
import type {
  Asset,
  ElementBindingDefinition,
  ElementLibrary,
  HmiObject,
  HmiScreen,
  RuntimeValueSource,
  ScadaProject,
  TextStyle,
} from "@web-scada/shared";
import { parseTagSegments, resolveElementBindingAssignment, resolveRuntimeValueSync } from "@web-scada/shared";
import { Button, Divider, Form, Input, InputNumber, Select, Space, Switch, Tag, Typography } from "antd";
import { TagPicker } from "./tag-picker";

type Props = {
  project: ScadaProject;
  screen: HmiScreen;
  assets: Asset[];
  libraries: ElementLibrary[];
  object: HmiObject | null;
  elementBindings?: ElementBindingDefinition[];
  onPatch: (patch: Partial<HmiObject>) => void;
  onDelete: () => void;
};

const fontOptions = ["Arial", "Tahoma", "Verdana", "Consolas", "Segoe UI", "Roboto", "Noto Sans"];

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
  onChange,
}: {
  project: ScadaProject;
  bindings: ElementBindingDefinition[];
  value: string | undefined;
  bindingLabel?: string;
  tagLabel?: string;
  onChange: (nextValue: string) => void;
}) {
  return (
    <>
      <BindingQuickSelect bindings={bindings} value={value} label={bindingLabel} onChange={onChange} />
      <Form.Item label={tagLabel}>
        {extractBindingKey(value) ? (
          <Input value={value} onChange={(event) => onChange(event.target.value)} />
        ) : (
          <TagPicker project={project} value={value ?? ""} onChange={(tag) => onChange(tag ?? "")} />
        )}
      </Form.Item>
    </>
  );
}

type RuntimeSourceMode = "none" | "static" | "internal" | "lw" | "tag";

function runtimeSourceModeOf(source: RuntimeValueSource | undefined): RuntimeSourceMode {
  if (!source) {
    return "none";
  }
  if (source.type === "expression") {
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
    </Space>
  );
}

export function ObjectPropertyPanel({ project, assets, libraries, object, elementBindings, onPatch, onDelete }: Props) {
  if (!object) {
    return <div>Select object</div>;
  }

  const applyTextStyle = (patch: Partial<TextStyle>) => {
    if (!hasTextStyle(object)) {
      return;
    }
    onPatch({ textStyle: { ...object.textStyle, ...patch } } as Partial<HmiObject>);
  };

  return (
    <Form layout="vertical" size="small">
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

      <Divider style={{ margin: "10px 0" }} />
      <SpecificPropertyFields
        project={project}
        assets={assets}
        libraries={libraries}
        object={object}
        elementBindings={elementBindings}
        onPatch={onPatch}
      />

      {hasTextStyle(object) ? (
        <>
          <Divider style={{ margin: "10px 0" }} />
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
          <Form.Item label="Text Color">
            <Input value={object.textStyle.color} onChange={(e) => applyTextStyle({ color: e.target.value })} />
          </Form.Item>
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
      ) : null}

      <Divider style={{ margin: "10px 0" }} />
      <Button danger onClick={onDelete} block>
        Delete Object
      </Button>
    </Form>
  );
}

function SpecificPropertyFields({
  project,
  assets,
  libraries,
  object,
  elementBindings,
  onPatch,
}: {
  project: ScadaProject;
  assets: Asset[];
  libraries: ElementLibrary[];
  object: HmiObject;
  elementBindings?: ElementBindingDefinition[];
  onPatch: (patch: Partial<HmiObject>) => void;
}) {
  const [stateImagePreviewValue, setStateImagePreviewValue] = useState<string>("0");
  const templateBindings = elementBindings ?? [];
  if (object.type === "text") {
    return (
      <Form.Item label="Text">
        <Input value={object.text} onChange={(e) => onPatch({ text: e.target.value } as Partial<HmiObject>)} />
      </Form.Item>
    );
  }

  if (object.type === "value-display") {
    return (
      <>
        <TagFieldWithBindingSource
          project={project}
          bindings={templateBindings}
          value={object.tag}
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
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="True Text">
          <Input value={object.trueText} onChange={(e) => onPatch({ trueText: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="False Text">
          <Input value={object.falseText} onChange={(e) => onPatch({ falseText: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
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
            options={assets.map((asset) => ({ label: asset.name, value: asset.id }))}
            onChange={(value) => onPatch({ backgroundAssetId: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Pressed Asset">
          <Select
            value={object.pressedBackgroundAssetId}
            allowClear
            options={assets.map((asset) => ({ label: asset.name, value: asset.id }))}
            onChange={(value) => onPatch({ pressedBackgroundAssetId: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Background Color">
          <Input value={object.backgroundColor ?? "#0958d9"} onChange={(e) => onPatch({ backgroundColor: e.target.value } as Partial<HmiObject>)} />
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
        {writeAction ? (
          <>
            <TagFieldWithBindingSource
              project={project}
              bindings={templateBindings}
              value={writeAction.tag}
              bindingLabel="Action Binding"
              tagLabel="Action Tag"
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
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
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
            options={assets.map((asset) => ({ label: asset.name, value: asset.id }))}
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
        {imageWriteAction ? (
          <>
            <TagFieldWithBindingSource
              project={project}
              bindings={templateBindings}
              value={imageWriteAction.tag}
              bindingLabel="Action Binding"
              tagLabel="Action Tag"
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
        <Form.Item label="State Tag">
          <TagPicker project={project} value={object.stateTag ?? ""} onChange={(tag) => onPatch({ stateTag: tag } as Partial<HmiObject>)} />
        </Form.Item>
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
        <Form.Item label="Opacity">
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            max={1}
            step={0.05}
            value={object.opacity ?? 1}
            onChange={(v) => onPatch({ opacity: Number(v ?? 1) } as Partial<HmiObject>)}
          />
        </Form.Item>
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
          onChange={(nextValue) => onPatch({ tag: nextValue } as Partial<HmiObject>)}
        />
        <Form.Item label="Default Asset">
          <Select
            value={object.defaultAssetId}
            allowClear
            options={assets.map((asset) => ({ label: asset.name, value: asset.id }))}
            onChange={(value) => onPatch({ defaultAssetId: value } as Partial<HmiObject>)}
          />
        </Form.Item>
        <Form.Item label="Bad Quality Asset">
          <Select
            value={object.badQualityAssetId}
            allowClear
            options={assets.map((asset) => ({ label: asset.name, value: asset.id }))}
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
                options={assets.map((asset) => ({ label: asset.name, value: asset.id }))}
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
          Active state: {activeState?.name ?? "default"} | asset: {previewAsset?.name ?? previewAssetId ?? "none"}
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
    const editorRuntimeContext = {
      tagValues: buildEditorRuntimeTagValues(project),
    };

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
        <Form.Item label="Open Tag">
          <Input value={object.openTag ?? ""} onChange={(e) => onPatch({ openTag: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Closed Tag">
          <Input value={object.closedTag ?? ""} onChange={(e) => onPatch({ closedTag: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
      </>
    );
  }

  if (object.type === "pump") {
    return (
      <>
        <Form.Item label="Label">
          <Input value={object.label ?? ""} onChange={(e) => onPatch({ label: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Run Tag">
          <Input value={object.runTag ?? ""} onChange={(e) => onPatch({ runTag: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
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
        <Form.Item label="Border Color">
          <Input value={object.borderColor ?? "#888"} onChange={(e) => onPatch({ borderColor: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Border Width">
          <InputNumber style={{ width: "100%" }} value={object.borderWidth ?? 1} onChange={(v) => onPatch({ borderWidth: Number(v ?? 1) } as Partial<HmiObject>)} />
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
