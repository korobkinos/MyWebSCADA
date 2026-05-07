import { useMemo, useRef, useState } from "react";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Card, Input, List, Space, Typography } from "antd";
import type { DockPanelState } from "@web-scada/shared";
import { FloatingPanel } from "../components/floating-panel";
import { ResizableDockPanel } from "../components/resizable-dock-panel";
import { useDockLayout } from "../hooks/use-dock-layout";
import { api } from "../services/api";
import { useScadaStore } from "../store/scada-store";

const defaults: DockPanelState[] = [
  { id: "libraries.left", side: "left", hidden: false, size: 300, lastVisibleSize: 300 },
  { id: "libraries.right", side: "right", hidden: false, size: 360, lastVisibleSize: 360 },
];
const defaultLeftPanel = defaults[0]!;
const defaultRightPanel = defaults[1]!;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function LibrariesPage() {
  const project = useScadaStore((s) => s.project);
  const libraries = useScadaStore((s) => s.libraries);
  const loadLibraries = useScadaStore((s) => s.loadLibraries);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const dock = useDockLayout(defaults, { autoSaveMs: 900 });
  const left = dock.getPanelState("libraries.left") ?? defaultLeftPanel;
  const right = dock.getPanelState("libraries.right") ?? defaultRightPanel;
  const [id, setId] = useState("custom-lib");
  const [name, setName] = useState("Custom Library");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!project) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return libraries;
    }
    return libraries.filter((item) => item.name.toLowerCase().includes(term) || item.id.toLowerCase().includes(term));
  }, [libraries, search]);

  const selected = libraries.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  const setDockState = (panelId: string, state: DockPanelState) => {
    dock.setPanelState(panelId, () => state);
  };

  const setDetached = (panelId: "libraries.left" | "libraries.right", detached: boolean) => {
    dock.setPanelState(panelId, (prev) => ({
      ...prev,
      detached,
      hidden: detached ? true : false,
      x: prev.x ?? (panelId === "libraries.left" ? 90 : 460),
      y: prev.y ?? 120,
      width: prev.width ?? prev.size,
      height: prev.height ?? 540,
    }));
  };

  const createLibrary = async () => {
    const created = await api.createLibrary({ id, name });
    const nextProject = await api.attachLibrary(created.id);
    updateProjectJson(nextProject);
    await loadLibraries();
  };

  const attachToggle = async (libraryId: string, attached: boolean) => {
    const next = attached ? await api.detachLibrary(libraryId) : await api.attachLibrary(libraryId);
    updateProjectJson(next);
  };

  const leftPanelBody = (
    <Card
      size="small"
      title="Library Directory"
      extra={
        <Space>
          <Button size="small" onClick={() => setDetached("libraries.left", true)}>Detach</Button>
          <Button size="small" onClick={() => dock.setPanelHidden("libraries.left", true)}>Hide</Button>
        </Space>
      }
      style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}
    >
      <Input value={search} placeholder="Search library" onChange={(e) => setSearch(e.target.value)} />
      <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="library id" />
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="library name" />
      <Space>
        <Button onClick={() => void createLibrary()}>Create</Button>
        <Button onClick={() => void loadLibraries()}>Refresh</Button>
      </Space>
    </Card>
  );

  const rightPanelBody = (
    <Card
      size="small"
      title="Library Properties"
      extra={
        <Space>
          <Button size="small" onClick={() => setDetached("libraries.right", true)}>Detach</Button>
          <Button size="small" onClick={() => dock.setPanelHidden("libraries.right", true)}>Hide</Button>
        </Space>
      }
      style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}
    >
      {selected ? (
        <>
          <Typography.Text strong>{selected.name}</Typography.Text>
          <Typography.Text type="secondary">{selected.id}</Typography.Text>
          <Typography.Text type="secondary">{selected.description ?? "-"}</Typography.Text>
          <List
            size="small"
            header={<Typography.Text strong>Elements</Typography.Text>}
            dataSource={selected.elements}
            renderItem={(el) => <List.Item>{el.name}</List.Item>}
          />
        </>
      ) : (
        <Typography.Text type="secondary">Select library</Typography.Text>
      )}
    </Card>
  );

  return (
    <div ref={workspaceRef} className="route-page-fill" style={{ display: "flex", gap: 10, minHeight: 0, minWidth: 0, overflow: "hidden", position: "relative" }}>
      {!left.detached ? (
        <ResizableDockPanel
          id="libraries.left"
          side="left"
          hidden={left.hidden}
          size={clamp(left.size, 0, 560)}
          lastVisibleSize={left.lastVisibleSize}
          minSize={220}
          maxSize={560}
          autoHideThreshold={80}
          restoreSize={300}
          workspaceRef={workspaceRef}
          restoreTooltip="Show libraries left panel"
          restoreIcon={<RightOutlined />}
          onStateChange={(state) => setDockState("libraries.left", state)}
        >
          {leftPanelBody}
        </ResizableDockPanel>
      ) : null}

      <Card size="small" title="Libraries" style={{ flex: "1 1 auto", minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }} bodyStyle={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <List
          dataSource={filtered}
          renderItem={(library) => {
            const attached = (project.libraries ?? []).some((item) => item.libraryId === library.id && item.enabled);
            return (
              <List.Item
                style={{ cursor: "pointer", background: selected?.id === library.id ? "#f0f5ff" : undefined }}
                onClick={() => setSelectedId(library.id)}
                actions={[
                  <Button key="attach" type={attached ? "default" : "primary"} onClick={() => void attachToggle(library.id, attached)}>
                    {attached ? "Detach" : "Attach"}
                  </Button>,
                ]}
              >
                <Space direction="vertical" size={0}>
                  <Typography.Text>{library.name}</Typography.Text>
                  <Typography.Text type="secondary">{library.id}</Typography.Text>
                </Space>
              </List.Item>
            );
          }}
        />
      </Card>

      {!right.detached ? (
        <ResizableDockPanel
          id="libraries.right"
          side="right"
          hidden={right.hidden}
          size={clamp(right.size, 0, 680)}
          lastVisibleSize={right.lastVisibleSize}
          minSize={240}
          maxSize={680}
          autoHideThreshold={80}
          restoreSize={360}
          workspaceRef={workspaceRef}
          restoreTooltip="Show libraries right panel"
          restoreIcon={<LeftOutlined />}
          onStateChange={(state) => setDockState("libraries.right", state)}
        >
          {rightPanelBody}
        </ResizableDockPanel>
      ) : null}

      {left.detached ? (
        <div className="floating-layer">
          <FloatingPanel
            title="Libraries Left Panel"
            rect={{ x: left.x ?? 90, y: left.y ?? 120, width: left.width ?? 340, height: left.height ?? 540 }}
            onRectChange={(rect) => dock.setPanelState("libraries.left", (prev) => ({ ...prev, x: rect.x, y: rect.y, width: rect.width, height: rect.height }))}
            onClose={() => setDetached("libraries.left", false)}
            onDockLeft={() => dock.setPanelState("libraries.left", (prev) => ({ ...prev, detached: false, hidden: false, side: "left" }))}
          >
            {leftPanelBody}
          </FloatingPanel>
        </div>
      ) : null}

      {right.detached ? (
        <div className="floating-layer">
          <FloatingPanel
            title="Libraries Right Panel"
            rect={{ x: right.x ?? 460, y: right.y ?? 120, width: right.width ?? 360, height: right.height ?? 540 }}
            onRectChange={(rect) => dock.setPanelState("libraries.right", (prev) => ({ ...prev, x: rect.x, y: rect.y, width: rect.width, height: rect.height }))}
            onClose={() => setDetached("libraries.right", false)}
            onDockRight={() => dock.setPanelState("libraries.right", (prev) => ({ ...prev, detached: false, hidden: false, side: "right" }))}
          >
            {rightPanelBody}
          </FloatingPanel>
        </div>
      ) : null}
    </div>
  );
}
