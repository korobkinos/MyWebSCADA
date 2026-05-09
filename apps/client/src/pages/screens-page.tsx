import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { HmiScreen, ScreenKind } from "@web-scada/shared";
import { Button, Card, ColorPicker, Input, InputNumber, List, Modal, Select, Space, Tag, Typography } from "antd";
import { useScadaStore } from "../store/scada-store";

type ViewMode = "grid" | "list";
type KindFilter = "all" | ScreenKind;

function makeScreenCopy(source: HmiScreen): HmiScreen {
  return {
    ...structuredClone(source),
    id: `${source.kind}_${Math.random().toString(36).slice(2, 7)}`,
    name: `${source.name} Copy`,
  };
}

export function ScreensPage() {
  const navigate = useNavigate();
  const project = useScadaStore((s) => s.project);
  const currentScreenId = useScadaStore((s) => s.currentScreenId);
  const setCurrentScreen = useScadaStore((s) => s.setCurrentScreen);
  const addScreen = useScadaStore((s) => s.addScreen);
  const updateScreen = useScadaStore((s) => s.updateScreen);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);

  const [kind, setKind] = useState<ScreenKind>("screen");
  const [filter, setFilter] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  if (!project) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const screen = project.screens.find((item) => item.id === currentScreenId) ?? project.screens[0];
  if (!screen) {
    return <Typography.Text>No screens</Typography.Text>;
  }

  const filteredScreens = useMemo(() => {
    const term = search.trim().toLowerCase();
    return project.screens.filter((item) => {
      const kindOk = filter === "all" ? true : item.kind === filter;
      const searchOk = !term || item.name.toLowerCase().includes(term) || item.id.toLowerCase().includes(term);
      return kindOk && searchOk;
    });
  }, [filter, project.screens, search]);

  const setStartScreen = (screenId: string) => {
    updateProjectJson({ ...project, startScreenId: screenId });
  };

  const duplicateScreen = (source: HmiScreen) => {
    const copy = makeScreenCopy(source);
    updateProjectJson({
      ...project,
      screens: [...project.screens, copy],
    });
    setCurrentScreen(copy.id);
  };

  const deleteScreen = (screenId: string) => {
    if (project.screens.length <= 1) {
      return;
    }
    const target = project.screens.find((item) => item.id === screenId);
    Modal.confirm({
      title: "Delete screen",
      content: `Delete "${target?.name ?? screenId}"?`,
      okButtonProps: { danger: true },
      onOk: () => {
        const nextScreens = project.screens.filter((item) => item.id !== screenId);
        const fallback = nextScreens[0];
        if (!fallback) {
          return;
        }
        const nextStart = project.startScreenId === screenId ? fallback.id : (project.startScreenId ?? fallback.id);
        updateProjectJson({
          ...project,
          screens: nextScreens,
          startScreenId: nextStart,
        });
        if (screen.id === screenId) {
          setCurrentScreen(fallback.id);
        }
      },
    });
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Card size="small" title="Screens Manager">
        <Space wrap>
          <Select value={kind} onChange={(value) => setKind(value)} options={["screen", "popup", "template"].map((item) => ({ label: item, value: item }))} />
          <Button onClick={() => addScreen(kind)}>Create</Button>
          <Input
            placeholder="Search by name/id"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 220 }}
          />
          <Select
            value={filter}
            onChange={(value) => setFilter(value)}
            style={{ width: 140 }}
            options={[
              { label: "All", value: "all" },
              { label: "Screen", value: "screen" },
              { label: "Popup", value: "popup" },
              { label: "Template", value: "template" },
            ]}
          />
          <Select
            value={viewMode}
            onChange={(value) => setViewMode(value)}
            style={{ width: 120 }}
            options={[
              { label: "Grid", value: "grid" },
              { label: "List", value: "list" },
            ]}
          />
        </Space>

        {viewMode === "grid" ? (
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
            {filteredScreens.map((item) => {
              const isActive = item.id === screen.id;
              const isStart = project.startScreenId === item.id;
              return (
                <Card
                  key={item.id}
                  size="small"
                  hoverable
                  onClick={() => setCurrentScreen(item.id)}
                  style={{
                    cursor: "pointer",
                    borderColor: isActive ? "var(--scada-selected-row-bg)" : undefined,
                    background: isActive ? "var(--scada-selected-row-bg)" : undefined,
                  }}
                  bodyStyle={{ padding: 10 }}
                >
                  <Space direction="vertical" size={6} style={{ width: "100%" }}>
                    <Space wrap>
                      <Typography.Text strong>{item.name}</Typography.Text>
                      <Tag color={item.kind === "popup" ? "purple" : item.kind === "template" ? "cyan" : "blue"}>{item.kind}</Tag>
                      {isStart ? <Tag color="green">Start</Tag> : null}
                    </Space>
                    <Typography.Text type="secondary">{item.width}x{item.height} | objects: {item.objects.length}</Typography.Text>
                    <Space size={4} wrap>
                      <Button size="small" onClick={(event) => { event.stopPropagation(); setCurrentScreen(item.id); navigate("/editor"); }}>Open</Button>
                      <Button size="small" onClick={(event) => { event.stopPropagation(); duplicateScreen(item); }}>Duplicate</Button>
                      <Button size="small" onClick={(event) => { event.stopPropagation(); setStartScreen(item.id); }}>Set Start</Button>
                      <Button size="small" danger disabled={project.screens.length <= 1} onClick={(event) => { event.stopPropagation(); deleteScreen(item.id); }}>Delete</Button>
                    </Space>
                  </Space>
                </Card>
              );
            })}
          </div>
        ) : (
          <List
            style={{ marginTop: 12 }}
            dataSource={filteredScreens}
            renderItem={(item) => (
              <List.Item
                onClick={() => setCurrentScreen(item.id)}
                style={{
                  cursor: "pointer",
                  background: item.id === screen.id ? "var(--scada-selected-row-bg)" : "transparent",
                  borderRadius: 6,
                }}
                actions={[
                  <Button key={`open-${item.id}`} size="small" onClick={() => { setCurrentScreen(item.id); navigate("/editor"); }}>Open</Button>,
                  <Button key={`dup-${item.id}`} size="small" onClick={() => duplicateScreen(item)}>Duplicate</Button>,
                  <Button key={`start-${item.id}`} size="small" onClick={() => setStartScreen(item.id)}>Set Start</Button>,
                  <Button key={`del-${item.id}`} size="small" danger disabled={project.screens.length <= 1} onClick={() => deleteScreen(item.id)}>Delete</Button>,
                ]}
              >
                <Space>
                  <Typography.Text strong>{item.name}</Typography.Text>
                  <Tag color={item.kind === "popup" ? "purple" : item.kind === "template" ? "cyan" : "blue"}>{item.kind}</Tag>
                  {project.startScreenId === item.id ? <Tag color="green">Start</Tag> : null}
                </Space>
              </List.Item>
            )}
          />
        )}
      </Card>

      <Card size="small" title="Screen Properties">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input value={screen.name} onChange={(e) => updateScreen(screen.id, { name: e.target.value })} />
          <InputNumber style={{ width: "100%" }} value={screen.width} onChange={(value) => updateScreen(screen.id, { width: Number(value ?? 320) })} />
          <InputNumber style={{ width: "100%" }} value={screen.height} onChange={(value) => updateScreen(screen.id, { height: Number(value ?? 200) })} />
          <Space wrap>
            <ColorPicker
              value={screen.background ?? "#1e1e1e"}
              showText
              onChange={(_, css) => updateScreen(screen.id, { background: css })}
            />
            <Input
              style={{ width: 180 }}
              value={screen.background ?? ""}
              placeholder="#1e1e1e"
              onChange={(e) => updateScreen(screen.id, { background: e.target.value })}
            />
          </Space>
          <Space wrap>
            <Button onClick={() => setStartScreen(screen.id)}>Set Start Screen</Button>
            <Button onClick={() => { setCurrentScreen(screen.id); navigate("/editor"); }}>Open In Editor</Button>
          </Space>
        </Space>
      </Card>
    </Space>
  );
}
