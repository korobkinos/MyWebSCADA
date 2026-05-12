import { useEffect, useMemo, useState } from "react";
import type { AccessRoleLevel, AppRole, AppUser } from "@web-scada/shared";
import { ACCESS_ROLE_LABELS_RU, clampAccessRoleLevel, getUserRoleLevel } from "@web-scada/shared";
import { message } from "antd";
import { api } from "../../services/api";
import { useScadaStore } from "../../store/scada-store";
import { WorkbenchButton } from "./ui/workbench-button";
import { WorkbenchInput } from "./ui/workbench-input";
import { WorkbenchSelect } from "./ui/workbench-select";
import { WorkbenchTabs, type WorkbenchTabItem } from "./ui/workbench-tabs";

type UserManagementPanelProps = {
  canWrite: boolean;
  canDelete: boolean;
  canChangePassword: boolean;
};

type UserDraft = {
  username: string;
  displayName: string;
  enabled: boolean;
  roleLevel: AccessRoleLevel;
};

type UserEditorTab = "details" | "password" | "create";

function defaultRolesForRoleLevel(roleLevel: AccessRoleLevel): AppRole[] {
  if (roleLevel >= 3) {
    return ["admin"];
  }
  if (roleLevel === 2) {
    return ["engineer"];
  }
  if (roleLevel === 1) {
    return ["operator"];
  }
  return ["viewer"];
}

const roleLevelOptions = ([
  { value: "1", label: `1 - ${ACCESS_ROLE_LABELS_RU[1]}` },
  { value: "2", label: `2 - ${ACCESS_ROLE_LABELS_RU[2]}` },
  { value: "3", label: `3 - ${ACCESS_ROLE_LABELS_RU[3]}` },
  { value: "4", label: `4 - ${ACCESS_ROLE_LABELS_RU[4]}` },
] as const);

function getDraftFromUser(user: AppUser): UserDraft {
  return {
    username: user.username,
    displayName: user.displayName ?? "",
    enabled: user.enabled,
    roleLevel: clampAccessRoleLevel(user.roleLevel, getUserRoleLevel(user)),
  };
}

