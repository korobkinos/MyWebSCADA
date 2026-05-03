import type { Asset, ElementLibrary, HmiObject, HmiScreen, ScadaProject, TextStyle } from "@web-scada/shared";
import { Button, Divider, Form, Input, InputNumber, Select, Space, Switch } from "antd";

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
          <Input value={object.tag} onChange={(e) => onPatch({ tag: e.target.value } as Partial<HmiObject>)} />
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
          <Input value={object.tag} onChange={(e) => onPatch({ tag: e.target.value } as Partial<HmiObject>)} />
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
          <Input value={object.tag} onChange={(e) => onPatch({ tag: e.target.value } as Partial<HmiObject>)} />
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
    return (
      <>
        <Form.Item label="Text">
          <Input value={object.text} onChange={(e) => onPatch({ text: e.target.value } as Partial<HmiObject>)} />
        </Form.Item>
        <Form.Item label="Action Type">
          <Input value={object.action.type} disabled />
        </Form.Item>
      </>
    );
  }

  if (object.type === "switch") {
    return (
      <Form.Item label="Tag">
        <Input value={object.tag} onChange={(e) => onPatch({ tag: e.target.value } as Partial<HmiObject>)} />
      </Form.Item>
    );
  }

  if (object.type === "image") {
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
        <Form.Item label="State Tag">
          <Input value={object.stateTag ?? ""} onChange={(e) => onPatch({ stateTag: e.target.value } as Partial<HmiObject>)} />
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

  if (object.type === "libraryElementInstance") {
    const libraryOptions = libraries.map((library) => ({ label: library.name, value: library.id }));
    const selectedLibrary = libraries.find((library) => library.id === object.libraryId);
    const elementOptions = (selectedLibrary?.elements ?? []).map((element) => ({ label: element.name, value: element.id }));
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
