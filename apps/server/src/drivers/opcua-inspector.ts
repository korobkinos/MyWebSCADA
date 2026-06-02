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

      if (needsMetadataRead || nodeClassNumeric === NodeClass.Variable) {
        const [browseNameAttr, displayNameAttr, nodeClassAttr, dataTypeAttr, accessLevelAttr] = await session.read([
          { nodeId: refNodeId, attributeId: AttributeIds.BrowseName },
          { nodeId: refNodeId, attributeId: AttributeIds.DisplayName },
          { nodeId: refNodeId, attributeId: AttributeIds.NodeClass },
          { nodeId: refNodeId, attributeId: AttributeIds.DataType },
          { nodeId: refNodeId, attributeId: AttributeIds.UserAccessLevel },
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
      }

      return {
        nodeId: refNodeId,
        browseName: isBlankOrNullLike(browseName) ? refNodeId : browseName!,
        displayName: isBlankOrNullLike(displayName) ? (isBlankOrNullLike(browseName) ? refNodeId : browseName!) : displayName!,
        nodeClassNumeric: nodeClassNumeric ?? NodeClass.Unspecified,
        dataType,
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
        output.push({
          nodeId: child.nodeId,
          browsePath: toTagNameFromBrowsePath(childPath),
          dataType: child.dataType,
          writable: child.writable,
        });
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
