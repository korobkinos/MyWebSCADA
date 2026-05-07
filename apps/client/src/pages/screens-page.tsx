import { Button, Input, InputNumber, List, Select, Space, Tag, Typography } from "antd";
import type { ScreenKind } from "@web-scada/shared";
import { useState } from "react";
import { useScadaStore } from "../store/scada-store";

export function ScreensPage() {
  const project = useScadaStore((s) => s.project);
  const currentScreenId = useScadaStore((s) => s.currentScreenId);
  const setCurrentScreen = useScadaStore((s) => s.setCurrentScreen);
  const addScreen = useScadaStore((s) => s.addScreen);
  const updateScreen = useScadaStore((s) => s.updateScreen);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);

  const [kind, setKind] = useState<ScreenKind>("screen");

  if (!project) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const screen = project.screens.find((item) => item.id === currentScreenId) ?? project.screens[0];
  if (!screen) {
    return <Typography.Text>No screens</Typography.Text>;
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Space>
        <Select value={kind} onChange={(value) => setKind(value)} options={["screen", "popup", "template"].map((item) => ({ label: item, value: item }))} />
        <Button onClick={() => addScreen(kind)}>Create</Button>
      </Space>

      <List
        dataSource={project.screens}
        renderItem={(item) => (
          <List.Item onClick={() => setCurrentScreen(item.id)} style={{ cursor: "pointer", fontWeight: item.id === screen.id ? 700 : 400 }}>
            <Space>
              <span>{item.name}</span>
              <Tag>{item.kind}</Tag>
            </Space>
          </List.Item>
        )}
      />

      <Typography.Text strong>Screen properties</Typography.Text>
      <Input value={screen.name} onChange={(e) => updateScreen(screen.id, { name: e.target.value })} />
      <InputNumber style={{ width: "100%" }} value={screen.width} onChange={(value) => updateScreen(screen.id, { width: Number(value ?? 320) })} />
      <InputNumber style={{ width: "100%" }} value={screen.height} onChange={(value) => updateScreen(screen.id, { height: Number(value ?? 200) })} />
      <Input value={screen.background ?? ""} onChange={(e) => updateScreen(screen.id, { background: e.target.value })} />
      <Button onClick={() => updateProjectJson({ ...project, startScreenId: screen.id })}>Set Start Screen</Button>
    </Space>
  );
}
