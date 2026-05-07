import { useMemo, useRef, useState } from "react";
import type {
  DockPanelState,
  DriverConfig,
  DriverHealth,
  ModbusTcpDriverConfig,
  OpcUaDriverConfig,
  TagDefinition,
} from "@web-scada/shared";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
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
    };
  }
  if (type === "modbus-rtu") {
    return {
      id: createDriverId(type),
      type,
      enabled: true,
      name: "Modbus RTU Driver",
      serialPort: "COM1",
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      unitId: 1,
      timeoutMs: 1000,
      pollIntervalMs: 500,
    };
  }
  if (type === "modbus-tcp") {
    const payload: ModbusTcpDriverConfig = {
      id: createDriverId(type),
      type,
      enabled: true,
      name: "Modbus TCP Driver",
      host: "127.0.0.1",
      port: 502,
      unitId: 1,
      timeoutMs: 1000,
      reconnectMs: 1500,
    };
    return payload;
  }
  return {
    id: createDriverId(type),
    type: "simulated",
    enabled: true,
    name: "Simulated Driver",
  };
}

function driverStatusColor(health?: DriverHealth): string {
  if (health === "running") {
    return "green";
  }
  if (health === "disabled") {
    return "blue";
  }
  if (health === "error") {
    return "red";
  }
  if (health === "starting" || health === "reconnecting") {
    return "gold";
  }
  return "default";
}

