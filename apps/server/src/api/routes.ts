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
  type EventHistoryRecord,
  type HmiObject,
  type MacroDefinition,
  type MacroTrigger,
  DEFAULT_OPERATOR_ACTION_BUTTON_TEMPLATE,
  DEFAULT_OPERATOR_ACTION_CHECKBOX_TEMPLATE,
  DEFAULT_OPERATOR_ACTION_NUMERIC_INPUT_TEMPLATE,
  DEFAULT_OPERATOR_ACTION_SLIDER_TEMPLATE,
  DEFAULT_OPERATOR_ACTION_VALUE_CHANGE_TEMPLATE,
  type OperatorActionArchiveSettings,
  type OperatorActionContext,
  type OperatorActionKind,
  type OperatorActionResult,
  type OperatorActionTargetType,
  type OpcUaDriverConfig,
  type PasswordPolicy,
  type ScadaProject,
  type UpdateUserRequest,
  getUserRoleLevel,
  isOperatorActionEnabledForObject,
  libraryElementSchema,
  normalizePasswordPolicy,
  projectSchema,
} from "@web-scada/shared";
import { z } from "zod";
import { ArchiveService } from "../archive/archive-service.js";
import { AuthService, AuthValidationError } from "../auth/auth-service.js";
import { AssetService } from "../assets/asset-service.js";
import { DriverManager } from "../drivers/driver-manager.js";
import { EventSoundService } from "../events/event-sound-service.js";
import type { EventEngine } from "../events/event-engine.js";
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
  eventSoundService: EventSoundService;
  libraryService: LibraryService;
  tagStore: TagStore;
  driverManager: DriverManager;
  runtimeService: RuntimeService;
  commandService: CommandService;
  internalVariableService: InternalVariableService;
  macroService: MacroService;
  authService: AuthService;
  archiveService?: ArchiveService;
  eventEngine?: EventEngine;
};

type LibraryElementUsage = {
  screenId: string;
  screenName: string;
  objectId: string;
  objectName?: string;
  path: string;
};

