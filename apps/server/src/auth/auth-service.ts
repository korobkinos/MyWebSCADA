import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  clampAccessRoleLevel,
  roleLevelFromRoles,
} from "@web-scada/shared";
import type {
  AccessRoleLevel,
  AdminChangePasswordRequest,
  AppPermission,
  AppRole,
  AppUser,
  AuthLoginResponse,
  CreateUserRequest,
  UpdateUserRequest,
} from "@web-scada/shared";
import { z } from "zod";
import { ROLE_PERMISSIONS } from "./permissions.js";

type StoredUser = Omit<AppUser, "permissions"> & {
  permissions?: AppPermission[];
  roleLevel?: AccessRoleLevel;
  passwordHash: string;
};

type UserStore = {
  users: StoredUser[];
};

const appPermissionSchema: z.ZodType<AppPermission> = z.custom<AppPermission>(
  (value) => typeof value === "string",
  { message: "Invalid permission" },
);
const accessRoleLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const storedUserSchema: z.ZodType<StoredUser> = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().optional(),
  enabled: z.boolean(),
  roles: z.array(z.enum(["admin", "engineer", "operator", "viewer"])),
  roleLevel: accessRoleLevelSchema.optional(),
  permissions: z.array(appPermissionSchema).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastLoginAt: z.string().optional(),
  passwordHash: z.string().min(1),
});

const userStoreSchema: z.ZodType<UserStore> = z.object({
  users: z.array(storedUserSchema),
});

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function toPermissionSet(roles: AppRole[], direct: AppPermission[] = []): Set<AppPermission> {
  const set = new Set<AppPermission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role]) {
      set.add(permission);
    }
  }
  for (const permission of direct) {
    set.add(permission);
  }
  return set;
}

