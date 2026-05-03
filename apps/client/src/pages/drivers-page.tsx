import { Button, Space, Table, Tag } from "antd";
import { useScadaStore } from "../store/scada-store";

export function DriversPage() {
  const drivers = useScadaStore((s) => s.drivers);
  const loadDrivers = useScadaStore((s) => s.loadDrivers);

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Button onClick={() => void loadDrivers()}>Refresh</Button>
      <Table
        dataSource={drivers.map((item) => ({ key: item.id, ...item }))}
        pagination={false}
        columns={[
          { title: "Driver", dataIndex: "id" },
          { title: "Type", dataIndex: "type" },
          {
            title: "Status",
            dataIndex: "health",
            render: (value: string) => <Tag color={value === "running" ? "green" : value === "error" ? "red" : "default"}>{value}</Tag>,
          },
          { title: "Message", dataIndex: "message" },
        ]}
      />
    </Space>
  );
}