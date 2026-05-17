import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  type AdminChangePasswordRequest,
  type AppPermission,
  type AuthLoginRequest,
  type ChangeOwnPasswordRequest,
  type CreateUserRequest,
  type DriverConfig,
  type MacroDefinition,
  type MacroTrigger,
  type OpcUaDriverConfig,
  type PasswordPolicy,
  type ScadaProject,
  type UpdateUserRequest,
  getUserRoleLevel,
  libraryElementSchema,
  normalizePasswordPolicy,
  projectSchema,
} from "@web-scada/shared";
import { z } from "zod";
import { ArchiveService } from "../archive/archive-service.js";
import { AuthService, AuthValidationError } from "../auth/auth-service.js";
import { AssetService } from "../assets/asset-service.js";
import { DriverManager } from "../drivers/driver-manager.js";
import {
  browseOpcUaNode,
  collectOpcUaSubtreeVariables,
  opcUaDataTypeToTagDataType,
  readOpcUaNode,
  withOpcUaSession,
} from "../drivers/opcua-inspector.js";
import { LibraryService } from "../libraries/library-service.js";
import { ProjectService } from "../project/project-service.js";
import { CommandService } from "../runtime/command-service.js";
import { buildInternalAndLwTagDefinitions, InternalVariableService } from "../runtime/internal-variable-service.js";
import { MacroService } from "../runtime/macro-service.js";
import { RuntimeService } from "../runtime/runtime-service.js";
import { TagStore } from "../tags/tag-store.js";
import { ManualCommandError, toManualCommandStatusCode } from "../runtime/manual-command-error.js";

type ApiDeps = {
  projectService: ProjectService;
  assetService: AssetService;
  libraryService: LibraryService;
  tagStore: TagStore;
  driverManager: DriverManager;
  runtimeService: RuntimeService;
  commandService: CommandService;
  internalVariableService: InternalVariableService;
  macroService: MacroService;
  authService: AuthService;
  archiveService?: ArchiveService;
};

type LibraryElementUsage = {
  screenId: string;
  screenName: string;
  objectId: string;
  objectName?: string;
  path: string;
};

const GUEST_RUNTIME_PERMISSIONS = new Set<AppPermission>(["tags.write", "macros.run", "libraries.view"]);
type AuthUser = NonNullable<Awaited<ReturnType<AuthService["getUserByToken"]>>>;

function removeLibraryElementInstances(project: ScadaProject, libraryId: string, elementId: string): { project: ScadaProject; removed: number } {
  let removed = 0;

  const pruneObjects = (objects: ScadaProject["screens"][number]["objects"]): ScadaProject["screens"][number]["objects"] => {
    const next: ScadaProject["screens"][number]["objects"] = [];
    for (const object of objects) {
      if (object.type === "libraryElementInstance" && object.libraryId === libraryId && object.elementId === elementId) {
        removed += 1;
        continue;
      }
      if (object.type === "group") {
        next.push({
          ...object,
          objects: pruneObjects(object.objects),
        });
        continue;
      }
      next.push(object);
    }
    return next;
  };

  return {
    project: {
      ...project,
      screens: project.screens.map((screen) => ({
        ...screen,
        objects: pruneObjects(screen.objects),
      })),
    },
    removed,
  };
}

const commandMetaSchema = z.object({
  commandId: z.string().min(1),
  commandKey: z.string().min(1),
  createdAt: z.number().int(),
  ttlMs: z.number().int().positive(),
});
const writeSchema = z.object({
  value: z.union([z.boolean(), z.number(), z.string(), z.null()]),
  commandMeta: commandMetaSchema.optional(),
});
const archiveSamplesQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  limit: z.coerce.number().int().positive().max(10000).optional(),
});
const numericIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
const archivePolicySchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
  mode: z.string().min(1).default("on_change_with_periodic"),
  periodMs: z.number().int().positive(),
  deadband: z.number().nonnegative(),
  retentionDays: z.number().int().positive(),
  aggregateEnabled: z.boolean(),
  compressionAfterDays: z.number().int().positive().nullable().optional(),
});
const archiveTagPolicySchema = z.object({
  policyId: z.number().int().positive().nullable(),
});
const archiveTagOverrideSchema = z.object({
  enabled: z.boolean().nullable().optional(),
  mode: z.string().min(1).nullable().optional(),
  periodMs: z.number().int().positive().nullable().optional(),
  deadband: z.number().nonnegative().nullable().optional(),
  retentionDays: z.number().int().positive().nullable().optional(),
  aggregateEnabled: z.boolean().nullable().optional(),
  compressionAfterDays: z.number().int().positive().nullable().optional(),
});
const permissionSchema: z.ZodType<AppPermission> = z.custom<AppPermission>((value) => typeof value === "string");
const loginSchema: z.ZodType<AuthLoginRequest> = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
const changeOwnPasswordSchema: z.ZodType<ChangeOwnPasswordRequest> = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(1),
});
const adminChangePasswordSchema: z.ZodType<AdminChangePasswordRequest> = z.object({
  newPassword: z.string().min(1),
  repeatPassword: z.string().min(1).optional(),
});
const accessRoleLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const createUserSchema: z.ZodType<CreateUserRequest> = z.object({
  username: z.string().min(1),
  displayName: z.string().optional(),
  password: z.string().min(1),
  repeatPassword: z.string().min(1).optional(),
  roles: z.array(z.enum(["admin", "engineer", "operator", "viewer"])).optional(),
  roleLevel: accessRoleLevelSchema.optional(),
  permissions: z.array(permissionSchema).optional(),
  enabled: z.boolean().optional(),
});
const passwordPolicySchema: z.ZodType<PasswordPolicy> = z.object({
  minLength: z.number().int().min(3),
  requireUppercase: z.boolean(),
  requireLowercase: z.boolean(),
  requireDigit: z.boolean(),
  requireSpecialChar: z.boolean(),
});
const updateUserSchema: z.ZodType<UpdateUserRequest> = z.object({
  username: z.string().min(1).optional(),
  displayName: z.string().optional(),
  roles: z.array(z.enum(["admin", "engineer", "operator", "viewer"])).optional(),
  roleLevel: accessRoleLevelSchema.optional(),
  permissions: z.array(permissionSchema).optional(),
  enabled: z.boolean().optional(),
});
const macroRunSchema = z.object({
  args: z.record(z.unknown()).optional(),
  allowDisabledForTest: z.boolean().optional(),
  context: z.record(z.unknown()).optional(),
  commandMeta: commandMetaSchema.optional(),
});
const macroUpdateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean(),
  language: z.literal("javascript-lite"),
  code: z.string(),
  triggers: z.array(z.record(z.unknown())).optional(),
  options: z.record(z.unknown()).optional(),
});
const createLibrarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),
});
const updateLibrarySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  version: z.string().min(1).optional(),
});
const attachLibrarySchema = z.object({ libraryId: z.string().min(1) });
const libraryImportOptionsSchema = z.object({
  replace: z.boolean().optional(),
  importAsCopy: z.boolean().optional(),
  importMacrosToProject: z.boolean().optional(),
  macroConflictMode: z.enum(["skip", "overwrite", "copy"]).optional(),
});
const libraryMacroSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  language: z.literal("javascript-lite"),
  code: z.string().min(1),
  enabled: z.boolean().optional(),
  validation: z
    .object({
      status: z.enum(["ok", "error"]),
      errors: z.array(z.string().min(1)).optional(),
      updatedAt: z.string().optional(),
    })
    .optional(),
  triggers: z.array(z.record(z.unknown())).optional(),
});
const updateAssetSchema = z.object({
  name: z.string().optional(),
  folderPath: z.string().optional(),
});
const opcUaDriverConfigSchema = z.object({
  id: z.string().min(1),
  type: z.literal("opcua"),
  enabled: z.boolean().optional(),
  name: z.string().optional(),
  endpointUrl: z.string().min(1),
  securityPolicy: z.enum(["None", "Basic256Sha256"]).optional(),
  securityMode: z.enum(["None", "Sign", "SignAndEncrypt"]).optional(),
  readMode: z.enum(["polling", "subscription"]).optional(),
  publishingIntervalMs: z.number().int().positive().optional(),
  samplingIntervalMs: z.number().int().positive().optional(),
  queueSize: z.number().int().positive().optional(),
  discardOldest: z.boolean().optional(),
  subscriptionBatchSize: z.number().int().positive().optional(),
  connectTimeoutMs: z.number().int().positive().optional(),
  operationTimeoutMs: z.number().int().positive().optional(),
  sessionTimeoutMs: z.number().int().positive().optional(),
  keepAliveIntervalMs: z.number().int().positive().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  reconnectMs: z.number().int().positive().optional(),
});
const opcUaTestSchema = z.object({
  config: opcUaDriverConfigSchema,
});
const opcUaBrowseSchema = z.object({
  driverId: z.string().min(1).optional(),
  config: opcUaDriverConfigSchema.optional(),
  nodeId: z.string().min(1).optional(),
  search: z.string().optional(),
});
const opcUaReadSchema = z.object({
  driverId: z.string().min(1).optional(),
  config: opcUaDriverConfigSchema.optional(),
  nodeId: z.string().min(1),
});
const opcUaImportSchema = z.object({
  driverId: z.string().min(1),
  overwrite: z.boolean().optional(),
  items: z.array(
    z.object({
      nodeId: z.string().min(1),
      name: z.string().min(1),
      dataTypeNodeId: z.string().optional(),
      writable: z.boolean().optional(),
      scanRateMs: z.number().int().positive().optional(),
    }),
  ).min(1),
});
const opcUaImportSubtreeSchema = z.object({
  driverId: z.string().min(1),
  nodeId: z.string().min(1),
  rootName: z.string().optional(),
  overwrite: z.boolean().optional(),
  scanRateMs: z.number().int().positive().optional(),
  maxNodes: z.number().int().positive().max(100_000).optional(),
});
const opcUaConfigQuerySchema = z.object({
  driverId: z.string().min(1).optional(),
});
const opcUaConfigUpdateSchema = z.object({
  driverId: z.string().min(1).optional(),
  config: opcUaDriverConfigSchema,
});
const opcUaConnectSchema = z.object({
  driverId: z.string().min(1).optional(),
  config: opcUaDriverConfigSchema.optional(),
});
const opcUaDisconnectSchema = z.object({
  driverId: z.string().min(1),
});
const opcUaDriverParamsSchema = z.object({
  driverId: z.string().min(1),
});
const opcUaDeleteDriverQuerySchema = z.object({
  deleteTags: z.union([z.boolean(), z.enum(["true", "false"])]).optional()
    .transform((value) => (value === true || value === "true")),
});

