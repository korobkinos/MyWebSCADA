import { COMMAND_TIMEOUT_MS, type ManualCommandMeta, type RuntimeWsClientMessage, type RuntimeWsServerMessage, type TagValue } from "@web-scada/shared";
import { canRequestEndpoint, getEndpointBackoffDelay, isConnectivityFailure, markEndpointFailure, markEndpointSuccess } from "./connection-state";
import { incrementRuntimeDiagnosticMetric } from "./runtime-diagnostics";

type WsCallbacks = {
  onTagValues: (values: TagValue[]) => void;
  onSocketStateChange?: (state: "connecting" | "open" | "closed" | "error") => void;
};

type RuntimeSocketOptions = {
  participateInGlobalSubscriptions?: boolean;
};

type RuntimeSocketController = {
  close: () => void;
  writeTag: (name: string, value: TagValue["value"], commandMeta?: ManualCommandMeta) => void;
  subscribeTags: (tags: string[]) => void;
};

let activeSocketController: RuntimeSocketController | null = null;
let pendingGlobalSubscriptions: string[] | null = null;
const WS_BASE_URL = (import.meta.env.VITE_WS_BASE_URL as string | undefined)?.trim();
const RUNTIME_WS_DEBUG_LOCAL_STORAGE_KEY = "scada.debugRuntimeWs";
const RUNTIME_WS_HEALTHCHECK_PATH = "/api/runtime/status";

