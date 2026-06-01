import type { TagDefinition, TagScalarValue } from "@web-scada/shared";
import type { TagStore } from "../tags/tag-store.js";

const BOOL_TRUE_STRINGS = new Set(["true", "1", "yes", "on"]);
const BOOL_FALSE_STRINGS = new Set(["false", "0", "no", "off"]);

function isIntegerDataType(dataType: TagDefinition["dataType"]): boolean {
  return dataType === "INT" || dataType === "DINT" || dataType === "UINT" || dataType === "UDINT";
}

function formatValue(value: TagScalarValue): string {
  if (typeof value === "string") {
    return value;
  }
  return String(value);
}

function conversionError(name: string, value: TagScalarValue, dataType: TagDefinition["dataType"]): Error {
  return new Error(`Macro: cannot convert value '${formatValue(value)}' to dataType ${dataType} for tag '${name}'`);
}

function logAutoConvert(name: string, value: TagScalarValue, converted: TagScalarValue): void {
  console.warn(
    `[Macro] Auto-converted value: tag=${name} from=${typeof value} to=${typeof converted} value=${String(converted)}`,
  );
}

export function coerceTagValue(name: string, value: TagScalarValue, tagStore: TagStore): TagScalarValue {
  if (value === null) {
    return null;
  }

  const definition = tagStore.getDefinition(name);
  if (!definition) {
    return value;
  }

  const { dataType } = definition;

  if (dataType === "BOOL") {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      if (value === 0) {
        logAutoConvert(name, value, false);
        return false;
      }
      if (value === 1) {
        logAutoConvert(name, value, true);
        return true;
      }
      throw conversionError(name, value, dataType);
    }
    const normalized = value.trim().toLowerCase();
    if (BOOL_TRUE_STRINGS.has(normalized)) {
      logAutoConvert(name, value, true);
      return true;
    }
    if (BOOL_FALSE_STRINGS.has(normalized)) {
      logAutoConvert(name, value, false);
      return false;
    }
    throw conversionError(name, value, dataType);
  }

  if (isIntegerDataType(dataType)) {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw conversionError(name, value, dataType);
      }
      const converted = Math.floor(value);
      if (converted !== value) {
        logAutoConvert(name, value, converted);
      }
      return converted;
    }
    if (typeof value === "string") {
      const converted = Number.parseInt(value, 10);
      if (Number.isNaN(converted)) {
        throw conversionError(name, value, dataType);
      }
      logAutoConvert(name, value, converted);
      return converted;
    }
    const converted = value ? 1 : 0;
    logAutoConvert(name, value, converted);
    return converted;
  }

  if (dataType === "REAL") {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const converted = Number(value);
      if (Number.isNaN(converted)) {
        throw conversionError(name, value, dataType);
      }
      logAutoConvert(name, value, converted);
      return converted;
    }
    const converted = value ? 1 : 0;
    logAutoConvert(name, value, converted);
    return converted;
  }

  if (dataType === "STRING") {
    if (typeof value === "string") {
      return value;
    }
    const converted = String(value);
    logAutoConvert(name, value, converted);
    return converted;
  }

  return value;
}
