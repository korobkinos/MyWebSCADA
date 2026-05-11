import type { HmiScreen } from "@web-scada/shared";
import {
  WorkbenchSection,
} from "../../../components/workbench";

type ScreenEditorScreenSettingsWindowProps = {
  screen: HmiScreen;
  onUpdateScreen: (patch: Partial<HmiScreen>) => void;
};

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
            <div className="screen-editor-settings-color-row">
              <input
                className="workbench-input"
                value={screen.background ?? "#1e1e1e"}
                onChange={(event) => onUpdateScreen({ background: event.target.value })}
              />
              <input
                className="screen-editor-settings-color-picker"
                type="color"
                value={screen.background ?? "#1e1e1e"}
                onChange={(event) => onUpdateScreen({ background: event.target.value })}
              />
            </div>
          </label>

          <label className="screen-editor-settings-field">
            <span>Background Fill Mode</span>
            <select
              className="workbench-select"
              value={screen.backgroundFillMode ?? "screen"}
              onChange={(event) =>
                onUpdateScreen({
                  backgroundFillMode: event.target.value === "viewport" ? "viewport" : "screen",
                })
              }
            >
              <option value="screen">Screen bounds only</option>
              <option value="viewport">Fill editor viewport</option>
            </select>
          </label>
        </div>
      </WorkbenchSection>
    </div>
  );
}
