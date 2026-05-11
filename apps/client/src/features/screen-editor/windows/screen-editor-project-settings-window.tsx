import { useEffect, useState } from "react";
import type { ScadaProject } from "@web-scada/shared";
import {
  WorkbenchButton,
  WorkbenchSection,
} from "../../../components/workbench";

type EditorTool = "select" | "pan";
const ACTIVE_TOOL_STORAGE_KEY = "screenEditor.activeTool";

function readStoredTool(): EditorTool {
  if (typeof window === "undefined") {
    return "select";
  }
  const raw = window.localStorage.getItem(ACTIVE_TOOL_STORAGE_KEY);
  return raw === "pan" ? "pan" : "select";
}

type ScreenEditorProjectSettingsWindowProps = {
  project: ScadaProject;
  onUpdateProject: (next: ScadaProject) => void;
  onSaveProject: () => Promise<void>;
  isSavingProject: boolean;
};

export function ScreenEditorProjectSettingsWindow(props: ScreenEditorProjectSettingsWindowProps) {
  const { project, onUpdateProject, onSaveProject, isSavingProject } = props;
  const [defaultTool, setDefaultTool] = useState<EditorTool>(() => readStoredTool());

  useEffect(() => {
    setDefaultTool(readStoredTool());
  }, [project]);

  const updateProjectInfo = (patch: Partial<NonNullable<ScadaProject["projectInfo"]>>) => {
    onUpdateProject({
      ...project,
      projectInfo: {
        ...(project.projectInfo ?? {}),
        ...patch,
      },
    });
  };

  const updateUiSettings = (patch: Partial<NonNullable<ScadaProject["uiSettings"]>>) => {
    onUpdateProject({
      ...project,
      uiSettings: {
        ...(project.uiSettings ?? {}),
        ...patch,
      },
    });
  };

  const updateEditorSettings = (patch: Partial<NonNullable<ScadaProject["editorSettings"]>>) => {
    onUpdateProject({
      ...project,
      editorSettings: {
        ...(project.editorSettings ?? {}),
        ...patch,
      },
    });
  };

  return (
    <div className="screen-editor-window-content screen-editor-project-settings-window">
      <WorkbenchSection title="PROJECT">
        <div className="screen-editor-settings-form">
          <label className="screen-editor-settings-field">
            <span>Name</span>
            <input
              className="workbench-input"
              value={project.name}
              onChange={(event) => onUpdateProject({ ...project, name: event.target.value })}
            />
          </label>
          <label className="screen-editor-settings-field">
            <span>Title</span>
            <input
              className="workbench-input"
              value={project.projectInfo?.title ?? ""}
              onChange={(event) => updateProjectInfo({ title: event.target.value })}
            />
          </label>
          <label className="screen-editor-settings-field">
            <span>Subtitle</span>
            <input
              className="workbench-input"
              value={project.projectInfo?.subtitle ?? ""}
              onChange={(event) => updateProjectInfo({ subtitle: event.target.value })}
            />
          </label>
        </div>
      </WorkbenchSection>

      <WorkbenchSection title="EDITOR SETTINGS">
        <div className="screen-editor-settings-form">
          <label className="screen-editor-settings-check">
            <input
              type="checkbox"
              checked={project.uiSettings?.editorWheelZoomEnabled ?? true}
              onChange={(event) => updateUiSettings({ editorWheelZoomEnabled: event.target.checked })}
            />
            <span>Enable mouse wheel zoom</span>
          </label>
          <label className="screen-editor-settings-check">
            <input
              type="checkbox"
              checked={project.editorSettings?.showObjectFrames ?? false}
              onChange={(event) => updateEditorSettings({ showObjectFrames: event.target.checked })}
            />
            <span>Show object frames</span>
          </label>
          <label className="screen-editor-settings-check">
            <input
              type="checkbox"
              checked={project.uiSettings?.hideMainMenu ?? false}
              onChange={(event) => updateUiSettings({ hideMainMenu: event.target.checked })}
            />
            <span>Hide main menu</span>
          </label>
          <label className="screen-editor-settings-field">
            <span>Theme</span>
            <select
              className="workbench-select"
              value={project.uiSettings?.theme ?? "dark"}
              onChange={(event) => updateUiSettings({ theme: event.target.value as "light" | "dark" })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label className="screen-editor-settings-field">
            <span>Default Tool</span>
            <select
              className="workbench-select"
              value={defaultTool}
              onChange={(event) => {
                const nextTool = event.target.value === "pan" ? "pan" : "select";
                setDefaultTool(nextTool);
                window.localStorage.setItem(ACTIVE_TOOL_STORAGE_KEY, nextTool);
                window.dispatchEvent(
                  new CustomEvent("screenEditor.activeTool.changed", {
                    detail: { tool: nextTool },
                  }),
                );
              }}
            >
              <option value="select">Select</option>
              <option value="pan">Hand</option>
            </select>
          </label>
        </div>
      </WorkbenchSection>

      <div className="screen-editor-settings-actions">
        <WorkbenchButton variant="primary" onClick={() => void onSaveProject()} disabled={isSavingProject}>
          {isSavingProject ? "Saving..." : "Save Project"}
        </WorkbenchButton>
      </div>
    </div>
  );
}
