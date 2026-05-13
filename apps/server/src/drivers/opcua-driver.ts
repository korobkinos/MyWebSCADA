import {
  AttributeIds,
  ClientMonitoredItemGroup,
  ClientSubscription,
  DataType,
  MessageSecurityMode,
  OPCUAClient,
  SecurityPolicy,
  TimestampsToReturn,
  UserTokenType,
  type ClientSession,
  type DataValue,
  type MonitoringParametersOptions,
  type ReadValueIdOptions,
} from "node-opcua";
import type { OpcUaDriverConfig, TagDefinition, TagScalarValue, TagValue } from "@web-scada/shared";
import type { Driver, DriverStatus } from "./driver.js";
import { logPerf } from "../runtime/perf-logger.js";

type OpcUaAddress = { nodeId: string };
type SubscriptionGroupBinding = {
  group: ClientMonitoredItemGroup;
  nodeIds: string[];
};

function extractAddress(tag: TagDefinition): OpcUaAddress {
  const inlineNodeId = typeof tag.nodeId === "string" ? tag.nodeId.trim() : "";
  if (inlineNodeId.length > 0) {
    return { nodeId: inlineNodeId };
  }

  if (tag.address && typeof tag.address === "object") {
    const nodeId = (tag.address as Record<string, unknown>).nodeId;
    if (typeof nodeId === "string" && nodeId.trim().length > 0) {
      return { nodeId: nodeId.trim() };
    }
    const raw = (tag.address as Record<string, unknown>).raw;
    if (typeof raw === "string" && raw.trim().length > 0) {
      return { nodeId: raw.trim() };
    }
  }

  throw new Error(`Tag ${tag.name} requires OPC UA nodeId`);
}

function toScalar(value: DataValue): TagScalarValue {
  const raw = value.value.value;
  if (typeof raw === "boolean" || typeof raw === "number" || typeof raw === "string") {
    return raw;
  }
  return null;
}

function toDataType(value: TagScalarValue): DataType {
  if (typeof value === "boolean") {
    return DataType.Boolean;
  }
  if (typeof value === "number") {
    return DataType.Double;
  }
  return DataType.String;
}

export class OpcUaDriver implements Driver {
  public readonly id: string;
  public readonly type = "opcua";
  public static readonly CLOCK_WARNING_HELP =
    "Clock mismatch detected. Check OPC UA server/client time.";

  private static readonly DEFAULT_CONNECT_TIMEOUT_MS = 5000;
  private static readonly DEFAULT_OPERATION_TIMEOUT_MS = 5000;
  private static readonly DEFAULT_SESSION_TIMEOUT_MS = 60000;
  private static readonly DEFAULT_KEEP_ALIVE_INTERVAL_MS = 60000;
  private static readonly DEFAULT_READ_BATCH_SIZE = 100;
  private static readonly DEFAULT_PUBLISHING_INTERVAL_MS = 250;
  private static readonly DEFAULT_SAMPLING_INTERVAL_MS = 250;
  private static readonly DEFAULT_QUEUE_SIZE = 1;
  private static readonly DEFAULT_DISCARD_OLDEST = true;
  private static readonly DEFAULT_SUBSCRIPTION_BATCH_SIZE = 100;
  private static readonly DEFAULT_RECONNECT_MS = 5000;
  private static readonly STABLE_CONNECTION_RESET_MS = 30000;
  private static readonly MAX_RECONNECT_BACKOFF_MS = 30000;
  private static readonly OFFLINE_SKIP_STATUS = "OPC UA offline; waiting for reconnect window";

  private client: OPCUAClient | undefined;
  private session: ClientSession | undefined;
  private connectTask: Promise<void> | undefined;
  private closeTask: Promise<void> | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectBackoffMs = 0;
  private nextReconnectAttemptAt = 0;
  private consecutiveFailures = 0;
  private reconnectAttempt = 0;
  private connectedSinceAt = 0;
  private stopping = false;
  private connectEpoch = 0;
  private clockWarning: string | undefined;
  private readonly runtimeDebug = process.env.DEBUG_RUNTIME_COMMANDS === "1";
  private offlineSkipReadTagsCount = 0;
  private offlineSkipReadTagsLogAt = 0;
  private connectTaskSkipLogAt = 0;
  private reconnectRequestedMessage: string | undefined;
  private readonly diagnosticLogAt = new Map<string, number>();
  private readonly readMode: "polling" | "subscription";
  private subscription: ClientSubscription | undefined;
  private readonly monitoredGroups: SubscriptionGroupBinding[] = [];
  private readonly subscribedTagNames = new Set<string>();
  private readonly subscriptionTagsByNodeId = new Map<string, TagDefinition[]>();
  private desiredSubscriptionTags: TagDefinition[] = [];
  private subscriptionOnValues: ((values: TagValue[]) => void) | undefined;
  private subscriptionSetupTask: Promise<void> | undefined;
  private subscriptionEpoch = 0;
  private subscriptionActive = false;
  private lastSubscriptionUpdateAt: number | undefined;
  private subscriptionError: string | undefined;
  private subscriptionState: "inactive" | "creating" | "active" | "error" = "inactive";
  private subscriptionStatusSyncAt = 0;
  private status: DriverStatus;
  private readonly processWarningListener = (warning: Error & { code?: string }) => {
    const text = `${warning.code ?? ""} ${warning.message ?? ""}`;
    if (!this.isClockMismatchWarning(text)) {
      return;
    }
    this.captureClockWarningFromText(text);
  };

