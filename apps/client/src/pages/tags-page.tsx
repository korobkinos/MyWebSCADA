import { useMemo } from "react";
import { Button, Input, Space, Table, Typography } from "antd";
import { useScadaStore } from "../store/scada-store";

export function TagsPage() {
  const snapshots = useScadaStore((s) => s.tagSnapshots);
  const writeTag = useScadaStore((s) => s.writeTag);
  const loadTags = useScadaStore((s) => s.loadTags);

  const data = useMemo(
    () => snapshots.map((item) => ({ key: item.definition.name, ...item })),
    [snapshots],
  );

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Button onClick={() => void loadTags()}>Refresh</Button>
      <Table
        size="small"
        dataSource={data}
        pagination={false}
        columns={[
          { title: "Tag", dataIndex: ["definition", "name"] },
          { title: "Type", dataIndex: ["definition", "dataType"], width: 90 },
          { title: "Value", render: (_, row) => <Typography.Text>{String(row.value.value ?? "null")}</Typography.Text> },
          { title: "Quality", dataIndex: ["value", "quality"], width: 110 },
          {
            title: "Write",
            render: (_, row) => {
              if (!row.definition.writable) {
                return null;
              }
              return (
                <Input.Search
                  placeholder="value"
                  enterButton="Write"
                  size="small"
                  onSearch={(value) => {
                    if (!value) {
                      return;
                    }
                    const num = Number(value);
                    const parsed = value === "true" ? true : value === "false" ? false : Number.isNaN(num) ? value : num;
                    void writeTag(row.definition.name, parsed);
                  }}
                />
              );
            },
          },
        ]}
      />
    </Space>
  );
}