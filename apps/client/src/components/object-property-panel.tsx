import { useState } from "react";
import type { Asset, ElementLibrary, HmiObject, HmiScreen, ScadaProject, TextStyle } from "@web-scada/shared";
import { Button, Divider, Form, Input, InputNumber, Select, Space, Switch, Tag, Typography } from "antd";
import { TagPicker } from "./tag-picker";

type Props = {
  project: ScadaProject;
  screen: HmiScreen;
  assets: Asset[];
  libraries: ElementLibrary[];
  object: HmiObject | null;
  onPatch: (patch: Partial<HmiObject>) => void;
  onDelete: () => void;
};

const fontOptions = ["Arial", "Tahoma", "Verdana", "Consolas", "Segoe UI", "Roboto", "Noto Sans"];

export function ObjectPropertyPanel({ project, assets, libraries, object, onPatch, onDelete }: Props) {
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
      <SpecificPropertyFields project={project} assets={assets} libraries={libraries} object={object} onPatch={onPatch} />

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
  onPatch,
}: {
  project: ScadaProject;
  assets: Asset[];
  libraries: ElementLibrary[];
  object: HmiObject;
  onPatch: (patch: Partial<HmiObject>) => void;
}) {
  const [stateImagePreviewValue, setStateImagePreviewValue] = useState<string>("0");
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
        <Form.Item label="Tag">
          <TagPicker project={project} value={object.tag} onChange={(tag) => onPatch({ tag } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Suffix">
          <Input value={object.suffix ?? ""} onChange={(e) => onPatch({ suffix: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
      </>
    );
  }

  if (object.type === "value-input") {
    return (
      <>
        <Form.Item label="Tag">
          <TagPicker project={project} value={object.tag} onChange={(tag) => onPatch({ tag } as Partial<HmiObject>)} />
        </Form.Item>
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
        <Form.Item label="Tag">
          <TagPicker project={project} value={object.tag} onChange={(tag) => onPatch({ tag } as Partial<HmiObject>)} />
        </Form.Item>
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
          <Input value={object.action.type} disabled />
        </Form.Item>
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
      </>
    );
  }

  if (object.type === "switch") {
    return (
      <Form.Item label="Tag">
        <TagPicker project={project} value={object.tag} onChange={(tag) => onPatch({ tag } as Partial<HmiObject>)} />
      </Form.Item>
    );
  }

  if (object.type === "image") {
    const imageRunMacroAction = object.action?.type === "runMacro" ? object.action : undefined;
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
        <Form.Item label="Source Tag">
          <Input value={object.tag} onChange={(event) => onPatch({ tag: event.target.value } as Partial<HmiObject>)} />
        </Form.Item>
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
    object.type === "switch"
  );
}
