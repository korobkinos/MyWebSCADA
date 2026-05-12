import bcrypt from "bcryptjs";
import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  clampAccessRoleLevel,
  DEFAULT_PASSWORD_POLICY,
  normalizePasswordPolicy,
  roleLevelFromRoles,
  validatePasswordPolicy,
} from "@web-scada/shared";
import type {
  AccessRoleLevel,
  AdminChangePasswordRequest,
  AppPermission,
  AppRole,
  AppUser,
  AuthLoginResponse,
  CreateUserRequest,
  PasswordPolicy,
  UpdateUserRequest,
} from "@web-scada/shared";
import { z } from "zod";
import { ROLE_PERMISSIONS } from "./permissions.js";

const BCRYPT_ROUNDS = 12;

type PasswordAlgorithm = "bcrypt" | "scrypt-legacy";

type StoredUserRecord = Omit<AppUser, "permissions"> & {
  permissions?: AppPermission[];
  roleLevel?: AccessRoleLevel;
  passwordHash: string;
  passwordAlgorithm: PasswordAlgorithm;
};

type PasswordPolicyRecord = PasswordPolicy & {
  id: "default";
  updatedAt: string;
  updatedBy?: string;
};

type AuthDatabase = {
  users: StoredUserRecord[];
  passwordPolicies: PasswordPolicyRecord[];
};

const appPermissionSchema: z.ZodType<AppPermission> = z.custom<AppPermission>(
  (value) => typeof value === "string",
  { message: "Invalid permission" },
);
const accessRoleLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const passwordAlgorithmSchema = z.union([z.literal("bcrypt"), z.literal("scrypt-legacy")]);

const storedUserSchema: z.ZodType<StoredUserRecord> = z.object({
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
  passwordAlgorithm: passwordAlgorithmSchema,
});

const passwordPolicyRecordSchema: z.ZodType<PasswordPolicyRecord> = z.object({
  id: z.literal("default"),
  minLength: z.number().int().min(3),
  requireUppercase: z.boolean(),
  requireLowercase: z.boolean(),
  requireDigit: z.boolean(),
  requireSpecialChar: z.boolean(),
  updatedAt: z.string().min(1),
  updatedBy: z.string().optional(),
});

const authDatabaseSchema: z.ZodType<AuthDatabase> = z.object({
  users: z.array(storedUserSchema),
  passwordPolicies: z.array(passwordPolicyRecordSchema),
});

export class AuthValidationError extends Error {
  public readonly details: string[];

  public constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "AuthValidationError";
    this.details = details;
  }
}

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

function normalizeStoredRoleLevel(level: number | undefined, roles: readonly string[]): AccessRoleLevel {
  if (typeof level === "number" && Number.isFinite(level)) {
    const clamped = clampAccessRoleLevel(level, 1);
    return clamped > 0 ? clamped : 1;
  }
  return roleLevelFromRoles(roles);
}

