import type { DriverStatus, TagDefinition } from "@web-scada/shared";

export type OpcUaCommunicationDiagnostics = {
  bad: boolean;
  affectedTags: string[];
  affectedDrivers: string[];
};

export function isDriverStatusAvailable(status: Pick<DriverStatus, "health"> | undefined): boolean {
  if (!status) {
    return false;
  }
  switch (String(status.health).toLowerCase()) {
    case "connected":
    case "ok":
    case "running":
    case "healthy":
      return true;
    case "error":
    case "stopped":
    case "disabled":
    case "reconnecting":
    case "disconnected":
    case "starting":
      return false;
    default:
      return false;
  }
}

export function diagnoseOpcUaCommunication(input: {
  resolvedTags: string[];
  tagDefinitionsByName: ReadonlyMap<string, TagDefinition>;
  driverStatusesById: ReadonlyMap<string, DriverStatus>;
}): OpcUaCommunicationDiagnostics {
  const affectedTags: string[] = [];
  const affectedDrivers = new Set<string>();

  for (const tagName of input.resolvedTags) {
    const definition = input.tagDefinitionsByName.get(tagName);
    if (!definition) {
      continue;
    }
    if (String(definition.sourceType ?? "").toLowerCase() !== "opcua") {
      continue;
    }

    const driverId = definition.driverId?.trim();
    if (!driverId) {
      affectedTags.push(tagName);
      affectedDrivers.add("__missing_driver_id__");
      continue;
    }

    const status = input.driverStatusesById.get(driverId);
    if (!isDriverStatusAvailable(status)) {
      affectedTags.push(tagName);
      affectedDrivers.add(driverId);
    }
  }

  return {
    bad: affectedTags.length > 0,
    affectedTags,
    affectedDrivers: [...affectedDrivers],
  };
}
