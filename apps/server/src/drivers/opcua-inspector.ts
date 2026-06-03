import {
  AttributeIds,
  BrowseDirection,
  MessageSecurityMode,
  NodeClass,
  OPCUAClient,
  SecurityPolicy,
  UserTokenType,
  type ClientSession,
} from "node-opcua";
import type { OpcUaDriverConfig, TagDataType, TagScalarValue } from "@web-scada/shared";

export type OpcUaBrowseItem = {
  nodeId: string;
  browseName: string;
  displayName: string;
  nodeClass: string;
  dataType?: string;
  valueRank?: number;
  arrayDimensions?: number[];
  isArray?: boolean;
  writable?: boolean;
  hasChildren: boolean;
};

export type OpcUaReadResult = {
  value: TagScalarValue;
  quality: "Good" | "Bad" | "Uncertain";
  timestamp: number;
  dataType?: string;
};

export type OpcUaImportCandidate = {
  nodeId: string;
  browsePath: string;
  dataType?: string;
  indexRange?: string;
  memberPath?: string[];
  writable?: boolean;
};

export type OpcUaSubtreeImportResult = {
  candidates: OpcUaImportCandidate[];
  scannedNodes: number;
};

const OPCUA_BROWSE_RESULT_MASK_ALL_FIELDS = 0x3f;
const OPCUA_NODECLASS_UNSPECIFIED = 0;
const OPCUA_NODECLASS_WITH_POTENTIAL_CHILDREN = new Set<number>([
  NodeClass.Unspecified,
  NodeClass.Object,
  NodeClass.Variable,
  NodeClass.View,
]);
const OPCUA_ARRAY_IMPORT_HARD_LIMIT = 1_000;
const OPCUA_STRUCTURE_FIELD_DEPTH_LIMIT = 4;
const OPCUA_STRUCTURE_FIELD_LIMIT = 100;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function isBlankOrNullLike(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || normalized === "null" || normalized === "<null>" || normalized === "undefined";
}

function toQualifiedNameText(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    const asRecord = value as Record<string, unknown>;
    const name = asRecord.name;
    if (typeof name === "string" && name.trim().length > 0) {
      return name;
    }
    const toStringFn = asRecord.toString;
    if (typeof toStringFn === "function") {
      const fromToString = String(toStringFn.call(value));
      if (fromToString && fromToString !== "[object Object]") {
        return fromToString;
      }
    }
  }
  return undefined;
}

function toLocalizedText(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    const asRecord = value as Record<string, unknown>;
    const text = asRecord.text;
    if (typeof text === "string" && text.trim().length > 0) {
      return text;
    }
    const toStringFn = asRecord.toString;
    if (typeof toStringFn === "function") {
      const fromToString = String(toStringFn.call(value));
      if (fromToString && fromToString !== "[object Object]") {
        return fromToString;
      }
    }
  }
  return undefined;
}

function toNumberArray(value: unknown): number[] | undefined {
  if (!value) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  }
  if (ArrayBuffer.isView(value) && "length" in value) {
    return Array.from(value as unknown as ArrayLike<number>).filter((item) => typeof item === "number" && Number.isFinite(item));
  }
  return undefined;
}

function isArrayNode(valueRank: number | undefined, arrayDimensions: number[] | undefined): boolean {
  return (typeof valueRank === "number" && valueRank >= 1)
    || Boolean(arrayDimensions?.some((dimension) => dimension > 0));
}

function isArrayLikeValue(value: unknown): value is ArrayLike<unknown> {
  return Array.isArray(value) || (ArrayBuffer.isView(value) && "length" in value);
}

function getArrayLength(value: unknown): number | undefined {
  return isArrayLikeValue(value) ? value.length : undefined;
}

function getArrayElement(value: unknown, index: number): unknown {
  if (!isArrayLikeValue(value)) {
    return undefined;
  }
  return value[index];
}

function toInspectableObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || value instanceof Date || ArrayBuffer.isView(value)) {
    return undefined;
  }
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function") {
    try {
      const json = toJSON.call(value);
      if (json && typeof json === "object" && !Array.isArray(json)) {
        return json as Record<string, unknown>;
      }
    } catch {
      // Fall back to enumerable fields below.
    }
  }
  if (Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function collectStructureFieldPaths(
  value: unknown,
  path: string[] = [],
  output: Array<{ path: string[]; value: unknown }> = [],
): Array<{ path: string[]; value: unknown }> {
  if (output.length >= OPCUA_STRUCTURE_FIELD_LIMIT || path.length >= OPCUA_STRUCTURE_FIELD_DEPTH_LIMIT) {
    return output;
  }
  const objectValue = toInspectableObject(value);
  if (!objectValue) {
    if (path.length > 0) {
      output.push({ path, value });
    }
    return output;
  }

  for (const key of Object.keys(objectValue)) {
    if (output.length >= OPCUA_STRUCTURE_FIELD_LIMIT) {
      break;
    }
    if (!key || key.startsWith("_")) {
      continue;
    }
    const nextValue = objectValue[key];
    const nextPath = [...path, key];
    const nextObject = toInspectableObject(nextValue);
    if (nextObject && path.length + 1 < OPCUA_STRUCTURE_FIELD_DEPTH_LIMIT) {
      collectStructureFieldPaths(nextValue, nextPath, output);
    } else {
      output.push({ path: nextPath, value: nextValue });
    }
  }
  return output;
}

function inferOpcUaDataTypeFromValue(value: unknown, fallback?: string): string | undefined {
  if (typeof value === "boolean") {
    return "Boolean";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "Int32" : "Double";
  }
  if (typeof value === "string") {
    return "String";
  }
  return fallback;
}

async function readOpcUaRawValue(session: ClientSession, nodeId: string): Promise<unknown> {
  try {
    const valueAttr = await session.read({ nodeId, attributeId: AttributeIds.Value });
    return valueAttr?.value?.value;
  } catch {
    return undefined;
  }
}

async function readOpcUaBrowseItemMetadata(session: ClientSession, nodeId: string): Promise<OpcUaBrowseItem | undefined> {
  try {
    const [
      browseNameAttr,
      displayNameAttr,
      nodeClassAttr,
      dataTypeAttr,
      accessLevelAttr,
      valueRankAttr,
      arrayDimensionsAttr,
    ] = await session.read([
      { nodeId, attributeId: AttributeIds.BrowseName },
      { nodeId, attributeId: AttributeIds.DisplayName },
      { nodeId, attributeId: AttributeIds.NodeClass },
      { nodeId, attributeId: AttributeIds.DataType },
      { nodeId, attributeId: AttributeIds.UserAccessLevel },
      { nodeId, attributeId: AttributeIds.ValueRank },
      { nodeId, attributeId: AttributeIds.ArrayDimensions },
    ]);
    const nodeClassNumeric = typeof nodeClassAttr?.value?.value === "number"
      ? nodeClassAttr.value.value
      : NodeClass.Unspecified;
    const valueRank = typeof valueRankAttr?.value?.value === "number" ? valueRankAttr.value.value : undefined;
    const arrayDimensions = toNumberArray(arrayDimensionsAttr?.value?.value);
    const access = accessLevelAttr?.value?.value;
    return {
      nodeId,
      browseName: toQualifiedNameText(browseNameAttr?.value?.value) ?? nodeId,
      displayName: toLocalizedText(displayNameAttr?.value?.value) ?? nodeId,
      nodeClass: NodeClass[nodeClassNumeric] ?? String(nodeClassNumeric),
      dataType: dataTypeAttr?.value?.value?.toString?.(),
      valueRank,
      arrayDimensions,
      isArray: isArrayNode(valueRank, arrayDimensions),
      writable: typeof access === "number" ? (access & 0x2) !== 0 : undefined,
      hasChildren: false,
    };
  } catch {
    return undefined;
  }
}

export async function withOpcUaSession<T>(
  config: OpcUaDriverConfig,
  run: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const connectTimeoutMs = Math.max(500, config.connectTimeoutMs ?? config.timeoutMs ?? 3_000);
  const sessionTimeoutMs = Math.max(1_000, config.sessionTimeoutMs ?? config.timeoutMs ?? 10_000);
  const closeTimeoutMs = Math.min(1_000, connectTimeoutMs);
  const client = OPCUAClient.create({
    securityMode:
      config.securityMode === "Sign"
        ? MessageSecurityMode.Sign
        : config.securityMode === "SignAndEncrypt"
          ? MessageSecurityMode.SignAndEncrypt
          : MessageSecurityMode.None,
    securityPolicy:
      config.securityPolicy === "Basic256Sha256" ? SecurityPolicy.Basic256Sha256 : SecurityPolicy.None,
    endpointMustExist: false,
    transportTimeout: connectTimeoutMs,
    requestedSessionTimeout: sessionTimeoutMs,
    connectionStrategy: {
      initialDelay: 200,
      maxRetry: 0,
      maxDelay: 500,
    },
  });
  try {
    await withTimeout(
      client.connect(config.endpointUrl),
      connectTimeoutMs,
      `OPC UA connect timeout after ${connectTimeoutMs} ms`,
    );
    const session = config.username
      ? await withTimeout(
          client.createSession({
            type: UserTokenType.UserName,
            userName: config.username,
            password: config.password ?? "",
          }),
          connectTimeoutMs,
          `OPC UA session timeout after ${connectTimeoutMs} ms`,
        )
      : await withTimeout(
          client.createSession(),
          connectTimeoutMs,
          `OPC UA session timeout after ${connectTimeoutMs} ms`,
        );
    try {
      return await run(session);
    } finally {
      await withTimeout(
        session.close(),
        closeTimeoutMs,
        `OPC UA session close timeout after ${closeTimeoutMs} ms`,
      ).catch(() => undefined);
    }
  } finally {
    await withTimeout(
      client.disconnect(),
      closeTimeoutMs,
      `OPC UA disconnect timeout after ${closeTimeoutMs} ms`,
    ).catch(() => undefined);
  }
}

export async function browseOpcUaNode(
  session: ClientSession,
  nodeId: string,
  search?: string,
): Promise<OpcUaBrowseItem[]> {
  const result = await session.browse({
    nodeId,
    browseDirection: BrowseDirection.Forward,
    includeSubtypes: true,
    referenceTypeId: "HierarchicalReferences",
    // Some OPC UA servers return only NodeId when resultMask is omitted.
    // 0x3f requests the full reference description payload.
    resultMask: OPCUA_BROWSE_RESULT_MASK_ALL_FIELDS,
  });
  const references = result.references ?? [];
  const term = search?.trim().toLowerCase();

  const enriched = await Promise.all(
    references.map(async (ref) => {
      const refNodeId = ref.nodeId.toString();
      let browseName = toQualifiedNameText(ref.browseName);
      let displayName = toLocalizedText(ref.displayName);
      let nodeClassNumeric = typeof ref.nodeClass === "number" ? ref.nodeClass : undefined;

      const needsMetadataRead =
        isBlankOrNullLike(browseName) ||
        isBlankOrNullLike(displayName) ||
        nodeClassNumeric === undefined ||
        nodeClassNumeric === OPCUA_NODECLASS_UNSPECIFIED;
      let dataType: string | undefined;
      let writable: boolean | undefined;
      let valueRank: number | undefined;
      let arrayDimensions: number[] | undefined;

      if (needsMetadataRead || nodeClassNumeric === NodeClass.Variable) {
        const [
          browseNameAttr,
          displayNameAttr,
          nodeClassAttr,
          dataTypeAttr,
          accessLevelAttr,
          valueRankAttr,
          arrayDimensionsAttr,
        ] = await session.read([
          { nodeId: refNodeId, attributeId: AttributeIds.BrowseName },
          { nodeId: refNodeId, attributeId: AttributeIds.DisplayName },
          { nodeId: refNodeId, attributeId: AttributeIds.NodeClass },
          { nodeId: refNodeId, attributeId: AttributeIds.DataType },
          { nodeId: refNodeId, attributeId: AttributeIds.UserAccessLevel },
          { nodeId: refNodeId, attributeId: AttributeIds.ValueRank },
          { nodeId: refNodeId, attributeId: AttributeIds.ArrayDimensions },
        ]);

        if (!browseName) {
          browseName = toQualifiedNameText(browseNameAttr?.value?.value);
        }
        if (!displayName) {
          displayName = toLocalizedText(displayNameAttr?.value?.value);
        }
        if (nodeClassNumeric === undefined || nodeClassNumeric === OPCUA_NODECLASS_UNSPECIFIED) {
          const rawNodeClass = nodeClassAttr?.value?.value;
          if (typeof rawNodeClass === "number") {
            nodeClassNumeric = rawNodeClass;
          }
        }

        dataType = dataTypeAttr?.value?.value?.toString?.();
        const access = accessLevelAttr?.value?.value;
        writable = typeof access === "number" ? (access & 0x2) !== 0 : undefined;
        valueRank = typeof valueRankAttr?.value?.value === "number" ? valueRankAttr.value.value : undefined;
        arrayDimensions = toNumberArray(arrayDimensionsAttr?.value?.value);
      }

      return {
        nodeId: refNodeId,
        browseName: isBlankOrNullLike(browseName) ? refNodeId : browseName!,
        displayName: isBlankOrNullLike(displayName) ? (isBlankOrNullLike(browseName) ? refNodeId : browseName!) : displayName!,
        nodeClassNumeric: nodeClassNumeric ?? NodeClass.Unspecified,
        dataType,
        valueRank,
        arrayDimensions,
        writable,
      };
    }),
  );

  const nodesToCheck = enriched
    .filter((item) => OPCUA_NODECLASS_WITH_POTENTIAL_CHILDREN.has(item.nodeClassNumeric) || item.nodeClassNumeric > 0)
    .map((item) => item.nodeId);

  const hasChildrenByNodeId = new Map<string, boolean>();
  if (nodesToCheck.length > 0) {
    try {
      const browseResults = await session.browse(
        nodesToCheck.map((childNodeId) => ({
          nodeId: childNodeId,
          browseDirection: BrowseDirection.Forward,
          includeSubtypes: true,
          referenceTypeId: "HierarchicalReferences",
          resultMask: OPCUA_BROWSE_RESULT_MASK_ALL_FIELDS,
        })),
      );
      const list = Array.isArray(browseResults) ? browseResults : [browseResults];
      list.forEach((childBrowseResult, index) => {
        const currentNodeId = nodesToCheck[index];
        if (!currentNodeId) {
          return;
        }
        const refs = childBrowseResult?.references ?? [];
        const hasContinuationPoint = Boolean(childBrowseResult?.continuationPoint?.length);
        hasChildrenByNodeId.set(currentNodeId, refs.length > 0 || hasContinuationPoint);
      });
    } catch {
      for (const currentNodeId of nodesToCheck) {
        hasChildrenByNodeId.set(currentNodeId, true);
      }
    }
  }

  const items = enriched.map<OpcUaBrowseItem>((item) => {
    const nodeClassName = NodeClass[item.nodeClassNumeric] ?? String(item.nodeClassNumeric);
    return {
      nodeId: item.nodeId,
      browseName: item.browseName,
      displayName: item.displayName,
      nodeClass: nodeClassName,
      dataType: item.dataType,
      valueRank: item.valueRank,
      arrayDimensions: item.arrayDimensions,
      isArray: isArrayNode(item.valueRank, item.arrayDimensions),
      writable: item.writable,
      hasChildren: hasChildrenByNodeId.get(item.nodeId) ?? false,
    };
  });

  if (!term) {
    return items;
  }
  return items.filter((item) => {
    return (
      item.nodeId.toLowerCase().includes(term) ||
      item.browseName.toLowerCase().includes(term) ||
      item.displayName.toLowerCase().includes(term)
    );
  });
}

function normalizePathSegment(value: string): string {
  return value
    .replace(/[^\w.[\]-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toTagNameFromBrowsePath(path: string): string {
  const normalized = path
    .split(".")
    .map((part) => normalizePathSegment(part))
    .filter((part) => part.length > 0)
    .join(".");
  return normalized || "opcua.tag";
}

export async function collectOpcUaSubtreeVariables(
  session: ClientSession,
  nodeId: string,
  rootBrowsePath?: string,
  maxNodes = 10_000,
): Promise<OpcUaSubtreeImportResult> {
  const visited = new Set<string>();
  const output: OpcUaImportCandidate[] = [];
  const queue: Array<{ nodeId: string; path: string }> = [{ nodeId, path: rootBrowsePath?.trim() || "" }];
  const pushCandidate = (candidate: OpcUaImportCandidate): boolean => {
    if (output.length >= maxNodes) {
      return false;
    }
    output.push(candidate);
    return true;
  };
  const addVariableCandidate = async (child: OpcUaBrowseItem, browsePath: string): Promise<void> => {
    if (!pushCandidate({
      nodeId: child.nodeId,
      browsePath: toTagNameFromBrowsePath(browsePath),
      dataType: child.dataType,
      writable: child.writable,
    })) {
      return;
    }
    if (!child.isArray) {
      return;
    }
    const rawValue = await readOpcUaRawValue(session, child.nodeId);
    const dimensionLength = child.arrayDimensions?.find((dimension) => dimension > 0);
    const valueLength = getArrayLength(rawValue);
    const arrayLength = Math.min(
      dimensionLength ?? valueLength ?? 0,
      OPCUA_ARRAY_IMPORT_HARD_LIMIT,
      Math.max(0, maxNodes - output.length),
    );
    if (arrayLength <= 0) {
      return;
    }

    const sampleIndex = Array.from({ length: arrayLength }, (_, index) => index)
      .find((index) => getArrayElement(rawValue, index) != null);
    const sampleValue = sampleIndex === undefined ? undefined : getArrayElement(rawValue, sampleIndex);
    const fieldPaths = collectStructureFieldPaths(sampleValue);
    if (fieldPaths.length > 0) {
      for (let index = 0; index < arrayLength; index += 1) {
        const element = getArrayElement(rawValue, index);
        for (const field of fieldPaths) {
          if (!pushCandidate({
            nodeId: child.nodeId,
            browsePath: toTagNameFromBrowsePath(`${browsePath}[${index}].${field.path.join(".")}`),
            dataType: inferOpcUaDataTypeFromValue(field.path.reduce<unknown>((value, key) => toInspectableObject(value)?.[key], element), child.dataType),
            indexRange: String(index),
            memberPath: field.path,
            writable: true,
          })) {
            return;
          }
        }
      }
      return;
    }

    for (let index = 0; index < arrayLength; index += 1) {
      if (!pushCandidate({
        nodeId: child.nodeId,
        browsePath: toTagNameFromBrowsePath(`${browsePath}[${index}]`),
        dataType: child.dataType,
        indexRange: String(index),
        writable: child.writable,
      })) {
        return;
      }
    }
  };

  const rootMetadata = await readOpcUaBrowseItemMetadata(session, nodeId);
  if (rootMetadata && rootMetadata.nodeClass.toLowerCase() === "variable" && rootMetadata.isArray) {
    await addVariableCandidate(rootMetadata, rootBrowsePath?.trim() || rootMetadata.browseName || rootMetadata.displayName || nodeId);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.nodeId)) {
      continue;
    }
    if (visited.size >= maxNodes) {
      break;
    }
    visited.add(current.nodeId);

    const children = await browseOpcUaNode(session, current.nodeId);
    for (const child of children) {
      const segment = child.browseName?.trim() || child.displayName?.trim() || child.nodeId;
      const childPath = current.path ? `${current.path}.${segment}` : segment;
      const classLower = (child.nodeClass ?? "").toLowerCase();
      const isVariable = classLower === "variable";
      if (isVariable) {
        await addVariableCandidate(child, childPath);
      }
      if (child.hasChildren) {
        queue.push({ nodeId: child.nodeId, path: childPath });
      }
    }
  }

  return {
    candidates: output,
    scannedNodes: visited.size,
  };
}

export async function readOpcUaNode(session: ClientSession, nodeId: string): Promise<OpcUaReadResult> {
  const [valueAttr, dataTypeAttr] = await session.read([
    { nodeId, attributeId: AttributeIds.Value },
    { nodeId, attributeId: AttributeIds.DataType },
  ]);
  if (!valueAttr) {
    return {
      value: null,
      quality: "Bad",
      timestamp: Date.now(),
    };
  }

  const raw = valueAttr.value.value;
  const scalar: TagScalarValue =
    typeof raw === "boolean" || typeof raw === "number" || typeof raw === "string" ? raw : raw == null ? null : String(raw);
  const dataType = dataTypeAttr?.value?.value?.toString?.();
  const quality = valueAttr.statusCode.isGood()
    ? "Good"
    : valueAttr.statusCode.isNotGood()
      ? "Bad"
      : "Uncertain";
  return {
    value: scalar,
    quality,
    timestamp: valueAttr.serverTimestamp?.getTime() ?? Date.now(),
    dataType,
  };
}

export function opcUaDataTypeToTagDataType(dataTypeNodeId: string | undefined): TagDataType {
  if (!dataTypeNodeId) {
    return "STRING";
  }
  const normalized = dataTypeNodeId.toLowerCase();
  if (normalized.includes("bool")) {
    return "BOOL";
  }
  if (normalized.includes("uint") || normalized.includes("int32") || normalized.includes("dint")) {
    return "DINT";
  }
  if (normalized.includes("int") || normalized.includes("short")) {
    return "INT";
  }
  if (normalized.includes("double") || normalized.includes("float") || normalized.includes("real")) {
    return "REAL";
  }
  if (normalized.includes("string") || normalized.includes("text")) {
    return "STRING";
  }
  const match = /i=(\d+)/i.exec(dataTypeNodeId);
  const id = match ? Number(match[1]) : Number.NaN;
  if (Number.isNaN(id)) {
    return "STRING";
  }
  if (id === 1) {
    return "BOOL";
  }
  if (id === 2 || id === 3 || id === 4 || id === 5) {
    return "INT";
  }
  if (id === 6 || id === 7) {
    return "DINT";
  }
  if (id === 8 || id === 9 || id === 10 || id === 11) {
    return "REAL";
  }
  return "STRING";
}