function sanitizeUser(user: StoredUser): AppUser {
  const roleLevel = normalizeStoredRoleLevel(user.roleLevel, user.roles);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    enabled: user.enabled,
    roles: user.roles,
    roleLevel,
    permissions: [...toPermissionSet(user.roles, user.permissions ?? [])],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function normalizeStoredRoleLevel(level: number | undefined, roles: readonly string[]): AccessRoleLevel {
  if (typeof level === "number" && Number.isFinite(level)) {
    const clamped = clampAccessRoleLevel(level, 1);
    return clamped > 0 ? clamped : 1;
  }
  return roleLevelFromRoles(roles);
}

function isSuperadmin(user: StoredUser): boolean {
  return normalizeStoredRoleLevel(user.roleLevel, user.roles) >= 4;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password: string, passwordHash: string): boolean {
  const [algo, salt, expectedHex] = passwordHash.split("$");
  if (algo !== "scrypt" || !salt || !expectedHex) {
    return false;
  }
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

export class AuthService {
  private readonly sessions = new Map<string, string>();

  public constructor(
    private readonly usersFilePath: string,
    private readonly defaults: { username: string; password: string },
  ) {}

  public async initialize(): Promise<void> {
    const store = await this.readStore();
    if (store.users.length > 0) {
      return;
    }
    const createdAt = nowIso();
    const admin: StoredUser = {
      id: randomUUID(),
      username: normalizeUsername(this.defaults.username || "admin"),
      displayName: "Administrator",
      enabled: true,
      roles: ["admin"],
      roleLevel: 4,
      permissions: [],
      createdAt,
      updatedAt: createdAt,
      passwordHash: hashPassword(this.defaults.password),
    };
    await this.writeStore({ users: [admin] });
  }

  public async login(username: string, password: string): Promise<AuthLoginResponse> {
    const store = await this.readStore();
    const normalized = normalizeUsername(username);
    const user = store.users.find((item) => item.username === normalized);
    if (!user || !user.enabled) {
      return { ok: false };
    }
    if (!verifyPassword(password, user.passwordHash)) {
      return { ok: false };
    }
    const token = randomUUID();
    this.sessions.set(token, user.id);
    user.lastLoginAt = nowIso();
    user.updatedAt = nowIso();
    await this.writeStore(store);
    return { ok: true, token, user: sanitizeUser(user) };
  }

  public logout(token: string | undefined): void {
    if (!token) {
      return;
    }
    this.sessions.delete(token);
  }

  public async getUserByToken(token: string | undefined): Promise<AppUser | null> {
    if (!token) {
      return null;
    }
    const userId = this.sessions.get(token);
    if (!userId) {
      return null;
    }
    const store = await this.readStore();
    const user = store.users.find((item) => item.id === userId && item.enabled);
    if (!user) {
      this.sessions.delete(token);
      return null;
    }
    return sanitizeUser(user);
  }

  public async listUsers(): Promise<AppUser[]> {
    const store = await this.readStore();
    return store.users.map(sanitizeUser).sort((a, b) => a.username.localeCompare(b.username));
  }

  public async createUser(payload: CreateUserRequest): Promise<AppUser> {
    const store = await this.readStore();
    const username = normalizeUsername(payload.username);
    if (!username) {
      throw new Error("Username is required");
    }
    if (store.users.some((item) => item.username === username)) {
      throw new Error("Username already exists");
    }
    if (!payload.password || payload.password.length < 4) {
      throw new Error("Password must be at least 4 characters");
    }
    const createdAt = nowIso();
    const roles: AppRole[] = payload.roles?.length ? payload.roles : ["viewer"];
    const roleLevel = normalizeStoredRoleLevel(payload.roleLevel, roles);
    const user: StoredUser = {
      id: randomUUID(),
      username,
      displayName: payload.displayName?.trim() || undefined,
      enabled: payload.enabled ?? true,
      roles,
      roleLevel,
      permissions: payload.permissions ?? [],
      createdAt,
      updatedAt: createdAt,
      passwordHash: hashPassword(payload.password),
    };
    store.users.push(user);
    await this.writeStore(store);
    return sanitizeUser(user);
  }

  public async updateUser(userId: string, payload: UpdateUserRequest): Promise<AppUser> {
    const store = await this.readStore();
    const user = store.users.find((item) => item.id === userId);
    if (!user) {
      throw new Error("User not found");
    }

    const nextUsername = payload.username ? normalizeUsername(payload.username) : user.username;
    if (!nextUsername) {
      throw new Error("Username is required");
    }
    const duplicate = store.users.find((item) => item.id !== user.id && item.username === nextUsername);
    if (duplicate) {
      throw new Error("Username already exists");
    }

    const nextRoles = payload.roles ?? user.roles;
    const nextRoleLevel = normalizeStoredRoleLevel(payload.roleLevel ?? user.roleLevel, nextRoles);
    const nextEnabled = payload.enabled ?? user.enabled;
    if (!nextEnabled && isSuperadmin(user)) {
      const enabledSuperadmins = store.users.filter((item) => item.enabled && item.id !== user.id && isSuperadmin(item));
      if (enabledSuperadmins.length === 0) {
        throw new Error("Cannot disable the last enabled superadmin");
      }
    }
    if (nextRoleLevel < 4 && isSuperadmin(user)) {
      const otherSuperadmins = store.users.filter((item) => item.id !== user.id && item.enabled && isSuperadmin(item));
      if (otherSuperadmins.length === 0) {
        throw new Error("Cannot remove superadmin level from the last enabled superadmin");
      }
    }
    if (!nextEnabled && user.roles.includes("admin")) {
      const enabledAdmins = store.users.filter((item) => item.enabled && item.roles.includes("admin") && item.id !== user.id);
      if (enabledAdmins.length === 0) {
        throw new Error("Cannot disable the last enabled admin");
      }
    }
    if (!nextRoles.includes("admin") && user.roles.includes("admin")) {
      const otherAdmins = store.users.filter((item) => item.roles.includes("admin") && item.id !== user.id && item.enabled);
      if (otherAdmins.length === 0) {
        throw new Error("Cannot remove admin role from the last enabled admin");
      }
    }

    user.username = nextUsername;
    user.displayName = payload.displayName?.trim() || undefined;
    user.roles = nextRoles;
    user.roleLevel = nextRoleLevel;
    user.permissions = payload.permissions ?? user.permissions ?? [];
    user.enabled = nextEnabled;
    user.updatedAt = nowIso();
    await this.writeStore(store);
    return sanitizeUser(user);
  }

  public async deleteUser(userId: string): Promise<void> {
    const store = await this.readStore();
    const target = store.users.find((item) => item.id === userId);
    if (!target) {
      return;
    }
    if (target.roles.includes("admin")) {
      const otherAdmins = store.users.filter((item) => item.roles.includes("admin") && item.id !== userId && item.enabled);
      if (otherAdmins.length === 0) {
        throw new Error("Cannot delete the last enabled admin");
      }
    }
    if (isSuperadmin(target)) {
      const otherSuperadmins = store.users.filter((item) => item.id !== userId && item.enabled && isSuperadmin(item));
      if (otherSuperadmins.length === 0) {
        throw new Error("Cannot delete the last enabled superadmin");
      }
    }
    store.users = store.users.filter((item) => item.id !== userId);
    await this.writeStore(store);
    for (const [token, sessionUserId] of this.sessions.entries()) {
      if (sessionUserId === userId) {
        this.sessions.delete(token);
      }
    }
  }

  public async changeOwnPassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 4) {
      throw new Error("Password must be at least 4 characters");
    }
    const store = await this.readStore();
    const user = store.users.find((item) => item.id === userId);
    if (!user) {
      throw new Error("User not found");
    }
    if (!verifyPassword(oldPassword, user.passwordHash)) {
      throw new Error("Current password is invalid");
    }
    user.passwordHash = hashPassword(newPassword);
    user.updatedAt = nowIso();
    await this.writeStore(store);
  }

  public async changePasswordByAdmin(userId: string, payload: AdminChangePasswordRequest): Promise<void> {
    if (!payload.newPassword || payload.newPassword.length < 4) {
      throw new Error("Password must be at least 4 characters");
    }
    const store = await this.readStore();
    const user = store.users.find((item) => item.id === userId);
    if (!user) {
      throw new Error("User not found");
    }
    user.passwordHash = hashPassword(payload.newPassword);
    user.updatedAt = nowIso();
    await this.writeStore(store);
  }

  private async readStore(): Promise<UserStore> {
    try {
      const raw = await readFile(this.usersFilePath, "utf8");
      return userStoreSchema.parse(JSON.parse(raw));
    } catch {
      return { users: [] };
    }
  }

  private async writeStore(store: UserStore): Promise<void> {
    const parsed = userStoreSchema.parse(store);
    await mkdir(path.dirname(this.usersFilePath), { recursive: true });
    await writeFile(this.usersFilePath, JSON.stringify(parsed, null, 2), "utf8");
  }
}