const GUEST_RUNTIME_PERMISSIONS = new Set<AppPermission>(["tags.view", "tags.write", "macros.run", "libraries.view"]);
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
const operatorActionContextSchema = z.object({
  screenId: z.string().min(1).optional(),
  screenName: z.string().min(1).optional(),
  objectId: z.string().min(1),
  objectName: z.string().min(1).optional(),
  objectDescription: z.string().min(1).optional(),
  objectType: z.string().min(1),
  actionKind: z.enum([
    "write",
    "toggle",
    "pulse",
    "button",
    "checkbox",
    "slider",
    "numericInput",
    "macro",
    "variable",
    "lw",
    "screen",
  ]),
  targetType: z.enum(["tag", "variable", "lw", "macro", "screen", "unknown"]).optional(),
  targetName: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  messageTemplate: z.string().min(1).optional(),
  clientOldValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  requestedValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  details: z.record(z.unknown()).optional(),
}).strict();
const writeSchema = z.object({
  value: z.union([z.boolean(), z.number(), z.string(), z.null()]),
  commandMeta: commandMetaSchema.optional(),
  operatorActionContext: operatorActionContextSchema.optional(),
});
const archiveSamplesQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  limit: z.coerce.number().int().positive().max(10000).optional(),
});
const trendAggregationSchema = z.enum(["auto", "raw", "minmax", "avg", "lttb"]);
const trendQuerySchema = z.object({
  tags: z.array(z.string().min(1)).min(1).max(200),
  from: z.coerce.date(),
  to: z.coerce.date(),
  maxPoints: z.coerce.number().int().positive().max(10000),
  aggregation: trendAggregationSchema.default("auto"),
});
const trendRangeQuerySchema = z.object({
  tags: z.union([z.array(z.string().min(1)), z.string().min(1)]).optional(),
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
const archiveRuntimeSettingsSchema = z.object({
  autoCleanupEnabled: z.boolean(),
  maxDbSizeMb: z.number().int().positive().max(1024 * 1024).nullable(),
});
const eventHistoryQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  category: z.string().min(1).optional(),
  priority: z.coerce.number().int().min(0).max(3).optional(),
  sourceTagName: z.string().min(1).optional(),
  state: z.enum(["active", "cleared", "acknowledged"]).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(5000).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
const eventArchiveCleanupModeSchema = z.enum(["byAge", "bySize", "byAgeAndSize"]);
const eventArchiveCleanupSchema = z.object({
  retentionDays: z.number().int().positive().optional(),
  maxDatabaseSizeMb: z.number().int().positive().optional(),
  cleanupMode: eventArchiveCleanupModeSchema.optional(),
  optimizeAfterCleanup: z.boolean().optional(),
});
const eventArchiveSettingsSchema = z.object({
  enabled: z.boolean(),
  retentionDays: z.number().int().positive(),
  maxDatabaseSizeMb: z.number().int().positive(),
  cleanupMode: eventArchiveCleanupModeSchema,
  cleanupIntervalMinutes: z.number().int().positive(),
  optimizeAfterCleanup: z.boolean(),
  updatedAt: z.string().optional(),
});
const operatorActionResultSchema = z.enum(["success", "failed", "denied"]);
const operatorActionKindSchema = z.enum([
  "write",
  "toggle",
  "pulse",
  "button",
  "checkbox",
  "slider",
  "numericInput",
  "macro",
  "variable",
  "lw",
  "screen",
]);
const operatorActionTargetTypeSchema = z.enum(["tag", "variable", "lw", "macro", "screen", "unknown"]);
const operatorActionHistoryQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  user: z.string().optional(),
  objectId: z.string().min(1).optional(),
  objectType: z.string().min(1).optional(),
  targetName: z.string().min(1).optional(),
  result: operatorActionResultSchema.optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
const operatorActionScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const operatorActionLogSchema = z.object({
  occurredAt: z.string().datetime().optional(),
  screenId: z.string().min(1).nullable().optional(),
  screenName: z.string().min(1).nullable().optional(),
  objectId: z.string().min(1),
  objectName: z.string().min(1).nullable().optional(),
  objectDescription: z.string().min(1).nullable().optional(),
  objectType: z.string().min(1),
  actionKind: operatorActionKindSchema,
  targetType: operatorActionTargetTypeSchema.nullable().optional(),
  targetName: z.string().min(1).nullable().optional(),
  oldValue: operatorActionScalarSchema.optional(),
  newValue: operatorActionScalarSchema.optional(),
  unit: z.string().min(1).nullable().optional(),
  messageTemplate: z.string().min(1).nullable().optional(),
  messageText: z.string().min(1),
  result: operatorActionResultSchema.optional(),
  errorText: z.string().min(1).nullable().optional(),
  details: z.record(z.unknown()).nullable().optional(),
}).strict();
const operatorActionArchiveCleanupSchema = z.object({
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().positive().optional(),
  maxDatabaseSizeMb: z.number().int().positive().optional(),
  cleanupMode: eventArchiveCleanupModeSchema.optional(),
  optimizeAfterCleanup: z.boolean().optional(),
});
const eventAckSchema = z.object({
  ids: z.array(z.union([z.string().min(1), z.number().int().positive()])).min(1).max(1000),
});
const eventActiveQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(5000).optional(),
  includeClearedUnacknowledged: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => value === true || value === "true"),
});
const EVENT_HISTORY_EXPORT_PAGE_SIZE = 5000;
const EVENT_HISTORY_EXPORT_MAX_ROWS = 200_000;
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
  operatorActionContext: operatorActionContextSchema.optional(),
});
const macroTriggerUpdateSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("onScreenOpen"), screenKey: z.string().min(1) }),
  z.object({ type: z.literal("onScreenClose"), screenKey: z.string().min(1) }),
  z.object({
    type: z.literal("onButtonClick"),
    objectId: z.string().min(1),
    screenKey: z.string().optional(),
  }),
  z.object({ type: z.literal("onTagChange"), tag: z.string().min(1) }),
  z.object({ type: z.literal("onCondition"), condition: z.string().min(1) }),
  z.object({ type: z.literal("interval"), intervalMs: z.number().int().positive() }),
]);
const macroUpdateSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  enabled: z.boolean(),
  language: z.literal("javascript-lite"),
  code: z.string().min(1, "Macro code is required"),
  triggers: z.array(macroTriggerUpdateSchema).optional(),
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
const updateEventSoundSchema = z.object({
  name: z.string().min(1),
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
  username?: string;
  userRole?: string | null;
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
        username: undefined,
        userRole: null,
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

async function requirePermissionWithOperatorActionContext(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: ApiDeps,
  permission: AppPermission,
  operatorActionContext: OperatorActionContext | undefined,
): Promise<AuthContext | null> {
  const user = await resolveAuthUser(request, deps);
  if (!user) {
    if (isGuestRuntimePermissionAllowed(deps, permission)) {
      return {
        userId: "guest-runtime",
        username: undefined,
        userRole: null,
        permissions: new Set<AppPermission>(),
        roleLevel: 0,
      };
    }
    await reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
    return null;
  }
  const auth = toAuthContext(user);
  if (!auth.permissions.has(permission)) {
    await tryCreateRuntimeOperatorAction({
      deps,
      request,
      auth,
      context: operatorActionContext,
      result: "denied",
      errorText: `Permission denied: ${permission}`,
    });
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
    username: user.username,
    userRole: user.roles.length > 0 ? user.roles.join(",") : null,
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

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}

function sendBadRequest(reply: FastifyReply, message: string, error: unknown): FastifyReply {
  if (error instanceof z.ZodError) {
    const errors = formatZodIssues(error);
    return reply.code(400).send({
      error: "Validation Error",
      message,
      errors,
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

function normalizeTrendTags(input: string[] | string | undefined): string[] {
  if (!input) {
    return [];
  }
  const source = Array.isArray(input) ? input : input.split(",");
  return [...new Set(source.map((item) => item.trim()).filter(Boolean))];
}

function toEventHistoryQuery(query: z.infer<typeof eventHistoryQuerySchema>) {
  return {
    from: query.from,
    to: query.to,
    category: query.category,
    priority: query.priority,
    sourceTagName: query.sourceTagName,
    state: query.state,
    search: query.search,
    limit: query.limit,
    offset: query.offset,
  };
}

function toOperatorActionHistoryQuery(query: z.infer<typeof operatorActionHistoryQuerySchema>) {
  return {
    from: query.from,
    to: query.to,
    user: query.user,
    objectId: query.objectId,
    objectType: query.objectType,
    targetName: query.targetName,
    result: query.result,
    search: query.search,
    limit: query.limit,
    offset: query.offset,
  };
}

function resolveOperatorActionArchiveSettings(project: ScadaProject): OperatorActionArchiveSettings {
  const archiveSettings = project.operatorActionSettings?.archiveSettings;
  return {
    enabled: archiveSettings?.enabled ?? true,
    retentionDays: archiveSettings?.retentionDays ?? 90,
    maxDatabaseSizeMb: archiveSettings?.maxDatabaseSizeMb ?? 2048,
    cleanupMode: archiveSettings?.cleanupMode ?? "byAgeAndSize",
    cleanupIntervalMinutes: archiveSettings?.cleanupIntervalMinutes ?? 60,
    optimizeAfterCleanup: archiveSettings?.optimizeAfterCleanup ?? false,
    updatedAt: archiveSettings?.updatedAt,
  };
}

function findObjectDeep(objects: HmiObject[], objectId: string): HmiObject | undefined {
  for (const object of objects) {
    if (object.id === objectId) {
      return object;
    }
    if (object.type === "group") {
      const nested = findObjectDeep(object.objects, objectId);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function findProjectObject(project: ScadaProject, objectId: string): HmiObject | undefined {
  for (const screen of project.screens) {
    const found = findObjectDeep(screen.objects, objectId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function isOperatorActionLoggingEnabled(project: ScadaProject, context: OperatorActionContext): boolean {
  const object = findProjectObject(project, context.objectId);
  return isOperatorActionEnabledForObject(object, project);
}

function toActionPlaceholder(kind: OperatorActionKind, details: Record<string, unknown> | undefined): string {
  const durationMs = typeof details?.pulseDurationMs === "number" && Number.isFinite(details.pulseDurationMs)
    ? Math.max(1, Math.floor(details.pulseDurationMs))
    : undefined;
  if (kind === "pulse" && durationMs !== undefined) {
    return `pulse ${durationMs}ms`;
  }
  return kind;
}

function resolveDefaultTemplateByKind(project: ScadaProject, actionKind: OperatorActionKind): string {
  if (actionKind === "button" || actionKind === "pulse" || actionKind === "toggle") {
    return project.operatorActionSettings?.defaultButtonTemplate
      ?? DEFAULT_OPERATOR_ACTION_BUTTON_TEMPLATE;
  }
  if (actionKind === "checkbox") {
    return project.operatorActionSettings?.defaultCheckboxTemplate
      ?? DEFAULT_OPERATOR_ACTION_CHECKBOX_TEMPLATE;
  }
  if (actionKind === "slider") {
    return project.operatorActionSettings?.defaultSliderTemplate
      ?? DEFAULT_OPERATOR_ACTION_SLIDER_TEMPLATE;
  }
  if (actionKind === "numericInput") {
    return project.operatorActionSettings?.defaultNumericInputTemplate
      ?? DEFAULT_OPERATOR_ACTION_NUMERIC_INPUT_TEMPLATE;
  }
  return project.operatorActionSettings?.defaultValueChangeTemplate
    ?? DEFAULT_OPERATOR_ACTION_VALUE_CHANGE_TEMPLATE;
}

function formatOperatorActionValue(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function renderOperatorActionTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(user|role|objectName|description|objectId|objectType|screenName|screenId|target|oldValue|newValue|unit|timestamp|actionType)\}/g, (_full, key: string) => {
    return values[key] ?? "";
  });
}

function isSensitiveTargetName(targetName: string | undefined): boolean {
  if (!targetName) {
    return false;
  }
  return /(password|passwd|pwd|token|secret|credential|api[_-]?key|private[_-]?key|session|auth|pin)/i.test(targetName);
}

function sanitizeOperatorActionValues(
  targetName: string | undefined,
  oldValue: string | number | boolean | null | undefined,
  newValue: string | number | boolean | null | undefined,
): { oldValue: string | number | boolean | null | undefined; newValue: string | number | boolean | null | undefined } {
  if (!isSensitiveTargetName(targetName)) {
    return { oldValue, newValue };
  }
  return {
    oldValue: "***",
    newValue: "***",
  };
}

async function tryCreateRuntimeOperatorAction(params: {
  deps: ApiDeps;
  request: FastifyRequest;
  auth: AuthContext;
  context: OperatorActionContext | undefined;
  result: OperatorActionResult;
  oldValue?: string | number | boolean | null;
  newValue?: string | number | boolean | null;
  errorText?: string;
}): Promise<void> {
  if (!params.context) {
    return;
  }
  if (!params.deps.archiveService?.isEnabled()) {
    return;
  }
  const project = params.deps.projectService.getProject();
  if (!isOperatorActionLoggingEnabled(project, params.context)) {
    return;
  }

  const sourceOldValue = params.oldValue ?? params.context.clientOldValue;
  const sourceNewValue = params.newValue ?? params.context.requestedValue;
  const sensitiveTarget = isSensitiveTargetName(params.context.targetName);
  const sanitized = sanitizeOperatorActionValues(params.context.targetName, sourceOldValue, sourceNewValue);
  const occurredAt = new Date().toISOString();
  const username = params.auth.username ?? params.auth.userId ?? "unknown";
  const role = params.auth.userRole ?? "";
  const description = params.context.objectDescription
    ?? params.context.objectName
    ?? params.context.targetName
    ?? params.context.objectId;
  const selectedTemplate = params.context.messageTemplate
    ?? resolveDefaultTemplateByKind(project, params.context.actionKind)
    ?? 'Пользователь {user} выполнил действие "{actionType}" у объекта "{description}"';
  const values = {
    user: username,
    role,
    objectName: params.context.objectName ?? "",
    description: description ?? "",
    objectId: params.context.objectId,
    objectType: params.context.objectType,
    screenName: params.context.screenName ?? "",
    screenId: params.context.screenId ?? "",
    target: params.context.targetName ?? "",
    oldValue: formatOperatorActionValue(sanitized.oldValue),
    newValue: formatOperatorActionValue(sanitized.newValue),
    unit: params.context.unit ?? "",
    timestamp: occurredAt,
    actionType: toActionPlaceholder(params.context.actionKind, params.context.details),
  };
  const messageText = renderOperatorActionTemplate(selectedTemplate, values)
    || renderOperatorActionTemplate('Пользователь {user} выполнил действие "{actionType}" у объекта "{description}"', values);
  const safeDetails = sensitiveTarget
    ? {
      ...(params.context.details ?? {}),
      sensitiveTarget: true,
      redacted: true,
    }
    : (params.context.details ?? null);
  try {
    await params.deps.archiveService.createOperatorAction({
      occurredAt,
      userId: params.auth.userId ?? null,
      username: params.auth.username ?? null,
      userRole: params.auth.userRole ?? null,
      ip: params.request.ip ?? null,
      screenId: params.context.screenId ?? null,
      screenName: params.context.screenName ?? null,
      objectId: params.context.objectId,
      objectName: params.context.objectName ?? null,
      objectDescription: params.context.objectDescription ?? null,
      objectType: params.context.objectType,
      actionKind: params.context.actionKind,
      targetType: params.context.targetType ?? null,
      targetName: params.context.targetName ?? null,
      oldValue: sanitized.oldValue,
      newValue: sanitized.newValue,
      unit: params.context.unit ?? null,
      messageTemplate: selectedTemplate,
      messageText,
      result: params.result,
      errorText: params.errorText ? params.errorText.slice(0, 500) : null,
      details: safeDetails,
    });
  } catch (error) {
    params.request.log.warn(
      {
        objectId: params.context.objectId,
        targetName: params.context.targetName,
        result: params.result,
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to create runtime operator action record",
    );
  }
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function eventHistoryToCsvRows(records: Array<{
  id: string;
  occurredAt: string;
  clearedAt?: string | null;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  state: string;
  categoryIdSnapshot?: string | null;
  categoryNameSnapshot?: string | null;
  prioritySnapshot?: number | null;
  messageTextSnapshot?: string | null;
  sourceTagNameSnapshot?: string | null;
  valueAtTrigger?: unknown;
  valueAtClear?: unknown;
  quality?: string | null;
  eventDefinitionId: string;
}>): string {
  const header = [
    "occurredAt",
    "clearedAt",
    "acknowledgedAt",
    "acknowledgedBy",
    "state",
    "category",
    "priority",
    "message",
    "sourceTagName",
    "valueAtTrigger",
    "valueAtClear",
    "quality",
    "eventDefinitionId",
    "occurrenceId",
  ];

  const lines = [header, ...records.map((row) => [
    row.occurredAt,
    row.clearedAt ?? "",
    row.acknowledgedAt ?? "",
    row.acknowledgedBy ?? "",
    row.state,
    row.categoryNameSnapshot ?? row.categoryIdSnapshot ?? "",
    row.prioritySnapshot ?? "",
    row.messageTextSnapshot ?? "",
    row.sourceTagNameSnapshot ?? "",
    row.valueAtTrigger ?? "",
    row.valueAtClear ?? "",
    row.quality ?? "",
    row.eventDefinitionId,
    row.id,
  ])];

  return lines.map((line) => line.map((cell) => csvEscape(cell)).join(",")).join("\n");
}

async function persistProjectUpdate(deps: ApiDeps, nextProject: ScadaProject): Promise<ScadaProject> {
  const saved = await deps.projectService.saveProject(nextProject);
  const variableDefinitions = buildInternalAndLwTagDefinitions(saved.variables ?? [], saved.lwStore);
  deps.tagStore.setDefinitions([...(saved.tags ?? []), ...variableDefinitions]);
  deps.internalVariableService.setup(saved.variables ?? [], saved.lwStore);
  deps.macroService.configure(saved);
  await deps.archiveService?.syncMetadata([...(saved.tags ?? []), ...variableDefinitions], saved.drivers);
  await deps.eventEngine?.configureProject(saved);

  if (deps.runtimeService.getState().running) {
    await deps.eventEngine?.stop();
    await deps.runtimeService.stop();
    await deps.runtimeService.start(saved);
    await deps.eventEngine?.start(saved);
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
    const params = request.params as { name: string };
    const rawContext = (
      typeof request.body === "object"
      && request.body
      && "operatorActionContext" in request.body
    ) ? (request.body as { operatorActionContext?: unknown }).operatorActionContext : undefined;
    const parsedOperatorActionContext = operatorActionContextSchema.safeParse(rawContext);
    const auth = await requirePermissionWithOperatorActionContext(
      request,
      reply,
      deps,
      "tags.write",
      parsedOperatorActionContext.success ? parsedOperatorActionContext.data : undefined,
    );
    if (!auth) {
      return;
    }
    const payload = writeSchema.parse(request.body ?? {});
    const serverOldValue = deps.tagStore.getValue(params.name)?.value as string | number | boolean | null | undefined;
    try {
      await deps.commandService.writeTag(params.name, payload.value, {
        manual: true,
        commandMeta: payload.commandMeta,
      });
      await tryCreateRuntimeOperatorAction({
        deps,
        request,
        auth,
        context: payload.operatorActionContext,
        result: "success",
        oldValue: serverOldValue,
        newValue: payload.value,
      });
      return reply.send({ ok: true });
    } catch (error) {
      if (error instanceof ManualCommandError) {
        await tryCreateRuntimeOperatorAction({
          deps,
          request,
          auth,
          context: payload.operatorActionContext,
          result: "failed",
          oldValue: serverOldValue,
          newValue: payload.value,
          errorText: error.reason === "driver_offline" ? "Command rejected: driver unavailable" : error.message,
        });
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
      await tryCreateRuntimeOperatorAction({
        deps,
        request,
        auth,
        context: payload.operatorActionContext,
        result: "failed",
        oldValue: serverOldValue,
        newValue: payload.value,
        errorText: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });

  app.get("/api/events/active", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.view");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Event archive database is not configured" });
    }
    const parsed = eventActiveQuerySchema.parse(request.query ?? {});
    const limit = parsed.limit ?? 200;
    const includeClearedUnacknowledged = parsed.includeClearedUnacknowledged === true;
    return reply.send(await deps.archiveService.listOnlineEvents(limit, includeClearedUnacknowledged));
  });

  app.get("/api/events/history", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.view");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Event archive database is not configured" });
    }
    const parsed = eventHistoryQuerySchema.parse(request.query ?? {});
    return reply.send(await deps.archiveService.queryEventHistory(toEventHistoryQuery(parsed)));
  });

  app.get("/api/events/history/export.csv", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.view");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Event archive database is not configured" });
    }
    const parsed = eventHistoryQuerySchema.parse(request.query ?? {});
    const filters = toEventHistoryQuery(parsed);
    const records: EventHistoryRecord[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;

    while (offset < total) {
      const page = await deps.archiveService.queryEventHistory({
        ...filters,
        limit: EVENT_HISTORY_EXPORT_PAGE_SIZE,
        offset,
      });
      total = page.total;
      records.push(...page.items);
      offset += page.items.length;

      if (records.length > EVENT_HISTORY_EXPORT_MAX_ROWS) {
        return reply.code(413).send({
          message: `Too many rows for export. Limit is ${EVENT_HISTORY_EXPORT_MAX_ROWS} rows. Narrow the filter range and try again.`,
        });
      }
      if (page.items.length === 0) {
        break;
      }
    }

    const csv = eventHistoryToCsvRows(records);
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", "attachment; filename=event-history.csv");
    return reply.send(csv);
  });

  app.get("/api/events/archive/status", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.view");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Event archive database is not configured" });
    }
    return reply.send(await deps.archiveService.getEventArchiveStatus());
  });

  app.post("/api/events/archive/cleanup", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "runtime.control");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Event archive database is not configured" });
    }
    const payload = eventArchiveCleanupSchema.parse(request.body ?? {});
    return reply.send(await deps.archiveService.cleanupEventArchive(payload));
  });

  app.post("/api/events/archive/optimize", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "runtime.control");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Event archive database is not configured" });
    }
    return reply.send(await deps.archiveService.optimizeEventArchive());
  });

  app.get("/api/events/archive/settings", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.view");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Event archive database is not configured" });
    }
    return reply.send(await deps.archiveService.getEventArchiveSettings());
  });

  app.put("/api/events/archive/settings", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Event archive database is not configured" });
    }
    const payload = eventArchiveSettingsSchema.parse(request.body ?? {});
    const updated = await deps.archiveService.updateEventArchiveSettings(payload);
    deps.eventEngine?.setArchiveEnabled(updated.enabled);
    return reply.send(updated);
  });

  app.get("/api/operator-actions/history", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.view");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Operator action archive database is not configured" });
    }
    const parsed = operatorActionHistoryQuerySchema.parse(request.query ?? {});
    return reply.send(await deps.archiveService.queryOperatorActions(toOperatorActionHistoryQuery(parsed)));
  });

  app.post("/api/operator-actions/log", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "runtime.control");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Operator action archive database is not configured" });
    }
    const payload = operatorActionLogSchema.parse(request.body ?? {});
    const created = await deps.archiveService.createOperatorAction({
      ...payload,
      userId: auth.userId ?? null,
      username: auth.username ?? null,
      userRole: auth.userRole ?? null,
      ip: request.ip ?? null,
    });
    return reply.code(201).send(created);
  });

  app.get("/api/operator-actions/archive/status", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.view");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Operator action archive database is not configured" });
    }
    const settings = resolveOperatorActionArchiveSettings(deps.projectService.getProject());
    return reply.send(await deps.archiveService.getOperatorActionArchiveStatus(settings));
  });

  app.post("/api/operator-actions/archive/cleanup", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "runtime.control");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Operator action archive database is not configured" });
    }
    const payload = operatorActionArchiveCleanupSchema.parse(request.body ?? {});
    const settings = resolveOperatorActionArchiveSettings(deps.projectService.getProject());
    return reply.send(await deps.archiveService.cleanupOperatorActionArchive({
      enabled: payload.enabled ?? settings.enabled,
      retentionDays: payload.retentionDays ?? settings.retentionDays,
      maxDatabaseSizeMb: payload.maxDatabaseSizeMb ?? settings.maxDatabaseSizeMb,
      cleanupMode: payload.cleanupMode ?? settings.cleanupMode,
      optimizeAfterCleanup: payload.optimizeAfterCleanup ?? settings.optimizeAfterCleanup,
    }));
  });

  app.post("/api/operator-actions/archive/optimize", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "runtime.control");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Operator action archive database is not configured" });
    }
    return reply.send(await deps.archiveService.optimizeOperatorActionArchive());
  });

  app.post("/api/events/ack", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Event archive database is not configured" });
    }
    const payload = eventAckSchema.parse(request.body ?? {});
    if (!deps.eventEngine) {
      return reply.code(503).send({ message: "Event engine is not available" });
    }
    const result = await deps.eventEngine.acknowledgeOccurrences(payload.ids, auth.userId);
    const statusCode = result.notFoundIds.length > 0 ? 207 : 200;
    return reply.code(statusCode).send({
      ok: result.notFoundIds.length === 0,
      ...result,
    });
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

  app.get("/api/archive/settings", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.view");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    return reply.send(await deps.archiveService.getRuntimeSettings());
  });

  app.put("/api/archive/settings", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    const payload = archiveRuntimeSettingsSchema.parse(request.body ?? {});
    return reply.send(await deps.archiveService.updateRuntimeSettings(payload));
  });

  app.post("/api/archive/purge/preview", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.view");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    return reply.send(await deps.archiveService.previewArchiveDataPurge());
  });

  app.post("/api/archive/purge/run", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.write");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    return reply.send(await deps.archiveService.clearArchiveData());
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

  app.get("/api/trends/tags", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.view");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    return reply.send(await deps.archiveService.listTrendTags());
  });

  app.get("/api/trends/range", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.view");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    const query = trendRangeQuerySchema.parse(request.query ?? {});
    const tags = normalizeTrendTags(query.tags);
    return reply.send(await deps.archiveService.queryTrendsRange(tags));
  });

  app.post("/api/trends/query", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "tags.view");
    if (!auth) {
      return;
    }
    if (!deps.archiveService?.isEnabled()) {
      return reply.code(503).send({ message: "Archive database is not configured" });
    }
    const payload = trendQuerySchema.parse(request.body ?? {});
    if (payload.to.getTime() <= payload.from.getTime()) {
      return reply.code(400).send({ message: "Invalid range: `to` must be greater than `from`" });
    }
    const maxPoints = Math.max(1000, Math.min(8000, payload.maxPoints));
    const result = await deps.archiveService.queryTrends({
      tags: payload.tags,
      from: payload.from,
      to: payload.to,
      maxPoints,
      aggregation: payload.aggregation,
      hardLimitPerSeries: 10000,
    });
    return reply.send(result);
  });

  app.get("/api/variables", async () => deps.internalVariableService.getAll());

  app.post("/api/variables/:name/write", async (request, reply) => {
    const params = request.params as { name: string };
    const rawContext = (
      typeof request.body === "object"
      && request.body
      && "operatorActionContext" in request.body
    ) ? (request.body as { operatorActionContext?: unknown }).operatorActionContext : undefined;
    const parsedOperatorActionContext = operatorActionContextSchema.safeParse(rawContext);
    const auth = await requirePermissionWithOperatorActionContext(
      request,
      reply,
      deps,
      "tags.write",
      parsedOperatorActionContext.success ? parsedOperatorActionContext.data : undefined,
    );
    if (!auth) {
      return;
    }
    const payload = writeSchema.parse(request.body ?? {});
    const serverOldValue = deps.internalVariableService.get(params.name)?.value as string | number | boolean | null | undefined;
    try {
      await deps.commandService.writeVariable(params.name, payload.value, {
        manual: true,
        commandMeta: payload.commandMeta,
      });
      await tryCreateRuntimeOperatorAction({
        deps,
        request,
        auth,
        context: payload.operatorActionContext,
        result: "success",
        oldValue: serverOldValue,
        newValue: payload.value,
      });
      return reply.send({ ok: true });
    } catch (error) {
      if (error instanceof ManualCommandError) {
        await tryCreateRuntimeOperatorAction({
          deps,
          request,
          auth,
          context: payload.operatorActionContext,
          result: "failed",
          oldValue: serverOldValue,
          newValue: payload.value,
          errorText: error.message,
        });
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
      await tryCreateRuntimeOperatorAction({
        deps,
        request,
        auth,
        context: payload.operatorActionContext,
        result: "failed",
        oldValue: serverOldValue,
        newValue: payload.value,
        errorText: error instanceof Error ? error.message : String(error),
      });
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
    const payloadResult = macroUpdateSchema.safeParse(request.body);
    if (!payloadResult.success) {
      return sendBadRequest(reply, "Invalid macro payload", payloadResult.error);
    }
    const payload = payloadResult.data;
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

    let saved: ScadaProject;
    try {
      saved = await deps.projectService.saveProject(nextProject);
      deps.macroService.configure(saved);
      if (deps.runtimeService.getState().running) {
        deps.runtimeService.macroRegistry.reloadMacro(updatedMacro);
      }
    } catch (error) {
      request.log.warn({
        err: error,
        macroId: params.id,
      }, "macro save rejected");
      return sendBadRequest(reply, "Macro could not be saved", error);
    }

    return reply.send(updatedMacro);
  });

  app.post("/api/macros/:id/run", async (request, reply) => {
    const rawContext = (
      typeof request.body === "object"
      && request.body
      && "operatorActionContext" in request.body
    ) ? (request.body as { operatorActionContext?: unknown }).operatorActionContext : undefined;
    const parsedOperatorActionContext = operatorActionContextSchema.safeParse(rawContext);
    const auth = await requirePermissionWithOperatorActionContext(
      request,
      reply,
      deps,
      "macros.run",
      parsedOperatorActionContext.success ? parsedOperatorActionContext.data : undefined,
    );
    if (!auth) {
      return;
    }
    const payload = macroRunSchema.parse(request.body ?? {});
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
      const logResult: OperatorActionResult = result.status === "ok" ? "success" : "failed";
      await tryCreateRuntimeOperatorAction({
        deps,
        request,
        auth,
        context: payload.operatorActionContext,
        result: logResult,
        errorText: result.status === "skipped" ? `Macro skipped: ${result.reason ?? "unknown"}` : undefined,
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
        await tryCreateRuntimeOperatorAction({
          deps,
          request,
          auth,
          context: payload.operatorActionContext,
          result: "failed",
          errorText: error.reason === "driver_offline" ? "Command rejected: driver unavailable" : error.message,
        });
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
      await tryCreateRuntimeOperatorAction({
        deps,
        request,
        auth,
        context: payload.operatorActionContext,
        result: "failed",
        errorText: error instanceof Error ? error.message : String(error),
      });
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
    await deps.eventEngine?.start(project);
    return deps.runtimeService.getState();
  });

  app.post("/api/runtime/stop", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "runtime.control");
    if (!auth) {
      return;
    }
    await deps.eventEngine?.stop();
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

  app.get("/api/event-sounds", async () => {
    return deps.eventSoundService.listProjectEventSounds();
  });

  app.post("/api/event-sounds/upload", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "assets.write");
    if (!auth) {
      return;
    }
    try {
      const uploaded = await parseUpload(request);
      const sound = await deps.eventSoundService.uploadProjectEventSound(uploaded);
      return reply.send(sound);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: "Bad Request", message: msg });
    }
  });

  app.patch("/api/event-sounds/:soundId", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "assets.write");
    if (!auth) {
      return;
    }
    const { soundId } = request.params as { soundId: string };
    const payload = updateEventSoundSchema.parse(request.body ?? {});
    try {
      const sound = await deps.eventSoundService.renameProjectEventSound(soundId, payload);
      return reply.send(sound);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes("not found")) {
        return reply.code(404).send({ error: "Not Found", message: msg });
      }
      return reply.code(400).send({ error: "Bad Request", message: msg });
    }
  });

  app.delete("/api/event-sounds/:soundId", async (request, reply) => {
    const auth = await requirePermission(request, reply, deps, "assets.delete");
    if (!auth) {
      return;
    }
    const { soundId } = request.params as { soundId: string };
    try {
      await deps.eventSoundService.deleteProjectEventSound(soundId);
      return reply.send({ ok: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes("not found")) {
        return reply.code(404).send({ error: "Not Found", message: msg });
      }
      return reply.code(400).send({ error: "Bad Request", message: msg });
    }
  });

  app.get("/api/event-sounds/:soundId/file", async (request, reply) => {
    const { soundId } = request.params as { soundId: string };
    const resolved = deps.eventSoundService.resolveProjectEventSoundFile(soundId);
    if (!resolved) {
      const sound = deps.eventSoundService.getProjectEventSound(soundId);
      if (!sound) {
        return reply.code(404).send({ message: "Sound not found" });
      }
      return reply.code(404).send({ message: "Sound file is not available" });
    }
    try {
      const bytes = await readFile(resolved.absolutePath);
      reply.header("Content-Type", resolved.sound.mimeType ?? "application/octet-stream");
      return reply.send(bytes);
    } catch {
      return reply.code(404).send({ message: "Sound file is missing" });
    }
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