function sanitizeUser(user: StoredUserRecord): AppUser {
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

function isSuperadmin(user: StoredUserRecord): boolean {
  return normalizeStoredRoleLevel(user.roleLevel, user.roles) >= 4;
}

function verifyLegacyScryptPassword(password: string, passwordHash: string): boolean {
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

async function hashPasswordBcrypt(password: string): Promise<string> {
  return await bcrypt.hash(password, BCRYPT_ROUNDS);
}

function createDefaultPolicyRecord(): PasswordPolicyRecord {
  return {
    id: "default",
    ...DEFAULT_PASSWORD_POLICY,
    updatedAt: nowIso(),
    updatedBy: "system",
  };
}

export class AuthService {
  private readonly sessions = new Map<string, string>();

  public constructor(
    private readonly authDbFilePath: string,
    private readonly defaults: { username: string; password: string },
    private readonly legacyUsersFilePath?: string,
  ) {}

  public async initialize(): Promise<void> {
    const db = await this.readDatabase();
    let changed = false;

    if (db.passwordPolicies.length === 0) {
      db.passwordPolicies = [createDefaultPolicyRecord()];
      changed = true;
    }

    if (db.users.length === 0) {
      const migrated = await this.migrateLegacyUsers();
      if (migrated.length > 0) {
        db.users = migrated;
        changed = true;
      }
    }

    if (db.users.length === 0) {
      const createdAt = nowIso();
      const admin: StoredUserRecord = {
        id: randomUUID(),
        username: normalizeUsername(this.defaults.username || "admin"),
        displayName: "Administrator",
        enabled: true,
        roles: ["admin"],
        roleLevel: 4,
        permissions: [],
        createdAt,
        updatedAt: createdAt,
        passwordHash: await hashPasswordBcrypt(this.defaults.password),
        passwordAlgorithm: "bcrypt",
      };
      db.users = [admin];
      changed = true;
    }

    if (changed) {
      await this.writeDatabase(db);
    }
  }

  public async login(username: string, password: string): Promise<AuthLoginResponse> {
    const db = await this.readDatabase();
    const normalized = normalizeUsername(username);
    const user = db.users.find((item) => item.username === normalized);
    if (!user || !user.enabled) {
      return { ok: false };
    }

    const verified = await this.verifyPassword(password, user);
    if (!verified.ok) {
      return { ok: false };
    }

    let changed = false;
    if (verified.upgradeHash) {
      user.passwordHash = await hashPasswordBcrypt(password);
      user.passwordAlgorithm = "bcrypt";
      changed = true;
    }

    const token = randomUUID();
    this.sessions.set(token, user.id);
    user.lastLoginAt = nowIso();
    user.updatedAt = nowIso();
    changed = true;

    if (changed) {
      await this.writeDatabase(db);
    }

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
    const db = await this.readDatabase();
    const user = db.users.find((item) => item.id === userId && item.enabled);
    if (!user) {
      this.sessions.delete(token);
      return null;
    }
    return sanitizeUser(user);
  }

  public async listUsers(): Promise<AppUser[]> {
    const db = await this.readDatabase();
    return db.users.map(sanitizeUser).sort((a, b) => a.username.localeCompare(b.username));
  }

  public async getPasswordPolicy(): Promise<PasswordPolicy> {
    const db = await this.readDatabase();
    return this.getActivePolicy(db);
  }

  public async updatePasswordPolicy(policy: PasswordPolicy, updatedBy: string): Promise<PasswordPolicy> {
    const db = await this.readDatabase();
    const normalized = normalizePasswordPolicy(policy);
    const record = this.getOrCreatePolicyRecord(db);
    record.minLength = normalized.minLength;
    record.requireUppercase = normalized.requireUppercase;
    record.requireLowercase = normalized.requireLowercase;
    record.requireDigit = normalized.requireDigit;
    record.requireSpecialChar = normalized.requireSpecialChar;
    record.updatedAt = nowIso();
    record.updatedBy = updatedBy;
    await this.writeDatabase(db);
    return this.getActivePolicy(db);
  }

  public async createUser(payload: CreateUserRequest): Promise<AppUser> {
    const db = await this.readDatabase();
    const username = normalizeUsername(payload.username);
    if (!username) {
      throw new AuthValidationError("Username is required", ["Username is required"]);
    }
    if (db.users.some((item) => item.username === username)) {
      throw new AuthValidationError("Username already exists", ["Username already exists"]);
    }
    if (!payload.password) {
      throw new AuthValidationError("Password is required", ["Password is required"]);
    }
    if (payload.repeatPassword !== undefined && payload.password !== payload.repeatPassword) {
      throw new AuthValidationError("Passwords do not match", ["Passwords do not match"]);
    }

    const policy = this.getActivePolicy(db);
    this.assertPasswordMatchesPolicy(payload.password, policy);

    const createdAt = nowIso();
    const roles: AppRole[] = payload.roles?.length ? payload.roles : ["viewer"];
    const roleLevel = normalizeStoredRoleLevel(payload.roleLevel, roles);
    const user: StoredUserRecord = {
      id: randomUUID(),
      username,
      displayName: payload.displayName?.trim() || undefined,
      enabled: payload.enabled ?? true,
      roles,
      roleLevel,
      permissions: payload.permissions ?? [],
      createdAt,
      updatedAt: createdAt,
      passwordHash: await hashPasswordBcrypt(payload.password),
      passwordAlgorithm: "bcrypt",
    };

    db.users.push(user);
    await this.writeDatabase(db);
    return sanitizeUser(user);
  }

  public async updateUser(userId: string, payload: UpdateUserRequest): Promise<AppUser> {
    const db = await this.readDatabase();
    const user = db.users.find((item) => item.id === userId);
    if (!user) {
      throw new AuthValidationError("User not found", ["User not found"]);
    }

    const nextUsername = payload.username ? normalizeUsername(payload.username) : user.username;
    if (!nextUsername) {
      throw new AuthValidationError("Username is required", ["Username is required"]);
    }
    const duplicate = db.users.find((item) => item.id !== user.id && item.username === nextUsername);
    if (duplicate) {
      throw new AuthValidationError("Username already exists", ["Username already exists"]);
    }

    const nextRoles = payload.roles ?? user.roles;
    const nextRoleLevel = normalizeStoredRoleLevel(payload.roleLevel ?? user.roleLevel, nextRoles);
    const nextEnabled = payload.enabled ?? user.enabled;
    if (!nextEnabled && isSuperadmin(user)) {
      const enabledSuperadmins = db.users.filter((item) => item.enabled && item.id !== user.id && isSuperadmin(item));
      if (enabledSuperadmins.length === 0) {
        throw new AuthValidationError("Cannot disable the last enabled superadmin");
      }
    }
    if (nextRoleLevel < 4 && isSuperadmin(user)) {
      const otherSuperadmins = db.users.filter((item) => item.id !== user.id && item.enabled && isSuperadmin(item));
      if (otherSuperadmins.length === 0) {
        throw new AuthValidationError("Cannot remove superadmin level from the last enabled superadmin");
      }
    }
    if (!nextEnabled && user.roles.includes("admin")) {
      const enabledAdmins = db.users.filter((item) => item.enabled && item.roles.includes("admin") && item.id !== user.id);
      if (enabledAdmins.length === 0) {
        throw new AuthValidationError("Cannot disable the last enabled admin");
      }
    }
    if (!nextRoles.includes("admin") && user.roles.includes("admin")) {
      const otherAdmins = db.users.filter((item) => item.roles.includes("admin") && item.id !== user.id && item.enabled);
      if (otherAdmins.length === 0) {
        throw new AuthValidationError("Cannot remove admin role from the last enabled admin");
      }
    }

    user.username = nextUsername;
    user.displayName = payload.displayName?.trim() || undefined;
    user.roles = nextRoles;
    user.roleLevel = nextRoleLevel;
    user.permissions = payload.permissions ?? user.permissions ?? [];
    user.enabled = nextEnabled;
    user.updatedAt = nowIso();

    await this.writeDatabase(db);
    return sanitizeUser(user);
  }

  public async deleteUser(userId: string): Promise<void> {
    const db = await this.readDatabase();
    const target = db.users.find((item) => item.id === userId);
    if (!target) {
      return;
    }
    if (target.roles.includes("admin")) {
      const otherAdmins = db.users.filter((item) => item.roles.includes("admin") && item.id !== userId && item.enabled);
      if (otherAdmins.length === 0) {
        throw new AuthValidationError("Cannot delete the last enabled admin");
      }
    }
    if (isSuperadmin(target)) {
      const otherSuperadmins = db.users.filter((item) => item.id !== userId && item.enabled && isSuperadmin(item));
      if (otherSuperadmins.length === 0) {
        throw new AuthValidationError("Cannot delete the last enabled superadmin");
      }
    }

    db.users = db.users.filter((item) => item.id !== userId);
    await this.writeDatabase(db);

    for (const [token, sessionUserId] of this.sessions.entries()) {
      if (sessionUserId === userId) {
        this.sessions.delete(token);
      }
    }
  }

  public async changeOwnPassword(userId: string, oldPassword: string, newPassword: string, repeatPassword?: string): Promise<void> {
    if (!newPassword) {
      throw new AuthValidationError("Password is required", ["Password is required"]);
    }
    if (repeatPassword !== undefined && newPassword !== repeatPassword) {
      throw new AuthValidationError("Passwords do not match", ["Passwords do not match"]);
    }

    const db = await this.readDatabase();
    const user = db.users.find((item) => item.id === userId);
    if (!user) {
      throw new AuthValidationError("User not found", ["User not found"]);
    }

    const verified = await this.verifyPassword(oldPassword, user);
    if (!verified.ok) {
      throw new AuthValidationError("Current password is invalid", ["Current password is invalid"]);
    }

    const policy = this.getActivePolicy(db);
    this.assertPasswordMatchesPolicy(newPassword, policy);

    user.passwordHash = await hashPasswordBcrypt(newPassword);
    user.passwordAlgorithm = "bcrypt";
    user.updatedAt = nowIso();
    await this.writeDatabase(db);
  }

  public async changePasswordByAdmin(userId: string, payload: AdminChangePasswordRequest): Promise<void> {
    if (!payload.newPassword) {
      throw new AuthValidationError("Password is required", ["Password is required"]);
    }
    if (payload.repeatPassword !== undefined && payload.newPassword !== payload.repeatPassword) {
      throw new AuthValidationError("Passwords do not match", ["Passwords do not match"]);
    }

    const db = await this.readDatabase();
    const user = db.users.find((item) => item.id === userId);
    if (!user) {
      throw new AuthValidationError("User not found", ["User not found"]);
    }

    const policy = this.getActivePolicy(db);
    this.assertPasswordMatchesPolicy(payload.newPassword, policy);

    user.passwordHash = await hashPasswordBcrypt(payload.newPassword);
    user.passwordAlgorithm = "bcrypt";
    user.updatedAt = nowIso();
    await this.writeDatabase(db);
  }

  private assertPasswordMatchesPolicy(password: string, policy: PasswordPolicy): void {
    const errors = validatePasswordPolicy(password, policy);
    if (errors.length > 0) {
      throw new AuthValidationError("Password policy validation failed", errors);
    }
  }

  private async verifyPassword(password: string, user: StoredUserRecord): Promise<{ ok: boolean; upgradeHash?: boolean }> {
    if (user.passwordAlgorithm === "bcrypt") {
      return { ok: await bcrypt.compare(password, user.passwordHash) };
    }
    if (user.passwordAlgorithm === "scrypt-legacy") {
      const ok = verifyLegacyScryptPassword(password, user.passwordHash);
      return { ok, upgradeHash: ok };
    }
    return { ok: false };
  }

  private getActivePolicy(db: AuthDatabase): PasswordPolicy {
    const record = this.getOrCreatePolicyRecord(db);
    return {
      minLength: record.minLength,
      requireUppercase: record.requireUppercase,
      requireLowercase: record.requireLowercase,
      requireDigit: record.requireDigit,
      requireSpecialChar: record.requireSpecialChar,
    };
  }

  private getOrCreatePolicyRecord(db: AuthDatabase): PasswordPolicyRecord {
    const existing = db.passwordPolicies.find((item) => item.id === "default");
    if (existing) {
      return existing;
    }
    const created = createDefaultPolicyRecord();
    db.passwordPolicies.push(created);
    return created;
  }

  private async migrateLegacyUsers(): Promise<StoredUserRecord[]> {
    if (!this.legacyUsersFilePath) {
      return [];
    }

    try {
      const raw = await readFile(this.legacyUsersFilePath, "utf8");
      const parsed = JSON.parse(raw) as { users?: unknown[] };
      const sourceUsers = Array.isArray(parsed.users) ? parsed.users : [];
      if (sourceUsers.length === 0) {
        return [];
      }

      const migrated: StoredUserRecord[] = [];
      const seenUsernames = new Set<string>();
      for (const item of sourceUsers) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const src = item as Record<string, unknown>;
        const username = normalizeUsername(typeof src.username === "string" ? src.username : "");
        if (!username || seenUsernames.has(username)) {
          continue;
        }

        const hashInfo = await this.resolveLegacyPassword(src);
        if (!hashInfo) {
          continue;
        }

        const roles = this.normalizeLegacyRoles(src.roles);
        const createdAt = typeof src.createdAt === "string" && src.createdAt.length > 0 ? src.createdAt : nowIso();
        const updatedAt = typeof src.updatedAt === "string" && src.updatedAt.length > 0 ? src.updatedAt : createdAt;

        migrated.push({
          id: typeof src.id === "string" && src.id.length > 0 ? src.id : randomUUID(),
          username,
          displayName: typeof src.displayName === "string" ? src.displayName.trim() || undefined : undefined,
          enabled: typeof src.enabled === "boolean" ? src.enabled : true,
          roles,
          roleLevel: normalizeStoredRoleLevel(
            typeof src.roleLevel === "number" ? src.roleLevel : undefined,
            roles,
          ),
          permissions: this.normalizeLegacyPermissions(src.permissions),
          createdAt,
          updatedAt,
          lastLoginAt: typeof src.lastLoginAt === "string" ? src.lastLoginAt : undefined,
          passwordHash: hashInfo.passwordHash,
          passwordAlgorithm: hashInfo.passwordAlgorithm,
        });
        seenUsernames.add(username);
      }

      return migrated;
    } catch {
      return [];
    }
  }

  private async resolveLegacyPassword(src: Record<string, unknown>): Promise<{ passwordHash: string; passwordAlgorithm: PasswordAlgorithm } | null> {
    const rawHash = typeof src.passwordHash === "string" ? src.passwordHash.trim() : "";
    if (rawHash.length > 0) {
      if (/^\$2[aby]\$/.test(rawHash)) {
        return { passwordHash: rawHash, passwordAlgorithm: "bcrypt" };
      }
      if (rawHash.startsWith("scrypt$")) {
        return { passwordHash: rawHash, passwordAlgorithm: "scrypt-legacy" };
      }
      return {
        passwordHash: await hashPasswordBcrypt(rawHash),
        passwordAlgorithm: "bcrypt",
      };
    }

    const rawPassword = typeof src.password === "string" ? src.password : "";
    if (!rawPassword) {
      return null;
    }

    return {
      passwordHash: await hashPasswordBcrypt(rawPassword),
      passwordAlgorithm: "bcrypt",
    };
  }

  private normalizeLegacyRoles(input: unknown): AppRole[] {
    if (!Array.isArray(input)) {
      return ["viewer"];
    }

    const allowed = new Set<AppRole>(["admin", "engineer", "operator", "viewer"]);
    const roles = input
      .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
      .filter((role): role is AppRole => allowed.has(role as AppRole));

    if (roles.length > 0) {
      return roles;
    }

    return ["viewer"];
  }

  private normalizeLegacyPermissions(input: unknown): AppPermission[] {
    if (!Array.isArray(input)) {
      return [];
    }
    return input.filter((item): item is AppPermission => typeof item === "string");
  }

  private async readDatabase(): Promise<AuthDatabase> {
    try {
      const raw = await readFile(this.authDbFilePath, "utf8");
      return authDatabaseSchema.parse(JSON.parse(raw));
    } catch {
      return {
        users: [],
        passwordPolicies: [],
      };
    }
  }

  private async writeDatabase(db: AuthDatabase): Promise<void> {
    const parsed = authDatabaseSchema.parse(db);
    await mkdir(path.dirname(this.authDbFilePath), { recursive: true });
    await writeFile(this.authDbFilePath, JSON.stringify(parsed, null, 2), "utf8");
  }
}
