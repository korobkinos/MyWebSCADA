import { useMemo } from "react";
import { Card, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { EventDefinition } from "@web-scada/shared";
import { useScadaStore } from "../store/scada-store";

export function EventsPage() {
  const project = useScadaStore((s) => s.project);

  if (!project) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const events = project.events ?? [];
  const categoriesCount = project.eventCategories?.length ?? 0;
  const soundsCount = project.eventSounds?.length ?? 0;

  const columns: ColumnsType<EventDefinition> = useMemo(
    () => [
      {
        title: "Enabled",
        dataIndex: "enabled",
        key: "enabled",
        width: 96,
        render: (value: boolean | undefined) => (value === false ? <Tag color="default">Off</Tag> : <Tag color="green">On</Tag>),
      },
      {
        title: "ID",
        dataIndex: "id",
        key: "id",
        width: 220,
        ellipsis: true,
      },
      {
        title: "Category",
        key: "category",
        width: 180,
        render: (_, row) => row.categoryName ?? row.categoryId ?? "-",
      },
      {
        title: "Priority",
        dataIndex: "priority",
        key: "priority",
        width: 110,
        render: (value: number | undefined) => (typeof value === "number" ? value : "-"),
      },
      {
        title: "Message",
        dataIndex: "message",
        key: "message",
        ellipsis: true,
        render: (value: string | undefined) => value?.trim() || "-",
      },
    ],
    [],
  );

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Card size="small" title="Event Manager">
        <Space size="large" wrap>
          <Typography.Text>Definitions: <strong>{events.length}</strong></Typography.Text>
          <Typography.Text>Categories: <strong>{categoriesCount}</strong></Typography.Text>
          <Typography.Text>Sounds: <strong>{soundsCount}</strong></Typography.Text>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0 }}>
          Event Manager skeleton is ready. Runtime event processing, acknowledgements, and persistence will be implemented in a future step.
        </Typography.Paragraph>
      </Card>

      <Card size="small" title="Event Definitions">
        <Table<EventDefinition>
          size="small"
          rowKey={(row) => row.id}
          columns={columns}
          dataSource={events}
          pagination={{ pageSize: 25, showSizeChanger: false }}
        />
      </Card>
    </Space>
  );
}
