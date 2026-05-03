export type TagQuality = "Good" | "Bad" | "Uncertain";

export type TagDataType = "BOOL" | "INT" | "DINT" | "REAL" | "STRING";

export type TagScalarValue = boolean | number | string | null;

export type TagValue = {
  name: string;
  value: TagScalarValue;
  quality: TagQuality;
  timestamp: number;
  source: string;
};

export type ModbusRegisterType = "coil" | "discrete-input" | "holding-register" | "input-register";

export type ModbusDataType = "BOOL" | "INT16" | "UINT16" | "INT32" | "UINT32" | "FLOAT32";

export type ByteOrder = "ABCD" | "BADC" | "CDAB" | "DCBA";

export type ModbusAddress = {
  registerType: ModbusRegisterType;
  address: number;
  dataType: ModbusDataType;
  byteOrder?: ByteOrder;
};

export type OpcUaAddress = {
  nodeId: string;
};

export type SimulatedAddress = {
  pattern?: "toggle" | "sine" | "random" | "static";
  amplitude?: number;
  periodMs?: number;
  min?: number;
  max?: number;
  step?: number;
};

export type TagDefinition = {
  name: string;
  description?: string;
  dataType: TagDataType;
  driverId?: string;
  address?: ModbusAddress | OpcUaAddress | SimulatedAddress | Record<string, unknown>;
  writable?: boolean;
  scanRateMs?: number;
  scale?: number;
  offset?: number;
  unit?: string;
};

export type TagWriteRequest = {
  name: string;
  value: TagScalarValue;
};

export type TagSnapshot = {
  definition: TagDefinition;
  value: TagValue;
};
