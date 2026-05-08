export type AppRole = "admin" | "engineer" | "operator" | "viewer";

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
  permissions?: AppPermission[];
  enabled?: boolean;
};

export type UpdateUserRequest = {
  displayName?: string;
  roles?: AppRole[];
  permissions?: AppPermission[];
  enabled?: boolean;
};

export type AdminChangePasswordRequest = {
  newPassword: string;
};
