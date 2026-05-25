import type { EventOccurrence, ScadaProject, TagValue } from "@web-scada/shared";
import { ArchiveService } from "../archive/archive-service.js";
import { CommandService } from "../runtime/command-service.js";
import { TagStore } from "../tags/tag-store.js";
import { WebSocketGateway } from "../websocket/websocket-gateway.js";
import {
  evaluateTransition,
  normalizeEventDefinition,
  type EventRuntimeState,
  type NormalizedEventDefinition,
} from "./event-engine-logic.js";
import { executeEventActions } from "./event-action-executor.js";

type EventEngineLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

type EventEngineOptions = {
  evaluationIntervalMs?: number;
  logger?: EventEngineLogger;
  isRuntimeRunning?: () => boolean;
};

type ConfigureProjectOptions = {
  broadcastSnapshotUpdates?: boolean;
};

type AcknowledgeEventsResult = {
  acknowledged: EventOccurrence[];
  alreadyAcknowledgedIds: string[];
  notFoundIds: string[];
  ackTagWriteFailures: Array<{
    occurrenceId: string;
    tagName: string;
    message: string;
  }>;
};

export class EventEngine {
  private readonly logger: EventEngineLogger;
  private readonly evaluationIntervalMs: number;
  private readonly eventStates = new Map<string, EventRuntimeState>();
  private readonly definitions = new Map<string, NormalizedEventDefinition>();
  private readonly definitionsByTag = new Map<string, Set<string>>();
  private readonly isRuntimeRunning: () => boolean;

  private unsubscribeTagChange: (() => void) | undefined;
  private evaluationTimer: NodeJS.Timeout | undefined;
  private evaluationChain = Promise.resolve();
  private running = false;
  private archiveEnabled = true;

  public constructor(
    private readonly tagStore: TagStore,
    private readonly archiveService: ArchiveService | undefined,
    private readonly websocketGateway: WebSocketGateway,
    private readonly commandService?: CommandService,
    options?: EventEngineOptions,
  ) {
    this.logger = options?.logger ?? console;
    this.evaluationIntervalMs = Math.max(250, options?.evaluationIntervalMs ?? 500);
    this.isRuntimeRunning = options?.isRuntimeRunning ?? (() => true);
  }

  public async start(project: ScadaProject): Promise<void> {
    await this.stop();
    this.running = true;
    await this.configureProject(project);

    this.unsubscribeTagChange = this.tagStore.subscribe((value) => {
      this.enqueueEvaluation(async () => {
        await this.evaluateByTag(value.name, Date.now());
      });
    });

    this.evaluationTimer = setInterval(() => {
      this.enqueueEvaluation(async () => {
        await this.evaluateAll(Date.now());
      });
    }, this.evaluationIntervalMs);

    this.enqueueEvaluation(async () => {
      await this.evaluateAll(Date.now());
    });

    this.logger.info(
      `[EventEngine] started intervalMs=${this.evaluationIntervalMs} definitions=${this.definitions.size}`,
    );
  }

  public async stop(): Promise<void> {
    this.running = false;

    if (this.unsubscribeTagChange) {
      this.unsubscribeTagChange();
      this.unsubscribeTagChange = undefined;
    }

    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = undefined;
    }

