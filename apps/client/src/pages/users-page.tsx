import { Typography } from "antd";
import { UserManagementPanel } from "../components/workbench/user-management-panel";
import { useScadaStore } from "../store/scada-store";

export function UsersPage() {
  const canWrite = useScadaStore((s) => s.hasPermission("users.write"));
  const canDelete = useScadaStore((s) => s.hasPermission("users.delete"));
  const canChangePassword = useScadaStore((s) => s.hasPermission("users.changePassword"));

  return (
    <div className="route-page-scroll">
      <div style={{ display: "grid", gap: 10 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          User Management
        </Typography.Title>
        <UserManagementPanel
          canWrite={canWrite}
          canDelete={canDelete}
          canChangePassword={canChangePassword}
        />
      </div>
    </div>
  );
}
