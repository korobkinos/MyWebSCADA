import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import { runtimeWsClientMessageSchema, type EventOccurrence, type RuntimeWsServerMessage, type TagValue } from "@web-scada/shared";
import { CommandService } from "../runtime/command-service.js";
import { RuntimeService } from "../runtime/runtime-service.js";
import { logPerf } from "../runtime/perf-logger.js";
import { TagStore } from "../tags/tag-store.js";
import { ManualCommandError } from "../runtime/manual-command-error.js";

export class WebSocketGateway {
  private readonly clients = new Set<WebSocket>();
  private readonly subscriptions = new Map<WebSocket, Set<string>>();
  private readonly queue = new Map<string, TagValue>();
  private flushTimer: NodeJS.Timeout | undefined;
  private unsubscribeTagListener: (() => void) | undefined;

  public constructor(
    private readonly tagStore: TagStore,
    private readonly commandService: CommandService,
    private readonly runtimeService: RuntimeService,
  ) {}

  public async register(app: FastifyInstance): Promise<void> {
    app.get("/ws", { websocket: true }, (socket) => {
      this.clients.add(socket);
      this.subscriptions.set(socket, new Set<string>());
      this.syncRuntimeSubscriptions();

      socket.on("message", (payload: unknown) => {
        this.handleClientMessage(socket, String(payload));
      });

      socket.on("close", () => {
        this.clients.delete(socket);
        this.subscriptions.delete(socket);
        this.syncRuntimeSubscriptions();
      });
    });

    this.unsubscribeTagListener = this.tagStore.subscribe((value) => {
      this.queue.set(value.name, value);
      this.ensureFlusher();
    });
  }

  public async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    if (this.unsubscribeTagListener) {
      this.unsubscribeTagListener();
      this.unsubscribeTagListener = undefined;
    }

    this.queue.clear();
    this.subscriptions.clear();
    this.runtimeService.clearActiveTags();
    for (const client of this.clients) {
      try {
        client.close(1001, "Server shutdown");
      } catch {
        // ignore close errors during shutdown
      }
    }
    this.clients.clear();
  }

  public broadcastEventUpdate(kind: "active" | "cleared" | "acknowledged", occurrence: EventOccurrence): void {
    const message: RuntimeWsServerMessage = {
      type: "event-update",
      payload: {
        kind,
        occurrence,
      },
    };
    this.broadcastSerialized(JSON.stringify(message));
  }

  private ensureFlusher(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setInterval(() => {
      this.flush();
    }, 200);
  }

  private flush(): void {
    if (!this.runtimeService.getState().running) {
      this.queue.clear();
      return;
    }
    if (this.queue.size === 0) {
      return;
    }
    const startedAt = Date.now();

    const updates = [...this.queue.values()].map((item) => ({
      name: item.name,
      value: item.value,
      quality: item.quality,
      timestamp: item.timestamp,
      source: item.source,
    }));

    this.queue.clear();

    const first = updates[0];
    if (!first) {
      return;
    }

    const message: RuntimeWsServerMessage =
      updates.length === 1
        ? {
            type: "tag-update",
            payload: first,
          }
        : {
            type: "tag-batch",
            payload: { updates },
          };

    this.broadcastSerialized(JSON.stringify(message));
    logPerf({
      component: "websocket",
      action: "broadcast",
      updates: updates.length,
      clients: this.clients.size,
      durationMs: Date.now() - startedAt,
    });
  }

  private handleClientMessage(client: WebSocket, raw: string): void {
    try {
      const parsed = runtimeWsClientMessageSchema.parse(JSON.parse(raw));
      if (parsed.type === "write-tag") {
        void this.commandService.writeTag(parsed.payload.name, parsed.payload.value, {
          manual: true,
          commandMeta: parsed.payload.commandMeta,
        }).catch((error) => {
          if (error instanceof ManualCommandError) {
            console.warn("[WebSocketGateway] Manual write rejected", {
              commandKey: parsed.payload.commandMeta?.commandKey ?? `tag:${parsed.payload.name}`,
              reason: error.reason,
              message: error.message,
            });
            return;
          }
          console.error("[WebSocketGateway] Manual write failed", error);
        });
        return;
      }

      const nextTags = new Set<string>();
      for (const item of parsed.payload.tags) {
        const trimmed = item.trim();
        if (trimmed) {
          nextTags.add(trimmed);
        }
      }
      this.subscriptions.set(client, nextTags);
      this.syncRuntimeSubscriptions();
    } catch {
      // ignore invalid client payloads
    }
  }

  private syncRuntimeSubscriptions(): void {
    if (this.subscriptions.size === 0) {
      this.runtimeService.setActiveTags([]);
      return;
    }

    const union = new Set<string>();
    for (const set of this.subscriptions.values()) {
      for (const tag of set) {
        union.add(tag);
      }
    }
    this.runtimeService.setActiveTags(union);
  }

  private broadcastSerialized(serialized: string): void {
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(serialized);
      }
    }
  }
}