    this.evaluationChain = Promise.resolve();
    this.logger.info("[EventEngine] stopped");
  }

  public async configureProject(project: ScadaProject, options?: ConfigureProjectOptions): Promise<void> {
    this.archiveEnabled = await this.resolveArchiveEnabled(project);
    this.rebuildDefinitions(project);
    if (this.archiveService?.isEnabled()) {
      const updatedOccurrences = await this.archiveService.syncOnlineEventDefinitionSnapshots(project.events ?? []);
      if (options?.broadcastSnapshotUpdates === true) {
        for (const occurrence of updatedOccurrences) {
          this.websocketGateway.broadcastEventUpdate(
            occurrence.state === "active" ? "active" : "cleared",
            occurrence,
          );
        }
      }
    }
    this.reconcileStateForCurrentDefinitions(Date.now());
    await this.hydrateActiveStatesFromArchive();
  }

  public setArchiveEnabled(enabled: boolean): void {
    this.archiveEnabled = enabled;
  }

  public async acknowledgeOccurrences(
    ids: Array<string | number>,
    acknowledgedBy?: string,
  ): Promise<AcknowledgeEventsResult> {
    if (!this.archiveService?.isEnabled()) {
      return {
        acknowledged: [],
        alreadyAcknowledgedIds: [],
        notFoundIds: ids.map((item) => String(item)),
        ackTagWriteFailures: [],
      };
    }

    const normalizedIds = [...new Set(ids.map((item) => String(item).trim()).filter(Boolean))];
    if (normalizedIds.length === 0) {
      return {
        acknowledged: [],
        alreadyAcknowledgedIds: [],
        notFoundIds: [],
        ackTagWriteFailures: [],
      };
    }

    const existing = await this.archiveService.getEventOccurrencesByIds(normalizedIds);
    const existingById = new Map(existing.map((item) => [item.id, item] as const));

    const notFoundIds = normalizedIds.filter((id) => !existingById.has(id));
    const alreadyAcknowledgedIds: string[] = [];
    const acknowledged: EventOccurrence[] = [];
    const ackTagWriteFailures: Array<{ occurrenceId: string; tagName: string; message: string }> = [];
    const acknowledgedAt = new Date();

    for (const id of normalizedIds) {
      const current = existingById.get(id);
      if (!current) {
        continue;
      }

      if (current.acknowledgedAt) {
        alreadyAcknowledgedIds.push(id);
        continue;
      }

      const updated = await this.archiveService.acknowledgeEventOccurrence(id, acknowledgedAt, acknowledgedBy ?? null);
      if (!updated) {
        notFoundIds.push(id);
        continue;
      }

      acknowledged.push(updated);
      const definition = this.definitions.get(updated.eventDefinitionId);
      const clientActions = await executeEventActions({
        trigger: "ack",
        eventDefinitionId: updated.eventDefinitionId,
        occurrenceId: updated.id,
        actions: definition?.onAckActions,
        commandService: this.commandService,
        logger: this.logger,
      });
      this.websocketGateway.broadcastEventUpdate("acknowledged", updated, {
        actionsToRun: clientActions.length > 0 ? clientActions : undefined,
        actionTrigger: clientActions.length > 0 ? "ack" : undefined,
      });
      this.releaseActiveStateAfterAck(updated);

      const ackTagName = definition?.ackTagName?.trim();
      if (!ackTagName || definition?.ackValue === undefined || !this.commandService) {
        continue;
      }

      try {
        await this.commandService.writeTag(ackTagName, definition.ackValue);
      } catch (error) {
        ackTagWriteFailures.push({
          occurrenceId: updated.id,
          tagName: ackTagName,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      acknowledged,
      alreadyAcknowledgedIds,
      notFoundIds,
      ackTagWriteFailures,
    };
  }

  private enqueueEvaluation(run: () => Promise<void>): void {
    this.evaluationChain = this.evaluationChain.then(run).catch((error) => {
      const text = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[EventEngine] evaluation error: ${text}`);
    });
  }

  private async evaluateAll(nowMs: number): Promise<void> {
    if (!this.running || !this.isRuntimeRunning() || !this.archiveEnabled || this.definitions.size === 0) {
      return;
    }

    for (const definitionId of this.definitions.keys()) {
      await this.evaluateDefinition(definitionId, nowMs);
    }
  }

  private async evaluateByTag(tagName: string, nowMs: number): Promise<void> {
    if (!this.running || !this.isRuntimeRunning() || !this.archiveEnabled) {
      return;
    }

    const ids = this.definitionsByTag.get(tagName);
    if (!ids || ids.size === 0) {
      return;
    }

    for (const definitionId of ids) {
      await this.evaluateDefinition(definitionId, nowMs);
    }
  }

  private async evaluateDefinition(definitionId: string, nowMs: number): Promise<void> {
    const definition = this.definitions.get(definitionId);
    if (!definition || !this.archiveService?.isEnabled()) {
      return;
    }

    const previous = this.eventStates.get(definitionId) ?? {
      previousConditionActive: false,
      startupReadyAt: nowMs + definition.startupDelayMs,
    };

    const sourceValue = this.tagStore.getValue(definition.sourceTagName);
    const securityValue = definition.securityTagName
      ? this.tagStore.getValue(definition.securityTagName)
      : undefined;

    const evaluated = evaluateTransition({
      definition,
      state: previous,
      nowMs,
      sourceValue,
      securityValue,
    });

    const next = evaluated.nextState;
    this.eventStates.set(definitionId, next);

    if (evaluated.skipped || !sourceValue) {
      return;
    }

    const isEdgeTrigger =
      definition.conditionMode === "bit" &&
      (definition.bitTrigger === "OFF_TO_ON" || definition.bitTrigger === "ON_TO_OFF");

    if (isEdgeTrigger) {
      if (!evaluated.edgeTriggered) {
        return;
      }

      const occurrence = await this.createEdgeOccurrence(definition, sourceValue, nowMs);
      if (!occurrence) {
        return;
      }

      if (occurrence.state === "active") {
        next.activeOccurrenceId = occurrence.id;
        next.activeSince = occurrence.occurredAt;
        const clientActions = await executeEventActions({
          trigger: "active",
          eventDefinitionId: definition.id,
          occurrenceId: occurrence.id,
          actions: definition.onActiveActions,
          commandService: this.commandService,
          logger: this.logger,
        });
        this.websocketGateway.broadcastEventUpdate("active", occurrence, {
          actionsToRun: clientActions.length > 0 ? clientActions : undefined,
          actionTrigger: clientActions.length > 0 ? "active" : undefined,
        });
      } else {
        next.activeOccurrenceId = undefined;
        next.activeSince = undefined;
        const clientActions = await executeEventActions({
          trigger: "active",
          eventDefinitionId: definition.id,
          occurrenceId: occurrence.id,
          actions: definition.onActiveActions,
          commandService: this.commandService,
          logger: this.logger,
        });
        this.websocketGateway.broadcastEventUpdate("cleared", occurrence, {
          actionsToRun: clientActions.length > 0 ? clientActions : undefined,
          actionTrigger: clientActions.length > 0 ? "active" : undefined,
        });
      }

      this.eventStates.set(definitionId, next);
      return;
    }

    const wasActive = previous.previousConditionActive === true;
    const isActive = evaluated.conditionActive;

    if (!wasActive && isActive) {
      if (next.activeOccurrenceId) {
        return;
      }

      const created = await this.archiveService.createEventOccurrence({
        eventDefinitionId: definition.id,
        occurredAt: new Date(nowMs),
        state: "active",
        sourceTagNameSnapshot: definition.sourceTagName,
        categoryIdSnapshot: definition.categoryId ?? null,
        categoryNameSnapshot: definition.categoryName ?? null,
        prioritySnapshot: typeof definition.priority === "number" ? definition.priority : null,
        messageTextSnapshot: definition.message ?? null,
        valueAtTrigger: sourceValue.value,
        quality: sourceValue.quality,
        runtimeSource: sourceValue.source,
        serviceData: this.buildServiceData(definition, false),
      });

      next.activeOccurrenceId = created.id;
      next.activeSince = created.occurredAt;
      this.eventStates.set(definitionId, next);
      const clientActions = await executeEventActions({
        trigger: "active",
        eventDefinitionId: definition.id,
        occurrenceId: created.id,
        actions: definition.onActiveActions,
        commandService: this.commandService,
        logger: this.logger,
      });
      this.websocketGateway.broadcastEventUpdate("active", created, {
        actionsToRun: clientActions.length > 0 ? clientActions : undefined,
        actionTrigger: clientActions.length > 0 ? "active" : undefined,
      });
      return;
    }

    if (wasActive && !isActive) {
      if (!previous.activeOccurrenceId) {
        next.activeOccurrenceId = undefined;
        next.activeSince = undefined;
        this.eventStates.set(definitionId, next);
        return;
      }

      const cleared = await this.archiveService.clearEventOccurrence(
        previous.activeOccurrenceId,
        new Date(nowMs),
        sourceValue.value,
      );

      next.activeOccurrenceId = undefined;
      next.activeSince = undefined;
      this.eventStates.set(definitionId, next);

      if (cleared) {
        const clientActions = await executeEventActions({
          trigger: "cleared",
          eventDefinitionId: definition.id,
          occurrenceId: cleared.id,
          actions: definition.onClearedActions,
          commandService: this.commandService,
          logger: this.logger,
        });
        this.websocketGateway.broadcastEventUpdate("cleared", cleared, {
          actionsToRun: clientActions.length > 0 ? clientActions : undefined,
          actionTrigger: clientActions.length > 0 ? "cleared" : undefined,
        });
      }
    }
  }

  private async createEdgeOccurrence(
    definition: NormalizedEventDefinition,
    sourceValue: TagValue,
    nowMs: number,
  ): Promise<EventOccurrence | null> {
    if (!this.archiveService?.isEnabled()) {
      return null;
    }

    const occurredAt = new Date(nowMs);
    const clearImmediately = !definition.requireAck;

    // Edge events are instantaneous.
    // - requireAck=false: persist directly as cleared.
    // - requireAck=true: persist as active with clearedAt set, then keep until ack.
    return this.archiveService.createEventOccurrence({
      eventDefinitionId: definition.id,
      occurredAt,
      clearedAt: occurredAt,
      state: clearImmediately ? "cleared" : "active",
      sourceTagNameSnapshot: definition.sourceTagName,
      categoryIdSnapshot: definition.categoryId ?? null,
      categoryNameSnapshot: definition.categoryName ?? null,
      prioritySnapshot: typeof definition.priority === "number" ? definition.priority : null,
      messageTextSnapshot: definition.message ?? null,
      valueAtTrigger: sourceValue.value,
      valueAtClear: sourceValue.value,
      quality: sourceValue.quality,
      runtimeSource: sourceValue.source,
      serviceData: this.buildServiceData(definition, true),
    });
  }

  private buildServiceData(
    definition: NormalizedEventDefinition,
    edge: boolean,
  ): Record<string, unknown> {
    return {
      soundId: definition.soundEnabled && definition.soundId ? definition.soundId : null,
      requireAck: definition.requireAck,
      conditionMode: definition.conditionMode,
      bitTrigger: definition.conditionMode === "bit" ? definition.bitTrigger : undefined,
      wordOperator: definition.conditionMode === "word" ? definition.wordOperator : undefined,
      wordValue: definition.conditionMode === "word" ? definition.wordValue : undefined,
      edge,
    };
  }

  private rebuildDefinitions(project: ScadaProject): void {
    this.definitions.clear();
    this.definitionsByTag.clear();

    const definitions = project.events ?? [];
    for (const eventDefinition of definitions) {
      const normalized = normalizeEventDefinition(eventDefinition);
      if (!normalized.enabled) {
        continue;
      }
      if (!normalized.sourceTagName) {
        continue;
      }
      if (normalized.securityEnabled && !normalized.securityTagName) {
        continue;
      }
      if (!this.tagStore.getDefinition(normalized.sourceTagName)) {
        continue;
      }
      if (
        normalized.securityEnabled &&
        normalized.securityTagName &&
        !this.tagStore.getDefinition(normalized.securityTagName)
      ) {
        continue;
      }

      this.definitions.set(normalized.id, normalized);
      this.bindDefinitionTag(normalized.sourceTagName, normalized.id);
      if (normalized.securityTagName) {
        this.bindDefinitionTag(normalized.securityTagName, normalized.id);
      }
    }
  }

  private bindDefinitionTag(tagName: string, definitionId: string): void {
    const existing = this.definitionsByTag.get(tagName);
    if (existing) {
      existing.add(definitionId);
      return;
    }
    this.definitionsByTag.set(tagName, new Set([definitionId]));
  }

  private reconcileStateForCurrentDefinitions(nowMs: number): void {
    const validIds = new Set(this.definitions.keys());
    for (const key of this.eventStates.keys()) {
      if (!validIds.has(key)) {
        this.eventStates.delete(key);
      }
    }

    for (const [id, definition] of this.definitions.entries()) {
      const existing = this.eventStates.get(id);
      if (!existing) {
        this.eventStates.set(id, {
          previousConditionActive: false,
          startupReadyAt: nowMs + definition.startupDelayMs,
        });
        continue;
      }

      this.eventStates.set(id, {
        ...existing,
        startupReadyAt: nowMs + definition.startupDelayMs,
        previousConditionActive: false,
        activeOccurrenceId: undefined,
        activeSince: undefined,
      });
    }
  }

  private async hydrateActiveStatesFromArchive(): Promise<void> {
    if (!this.archiveService?.isEnabled()) {
      return;
    }

    const active = await this.archiveService.listActiveEvents(5000);
    if (active.length === 0) {
      return;
    }

    for (const occurrence of active) {
      const definition = this.definitions.get(occurrence.eventDefinitionId);
      if (!definition) {
        continue;
      }

      const state = this.eventStates.get(definition.id);
      if (!state || state.activeOccurrenceId) {
        continue;
      }

      state.activeOccurrenceId = occurrence.id;
      state.activeSince = occurrence.occurredAt;
      this.eventStates.set(definition.id, state);
    }
  }

  private async resolveArchiveEnabled(project: ScadaProject): Promise<boolean> {
    if (project.eventArchiveSettings?.enabled === false) {
      return false;
    }
    if (!this.archiveService?.isEnabled()) {
      return false;
    }

    try {
      const settings = await this.archiveService.getEventArchiveSettings();
      return settings.enabled;
    } catch {
      return true;
    }
  }

  private releaseActiveStateAfterAck(occurrence: EventOccurrence): void {
    const state = this.eventStates.get(occurrence.eventDefinitionId);
    if (!state || state.activeOccurrenceId !== occurrence.id) {
      return;
    }

    if (!occurrence.clearedAt) {
      return;
    }

    state.activeOccurrenceId = undefined;
    state.activeSince = undefined;
    this.eventStates.set(occurrence.eventDefinitionId, state);
  }
}
