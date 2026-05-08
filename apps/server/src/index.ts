import "dotenv/config";
import path from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerApiRoutes } from "./api/routes.js";
import { AuthService } from "./auth/auth-service.js";
import { AssetService } from "./assets/asset-service.js";
import { DriverManager } from "./drivers/driver-manager.js";
import { LibraryService } from "./libraries/library-service.js";
import { ProjectService } from "./project/project-service.js";
import { CommandService } from "./runtime/command-service.js";
import { buildInternalAndLwTagDefinitions, InternalVariableService } from "./runtime/internal-variable-service.js";
import { MacroService } from "./runtime/macro-service.js";
import { RuntimeService } from "./runtime/runtime-service.js";
import { TagStore } from "./tags/tag-store.js";
import { WebSocketGateway } from "./websocket/websocket-gateway.js";

const port = Number(process.env.PORT ?? 3001);
const projectFile = path.resolve(process.cwd(), process.env.PROJECT_FILE ?? "../../projects/demo-project.json");
const librariesRoot = path.resolve(process.cwd(), process.env.LIBRARIES_DIR ?? "../../libraries");
const usersFile = path.resolve(process.cwd(), process.env.USERS_FILE ?? "../../data/users.json");
const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME ?? "admin";
const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD ?? process.env.ENGINEER_PASSWORD ?? "1234";

async function bootstrap(): Promise<void> {
  const app = Fastify({ logger: true });
  let shuttingDown = false;
  await app.register(cors, { origin: true });
  await app.register(websocket);
  await app.register(multipart);

  const projectService = new ProjectService(projectFile);
  const assetService = new AssetService(projectService);
  const libraryService = new LibraryService(librariesRoot, projectService);
  const tagStore = new TagStore();
  const driverManager = new DriverManager();
  const internalVariableService = new InternalVariableService(tagStore);
  const commandService = new CommandService(tagStore, driverManager, internalVariableService);
  const macroService = new MacroService(tagStore, commandService, internalVariableService);
  const runtimeService = new RuntimeService(tagStore, driverManager, internalVariableService, macroService);
  const authService = new AuthService(usersFile, {
    username: defaultAdminUsername,
    password: defaultAdminPassword,
  });
  const wsGateway = new WebSocketGateway(tagStore, commandService);

  const project = await projectService.loadProject();
  await authService.initialize();
  const variableDefinitions = buildInternalAndLwTagDefinitions(project.variables ?? [], project.lwStore);
  tagStore.setDefinitions([...project.tags, ...variableDefinitions]);
  internalVariableService.setup(project.variables ?? [], project.lwStore);
  macroService.configure(project);

  await registerApiRoutes(app, {
    projectService,
    assetService,
    libraryService,
    tagStore,
    driverManager,
    runtimeService,
    commandService,
    internalVariableService,
    macroService,
    authService,
  });

  await wsGateway.register(app);
  await runtimeService.start(project);

  app.addHook("onClose", async () => {
    await wsGateway.close();
    await runtimeService.stop();
  });

  await app.listen({ host: "0.0.0.0", port });
  app.log.info(`Server is listening on port ${port}`);
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