export function DriversPage() {
  const project = useScadaStore((s) => s.project);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const saveProject = useScadaStore((s) => s.saveProject);
  const runtimeStatuses = useScadaStore((s) => s.drivers);
  const loadDrivers = useScadaStore((s) => s.loadDrivers);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [driverType, setDriverType] = useState<DriverType>("opcua");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      if (!tag.driverId) {
        continue;
      }
      const arr = map.get(tag.driverId) ?? [];
      arr.push(tag);
      map.set(tag.driverId, arr);
    }
    return map;
  }, [project.tags]);

  const statusById = useMemo(() => new Map(runtimeStatuses.map((status) => [status.id, status])), [runtimeStatuses]);

  const filteredDrivers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return project.drivers;
    }
    return project.drivers.filter((driver) => {
      const name = (driver.name ?? "").toLowerCase();
      return driver.id.toLowerCase().includes(term) || driver.type.toLowerCase().includes(term) || name.includes(term);
    });
  }, [project.drivers, search]);

  const selectedDriver = project.drivers.find((driver) => driver.id === selectedId) ?? filteredDrivers[0] ?? null;

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
    const current = project.drivers;

    let next: DriverConfig[];
    if (!editingId) {
      next = [...current, payload];
    } else {
      next = current.map((driver) => (driver.id === editingId ? payload : driver));
    }

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
        <Button onClick={() => openAdd("modbus-tcp")}>Add Modbus TCP</Button>
        <Button onClick={() => openAdd("modbus-rtu")}>Add Modbus RTU</Button>
        <Button onClick={() => openAdd("simulated")}>Add Simulated</Button>
      </Space>
      <Space>
        <Button onClick={() => void loadDrivers()}>Refresh Status</Button>
        <Button onClick={() => void saveProject()}>Save Project</Button>
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
          <Space>
            <Button size="small" onClick={() => openEdit(selectedDriver)}>Edit</Button>
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
        bodyStyle={{ flex: 1, minHeight: 0, overflow: "auto" }}
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
              render: (_, row: DriverConfig) => (
                <Switch checked={row.enabled} onChange={(checked) => void toggleEnabled(row, checked)} />
              ),
            },
            {
              title: "status",
              width: 130,
              render: (_, row: DriverConfig) => {
                const status = statusById.get(row.id);
                return (
                  <Tag color={driverStatusColor(status?.health)}>
                    {status?.health ?? (row.enabled ? "stopped" : "disabled")}
                  </Tag>
                );
              },
            },
            {
              title: "last error",
              render: (_, row: DriverConfig) => statusById.get(row.id)?.message ?? "",
            },
            {
              title: "tags",
              width: 80,
              render: (_, row: DriverConfig) => String((tagsByDriver.get(row.id) ?? []).length),
            },
            {
              title: "actions",
              width: 260,
              render: (_, row: DriverConfig) => (
                <Space>
                  <Button size="small" onClick={() => openEdit(row)}>Edit</Button>
                  <Button
                    size="small"
                    onClick={() =>
                      void loadDrivers().then(() => {
                        void message.success("Connection check requested");
                      })
                    }
                  >
                    Test
                  </Button>
                  <Button size="small" onClick={() => void toggleEnabled(row, !row.enabled)}>
                    {row.enabled ? "Stop" : "Start"}
                  </Button>
                  <Button size="small" onClick={() => void loadDrivers()}>Reconnect</Button>
                  <Button size="small" danger onClick={() => deleteDriver(row)}>Delete</Button>
                </Space>
              ),
            },
          ]}
        />
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
            onRectChange={(rect) =>
              dock.setPanelState("drivers.left", (prev) => ({ ...prev, x: rect.x, y: rect.y, width: rect.width, height: rect.height }))
            }
            onClose={() => setDetached("drivers.left", false)}
            onDockLeft={() =>
              dock.setPanelState("drivers.left", (prev) => ({ ...prev, detached: false, hidden: false, side: "left" }))
            }
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
            onRectChange={(rect) =>
              dock.setPanelState("drivers.right", (prev) => ({ ...prev, x: rect.x, y: rect.y, width: rect.width, height: rect.height }))
            }
            onClose={() => setDetached("drivers.right", false)}
            onDockRight={() =>
              dock.setPanelState("drivers.right", (prev) => ({ ...prev, detached: false, hidden: false, side: "right" }))
            }
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
        width={700}
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
                { label: "modbus-tcp", value: "modbus-tcp" },
                { label: "modbus-rtu", value: "modbus-rtu" },
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
              <Space style={{ width: "100%" }}>
                <Form.Item name="securityMode" label="Security Mode" style={{ width: 180 }}>
                  <Select options={["None", "Sign", "SignAndEncrypt"].map((item) => ({ label: item, value: item }))} />
                </Form.Item>
                <Form.Item name="securityPolicy" label="Security Policy" style={{ width: 180 }}>
                  <Input />
                </Form.Item>
                <Form.Item name="timeoutMs" label="Timeout ms" style={{ width: 140 }}>
                  <InputNumber style={{ width: "100%" }} min={100} />
                </Form.Item>
                <Form.Item name="reconnectMs" label="Reconnect ms" style={{ width: 150 }}>
                  <InputNumber style={{ width: "100%" }} min={100} />
                </Form.Item>
              </Space>
            </>
          ) : null}

          {driverType === "modbus-tcp" ? (
            <Space style={{ width: "100%" }}>
              <Form.Item name="host" label="Host" style={{ width: 180 }} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="port" label="Port" style={{ width: 110 }} rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={1} max={65535} />
              </Form.Item>
              <Form.Item name="unitId" label="Unit Id" style={{ width: 110 }} rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={0} max={255} />
              </Form.Item>
              <Form.Item name="timeoutMs" label="Timeout" style={{ width: 120 }}>
                <InputNumber style={{ width: "100%" }} min={100} />
              </Form.Item>
              <Form.Item name="reconnectMs" label="Reconnect" style={{ width: 120 }}>
                <InputNumber style={{ width: "100%" }} min={100} />
              </Form.Item>
            </Space>
          ) : null}

          {driverType === "modbus-rtu" ? (
            <>
              <Space style={{ width: "100%" }}>
                <Form.Item name="serialPort" label="Serial Port" style={{ width: 170 }} rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="baudRate" label="Baud" style={{ width: 120 }} rules={[{ required: true }]}>
                  <InputNumber style={{ width: "100%" }} min={1200} />
                </Form.Item>
                <Form.Item name="dataBits" label="Data Bits" style={{ width: 110 }}>
                  <Select options={[7, 8].map((item) => ({ label: String(item), value: item }))} />
                </Form.Item>
                <Form.Item name="stopBits" label="Stop Bits" style={{ width: 110 }}>
                  <Select options={[1, 2].map((item) => ({ label: String(item), value: item }))} />
                </Form.Item>
                <Form.Item name="parity" label="Parity" style={{ width: 110 }}>
                  <Select options={["none", "even", "odd"].map((item) => ({ label: item, value: item }))} />
                </Form.Item>
              </Space>
              <Space style={{ width: "100%" }}>
                <Form.Item name="unitId" label="Unit Id" style={{ width: 120 }}>
                  <InputNumber style={{ width: "100%" }} min={0} max={255} />
                </Form.Item>
                <Form.Item name="timeoutMs" label="Timeout" style={{ width: 140 }}>
                  <InputNumber style={{ width: "100%" }} min={100} />
                </Form.Item>
                <Form.Item name="pollIntervalMs" label="Poll Interval" style={{ width: 160 }}>
                  <InputNumber style={{ width: "100%" }} min={50} />
                </Form.Item>
              </Space>
            </>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
}
