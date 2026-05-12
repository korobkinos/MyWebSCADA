import {
  AttributeIds,
  DataType,
  MessageSecurityMode,
  OPCUAClient,
  SecurityPolicy,
  UserTokenType,
  type ClientSession,
  type DataValue,
} from "node-opcua";
import type { OpcUaDriverConfig, TagDefinition, TagScalarValue, TagValue } from "@web-scada/shared";
import type { Driver, DriverStatus } from "./driver.js";
import { logPerf } from "../runtime/perf-logger.js";

type OpcUaAddress = { nodeId: string };

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

  private static readonly DEFAULT_CONNECT_TIMEOUT_MS = 2000;
  private static readonly DEFAULT_OPERATION_TIMEOUT_MS = 2000;
  private static readonly MAX_RECONNECT_BACKOFF_MS = 30000;
  private static readonly OFFLINE_SKIP_STATUS = "OPC UA offline; waiting for reconnect window";

  private client: OPCUAClient | undefined;
  private session: ClientSession | undefined;
  private connectTask: Promise<void> | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectBackoffMs = 0;
  private nextReconnectAttemptAt = 0;
  private consecutiveFailures = 0;
  private stopping = false;
  private status: DriverStatus;

  public constructor(private readonly config: OpcUaDriverConfig) {
    this.id = config.id;
    this.status = {
      id: config.id,
      type: this.type,
      health: "stopped",
      updatedAt: Date.now(),
    };
  }

  public async start(): Promise<void> {
    this.setStatus("starting", "Connecting OPC UA");
    await this.connect();
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.connectTask = undefined;
    this.nextReconnectAttemptAt = 0;
    this.reconnectBackoffMs = 0;
    this.consecutiveFailures = 0;

    await this.closeActiveConnection();

    this.setStatus("stopped");
    this.stopping = false;
  }

  public async readTag(tag: TagDefinition): Promise<TagValue> {
    const startedAt = Date.now();
    try {
      await this.ensureConnected();
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
      this.handleOperationFailure("readTag", message, startedAt, tag.name);
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
      await this.ensureConnected();

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
        const dataValues = await this.withTimeout(
          this.session!.read(
            valid.map((item) => ({
              nodeId: item.nodeId,
              attributeId: AttributeIds.Value,
            })),
          ),
          this.getOperationTimeoutMs(),
          `OPC UA batch read timeout for ${valid.length} tags`,
        );

        for (let index = 0; index < valid.length; index += 1) {
          const item = valid[index]!;
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
        logPerf({
          driver: "opcua",
          id: this.id,
          action: "readTags",
          count: tags.length,
          durationMs: Date.now() - startedAt,
          status: "offline_skip",
        });
      } else {
        this.handleOperationFailure("readTags", message, startedAt, undefined, tags.length);
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
      await this.ensureConnected();
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
        this.handleOperationFailure("writeTag", message, startedAt, tag.name);
      }
      throw error;
    }
  }

  public getStatus(): DriverStatus {
    return this.status;
  }

  private async ensureConnected(): Promise<void> {
    if (this.client && this.session) {
      return;
    }

    if (this.connectTask) {
      await this.connectTask;
      return;
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

    const startedAt = Date.now();
    this.stopping = false;
    this.setStatus("starting", "Connecting OPC UA");

    const task = this.connectInternal(startedAt).finally(() => {
      this.connectTask = undefined;
    });
    this.connectTask = task;
    return task;
  }

  private async connectInternal(startedAt: number): Promise<void> {
    try {
      await this.closeActiveConnection();
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
        transportTimeout: this.getConnectTimeoutMs(),
        requestedSessionTimeout: Math.max(this.getConnectTimeoutMs(), 1500),
        connectionStrategy: {
          // Fail fast on initial startup; reconnection is handled separately below.
          maxRetry: 0,
          initialDelay: 200,
          maxDelay: 800,
        },
      });
      this.attachClientHandlers(nextClient);
      this.client = nextClient;

      logPerf({
        driver: "opcua",
        id: this.id,
        action: "connect-start",
        endpoint: this.config.endpointUrl,
      });

      await this.withTimeout(
        nextClient.connect(this.config.endpointUrl),
        this.getConnectTimeoutMs(),
        `OPC UA connect timeout after ${this.getConnectTimeoutMs()} ms`,
      );
      if (this.config.username) {
        this.session = await this.withTimeout(
          nextClient.createSession({
            type: UserTokenType.UserName,
            userName: this.config.username,
            password: this.config.password ?? "",
          }),
          this.getConnectTimeoutMs(),
          `OPC UA session timeout after ${this.getConnectTimeoutMs()} ms`,
        );
      } else {
        this.session = await this.withTimeout(
          nextClient.createSession(),
          this.getConnectTimeoutMs(),
          `OPC UA session timeout after ${this.getConnectTimeoutMs()} ms`,
        );
      }
      this.consecutiveFailures = 0;
      this.reconnectBackoffMs = 0;
      this.nextReconnectAttemptAt = 0;
      this.setStatus("running");
      logPerf({
        driver: "opcua",
        id: this.id,
        action: "connect-end",
        durationMs: Date.now() - startedAt,
        status: "ok",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OPC UA connect error";
      await this.closeActiveConnection();
      this.setStatus("error", message);
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

    const baseDelay = Math.max(500, this.config.reconnectMs ?? 3000);
    const nextDelay =
      this.reconnectBackoffMs <= 0
        ? baseDelay
        : Math.min(this.reconnectBackoffMs * 2, OpcUaDriver.MAX_RECONNECT_BACKOFF_MS);
    this.reconnectBackoffMs = nextDelay;
    this.nextReconnectAttemptAt = Date.now() + nextDelay;
    this.setStatus("reconnecting", message);
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

  private attachClientHandlers(client: OPCUAClient): void {
    const eventClient = client as unknown as { on: (event: string, callback: (...args: unknown[]) => void) => void };
    eventClient.on("connection_lost", () => {
      this.handleConnectionLoss("OPC UA connection lost");
    });
    eventClient.on("timed_out", () => {
      this.handleConnectionLoss("OPC UA connection timed out");
    });
    client.on("close", (error?: Error | null) => {
      const message = error instanceof Error && error.message ? error.message : "OPC UA connection closed";
      this.handleConnectionLoss(message);
    });
  }

  private handleConnectionLoss(message: string): void {
    if (this.stopping) {
      return;
    }
    this.session = undefined;
    this.client = undefined;
    this.consecutiveFailures += 1;
    this.setStatus("error", message);
    this.scheduleReconnect(message);
  }

  private async closeActiveConnection(): Promise<void> {
    const session = this.session;
    const client = this.client;
    this.session = undefined;
    this.client = undefined;
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
  }

  private setStatus(health: DriverStatus["health"], message?: string): void {
    this.status = {
      ...this.status,
      health,
      message,
      updatedAt: Date.now(),
    };
  }

  private getConnectTimeoutMs(): number {
    return Math.max(500, this.config.timeoutMs ?? OpcUaDriver.DEFAULT_CONNECT_TIMEOUT_MS);
  }

  private getOperationTimeoutMs(): number {
    return Math.max(500, this.config.timeoutMs ?? OpcUaDriver.DEFAULT_OPERATION_TIMEOUT_MS);
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

  private handleOperationFailure(
    action: "readTag" | "readTags" | "writeTag",
    message: string,
    startedAt: number,
    tag?: string,
    count?: number,
  ): void {
    this.consecutiveFailures += 1;
    this.session = undefined;
    this.client = undefined;
    this.scheduleReconnect(message);
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
