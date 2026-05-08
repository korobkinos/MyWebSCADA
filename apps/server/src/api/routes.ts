import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  type AdminChangePasswordRequest,
  type AppPermission,
  type AuthLoginRequest,
  type ChangeOwnPasswordRequest,
  type CreateUserRequest,
  type MacroDefinition,
  type MacroTrigger,
  type ScadaProject,
  type UpdateUserRequest,
  libraryElementSchema,
  projectSchema,
} from "@web-scada/shared";
import { z } from "zod";
import { AuthService } from "../auth/auth-service.js";
import { AssetService } from "../assets/asset-service.js";
import { DriverManager } from "../drivers/driver-manager.js";
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
  newPassword: z.string().min(4),
});
const adminChangePasswordSchema: z.ZodType<AdminChangePasswordRequest> = z.object({
  newPassword: z.string().min(4),
});
const createUserSchema: z.ZodType<CreateUserRequest> = z.object({
  username: z.string().min(1),
  displayName: z.string().optional(),
  password: z.string().min(4),
  roles: z.array(z.enum(["admin", "engineer", "operator", "viewer"])).optional(),
  permissions: z.array(permissionSchema).optional(),
  enabled: z.boolean().optional(),
});
const updateUserSchema: z.ZodType<UpdateUserRequest> = z.object({
  displayName: z.string().optional(),
  roles: z.array(z.enum(["admin", "engineer", "operator", "viewer"])).optional(),
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
  language: z.enum(["ts", "javascript-lite", "expression", "blockly"]),
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

type AuthContext = {
  userId: string;
  permissions: Set<AppPermission>;
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
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const content = Buffer.concat(chunks);
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
    const payload = changeOwnPasswordSchema.parse(request.body);
    await deps.authService.changeOwnPassword(auth.userId, payload.oldPassword, payload.newPassword);
    return reply.send({ ok: true });
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
    const payload = createUserSchema.parse(request.body);
    const created = await deps.authService.createUser(payload);
    return reply.send(created);
  });

  app.put("/api/users/:id", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "users.write");
    if (!auth) {
      return;
    }
    const { id } = request.params as { id: string };
    const payload = updateUserSchema.parse(request.body);
    const updated = await deps.authService.updateUser(id, payload);
    return reply.send(updated);
  });

  app.delete("/api/users/:id", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "users.delete");
    if (!auth) {
      return;
    }
    const { id } = request.params as { id: string };
    await deps.authService.deleteUser(id);
    return reply.send({ ok: true });
  });

  app.post("/api/users/:id/change-password", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "users.changePassword");
    if (!auth) {
      return;
    }
    const { id } = request.params as { id: string };
    const payload = adminChangePasswordSchema.parse(request.body);
    await deps.authService.changePasswordByAdmin(id, payload);
    return reply.send({ ok: true });
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
    const result = await deps.macroService.run(params.id, payload.args, {
      allowDisabledForTest: payload.allowDisabledForTest,
      context: payload.context,
    });
    return reply.send({ ok: true, ...result });
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
    await deps.assetService.deleteProjectAsset(assetId);
    return reply.send({ ok: true });
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
