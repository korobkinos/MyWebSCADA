import "dotenv/config";
import path from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerApiRoutes } from "./api/routes.js";
import { AssetService } from "./assets/asset-service.js";
import { DriverManager } from "./drivers/driver-manager.js";
import { LibraryService } from "./libraries/library-service.js";
import { ProjectService } from "./project/project-service.js";
import { CommandService } from "./runtime/command-service.js";
import { EngineerAuthService } from "./runtime/engineer-auth-service.js";
import { InternalVariableService, variableToTagDefinition } from "./runtime/internal-variable-service.js";
import { MacroService } from "./runtime/macro-service.js";
import { RuntimeService } from "./runtime/runtime-service.js";
import { TagStore } from "./tags/tag-store.js";
import { WebSocketGateway } from "./websocket/websocket-gateway.js";

const port = Number(process.env.PORT ?? 3001);
const projectFile = path.resolve(process.cwd(), process.env.PROJECT_FILE ?? "../../projects/demo-project.json");
const librariesRoot = path.resolve(process.cwd(), process.env.LIBRARIES_DIR ?? "../../libraries");
const engineerPassword = process.env.ENGINEER_PASSWORD ?? "1234";

async function bootstrap(): Promise<void> {
  const app = Fastify({ logger: true });
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
  const engineerAuthService = new EngineerAuthService(engineerPassword);
  const wsGateway = new WebSocketGateway(tagStore, commandService);

  const project = await projectService.loadProject();
  const variableDefinitions = (project.variables ?? []).map(variableToTagDefinition);
  tagStore.setDefinitions([...project.tags, ...variableDefinitions]);
  internalVariableService.setup(project.variables ?? []);
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
    engineerAuthService,
  });

  await wsGateway.register(app);
  await runtimeService.start(project);

  app.addHook("onClose", async () => {
    await runtimeService.stop();
  });

  await app.listen({ host: "0.0.0.0", port });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