type MacroTagReferenceResult = {
  macroId: string;
  macroName: string;
  referencedTags: string[];
  dynamicTagAccess: boolean;
};

type AuthContext = {
  userId: string;
  permissions: Set<AppPermission>;
  roleLevel: number;
};

function tokenFromRequest(request: { headers: Record<string, unknown> }): string | undefined {
  const header = request.headers["x-engineer-token"] ?? request.headers.authorization;
  if (typeof header !== "string") {
    return undefined;
  }
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return header;
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply, deps: ApiDeps): Promise<AuthContext | null> {
  const user = await resolveAuthUser(request, deps);
  if (!user) {
    await reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
    return null;
  }
  return toAuthContext(user);
}

async function requirePermission(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: ApiDeps,
  permission: AppPermission,
): Promise<AuthContext | null> {
  const user = await resolveAuthUser(request, deps);
  if (!user) {
    if (isGuestRuntimePermissionAllowed(deps, permission)) {
      return {
        userId: "guest-runtime",
        permissions: new Set<AppPermission>(),
        roleLevel: 0,
      };
    }
    await reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
    return null;
  }
  const auth = toAuthContext(user);
  if (!auth.permissions.has(permission)) {
    await reply.code(403).send({
      error: "Forbidden",
      requiredPermission: permission,
      message: `Insufficient permissions. Required: ${permission}`,
    });
    return null;
  }
  return auth;
}

async function requireAnyPermission(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: ApiDeps,
  permissions: AppPermission[],
): Promise<AuthContext | null> {
  const user = await resolveAuthUser(request, deps);
  if (!user) {
    await reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
    return null;
  }
  const auth = toAuthContext(user);
  if (permissions.some((permission) => auth.permissions.has(permission))) {
    return auth;
  }
  await reply.code(403).send({
    error: "Forbidden",
    requiredPermission: permissions,
    message: `Insufficient permissions. Required one of: ${permissions.join(", ")}`,
  });
  return null;
}

async function resolveAuthUser(request: FastifyRequest, deps: ApiDeps): Promise<AuthUser | undefined> {
  const token = tokenFromRequest(request as { headers: Record<string, unknown> });
  const user = await deps.authService.getUserByToken(token);
  return user ?? undefined;
}

function toAuthContext(user: AuthUser): AuthContext {
  return {
    userId: user.id,
    permissions: new Set(user.permissions),
    roleLevel: getUserRoleLevel(user),
  };
}

function isGuestRuntimePermissionAllowed(deps: ApiDeps, permission: AppPermission): boolean {
  if (!GUEST_RUNTIME_PERMISSIONS.has(permission)) {
    return false;
  }
  return deps.projectService.getProject().runtimeSettings?.allowGuestRuntimeActions !== false;
}

async function requireSuperadmin(request: FastifyRequest, reply: FastifyReply, deps: ApiDeps): Promise<AuthContext | null> {
  const auth = await requireAuth(request, reply, deps);
  if (!auth) {
    return null;
  }
  if (auth.roleLevel < 4) {
    await reply.code(403).send({
      error: "Forbidden",
      message: "Superadmin role is required",
    });
    return null;
  }
  return auth;
}

function sendAuthError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AuthValidationError) {
    return reply.code(400).send({
      error: "Validation Error",
      message: error.message,
      errors: error.details,
    });
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      error: "Validation Error",
      message: "Invalid request payload",
      errors: error.issues.map((issue) => issue.message),
    });
  }
  if (error instanceof Error) {
    return reply.code(400).send({
      error: "Bad Request",
      message: error.message,
    });
  }
  return reply.code(400).send({
    error: "Bad Request",
    message: String(error),
  });
}

function resolveOpcUaConfigFromPayload(
  project: ScadaProject,
  payload: { driverId?: string; config?: z.infer<typeof opcUaDriverConfigSchema> },
): OpcUaDriverConfig {
  if (payload.config) {
    return {
      ...payload.config,
      type: "opcua",
      enabled: payload.config.enabled ?? true,
    };
  }
  if (!payload.driverId) {
    throw new Error("driverId or config is required");
  }
  const driver = project.drivers.find((item) => item.id === payload.driverId);
  if (!driver) {
    throw new Error(`Driver ${payload.driverId} not found`);
  }
  if (driver.type !== "opcua") {
    throw new Error(`Driver ${payload.driverId} is not OPC UA`);
  }
  return driver;
}

function getTagsByDriver(project: ScadaProject, driverId: string): { count: number; tagNames: string[]; preview: string[] } {
  const tagNames = project.tags
    .filter((tag) => tag.sourceType === "opcua" && tag.driverId === driverId)
    .map((tag) => tag.name);
  return {
    count: tagNames.length,
    tagNames,
    preview: tagNames.slice(0, 10),
  };
}