function shouldLogRuntimeWsWarnings(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(RUNTIME_WS_DEBUG_LOCAL_STORAGE_KEY) === "1";
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function resolveSocketUrl(): string {
  if (WS_BASE_URL) {
    const normalizedBase = WS_BASE_URL.replace(/\/+$/, "");
    if (import.meta.env.DEV && typeof window !== "undefined") {
      try {
        const parsed = new URL(normalizedBase);
        const isLoopbackBackend = (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.port === "3001";
        const isViteDevOrigin = (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") && window.location.port === "3000";
        if (isLoopbackBackend && isViteDevOrigin) {
          const protocol = window.location.protocol === "https:" ? "wss" : "ws";
          return `${protocol}://${window.location.host}/ws`;
        }
      } catch {
        // fall back to configured base URL below
      }
    }
    if (normalizedBase.endsWith("/ws")) {
      return normalizedBase;
    }
    return `${normalizedBase}/ws`;
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}

function resolveHealthcheckUrl(wsUrl: string): string | null {
  try {
    const parsed = new URL(wsUrl);
    const httpProtocol = parsed.protocol === "wss:" ? "https:" : "http:";
    return `${httpProtocol}//${parsed.host}${RUNTIME_WS_HEALTHCHECK_PATH}`;
  } catch {
    return null;
  }
}

export function createRuntimeSocket(callbacks: WsCallbacks, options?: RuntimeSocketOptions): RuntimeSocketController {
  const url = resolveSocketUrl();
  const healthcheckUrl = resolveHealthcheckUrl(url);
  const participateInGlobalSubscriptions = options?.participateInGlobalSubscriptions !== false;
  incrementRuntimeDiagnosticMetric("activeWebSockets", 1);
  let diagnosticsClosed = false;
  const releaseDiagnostics = () => {
    if (diagnosticsClosed) {
      return;
    }
    diagnosticsClosed = true;
    incrementRuntimeDiagnosticMetric("activeWebSockets", -1);
  };
  let socket: WebSocket | null = null;
  let closedByUser = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let connectAttemptId = 0;
  let connectInFlight = false;
  let isOpen = false;
  let pendingTags: string[] | null = null;
  let lastSentSignature = "";
  const queuedMessages: RuntimeWsClientMessage[] = [];

  const scheduleReconnect = (minimumDelayMs = 0) => {
    if (closedByUser || reconnectTimer) {
      return;
    }
    const gateDelay = getEndpointBackoffDelay("runtimeStatus");
    const baseDelay = Math.max(1000, gateDelay);
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.max(minimumDelayMs, baseDelay + jitter);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connect();
    }, delay);
  };

  const probeBackendAvailability = async (): Promise<boolean> => {
    if (!healthcheckUrl || typeof fetch !== "function") {
      return true;
    }
    const gate = canRequestEndpoint("runtimeStatus");
    if (!gate.allowed) {
      return false;
    }
    try {
      const abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutId = window.setTimeout(() => abortController?.abort(), 1500);
      const response = await fetch(healthcheckUrl, {
        method: "GET",
        cache: "no-store",
        signal: abortController?.signal,
      });
      window.clearTimeout(timeoutId);
      if (response.status >= 500) {
        markEndpointFailure("runtimeStatus", `${response.status} ${response.statusText}`);
        return false;
      }
      markEndpointSuccess("runtimeStatus");
      return true;
    } catch (error) {
      if (isConnectivityFailure(error)) {
        const text = error instanceof Error ? error.message : "Runtime healthcheck failed";
        markEndpointFailure("runtimeStatus", text);
      }
      return false;
    }
  };

  const sendWhenOpen = (payload: RuntimeWsClientMessage, options?: { queueWhenClosed?: boolean }) => {
    if (!isOpen || !socket || socket.readyState !== WebSocket.OPEN) {
      if (options?.queueWhenClosed === false) {
        if (shouldLogRuntimeWsWarnings()) {
          // eslint-disable-next-line no-console
          console.warn("[RuntimeWS] Manual command skipped: socket is not open", {
            timestamp: new Date().toISOString(),
            reason: "error",
            timeoutMs: COMMAND_TIMEOUT_MS,
            type: payload.type,
          });
        }
        return;
      }
      if (queuedMessages.length > 1000) {
        queuedMessages.shift();
      }
      queuedMessages.push(payload);
      return;
    }
    socket.send(JSON.stringify(payload));
  };

  const flushQueue = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    while (queuedMessages.length > 0) {
      const item = queuedMessages.shift();
      if (!item) {
        break;
      }
      socket.send(JSON.stringify(item));
    }
  };

  const onSocketMessage = (event: MessageEvent<string>) => {
    const parsed = JSON.parse(event.data) as RuntimeWsServerMessage;

    if (parsed.type === "tag-update") {
      callbacks.onTagValues([{
        ...parsed.payload,
        source: parsed.payload.source ?? "ws",
      }]);
      return;
    }

    if (parsed.type === "tag-batch") {
      callbacks.onTagValues(parsed.payload.updates.map((update) => ({
        ...update,
        source: update.source ?? "ws",
      })));
    }
  };

  const connect = async () => {
    if (closedByUser || connectInFlight) {
      return;
    }
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    callbacks.onSocketStateChange?.("connecting");
    connectInFlight = true;
    const currentAttemptId = ++connectAttemptId;

    const backendAvailable = await probeBackendAvailability();
    if (closedByUser || currentAttemptId !== connectAttemptId) {
      connectInFlight = false;
      return;
    }
    if (!backendAvailable) {
      connectInFlight = false;
      callbacks.onSocketStateChange?.("closed");
      scheduleReconnect(2000);
      return;
    }

    try {
      socket = new WebSocket(url);
    } catch {
      connectInFlight = false;
      callbacks.onSocketStateChange?.("error");
      scheduleReconnect(2000);
      return;
    }

    socket.onmessage = onSocketMessage;
    socket.onopen = () => {
      connectInFlight = false;
      isOpen = true;
      callbacks.onSocketStateChange?.("open");
      markEndpointSuccess("runtimeStatus");
      if (pendingTags) {
        sendSubscription(pendingTags);
      }
      flushQueue();
    };

    socket.onclose = () => {
      connectInFlight = false;
      isOpen = false;
      socket = null;
      callbacks.onSocketStateChange?.("closed");
      if (closedByUser) {
        releaseDiagnostics();
        if (activeSocketController === controller) {
          activeSocketController = null;
        }
        return;
      }
      markEndpointFailure("runtimeStatus", "Runtime socket closed");
      scheduleReconnect();
    };

    socket.onerror = () => {
      connectInFlight = false;
      callbacks.onSocketStateChange?.("error");
      // Let onclose handle reconnect scheduling.
    };
  };

  const sendSubscription = (tags: string[]) => {
    const normalized = normalizeTags(tags);
    const signature = normalized.join("|");
    if (signature === lastSentSignature) {
      return;
    }
    lastSentSignature = signature;

    const payload: RuntimeWsClientMessage = {
      type: "subscribe-tags",
      payload: { tags: normalized },
    };
    sendWhenOpen(payload);
  };

  const controller: RuntimeSocketController = {
    close: () => {
      closedByUser = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      connectAttemptId += 1;
      connectInFlight = false;
      releaseDiagnostics();
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
      if (participateInGlobalSubscriptions && activeSocketController === controller) {
        activeSocketController = null;
      }
    },
    writeTag: (name, value, commandMeta) => {
      const payload: RuntimeWsClientMessage = {
        type: "write-tag",
        payload: {
          name,
          value,
          commandMeta,
        },
      };
      sendWhenOpen(payload, { queueWhenClosed: false });
    },
    subscribeTags: (tags) => {
      const normalized = normalizeTags(tags);
      pendingTags = normalized;
      sendSubscription(normalized);
    },
  };

  void connect();
  if (participateInGlobalSubscriptions) {
    activeSocketController = controller;
  }
  if (participateInGlobalSubscriptions && pendingGlobalSubscriptions) {
    controller.subscribeTags(pendingGlobalSubscriptions);
  }
  return controller;
}

export function updateRuntimeTagSubscriptions(tags: string[]): void {
  pendingGlobalSubscriptions = normalizeTags(tags);
  activeSocketController?.subscribeTags(pendingGlobalSubscriptions);
}
