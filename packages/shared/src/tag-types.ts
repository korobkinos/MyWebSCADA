export type TagQuality = "Good" | "Bad" | "Uncertain";

export type TagDataType = "BOOL" | "INT" | "DINT" | "REAL" | "STRING";

export type ExtendedTagDataType = "BOOL" | "INT" | "UINT" | "DINT" | "UDINT" | "REAL" | "STRING";
export type TagSourceType = "opcua" | "modbus" | "lw" | "internal" | "computed" | "simulated";

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
  value?: TagScalarValue;
};

export type TagSimulationMode = "manual" | "random" | "range" | "ramp" | "toggle" | "sine";

export type TagSimulationSettings = {
  mode?: TagSimulationMode;
  intervalMs?: number;
  initialValue?: TagScalarValue;
  min?: number;
  max?: number;
  step?: number;
};

export type TagDefinition = {
  id?: string;
  name: string;
  description?: string;
  sourceType?: TagSourceType;
  dataType: TagDataType | ExtendedTagDataType;
  driverId?: string;
  nodeId?: string;
  area?: "coil" | "discreteInput" | "holdingRegister" | "inputRegister";
  functionCode?: string;
  unitId?: number;
  bit?: number;
  wordOrder?: "ABCD" | "CDAB" | "BADC" | "DCBA";
  byteOrder?: "AB" | "BA";
  lwAddress?: number;
  internalVariableName?: string;
  address?: ModbusAddress | OpcUaAddress | SimulatedAddress | Record<string, unknown>;
  writable?: boolean;
  persistent?: boolean;
  scanRateMs?: number;
  scale?: number;
  offset?: number;
  min?: number;
  max?: number;
  simulation?: TagSimulationSettings;
  group?: string;
  unit?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type TagWriteRequest = {
  name: string;
  value: TagScalarValue;
};

export type TagSnapshot = {
  definition: TagDefinition;
  value: TagValue;
};
