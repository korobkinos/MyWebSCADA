export type AppRole = "admin" | "engineer" | "operator" | "viewer";

export type AccessRoleLevel = 0 | 1 | 2 | 3 | 4;

export const ACCESS_ROLE_LABELS: Record<AccessRoleLevel, string> = {
  0: "No role / Everyone",
  1: "User",
  2: "Instrumentation",
  3: "Administrator",
  4: "Superadmin",
};

export const ACCESS_ROLE_LABELS_RU: Record<AccessRoleLevel, string> = {
  0: "Не задано / всем",
  1: "Пользователь",
  2: "КИПовец",
  3: "Администратор",
  4: "Суперадмин",
};

export type AppPermission =
  | "runtime.view"
  | "runtime.control"
  | "editor.view"
  | "editor.write"
  | "screens.view"
  | "screens.write"
  | "screens.delete"
  | "tags.view"
  | "tags.write"
  | "tags.delete"
  | "tags.import"
  | "tags.export"
  | "drivers.view"
  | "drivers.write"
  | "drivers.delete"
  | "assets.view"
  | "assets.write"
  | "assets.delete"
  | "libraries.view"
  | "libraries.write"
  | "libraries.delete"
  | "elements.view"
  | "elements.write"
  | "elements.delete"
  | "macros.view"
  | "macros.write"
  | "macros.delete"
  | "macros.run"
  | "users.view"
  | "users.write"
  | "users.delete"
  | "users.changePassword"
  | "settings.view"
  | "settings.write";

export type AppUser = {
  id: string;
  username: string;
  displayName?: string;
  enabled: boolean;
  roles: AppRole[];
  roleLevel?: AccessRoleLevel;
  permissions: AppPermission[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

export type AuthLoginRequest = {
  username: string;
  password: string;
};

export type AuthLoginResponse = {
  ok: boolean;
  token?: string;
  user?: AppUser;
};

export type AuthMeResponse = {
  user: AppUser | null;
};

export type ChangeOwnPasswordRequest = {
  oldPassword: string;
  newPassword: string;
};

export type CreateUserRequest = {
  username: string;
  displayName?: string;
  password: string;
  roles?: AppRole[];
  roleLevel?: AccessRoleLevel;
  permissions?: AppPermission[];
  enabled?: boolean;
};

export type UpdateUserRequest = {
  username?: string;
  displayName?: string;
  roles?: AppRole[];
  roleLevel?: AccessRoleLevel;
  permissions?: AppPermission[];
  enabled?: boolean;
};

export type AdminChangePasswordRequest = {
  newPassword: string;
};

const ACCESS_ROLE_LEVEL_MIN = 0;
const ACCESS_ROLE_LEVEL_MAX = 4;

export function clampAccessRoleLevel(value: unknown, fallback: AccessRoleLevel = 0): AccessRoleLevel {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const clamped = Math.min(ACCESS_ROLE_LEVEL_MAX, Math.max(ACCESS_ROLE_LEVEL_MIN, Math.trunc(numeric)));
  return clamped as AccessRoleLevel;
}

export function roleLevelFromRoles(roles: readonly string[] | null | undefined): AccessRoleLevel {
  const normalized = (roles ?? []).map((role) => role.trim().toLowerCase()).filter(Boolean);
  if (normalized.includes("superadmin")) {
    return 4;
  }
  if (normalized.includes("admin")) {
    return 3;
  }
  if (normalized.includes("engineer") || normalized.includes("kip") || normalized.includes("instrumentation")) {
    return 2;
  }
  if (normalized.includes("operator") || normalized.includes("user") || normalized.includes("viewer")) {
    return 1;
  }
  return 1;
}

export function getUserRoleLevel(user: Pick<AppUser, "roleLevel" | "roles"> | null | undefined): AccessRoleLevel {
  if (!user) {
    return 0;
  }
  if (typeof user.roleLevel === "number" && Number.isFinite(user.roleLevel)) {
    return clampAccessRoleLevel(user.roleLevel, 1);
  }
  return roleLevelFromRoles(user.roles);
}

export function hasRoleAccess(userLevel: number | null | undefined, required: number | null | undefined): boolean {
  const requiredLevel = clampAccessRoleLevel(required, 0);
  if (requiredLevel <= 0) {
    return true;
  }
  return clampAccessRoleLevel(userLevel, 0) >= requiredLevel;
}
