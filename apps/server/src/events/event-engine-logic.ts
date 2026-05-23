import type {
  EventBitTrigger,
  EventDefinition,
  EventWordOperator,
  TagScalarValue,
  TagValue,
} from "@web-scada/shared";

export type NormalizedEventDefinition = {
  id: string;
  sourceTagName: string;
  enabled: boolean;
  conditionMode: "bit" | "word";
  bitTrigger: EventBitTrigger;
  wordOperator: EventWordOperator;
  wordValue: number;
  startupDelayMs: number;
  requireAck: boolean;
  securityEnabled: boolean;
  securityTagName?: string;
  securityBitValue: boolean;
  categoryId?: string;
  categoryName?: string;
  message?: string;
  priority?: number;
  soundEnabled: boolean;
  soundId?: string;
  ackTagName?: string;
  ackValue?: TagScalarValue;
};

export type EventRuntimeState = {
  previousRawValue?: TagScalarValue;
  previousConditionActive: boolean;
  activeOccurrenceId?: string;
  activeSince?: string;
  lastEvaluatedAt?: number;
  startupReadyAt: number;
};

export type EvaluateTransitionInput = {
  definition: NormalizedEventDefinition;
  state: EventRuntimeState;
  nowMs: number;
  sourceValue: TagValue | undefined;
  securityValue?: TagValue | undefined;
};

export type EvaluateTransitionResult = {
  skipped: boolean;
  reason?: "startup-delay" | "missing-source" | "invalid-bit" | "invalid-number";
  conditionActive: boolean;
  edgeTriggered: boolean;
  nextState: EventRuntimeState;
};

export function normalizeEventDefinition(definition: EventDefinition): NormalizedEventDefinition {
  const conditionMode = definition.conditionMode === "word" ? "word" : "bit";
  const bitTrigger = definition.bitTrigger ?? "ON";
  const wordOperator = definition.wordOperator ?? ">";
  const startupDelayMs = Math.max(0, Math.trunc(definition.startupDelayMs ?? 0));

  return {
    id: definition.id,
    sourceTagName: (definition.sourceTagName ?? "").trim(),
    enabled: definition.enabled !== false,
    conditionMode,
    bitTrigger,
    wordOperator,
    wordValue: Number.isFinite(definition.wordValue) ? Number(definition.wordValue) : 0,
    startupDelayMs,
    requireAck: definition.requireAck === true,
    securityEnabled: definition.securityEnabled === true,
    securityTagName: definition.securityTagName?.trim() || undefined,
    securityBitValue: normalizeSecurityBitValue(definition.securityBitValue),
    categoryId: definition.categoryId,
    categoryName: definition.categoryName,
    message: definition.message,
    priority: definition.priority,
    soundEnabled: definition.soundEnabled === true,
    soundId: definition.soundId,
    ackTagName: definition.ackTagName?.trim() || undefined,
    ackValue: definition.ackValue,
  };
}

export function coerceBitValue(value: TagScalarValue): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return null;
    }
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "on") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "off") {
      return false;
    }
  }

  return null;
}

export function coerceNumericValue(value: TagScalarValue): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  return null;
}

export function evaluateWordOperator(operator: EventWordOperator, left: number, right: number): boolean {
  switch (operator) {
    case "<":
      return left < right;
    case ">":
      return left > right;
    case "=":
      return left === right;
    case "<>":
      return left !== right;
    case ">=":
      return left >= right;
    case "<=":
      return left <= right;
    default:
      return false;
  }
}

export function evaluateTransition(input: EvaluateTransitionInput): EvaluateTransitionResult {
  const { definition, state, nowMs, sourceValue, securityValue } = input;
  const nextState: EventRuntimeState = { ...state };

  if (nowMs < state.startupReadyAt) {
    return {
      skipped: true,
      reason: "startup-delay",
      conditionActive: false,
      edgeTriggered: false,
      nextState,
    };
  }

  if (!sourceValue) {
    nextState.lastEvaluatedAt = nowMs;
    return {
      skipped: true,
      reason: "missing-source",
      conditionActive: false,
      edgeTriggered: false,
      nextState,
    };
  }

  const securitySatisfied = evaluateSecurityGate(definition, securityValue);
  let conditionActive = false;
  let edgeTriggered = false;

  if (definition.conditionMode === "word") {
    const numeric = coerceNumericValue(sourceValue.value);
    if (numeric === null) {
      nextState.previousRawValue = sourceValue.value;
      nextState.previousConditionActive = false;
      nextState.lastEvaluatedAt = nowMs;
      return {
        skipped: false,
        reason: "invalid-number",
        conditionActive: false,
        edgeTriggered: false,
        nextState,
      };
    }

    conditionActive = securitySatisfied && evaluateWordOperator(definition.wordOperator, numeric, definition.wordValue);
  } else {
    const currentBit = coerceBitValue(sourceValue.value);
    const isEdgeTrigger = definition.bitTrigger === "OFF_TO_ON" || definition.bitTrigger === "ON_TO_OFF";

    if (isEdgeTrigger) {
      const previousBit = coerceBitValue(state.previousRawValue ?? null);
      if (currentBit !== null && previousBit !== null && securitySatisfied) {
        if (definition.bitTrigger === "OFF_TO_ON") {
          edgeTriggered = !previousBit && currentBit;
        } else {
          edgeTriggered = previousBit && !currentBit;
        }
      }
      conditionActive = false;
      nextState.previousConditionActive = false;
    } else {
      if (currentBit === null) {
        nextState.previousRawValue = sourceValue.value;
        nextState.previousConditionActive = false;
        nextState.lastEvaluatedAt = nowMs;
        return {
          skipped: false,
          reason: "invalid-bit",
          conditionActive: false,
          edgeTriggered: false,
          nextState,
        };
      }

      conditionActive = securitySatisfied && (definition.bitTrigger === "ON" ? currentBit : !currentBit);
    }
  }

  nextState.previousRawValue = sourceValue.value;
  nextState.previousConditionActive = conditionActive;
  nextState.lastEvaluatedAt = nowMs;

  return {
    skipped: false,
    conditionActive,
    edgeTriggered,
    nextState,
  };
}

export function normalizeSecurityBitValue(value: EventDefinition["securityBitValue"]): boolean {
  if (value === 0) {
    return false;
  }
  if (value === 1) {
    return true;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return true;
}

function evaluateSecurityGate(
  definition: NormalizedEventDefinition,
  securityValue: TagValue | undefined,
): boolean {
  if (!definition.securityEnabled) {
    return true;
  }
  if (!securityValue) {
    return false;
  }

  const securityBit = coerceBitValue(securityValue.value);
  if (securityBit === null) {
    return false;
  }

  return securityBit === definition.securityBitValue;
}
