import { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, Input, Select, Space, Switch, Tabs, Typography, message } from "antd";
import { projectSchema, type ProjectTheme, type ScadaProject } from "@web-scada/shared";
import { useScadaStore } from "../store/scada-store";

const { TextArea } = Input;

type ProjectSettingsFormState = {
  name: string;
  title: string;
  subtitle: string;
  customer: string;
  site: string;
  author: string;
  description: string;
  notes: string;
  theme: ProjectTheme;
  hideMainMenu: boolean;
  editorWheelZoomEnabled: boolean;
};

function toFormState(project: ScadaProject): ProjectSettingsFormState {
  return {
    name: project.name,
    title: project.projectInfo?.title ?? "",
    subtitle: project.projectInfo?.subtitle ?? "",
    customer: project.projectInfo?.customer ?? "",
    site: project.projectInfo?.site ?? "",
    author: project.projectInfo?.author ?? "",
    description: project.projectInfo?.description ?? "",
    notes: project.projectInfo?.notes ?? "",
    theme: project.uiSettings?.theme ?? "light",
    hideMainMenu: project.uiSettings?.hideMainMenu ?? false,
    editorWheelZoomEnabled: project.uiSettings?.editorWheelZoomEnabled ?? true,
  };
}

function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function applySettingsToProject(project: ScadaProject, form: ProjectSettingsFormState): ScadaProject {
  const nextInfo = {
    title: normalizeOptionalText(form.title),
    subtitle: normalizeOptionalText(form.subtitle),
    customer: normalizeOptionalText(form.customer),
    site: normalizeOptionalText(form.site),
    author: normalizeOptionalText(form.author),
    description: normalizeOptionalText(form.description),
    notes: normalizeOptionalText(form.notes),
  };

  const hasProjectInfo = Object.values(nextInfo).some((value) => typeof value === "string" && value.length > 0);
  const nextUiSettings = {
    theme: form.theme,
    hideMainMenu: form.hideMainMenu,
    editorWheelZoomEnabled: form.editorWheelZoomEnabled,
  };

  return {
    ...project,
    name: form.name.trim() || project.name,
    projectInfo: hasProjectInfo ? nextInfo : undefined,
    uiSettings: nextUiSettings,
  };
}

export function ProjectPage() {
  const project = useScadaStore((s) => s.project);
  const saveProject = useScadaStore((s) => s.saveProject);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const [jsonText, setJsonText] = useState("");
  const [formState, setFormState] = useState<ProjectSettingsFormState | null>(null);

  useEffect(() => {
    if (!project) {
      setFormState(null);
      setJsonText("");
      return;
    }
    setFormState(toFormState(project));
    setJsonText(JSON.stringify(project, null, 2));
  }, [project]);

  const previewTitle = useMemo(() => {
    if (!formState) {
      return "";
    }
    return formState.title.trim() || formState.name.trim() || "Web SCADA Lite";
  }, [formState]);

  if (!project || !formState) {
    return <Typography.Text>Проект не загружен</Typography.Text>;
  }

  const onFormPatch = (patch: Partial<ProjectSettingsFormState>): void => {
    setFormState((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const applyGeneralSettings = (): void => {
    const next = applySettingsToProject(project, formState);
    updateProjectJson(next);
    setJsonText(JSON.stringify(next, null, 2));
    void message.success("Настройки проекта применены");
  };

  const applyJson = (): void => {
    try {
      const parsed = projectSchema.parse(JSON.parse(jsonText)) as ScadaProject;
      updateProjectJson(parsed);
      void message.success("JSON принят");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Ошибка JSON");
    }
  };

  return (
    <Tabs
      items={[
        {
          key: "general",
          label: "General",
          children: (
            <Space direction="vertical" style={{ width: "100%" }} size="middle">
              <Card size="small" title="Project Information">
                <Form layout="vertical" size="small">
                  <Form.Item label="Project Name">
                    <Input value={formState.name} onChange={(event) => onFormPatch({ name: event.target.value })} />
                  </Form.Item>
                  <Form.Item label="Window Title">
                    <Input value={formState.title} onChange={(event) => onFormPatch({ title: event.target.value })} />
                  </Form.Item>
                  <Form.Item label="Subtitle">
                    <Input value={formState.subtitle} onChange={(event) => onFormPatch({ subtitle: event.target.value })} />
                  </Form.Item>
                  <Form.Item label="Customer">
                    <Input value={formState.customer} onChange={(event) => onFormPatch({ customer: event.target.value })} />
                  </Form.Item>
                  <Form.Item label="Site">
                    <Input value={formState.site} onChange={(event) => onFormPatch({ site: event.target.value })} />
                  </Form.Item>
                  <Form.Item label="Author">
                    <Input value={formState.author} onChange={(event) => onFormPatch({ author: event.target.value })} />
                  </Form.Item>
                  <Form.Item label="Description">
                    <TextArea value={formState.description} rows={3} onChange={(event) => onFormPatch({ description: event.target.value })} />
                  </Form.Item>
                  <Form.Item label="Notes">
                    <TextArea value={formState.notes} rows={3} onChange={(event) => onFormPatch({ notes: event.target.value })} />
                  </Form.Item>
                </Form>
              </Card>

              <Card size="small" title="UI Settings">
                <Form layout="vertical" size="small">
                  <Form.Item label="Theme">
                    <Select
                      value={formState.theme}
                      options={[
                        { label: "Light theme", value: "light" },
                        { label: "Dark theme (#191A1B)", value: "dark" },
                      ]}
                      onChange={(value: ProjectTheme) => onFormPatch({ theme: value })}
                    />
                  </Form.Item>
                  <Form.Item label="Hide Left Main Menu" valuePropName="checked">
                    <Switch checked={formState.hideMainMenu} onChange={(checked) => onFormPatch({ hideMainMenu: checked })} />
                  </Form.Item>
                  <Form.Item label="Enable mouse wheel zoom in editor" valuePropName="checked">
                    <Switch
                      checked={formState.editorWheelZoomEnabled}
                      onChange={(checked) => onFormPatch({ editorWheelZoomEnabled: checked })}
                    />
                  </Form.Item>
                  <Typography.Text type="secondary">
                    Preview: {previewTitle} - theme {formState.theme} - main menu {formState.hideMainMenu ? "hidden" : "visible"}
                  </Typography.Text>
                </Form>
              </Card>

              <Space>
                <Button type="primary" onClick={applyGeneralSettings}>
                  Apply Settings
                </Button>
                <Button onClick={() => void saveProject()}>Save to Server</Button>
              </Space>
            </Space>
          ),
        },
        {
          key: "advanced",
          label: "Advanced JSON",
          children: (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Space>
                <Button onClick={applyJson}>Apply JSON</Button>
                <Button type="primary" onClick={() => void saveProject()}>
                  Save to Server
                </Button>
              </Space>
              <TextArea value={jsonText} onChange={(event) => setJsonText(event.target.value)} rows={28} style={{ fontFamily: "Consolas, monospace" }} />
            </Space>
          ),
        },
      ]}
    />
  );
}

