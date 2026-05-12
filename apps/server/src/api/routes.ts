import { readFile } from "node:fs/promises";
import path from "node:path";
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
};

type LibraryElementUsage = {
  screenId: string;
  screenName: string;
  objectId: string;
  objectName?: string;
  path: string;
};

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

const writeSchema = z.object({ value: z.union([z.boolean(), z.number(), z.string(), z.null()]) });
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
const attachLibrarySchema = z.object({ libraryId: z.string().min(1) });
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
  const token = tokenFromRequest(request as { headers: Record<string, unknown> });
  const user = await deps.authService.getUserByToken(token);
  if (!user) {
    await reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
    return null;
  }
  return {
    userId: user.id,
    permissions: new Set(user.permissions),
    roleLevel: getUserRoleLevel(user),
  };
}

async function requirePermission(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: ApiDeps,
  permission: AppPermission,
): Promise<AuthContext | null> {
  const auth = await requireAuth(request, reply, deps);
  if (!auth) {
    return null;
  }
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

async function persistProjectUpdate(deps: ApiDeps, nextProject: ScadaProject): Promise<ScadaProject> {
  const saved = await deps.projectService.saveProject(nextProject);
  const variableDefinitions = buildInternalAndLwTagDefinitions(saved.variables ?? [], saved.lwStore);
  deps.tagStore.setDefinitions([...(saved.tags ?? []), ...variableDefinitions]);
  deps.internalVariableService.setup(saved.variables ?? [], saved.lwStore);
  deps.macroService.configure(saved);

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
  const name = typeof namePart?.value === "string" ? namePart.value : undefined;
  return {
    fileName: part.filename,
    mimeType: part.mimetype,
    size: content.byteLength,
    content,
    name,
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
    const saved = await deps.projectService.saveProject(parsed);
    const variableDefinitions = buildInternalAndLwTagDefinitions(saved.variables ?? [], saved.lwStore);
    deps.tagStore.setDefinitions([...(saved.tags ?? []), ...variableDefinitions]);
    deps.internalVariableService.setup(saved.variables ?? [], saved.lwStore);
    deps.macroService.configure(saved);

    if (deps.runtimeService.getState().running) {
      await deps.runtimeService.stop();
      await deps.runtimeService.start(saved);
    }

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
    await deps.commandService.writeTag(params.name, payload.value);
    return reply.send({ ok: true });
  });

  app.get("/api/variables", async () => deps.internalVariableService.getAll());

  app.post("/api/variables/:name/write", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    const params = request.params as { name: string };
    const payload = writeSchema.parse(request.body);
    await deps.commandService.writeVariable(params.name, payload.value);
    return reply.send({ ok: true });
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
    const updatedMacro: MacroDefinition = {
      id: existing.id,
      name: payload.name,
      description: payload.description ?? existing.description,
      enabled: payload.enabled,
      language: payload.language,
      code: payload.code,
      triggers: (payload.triggers ?? existing.triggers ?? []) as MacroTrigger[],
    };

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
    const payload = macroRunSchema.parse(request.body ?? {});
    const startedAt = Date.now();
    try {
      const result = await deps.macroService.runManual(params.id, payload.args, {
        allowDisabledForTest: payload.allowDisabledForTest,
        context: payload.context,
      });
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
      return reply.send({
        ok: true,
        status: result.status,
        reason: result.reason,
        effects: result.effects,
      });
    } catch (error) {
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
    if (targetId) {
      const existing = project.drivers.find((driver) => driver.id === targetId);
      if (existing && existing.type !== "opcua") {
        return reply.code(400).send({ ok: false, message: `Driver ${targetId} is not OPC UA` });
      }
    }
    const nextConfig: OpcUaDriverConfig = {
      ...payload.config,
      id: targetId || payload.config.id,
      type: "opcua",
      enabled: payload.config.enabled ?? true,
    };
    const nextProject = withUpdatedDriver(project, nextConfig, targetId);
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
    try {
      const config = resolveOpcUaConfigFromPayload(project, payload);
      const status = await deps.driverManager.connectDriver({
        ...config,
        type: "opcua",
        enabled: true,
      });
      return reply.send({ ok: true, status });
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
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
      const status = await deps.driverManager.disconnectDriver(payload.driverId);
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
    const saved = await deps.projectService.saveProject(nextProject);
    const variableDefinitions = buildInternalAndLwTagDefinitions(saved.variables ?? [], saved.lwStore);
    deps.tagStore.setDefinitions([...(saved.tags ?? []), ...variableDefinitions]);
    deps.internalVariableService.setup(saved.variables ?? [], saved.lwStore);
    deps.macroService.configure(saved);
    if (deps.runtimeService.getState().running) {
      await deps.runtimeService.stop();
      await deps.runtimeService.start(saved);
    }
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

    if (discovered.length === 0) {
      return reply.send({ ok: true, created: 0, updated: 0, total: 0, scanned: 0 });
    }

    const existingByName = new Map(project.tags.map((tag) => [tag.name, tag]));
    const overwrite = payload.overwrite ?? false;
    let created = 0;
    let updated = 0;
    const nextTags = [...project.tags];

    for (const item of discovered) {
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
    const saved = await deps.projectService.saveProject(nextProject);
    const variableDefinitions = buildInternalAndLwTagDefinitions(saved.variables ?? [], saved.lwStore);
    deps.tagStore.setDefinitions([...(saved.tags ?? []), ...variableDefinitions]);
    deps.internalVariableService.setup(saved.variables ?? [], saved.lwStore);
    deps.macroService.configure(saved);
    if (deps.runtimeService.getState().running) {
      await deps.runtimeService.stop();
      await deps.runtimeService.start(saved);
    }

    return reply.send({
      ok: true,
      created,
      updated,
      total: created + updated,
      scanned: discovered.length,
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

  app.get("/api/runtime/state", async () => deps.runtimeService.getState());

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

  app.get("/api/libraries", async () => deps.libraryService.listLibraries());

  app.get("/api/libraries/:libraryId", async (request, reply) => {
    const { libraryId } = request.params as { libraryId: string };
    const library = await deps.libraryService.getLibrary(libraryId);
    if (!library) {
      return reply.code(404).send({ message: "Library not found" });
    }
    return library;
  });

  app.get("/api/libraries/:libraryId/elements", async (request, reply) => {
    const { libraryId } = request.params as { libraryId: string };
    const library = await deps.libraryService.getLibrary(libraryId);
    if (!library) {
      return reply.code(404).send({ message: "Library not found" });
    }
    return library.elements;
  });

  app.get("/api/libraries/:libraryId/elements/:elementId", async (request, reply) => {
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
