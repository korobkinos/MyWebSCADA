import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import { writeTagMessageSchema, type RuntimeWsServerMessage, type TagValue } from "@web-scada/shared";
import { CommandService } from "../runtime/command-service.js";
import { TagStore } from "../tags/tag-store.js";

export class WebSocketGateway {
  private readonly clients = new Set<WebSocket>();
  private readonly queue = new Map<string, TagValue>();
  private flushTimer: NodeJS.Timeout | undefined;
  private unsubscribeTagListener: (() => void) | undefined;

  public constructor(
    private readonly tagStore: TagStore,
    private readonly commandService: CommandService,
  ) {}

  public async register(app: FastifyInstance): Promise<void> {
    app.get("/ws", { websocket: true }, (socket) => {
      this.clients.add(socket);

      socket.on("message", (payload: unknown) => {
        void this.handleClientMessage(String(payload));
      });

      socket.on("close", () => {
        this.clients.delete(socket);
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
    for (const client of this.clients) {
      try {
        client.close(1001, "Server shutdown");
      } catch {
        // ignore close errors during shutdown
      }
    }
    this.clients.clear();
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
    if (this.queue.size === 0) {
      return;
    }

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

    const serialized = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(serialized);
      }
    }
  }

  private async handleClientMessage(raw: string): Promise<void> {
    try {
      const parsed = writeTagMessageSchema.parse(JSON.parse(raw));
      await this.commandService.writeTag(parsed.payload.name, parsed.payload.value);
    } catch {
      // ignore invalid client payloads
    }
  }
}
