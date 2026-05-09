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

  private client: OPCUAClient | undefined;
  private session: ClientSession | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.session) {
      await this.session.close();
      this.session = undefined;
    }

    if (this.client) {
      await this.client.disconnect();
      this.client = undefined;
    }

    this.setStatus("stopped");
  }

  public async readTag(tag: TagDefinition): Promise<TagValue> {
    const now = Date.now();
    try {
      await this.ensureConnected();
      const address = extractAddress(tag);
      const dataValue = await this.session!.read({
        nodeId: address.nodeId,
        attributeId: AttributeIds.Value,
      });

      return {
        name: tag.name,
        value: toScalar(dataValue),
        quality: dataValue.statusCode.isGood() ? "Good" : "Bad",
        timestamp: now,
        source: this.id,
      };
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : "OPC UA read error");
      return {
        name: tag.name,
        value: null,
        quality: "Bad",
        timestamp: now,
        source: this.id,
      };
    }
  }

  public async readTags(tags: TagDefinition[]): Promise<TagValue[]> {
    if (tags.length === 0) {
      return [];
    }

    const now = Date.now();
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
        const dataValues = await this.session!.read(
          valid.map((item) => ({
            nodeId: item.nodeId,
            attributeId: AttributeIds.Value,
          })),
        );

        for (let index = 0; index < valid.length; index += 1) {
          const item = valid[index]!;
          const dataValue = dataValues[index];
          if (!dataValue) {
            values.push({
              name: item.tag.name,
              value: null,
              quality: "Bad",
              timestamp: now,
              source: this.id,
            });
            continue;
          }

          values.push({
            name: item.tag.name,
            value: toScalar(dataValue),
            quality: dataValue.statusCode.isGood() ? "Good" : "Bad",
            timestamp: now,
            source: this.id,
          });
        }
      }

      for (const tag of invalid) {
        values.push({
          name: tag.name,
          value: null,
          quality: "Bad",
          timestamp: now,
          source: this.id,
        });
      }

      return values;
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : "OPC UA read error");
      return tags.map((tag) => ({
        name: tag.name,
        value: null,
        quality: "Bad" as const,
        timestamp: now,
        source: this.id,
      }));
    }
  }

  public async writeTag(tag: TagDefinition, value: TagScalarValue): Promise<void> {
    if (!tag.writable) {
      throw new Error(`Tag ${tag.name} is not writable`);
    }

    await this.ensureConnected();
    const address = extractAddress(tag);

    await this.session!.write({
      nodeId: address.nodeId,
      attributeId: AttributeIds.Value,
      value: {
        value: {
          dataType: toDataType(value),
          value,
        },
      },
    });
  }

  public getStatus(): DriverStatus {
    return this.status;
  }

  private async ensureConnected(): Promise<void> {
    if (this.client && this.session) {
      return;
    }

    await this.connect();
  }

  private async connect(): Promise<void> {
    try {
      this.client = OPCUAClient.create({
        securityMode:
          this.config.securityMode === "Sign"
            ? MessageSecurityMode.Sign
            : this.config.securityMode === "SignAndEncrypt"
              ? MessageSecurityMode.SignAndEncrypt
              : MessageSecurityMode.None,
        securityPolicy:
          this.config.securityPolicy === "Basic256Sha256" ? SecurityPolicy.Basic256Sha256 : SecurityPolicy.None,
        endpointMustExist: false,
        transportTimeout: this.config.timeoutMs ?? 5000,
        connectionStrategy: {
          // Fail fast on initial startup; reconnection is handled separately below.
          maxRetry: 0,
          initialDelay: 500,
          maxDelay: 1000,
        },
      });

      await this.client.connect(this.config.endpointUrl);
      if (this.config.username) {
        this.session = await this.client.createSession({
          type: UserTokenType.UserName,
          userName: this.config.username,
          password: this.config.password ?? "",
        });
      } else {
        this.session = await this.client.createSession();
      }
      this.setStatus("running");
    } catch (error) {
      this.session = undefined;
      this.client = undefined;
      this.scheduleReconnect(error instanceof Error ? error.message : "OPC UA connect error");
      throw error;
    }
  }

  private scheduleReconnect(message: string): void {
    if (this.reconnectTimer) {
      return;
    }

    this.setStatus("reconnecting", message);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect(message);
      }
    }, this.config.reconnectMs ?? 3000);
  }

  private setStatus(health: DriverStatus["health"], message?: string): void {
    this.status = {
      ...this.status,
      health,
      message,
      updatedAt: Date.now(),
    };
  }
}