  public constructor(private readonly config: OpcUaDriverConfig) {
    this.id = config.id;
    this.readMode = config.readMode ?? "subscription";
    this.status = {
      id: config.id,
      type: this.type,
      health: "stopped",
      updatedAt: Date.now(),
      endpointUrl: config.endpointUrl,
      reconnectAttempt: 0,
      readMode: this.readMode,
      subscriptionState: this.subscriptionState,
      subscriptionActive: false,
      subscribedTagCount: 0,
    };
  }

  public async start(): Promise<void> {
    process.on("warning", this.processWarningListener);
    this.setStatus("starting", "Connecting OPC UA");
    await this.connect();
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    this.connectEpoch += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const inFlightConnect = this.connectTask;
    this.connectTask = undefined;
    this.nextReconnectAttemptAt = 0;
    this.reconnectBackoffMs = 0;
    this.consecutiveFailures = 0;
    this.reconnectAttempt = 0;
    this.connectedSinceAt = 0;
    this.reconnectRequestedMessage = undefined;
    this.clockWarning = undefined;
    this.desiredSubscriptionTags = [];
    this.subscriptionOnValues = undefined;
    this.subscriptionSetupTask = undefined;
    this.subscriptionEpoch += 1;
    await this.cleanupSubscription({ terminate: true, clearDesiredTags: true });
    process.off("warning", this.processWarningListener);

    if (inFlightConnect) {
      await inFlightConnect.catch(() => undefined);
    }

    await this.closeActiveConnection();

    this.setStatus("stopped", "Disconnected by user");
    this.stopping = false;
  }

  public async subscribeTags(tags: TagDefinition[], onValues: (values: TagValue[]) => void): Promise<void> {
    if (this.readMode !== "subscription") {
      return;
    }
    this.subscriptionOnValues = onValues;
    this.subscriptionEpoch += 1;
    this.desiredSubscriptionTags = [...tags];
    this.subscribedTagNames.clear();
    for (const tag of tags) {
      this.subscribedTagNames.add(tag.name);
    }
    this.updateSubscriptionState("creating");
    void this.ensureSubscriptionBackground();
  }

  public async unsubscribe(): Promise<void> {
    this.subscriptionOnValues = undefined;
    this.subscriptionEpoch += 1;
    this.desiredSubscriptionTags = [];
    this.subscribedTagNames.clear();
    await this.cleanupSubscription({ terminate: true, clearDesiredTags: true });
    this.updateSubscriptionState("inactive");
  }

