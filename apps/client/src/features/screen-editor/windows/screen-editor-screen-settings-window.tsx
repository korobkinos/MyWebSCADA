import type { HmiScreen } from "@web-scada/shared";
import { ColorPicker, Input, Space } from "antd";
import {
  WorkbenchSection,
} from "../../../components/workbench";

type ScreenEditorScreenSettingsWindowProps = {
  screen: HmiScreen;
  onUpdateScreen: (patch: Partial<HmiScreen>) => void;
};

function normalizeScreenBackgroundColor(value: string | undefined): string {
  const fallback = "#1e1e1e";
  const token = (value ?? "").trim();
  if (!token) {
    return fallback;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(token)) {
    return token.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(token)) {
    return `#${token.slice(1).split("").map((ch) => ch + ch).join("").toLowerCase()}`;
  }
  return fallback;
}

export function ScreenEditorScreenSettingsWindow(props: ScreenEditorScreenSettingsWindowProps) {
  const { screen, onUpdateScreen } = props;

  return (
    <div className="screen-editor-window-content screen-editor-screen-settings-window">
      <WorkbenchSection title="SCREEN">
        <div className="screen-editor-settings-form">
          <label className="screen-editor-settings-field">
            <span>Name</span>
            <input
              className="workbench-input"
              value={screen.name}
              onChange={(event) => onUpdateScreen({ name: event.target.value })}
            />
          </label>

          <div className="screen-editor-settings-row">
            <label className="screen-editor-settings-field">
              <span>Width</span>
              <input
                className="workbench-input"
                type="number"
                min={1}
                value={screen.width}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value) && value > 0) {
                    onUpdateScreen({ width: value });
                  }
                }}
              />
            </label>
            <label className="screen-editor-settings-field">
              <span>Height</span>
              <input
                className="workbench-input"
                type="number"
                min={1}
                value={screen.height}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value) && value > 0) {
                    onUpdateScreen({ height: value });
                  }
                }}
              />
            </label>
          </div>

          <label className="screen-editor-settings-field">
            <span>Background</span>
            <Space.Compact className="workbench-color-input-group">
              <ColorPicker
                value={normalizeScreenBackgroundColor(screen.background)}
                onChangeComplete={(color) => onUpdateScreen({ background: color.toHexString() })}
              />
              <Input
                className="workbench-input"
                value={screen.background ?? "#1e1e1e"}
                onChange={(event) => onUpdateScreen({ background: event.target.value })}
                placeholder="#1e1e1e"
              />
            </Space.Compact>
          </label>

        </div>
      </WorkbenchSection>
    </div>
  );
}