function hasDynamicTagAccess(macroCode: string): boolean {
  return /\b(resolveTag|getCurrentTagPrefix)\s*\(/.test(macroCode)
    || /\b(readTag|writeTag|pulseTag|toggleTag)\s*\(\s*[^"'`\s]/.test(macroCode);
}

function getLiteralMacroTagReferences(macroCode: string): string[] {
  const refs = new Set<string>();
  const pattern = /\b(?:tag|readTag|writeTag|pulseTag|toggleTag)\s*\(\s*(['"`])([^'"`]+)\1/g;
  let match = pattern.exec(macroCode);
  while (match) {
    const tagName = match[2]?.trim();
    if (tagName) {
      refs.add(tagName);
    }
    match = pattern.exec(macroCode);
  }
  return [...refs];
}

function findMacroTagReferences(macros: MacroDefinition[] | undefined, tagNames: string[]): MacroTagReferenceResult[] {
  const tags = [...new Set(tagNames.map((name) => name.trim()).filter(Boolean))];
  if (tags.length === 0 || !macros || macros.length === 0) {
    return [];
  }
  const results: MacroTagReferenceResult[] = [];
  for (const macro of macros) {
    const referencedTags = tags.filter((tagName) => macro.code.includes(tagName));
    const dynamicTagAccess = hasDynamicTagAccess(macro.code);
    if (referencedTags.length > 0 || dynamicTagAccess) {
      results.push({
        macroId: macro.id,
        macroName: macro.name,
        referencedTags,
        dynamicTagAccess,
      });
    }
  }
  return results;
}

function markMacrosInvalidForDeletedTags(macros: MacroDefinition[] | undefined, deletedTagNames: string[]): {
  macros: MacroDefinition[];
  affectedMacros: MacroTagReferenceResult[];
} {
  const source = macros ?? [];
  const references = findMacroTagReferences(source, deletedTagNames);
  const byMacroId = new Map(references.map((item) => [item.macroId, item]));
  const nextMacros = source.map((macro) => {
    const ref = byMacroId.get(macro.id);
    if (!ref || ref.referencedTags.length === 0) {
      return macro;
    }
    const deletedErrors = ref.referencedTags.map((tagName) => `References deleted tag: ${tagName}`);
    return {
      ...macro,
      validation: {
        status: "error" as const,
        errors: deletedErrors,
        updatedAt: new Date().toISOString(),
      },
    };
  });
  return {
    macros: nextMacros,
    affectedMacros: references.filter((item) => item.referencedTags.length > 0),
  };
}

function validateMacroOnSave(macro: MacroDefinition, project: ScadaProject): MacroDefinition {
  const existingTags = new Set(project.tags.map((tag) => tag.name));
  const refs = getLiteralMacroTagReferences(macro.code)
    .filter((tagName) => !tagName.startsWith("."));
  const missing = [...new Set(refs.filter((tagName) => !existingTags.has(tagName)))];
  if (missing.length === 0) {
    if (macro.validation?.status === "error") {
      return {
        ...macro,
        validation: {
          status: "ok",
          errors: [],
          updatedAt: new Date().toISOString(),
        },
      };
    }
    return macro;
  }
  return {
    ...macro,
    validation: {
      status: "error",
      errors: missing.map((tagName) => `References missing tag: ${tagName}`),
      updatedAt: new Date().toISOString(),
    },
  };
}

async function persistProjectUpdate(deps: ApiDeps, nextProject: ScadaProject): Promise<ScadaProject> {
  const saved = await deps.projectService.saveProject(nextProject);
  const variableDefinitions = buildInternalAndLwTagDefinitions(saved.variables ?? [], saved.lwStore);
  deps.tagStore.setDefinitions([...(saved.tags ?? []), ...variableDefinitions]);
  deps.internalVariableService.setup(saved.variables ?? [], saved.lwStore);
  deps.macroService.configure(saved);
  await deps.archiveService?.syncMetadata([...(saved.tags ?? []), ...variableDefinitions], saved.drivers);

  if (deps.runtimeService.getState().running) {
    await deps.runtimeService.stop();
    await deps.runtimeService.start(saved);
  }

  return saved;
}

function withUpdatedDriver(project: ScadaProject, nextDriver: DriverConfig, driverId?: string): ScadaProject {
  const targetId = driverId?.trim() || nextDriver.id;
  const index = project.drivers.findIndex((driver) => driver.id === targetId);
  if (index < 0) {
    return {
      ...project,
      drivers: [...project.drivers, nextDriver],
    };
  }
  const drivers = [...project.drivers];
  drivers[index] = nextDriver;
  return {
    ...project,
    drivers,
  };
}

async function parseUpload(request: FastifyRequest): Promise<{
  fileName: string;
  mimeType: string;
  size: number;
  content: Buffer;
  name?: string;
  options?: string;
}> {
  const part = await request.file();
  if (!part) {
    throw new Error("File is required");
  }

  if (part.file.truncated) {
    throw new Error("File is too large. Max size is 10 MB.");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of part.file) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const content = Buffer.concat(chunks);

  const MAX_ASSET_SIZE_BYTES = 10 * 1024 * 1024;
  if (content.byteLength > MAX_ASSET_SIZE_BYTES) {
    throw new Error("File is too large. Max size is 10 MB.");
  }

  const namePart = (part.fields as Record<string, { value?: unknown }> | undefined)?.name;
  const optionsPart = (part.fields as Record<string, { value?: unknown }> | undefined)?.options;
  const name = typeof namePart?.value === "string" ? namePart.value : undefined;
  const options = typeof optionsPart?.value === "string" ? optionsPart.value : undefined;
  return {
    fileName: part.filename,
    mimeType: part.mimetype,
    size: content.byteLength,
    content,
    name,
    options,
  };
}

function findLibraryElementUsages(project: ScadaProject, libraryId: string, elementId: string): LibraryElementUsage[] {
  const usages: LibraryElementUsage[] = [];

  const scanObjects = (
    screenId: string,
    screenName: string,
    objects: ScadaProject["screens"][number]["objects"],
    pathPrefix: string,
  ) => {
    for (const object of objects) {
      const path = `${pathPrefix}/${object.id}`;
      if (object.type === "libraryElementInstance" && object.libraryId === libraryId && object.elementId === elementId) {
        usages.push({
          screenId,
          screenName,
          objectId: object.id,
          objectName: object.name,
          path,
        });
      }
      if (object.type === "group") {
        scanObjects(screenId, screenName, object.objects, path);
      }
    }
  };

  for (const screen of project.screens) {
    scanObjects(screen.id, screen.name, screen.objects, screen.id);
  }
  return usages;
}

export async function registerApiRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  app.get("/", async () => ({
    service: "web-scada-server",
    status: "ok",
    apiRoot: "/api",
  }));

  app.post("/api/auth/login", async (request, reply) => {
    const payload = loginSchema.parse(request.body);
    const result = await deps.authService.login(payload.username, payload.password);
    if (!result.ok) {
      return reply.code(401).send({ ok: false, message: "Invalid credentials" });
    }
    return result;
  });

  // Backward compatibility with old engineer modal flow.
  app.post("/api/auth/engineer", async (request, reply) => {
    const payload = z.object({ password: z.string().min(1) }).parse(request.body);
    const result = await deps.authService.login("admin", payload.password);
    if (!result.ok) {
      return reply.code(401).send({ ok: false, message: "Invalid credentials" });
    }
    return result;
  });

  app.get("/api/auth/me", async (request, reply) => {
    const token = tokenFromRequest(request as { headers: Record<string, unknown> });
    const user = await deps.authService.getUserByToken(token);
    if (!user) {
      return reply.send({ user: null });
    }
    return reply.send({ user });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    deps.authService.logout(tokenFromRequest(request as { headers: Record<string, unknown> }));
    return reply.send({ ok: true });
  });

  app.post("/api/auth/change-password", async (request, reply) => {
    const auth = await requireAuth(request, reply, deps);
    if (!auth) {
      return;
    }
    try {
      const payload = changeOwnPasswordSchema.parse(request.body);
      await deps.authService.changeOwnPassword(auth.userId, payload.oldPassword, payload.newPassword);
      return reply.send({ ok: true });
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.get("/api/users", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "users.view");
    if (!auth) {
      return;
    }
    return reply.send(await deps.authService.listUsers());
  });

  app.post("/api/users", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "users.write");
    if (!auth) {
      return;
    }
    try {
      const payload = createUserSchema.parse(request.body);
      const created = await deps.authService.createUser(payload);
      return reply.send(created);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.put("/api/users/:id", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "users.write");
    if (!auth) {
      return;
    }
    try {
      const { id } = request.params as { id: string };
      const payload = updateUserSchema.parse(request.body);
      const updated = await deps.authService.updateUser(id, payload);
      return reply.send(updated);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.delete("/api/users/:id", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "users.delete");
    if (!auth) {
      return;
    }
    try {
      const { id } = request.params as { id: string };
      await deps.authService.deleteUser(id);
      return reply.send({ ok: true });
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post("/api/users/:id/change-password", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "users.changePassword");
    if (!auth) {
      return;
    }
    try {
      const { id } = request.params as { id: string };
      const payload = adminChangePasswordSchema.parse(request.body);
      await deps.authService.changePasswordByAdmin(id, payload);
      return reply.send({ ok: true });
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.get("/api/security/password-policy", async (request, reply) => {
    const auth = await requireAuth(request, reply, deps);
    if (!auth) {
      return;
    }
    return reply.send(await deps.authService.getPasswordPolicy());
  });

  app.put("/api/security/password-policy", async (request, reply) => {
    const auth = await requireSuperadmin(request, reply, deps);
    if (!auth) {
      return;
    }
    try {
      const payload = passwordPolicySchema.parse(request.body);
      const normalized = normalizePasswordPolicy(payload);
      return reply.send(await deps.authService.updatePasswordPolicy(normalized, auth.userId));
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.get("/api/project", async () => deps.projectService.getProject());

  app.post("/api/project", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "editor.write");
    if (!auth) {
      return;
    }
    const parsed = projectSchema.parse(request.body);
    const saved = await persistProjectUpdate(deps, parsed);

    return reply.send(saved);
  });

  app.get("/api/tags", async () => deps.tagStore.getSnapshots());

  app.get("/api/tags/:name", async (request, reply) => {
    const params = request.params as { name: string };
    const value = deps.tagStore.getValue(params.name);
    if (!value) {
      return reply.code(404).send({ message: "Tag not found" });
    }
    return value;
  });

  app.post("/api/tags/:name/write", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    const params = request.params as { name: string };
    const payload = writeSchema.parse(request.body);
    try {
      await deps.commandService.writeTag(params.name, payload.value, {
        manual: true,
        commandMeta: payload.commandMeta,
      });
      return reply.send({ ok: true });
    } catch (error) {
      if (error instanceof ManualCommandError) {
        request.log.warn({
          timestamp: new Date().toISOString(),
          commandKey: payload.commandMeta?.commandKey ?? `tag:${params.name}`,
          actionType: "writeTag",
          reason: error.reason,
          message: error.message,
        }, "manual tag command rejected");
        return reply.code(toManualCommandStatusCode(error.reason)).send({
          ok: false,
          reason: error.reason,
          message: error.message,
        });
      }
      throw error;
    }
  });

  app.get("/api/archive/status", async (request, reply) => {
    if (!deps.archiveService) {
      return {
        enabled: false,
        queuedSamples: 0,
        reason: process.env.ARCHIVE_STATUS_REASON ?? "Archive service was not initialized",
        dbSizeMb: null,
        recordsCount: null,
      };
    }
    try {
      return await deps.archiveService.getStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ error }, "Archive status check failed");
      return reply.code(503).send({
        error: "Archive unavailable",
        message,
      });
    }
  });

  app.get("/api/archive/policies", async (request, reply) => {
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    return reply.send(await deps.archiveService.listPolicies());
  });

  app.post("/api/archive/policies", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    const payload = archivePolicySchema.parse(request.body);
    const saved = await deps.archiveService.upsertPolicy(undefined, {
      ...payload,
      compressionAfterDays: payload.compressionAfterDays ?? null,
    });
    return reply.code(201).send(saved);
  });

  app.put("/api/archive/policies/:id", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    const { id } = numericIdParamSchema.parse(request.params);
    const payload = archivePolicySchema.parse(request.body);
    const saved = await deps.archiveService.upsertPolicy(id, {
      ...payload,
      compressionAfterDays: payload.compressionAfterDays ?? null,
    });
    return reply.send(saved);
  });

  app.delete("/api/archive/policies/:id", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    const { id } = numericIdParamSchema.parse(request.params);
    const deleted = await deps.archiveService.deletePolicy(id);
    if (!deleted) {
      return reply.code(404).send({ message: "Archive policy not found" });
    }
    return reply.send({ ok: true });
  });

  app.get("/api/archive/tag-configs", async (request, reply) => {
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    return reply.send(await deps.archiveService.listTagConfigs());
  });

  app.put("/api/archive/tags/:name/policy", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    const params = request.params as { name: string };
    const payload = archiveTagPolicySchema.parse(request.body);
    const updated = await deps.archiveService.assignTagPolicy(params.name, payload.policyId);
    if (!updated) {
      return reply.code(404).send({ message: "Tag not found" });
    }
    return reply.send({ ok: true });
  });

  app.put("/api/archive/tags/:name/override", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    const params = request.params as { name: string };
    const payload = archiveTagOverrideSchema.parse(request.body);
    const updated = await deps.archiveService.upsertTagOverride(params.name, payload);
    if (!updated) {
      return reply.code(404).send({ message: "Tag not found" });
    }
    return reply.send({ ok: true });
  });

  app.delete("/api/archive/tags/:name/override", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    const params = request.params as { name: string };
    await deps.archiveService.deleteTagOverride(params.name);
    return reply.send({ ok: true });
  });

  app.post("/api/archive/maintenance/run", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "runtime.control");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    return reply.send(await deps.archiveService.runMaintenance());
  });

  app.get("/api/archive/tags/:name/samples", async (request, reply) => {
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    const params = request.params as { name: string };
    const query = archiveSamplesQuerySchema.parse(request.query);
    const rows = await deps.archiveService.querySamples(params.name, query.from, query.to, query.limit ?? 5000);
    return reply.send(rows);
  });

  app.get("/api/variables", async () => deps.internalVariableService.getAll());

  app.post("/api/variables/:name/write", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    const params = request.params as { name: string };
    const payload = writeSchema.parse(request.body);
    try {
      await deps.commandService.writeVariable(params.name, payload.value, {
        manual: true,
        commandMeta: payload.commandMeta,
      });
      return reply.send({ ok: true });
    } catch (error) {
      if (error instanceof ManualCommandError) {
        request.log.warn({
          timestamp: new Date().toISOString(),
          commandKey: payload.commandMeta?.commandKey ?? `variable:${params.name}`,
          actionType: "writeVariable",
          reason: error.reason,
          message: error.message,
        }, "manual variable command rejected");
        return reply.code(toManualCommandStatusCode(error.reason)).send({
          ok: false,
          reason: error.reason,
          message: error.message,
        });
      }
      throw error;
    }
  });

  app.get("/api/macros", async () => deps.macroService.list());

  app.get("/api/macros/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const macro = deps.macroService.getById(params.id);
    if (!macro) {
      return reply.code(404).send({ message: "Macro not found" });
    }
    return macro;
  });

  app.put("/api/macros/:id", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "macros.write");
    if (!auth) {
      return;
    }

    const params = request.params as { id: string };
    const payload = macroUpdateSchema.parse(request.body);
    const project = deps.projectService.getProject();
    const macros = project.macros ?? [];
    const index = macros.findIndex((m) => m.id === params.id);

    if (index === -1) {
      return reply.code(404).send({ message: "Macro not found" });
    }

    const existing = macros[index]!;
    const updatedMacroDraft: MacroDefinition = {
      id: existing.id,
      name: payload.name,
      description: payload.description ?? existing.description,
      enabled: payload.enabled,
      language: payload.language,
      code: payload.code,
      triggers: (payload.triggers ?? existing.triggers ?? []) as MacroTrigger[],
      validation: existing.validation,
    };
    const updatedMacro = validateMacroOnSave(updatedMacroDraft, project);

    const nextMacros = [...macros];
    nextMacros[index] = updatedMacro;

    const nextProject: ScadaProject = {
      ...project,
      macros: nextMacros,
    };

    const saved = await deps.projectService.saveProject(nextProject);
    deps.macroService.configure(saved);

    if (deps.runtimeService.getState().running) {
      deps.runtimeService.macroRegistry.reloadMacro(updatedMacro);
    }

    return reply.send(updatedMacro);
  });

  app.post("/api/macros/:id/run", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "macros.run");
    if (!auth) {
      return;
    }
    const params = request.params as { id: string };
    const debugHeader = request.headers["x-debug-runtime-command"];
    const runtimeCommandDebug = (Array.isArray(debugHeader) ? debugHeader[0] : debugHeader) === "1";
    const routeStartedAtHr = performance.now();
    const startedAt = Date.now();
    if (runtimeCommandDebug) {
      request.log.info(
        {
          macroId: params.id,
          event: "request-received",
          timestamp: new Date(startedAt).toISOString(),
          commandKey:
            typeof request.body === "object" && request.body && "commandMeta" in request.body
              ? ((request.body as { commandMeta?: { commandKey?: string } }).commandMeta?.commandKey ?? `macro:${params.id}`)
              : `macro:${params.id}`,
        },
        "runtime macro debug",
      );
    }
    setImmediate(() => {
      const eventLoopDelayMs = performance.now() - routeStartedAtHr;
      if (runtimeCommandDebug && eventLoopDelayMs > 50) {
        request.log.warn(
          {
            macroId: params.id,
            event: "event-loop-delay",
            eventLoopDelayMs: Math.round(eventLoopDelayMs * 1000) / 1000,
          },
          "runtime macro debug",
        );
      }
    });
    if (runtimeCommandDebug) {
      request.log.info(
        {
          macroId: params.id,
          event: "before-schema-parse",
          elapsedMs: Math.round((performance.now() - routeStartedAtHr) * 1000) / 1000,
        },
        "runtime macro debug",
      );
    }
    const payload = macroRunSchema.parse(request.body ?? {});
    if (runtimeCommandDebug) {
      request.log.info(
        {
          macroId: params.id,
          event: "after-schema-parse",
          elapsedMs: Math.round((performance.now() - routeStartedAtHr) * 1000) / 1000,
          commandKey: payload.commandMeta?.commandKey ?? `macro:${params.id}`,
          argsKeys: Object.keys(payload.args ?? {}),
          hasContext: Boolean(payload.context),
        },
        "runtime macro debug",
      );
      request.log.info(
        {
          macroId: params.id,
          event: "before-macro-run-manual",
          elapsedMs: Math.round((performance.now() - routeStartedAtHr) * 1000) / 1000,
        },
        "runtime macro debug",
      );
    }
    try {
      const result = await deps.macroService.runManual(params.id, payload.args, {
        allowDisabledForTest: payload.allowDisabledForTest,
        context: payload.context,
        commandMeta: payload.commandMeta,
      });
      if (runtimeCommandDebug) {
        request.log.info(
          {
            macroId: params.id,
            event: "after-macro-run-manual",
            elapsedMs: Math.round((performance.now() - routeStartedAtHr) * 1000) / 1000,
            diagnostics: result.diagnostics,
            status: result.status,
            reason: result.reason,
          },
          "runtime macro debug",
        );
      }
      const durationMs = Date.now() - startedAt;
      request.log.info(
        {
          macroId: params.id,
          status: result.status,
          reason: result.reason,
          durationMs,
          diagnostics: result.diagnostics,
        },
        "manual macro run completed",
      );
      const responsePayload = {
        ok: true,
        status: result.status,
        reason: result.reason,
        effects: result.effects,
        diagnostics: runtimeCommandDebug ? result.diagnostics : undefined,
      };
      if (runtimeCommandDebug) {
        request.log.info(
          {
            macroId: params.id,
            event: "response-send",
            elapsedMs: Math.round((performance.now() - routeStartedAtHr) * 1000) / 1000,
            durationMs,
          },
          "runtime macro debug",
        );
      }
      return reply.send(responsePayload);
    } catch (error) {
      if (error instanceof ManualCommandError) {
        const durationMs = Date.now() - startedAt;
        request.log.warn(
          {
            macroId: params.id,
            commandKey: payload.commandMeta?.commandKey ?? `macro:${params.id}`,
            reason: error.reason,
            durationMs,
            message: error.message,
          },
          "manual macro run rejected",
        );
        if (runtimeCommandDebug) {
          request.log.info(
            {
              macroId: params.id,
              event: "response-send",
              elapsedMs: Math.round((performance.now() - routeStartedAtHr) * 1000) / 1000,
              durationMs,
              statusCode: toManualCommandStatusCode(error.reason),
              reason: error.reason,
            },
            "runtime macro debug",
          );
        }
        return reply.code(toManualCommandStatusCode(error.reason)).send({
          ok: false,
          reason: error.reason,
          message: error.message,
          macroId: params.id,
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
      request.log.error(
        {
          macroId: params.id,
          durationMs,
          message,
        },
        "manual macro run failed",
      );
      if (runtimeCommandDebug) {
        request.log.info(
          {
            macroId: params.id,
            event: "response-send",
            elapsedMs: Math.round((performance.now() - routeStartedAtHr) * 1000) / 1000,
            durationMs,
            statusCode: 500,
          },
          "runtime macro debug",
        );
      }
      return reply.code(500).send({
        ok: false,
        status: "error",
        message,
        macroId: params.id,
      });
    }
  });

  app.get("/api/drivers/opcua/config", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "drivers.view");
    if (!auth) {
      return;
    }
    const query = opcUaConfigQuerySchema.parse(request.query ?? {});
    const project = deps.projectService.getProject();
    const target = query.driverId
      ? project.drivers.find((driver) => driver.id === query.driverId && driver.type === "opcua")
      : project.drivers.find((driver) => driver.type === "opcua");
    if (!target || target.type !== "opcua") {
      return reply.code(404).send({ ok: false, message: "OPC UA driver not found" });
    }
    return reply.send({ ok: true, config: target });
  });

  app.put("/api/drivers/opcua/config", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "drivers.write");
    if (!auth) {
      return;
    }
    const payload = opcUaConfigUpdateSchema.parse(request.body ?? {});
    const project = deps.projectService.getProject();
    const targetId = payload.driverId?.trim();
    const requestedId = payload.config.id.trim();
    if (!requestedId) {
      return reply.code(400).send({ ok: false, message: "Driver id is required" });
    }
    if (targetId) {
      const existing = project.drivers.find((driver) => driver.id === targetId);
      if (existing && existing.type !== "opcua") {
        return reply.code(400).send({ ok: false, message: `Driver ${targetId} is not OPC UA` });
      }
    }
    const duplicate = project.drivers.find((driver) => driver.id === requestedId && driver.id !== targetId);
    if (duplicate) {
      return reply.code(409).send({ ok: false, message: `Driver id ${requestedId} already exists` });
    }
    const nextConfig: OpcUaDriverConfig = {
      ...payload.config,
      id: requestedId,
      type: "opcua",
      enabled: payload.config.enabled ?? true,
    };
    const withDriver = withUpdatedDriver(project, nextConfig, targetId);
    const nextProject = targetId && targetId !== nextConfig.id
      ? {
          ...withDriver,
          tags: withDriver.tags.map((tag) => (
            tag.sourceType === "opcua" && tag.driverId === targetId
              ? { ...tag, driverId: nextConfig.id }
              : tag
          )),
        }
      : withDriver;
    const saved = await persistProjectUpdate(deps, nextProject);
    const savedConfig = saved.drivers.find((driver) => driver.id === nextConfig.id && driver.type === "opcua");
    return reply.send({ ok: true, config: savedConfig ?? nextConfig });
  });

  app.post("/api/drivers/opcua/test", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "drivers.view");
    if (!auth) {
      return;
    }
    const payload = opcUaTestSchema.parse(request.body ?? {});
    try {
      await withOpcUaSession(
        {
          ...payload.config,
          enabled: payload.config.enabled ?? true,
          type: "opcua",
        },
        async () => undefined,
      );
      return reply.send({ ok: true });
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/drivers/opcua/connect", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "drivers.write");
    if (!auth) {
      return;
    }
    const payload = opcUaConnectSchema.parse(request.body ?? {});
    const project = deps.projectService.getProject();
    let driverIdForStatus: string | undefined = payload.driverId?.trim();
    try {
      const config = resolveOpcUaConfigFromPayload(project, payload);
      driverIdForStatus = config.id;
      const status = await deps.driverManager.connectDriver({
        ...config,
        type: "opcua",
        enabled: true,
      });
      return reply.send({ ok: true, status });
    } catch (error) {
      const status = driverIdForStatus ? deps.driverManager.getStatus(driverIdForStatus) : undefined;
      return reply.code(400).send({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        status,
      });
    }
  });

  app.post("/api/drivers/opcua/disconnect", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "drivers.write");
    if (!auth) {
      return;
    }
    const payload = opcUaDisconnectSchema.parse(request.body ?? {});
    try {
      const project = deps.projectService.getProject();
      const existing = project.drivers.find((driver) => driver.id === payload.driverId && driver.type === "opcua");
      if (!existing || existing.type !== "opcua") {
        return reply.code(404).send({ ok: false, message: `OPC UA driver ${payload.driverId} not found` });
      }
      const nextProject = withUpdatedDriver(project, { ...existing, enabled: false }, existing.id);
      await persistProjectUpdate(deps, nextProject);
      const status = deps.driverManager.getStatus(payload.driverId) ?? {
        id: payload.driverId,
        type: "opcua",
        health: "disabled" as const,
        updatedAt: Date.now(),
        message: "Disconnected by user",
      };
      return reply.send({ ok: true, status });
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/drivers/opcua/status", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "drivers.view");
    if (!auth) {
      return;
    }
    const query = opcUaConfigQuerySchema.parse(request.query ?? {});
    const statuses = deps.driverManager.getStatuses();
    if (!query.driverId) {
      return reply.send({ ok: true, statuses });
    }
    const status = statuses.find((item) => item.id === query.driverId) ?? deps.driverManager.getStatus(query.driverId);
    if (!status) {
      return reply.code(404).send({ ok: false, message: `Driver ${query.driverId} status not found` });
    }
    return reply.send({ ok: true, status });
  });

  app.get("/api/drivers/opcua/:driverId/impact", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "drivers.view");
    if (!auth) {
      return;
    }
    const params = opcUaDriverParamsSchema.parse(request.params ?? {});
    const project = deps.projectService.getProject();
    const driver = project.drivers.find((item) => item.id === params.driverId);
    if (!driver) {
      return reply.code(404).send({ ok: false, message: `Driver ${params.driverId} not found` });
    }
    if (driver.type !== "opcua") {
      return reply.code(400).send({ ok: false, message: `Driver ${params.driverId} is not OPC UA` });
    }
    const tagsByDriver = getTagsByDriver(project, params.driverId);
    const macroRefs = findMacroTagReferences(project.macros, tagsByDriver.tagNames);
    return reply.send({
      ok: true,
      driverId: params.driverId,
      tagCount: tagsByDriver.count,
      tagNamesPreview: tagsByDriver.preview,
      affectedMacros: macroRefs,
      affectedMacroCount: macroRefs.filter((item) => item.referencedTags.length > 0).length,
      dynamicMacroCount: macroRefs.filter((item) => item.dynamicTagAccess).length,
    });
  });

  app.post("/api/drivers/opcua/:driverId/delete-tags", async (request, reply) => {
    const auth = await requireAnyPermission(request, reply, deps, ["tags.write", "drivers.write"]);
    if (!auth) {
      return;
    }
    const params = opcUaDriverParamsSchema.parse(request.params ?? {});
    const project = deps.projectService.getProject();
    const driver = project.drivers.find((item) => item.id === params.driverId);
    if (!driver) {
      return reply.code(404).send({ ok: false, message: `Driver ${params.driverId} not found` });
    }
    if (driver.type !== "opcua") {
      return reply.code(400).send({ ok: false, message: `Driver ${params.driverId} is not OPC UA` });
    }

    const tagsByDriver = getTagsByDriver(project, params.driverId);
    const nextTags = project.tags.filter((tag) => !(tag.sourceType === "opcua" && tag.driverId === params.driverId));
    const macroUpdate = markMacrosInvalidForDeletedTags(project.macros, tagsByDriver.tagNames);
    const nextProject: ScadaProject = {
      ...project,
      tags: nextTags,
      macros: macroUpdate.macros,
    };
    await persistProjectUpdate(deps, nextProject);
    return reply.send({
      ok: true,
      driverId: params.driverId,
      deletedTags: tagsByDriver.count,
      affectedMacros: macroUpdate.affectedMacros,
    });
  });

  app.delete("/api/drivers/opcua/:driverId", async (request, reply) => {
    const auth = await requireAnyPermission(request, reply, deps, ["drivers.delete", "drivers.write"]);
    if (!auth) {
      return;
    }
    const params = opcUaDriverParamsSchema.parse(request.params ?? {});
    const query = opcUaDeleteDriverQuerySchema.parse(request.query ?? {});
    const project = deps.projectService.getProject();
    const driver = project.drivers.find((item) => item.id === params.driverId);
    if (!driver) {
      return reply.code(404).send({ ok: false, message: `Driver ${params.driverId} not found` });
    }
    if (driver.type !== "opcua") {
      return reply.code(400).send({ ok: false, message: `Driver ${params.driverId} is not OPC UA` });
    }

    const tagsByDriver = getTagsByDriver(project, params.driverId);
    if (tagsByDriver.count > 0 && !query.deleteTags) {
      return reply.code(409).send({
        ok: false,
        reason: "driver_has_tags",
        tagCount: tagsByDriver.count,
        message: "Driver has linked tags. Delete tags first or use deleteTags=true.",
      });
    }

    const driverId = params.driverId;
    const nextDrivers = project.drivers.filter((item) => item.id !== driverId);
    const macroUpdate = query.deleteTags
      ? markMacrosInvalidForDeletedTags(project.macros, tagsByDriver.tagNames)
      : { macros: project.macros ?? [], affectedMacros: [] };
    const nextTags = query.deleteTags
      ? project.tags.filter((tag) => !(tag.sourceType === "opcua" && tag.driverId === driverId))
      : project.tags;
    const nextProject: ScadaProject = {
      ...project,
      drivers: nextDrivers,
      tags: nextTags,
      macros: macroUpdate.macros,
    };
    await persistProjectUpdate(deps, nextProject);

    return reply.send({
      ok: true,
      deletedDriverId: driverId,
      deletedTags: query.deleteTags ? tagsByDriver.count : 0,
      affectedMacros: macroUpdate.affectedMacros,
    });
  });

  app.post("/api/drivers/opcua/browse", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "drivers.view");
    if (!auth) {
      return;
    }
    const payload = opcUaBrowseSchema.parse(request.body ?? {});
    const project = deps.projectService.getProject();
    try {
      const config = resolveOpcUaConfigFromPayload(project, payload);
      const nodeId = payload.nodeId?.trim() || "RootFolder";
      const nodes = await withOpcUaSession(config, async (session) => browseOpcUaNode(session, nodeId, payload.search));
      return reply.send({ ok: true, nodeId, nodes });
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/drivers/opcua/read", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "drivers.view");
    if (!auth) {
      return;
    }
    const payload = opcUaReadSchema.parse(request.body ?? {});
    const project = deps.projectService.getProject();
    try {
      const config = resolveOpcUaConfigFromPayload(project, payload);
      const result = await withOpcUaSession(config, async (session) => readOpcUaNode(session, payload.nodeId));
      return reply.send({ ok: true, nodeId: payload.nodeId, ...result });
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/drivers/opcua/import-tags", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    const payload = opcUaImportSchema.parse(request.body ?? {});
    const project = deps.projectService.getProject();
    const driver = project.drivers.find((item) => item.id === payload.driverId);
    if (!driver || driver.type !== "opcua") {
      return reply.code(400).send({ ok: false, message: `OPC UA driver ${payload.driverId} not found` });
    }

    const existingByName = new Map(project.tags.map((tag) => [tag.name, tag]));
    const overwrite = payload.overwrite ?? false;
    let created = 0;
    let updated = 0;
    const nextTags = [...project.tags];

    for (const item of payload.items) {
      const nextTag = {
        ...existingByName.get(item.name),
        name: item.name,
        sourceType: "opcua" as const,
        dataType: opcUaDataTypeToTagDataType(item.dataTypeNodeId),
        driverId: payload.driverId,
        nodeId: item.nodeId,
        address: { nodeId: item.nodeId },
        writable: item.writable ?? existingByName.get(item.name)?.writable ?? false,
        scanRateMs: item.scanRateMs ?? existingByName.get(item.name)?.scanRateMs ?? 500,
      };
      const existingIndex = nextTags.findIndex((tag) => tag.name === item.name);
      if (existingIndex >= 0) {
        if (!overwrite) {
          continue;
        }
        nextTags[existingIndex] = nextTag;
        updated += 1;
      } else {
        nextTags.push(nextTag);
        created += 1;
      }
    }

    const nextProject: ScadaProject = {
      ...project,
      tags: nextTags,
    };
    await persistProjectUpdate(deps, nextProject);
    return reply.send({ ok: true, created, updated, total: payload.items.length });
  });

  app.post("/api/drivers/opcua/import-subtree", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    const payload = opcUaImportSubtreeSchema.parse(request.body ?? {});
    const project = deps.projectService.getProject();
    const driver = project.drivers.find((item) => item.id === payload.driverId);
    if (!driver || driver.type !== "opcua") {
      return reply.code(400).send({ ok: false, message: `OPC UA driver ${payload.driverId} not found` });
    }

    const discovered = await withOpcUaSession(driver, async (session) =>
      collectOpcUaSubtreeVariables(session, payload.nodeId, payload.rootName, payload.maxNodes ?? 20_000),
    );

    if (discovered.candidates.length === 0) {
      return reply.send({ ok: true, created: 0, updated: 0, total: 0, scanned: discovered.scannedNodes });
    }

    const existingByName = new Map(project.tags.map((tag) => [tag.name, tag]));
    const overwrite = payload.overwrite ?? false;
    let created = 0;
    let updated = 0;
    const nextTags = [...project.tags];

    for (const item of discovered.candidates) {
      const tagNameBase = item.browsePath;
      let tagName = tagNameBase;
      if (!overwrite) {
        let suffix = 2;
        while (existingByName.has(tagName) || nextTags.some((tag) => tag.name === tagName)) {
          tagName = `${tagNameBase}_${suffix}`;
          suffix += 1;
        }
      }
      const prevTag = existingByName.get(tagName);
      const nextTag = {
        ...prevTag,
        name: tagName,
        sourceType: "opcua" as const,
        dataType: opcUaDataTypeToTagDataType(item.dataType),
        driverId: payload.driverId,
        nodeId: item.nodeId,
        address: { nodeId: item.nodeId },
        writable: item.writable ?? prevTag?.writable ?? false,
        scanRateMs: payload.scanRateMs ?? prevTag?.scanRateMs ?? 500,
      };
      const existingIndex = nextTags.findIndex((tag) => tag.name === tagName);
      if (existingIndex >= 0) {
        if (!overwrite) {
          continue;
        }
        nextTags[existingIndex] = nextTag;
        updated += 1;
      } else {
        nextTags.push(nextTag);
        created += 1;
      }
    }

    const nextProject: ScadaProject = {
      ...project,
      tags: nextTags,
    };
    await persistProjectUpdate(deps, nextProject);

    return reply.send({
      ok: true,
      created,
      updated,
      total: created + updated,
      scanned: discovered.scannedNodes,
    });
  });

  app.get("/api/drivers", async () => deps.driverManager.getStatuses());

  app.post("/api/runtime/start", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "runtime.control");
    if (!auth) {
      return;
    }
    const project = deps.projectService.getProject();
    await deps.runtimeService.start(project);
    return deps.runtimeService.getState();
  });

  app.post("/api/runtime/stop", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "runtime.control");
    if (!auth) {
      return;
    }
    await deps.runtimeService.stop();
    return deps.runtimeService.getState();
  });

  app.get("/api/runtime/status", async () => deps.runtimeService.getStatus());
  app.get("/api/runtime/state", async () => deps.runtimeService.getStatus());

  app.post("/api/assets/upload", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "assets.write");
    if (!auth) {
      return;
    }
    const uploaded = await parseUpload(request);
    const asset = await deps.assetService.uploadProjectAsset(uploaded);
    return reply.send(asset);
  });

  app.get("/api/assets", async () => deps.assetService.listProjectAssets());

  app.get("/api/assets/:assetId", async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const asset = deps.assetService.getProjectAsset(assetId);
    if (!asset) {
      return reply.code(404).send({ message: "Asset not found" });
    }
    return asset;
  });

  app.patch("/api/assets/:assetId", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "assets.write");
    if (!auth) {
      return;
    }
    const { assetId } = request.params as { assetId: string };
    const payload = updateAssetSchema.parse(request.body ?? {});
    if (payload.name === undefined && payload.folderPath === undefined) {
      return reply.code(400).send({ message: "Asset patch is empty" });
    }
    try {
      const updated = await deps.assetService.updateProjectAsset(assetId, payload);
      return reply.send(updated);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes("not found")) {
        return reply.code(404).send({ error: "Not Found", message: msg });
      }
      return reply.code(400).send({ error: "Bad Request", message: msg });
    }
  });

  app.get("/api/assets/:assetId/file", async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const asset = deps.assetService.getProjectAsset(assetId);
    if (!asset) {
      return reply.code(404).send({ message: "Asset not found" });
    }
    const projectDir = path.dirname(deps.projectService.getProjectFile());
    const file = path.join(projectDir, asset.storagePath);
    const bytes = await readFile(file);
    reply.header("Content-Type", asset.mimeType);
    return reply.send(bytes);
  });

  app.delete("/api/assets/:assetId", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "assets.delete");
    if (!auth) {
      return;
    }
    const { assetId } = request.params as { assetId: string };
    try {
      const result = await deps.assetService.deleteProjectAsset(assetId);
      return reply.send({ ok: true, used: result.used });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("not found")) {
        return reply.code(404).send({ error: "Not Found", message: msg });
      }
      throw error;
    }
  });

  app.get("/api/libraries", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "libraries.view");
    if (!auth) {
      return;
    }
    return deps.libraryService.listLibraries();
  });

  app.get("/api/libraries/:libraryId", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "libraries.view");
    if (!auth) {
      return;
    }
    const { libraryId } = request.params as { libraryId: string };
    const library = await deps.libraryService.getLibrary(libraryId);
    if (!library) {
      return reply.code(404).send({ message: "Library not found" });
    }
    return library;
  });

  app.get("/api/libraries/:libraryId/elements", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "libraries.view");
    if (!auth) {
      return;
    }
    const { libraryId } = request.params as { libraryId: string };
    const library = await deps.libraryService.getLibrary(libraryId);
    if (!library) {
      return reply.code(404).send({ message: "Library not found" });
    }
    return library.elements;
  });

  app.get("/api/libraries/:libraryId/elements/:elementId", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "libraries.view");
    if (!auth) {
      return;
    }
    const { libraryId, elementId } = request.params as { libraryId: string; elementId: string };
    const library = await deps.libraryService.getLibrary(libraryId);
    if (!library) {
      return reply.code(404).send({ message: "Library not found" });
    }
    const element = library.elements.find((item) => item.id === elementId);
    if (!element) {
      return reply.code(404).send({ message: "Element not found" });
    }
    return element;
  });

  app.get("/api/libraries/:libraryId/elements/:elementId/usage", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "elements.view");
    if (!auth) {
      return;
    }
    const { libraryId, elementId } = request.params as { libraryId: string; elementId: string };
    const project = deps.projectService.getProject();
    const usage = findLibraryElementUsages(project, libraryId, elementId);
    return reply.send({ items: usage });
  });

  app.post("/api/libraries", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "libraries.write");
    if (!auth) {
      return;
    }
    const payload = createLibrarySchema.parse(request.body);
    const library = await deps.libraryService.createLibrary(payload);
    return reply.send(library);
  });

  app.post("/api/libraries/import/validate", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "libraries.write");
    if (!auth) {
      return;
    }
    const uploaded = await parseUpload(request);
    const result = await deps.libraryService.validateLibraryArchive(uploaded);
    return reply.send({ ok: true, ...result });
  });

  app.post("/api/libraries/import", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "libraries.write");
    if (!auth) {
      return;
    }
    const uploaded = await parseUpload(request);
    const optionsRaw = (uploaded as unknown as { options?: string }).options;
    let options: z.infer<typeof libraryImportOptionsSchema> = {};
    if (typeof optionsRaw === "string" && optionsRaw.trim()) {
      try {
        options = libraryImportOptionsSchema.parse(JSON.parse(optionsRaw));
      } catch {
        return reply.code(400).send({ error: "Bad Request", message: "Invalid import options" });
      }
    } else {
      const body = request.body as Record<string, unknown> | undefined;
      if (body) {
        options = libraryImportOptionsSchema.parse(body);
      }
    }
    try {
      const library = await deps.libraryService.importLibraryArchive(uploaded, options);
      return reply.send({ ok: true, library });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("already exists") || message.toLowerCase().includes("conflict")) {
        return reply.code(409).send({ error: "Conflict", message });
      }
      return reply.code(400).send({ error: "Bad Request", message });
    }
  });

  app.post("/api/libraries/:libraryId/assets/upload", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "assets.write");
    if (!auth) {
      return;
    }
    const { libraryId } = request.params as { libraryId: string };
    const uploaded = await parseUpload(request);
    const asset = await deps.libraryService.uploadLibraryAsset(libraryId, uploaded);
    return reply.send(asset);
  });

  app.get("/api/libraries/:libraryId/export", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "libraries.view");
    if (!auth) {
      return;
    }
    const { libraryId } = request.params as { libraryId: string };
    try {
      const exported = await deps.libraryService.exportLibraryArchive(libraryId);
      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", `attachment; filename=\"${exported.fileName}\"`);
      return reply.send(exported.buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("not found")) {
        return reply.code(404).send({ error: "Not Found", message });
      }
      return reply.code(400).send({ error: "Bad Request", message });
    }
  });

  app.patch("/api/libraries/:libraryId", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "libraries.write");
    if (!auth) {
      return;
    }
    const { libraryId } = request.params as { libraryId: string };
    const payload = updateLibrarySchema.parse(request.body ?? {});
    if (payload.name === undefined && payload.description === undefined && payload.version === undefined) {
      return reply.code(400).send({ error: "Bad Request", message: "Library patch is empty" });
    }
    try {
      const updated = await deps.libraryService.updateLibrary(libraryId, payload);
      return reply.send(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("not found")) {
        return reply.code(404).send({ error: "Not Found", message });
      }
      return reply.code(400).send({ error: "Bad Request", message });
    }
  });

  app.delete("/api/libraries/:libraryId", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "libraries.delete");
    if (!auth) {
      return;
    }
    const { libraryId } = request.params as { libraryId: string };
    const { force } = (request.query ?? {}) as { force?: string };
    try {
      const result = await deps.libraryService.deleteLibrary(libraryId, {
        force: String(force).toLowerCase() === "true",
      });
      return reply.send({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("not found")) {
        return reply.code(404).send({ error: "Not Found", message });
      }
      if (message.toLowerCase().includes("used") || message.toLowerCase().includes("attached")) {
        return reply.code(409).send({ error: "Conflict", message });
      }
      return reply.code(400).send({ error: "Bad Request", message });
    }
  });

  app.get("/api/libraries/:libraryId/assets/:assetId/file", async (request, reply) => {
    const { libraryId, assetId } = request.params as { libraryId: string; assetId: string };
    const asset = await deps.libraryService.getLibraryAsset(libraryId, assetId);
    if (!asset) {
      return reply.code(404).send({ message: "Asset not found" });
    }
    const library = await deps.libraryService.getLibrary(libraryId);
    if (!library) {
      return reply.code(404).send({ message: "Library not found" });
    }
    const root = path.dirname(deps.libraryService.libraryFilePath(library.id));
    const bytes = await readFile(path.join(root, asset.storagePath));
    reply.header("Content-Type", asset.mimeType);
    return reply.send(bytes);
  });

  app.post("/api/libraries/:libraryId/elements", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "elements.write");
    if (!auth) {
      return;
    }
    const { libraryId } = request.params as { libraryId: string };
    const payload = libraryElementSchema.parse(request.body);
    const created = await deps.libraryService.createElement(libraryId, payload);
    return reply.send(created);
  });

  app.put("/api/libraries/:libraryId/elements/:elementId", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "elements.write");
    if (!auth) {
      return;
    }
    const { libraryId, elementId } = request.params as { libraryId: string; elementId: string };
    const payload = request.body as Partial<z.infer<typeof libraryElementSchema>>;
    const updated = await deps.libraryService.updateElement(libraryId, elementId, payload);
    return reply.send(updated);
  });

  app.delete("/api/libraries/:libraryId/elements/:elementId", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "elements.delete");
    if (!auth) {
      return;
    }
    const { libraryId, elementId } = request.params as { libraryId: string; elementId: string };
    const { force } = (request.query ?? {}) as { force?: string };
    const forceDelete = String(force).toLowerCase() === "true";
    app.log.info(
      {
        userId: auth.userId,
        libraryId,
        elementId,
        forceDelete,
        params: request.params,
      },
      "[API] DELETE library element request",
    );
    const project = deps.projectService.getProject();
    const usage = findLibraryElementUsages(project, libraryId, elementId);
    if (usage.length > 0) {
      if (forceDelete) {
        const pruned = removeLibraryElementInstances(project, libraryId, elementId);
        await deps.projectService.saveProject(pruned.project);
        app.log.warn(
          { libraryId, elementId, usageCount: usage.length, removedUsages: pruned.removed },
          "[API] DELETE library element force-pruned instances from project",
        );
      } else {
        app.log.warn(
          { libraryId, elementId, usageCount: usage.length },
          "[API] DELETE library element failed: used in screens",
        );
        return reply.code(409).send({
          error: "Element is used",
          usage,
        });
      }
    }
    const library = await deps.libraryService.getLibrary(libraryId);
    if (!library) {
      app.log.error({ libraryId, elementId }, "[API] DELETE library element failed");
      return reply.code(404).send({ error: "Not Found", message: "Library not found" });
    }
    const element = library.elements.find((item) => item.id === elementId);
    if (!element) {
      app.log.warn(
        { libraryId, elementId },
        "[API] DELETE library element failed: not found",
      );
      return reply.code(404).send({ error: "Not Found", message: "Element not found" });
    }
    app.log.info({ element }, "[API] DELETE library element found");
    try {
      await deps.libraryService.deleteElement(libraryId, elementId);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (text.toLowerCase().includes("not found")) {
        app.log.error({ error, libraryId, elementId }, "[API] DELETE library element failed");
        return reply.code(404).send({ error: "Not Found", message: text });
      }
      app.log.error({ error, libraryId, elementId }, "[API] DELETE library element failed");
      throw error;
    }
    app.log.info({ elementId }, "[API] DELETE library element deleted");
    return reply.send({ ok: true, deletedId: elementId, removedUsages: usage.length && forceDelete ? usage.length : 0 });
  });

  app.post("/api/libraries/:libraryId/macros", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "macros.write");
    if (!auth) {
      return;
    }
    const { libraryId } = request.params as { libraryId: string };
    const payload = libraryMacroSchema.parse(request.body);
    try {
      const created = await deps.libraryService.createLibraryMacro(libraryId, payload as MacroDefinition);
      return reply.send(created);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("not found")) {
        return reply.code(404).send({ error: "Not Found", message });
      }
      if (message.toLowerCase().includes("already exists")) {
        return reply.code(409).send({ error: "Conflict", message });
      }
      return reply.code(400).send({ error: "Bad Request", message });
    }
  });

  app.put("/api/libraries/:libraryId/macros/:macroId", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "macros.write");
    if (!auth) {
      return;
    }
    const { libraryId, macroId } = request.params as { libraryId: string; macroId: string };
    const payload = request.body as Partial<MacroDefinition>;
    try {
      const updated = await deps.libraryService.updateLibraryMacro(libraryId, macroId, payload);
      return reply.send(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("not found")) {
        return reply.code(404).send({ error: "Not Found", message });
      }
      return reply.code(400).send({ error: "Bad Request", message });
    }
  });

  app.delete("/api/libraries/:libraryId/macros/:macroId", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "macros.write");
    if (!auth) {
      return;
    }
    const { libraryId, macroId } = request.params as { libraryId: string; macroId: string };
    const { force } = (request.query ?? {}) as { force?: string };
    try {
      await deps.libraryService.deleteLibraryMacro(libraryId, macroId, {
        force: String(force).toLowerCase() === "true",
      });
      return reply.send({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("not found")) {
        return reply.code(404).send({ error: "Not Found", message });
      }
      if (message.toLowerCase().includes("referenced")) {
        return reply.code(409).send({ error: "Conflict", message });
      }
      return reply.code(400).send({ error: "Bad Request", message });
    }
  });

  app.post("/api/libraries/:libraryId/macros/:macroId/import-to-project", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "macros.write");
    if (!auth) {
      return;
    }
    const { libraryId, macroId } = request.params as { libraryId: string; macroId: string };
    const payload = z.object({ overwrite: z.boolean().optional(), importAsCopy: z.boolean().optional() }).parse(request.body ?? {});
    try {
      const macro = await deps.libraryService.importLibraryMacroToProject(libraryId, macroId, payload);
      return reply.send({ ok: true, macro });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("not found")) {
        return reply.code(404).send({ error: "Not Found", message });
      }
      if (message.toLowerCase().includes("already exists")) {
        return reply.code(409).send({ error: "Conflict", message });
      }
      return reply.code(400).send({ error: "Bad Request", message });
    }
  });

  app.post("/api/libraries/:libraryId/import-macros-to-project", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "macros.write");
    if (!auth) {
      return;
    }
    const { libraryId } = request.params as { libraryId: string };
    const payload = z.object({ overwrite: z.boolean().optional(), importAsCopy: z.boolean().optional() }).parse(request.body ?? {});
    try {
      const result = await deps.libraryService.importLibraryMacrosToProject(libraryId, payload);
      return reply.send({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("not found")) {
        return reply.code(404).send({ error: "Not Found", message });
      }
      return reply.code(400).send({ error: "Bad Request", message });
    }
  });

  app.post("/api/project/libraries/attach", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "libraries.write");
    if (!auth) {
      return;
    }
    const payload = attachLibrarySchema.parse(request.body);
    const project = await deps.libraryService.attachLibraryToProject(payload.libraryId);
    return reply.send(project);
  });

  app.post("/api/project/libraries/detach", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "libraries.write");
    if (!auth) {
      return;
    }
    const payload = attachLibrarySchema.parse(request.body);
    const project = await deps.libraryService.detachLibraryFromProject(payload.libraryId);
    return reply.send(project);
  });
}
