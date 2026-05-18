import { COMMAND_TIMEOUT_MS, type ManualCommandMeta, type RuntimeWsClientMessage, type RuntimeWsServerMessage, type TagValue } from "@web-scada/shared";

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
    if (normalizedBase.endsWith("/ws")) {
      return normalizedBase;
    }
    return `${normalizedBase}/ws`;
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}

export function createRuntimeSocket(callbacks: WsCallbacks, options?: RuntimeSocketOptions): RuntimeSocketController {
  const url = resolveSocketUrl();
  const participateInGlobalSubscriptions = options?.participateInGlobalSubscriptions !== false;
  let socket: WebSocket | null = null;
  let closedByUser = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let isOpen = false;
  let pendingTags: string[] | null = null;
  let lastSentSignature = "";
  const queuedMessages: RuntimeWsClientMessage[] = [];

  const scheduleReconnect = () => {
    if (closedByUser || reconnectTimer) {
      return;
    }
    reconnectAttempt += 1;
    const baseDelay = Math.min(10_000, 500 * Math.pow(2, Math.min(reconnectAttempt, 6)));
    const jitter = Math.floor(Math.random() * 250);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, baseDelay + jitter);
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

  const connect = () => {
    callbacks.onSocketStateChange?.("connecting");
    socket = new WebSocket(url);

    socket.onmessage = onSocketMessage;
    socket.onopen = () => {
      isOpen = true;
      callbacks.onSocketStateChange?.("open");
      reconnectAttempt = 0;
      if (pendingTags) {
        sendSubscription(pendingTags);
      }
      flushQueue();
    };

    socket.onclose = () => {
      isOpen = false;
      callbacks.onSocketStateChange?.("closed");
      if (closedByUser) {
        if (activeSocketController === controller) {
          activeSocketController = null;
        }
        return;
      }
      scheduleReconnect();
    };

    socket.onerror = () => {
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

  connect();
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
