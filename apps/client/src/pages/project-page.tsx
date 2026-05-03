import { useEffect, useState } from "react";
import { Button, Input, Space, Typography, message } from "antd";
import { projectSchema, type ScadaProject } from "@web-scada/shared";
import { useScadaStore } from "../store/scada-store";

const { TextArea } = Input;

export function ProjectPage() {
  const project = useScadaStore((s) => s.project);
  const saveProject = useScadaStore((s) => s.saveProject);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const [jsonText, setJsonText] = useState("");

  useEffect(() => {
    if (project) {
      setJsonText(JSON.stringify(project, null, 2));
    }
  }, [project]);

  if (!project) {
    return <Typography.Text>Проект не загружен</Typography.Text>;
  }

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
    <Space direction="vertical" style={{ width: "100%" }}>
      <Space>
        <Button onClick={applyJson}>Apply JSON</Button>
        <Button type="primary" onClick={() => void saveProject()}>
          Save to Server
        </Button>
      </Space>
      <TextArea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={30} style={{ fontFamily: "Consolas, monospace" }} />
    </Space>
  );
}

