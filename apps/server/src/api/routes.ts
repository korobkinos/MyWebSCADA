import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { libraryElementSchema, projectSchema } from "@web-scada/shared";
import { AssetService } from "../assets/asset-service.js";
import { DriverManager } from "../drivers/driver-manager.js";
import { LibraryService } from "../libraries/library-service.js";
import { ProjectService } from "../project/project-service.js";
import { CommandService } from "../runtime/command-service.js";
import { EngineerAuthService } from "../runtime/engineer-auth-service.js";
import { InternalVariableService } from "../runtime/internal-variable-service.js";
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
  engineerAuthService: EngineerAuthService;
};

const writeSchema = z.object({ value: z.union([z.boolean(), z.number(), z.string(), z.null()]) });
const engineerLoginSchema = z.object({ password: z.string().min(1) });
const macroRunSchema = z.object({ args: z.record(z.unknown()).optional() });
const createLibrarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),
});
const attachLibrarySchema = z.object({ libraryId: z.string().min(1) });

function tokenFromRequest(request: { headers: Record<string, unknown> }): string | undefined {
  const header = request.headers["x-engineer-token"];
  return typeof header === "string" ? header : undefined;
}

function ensureEngineer(request: { headers: Record<string, unknown> }, deps: ApiDeps): void {
  const token = tokenFromRequest(request);
  if (!deps.engineerAuthService.verify(token)) {
    throw new Error("Engineer authentication required");
  }
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

export async function registerApiRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  app.get("/", async () => ({
    service: "web-scada-server",
    status: "ok",
    apiRoot: "/api",
  }));

  app.post("/api/auth/engineer", async (request, reply) => {
    const payload = engineerLoginSchema.parse(request.body);
    const result = deps.engineerAuthService.login(payload.password);
    if (!result.ok) {
      return reply.code(401).send({ ok: false, message: "Invalid password" });
    }
    return result;
  });

  app.get("/api/project", async () => deps.projectService.getProject());

  app.post("/api/project", async (request, reply) => {
    try {
      ensureEngineer(request as { headers: Record<string, unknown> }, deps);
    } catch {
      return reply.code(401).send({ message: "Engineer auth required" });
    }

    const parsed = projectSchema.parse(request.body);
    const saved = await deps.projectService.saveProject(parsed);

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
    const params = request.params as { name: string };
    const payload = writeSchema.parse(request.body);
    await deps.commandService.writeTag(params.name, payload.value);
    return reply.send({ ok: true });
  });

  app.get("/api/variables", async () => deps.internalVariableService.getAll());

  app.post("/api/variables/:name/write", async (request, reply) => {
    const params = request.params as { name: string };
    const payload = writeSchema.parse(request.body);
    await deps.commandService.writeVariable(params.name, payload.value);
    return reply.send({ ok: true });
  });

  app.get("/api/macros", async () => deps.macroService.list());

  app.post("/api/macros/:id/run", async (request, reply) => {
    const params = request.params as { id: string };
    const payload = macroRunSchema.parse(request.body ?? {});
    await deps.macroService.run(params.id, payload.args);
    return reply.send({ ok: true });
  });

  app.get("/api/drivers", async () => deps.driverManager.getStatuses());

  app.post("/api/runtime/start", async () => {
    const project = deps.projectService.getProject();
    await deps.runtimeService.start(project);
    return deps.runtimeService.getState();
  });

  app.post("/api/runtime/stop", async () => {
    await deps.runtimeService.stop();
    return deps.runtimeService.getState();
  });

  app.get("/api/runtime/state", async () => deps.runtimeService.getState());

  app.post("/api/assets/upload", async (request, reply) => {
    try {
      ensureEngineer(request as { headers: Record<string, unknown> }, deps);
    } catch {
      return reply.code(401).send({ message: "Engineer auth required" });
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
    try {
      ensureEngineer(request as { headers: Record<string, unknown> }, deps);
    } catch {
      return reply.code(401).send({ message: "Engineer auth required" });
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

  app.post("/api/libraries", async (request, reply) => {
    try {
      ensureEngineer(request as { headers: Record<string, unknown> }, deps);
    } catch {
      return reply.code(401).send({ message: "Engineer auth required" });
    }
    const payload = createLibrarySchema.parse(request.body);
    const library = await deps.libraryService.createLibrary(payload);
    return reply.send(library);
  });

  app.post("/api/libraries/:libraryId/assets/upload", async (request, reply) => {
    try {
      ensureEngineer(request as { headers: Record<string, unknown> }, deps);
    } catch {
      return reply.code(401).send({ message: "Engineer auth required" });
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
    try {
      ensureEngineer(request as { headers: Record<string, unknown> }, deps);
    } catch {
      return reply.code(401).send({ message: "Engineer auth required" });
    }
    const { libraryId } = request.params as { libraryId: string };
    const payload = libraryElementSchema.parse(request.body);
    const created = await deps.libraryService.createElement(libraryId, payload);
    return reply.send(created);
  });

  app.put("/api/libraries/:libraryId/elements/:elementId", async (request, reply) => {
    try {
      ensureEngineer(request as { headers: Record<string, unknown> }, deps);
    } catch {
      return reply.code(401).send({ message: "Engineer auth required" });
    }
    const { libraryId, elementId } = request.params as { libraryId: string; elementId: string };
    const payload = request.body as Partial<z.infer<typeof libraryElementSchema>>;
    const updated = await deps.libraryService.updateElement(libraryId, elementId, payload);
    return reply.send(updated);
  });

  app.delete("/api/libraries/:libraryId/elements/:elementId", async (request, reply) => {
    try {
      ensureEngineer(request as { headers: Record<string, unknown> }, deps);
    } catch {
      return reply.code(401).send({ message: "Engineer auth required" });
    }
    const { libraryId, elementId } = request.params as { libraryId: string; elementId: string };
    await deps.libraryService.deleteElement(libraryId, elementId);
    return reply.send({ ok: true });
  });

  app.post("/api/project/libraries/attach", async (request, reply) => {
    try {
      ensureEngineer(request as { headers: Record<string, unknown> }, deps);
    } catch {
      return reply.code(401).send({ message: "Engineer auth required" });
    }
    const payload = attachLibrarySchema.parse(request.body);
    const project = await deps.libraryService.attachLibraryToProject(payload.libraryId);
    return reply.send(project);
  });

  app.post("/api/project/libraries/detach", async (request, reply) => {
    try {
      ensureEngineer(request as { headers: Record<string, unknown> }, deps);
    } catch {
      return reply.code(401).send({ message: "Engineer auth required" });
    }
    const payload = attachLibrarySchema.parse(request.body);
    const project = await deps.libraryService.detachLibraryFromProject(payload.libraryId);
    return reply.send(project);
  });
}
