import ModbusRTU from "modbus-serial";
import type { ModbusAddress, ModbusTcpDriverConfig, TagDefinition, TagScalarValue, TagValue } from "@web-scada/shared";
import type { Driver, DriverStatus } from "./driver.js";

function ensureModbusAddress(address: TagDefinition["address"]): ModbusAddress {
  if (!address || typeof address !== "object") {
    throw new Error("Modbus tag requires address");
  }

  const a = address as Record<string, unknown>;
  if (typeof a.registerType !== "string" || typeof a.address !== "number" || typeof a.dataType !== "string") {
    throw new Error("Invalid Modbus address format");
  }

  return {
    registerType: a.registerType as ModbusAddress["registerType"],
    address: a.address,
    dataType: a.dataType as ModbusAddress["dataType"],
    byteOrder: (a.byteOrder as ModbusAddress["byteOrder"]) ?? "ABCD",
  };
}

function decode32Bit(words: number[], byteOrder: ModbusAddress["byteOrder"]): Buffer {
  const raw = Buffer.alloc(4);
  raw.writeUInt16BE(words[0] ?? 0, 0);
  raw.writeUInt16BE(words[1] ?? 0, 2);

  const order = byteOrder ?? "ABCD";
  const indexMap: Record<NonNullable<ModbusAddress["byteOrder"]>, number[]> = {
    ABCD: [0, 1, 2, 3],
    BADC: [1, 0, 3, 2],
    CDAB: [2, 3, 0, 1],
    DCBA: [3, 2, 1, 0],
  };

  return Buffer.from(indexMap[order].map((index) => raw[index]!));
}

export class ModbusDriver implements Driver {
  public readonly id: string;
  public readonly type = "modbus-tcp";

  private readonly client = new ModbusRTU();
  private reconnectTimer: NodeJS.Timeout | undefined;
  private connected = false;
  private status: DriverStatus;

  public constructor(private readonly config: ModbusTcpDriverConfig) {
    this.id = config.id;
    this.status = {
      id: config.id,
      type: this.type,
      health: "stopped",
      updatedAt: Date.now(),
    };
  }

  public async start(): Promise<void> {
    this.setStatus("starting", "Connecting to Modbus TCP");
    await this.connect();
  }

  public async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    try {
      await this.client.close();
    } catch {
      // ignore close errors for shutdown
    }

    this.connected = false;
    this.setStatus("stopped");
  }

  public async readTag(tag: TagDefinition): Promise<TagValue> {
    const now = Date.now();

    try {
      await this.ensureConnected();
      const address = ensureModbusAddress(tag.address);
      const value = await this.readAddress(address);
      return {
        name: tag.name,
        value,
        quality: "Good",
        timestamp: now,
        source: this.id,
      };
    } catch (error) {
      this.connected = false;
      this.scheduleReconnect(error instanceof Error ? error.message : "Read error");
      return {
        name: tag.name,
        value: null,
        quality: "Bad",
        timestamp: now,
        source: this.id,
      };
    }
  }

  public async writeTag(tag: TagDefinition, value: TagScalarValue): Promise<void> {
    if (!tag.writable) {
      throw new Error(`Tag ${tag.name} is not writable`);
    }

    await this.ensureConnected();
    const address = ensureModbusAddress(tag.address);

    if (address.registerType === "coil") {
      await this.client.writeCoil(address.address, Boolean(value));
      return;
    }

    if (address.registerType === "holding-register") {
      if (address.dataType === "INT16" || address.dataType === "UINT16" || address.dataType === "BOOL") {
        await this.client.writeRegister(address.address, Number(value));
        return;
      }

      if (address.dataType === "INT32" || address.dataType === "UINT32" || address.dataType === "FLOAT32") {
        const buffer = Buffer.alloc(4);
        if (address.dataType === "FLOAT32") {
          buffer.writeFloatBE(Number(value), 0);
        } else if (address.dataType === "INT32") {
          buffer.writeInt32BE(Number(value), 0);
        } else {
          buffer.writeUInt32BE(Number(value), 0);
        }
        await this.client.writeRegisters(address.address, [buffer.readUInt16BE(0), buffer.readUInt16BE(2)]);
        return;
      }
    }

    throw new Error(`Unsupported write operation for register type ${address.registerType}`);
  }

  public getStatus(): DriverStatus {
    return this.status;
  }

  private async connect(): Promise<void> {
    try {
      await this.client.connectTCP(this.config.host, { port: this.config.port });
      this.client.setID(this.config.unitId);
      this.client.setTimeout(this.config.timeoutMs ?? 1000);
      this.connected = true;
      this.setStatus("running");
    } catch (error) {
      this.connected = false;
      this.scheduleReconnect(error instanceof Error ? error.message : "Connection error");
      throw error;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.connect();
  }

  private async readAddress(address: ModbusAddress): Promise<boolean | number> {
    if (address.registerType === "coil") {
      const response = await this.client.readCoils(address.address, 1);
      return Boolean(response.data[0]);
    }

    if (address.registerType === "discrete-input") {
      const response = await this.client.readDiscreteInputs(address.address, 1);
      return Boolean(response.data[0]);
    }

    if (address.registerType === "holding-register") {
      const response = await this.client.readHoldingRegisters(address.address, address.dataType === "INT32" || address.dataType === "UINT32" || address.dataType === "FLOAT32" ? 2 : 1);
      return this.decodeRegisterValue(response.data, address);
    }

    const response = await this.client.readInputRegisters(address.address, address.dataType === "INT32" || address.dataType === "UINT32" || address.dataType === "FLOAT32" ? 2 : 1);
    return this.decodeRegisterValue(response.data, address);
  }

  private decodeRegisterValue(words: number[], address: ModbusAddress): boolean | number {
    if (address.dataType === "BOOL") {
      return (words[0] ?? 0) > 0;
    }
    if (address.dataType === "INT16") {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(words[0] ?? 0, 0);
      return b.readInt16BE(0);
    }
    if (address.dataType === "UINT16") {
      return words[0] ?? 0;
    }

    const b32 = decode32Bit(words, address.byteOrder);

    if (address.dataType === "FLOAT32") {
      return b32.readFloatBE(0);
    }
    if (address.dataType === "INT32") {
      return b32.readInt32BE(0);
    }

    return b32.readUInt32BE(0);
  }

  private scheduleReconnect(message: string): void {
    if (this.reconnectTimer) {
      return;
    }

    this.setStatus("reconnecting", message);
    const delay = this.config.reconnectMs ?? 3000;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect(message);
      }
    }, delay);
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
