import { useEffect, useState } from "react";
import type { ScadaProject } from "@web-scada/shared";
import { ColorPicker, Input, InputNumber, Select, Space } from "antd";
import {
  WorkbenchButton,
  WorkbenchCollapsibleSection,
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

function normalizeGridColor(value: string | undefined): string {
  const fallback = "#bfc7d5";
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

function normalizeGridLineWidth(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(6, Math.max(0.5, value ?? 1));
}

function normalizeGridOpacity(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0.08;
  }
  return Math.min(1, Math.max(0, value ?? 0.08));
}

function toInputNumberValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type ScreenEditorProjectSettingsWindowProps = {
  project: ScadaProject;
  onUpdateProject: (next: ScadaProject) => void;
  onSaveProject: () => Promise<void>;
  isSavingProject: boolean;
  canUsersView: boolean;
  onOpenUserManagement: () => void;
};

export function ScreenEditorProjectSettingsWindow(props: ScreenEditorProjectSettingsWindowProps) {
  const { project, onUpdateProject, onSaveProject, isSavingProject, canUsersView, onOpenUserManagement } = props;
  const [defaultTool, setDefaultTool] = useState<EditorTool>(() => readStoredTool());

  useEffect(() => {
    setDefaultTool(readStoredTool());
  }, [project]);

  useEffect(() => {
    if ((project.uiSettings?.theme ?? "dark") === "dark") {
      return;
    }
    onUpdateProject({
      ...project,
      uiSettings: {
        ...(project.uiSettings ?? {}),
        theme: "dark",
      },
    });
  }, [onUpdateProject, project]);

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
      <WorkbenchCollapsibleSection title="PROJECT" storageKey="project-settings.project">
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
          <label className="screen-editor-settings-field">
            <span>Window Title</span>
            <input
              className="workbench-input"
              value={project.uiSettings?.windowTitle ?? ""}
              onChange={(event) => updateUiSettings({ windowTitle: event.target.value })}
            />
          </label>
        </div>
      </WorkbenchCollapsibleSection>

      <WorkbenchCollapsibleSection title="EDITOR SETTINGS" storageKey="project-settings.editor">
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
              checked={project.editorSettings?.showEditorGrid ?? true}
              onChange={(event) => updateEditorSettings({ showEditorGrid: event.target.checked })}
            />
            <span>Show subtle editor grid</span>
          </label>
          <label className="screen-editor-settings-field">
            <span>Editor grid color</span>
            <Space.Compact className="workbench-color-input-group">
              <ColorPicker
                value={normalizeGridColor(project.editorSettings?.editorGridColor)}
                onChangeComplete={(color) => updateEditorSettings({ editorGridColor: color.toHexString() })}
              />
              <Input
                className="workbench-input"
                value={project.editorSettings?.editorGridColor ?? "#bfc7d5"}
                onChange={(event) => updateEditorSettings({ editorGridColor: event.target.value })}
                placeholder="#bfc7d5"
              />
            </Space.Compact>
          </label>
          <label className="screen-editor-settings-field">
            <span>Editor grid opacity (0..1)</span>
            <InputNumber
              className="screen-editor-settings-input-number"
              min={0}
              max={1}
              step={0.01}
              value={normalizeGridOpacity(project.editorSettings?.editorGridOpacity)}
              onChange={(value) => updateEditorSettings({ editorGridOpacity: normalizeGridOpacity(Number(value)) })}
            />
          </label>
          <label className="screen-editor-settings-field">
            <span>Editor grid line width (px)</span>
            <InputNumber
              className="screen-editor-settings-input-number"
              min={0.5}
              max={6}
              step={0.5}
              value={normalizeGridLineWidth(project.editorSettings?.editorGridLineWidth)}
              onChange={(value) => updateEditorSettings({ editorGridLineWidth: normalizeGridLineWidth(Number(value)) })}
            />
          </label>
          <label className="screen-editor-settings-field">
            <span>Editor grid line style</span>
            <Select
              className="workbench-select"
              value={project.editorSettings?.editorGridLineStyle ?? "solid"}
              options={[
                { label: "Solid", value: "solid" },
                { label: "Dashed", value: "dashed" },
                { label: "Dotted", value: "dotted" },
                { label: "Dash-dot", value: "dashDot" },
              ]}
              onChange={(value) => updateEditorSettings({ editorGridLineStyle: value })}
            />
          </label>
          <label className="screen-editor-settings-field">
            <span>Arrow key move step (px)</span>
            <InputNumber
              className="screen-editor-settings-input-number"
              min={0.1}
              step={0.1}
              value={toInputNumberValue(project.editorSettings?.keyboardNudgeStepPx) ?? 1}
              onChange={(value) => {
                const parsed = Number(value);
                updateEditorSettings({
                  keyboardNudgeStepPx: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
                });
              }}
            />
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
      </WorkbenchCollapsibleSection>

      <WorkbenchCollapsibleSection title="AUTHORIZATION / RUNTIME" storageKey="project-settings.auth-runtime" defaultCollapsed>
        <div className="screen-editor-settings-form">
          <label className="screen-editor-settings-check">
            <input
              type="checkbox"
              checked={project.uiSettings?.hideMainMenu ?? false}
              onChange={(event) => updateUiSettings({ hideMainMenu: event.target.checked })}
            />
            <span>Runtime hides main menu</span>
          </label>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <WorkbenchButton onClick={onOpenUserManagement} disabled={!canUsersView}>
              Open User Management
            </WorkbenchButton>
          </div>
        </div>
      </WorkbenchCollapsibleSection>

      <div className="screen-editor-settings-actions">
        <WorkbenchButton variant="primary" onClick={() => void onSaveProject()} disabled={isSavingProject}>
          {isSavingProject ? "Saving..." : "Save Project"}
        </WorkbenchButton>
      </div>
    </div>
  );
}
