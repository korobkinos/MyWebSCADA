import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerApiRoutes } from "./api/routes.js";
import { configureArchiveEnvironment } from "./archive/archive-dev-database.js";
import { ArchiveService } from "./archive/archive-service.js";
import { AuthService } from "./auth/auth-service.js";
import { AssetService } from "./assets/asset-service.js";
import { DriverManager } from "./drivers/driver-manager.js";
import { EventSoundService } from "./events/event-sound-service.js";
import { EventEngine } from "./events/event-engine.js";
import { LibraryService } from "./libraries/library-service.js";
import { ProjectArchiveService } from "./project/project-archive-service.js";
import { ProjectService } from "./project/project-service.js";
import { CommandService } from "./runtime/command-service.js";
import { buildInternalAndLwTagDefinitions, InternalVariableService } from "./runtime/internal-variable-service.js";
import { MacroService } from "./runtime/macro-service.js";
import { RuntimeService } from "./runtime/runtime-service.js";
import { TagStore } from "./tags/tag-store.js";
import { WebSocketGateway } from "./websocket/websocket-gateway.js";
import { type OperatorActionArchiveSettings } from "@web-scada/shared";

const port = Number(process.env.PORT ?? 3001);
const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(runtimeDir, "..");

function resolveServerPath(value: string | undefined, fallbackRelativeToServerRoot: string): string {
  const target = value ?? fallbackRelativeToServerRoot;
  if (path.isAbsolute(target)) {
    return target;
  }
  return path.resolve(serverRoot, target);
}

const projectFile = resolveServerPath(process.env.PROJECT_FILE, "../../projects/demo-project.json");
const librariesRoot = resolveServerPath(process.env.LIBRARIES_DIR, "../../libraries");
const authDbFile = resolveServerPath(process.env.AUTH_DB_FILE, "../../data/auth-db.json");
const legacyUsersFile = resolveServerPath(process.env.USERS_FILE, "../../data/users.json");
const eventSoundsDir = resolveServerPath(process.env.EVENT_SOUNDS_DIR, "../../data/event-sounds");
const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME ?? "admin";
const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD ?? process.env.ENGINEER_PASSWORD ?? "1234";

async function bootstrap(): Promise<void> {
  const app = Fastify({ logger: true });
  let shuttingDown = false;
  await app.register(cors, { origin: true });
  await app.register(websocket);
  await app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // project/screen archive imports can be larger than single assets
    },
  });

  const projectService = new ProjectService(projectFile);
  const assetService = new AssetService(projectService);
  const eventSoundService = new EventSoundService(projectService, eventSoundsDir);
  const libraryService = new LibraryService(librariesRoot, projectService);
  const projectArchiveService = new ProjectArchiveService(projectService, libraryService, eventSoundService);
  const tagStore = new TagStore();
  const driverManager = new DriverManager();
  const internalVariableService = new InternalVariableService(tagStore);
  const commandService = new CommandService(tagStore, driverManager, internalVariableService);
  const macroService = new MacroService(tagStore, commandService, internalVariableService);
  const runtimeService = new RuntimeService(tagStore, driverManager, internalVariableService, macroService);
  const authService = new AuthService(
    authDbFile,
    {
      username: defaultAdminUsername,
      password: defaultAdminPassword,
    },
    legacyUsersFile,
  );
  const wsGateway = new WebSocketGateway(tagStore, commandService, runtimeService);
  await configureArchiveEnvironment({
    info: (message) => app.log.info(message),
    warn: (message) => app.log.warn(message),
    error: (message) => app.log.error(message),
  });
  let archiveService = ArchiveService.fromEnvironment(tagStore, {
    info: (message) => app.log.info(message),
    warn: (message) => app.log.warn(message),
    error: (message) => app.log.error(message),
  });

  const project = await projectService.loadProject();
  await authService.initialize();
  const variableDefinitions = buildInternalAndLwTagDefinitions(project.variables ?? [], project.lwStore);
  tagStore.setDefinitions([...project.tags, ...variableDefinitions]);
  internalVariableService.setup(project.variables ?? [], project.lwStore);
  macroService.configure(project);
  if (archiveService) {
    try {
      await archiveService.initialize([...project.tags, ...variableDefinitions], project.drivers);
      const operatorArchiveSettings: OperatorActionArchiveSettings = {
        enabled: project.operatorActionSettings?.archiveSettings?.enabled ?? true,
        retentionDays: project.operatorActionSettings?.archiveSettings?.retentionDays ?? 90,
        maxDatabaseSizeMb: project.operatorActionSettings?.archiveSettings?.maxDatabaseSizeMb ?? 2048,
        cleanupMode: project.operatorActionSettings?.archiveSettings?.cleanupMode ?? "byAgeAndSize",
        cleanupIntervalMinutes: project.operatorActionSettings?.archiveSettings?.cleanupIntervalMinutes ?? 60,
        optimizeAfterCleanup: project.operatorActionSettings?.archiveSettings?.optimizeAfterCleanup ?? false,
        deleteBatchSize: project.operatorActionSettings?.archiveSettings?.deleteBatchSize ?? 500,
        maintenanceIntervalMs: project.operatorActionSettings?.archiveSettings?.maintenanceIntervalMs ?? 3000,
        maxMaintenanceTickMs: project.operatorActionSettings?.archiveSettings?.maxMaintenanceTickMs ?? 200,
        maxDeleteTransactionMs: project.operatorActionSettings?.archiveSettings?.maxDeleteTransactionMs ?? 150,
      };
      archiveService.setOperatorActionArchiveSettings(operatorArchiveSettings);
      app.log.info("Archive service initialized");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      app.log.warn(`Archive service disabled: ${message}`);
      await archiveService.close().catch(() => undefined);
      archiveService = undefined;
    }
  }
  const eventEngine = new EventEngine(tagStore, archiveService, wsGateway, commandService, {
    logger: {
      info: (message) => app.log.info(message),
      warn: (message) => app.log.warn(message),
      error: (message) => app.log.error(message),
    },
    isRuntimeRunning: () => runtimeService.getState().running,
  });
  await eventEngine.configureProject(project);

  await registerApiRoutes(app, {
    projectService,
    assetService,
    eventSoundService,
    libraryService,
    projectArchiveService,
    tagStore,
    driverManager,
    runtimeService,
    commandService,
    internalVariableService,
    macroService,
    authService,
    archiveService,
    eventEngine,
  });

  await wsGateway.register(app);

  app.addHook("onClose", async () => {
    await eventEngine.stop();
    await wsGateway.close();
    await runtimeService.stop();
    await archiveService?.close();
  });

  await app.listen({ host: "0.0.0.0", port });
  app.log.info(`Server is listening on port ${port}`);
  void runtimeService.start(project).catch((error) => {
    app.log.error(error, "Runtime failed to start");
  });
  void eventEngine.start(project).catch((error) => {
    app.log.error(error, "Event engine failed to start");
  });
  if (!process.env.DEFAULT_ADMIN_PASSWORD) {
    app.log.warn(
      "DEFAULT_ADMIN_PASSWORD is not set. Insecure default password is used. Set DEFAULT_ADMIN_PASSWORD and change the admin password.",
    );
  }

  const closeApp = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info(`Received ${signal}. Shutting down...`);
    try {
      await app.close();
      app.log.info("Graceful shutdown completed.");
      process.exit(0);
    } catch (error) {
      app.log.error(error, "Failed to shutdown gracefully");
      process.exit(1);
    }
  };

  process.once("SIGINT", () => {
    void closeApp("SIGINT");
  });
  process.once("SIGTERM", () => {
    void closeApp("SIGTERM");
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
