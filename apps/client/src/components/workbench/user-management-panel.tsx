import { useEffect, useMemo, useState } from "react";
import type { AccessRoleLevel, AppRole, AppUser, PasswordPolicy } from "@web-scada/shared";
import {
  ACCESS_ROLE_LABELS_RU,
  clampAccessRoleLevel,
  DEFAULT_PASSWORD_POLICY,
  getUserRoleLevel,
  normalizePasswordPolicy,
  validatePasswordPolicy,
} from "@web-scada/shared";
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

type UserEditorTab = "details" | "password" | "create" | "policy";

type CreateFormErrors = {
  username?: string;
  password?: string;
  repeatPassword?: string;
};

type PasswordFormErrors = {
  newPassword?: string;
  confirmPassword?: string;
};

type PolicyFormErrors = {
  minLength?: string;
  common?: string;
};

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

function readApiErrors(error: unknown): string[] {
  if (!(error instanceof Error)) {
    return [];
  }
  const details = (error as Error & { details?: unknown }).details;
  if (!details || typeof details !== "object") {
    return [];
  }
  const errors = (details as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function buildPasswordRules(policy: PasswordPolicy, password: string): Array<{ text: string; ok: boolean }> {
  return [
    {
      text: `Minimum length: ${policy.minLength}`,
      ok: password.length >= policy.minLength,
    },
    {
      text: "Contains uppercase letter",
      ok: !policy.requireUppercase || /[A-Z]/.test(password),
    },
    {
      text: "Contains lowercase letter",
      ok: !policy.requireLowercase || /[a-z]/.test(password),
    },
    {
      text: "Contains digit",
      ok: !policy.requireDigit || /[0-9]/.test(password),
    },
    {
      text: "Contains special character",
      ok: !policy.requireSpecialChar || /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password),
    },
  ];
}

export function UserManagementPanel({ canWrite, canDelete, canChangePassword }: UserManagementPanelProps) {
  const authUser = useScadaStore((s) => s.authUser);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<UserEditorTab>("details");
  const [loading, setLoading] = useState(false);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy>(DEFAULT_PASSWORD_POLICY);
  const [policyDraft, setPolicyDraft] = useState<PasswordPolicy>(DEFAULT_PASSWORD_POLICY);
  const [policyErrors, setPolicyErrors] = useState<PolicyFormErrors>({});
  const [createDraft, setCreateDraft] = useState<UserDraft>({
    username: "",
    displayName: "",
    enabled: true,
    roleLevel: 1,
  });
  const [createPassword, setCreatePassword] = useState("");
  const [createRepeatPassword, setCreateRepeatPassword] = useState("");
  const [createErrors, setCreateErrors] = useState<CreateFormErrors>({});
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
  const [passwordErrors, setPasswordErrors] = useState<PasswordFormErrors>({});

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );

  const selectedUserRoleLevel = selectedUser
    ? clampAccessRoleLevel(selectedUser.roleLevel, getUserRoleLevel(selectedUser))
    : 1;

  const isSuperadmin = getUserRoleLevel(authUser) >= 4;

  const createPasswordRules = useMemo(
    () => buildPasswordRules(passwordPolicy, createPassword),
    [passwordPolicy, createPassword],
  );
  const changePasswordRules = useMemo(
    () => buildPasswordRules(passwordPolicy, passwordDraft.newPassword),
    [passwordPolicy, passwordDraft.newPassword],
  );

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

  const loadPasswordPolicy = async () => {
    setPolicyLoading(true);
    try {
      const policy = await api.getPasswordPolicy();
      const normalized = normalizePasswordPolicy(policy);
      setPasswordPolicy(normalized);
      setPolicyDraft(normalized);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPolicyLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
    void loadPasswordPolicy();
  }, []);

  useEffect(() => {
    if (!selectedUser) {
      return;
    }
    setEditDraft(getDraftFromUser(selectedUser));
    setPasswordDraft({ newPassword: "", confirmPassword: "" });
    setPasswordErrors({});
  }, [selectedUser]);

  const resetCreateForm = () => {
    setCreateDraft({
      username: "",
      displayName: "",
      enabled: true,
      roleLevel: 1,
    });
    setCreatePassword("");
    setCreateRepeatPassword("");
    setCreateErrors({});
  };

  const validateCreateForm = (): boolean => {
    const nextErrors: CreateFormErrors = {};
    const username = createDraft.username.trim();

    if (!username) {
      nextErrors.username = "Username is required";
    }
    if (!createPassword) {
      nextErrors.password = "Password is required";
    }
    if (!createRepeatPassword) {
      nextErrors.repeatPassword = "Repeat password is required";
    }
    if (createPassword && createRepeatPassword && createPassword !== createRepeatPassword) {
      nextErrors.repeatPassword = "Passwords do not match";
    }

    const passwordPolicyErrors = validatePasswordPolicy(createPassword, passwordPolicy);
    if (passwordPolicyErrors.length > 0) {
      nextErrors.password = passwordPolicyErrors[0];
    }

    setCreateErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const validateChangePasswordForm = (): boolean => {
    const nextErrors: PasswordFormErrors = {};

    if (!passwordDraft.newPassword) {
      nextErrors.newPassword = "Password is required";
    }
    if (!passwordDraft.confirmPassword) {
      nextErrors.confirmPassword = "Repeat password is required";
    }
    if (
      passwordDraft.newPassword
      && passwordDraft.confirmPassword
      && passwordDraft.newPassword !== passwordDraft.confirmPassword
    ) {
      nextErrors.confirmPassword = "Passwords do not match";
    }

    const policyErrorsList = validatePasswordPolicy(passwordDraft.newPassword, passwordPolicy);
    if (policyErrorsList.length > 0) {
      nextErrors.newPassword = policyErrorsList[0];
    }

    setPasswordErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const tabItems: WorkbenchTabItem[] = [
    { id: "details", title: "Selected User", active: activeTab === "details", onClick: () => setActiveTab("details") },
    { id: "password", title: "Password / Access", active: activeTab === "password", onClick: () => setActiveTab("password") },
    { id: "create", title: "Create User", active: activeTab === "create", onClick: () => setActiveTab("create") },
    { id: "policy", title: "Password Policy", active: activeTab === "policy", onClick: () => setActiveTab("policy") },
  ];

  return (
    <div className="user-management-window">
      <div className="user-management-window__toolbar">
        <div className="user-management-window__toolbar-left">
          <WorkbenchButton onClick={() => void loadUsers()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </WorkbenchButton>
          <WorkbenchButton onClick={() => void loadPasswordPolicy()} disabled={policyLoading}>
            {policyLoading ? "Policy..." : "Refresh Policy"}
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
                    errorText={passwordErrors.newPassword}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setPasswordDraft((prev) => ({ ...prev, newPassword: value }));
                      setPasswordErrors((prev) => ({ ...prev, newPassword: undefined }));
                    }}
                  />
                  <WorkbenchInput
                    label="Repeat Password"
                    type="password"
                    value={passwordDraft.confirmPassword}
                    errorText={passwordErrors.confirmPassword}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setPasswordDraft((prev) => ({ ...prev, confirmPassword: value }));
                      setPasswordErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                    }}
                  />
                  <div className="user-management-password-policy">
                    <div className="user-management-password-policy__title">Active policy</div>
                    <ul className="user-management-password-policy__list">
                      {changePasswordRules.map((item) => (
                        <li key={item.text} className={item.ok ? "is-ok" : "is-fail"}>{item.text}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="user-management-actions">
                    <WorkbenchButton
                      variant="primary"
                      disabled={!canChangePassword}
                      onClick={async () => {
                        if (!validateChangePasswordForm()) {
                          return;
                        }
                        try {
                          await api.changeUserPassword(selectedUser.id, {
                            newPassword: passwordDraft.newPassword,
                            repeatPassword: passwordDraft.confirmPassword,
                          });
                          void message.success("Password changed");
                          setPasswordDraft({ newPassword: "", confirmPassword: "" });
                          setPasswordErrors({});
                        } catch (error) {
                          const apiErrors = readApiErrors(error);
                          if (apiErrors.length > 0) {
                            setPasswordErrors((prev) => ({ ...prev, newPassword: apiErrors[0] }));
                          }
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
                  errorText={createErrors.username}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setCreateDraft((prev) => ({ ...prev, username: value }));
                    setCreateErrors((prev) => ({ ...prev, username: undefined }));
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
                  errorText={createErrors.password}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setCreatePassword(value);
                    setCreateErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                />
                <WorkbenchInput
                  label="Repeat Password"
                  type="password"
                  value={createRepeatPassword}
                  errorText={createErrors.repeatPassword}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setCreateRepeatPassword(value);
                    setCreateErrors((prev) => ({ ...prev, repeatPassword: undefined }));
                  }}
                />
                <div className="user-management-password-policy">
                  <div className="user-management-password-policy__title">Active policy</div>
                  <ul className="user-management-password-policy__list">
                    {createPasswordRules.map((item) => (
                      <li key={item.text} className={item.ok ? "is-ok" : "is-fail"}>{item.text}</li>
                    ))}
                  </ul>
                </div>
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
                      if (!validateCreateForm()) {
                        return;
                      }
                      try {
                        await api.createUser({
                          username: createDraft.username.trim(),
                          displayName: createDraft.displayName.trim() || undefined,
                          password: createPassword,
                          repeatPassword: createRepeatPassword,
                          enabled: createDraft.enabled,
                          roleLevel: createDraft.roleLevel,
                          roles: defaultRolesForRoleLevel(createDraft.roleLevel),
                        });
                        void message.success("User created");
                        resetCreateForm();
                        await loadUsers();
                      } catch (error) {
                        const apiErrors = readApiErrors(error);
                        if (apiErrors.length > 0) {
                          setCreateErrors((prev) => ({ ...prev, password: apiErrors[0] }));
                        }
                        void message.error(error instanceof Error ? error.message : String(error));
                      }
                    }}
                  >
                    Create User
                  </WorkbenchButton>
                </div>
              </div>
            ) : null}

            {activeTab === "policy" ? (
              <div className="user-management-form-grid">
                <div className="runtime-access-dialog__text">
                  Policy editing: <strong>{isSuperadmin ? "Superadmin" : "Read only"}</strong>
                </div>
                <WorkbenchInput
                  label="Minimum password length"
                  type="number"
                  min={3}
                  value={String(policyDraft.minLength)}
                  disabled={!isSuperadmin}
                  errorText={policyErrors.minLength}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    setPolicyDraft((prev) => ({
                      ...prev,
                      minLength: Number.isFinite(value) ? value : prev.minLength,
                    }));
                    setPolicyErrors((prev) => ({ ...prev, minLength: undefined, common: undefined }));
                  }}
                />
                <label className="screen-editor-settings-check user-management-enabled-check">
                  <input
                    type="checkbox"
                    checked={policyDraft.requireUppercase}
                    disabled={!isSuperadmin}
                    onChange={(event) => setPolicyDraft((prev) => ({ ...prev, requireUppercase: event.currentTarget.checked }))}
                  />
                  <span>Require uppercase letters</span>
                </label>
                <label className="screen-editor-settings-check user-management-enabled-check">
                  <input
                    type="checkbox"
                    checked={policyDraft.requireLowercase}
                    disabled={!isSuperadmin}
                    onChange={(event) => setPolicyDraft((prev) => ({ ...prev, requireLowercase: event.currentTarget.checked }))}
                  />
                  <span>Require lowercase letters</span>
                </label>
                <label className="screen-editor-settings-check user-management-enabled-check">
                  <input
                    type="checkbox"
                    checked={policyDraft.requireDigit}
                    disabled={!isSuperadmin}
                    onChange={(event) => setPolicyDraft((prev) => ({ ...prev, requireDigit: event.currentTarget.checked }))}
                  />
                  <span>Require digits</span>
                </label>
                <label className="screen-editor-settings-check user-management-enabled-check">
                  <input
                    type="checkbox"
                    checked={policyDraft.requireSpecialChar}
                    disabled={!isSuperadmin}
                    onChange={(event) => setPolicyDraft((prev) => ({ ...prev, requireSpecialChar: event.currentTarget.checked }))}
                  />
                  <span>Require special characters</span>
                </label>
                {policyErrors.common ? <div className="workbench-inline-error">{policyErrors.common}</div> : null}
                <div className="user-management-actions user-management-actions--between">
                  <WorkbenchButton
                    disabled={!isSuperadmin}
                    onClick={() => {
                      setPolicyDraft(DEFAULT_PASSWORD_POLICY);
                      setPolicyErrors({});
                    }}
                  >
                    Reset Defaults
                  </WorkbenchButton>
                  <WorkbenchButton
                    variant="primary"
                    disabled={!isSuperadmin || policySaving}
                    onClick={async () => {
                      const minLength = Number(policyDraft.minLength);
                      if (!Number.isFinite(minLength) || minLength < 3) {
                        setPolicyErrors({ minLength: "Minimum length must be 3 or greater" });
                        return;
                      }

                      const payload = normalizePasswordPolicy({
                        ...policyDraft,
                        minLength,
                      });

                      setPolicySaving(true);
                      try {
                        const updated = await api.updatePasswordPolicy(payload);
                        const normalized = normalizePasswordPolicy(updated);
                        setPasswordPolicy(normalized);
                        setPolicyDraft(normalized);
                        setPolicyErrors({});
                        void message.success("Password policy saved");
                      } catch (error) {
                        const apiErrors = readApiErrors(error);
                        setPolicyErrors({ common: apiErrors[0] ?? (error instanceof Error ? error.message : String(error)) });
                        void message.error(error instanceof Error ? error.message : String(error));
                      } finally {
                        setPolicySaving(false);
                      }
                    }}
                  >
                    Save Policy
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
