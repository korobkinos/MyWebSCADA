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
  { id: "assets.left", side: "left", hidden: false, size: 290, lastVisibleSize: 290 },
  { id: "assets.right", side: "right", hidden: false, size: 320, lastVisibleSize: 320 },
];
const defaultLeftPanel = defaults[0]!;
const defaultRightPanel = defaults[1]!;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function AssetsPage() {
  const project = useScadaStore((s) => s.project);
  const assets = useScadaStore((s) => s.assets);
  const loadAssets = useScadaStore((s) => s.loadAssets);
  const loadProject = useScadaStore((s) => s.loadProject);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const dock = useDockLayout(defaults, { autoSaveMs: 900 });
  const left = dock.getPanelState("assets.left") ?? defaultLeftPanel;
  const right = dock.getPanelState("assets.right") ?? defaultRightPanel;
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!project) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return assets;
    }
    return assets.filter((a) => a.name.toLowerCase().includes(term) || (a.description ?? "").toLowerCase().includes(term));
  }, [assets, search]);

  const selected = assets.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  const setDockState = (panelId: string, state: DockPanelState) => {
    dock.setPanelState(panelId, () => state);
  };

  const setDetached = (panelId: "assets.left" | "assets.right", detached: boolean) => {
    dock.setPanelState(panelId, (prev) => ({
      ...prev,
      detached,
      hidden: detached ? true : false,
      x: prev.x ?? (panelId === "assets.left" ? 80 : 420),
      y: prev.y ?? 110,
      width: prev.width ?? prev.size,
      height: prev.height ?? 520,
    }));
  };

  const deleteSelected = async () => {
    if (!selected) {
      return;
    }
    await api.deleteAsset(selected.id);
    await Promise.all([loadAssets(), loadProject()]);
  };

  const renameSelected = (name: string) => {
    if (!selected || !project.assets) {
      return;
    }
    const nextName = name.trim();
    if (!nextName || nextName === selected.name) {
      return;
    }
    updateProjectJson({
      ...project,
      assets: project.assets.map((item) =>
        item.id === selected.id ? { ...item, name: nextName, updatedAt: new Date().toISOString() } : item,
      ),
    });
  };

  const leftPanelBody = (
    <Card
      size="small"
      title="Asset Groups / Actions"
      extra={
        <Space>
          <Button size="small" onClick={() => setDetached("assets.left", true)}>Detach</Button>
          <Button size="small" onClick={() => dock.setPanelHidden("assets.left", true)}>Hide</Button>
        </Space>
      }
      style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}
    >
      <Input placeholder="Search assets" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Space>
        <Button onClick={() => inputRef.current?.click()}>Upload</Button>
        <Button onClick={() => void loadAssets()}>Refresh</Button>
      </Space>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (!file) {
            return;
          }
          void api.uploadAsset(file, file.name).then(async () => {
            await Promise.all([loadAssets(), loadProject()]);
          });
        }}
      />
      <Typography.Text type="secondary">Assets: {filtered.length}</Typography.Text>
    </Card>
  );

  const rightPanelBody = (
    <Card
      size="small"
      title="Asset Properties"
      extra={
        <Space>
          <Button size="small" onClick={() => setDetached("assets.right", true)}>Detach</Button>
          <Button size="small" onClick={() => dock.setPanelHidden("assets.right", true)}>Hide</Button>
        </Space>
      }
      style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}
    >
      {selected ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <img src={selected.previewUrl} alt={selected.name} style={{ width: "100%", maxHeight: 180, objectFit: "contain" }} />
          <Input defaultValue={selected.name} onBlur={(e) => renameSelected(e.target.value)} />
          <Typography.Text type="secondary">{selected.fileName}</Typography.Text>
          <Typography.Text type="secondary">{selected.mimeType}</Typography.Text>
          <Typography.Text type="secondary">{selected.size} bytes</Typography.Text>
          <Button danger onClick={() => void deleteSelected()}>Delete</Button>
        </Space>
      ) : (
        <Typography.Text type="secondary">Select asset</Typography.Text>
      )}
    </Card>
  );

  return (
    <div ref={workspaceRef} className="route-page-fill" style={{ display: "flex", minWidth: 0, minHeight: 0, overflow: "hidden", gap: 10, position: "relative" }}>
      {!left.detached ? (
        <ResizableDockPanel
          id="assets.left"
          side="left"
          hidden={left.hidden}
          size={clamp(left.size, 0, 520)}
          lastVisibleSize={left.lastVisibleSize}
          minSize={220}
          maxSize={520}
          autoHideThreshold={80}
          restoreSize={290}
          workspaceRef={workspaceRef}
          restoreTooltip="Show assets left panel"
          restoreIcon={<RightOutlined />}
          onStateChange={(state) => setDockState("assets.left", state)}
        >
          {leftPanelBody}
        </ResizableDockPanel>
      ) : null}

      <Card size="small" title="Assets" style={{ flex: "1 1 auto", minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }} bodyStyle={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <List
          dataSource={filtered}
          renderItem={(asset) => (
            <List.Item
              style={{ cursor: "pointer", background: selected?.id === asset.id ? "#f0f5ff" : undefined }}
              onClick={() => setSelectedId(asset.id)}
              actions={[
                <Button key="delete" danger onClick={() => void api.deleteAsset(asset.id).then(async () => Promise.all([loadAssets(), loadProject()]))}>Delete</Button>,
              ]}
            >
              <Space>
                <img src={asset.previewUrl} alt={asset.name} style={{ width: 28, height: 28, objectFit: "cover" }} />
                <span>{asset.name}</span>
              </Space>
            </List.Item>
          )}
        />
      </Card>

      {!right.detached ? (
        <ResizableDockPanel
          id="assets.right"
          side="right"
          hidden={right.hidden}
          size={clamp(right.size, 0, 620)}
          lastVisibleSize={right.lastVisibleSize}
          minSize={240}
          maxSize={620}
          autoHideThreshold={80}
          restoreSize={320}
          workspaceRef={workspaceRef}
          restoreTooltip="Show assets right panel"
          restoreIcon={<LeftOutlined />}
          onStateChange={(state) => setDockState("assets.right", state)}
        >
          {rightPanelBody}
        </ResizableDockPanel>
      ) : null}

      {left.detached ? (
        <div className="floating-layer">
          <FloatingPanel
            title="Assets Left Panel"
            rect={{ x: left.x ?? 80, y: left.y ?? 110, width: left.width ?? 320, height: left.height ?? 520 }}
            onRectChange={(rect) => dock.setPanelState("assets.left", (prev) => ({ ...prev, x: rect.x, y: rect.y, width: rect.width, height: rect.height }))}
            onClose={() => setDetached("assets.left", false)}
            onDockLeft={() => {
              dock.setPanelState("assets.left", (prev) => ({ ...prev, detached: false, hidden: false, side: "left" }));
            }}
          >
            {leftPanelBody}
          </FloatingPanel>
        </div>
      ) : null}

      {right.detached ? (
        <div className="floating-layer">
          <FloatingPanel
            title="Assets Right Panel"
            rect={{ x: right.x ?? 420, y: right.y ?? 110, width: right.width ?? 340, height: right.height ?? 520 }}
            onRectChange={(rect) => dock.setPanelState("assets.right", (prev) => ({ ...prev, x: rect.x, y: rect.y, width: rect.width, height: rect.height }))}
            onClose={() => setDetached("assets.right", false)}
            onDockRight={() => {
              dock.setPanelState("assets.right", (prev) => ({ ...prev, detached: false, hidden: false, side: "right" }));
            }}
          >
            {rightPanelBody}
          </FloatingPanel>
        </div>
      ) : null}
    </div>
  );
}
