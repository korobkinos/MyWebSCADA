import { useEffect, useMemo, useRef, useState } from "react";
import type { Key } from "react";
import type { DockPanelState, DriverConfig, DriverHealth, OpcUaDriverConfig, TagDefinition } from "@web-scada/shared";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Tree, Typography, message } from "antd";
import type { DataNode } from "antd/es/tree";
import { api, type OpcUaBrowseItem } from "../services/api";
import { FloatingPanel } from "../components/floating-panel";
import { ResizableDockPanel } from "../components/resizable-dock-panel";
import { useDockLayout } from "../hooks/use-dock-layout";
import { useScadaStore } from "../store/scada-store";

type DriverType = DriverConfig["type"];

const dockDefaults: DockPanelState[] = [
  { id: "drivers.left", side: "left", hidden: false, size: 300, lastVisibleSize: 300 },
  { id: "drivers.right", side: "right", hidden: false, size: 360, lastVisibleSize: 360 },
];
const defaultLeftPanel = dockDefaults[0]!;
const defaultRightPanel = dockDefaults[1]!;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createDriverId(type: DriverType): string {
  return `${type}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultDriver(type: DriverType): DriverConfig {
  if (type === "opcua") {
    return {
      id: createDriverId(type),
      type,
      enabled: true,
      name: "OPC UA Driver",
      endpointUrl: "opc.tcp://127.0.0.1:4840",
      securityMode: "None",
      securityPolicy: "None",
      timeoutMs: 5000,
      reconnectMs: 2000,
    };
  }
  return {
    id: createDriverId(type),
    type: "simulated",
    enabled: true,
    name: "Simulated Driver",
  };
}

function driverStatusColor(health?: DriverHealth): string {
  if (health === "running") return "green";
  if (health === "disabled") return "blue";
  if (health === "error") return "red";
  if (health === "starting" || health === "reconnecting") return "gold";
  return "default";
}

function asOpcUa(driver: DriverConfig | null): OpcUaDriverConfig | null {
  if (!driver || driver.type !== "opcua") {
    return null;
  }
  return driver;
}

type OpcUaTreeNode = DataNode & {
  key: string;
  nodeId: string;
  browseName: string;
  browseItem?: OpcUaBrowseItem;
  isLeaf?: boolean;
  children?: OpcUaTreeNode[];
};

function makeTreeNode(item: OpcUaBrowseItem): OpcUaTreeNode {
  return {
    key: item.nodeId,
    nodeId: item.nodeId,
    browseName: item.browseName,
    browseItem: item,
    title: item.browseName || item.displayName || item.nodeId,
    isLeaf: !item.hasChildren,
    children: undefined,
  };
}

function replaceNodeChildren(tree: OpcUaTreeNode[], key: string, children: OpcUaTreeNode[]): OpcUaTreeNode[] {
  return tree.map((node) => {
    if (node.key === key) {
      return { ...node, children };
    }
    if (!node.children) {
      return node;
    }
    return { ...node, children: replaceNodeChildren(node.children, key, children) };
  });
}

function findTreeNode(tree: OpcUaTreeNode[], key: string): OpcUaTreeNode | null {
  for (const node of tree) {
    if (node.key === key) {
      return node;
    }
    if (node.children) {
      const nested = findTreeNode(node.children, key);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

export function DriversPage() {
  const project = useScadaStore((s) => s.project);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const saveProject = useScadaStore((s) => s.saveProject);
  const loadProject = useScadaStore((s) => s.loadProject);
  const tagSnapshots = useScadaStore((s) => s.tagSnapshots);
  const loadTags = useScadaStore((s) => s.loadTags);
  const runtime = useScadaStore((s) => s.runtime);
  const startRuntime = useScadaStore((s) => s.startRuntime);
  const runtimeStatuses = useScadaStore((s) => s.drivers);
  const loadDrivers = useScadaStore((s) => s.loadDrivers);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [driverType, setDriverType] = useState<DriverType>("opcua");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [browseNodeId, setBrowseNodeId] = useState("RootFolder");
  const [browseSearch, setBrowseSearch] = useState("");
  const [browseLoading, setBrowseLoading] = useState(false);
  const [treeData, setTreeData] = useState<OpcUaTreeNode[]>([
    {
      key: "RootFolder",
      nodeId: "RootFolder",
      browseName: "RootFolder",
      title: "RootFolder",
      isLeaf: false,
      children: undefined,
    },
  ]);
  const [expandedKeys, setExpandedKeys] = useState<Key[]>(["RootFolder"]);
  const [selectedTreeKeys, setSelectedTreeKeys] = useState<Key[]>([]);
  const [selectedBrowseItem, setSelectedBrowseItem] = useState<OpcUaBrowseItem | null>(null);
  const [readValue, setReadValue] = useState<string>("-");
  const [importing, setImporting] = useState(false);
  const [clearingOpcUaTags, setClearingOpcUaTags] = useState(false);

  const [form] = Form.useForm<DriverConfig>();

  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const dock = useDockLayout(dockDefaults, { autoSaveMs: 900 });
  const leftPanel = dock.getPanelState("drivers.left") ?? defaultLeftPanel;
  const rightPanel = dock.getPanelState("drivers.right") ?? defaultRightPanel;

  if (!project) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const tagsByDriver = useMemo(() => {
    const map = new Map<string, TagDefinition[]>();
    for (const tag of project.tags) {
      if (!tag.driverId) continue;
      const arr = map.get(tag.driverId) ?? [];
      arr.push(tag);
      map.set(tag.driverId, arr);
    }
    return map;
  }, [project.tags]);

  const statusById = useMemo(() => new Map(runtimeStatuses.map((status) => [status.id, status])), [runtimeStatuses]);

  const filteredDrivers = useMemo(() => {
    const term = search.trim().toLowerCase();
    const allowed = project.drivers.filter((driver) => driver.type === "opcua" || driver.type === "simulated");
    if (!term) return allowed;
    return allowed.filter((driver) => {
      const name = (driver.name ?? "").toLowerCase();
      return driver.id.toLowerCase().includes(term) || driver.type.toLowerCase().includes(term) || name.includes(term);
    });
  }, [project.drivers, search]);

  const selectedDriver = project.drivers.find((driver) => driver.id === selectedId) ?? filteredDrivers[0] ?? null;
  const selectedOpcUa = asOpcUa(selectedDriver);
  const liveOpcUaTagRows = useMemo(() => {
    if (!selectedOpcUa) {
      return [];
    }
    return tagSnapshots.filter((snapshot) => {
      const tag = snapshot.definition;
      if (tag.driverId !== selectedOpcUa.id) {
        return false;
      }
      return tag.sourceType === "opcua" || Boolean(tag.nodeId) || Boolean((tag.address as Record<string, unknown> | undefined)?.nodeId);
    });
  }, [selectedOpcUa, tagSnapshots]);

  const openAdd = (type: DriverType): void => {
    setEditingId(null);
    setDriverType(type);
    form.setFieldsValue(defaultDriver(type));
    setOpen(true);
  };

  const openEdit = (driver: DriverConfig): void => {
    setEditingId(driver.id);
    setDriverType(driver.type);
    form.setFieldsValue(driver);
    setOpen(true);
  };

  const upsertDriver = async (): Promise<void> => {
    const payload = await form.validateFields();
    const current = project.drivers.filter((driver) => driver.type === "opcua" || driver.type === "simulated");
    const next = editingId ? current.map((driver) => (driver.id === editingId ? payload : driver)) : [...current, payload];
    updateProjectJson({ ...project, drivers: next });
    setSelectedId(payload.id);
    setOpen(false);
  };

  const deleteDriver = (driver: DriverConfig): void => {
    const usedBy = tagsByDriver.get(driver.id) ?? [];
    if (usedBy.length > 0) {
      Modal.warning({
        title: "Driver is used by tags",
        content: `Cannot delete. Linked tags: ${usedBy.slice(0, 8).map((tag) => tag.name).join(", ")}`,
      });
      return;
    }
    Modal.confirm({
      title: `Delete driver ${driver.name ?? driver.id}?`,
      onOk: () => {
        updateProjectJson({ ...project, drivers: project.drivers.filter((item) => item.id !== driver.id) });
      },
    });
  };

  const toggleEnabled = async (driver: DriverConfig, enabled: boolean): Promise<void> => {
    updateProjectJson({
      ...project,
      drivers: project.drivers.map((item) => (item.id === driver.id ? { ...item, enabled } : item)),
    });
    await saveProject();
    await loadDrivers();
  };

  const testOpcUa = async (driver: OpcUaDriverConfig): Promise<void> => {
    try {
      await api.opcUaTest({ ...driver, type: "opcua" });
      void message.success("OPC UA connection successful");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "OPC UA connection failed");
    }
  };

  useEffect(() => {
    setTreeData([
      {
        key: "RootFolder",
        nodeId: "RootFolder",
        browseName: "RootFolder",
        title: "RootFolder",
        isLeaf: false,
        children: undefined,
      },
    ]);
    setExpandedKeys(["RootFolder"]);
    setSelectedTreeKeys([]);
    setSelectedBrowseItem(null);
    setReadValue("-");
  }, [selectedOpcUa?.id]);

  useEffect(() => {
    if (!selectedOpcUa) {
      return;
    }
    void loadTags();
    const timer = window.setInterval(() => {
      void loadTags();
    }, 1500);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadTags, selectedOpcUa?.id]);

  const browseOpcUa = async (nodeId?: string): Promise<OpcUaBrowseItem[]> => {
    if (!selectedOpcUa) return [];
    setBrowseLoading(true);
    try {
      const response = await api.opcUaBrowse({
        driverId: selectedOpcUa.id,
        nodeId: nodeId ?? browseNodeId,
        search: browseSearch.trim() || undefined,
      });
      setBrowseNodeId(response.nodeId);
      return response.nodes;
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "OPC UA browse failed");
      return [];
    } finally {
      setBrowseLoading(false);
    }
  };

  const loadTreeChildren = async (targetNodeId: string): Promise<void> => {
    const nodes = await browseOpcUa(targetNodeId);
    const children = nodes.map((item) => makeTreeNode(item));
    setTreeData((prev) => replaceNodeChildren(prev, targetNodeId, children));
  };

  const browseFromInput = async (): Promise<void> => {
    const target = browseNodeId.trim() || "RootFolder";
    const rootNode: OpcUaTreeNode = {
      key: target,
      nodeId: target,
      browseName: target,
      title: target,
      isLeaf: false,
      children: undefined,
    };
    setTreeData([rootNode]);
    setExpandedKeys([target]);
    setSelectedTreeKeys([]);
    setSelectedBrowseItem(null);
    await loadTreeChildren(target);
  };

  const browseRoot = async (): Promise<void> => {
    setBrowseNodeId("RootFolder");
    const rootNode: OpcUaTreeNode = {
      key: "RootFolder",
      nodeId: "RootFolder",
      browseName: "RootFolder",
      title: "RootFolder",
      isLeaf: false,
      children: undefined,
    };
    setTreeData([rootNode]);
    setExpandedKeys(["RootFolder"]);
    setSelectedTreeKeys([]);
    setSelectedBrowseItem(null);
    await loadTreeChildren("RootFolder");
  };

  const readSelectedNode = async (): Promise<void> => {
    if (!selectedOpcUa || !selectedBrowseItem) return;
    try {
      const result = await api.opcUaRead({
        driverId: selectedOpcUa.id,
        nodeId: selectedBrowseItem.nodeId,
      });
      setReadValue(`${String(result.value)} (${result.quality})`);
      void message.success("Node read completed");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "OPC UA read failed");
    }
  };

  const importSelectedNode = async (): Promise<void> => {
    if (!selectedOpcUa || !selectedBrowseItem) return;
    const defaultTagName = selectedBrowseItem.browseName.replace(/[^a-zA-Z0-9_.-]+/g, "_");
    const name = window.prompt("Tag name for import", defaultTagName);
    if (!name?.trim()) return;
    setImporting(true);
    try {
      await api.opcUaImportTags({
        driverId: selectedOpcUa.id,
        overwrite: true,
        items: [
          {
            nodeId: selectedBrowseItem.nodeId,
            name: name.trim(),
            dataTypeNodeId: selectedBrowseItem.dataType,
            writable: selectedBrowseItem.writable,
            scanRateMs: 500,
          },
        ],
      });
      await loadProject();
      void message.success(`Tag imported: ${name.trim()}`);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const importSelectedBranch = async (): Promise<void> => {
    if (!selectedOpcUa || !selectedTreeKeys[0]) {
      return;
    }
    const selectedNodeKey = String(selectedTreeKeys[0]);
    const selectedNode = findTreeNode(treeData, selectedNodeKey);
    if (!selectedNode) {
      return;
    }
    setImporting(true);
    try {
      const result = await api.opcUaImportSubtree({
        driverId: selectedOpcUa.id,
        nodeId: selectedNode.nodeId,
        rootName: selectedNode.browseName,
        overwrite: true,
        scanRateMs: 500,
      });
      await loadProject();
      void message.success(`Imported subtree: ${result.created} created, ${result.updated} updated, scanned ${result.scanned}`);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Subtree import failed");
    } finally {
      setImporting(false);
    }
  };

  const clearAllOpcUaTags = async (): Promise<void> => {
    setClearingOpcUaTags(true);
    try {
      const nextTags = project.tags.filter((tag) => {
        if (tag.sourceType === "opcua") {
          return false;
        }
        if (!tag.driverId) {
          return true;
        }
        const drv = project.drivers.find((item) => item.id === tag.driverId);
        return drv?.type !== "opcua";
      });
      updateProjectJson({ ...project, tags: nextTags });
      await saveProject();
      await loadProject();
      await loadTags();
      void message.success("All OPC UA tags cleared");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Failed to clear OPC UA tags");
    } finally {
      setClearingOpcUaTags(false);
    }
  };

  const setDetached = (panelId: "drivers.left" | "drivers.right", detached: boolean) => {
    dock.setPanelState(panelId, (prev) => ({
      ...prev,
      detached,
      hidden: detached ? true : false,
      x: prev.x ?? (panelId === "drivers.left" ? 90 : 420),
      y: prev.y ?? 120,
      width: prev.width ?? prev.size,
      height: prev.height ?? 560,
    }));
  };

  const leftPanelContent = (
    <Card
      size="small"
      title="Drivers"
      extra={
        <Space>
          <Button size="small" onClick={() => setDetached("drivers.left", true)}>Detach</Button>
          <Button size="small" onClick={() => dock.setPanelHidden("drivers.left", true)}>Hide</Button>
        </Space>
      }
      style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}
    >
      <Space wrap>
        <Button type="primary" onClick={() => openAdd("opcua")}>Add OPC UA</Button>
        <Button onClick={() => openAdd("simulated")}>Add Simulated</Button>
      </Space>
      <Space>
        <Button onClick={() => void loadDrivers()}>Refresh Status</Button>
        <Button onClick={() => void saveProject()}>Save Project</Button>
        <Button danger loading={clearingOpcUaTags} onClick={() => void clearAllOpcUaTags()}>
          Clear OPC UA Tags
        </Button>
      </Space>
      <Input placeholder="Search drivers" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Typography.Text type="secondary">Total: {filteredDrivers.length}</Typography.Text>
    </Card>
  );

  const rightPanelContent = (
    <Card
      size="small"
      title="Driver Details"
      extra={
        <Space>
          <Button size="small" onClick={() => setDetached("drivers.right", true)}>Detach</Button>
          <Button size="small" onClick={() => dock.setPanelHidden("drivers.right", true)}>Hide</Button>
        </Space>
      }
      style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}
    >
      {selectedDriver ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text strong>{selectedDriver.name ?? selectedDriver.id}</Typography.Text>
          <Tag>{selectedDriver.type}</Tag>
          <Typography.Text type="secondary">ID: {selectedDriver.id}</Typography.Text>
          <Typography.Text type="secondary">Enabled: {selectedDriver.enabled ? "Yes" : "No"}</Typography.Text>
          <Typography.Text type="secondary">
            Status: {statusById.get(selectedDriver.id)?.health ?? (selectedDriver.enabled ? "stopped" : "disabled")}
          </Typography.Text>
          <Typography.Text type="secondary">Tags linked: {(tagsByDriver.get(selectedDriver.id) ?? []).length}</Typography.Text>
          <Typography.Text type="secondary">Last error: {statusById.get(selectedDriver.id)?.message ?? "-"}</Typography.Text>
          {selectedDriver.type === "opcua" ? (
            <>
              <Typography.Text type="secondary">Endpoint: {selectedDriver.endpointUrl}</Typography.Text>
              <Typography.Text type="secondary">
                Security: {selectedDriver.securityMode ?? "None"} / {selectedDriver.securityPolicy ?? "None"}
              </Typography.Text>
              <Typography.Text type="secondary">Auth: {selectedDriver.username ? "Username/Password" : "Anonymous"}</Typography.Text>
            </>
          ) : null}
          <Space>
            <Button size="small" onClick={() => openEdit(selectedDriver)}>Edit</Button>
            {selectedDriver.type === "opcua" ? (
              <Button size="small" onClick={() => void testOpcUa(selectedDriver)}>Test OPC UA</Button>
            ) : null}
            <Button size="small" onClick={() => void toggleEnabled(selectedDriver, !selectedDriver.enabled)}>
              {selectedDriver.enabled ? "Disable" : "Enable"}
            </Button>
            <Button size="small" danger onClick={() => deleteDriver(selectedDriver)}>Delete</Button>
          </Space>
        </Space>
      ) : (
        <Typography.Text type="secondary">Select driver</Typography.Text>
      )}
    </Card>
  );

  return (
    <div
      ref={workspaceRef}
      className="route-page-fill"
      style={{ display: "flex", gap: 10, minWidth: 0, minHeight: 0, overflow: "hidden", position: "relative" }}
    >
      {!leftPanel.detached ? (
        <ResizableDockPanel
          id="drivers.left"
          side="left"
          hidden={leftPanel.hidden}
          size={clamp(leftPanel.size, 0, 560)}
          lastVisibleSize={leftPanel.lastVisibleSize}
          minSize={220}
          maxSize={560}
          autoHideThreshold={80}
          restoreSize={300}
          workspaceRef={workspaceRef}
          restoreTooltip="Show drivers left panel"
          restoreIcon={<RightOutlined />}
          onStateChange={(state) => dock.setPanelState("drivers.left", () => state)}
        >
          {leftPanelContent}
        </ResizableDockPanel>
      ) : null}

      <Card
        size="small"
        title="Drivers Runtime"
        style={{ flex: "1 1 auto", minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}
        bodyStyle={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 10 }}
      >
        <Table
          size="small"
          rowKey="id"
          dataSource={filteredDrivers}
          pagination={false}
          onRow={(row) => ({ onClick: () => setSelectedId(row.id) })}
          columns={[
            { title: "id", dataIndex: "id", width: 150 },
            { title: "name", dataIndex: "name" },
            { title: "type", dataIndex: "type", width: 120 },
            {
              title: "enabled",
              width: 90,
              render: (_, row: DriverConfig) => <Switch checked={row.enabled} onChange={(checked) => void toggleEnabled(row, checked)} />,
            },
            {
              title: "status",
              width: 130,
              render: (_, row: DriverConfig) => {
                const status = statusById.get(row.id);
                return <Tag color={driverStatusColor(status?.health)}>{status?.health ?? (row.enabled ? "stopped" : "disabled")}</Tag>;
              },
            },
            { title: "last error", render: (_, row: DriverConfig) => statusById.get(row.id)?.message ?? "" },
            { title: "tags", width: 80, render: (_, row: DriverConfig) => String((tagsByDriver.get(row.id) ?? []).length) },
            {
              title: "actions",
              width: 220,
              render: (_, row: DriverConfig) => (
                <Space>
                  <Button size="small" onClick={() => openEdit(row)}>Edit</Button>
                  {row.type === "opcua" ? <Button size="small" onClick={() => void testOpcUa(row)}>Test</Button> : null}
                  <Button size="small" onClick={() => void toggleEnabled(row, !row.enabled)}>{row.enabled ? "Stop" : "Start"}</Button>
                  <Button size="small" danger onClick={() => deleteDriver(row)}>Delete</Button>
                </Space>
              ),
            },
          ]}
        />

        {selectedOpcUa ? (
          <>
            <Card size="small" title="OPC UA Browser" style={{ flex: "1 1 auto", minHeight: 260 }}>
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              <Space wrap>
                <Input style={{ width: 240 }} value={browseNodeId} onChange={(e) => setBrowseNodeId(e.target.value)} placeholder="NodeId" />
                <Input style={{ width: 220 }} value={browseSearch} onChange={(e) => setBrowseSearch(e.target.value)} placeholder="Search text" />
                <Button onClick={() => void browseFromInput()} loading={browseLoading}>Browse</Button>
                <Button onClick={() => void browseRoot()} loading={browseLoading}>Root</Button>
                <Button onClick={() => void readSelectedNode()} disabled={!selectedBrowseItem}>Read Value</Button>
                <Button onClick={() => void importSelectedNode()} disabled={!selectedBrowseItem} loading={importing}>Import Tag</Button>
                <Button onClick={() => void importSelectedBranch()} disabled={!selectedTreeKeys.length} loading={importing}>
                  Import Branch
                </Button>
              </Space>
              <Typography.Text type="secondary">
                Selected: {selectedBrowseItem?.nodeId ?? String(selectedTreeKeys[0] ?? "-")} | Value: {readValue}
              </Typography.Text>
              <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 12, minHeight: 360 }}>
                <Card size="small" title="Address Tree" bodyStyle={{ maxHeight: 500, overflow: "auto", padding: 8 }}>
                  <Tree
                    treeData={treeData}
                    selectedKeys={selectedTreeKeys}
                    expandedKeys={expandedKeys}
                    onExpand={(keys) => setExpandedKeys(keys)}
                    loadData={async (node) => {
                      const asNode = node as unknown as OpcUaTreeNode;
                      if (asNode.isLeaf) {
                        return;
                      }
                      if ((asNode.children?.length ?? 0) > 0) {
                        return;
                      }
                      await loadTreeChildren(asNode.nodeId);
                    }}
                    onSelect={(keys) => {
                      setSelectedTreeKeys(keys);
                      const key = keys[0];
                      if (!key) {
                        setSelectedBrowseItem(null);
                        return;
                      }
                      const found = findTreeNode(treeData, String(key));
                      setSelectedBrowseItem(found?.browseItem ?? null);
                    }}
                  />
                </Card>
                <Card size="small" title="Selected Node">
                  {selectedBrowseItem ? (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Typography.Text><strong>Name:</strong> {selectedBrowseItem.browseName}</Typography.Text>
                      <Typography.Text><strong>NodeId:</strong> {selectedBrowseItem.nodeId}</Typography.Text>
                      <Typography.Text><strong>Class:</strong> {selectedBrowseItem.nodeClass}</Typography.Text>
                      <Typography.Text><strong>DataType:</strong> {selectedBrowseItem.dataType ?? "-"}</Typography.Text>
                      <Typography.Text><strong>Writable:</strong> {selectedBrowseItem.writable ? "Yes" : "No"}</Typography.Text>
                      <Typography.Text type="secondary">
                        Tip: select folder node and click "Import Branch" to auto-import all nested variables.
                      </Typography.Text>
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">Select node in tree</Typography.Text>
                  )}
                </Card>
              </div>
            </Space>
            </Card>
            <Card size="small" title="OPC UA Live Status">
              <Space direction="vertical" style={{ width: "100%" }} size={8}>
                <Space>
                  <Typography.Text type="secondary">
                    Runtime: {runtime.running ? "running" : "stopped"}
                  </Typography.Text>
                  {!runtime.running ? (
                    <Button size="small" type="primary" onClick={() => void startRuntime()}>
                      Start Runtime
                    </Button>
                  ) : null}
                  <Button size="small" onClick={() => void loadTags()}>
                    Refresh values
                  </Button>
                </Space>
                <Table
                  size="small"
                  rowKey={(row) => row.definition.name}
                  dataSource={liveOpcUaTagRows}
                  pagination={{ pageSize: 8 }}
                  columns={[
                    { title: "Tag", dataIndex: ["definition", "name"] },
                    { title: "NodeId", width: 280, render: (_, row) => row.definition.nodeId ?? String((row.definition.address as Record<string, unknown> | undefined)?.nodeId ?? "-") },
                    { title: "Value", width: 180, render: (_, row) => String(row.value?.value ?? "-") },
                    { title: "Quality", width: 100, render: (_, row) => <Tag color={row.value?.quality === "Good" ? "green" : row.value?.quality === "Bad" ? "red" : "gold"}>{row.value?.quality ?? "-"}</Tag> },
                    { title: "Time", width: 180, render: (_, row) => (row.value?.timestamp ? new Date(row.value.timestamp).toLocaleTimeString() : "-") },
                  ]}
                />
              </Space>
            </Card>
          </>
        ) : null}
      </Card>

      {!rightPanel.detached ? (
        <ResizableDockPanel
          id="drivers.right"
          side="right"
          hidden={rightPanel.hidden}
          size={clamp(rightPanel.size, 0, 700)}
          lastVisibleSize={rightPanel.lastVisibleSize}
          minSize={240}
          maxSize={700}
          autoHideThreshold={80}
          restoreSize={360}
          workspaceRef={workspaceRef}
          restoreTooltip="Show drivers right panel"
          restoreIcon={<LeftOutlined />}
          onStateChange={(state) => dock.setPanelState("drivers.right", () => state)}
        >
          {rightPanelContent}
        </ResizableDockPanel>
      ) : null}

      {leftPanel.detached ? (
        <div className="floating-layer">
          <FloatingPanel
            title="Drivers Panel"
            rect={{ x: leftPanel.x ?? 90, y: leftPanel.y ?? 120, width: leftPanel.width ?? 340, height: leftPanel.height ?? 560 }}
            onRectChange={(rect) => dock.setPanelState("drivers.left", (prev) => ({ ...prev, x: rect.x, y: rect.y, width: rect.width, height: rect.height }))}
            onClose={() => setDetached("drivers.left", false)}
            onDockLeft={() => dock.setPanelState("drivers.left", (prev) => ({ ...prev, detached: false, hidden: false, side: "left" }))}
          >
            {leftPanelContent}
          </FloatingPanel>
        </div>
      ) : null}

      {rightPanel.detached ? (
        <div className="floating-layer">
          <FloatingPanel
            title="Driver Details"
            rect={{ x: rightPanel.x ?? 420, y: rightPanel.y ?? 120, width: rightPanel.width ?? 380, height: rightPanel.height ?? 560 }}
            onRectChange={(rect) => dock.setPanelState("drivers.right", (prev) => ({ ...prev, x: rect.x, y: rect.y, width: rect.width, height: rect.height }))}
            onClose={() => setDetached("drivers.right", false)}
            onDockRight={() => dock.setPanelState("drivers.right", (prev) => ({ ...prev, detached: false, hidden: false, side: "right" }))}
          >
            {rightPanelContent}
          </FloatingPanel>
        </div>
      ) : null}

      <Modal
        title={editingId ? "Edit Driver" : "Add Driver"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void upsertDriver()}
        width={760}
      >
        <Form layout="vertical" form={form}>
          <Form.Item name="id" label="Id" rules={[{ required: true }]}>
            <Input disabled={Boolean(editingId)} />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select
              disabled={Boolean(editingId)}
              value={driverType}
              onChange={(value) => {
                setDriverType(value);
                form.setFieldsValue(defaultDriver(value));
              }}
              options={[
                { label: "opcua", value: "opcua" },
                { label: "simulated", value: "simulated" },
              ]}
            />
          </Form.Item>
          <Form.Item name="enabled" label="Enabled" valuePropName="checked">
            <Switch />
          </Form.Item>

          {driverType === "opcua" ? (
            <>
              <Form.Item name="endpointUrl" label="Endpoint URL" rules={[{ required: true }]}>
                <Input placeholder="opc.tcp://host:4840" />
              </Form.Item>
              <Space style={{ width: "100%" }} wrap>
                <Form.Item name="securityMode" label="Security Mode" style={{ width: 180 }}>
                  <Select options={["None", "Sign", "SignAndEncrypt"].map((item) => ({ label: item, value: item }))} />
                </Form.Item>
                <Form.Item name="securityPolicy" label="Security Policy" style={{ width: 180 }}>
                  <Select options={["None", "Basic256Sha256"].map((item) => ({ label: item, value: item }))} />
                </Form.Item>
                <Form.Item name="timeoutMs" label="Timeout ms" style={{ width: 140 }}>
                  <InputNumber style={{ width: "100%" }} min={100} />
                </Form.Item>
                <Form.Item name="reconnectMs" label="Reconnect ms" style={{ width: 150 }}>
                  <InputNumber style={{ width: "100%" }} min={100} />
                </Form.Item>
              </Space>
              <Space style={{ width: "100%" }} wrap>
                <Form.Item name="username" label="Username" style={{ width: 260 }}>
                  <Input placeholder="optional" />
                </Form.Item>
                <Form.Item name="password" label="Password" style={{ width: 260 }}>
                  <Input.Password placeholder="optional" />
                </Form.Item>
              </Space>
            </>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
}
