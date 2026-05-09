import { useEffect, useMemo, useState } from "react";
import { Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import type { AppRole, AppUser } from "@web-scada/shared";
import { api } from "../services/api";
import { useResizableTableColumns, type ResizableColumn } from "../components/resizable-table";
import { useScadaStore } from "../store/scada-store";

type UserFormValues = {
  username: string;
  displayName?: string;
  password?: string;
  roles: AppRole[];
  enabled: boolean;
};

const roleOptions: Array<{ value: AppRole; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "engineer", label: "Engineer" },
  { value: "operator", label: "Operator" },
  { value: "viewer", label: "Viewer" },
];

export function UsersPage() {
  const canWrite = useScadaStore((s) => s.hasPermission("users.write"));
  const canDelete = useScadaStore((s) => s.hasPermission("users.delete"));
  const canChangePassword = useScadaStore((s) => s.hasPermission("users.changePassword"));
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<AppUser | null>(null);
  const [form] = Form.useForm<UserFormValues>();
  const [passwordForm] = Form.useForm<{ newPassword: string; confirmPassword: string }>();

  const loadUsers = async () => {
    setLoading(true);
    try {
      setUsers(await api.listUsers());
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void message.error(text);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const sortedUsers = useMemo(() => [...users].sort((a, b) => a.username.localeCompare(b.username)), [users]);
  const userColumns = useMemo<ResizableColumn<AppUser>[]>(() => ([
    { id: "username", title: "Username", dataIndex: "username", defaultWidth: 170, minWidth: 130 },
    {
      id: "displayName",
      title: "Name",
      dataIndex: "displayName",
      defaultWidth: 220,
      minWidth: 140,
      render: (value?: string) => value || "-",
    },
    {
      id: "roles",
      title: "Roles",
      dataIndex: "roles",
      defaultWidth: 260,
      minWidth: 180,
      autoSize: (row) => row.roles.join(", "),
      render: (roles: AppRole[]) => (
        <Space size={4} wrap>
          {roles.map((role) => (
            <Tag key={role}>{role}</Tag>
          ))}
        </Space>
      ),
    },
    {
      id: "enabled",
      title: "Enabled",
      dataIndex: "enabled",
      defaultWidth: 110,
      minWidth: 90,
      render: (enabled: boolean) => (enabled ? "Yes" : "No"),
    },
    {
      id: "actions",
      title: "Actions",
      defaultWidth: 240,
      minWidth: 180,
      autoSize: () => "Edit Password Delete",
      render: (_, user) => (
        <Space>
          <Button size="small" onClick={() => openEdit(user)} disabled={!canWrite}>
            Edit
          </Button>
          <Button
            size="small"
            onClick={() => {
              setPasswordTarget(user);
              setPasswordModalOpen(true);
              passwordForm.resetFields();
            }}
            disabled={!canChangePassword}
          >
            Password
          </Button>
          <Button size="small" danger onClick={() => removeUser(user)} disabled={!canDelete}>
            Delete
          </Button>
        </Space>
      ),
    },
  ]), [canChangePassword, canDelete, canWrite, passwordForm]);
  const { columns: resizedUserColumns, components: resizedUserComponents } = useResizableTableColumns<AppUser>({
    tableId: "users.table.main",
    columns: userColumns,
    rows: sortedUsers,
  });

  const openCreate = () => {
    setEditingUser(null);
    form.setFieldsValue({
      username: "",
      displayName: "",
      password: "",
      roles: ["viewer"],
      enabled: true,
    });
    setModalOpen(true);
  };

  const openEdit = (user: AppUser) => {
    setEditingUser(user);
    form.setFieldsValue({
      username: user.username,
      displayName: user.displayName,
      roles: user.roles,
      enabled: user.enabled,
    });
    setModalOpen(true);
  };

  const submitUser = async () => {
    const values = await form.validateFields();
    try {
      if (editingUser) {
        await api.updateUser(editingUser.id, {
          displayName: values.displayName,
          roles: values.roles,
          enabled: values.enabled,
        });
      } else {
        if (!values.password) {
          void message.warning("Password is required");
          return;
        }
        await api.createUser({
          username: values.username,
          displayName: values.displayName,
          password: values.password,
          roles: values.roles,
          enabled: values.enabled,
        });
      }
      setModalOpen(false);
      await loadUsers();
      void message.success(editingUser ? "User updated" : "User created");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void message.error(text);
    }
  };

  const removeUser = (user: AppUser) => {
    Modal.confirm({
      title: "Delete user",
      content: `Delete user "${user.username}"?`,
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.deleteUser(user.id);
          await loadUsers();
          void message.success("User deleted");
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          void message.error(text);
        }
      },
    });
  };

  const submitPassword = async () => {
    const values = await passwordForm.validateFields();
    if (values.newPassword !== values.confirmPassword) {
      void message.warning("Passwords do not match");
      return;
    }
    if (!passwordTarget) {
      return;
    }
    try {
      await api.changeUserPassword(passwordTarget.id, { newPassword: values.newPassword });
      setPasswordModalOpen(false);
      setPasswordTarget(null);
      void message.success("Password changed");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void message.error(text);
    }
  };

  return (
    <div className="route-page-scroll">
      <Space direction="vertical" style={{ width: "100%" }} size={12}>
        <Space style={{ justifyContent: "space-between", width: "100%" }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Users
          </Typography.Title>
          <Button type="primary" onClick={openCreate} disabled={!canWrite}>
            New User
          </Button>
        </Space>
        <Table<AppUser>
          rowKey="id"
          loading={loading}
          dataSource={sortedUsers}
          components={resizedUserComponents}
          pagination={false}
          scroll={{ x: 980 }}
          columns={resizedUserColumns}
        />
      </Space>

      <Modal
        title={editingUser ? `Edit ${editingUser.username}` : "Create user"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void submitUser()}
        okText={editingUser ? "Save" : "Create"}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Username" name="username" rules={[{ required: true }]} hidden={Boolean(editingUser)}>
            <Input />
          </Form.Item>
          <Form.Item label="Display name" name="displayName">
            <Input />
          </Form.Item>
          {!editingUser ? (
            <Form.Item label="Password" name="password" rules={[{ required: true, min: 4 }]}>
              <Input.Password />
            </Form.Item>
          ) : null}
          <Form.Item label="Roles" name="roles" rules={[{ required: true }]}>
            <Select mode="multiple" options={roleOptions} />
          </Form.Item>
          <Form.Item label="Enabled" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={passwordTarget ? `Change password: ${passwordTarget.username}` : "Change password"}
        open={passwordModalOpen}
        onCancel={() => setPasswordModalOpen(false)}
        onOk={() => void submitPassword()}
        okText="Change"
      >
        <Form form={passwordForm} layout="vertical">
          <Form.Item label="New password" name="newPassword" rules={[{ required: true, min: 4 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item label="Confirm password" name="confirmPassword" rules={[{ required: true, min: 4 }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