export function UserManagementPanel({ canWrite, canDelete, canChangePassword }: UserManagementPanelProps) {
  const authUser = useScadaStore((s) => s.authUser);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<UserEditorTab>("details");
  const [loading, setLoading] = useState(false);
  const [createDraft, setCreateDraft] = useState<UserDraft>({
    username: "",
    displayName: "",
    enabled: true,
    roleLevel: 1,
  });
  const [createPassword, setCreatePassword] = useState("");
  const [editDraft, setEditDraft] = useState<UserDraft>({
    username: "",
    displayName: "",
    enabled: true,
    roleLevel: 1,
  });
  const [passwordDraft, setPasswordDraft] = useState({
    newPassword: "",
    confirmPassword: "",
  });

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );

  const selectedUserRoleLevel = selectedUser
    ? clampAccessRoleLevel(selectedUser.roleLevel, getUserRoleLevel(selectedUser))
    : 1;

  const loadUsers = async () => {
    setLoading(true);
    try {
      const nextUsers = await api.listUsers();
      setUsers(nextUsers);
      const firstUser = nextUsers[0];
      if (!selectedUserId && firstUser) {
        setSelectedUserId(firstUser.id);
      }
      if (selectedUserId && !nextUsers.some((user) => user.id === selectedUserId)) {
        setSelectedUserId(nextUsers[0]?.id ?? null);
      }
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  useEffect(() => {
    if (!selectedUser) {
      return;
    }
    setEditDraft(getDraftFromUser(selectedUser));
    setPasswordDraft({ newPassword: "", confirmPassword: "" });
  }, [selectedUser]);

  const resetCreateForm = () => {
    setCreateDraft({
      username: "",
      displayName: "",
      enabled: true,
      roleLevel: 1,
    });
    setCreatePassword("");
  };

  const tabItems: WorkbenchTabItem[] = [
    { id: "details", title: "Selected User", active: activeTab === "details", onClick: () => setActiveTab("details") },
    { id: "password", title: "Password / Access", active: activeTab === "password", onClick: () => setActiveTab("password") },
    { id: "create", title: "Create User", active: activeTab === "create", onClick: () => setActiveTab("create") },
  ];

  return (
    <div className="user-management-window">
      <div className="user-management-window__toolbar">
        <div className="user-management-window__toolbar-left">
          <WorkbenchButton onClick={() => void loadUsers()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </WorkbenchButton>
          <WorkbenchButton
            variant="danger"
            disabled={!canDelete || !selectedUser}
            onClick={async () => {
              if (!selectedUser) {
                return;
              }
              if (!window.confirm(`Delete user "${selectedUser.username}"?`)) {
                return;
              }
              try {
                await api.deleteUser(selectedUser.id);
                void message.success("User deleted");
                await loadUsers();
              } catch (error) {
                void message.error(error instanceof Error ? error.message : String(error));
              }
            }}
          >
            Delete Selected
          </WorkbenchButton>
        </div>
        <div className="user-management-window__toolbar-right">
          {selectedUser ? (
            <span>
              Selected: <strong>{selectedUser.username}</strong>
            </span>
          ) : (
            <span>No user selected</span>
          )}
        </div>
      </div>

      <div className="user-management-window__body">
        <div className="user-management-window__list-panel">
          <div className="user-management-table-wrap">
            <table className="user-management-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const roleLevel = clampAccessRoleLevel(user.roleLevel, getUserRoleLevel(user));
                  return (
                    <tr
                      key={user.id}
                      className={user.id === selectedUserId ? "is-selected" : ""}
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      <td>{user.username}</td>
                      <td>{user.displayName ?? "-"}</td>
                      <td>{roleLevel} - {ACCESS_ROLE_LABELS_RU[roleLevel]}</td>
                      <td>{user.enabled ? "Enabled" : "Disabled"}</td>
                    </tr>
                  );
                })}
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No users found</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="user-management-window__editor-panel">
          <WorkbenchTabs items={tabItems} />
          <div className="user-management-window__editor-content">
            {activeTab === "details" ? (
              selectedUser ? (
                <div className="user-management-form-grid">
                  <WorkbenchInput
                    label="Username"
                    value={editDraft.username}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setEditDraft((prev) => ({ ...prev, username: value }));
                    }}
                  />
                  <WorkbenchInput
                    label="Display Name"
                    value={editDraft.displayName}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setEditDraft((prev) => ({ ...prev, displayName: value }));
                    }}
                  />
                  <WorkbenchSelect
                    label="Role Level"
                    value={String(editDraft.roleLevel)}
                    options={roleLevelOptions.map((item) => ({ ...item }))}
                    onChange={(event) => {
                      const roleLevel = clampAccessRoleLevel(Number(event.currentTarget.value), 1);
                      setEditDraft((prev) => ({
                        ...prev,
                        roleLevel,
                      }));
                    }}
                  />
                  <label className="screen-editor-settings-check user-management-enabled-check">
                    <input
                      type="checkbox"
                      checked={editDraft.enabled}
                      onChange={(event) => setEditDraft((prev) => ({ ...prev, enabled: event.currentTarget.checked }))}
                    />
                    <span>Enabled</span>
                  </label>
                  <div className="user-management-actions">
                    <WorkbenchButton
                      variant="primary"
                      disabled={!canWrite}
                      onClick={async () => {
                        const username = editDraft.username.trim();
                        if (!username) {
                          void message.warning("Username is required");
                          return;
                        }
                        if (
                          selectedUser.id === authUser?.id
                          && editDraft.roleLevel < 3
                          && !window.confirm("You are lowering your own role below administrator. Continue?")
                        ) {
                          return;
                        }
                        try {
                          await api.updateUser(selectedUser.id, {
                            username,
                            displayName: editDraft.displayName.trim() || undefined,
                            enabled: editDraft.enabled,
                            roleLevel: editDraft.roleLevel,
                            roles: defaultRolesForRoleLevel(editDraft.roleLevel),
                          });
                          void message.success("User updated");
                          await loadUsers();
                        } catch (error) {
                          void message.error(error instanceof Error ? error.message : String(error));
                        }
                      }}
                    >
                      Save Changes
                    </WorkbenchButton>
                  </div>
                </div>
              ) : (
                <div className="screen-editor-empty-state">Select a user first</div>
              )
            ) : null}

            {activeTab === "password" ? (
              selectedUser ? (
                <div className="user-management-form-grid">
                  <div className="runtime-access-dialog__text">
                    Current level: <strong>{selectedUserRoleLevel} - {ACCESS_ROLE_LABELS_RU[selectedUserRoleLevel]}</strong>
                  </div>
                  <div className="runtime-access-dialog__text">
                    Status: <strong>{selectedUser.enabled ? "Enabled" : "Disabled"}</strong>
                  </div>
                  <WorkbenchInput
                    label="New Password"
                    type="password"
                    value={passwordDraft.newPassword}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setPasswordDraft((prev) => ({ ...prev, newPassword: value }));
                    }}
                  />
                  <WorkbenchInput
                    label="Confirm Password"
                    type="password"
                    value={passwordDraft.confirmPassword}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setPasswordDraft((prev) => ({ ...prev, confirmPassword: value }));
                    }}
                  />
                  <div className="user-management-actions">
                    <WorkbenchButton
                      variant="primary"
                      disabled={!canChangePassword}
                      onClick={async () => {
                        if (passwordDraft.newPassword.length < 4) {
                          void message.warning("Password must be at least 4 characters");
                          return;
                        }
                        if (passwordDraft.newPassword !== passwordDraft.confirmPassword) {
                          void message.warning("Passwords do not match");
                          return;
                        }
                        try {
                          await api.changeUserPassword(selectedUser.id, { newPassword: passwordDraft.newPassword });
                          void message.success("Password changed");
                          setPasswordDraft({ newPassword: "", confirmPassword: "" });
                        } catch (error) {
                          void message.error(error instanceof Error ? error.message : String(error));
                        }
                      }}
                    >
                      Change Password
                    </WorkbenchButton>
                  </div>
                </div>
              ) : (
                <div className="screen-editor-empty-state">Select a user first</div>
              )
            ) : null}

            {activeTab === "create" ? (
              <div className="user-management-form-grid">
                <WorkbenchInput
                  label="Username"
                  value={createDraft.username}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setCreateDraft((prev) => ({ ...prev, username: value }));
                  }}
                />
                <WorkbenchInput
                  label="Display Name"
                  value={createDraft.displayName}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setCreateDraft((prev) => ({ ...prev, displayName: value }));
                  }}
                />
                <WorkbenchInput
                  label="Password"
                  type="password"
                  value={createPassword}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setCreatePassword(value);
                  }}
                />
                <WorkbenchSelect
                  label="Role Level"
                  value={String(createDraft.roleLevel)}
                  options={roleLevelOptions.map((item) => ({ ...item }))}
                  onChange={(event) => {
                    const roleLevel = clampAccessRoleLevel(Number(event.currentTarget.value), 1);
                    setCreateDraft((prev) => ({
                      ...prev,
                      roleLevel,
                    }));
                  }}
                />
                <label className="screen-editor-settings-check user-management-enabled-check">
                  <input
                    type="checkbox"
                    checked={createDraft.enabled}
                    onChange={(event) => setCreateDraft((prev) => ({ ...prev, enabled: event.currentTarget.checked }))}
                  />
                  <span>Enabled</span>
                </label>
                <div className="user-management-actions">
                  <WorkbenchButton
                    variant="primary"
                    disabled={!canWrite}
                    onClick={async () => {
                      const username = createDraft.username.trim();
                      if (!username) {
                        void message.warning("Username is required");
                        return;
                      }
                      if (createPassword.length < 4) {
                        void message.warning("Password must be at least 4 characters");
                        return;
                      }
                      try {
                        await api.createUser({
                          username,
                          displayName: createDraft.displayName.trim() || undefined,
                          password: createPassword,
                          enabled: createDraft.enabled,
                          roleLevel: createDraft.roleLevel,
                          roles: defaultRolesForRoleLevel(createDraft.roleLevel),
                        });
                        void message.success("User created");
                        resetCreateForm();
                        setActiveTab("details");
                        await loadUsers();
                      } catch (error) {
                        void message.error(error instanceof Error ? error.message : String(error));
                      }
                    }}
                  >
                    Create User
                  </WorkbenchButton>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