  public async readTag(tag: TagDefinition): Promise<TagValue> {
    const startedAt = Date.now();
    try {
      await this.ensureConnected({ waitForConnect: false });
      const address = extractAddress(tag);
      const dataValue = await this.withTimeout(
        this.session!.read({
          nodeId: address.nodeId,
          attributeId: AttributeIds.Value,
        }),
        this.getOperationTimeoutMs(),
        `OPC UA read timeout for tag ${tag.name}`,
      );

      logPerf({
        driver: "opcua",
        id: this.id,
        action: "readTag",
        tag: tag.name,
        durationMs: Date.now() - startedAt,
        status: "ok",
      });

      return {
        name: tag.name,
        value: toScalar(dataValue),
        quality: dataValue.statusCode.isGood() ? "Good" : "Bad",
        timestamp: Date.now(),
        source: this.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "OPC UA read error";
      if (message === OpcUaDriver.OFFLINE_SKIP_STATUS) {
        logPerf({
          driver: "opcua",
          id: this.id,
          action: "readTag",
          tag: tag.name,
          durationMs: Date.now() - startedAt,
          status: "offline_skip",
        });
      } else {
        await this.handleOperationFailure("readTag", message, startedAt, tag.name);
      }
      return {
        name: tag.name,
        value: null,
        quality: "Bad",
        timestamp: Date.now(),
        source: this.id,
      };
    }
  }

  public async readTags(tags: TagDefinition[]): Promise<TagValue[]> {
    if (tags.length === 0) {
      return [];
    }

    const startedAt = Date.now();
    try {
      await this.ensureConnected({ waitForConnect: false });

      const valid: Array<{ tag: TagDefinition; nodeId: string }> = [];
      const invalid: TagDefinition[] = [];
      for (const tag of tags) {
        try {
          const address = extractAddress(tag);
          valid.push({ tag, nodeId: address.nodeId });
        } catch {
          invalid.push(tag);
        }
      }

      const values: TagValue[] = [];
      if (valid.length > 0) {
        const batchSize = this.getReadBatchSize();
        for (let offset = 0; offset < valid.length; offset += batchSize) {
          await this.ensureConnected({ waitForConnect: false });
          const batch = valid.slice(offset, offset + batchSize);
          const batchStartedAt = Date.now();
          const dataValues = await this.withTimeout(
            this.session!.read(
              batch.map((item) => ({
                nodeId: item.nodeId,
                attributeId: AttributeIds.Value,
              })),
            ),
            this.getOperationTimeoutMs(),
            `OPC UA batch read timeout for ${batch.length} tags`,
          );
          this.logReadBatchDuration(batch.length, offset / batchSize + 1, Math.ceil(valid.length / batchSize), Date.now() - batchStartedAt);

          for (let index = 0; index < batch.length; index += 1) {
            const item = batch[index]!;
            const dataValue = dataValues[index];
            if (!dataValue) {
              values.push({
                name: item.tag.name,
                value: null,
                quality: "Bad",
                timestamp: Date.now(),
                source: this.id,
              });
              continue;
            }

            values.push({
              name: item.tag.name,
              value: toScalar(dataValue),
              quality: dataValue.statusCode.isGood() ? "Good" : "Bad",
              timestamp: Date.now(),
              source: this.id,
            });
          }
        }
      }

      for (const tag of invalid) {
        values.push({
          name: tag.name,
          value: null,
          quality: "Bad",
          timestamp: Date.now(),
          source: this.id,
        });
      }

      logPerf({
        driver: "opcua",
        id: this.id,
        action: "readTags",
        count: tags.length,
        durationMs: Date.now() - startedAt,
        status: "ok",
      });
      return values;
    } catch (error) {
      const message = error instanceof Error ? error.message : "OPC UA read error";
      if (message === OpcUaDriver.OFFLINE_SKIP_STATUS) {
        this.logOfflineSkipReadTags(tags.length);
        logPerf({
          driver: "opcua",
          id: this.id,
          action: "readTags",
          count: tags.length,
          durationMs: Date.now() - startedAt,
          status: "offline_skip",
        });
      } else {
        await this.handleOperationFailure("readTags", message, startedAt, undefined, tags.length);
      }
      return tags.map((tag) => ({
        name: tag.name,
        value: null,
        quality: "Bad" as const,
        timestamp: Date.now(),
        source: this.id,
      }));
    }
  }

  public async writeTag(tag: TagDefinition, value: TagScalarValue): Promise<void> {
    if (!tag.writable) {
      throw new Error(`Tag ${tag.name} is not writable`);
    }

    const startedAt = Date.now();
    try {
      await this.ensureConnected({ waitForConnect: false });
      const address = extractAddress(tag);

      await this.withTimeout(
        this.session!.write({
          nodeId: address.nodeId,
          attributeId: AttributeIds.Value,
          value: {
            value: {
              dataType: toDataType(value),
              value,
            },
          },
        }),
        this.getOperationTimeoutMs(),
        `OPC UA write timeout for tag ${tag.name}`,
      );
      logPerf({
        driver: "opcua",
        id: this.id,
        action: "writeTag",
        tag: tag.name,
        durationMs: Date.now() - startedAt,
        status: "ok",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OPC UA write error";
      if (message !== OpcUaDriver.OFFLINE_SKIP_STATUS) {
        await this.handleOperationFailure("writeTag", message, startedAt, tag.name);
      }
      throw error;
    }
  }

  public getStatus(): DriverStatus {
    return this.status;
  }

  public isAvailable(): boolean {
    if (!this.client || !this.session) {
      return false;
    }
    if (this.stopping || this.reconnectTimer || this.connectTask || this.closeTask) {
      return false;
    }
    if (this.status.health !== "running") {
      return false;
    }
    return this.session.isReconnecting === false;
  }

  private async ensureConnected(options?: { waitForConnect?: boolean }): Promise<void> {
    const waitForConnect = options?.waitForConnect === true;
    if (this.client && this.session && this.status.health === "running") {
      return;
    }

    const offlineReason = this.getOfflineSkipReason();

    if (!waitForConnect) {
      if (offlineReason) {
        this.logOfflineSkipReason(offlineReason);
      }
      throw new Error(OpcUaDriver.OFFLINE_SKIP_STATUS);
    }

    if (this.connectTask) {
      await this.connectTask;
      return;
    }

    if (this.closeTask) {
      const waitStartedAt = Date.now();
      await this.closeTask.catch(() => undefined);
      if (this.runtimeDebug) {
        console.log(`[OpcUaDriver:${this.id}] waited closeTask durationMs=${Date.now() - waitStartedAt}`);
      }
      if (this.client && this.session && this.status.health === "running") {
        return;
      }
    }

    if (this.shouldSkipImmediateConnect()) {
      throw new Error(OpcUaDriver.OFFLINE_SKIP_STATUS);
    }

    await this.connect();
  }

  private shouldSkipImmediateConnect(): boolean {
    if (this.reconnectTimer) {
      return true;
    }
    return Date.now() < this.nextReconnectAttemptAt;
  }

  private async connect(): Promise<void> {
    if (this.connectTask) {
      return this.connectTask;
    }
    if (this.closeTask) {
      const waitStartedAt = Date.now();
      await this.closeTask.catch(() => undefined);
      if (this.runtimeDebug) {
        console.log(`[OpcUaDriver:${this.id}] connect waited closeTask durationMs=${Date.now() - waitStartedAt}`);
      }
    }
    if (this.connectTask) {
      return this.connectTask;
    }

    const startedAt = Date.now();
    this.stopping = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.setStatus(
      this.reconnectAttempt > 0 ? "reconnecting" : "starting",
      this.reconnectAttempt > 0 ? "Reconnecting OPC UA" : "Connecting OPC UA",
    );

    const task = this.connectInternal(startedAt).finally(() => {
      this.connectTask = undefined;
      const deferredMessage = this.reconnectRequestedMessage;
      if (
        deferredMessage
        && !this.stopping
        && !this.reconnectTimer
        && !this.closeTask
        && !this.connectTask
        && (!this.client || !this.session || this.status.health !== "running")
      ) {
        this.reconnectRequestedMessage = undefined;
        this.scheduleReconnect(deferredMessage);
      }
    });
    this.connectTask = task;
    return task;
  }

  private async connectInternal(startedAt: number): Promise<void> {
    const epoch = ++this.connectEpoch;
    try {
      await this.closeActiveConnection();
      const connectTimeoutMs = this.getConnectTimeoutMs();
      const sessionTimeoutMs = this.getSessionTimeoutMs();
      const nextClient = OPCUAClient.create({
        securityMode:
          this.config.securityMode === "Sign"
            ? MessageSecurityMode.Sign
            : this.config.securityMode === "SignAndEncrypt"
              ? MessageSecurityMode.SignAndEncrypt
              : MessageSecurityMode.None,
        securityPolicy:
          this.config.securityPolicy === "Basic256Sha256" ? SecurityPolicy.Basic256Sha256 : SecurityPolicy.None,
        endpointMustExist: false,
        transportTimeout: connectTimeoutMs,
        requestedSessionTimeout: sessionTimeoutMs,
        keepSessionAlive: true,
        keepAliveInterval: this.getKeepAliveIntervalMs(),
        connectionStrategy: {
          // Fail fast on initial startup; reconnection is handled separately below.
          maxRetry: 0,
          initialDelay: 500,
          maxDelay: 2000,
        },
      });
      this.attachClientHandlers(nextClient, epoch);
      this.client = nextClient;

      logPerf({
        driver: "opcua",
        id: this.id,
        action: "connect-start",
        endpoint: this.config.endpointUrl,
      });

      await this.withTimeout(
        nextClient.connect(this.config.endpointUrl),
        connectTimeoutMs,
        `OPC UA connect timeout after ${connectTimeoutMs} ms`,
      );
      const nextSession = this.config.username
        ? await this.withTimeout(
            nextClient.createSession({
              type: UserTokenType.UserName,
              userName: this.config.username,
              password: this.config.password ?? "",
            }),
            connectTimeoutMs,
            `OPC UA session timeout after ${connectTimeoutMs} ms`,
          )
        : await this.withTimeout(
            nextClient.createSession(),
            connectTimeoutMs,
            `OPC UA session timeout after ${connectTimeoutMs} ms`,
          );

      if (this.stopping || epoch !== this.connectEpoch) {
        try {
          await nextSession.close();
        } catch {
          // ignore
        }
        try {
          await nextClient.disconnect();
        } catch {
          // ignore
        }
        return;
      }

      this.attachSessionHandlers(nextSession, epoch);
      this.session = nextSession;
      this.consecutiveFailures = 0;
      this.nextReconnectAttemptAt = 0;
      this.reconnectAttempt = 0;
      this.connectedSinceAt = Date.now();
      this.setStatus("running", "Connected");
      if (this.readMode === "subscription" && this.desiredSubscriptionTags.length > 0) {
        void this.ensureSubscriptionBackground();
      }
      if (this.runtimeDebug) {
        console.log(`[OpcUaDriver:${this.id}] connect durationMs=${Date.now() - startedAt}`);
      }
      logPerf({
        driver: "opcua",
        id: this.id,
        action: "connect-end",
        durationMs: Date.now() - startedAt,
        status: "ok",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OPC UA connect error";
      if (this.isClockMismatchOnlyMessage(message)) {
        this.captureClockWarningFromText(message);
        const stillConnected = Boolean(this.client && this.session && this.status.health === "running");
        logPerf({
          driver: "opcua",
          id: this.id,
          action: "connect-end",
          durationMs: Date.now() - startedAt,
          status: "clock_warning",
          message,
        });
        if (stillConnected) {
          this.setStatus("running", "Connected");
          return;
        }
        throw error;
      }
      this.captureClockWarningFromText(message);
      this.setStatus("error", message);
      await this.closeActiveConnection();
      this.markDisconnectedAndAdjustBackoff();
      this.consecutiveFailures += 1;
      if (!this.stopping) {
        this.scheduleReconnect(message);
      }
      logPerf({
        driver: "opcua",
        id: this.id,
        action: "connect-end",
        durationMs: Date.now() - startedAt,
        status: "error",
        message,
      });
      throw error;
    }
  }

  private scheduleReconnect(message: string): void {
    if (this.stopping || this.reconnectTimer) {
      return;
    }
    if (this.connectTask) {
      this.reconnectRequestedMessage = message;
      this.logDiagnostic("reconnect-deferred-connect", `[OpcUaDriver:${this.id}] reconnect deferred: connectTask is active`, 5_000, true);
      return;
    }
    if (this.closeTask) {
      this.reconnectRequestedMessage = message;
      this.logDiagnostic("reconnect-deferred-close", `[OpcUaDriver:${this.id}] reconnect deferred: closeTask is active`, 5_000, true);
      return;
    }

    const baseDelay = this.getReconnectBaseDelayMs();
    const nextDelay =
      this.reconnectBackoffMs <= 0
        ? baseDelay
        : Math.min(this.reconnectBackoffMs * 2, OpcUaDriver.MAX_RECONNECT_BACKOFF_MS);
    this.reconnectBackoffMs = nextDelay;
    this.nextReconnectAttemptAt = Date.now() + nextDelay;
    this.reconnectAttempt += 1;
    this.reconnectRequestedMessage = undefined;
    this.setStatus("reconnecting", message);
    this.logDiagnostic("reconnect-scheduled", `[OpcUaDriver:${this.id}] reconnect scheduled in ${nextDelay} ms`, 2_000);
    logPerf({
      driver: "opcua",
      id: this.id,
      action: "reconnect-scheduled",
      delayMs: nextDelay,
      failures: this.consecutiveFailures,
      message,
    });
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        await this.connect();
      } catch {
        // connect() handles scheduling
      }
    }, nextDelay);
  }

  private attachClientHandlers(client: OPCUAClient, epoch: number): void {
    const eventClient = client as unknown as { on: (event: string, callback: (...args: unknown[]) => void) => void };
    eventClient.on("connection_lost", () => {
      if (!this.isActiveConnection(client, epoch)) {
        return;
      }
      this.handleConnectionLoss("OPC UA connection lost");
    });
    eventClient.on("timed_out", () => {
      if (!this.isActiveConnection(client, epoch)) {
        return;
      }
      this.handleConnectionLoss("OPC UA connection timed out");
    });
    client.on("close", (error?: Error | null) => {
      if (!this.isActiveConnection(client, epoch)) {
        return;
      }
      const message = error instanceof Error && error.message ? error.message : "OPC UA connection closed";
      this.handleConnectionLoss(message);
    });
  }

  private attachSessionHandlers(session: ClientSession, epoch: number): void {
    const eventSession = session as unknown as { on: (event: string, callback: (...args: unknown[]) => void) => void };
    eventSession.on("session_closed", () => {
      if (!this.isActiveSession(session, epoch)) {
        return;
      }
      this.handleConnectionLoss("OPC UA session closed");
    });
    eventSession.on("keepalive_failure", () => {
      if (!this.isActiveSession(session, epoch)) {
        return;
      }
      this.handleConnectionLoss("OPC UA keepalive failure");
    });
  }

  private handleConnectionLoss(message: string): void {
    if (this.stopping) {
      return;
    }
    void this.handleConnectionLossInternal(message);
  }

  private async handleConnectionLossInternal(message: string): Promise<void> {
    if (this.stopping) {
      return;
    }
    if (this.isClockMismatchOnlyMessage(message)) {
      this.captureClockWarningFromText(message);
      logPerf({
        driver: "opcua",
        id: this.id,
        action: "connection-loss",
        status: "clock_warning",
        message,
      });
      return;
    }
    this.captureClockWarningFromText(message);
    this.connectEpoch += 1;
    this.markDisconnectedAndAdjustBackoff();
    this.consecutiveFailures += 1;
    await this.cleanupSubscription({ terminate: false });
    this.setStatus("error", message);
    await this.closeActiveConnection();
    if (this.stopping) {
      return;
    }
    this.scheduleReconnect(message);
  }

  private async closeActiveConnection(): Promise<void> {
    if (this.closeTask) {
      return this.closeTask;
    }
    const session = this.session;
    const client = this.client;
    await this.cleanupSubscription({ terminate: false });
    this.session = undefined;
    this.client = undefined;
    this.connectedSinceAt = 0;
    const startedAt = Date.now();
    this.closeTask = (async () => {
      if (this.runtimeDebug) {
        console.log(`[OpcUaDriver:${this.id}] close-start`);
      }
      if (session) {
        try {
          await session.close();
        } catch {
          // ignore
        }
      }
      if (client) {
        try {
          await client.disconnect();
        } catch {
          // ignore
        }
      }
      if (this.runtimeDebug) {
        console.log(`[OpcUaDriver:${this.id}] close-end durationMs=${Date.now() - startedAt}`);
      }
    })().finally(() => {
      this.closeTask = undefined;
      const deferredMessage = this.reconnectRequestedMessage;
      if (
        deferredMessage
        && !this.stopping
        && !this.reconnectTimer
        && !this.connectTask
        && !this.closeTask
        && (!this.client || !this.session || this.status.health !== "running")
      ) {
        this.reconnectRequestedMessage = undefined;
        this.scheduleReconnect(deferredMessage);
      }
    });
    return this.closeTask;
  }

  private setStatus(health: DriverStatus["health"], message?: string): void {
    const now = Date.now();
    const isConnected = health === "running";
    const isDisconnected = health === "error" || health === "reconnecting" || health === "stopped" || health === "disabled";
    let nextLastError = this.status.lastError;
    let nextLastErrorAt = this.status.lastErrorAt;
    if (health === "error") {
      nextLastError = message ?? this.status.lastError;
      nextLastErrorAt = message ? now : this.status.lastErrorAt;
    } else if (health === "reconnecting") {
      if (message && !this.isTransientReconnectMessage(message)) {
        nextLastError = message;
        nextLastErrorAt = now;
      }
    } else if (health === "running" && this.isTransientReconnectMessage(this.status.lastError)) {
      nextLastError = undefined;
      nextLastErrorAt = undefined;
    }
    this.status = {
      ...this.status,
      health,
      message,
      updatedAt: now,
      endpointUrl: this.config.endpointUrl,
      reconnectAttempt: this.reconnectAttempt,
      lastConnectedAt: isConnected ? now : this.status.lastConnectedAt,
      lastDisconnectedAt: isDisconnected ? now : this.status.lastDisconnectedAt,
      lastError: nextLastError,
      lastErrorAt: nextLastErrorAt,
      clockWarning: this.clockWarning,
      readMode: this.readMode,
      subscriptionActive: this.subscriptionActive,
      subscribedTagCount: this.subscribedTagNames.size,
      lastSubscriptionUpdateAt: this.lastSubscriptionUpdateAt,
      subscriptionError: this.subscriptionError,
      subscriptionState: this.subscriptionState,
    };
  }

  private isActiveConnection(client: OPCUAClient, epoch: number): boolean {
    return !this.stopping && this.client === client && epoch === this.connectEpoch;
  }

  private isActiveSession(session: ClientSession, epoch: number): boolean {
    return !this.stopping && this.session === session && epoch === this.connectEpoch;
  }

  private isClockMismatchWarning(text: string): boolean {
    const normalized = text.toLowerCase();
    return normalized.includes("node-opcua-w33")
      || normalized.includes("clock discrepancy")
      || normalized.includes("time discrepancy")
      || normalized.includes("server token creation date exposes");
  }

  private isClockMismatchOnlyMessage(text: string): boolean {
    if (!this.isClockMismatchWarning(text)) {
      return false;
    }
    const normalized = text.toLowerCase();
    const fatalHints = [
      "timeout",
      "timed out",
      "connection lost",
      "session closed",
      "keepalive failure",
      "socket",
      "econn",
      "badconnection",
      "channel closed",
      "servicefault",
    ];
    return fatalHints.every((hint) => !normalized.includes(hint));
  }

  private captureClockWarningFromText(text: string): void {
    if (!this.isClockMismatchWarning(text)) {
      return;
    }
    const nextWarning = text.trim() || OpcUaDriver.CLOCK_WARNING_HELP;
    if (this.clockWarning === nextWarning) {
      return;
    }
    this.clockWarning = nextWarning;
    this.logDiagnostic("clock-warning", `[OpcUaDriver:${this.id}] clock warning captured`, 10_000);
    this.setStatus(this.status.health, this.status.message);
  }

  private getConnectTimeoutMs(): number {
    return Math.max(500, this.config.connectTimeoutMs ?? this.config.timeoutMs ?? OpcUaDriver.DEFAULT_CONNECT_TIMEOUT_MS);
  }

  private getOperationTimeoutMs(): number {
    return Math.max(500, this.config.operationTimeoutMs ?? this.config.timeoutMs ?? OpcUaDriver.DEFAULT_OPERATION_TIMEOUT_MS);
  }

  private getSessionTimeoutMs(): number {
    return Math.max(1000, this.config.sessionTimeoutMs ?? OpcUaDriver.DEFAULT_SESSION_TIMEOUT_MS);
  }

  private getKeepAliveIntervalMs(): number {
    return Math.max(500, this.config.keepAliveIntervalMs ?? OpcUaDriver.DEFAULT_KEEP_ALIVE_INTERVAL_MS);
  }

  private getReconnectBaseDelayMs(): number {
    return Math.max(5000, this.config.reconnectMs ?? OpcUaDriver.DEFAULT_RECONNECT_MS);
  }

  private getPublishingIntervalMs(): number {
    return Math.max(50, this.config.publishingIntervalMs ?? OpcUaDriver.DEFAULT_PUBLISHING_INTERVAL_MS);
  }

  private getSamplingIntervalMs(): number {
    return Math.max(50, this.config.samplingIntervalMs ?? OpcUaDriver.DEFAULT_SAMPLING_INTERVAL_MS);
  }

  private getQueueSize(): number {
    return Math.max(1, this.config.queueSize ?? OpcUaDriver.DEFAULT_QUEUE_SIZE);
  }

  private getDiscardOldest(): boolean {
    return this.config.discardOldest ?? OpcUaDriver.DEFAULT_DISCARD_OLDEST;
  }

  private getSubscriptionBatchSize(): number {
    return Math.max(1, this.config.subscriptionBatchSize ?? OpcUaDriver.DEFAULT_SUBSCRIPTION_BATCH_SIZE);
  }

  private updateSubscriptionState(state: "inactive" | "creating" | "active" | "error", errorText?: string): void {
    this.subscriptionState = state;
    this.subscriptionActive = state === "active";
    if (errorText !== undefined) {
      this.subscriptionError = errorText || undefined;
    } else if (state === "active") {
      this.subscriptionError = undefined;
    }
    this.setStatus(this.status.health, this.status.message);
  }

  private ensureSubscriptionBackground(): void {
    if (this.readMode !== "subscription") {
      return;
    }
    if (this.subscriptionSetupTask) {
      return;
    }
    this.subscriptionSetupTask = this.ensureSubscriptionInternal()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message === OpcUaDriver.OFFLINE_SKIP_STATUS) {
          this.updateSubscriptionState("inactive");
          return;
        }
        this.updateSubscriptionState("error", message || "Subscription setup failed");
      })
      .finally(() => {
        this.subscriptionSetupTask = undefined;
      });
  }

  private async ensureSubscriptionInternal(): Promise<void> {
    const epoch = this.subscriptionEpoch;
    if (this.readMode !== "subscription") {
      return;
    }
    if (this.desiredSubscriptionTags.length === 0 || !this.subscriptionOnValues) {
      await this.cleanupSubscription({ terminate: true });
      this.updateSubscriptionState("inactive");
      return;
    }

    await this.ensureConnected({ waitForConnect: false });
    if (epoch !== this.subscriptionEpoch) {
      return;
    }
    if (!this.session) {
      throw new Error(OpcUaDriver.OFFLINE_SKIP_STATUS);
    }

    const validTargets: Array<{ tag: TagDefinition; nodeId: string }> = [];
    const invalidTags: TagDefinition[] = [];
    for (const tag of this.desiredSubscriptionTags) {
      try {
        const address = extractAddress(tag);
        validTargets.push({ tag, nodeId: address.nodeId });
      } catch {
        invalidTags.push(tag);
      }
    }

    if (invalidTags.length > 0) {
      this.publishBadValues(invalidTags);
    }

    if (validTargets.length === 0) {
      await this.cleanupSubscription({ terminate: true });
      this.updateSubscriptionState("inactive");
      return;
    }

    await this.cleanupSubscription({ terminate: true });
    if (epoch !== this.subscriptionEpoch) {
      return;
    }
    if (!this.session) {
      throw new Error(OpcUaDriver.OFFLINE_SKIP_STATUS);
    }

    const subscription = ClientSubscription.create(this.session, {
      requestedPublishingInterval: this.getPublishingIntervalMs(),
      requestedLifetimeCount: 240,
      requestedMaxKeepAliveCount: 20,
      maxNotificationsPerPublish: 0,
      publishingEnabled: true,
      priority: 1,
    });
    this.subscription = subscription;
    this.attachSubscriptionHandlers(subscription);
    this.updateSubscriptionState("creating");

    const tagsByNodeId = new Map<string, TagDefinition[]>();
    for (const target of validTargets) {
      const group = tagsByNodeId.get(target.nodeId);
      if (group) {
        group.push(target.tag);
      } else {
        tagsByNodeId.set(target.nodeId, [target.tag]);
      }
    }
    this.subscriptionTagsByNodeId.clear();
    for (const [nodeId, tags] of tagsByNodeId.entries()) {
      this.subscriptionTagsByNodeId.set(nodeId, tags);
    }

    const nodeIds = [...tagsByNodeId.keys()];
    const batchSize = this.getSubscriptionBatchSize();
    const monitoringParameters: MonitoringParametersOptions = {
      samplingInterval: this.getSamplingIntervalMs(),
      queueSize: this.getQueueSize(),
      discardOldest: this.getDiscardOldest(),
    };

    let monitoredNodes = 0;
    for (let index = 0; index < nodeIds.length; index += batchSize) {
      if (epoch !== this.subscriptionEpoch) {
        return;
      }
      await this.ensureConnected({ waitForConnect: false });
      if (this.subscription !== subscription) {
        return;
      }
      const batchNodeIds = nodeIds.slice(index, index + batchSize);
      const itemsToMonitor: ReadValueIdOptions[] = batchNodeIds.map((nodeId) => ({
        nodeId,
        attributeId: AttributeIds.Value,
      }));

      try {
        const group = await this.withTimeout(
          subscription.monitorItems(itemsToMonitor, monitoringParameters, TimestampsToReturn.Both),
          this.getOperationTimeoutMs(),
          `OPC UA subscription batch timeout for ${batchNodeIds.length} items`,
        );
        const binding: SubscriptionGroupBinding = {
          group,
          nodeIds: batchNodeIds,
        };
        group.on("changed", (_monitoredItem, dataValue, itemIndex) => {
          const nodeId = binding.nodeIds[itemIndex];
          if (!nodeId) {
            return;
          }
          this.handleSubscriptionValue(nodeId, dataValue);
        });
        group.on("err", (message) => {
          this.updateSubscriptionState("error", String(message || "Subscription group error"));
        });
        this.monitoredGroups.push(binding);
        monitoredNodes += batchNodeIds.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logDiagnostic(
          "subscription-batch-error",
          `[OpcUaDriver:${this.id}] subscription batch failed items=${batchNodeIds.length} error=${message}`,
          2_000,
        );
        const failedTags: TagDefinition[] = [];
        for (const nodeId of batchNodeIds) {
          failedTags.push(...(this.subscriptionTagsByNodeId.get(nodeId) ?? []));
        }
        this.publishBadValues(failedTags);
        this.subscriptionError = message;
      }

      await this.yieldToEventLoop();
    }

    if (monitoredNodes > 0) {
      this.updateSubscriptionState("active");
      this.logDiagnostic(
        "subscription-active",
        `[OpcUaDriver:${this.id}] subscription active tags=${this.subscribedTagNames.size} nodes=${monitoredNodes}`,
        5_000,
      );
      return;
    }

    this.updateSubscriptionState("error", this.subscriptionError ?? "Failed to monitor OPC UA tags");
  }

  private attachSubscriptionHandlers(subscription: ClientSubscription): void {
    subscription.on("internal_error", (error) => {
      if (this.subscription !== subscription) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.updateSubscriptionState("error", message || "Subscription internal error");
    });
    subscription.on("error", (error) => {
      if (this.subscription !== subscription) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.updateSubscriptionState("error", message || "Subscription error");
    });
    subscription.on("terminated", () => {
      if (this.subscription !== subscription) {
        return;
      }
      this.subscription = undefined;
      this.monitoredGroups.length = 0;
      this.updateSubscriptionState("inactive");
      if (!this.stopping && this.desiredSubscriptionTags.length > 0) {
        void this.ensureSubscriptionBackground();
      }
    });
  }

  private handleSubscriptionValue(nodeId: string, dataValue: DataValue): void {
    const tags = this.subscriptionTagsByNodeId.get(nodeId);
    const callback = this.subscriptionOnValues;
    if (!tags || tags.length === 0 || !callback) {
      return;
    }
    const quality = dataValue.statusCode.isGood() ? "Good" : "Bad";
    const timestamp = Date.now();
    const value = toScalar(dataValue);
    const updates: TagValue[] = tags.map((tag) => ({
      name: tag.name,
      value,
      quality,
      timestamp,
      source: this.id,
    }));
    this.lastSubscriptionUpdateAt = timestamp;
    if (this.subscriptionState !== "active") {
      this.subscriptionState = "active";
      this.subscriptionActive = true;
      this.subscriptionError = undefined;
      this.setStatus(this.status.health, this.status.message);
    } else if (this.subscriptionError) {
      this.subscriptionError = undefined;
      this.setStatus(this.status.health, this.status.message);
    } else if (timestamp - this.subscriptionStatusSyncAt >= 1_000) {
      this.subscriptionStatusSyncAt = timestamp;
      this.setStatus(this.status.health, this.status.message);
    }
    callback(updates);
  }

  private publishBadValues(tags: TagDefinition[]): void {
    const callback = this.subscriptionOnValues;
    if (!callback || tags.length === 0) {
      return;
    }
    const timestamp = Date.now();
    callback(tags.map((tag) => ({
      name: tag.name,
      value: null,
      quality: "Bad" as const,
      timestamp,
      source: this.id,
    })));
  }

  private async cleanupSubscription(options?: { terminate?: boolean; clearDesiredTags?: boolean }): Promise<void> {
    const terminate = options?.terminate ?? true;
    const activeSubscription = this.subscription;
    this.subscription = undefined;
    this.monitoredGroups.length = 0;
    this.subscriptionTagsByNodeId.clear();
    this.subscriptionActive = false;
    this.subscriptionState = "inactive";
    this.subscriptionError = undefined;
    this.setStatus(this.status.health, this.status.message);
    if (options?.clearDesiredTags) {
      this.desiredSubscriptionTags = [];
      this.subscribedTagNames.clear();
    }
    if (!activeSubscription || !terminate) {
      return;
    }
    try {
      await activeSubscription.terminate();
    } catch {
      // ignore
    }
  }

  private async yieldToEventLoop(): Promise<void> {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }

  private logOfflineSkipReadTags(tagCount: number): void {
    if (!this.runtimeDebug) {
      return;
    }
    this.offlineSkipReadTagsCount += 1;
    const now = Date.now();
    if (now - this.offlineSkipReadTagsLogAt < 1000) {
      return;
    }
    const count = this.offlineSkipReadTagsCount;
    this.offlineSkipReadTagsCount = 0;
    this.offlineSkipReadTagsLogAt = now;
    console.log(`[OpcUaDriver:${this.id}] readTags offline_skip count=${count} lastTagCount=${tagCount}`);
  }

  private getReadBatchSize(): number {
    return OpcUaDriver.DEFAULT_READ_BATCH_SIZE;
  }

  private logReadBatchDuration(batchTagCount: number, batchIndex: number, batchTotal: number, durationMs: number): void {
    if (this.runtimeDebug) {
      console.log(
        `[OpcUaDriver:${this.id}] read batch ${batchIndex}/${batchTotal} tags=${batchTagCount} durationMs=${durationMs}`,
      );
    }
    logPerf({
      driver: "opcua",
      id: this.id,
      action: "readTags-batch",
      count: batchTagCount,
      durationMs,
      batch: `${batchIndex}/${batchTotal}`,
      status: "ok",
    });
  }

  private markDisconnectedAndAdjustBackoff(): void {
    const now = Date.now();
    const stableForMs = this.connectedSinceAt > 0 ? now - this.connectedSinceAt : 0;
    this.connectedSinceAt = 0;
    if (stableForMs >= OpcUaDriver.STABLE_CONNECTION_RESET_MS) {
      this.reconnectBackoffMs = 0;
      this.consecutiveFailures = 0;
    }
  }

  private getOfflineSkipReason(): string | undefined {
    if (this.connectTask) {
      return "connectTask_active";
    }
    if (this.closeTask) {
      return "closeTask_active";
    }
    if (this.reconnectTimer) {
      return "reconnect_timer_active";
    }
    if (Date.now() < this.nextReconnectAttemptAt) {
      return "reconnect_window";
    }
    if (!this.client || !this.session) {
      return "session_or_client_missing";
    }
    if (this.status.health !== "running") {
      return `status_${this.status.health}`;
    }
    return undefined;
  }

  private logOfflineSkipReason(reason: string): void {
    const now = Date.now();
    if (this.runtimeDebug && now - this.connectTaskSkipLogAt >= 1_000) {
      this.connectTaskSkipLogAt = now;
      console.log(`[OpcUaDriver:${this.id}] ensureConnected skip reason=${reason}`);
      return;
    }
    this.logDiagnostic("ensure-connected-offline-skip", `[OpcUaDriver:${this.id}] polling skipped: ${reason}`, 10_000);
  }

  private isTransientReconnectMessage(message: string | undefined): boolean {
    if (!message) {
      return false;
    }
    const normalized = message.toLowerCase();
    return normalized === "reconnecting opc ua" || normalized === "connecting opc ua";
  }

  private logDiagnostic(key: string, message: string, throttleMs: number, debugOnly = false): void {
    if (debugOnly && !this.runtimeDebug) {
      return;
    }
    const now = Date.now();
    const lastAt = this.diagnosticLogAt.get(key) ?? 0;
    if (now - lastAt < throttleMs) {
      return;
    }
    this.diagnosticLogAt.set(key, now);
    console.log(message);
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      });
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async handleOperationFailure(
    action: "readTag" | "readTags" | "writeTag",
    message: string,
    startedAt: number,
    tag?: string,
    count?: number,
  ): Promise<void> {
    if (this.isClockMismatchOnlyMessage(message)) {
      this.captureClockWarningFromText(message);
      logPerf({
        driver: "opcua",
        id: this.id,
        action,
        status: "clock_warning",
        durationMs: Date.now() - startedAt,
        tag,
        count,
        message,
      });
      return;
    }
    this.captureClockWarningFromText(message);
    this.connectEpoch += 1;
    this.markDisconnectedAndAdjustBackoff();
    this.consecutiveFailures += 1;
    this.setStatus("error", message);
    await this.closeActiveConnection();
    if (!this.stopping) {
      this.scheduleReconnect(message);
    }
    logPerf({
      driver: "opcua",
      id: this.id,
      action,
      status: "error",
      durationMs: Date.now() - startedAt,
      tag,
      count,
      message,
    });
  }
}
