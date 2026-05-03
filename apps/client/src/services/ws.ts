import type { RuntimeWsClientMessage, RuntimeWsServerMessage, TagValue } from "@web-scada/shared";

type WsCallbacks = {
  onTagValue: (value: TagValue) => void;
};

export function createRuntimeSocket(callbacks: WsCallbacks): { close: () => void; writeTag: (name: string, value: TagValue["value"]) => void } {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

  socket.onmessage = (event) => {
    const parsed = JSON.parse(event.data) as RuntimeWsServerMessage;

    if (parsed.type === "tag-update") {
      callbacks.onTagValue({
        ...parsed.payload,
        source: parsed.payload.source ?? "ws",
      });
      return;
    }

    if (parsed.type === "tag-batch") {
      for (const update of parsed.payload.updates) {
        callbacks.onTagValue({
          ...update,
          source: update.source ?? "ws",
        });
      }
    }
  };

  return {
    close: () => socket.close(),
    writeTag: (name, value) => {
      const payload: RuntimeWsClientMessage = {
        type: "write-tag",
        payload: {
          name,
          value,
        },
      };
      socket.send(JSON.stringify(payload));
    },
  };
}
