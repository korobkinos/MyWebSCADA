import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ACCESS_ROLE_LABELS_RU,
  COMMAND_TIMEOUT_MS,
  clampAccessRoleLevel,
  getUserRoleLevel,
  hasRoleAccess,
  roleLevelFromRoles,
  type AccessRoleLevel,
  type ManualCommandMeta,
  type ManualCommandRejectReason,
  createInitialPopupState,
  popupReducer,
  resolveRuntimeAction,
  type PopupInstance,
  type RenderContext,
  type RuntimeAction,
} from "@web-scada/shared";
import { Button, Card, Form, InputNumber, Modal, Space, Typography, message } from "antd";
import { HmiStage } from "../hmi/runtime/hmi-stage";
import { NumericInputDialog, type NumericInputDialogState } from "../hmi/runtime/numeric-input-dialog";
import type { NumericInputOpenPayload } from "../hmi/runtime/hmi-renderer";
import { collectRuntimeTagSubscriptions } from "../hmi/runtime/runtime-tag-subscriptions";
import { updateRuntimeTagSubscriptions } from "../services/ws";
import { useScadaStore } from "../store/scada-store";
import {
  WorkbenchButton,
  WorkbenchLoginForm,
  WorkbenchWindowManager,
  useWorkbenchWindows,
  type WorkbenchWindowDefinition,
} from "../components/workbench";

type RuntimePageProps = {
  fullscreen?: boolean;
};

type RuntimeAccessState = {
  requiredRole: AccessRoleLevel;
  currentRole: AccessRoleLevel;
  details?: string;
};

const RUNTIME_ACCESS_WINDOW_ID = "runtimeAccessRequired";
const RUNTIME_AUTH_WINDOW_ID = "runtimeAuthorization";
const COMMAND_WARNING_COOLDOWN_MS = 1200;
const RUNTIME_COMMAND_DEBUG_LOCAL_STORAGE_KEY = "scada.runtime.debugCommands";
const INDEXED_ADDRESS_DEBUG_LOCAL_STORAGE_KEY = "scada.debugIndexedAddress";
const COMMAND_WARNING_MAP_MAX_SIZE = 2000;
const COMMAND_WARNING_RETENTION_MS = 30_000;
const FAST_INTERNAL_MACRO_TIMEOUT_MS = 1000;

export function RuntimePage({ fullscreen = false }: RuntimePageProps) {
  const project = useScadaStore((s) => s.project);
  const tags = useScadaStore((s) => s.tags);
  const libraries = useScadaStore((s) => s.libraries);
  const currentScreenId = useScadaStore((s) => s.currentScreenId);
  const setCurrentScreen = useScadaStore((s) => s.setCurrentScreen);
  const runtime = useScadaStore((s) => s.runtime);
  const writeTag = useScadaStore((s) => s.writeTag);
  const writeVariable = useScadaStore((s) => s.writeVariable);
  const runMacro = useScadaStore((s) => s.runMacro);
  const macros = useScadaStore((s) => s.macros);
  const loadRuntimeStatus = useScadaStore((s) => s.loadRuntimeStatus);
  const startRuntime = useScadaStore((s) => s.startRuntime);
  const stopRuntime = useScadaStore((s) => s.stopRuntime);
  const authUser = useScadaStore((s) => s.authUser);
  const login = useScadaStore((s) => s.login);
  const userRoleLevel = getUserRoleLevel(authUser);

  const [popupState, dispatchPopup] = useReducer(popupReducer, undefined, createInitialPopupState);
  const dragRefs = useRef<Record<string, { dx: number; dy: number }>>({});
  const pendingCommandKeysRef = useRef(new Map<string, { startedAt: number; timeoutMs: number; popupInstanceId?: string }>());
  const activeRuntimeCommandsRef = useRef(new Map<string, {
    commandKey: string;
    popupInstanceId?: string;
    abortController?: AbortController;
  }>());
  const commandWarningTimestampsRef = useRef(new Map<string, number>());
  const runtimeRootRef = useRef<HTMLDivElement | null>(null);
  const indexedAddressDebugCounterRef = useRef<unknown>(Symbol("init"));
  const debugActionTiming =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.localStorage.getItem("debugActionTiming") === "1";
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    text: string;
    action?: RuntimeAction;
    context?: RenderContext;
  }>({ open: false, text: "Confirm action?" });
  const [numberPrompt, setNumberPrompt] = useState<{
    open: boolean;
    action?: Extract<RuntimeAction, { type: "writeNumberPrompt" }>;
    context?: RenderContext;
    value?: number;
  }>({ open: false });
  const [numericDialogState, setNumericDialogState] = useState<NumericInputDialogState | null>(null);
  const numericDialogId = "runtimeNumericInput";
  const [runtimeActionPending, setRuntimeActionPending] = useState<"start" | "stop" | "refresh" | null>(null);
  const [accessState, setAccessState] = useState<RuntimeAccessState>({
    requiredRole: 1,
    currentRole: 0,
  });
  const {
    openWindows,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindow,
    resizeWindow,
  } = useWorkbenchWindows();

  const screen = useMemo(
    () =>
      project
        ? project.screens.find((item) => item.id === currentScreenId)
          ?? project.screens.find((item) => item.id === project.startScreenId)
          ?? project.screens[0]
        : undefined,
    [currentScreenId, project],
  );
  const runtimeUserRoles = useMemo(() => authUser?.roles ?? [], [authUser?.roles]);
  const mainRenderContext = useMemo(
    () => ({
      screenId: screen?.id,
      userRoles: runtimeUserRoles,
      userRoleLevel,
      isAuthenticated: Boolean(authUser),
    }),
    [authUser, runtimeUserRoles, screen?.id, userRoleLevel],
  );

  useEffect(() => {
    void loadRuntimeStatus();
  }, [loadRuntimeStatus]);

  useEffect(() => {
    if (!screen) {
      return;
    }
    if (currentScreenId !== screen.id) {
      setCurrentScreen(screen.id);
    }
  }, [currentScreenId, screen, setCurrentScreen]);

  const modalOpen = popupState.items.some((item) => item.modal);

  useEffect(() => {
    if (!import.meta.env.DEV || fullscreen !== true || !screen) {
      return;
    }
    const root = runtimeRootRef.current;
    // eslint-disable-next-line no-console
    console.debug("[Runtime Layout]", {
      window: [window.innerWidth, window.innerHeight],
      body: [document.body.scrollWidth, document.body.scrollHeight],
      runtimeRoot: [root?.clientWidth ?? 0, root?.clientHeight ?? 0],
    });
    if (document.body.scrollWidth > window.innerWidth || document.body.scrollHeight > window.innerHeight) {
      // eslint-disable-next-line no-console
      console.warn("Runtime body overflow detected", {
        body: [document.body.scrollWidth, document.body.scrollHeight],
        window: [window.innerWidth, window.innerHeight],
      });
    }
  }, [fullscreen, popupState.items.length, screen?.id, screen?.width, screen?.height]);

  const popupScreens = useMemo(
    () =>
      project
        ? popupState.items
          .map((item) => ({
            item,
            screen: project.screens.find((s) => s.id === item.popupScreenId),
          }))
          .filter((entry): entry is { item: PopupInstance; screen: NonNullable<typeof entry.screen> } => Boolean(entry.screen))
        : [],
    [popupState.items, project],
  );

  useEffect(() => {
    if (!project || !screen) {
      updateRuntimeTagSubscriptions([]);
      return;
    }
    const subscriptionTags = collectRuntimeTagSubscriptions({
      project,
      libraries,
      screen,
      tags,
      popups: popupScreens.map(({ item, screen: popupScreen }) => ({
        screen: popupScreen,
        tagPrefix: item.tagPrefix,
        args: item.args,
      })),
    });
    updateRuntimeTagSubscriptions(subscriptionTags);
  }, [libraries, popupScreens, project, screen, tags]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (window.localStorage.getItem(INDEXED_ADDRESS_DEBUG_LOCAL_STORAGE_KEY) !== "1") {
      return;
    }

    const counterRaw = (tags as Record<string, unknown>).Counter;
    const counterLowerRaw = (tags as Record<string, unknown>).counter;
    const counter = unwrapRuntimeTagValue(counterRaw);
    const counterLower = unwrapRuntimeTagValue(counterLowerRaw);

    if (indexedAddressDebugCounterRef.current === counter) {
      return;
    }
    indexedAddressDebugCounterRef.current = counter;

    // eslint-disable-next-line no-console
    console.debug("[indexed-address] runtime-page:tagValues", {
      Counter: counter,
      counterLower,
      keysHasCounter: Object.keys(tags).includes("Counter"),
      counterRaw,
      counterLowerRaw,
    });
  }, [tags]);

  useEffect(() => {
    return () => {
      updateRuntimeTagSubscriptions([]);
    };
  }, []);

  const runtimeAccessWindowRect = useMemo(() => {
    if (typeof window === "undefined") {
      return { x: 72, y: 72, width: 420, height: 180 };
    }
    const width = 420;
    const height = 180;
    return {
      x: Math.max(16, Math.round(window.innerWidth / 2 - width / 2)),
      y: Math.max(16, Math.round(window.innerHeight / 2 - height / 2)),
      width,
      height,
    };
  }, []);

  const runtimeAuthWindowRect = useMemo(() => {
    if (typeof window === "undefined") {
      return { x: 88, y: 88, width: 420, height: 260 };
    }
    const width = 420;
    const height = 260;
    return {
      x: Math.max(16, Math.round(window.innerWidth / 2 - width / 2)),
      y: Math.max(16, Math.round(window.innerHeight / 2 - height / 2)),
      width,
      height,
    };
  }, []);

  const openAccessWindow = (nextState: RuntimeAccessState) => {
    setAccessState(nextState);
    openWindow({
      id: RUNTIME_ACCESS_WINDOW_ID,
      title: "Authorization Required",
      defaultRect: runtimeAccessWindowRect,
      minWidth: 360,
      minHeight: 160,
      render: () => null,
    });
  };

  const closeAccessWindow = () => {
    closeWindow(RUNTIME_ACCESS_WINDOW_ID);
  };

  const openAuthWindow = () => {
    openWindow({
      id: RUNTIME_AUTH_WINDOW_ID,
      title: "Authorization",
      defaultRect: runtimeAuthWindowRect,
      minWidth: 360,
      minHeight: 230,
      render: () => null,
    });
  };

  const closeAuthWindow = () => {
    closeWindow(RUNTIME_AUTH_WINDOW_ID);
  };

  if (!project || !screen) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const resolveRequiredRoleLevel = (action: RuntimeAction): AccessRoleLevel => {
    const explicitRoleLevel = clampAccessRoleLevel(action.requiredRoleLevel, 0);
    const requiredRoleLevels = (action.requiredRoles ?? [])
      .map((role) => role.trim())
      .filter(Boolean)
      .map((role) => clampAccessRoleLevel(roleLevelFromRoles([role]), 0));
    const derivedFromLegacyRoles = requiredRoleLevels.length > 0
      ? requiredRoleLevels.reduce((min, value) => (value < min ? value : min), 4)
      : 0;
    return clampAccessRoleLevel(Math.max(explicitRoleLevel, derivedFromLegacyRoles), 0);
  };

  const getActionClickTimestamp = (context: RenderContext): number | undefined => {
    const raw = context.parameters?.__actionClickTs;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  };

  const getRuntimeActionObjectId = (context: RenderContext): string | undefined => {
    const runtimeObjectId = context.parameters?.__runtimeObjectId;
    if (typeof runtimeObjectId === "string" && runtimeObjectId.trim()) {
      return runtimeObjectId.trim();
    }
    const legacyObjectId = context.parameters?.objectId;
    if (typeof legacyObjectId === "string" && legacyObjectId.trim()) {
      return legacyObjectId.trim();
    }
    return undefined;
  };

  const getRuntimeActionObjectScope = (context: RenderContext): string | undefined => {
    const runtimeObjectScope = context.parameters?.__runtimeObjectScope;
    if (typeof runtimeObjectScope === "string" && runtimeObjectScope.trim()) {
      return runtimeObjectScope.trim();
    }
    return undefined;
  };

  const getRuntimeActionObjectName = (context: RenderContext): string | undefined => {
    const runtimeObjectName = context.parameters?.__runtimeObjectName;
    if (typeof runtimeObjectName === "string" && runtimeObjectName.trim()) {
      return runtimeObjectName.trim();
    }
    const fallbackObjectName = context.parameters?.objectName;
    if (typeof fallbackObjectName === "string" && fallbackObjectName.trim()) {
      return fallbackObjectName.trim();
    }
    return undefined;
  };

  const debugRuntimeCommand = (event: string, data: Record<string, unknown>): void => {
    if (typeof window === "undefined") {
      return;
    }
    if (window.localStorage.getItem(RUNTIME_COMMAND_DEBUG_LOCAL_STORAGE_KEY) !== "1") {
      return;
    }
    // eslint-disable-next-line no-console
    console.debug("[runtime-command]", event, data);
  };

  const createRuntimeCommandDebugPayload = (params: {
    status: "start" | "skipped" | "success" | "error";
    actionType: RuntimeAction["type"];
    commandKey: string;
    context: RenderContext;
    macroId?: string;
    reason?: string;
    details?: Record<string, unknown>;
  }): Record<string, unknown> => {
    const invalidCommandKeyParts = params.commandKey
      .split(":")
      .filter((part) => part === "undefined" || part === "null");
    return {
      status: params.status,
      commandKey: params.commandKey,
      actionType: params.actionType,
      objectId: getRuntimeActionObjectId(params.context),
      objectScope: getRuntimeActionObjectScope(params.context),
      objectName: getRuntimeActionObjectName(params.context),
      macroId: params.macroId,
      screenId: params.context.screenId,
      popupInstanceId: params.context.popupInstanceId,
      reason: params.reason,
      commandKeyHasInvalidParts: invalidCommandKeyParts.length > 0,
      invalidCommandKeyParts: invalidCommandKeyParts.length > 0 ? invalidCommandKeyParts : undefined,
      ...params.details,
    };
  };

  const normalizeMacroId = (value: unknown): string | undefined => {
    if (value === undefined || value === null) {
      return undefined;
    }
    const trimmed = String(value).trim();
    if (!trimmed || trimmed === "undefined" || trimmed === "null") {
      return undefined;
    }
    return trimmed;
  };

  const stripRuntimeActionMeta = (parameters: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
    if (!parameters) {
      return undefined;
    }
    const entries = Object.entries(parameters).filter(([key]) => !key.startsWith("__"));
    if (!entries.length) {
      return undefined;
    }
    return Object.fromEntries(entries);
  };

  const roundMs = (value: number): number => Math.round(value * 1000) / 1000;
  const getCommandDebugTimestamp = (): string => new Date().toISOString();
  const isCommandKeyInFlight = (commandKey: string): boolean => {
    for (const meta of activeRuntimeCommandsRef.current.values()) {
      if (meta.commandKey === commandKey) {
        return true;
      }
    }
    return false;
  };
  const isInternalOnlyMacroCode = (code: string | undefined): boolean => {
    if (!code) {
      return false;
    }
    if (/\b(?:writeTag|pulseTag|toggleTag|readTag|getTagQuality|tagExists|openPopup|closePopup|openScreen)\s*\(/.test(code)) {
      return false;
    }
    return /\b(?:readVariable|writeVariable|getVar|setVar|getLW|setLW)\s*\(/.test(code);
  };

  const logActionTiming = (params: {
    actionType: RuntimeAction["type"];
    actionId: string;
    status: string;
    context: RenderContext;
    clickTs?: number;
    requestStartTs: number;
    responseTs?: number;
    details?: Record<string, unknown>;
  }): void => {
    if (!debugActionTiming) {
      return;
    }
    const responseTs = params.responseTs ?? performance.now();
    const clickToRequestMs = typeof params.clickTs === "number" ? roundMs(params.requestStartTs - params.clickTs) : undefined;
    const requestDurationMs = roundMs(responseTs - params.requestStartTs);
    const totalFromClickMs = typeof params.clickTs === "number" ? roundMs(responseTs - params.clickTs) : undefined;
    // eslint-disable-next-line no-console
    console.debug("[RuntimeActionTiming]", {
      actionType: params.actionType,
      actionId: params.actionId,
      status: params.status,
      clickToRequestMs,
      requestDurationMs,
      totalFromClickMs,
      screenId: params.context.screenId,
      popupInstanceId: params.context.popupInstanceId,
      tagPrefix: params.context.tagPrefix,
      objectId: getRuntimeActionObjectId(params.context),
      ...params.details,
    });
  };

  const runTimedRequest = async <T,>(
    params: {
      action: RuntimeAction;
      actionId: string;
      context: RenderContext;
      clickTs?: number;
      run: () => Promise<T>;
      statusFromResult?: (result: T) => string;
    },
  ): Promise<T> => {
    const requestStartTs = performance.now();
    try {
      const result = await params.run();
      logActionTiming({
        actionType: params.action.type,
        actionId: params.actionId,
        status: params.statusFromResult?.(result) ?? "ok",
        context: params.context,
        clickTs: params.clickTs,
        requestStartTs,
      });
      return result;
    } catch (error) {
      logActionTiming({
        actionType: params.action.type,
        actionId: params.actionId,
        status: "error",
        context: params.context,
        clickTs: params.clickTs,
        requestStartTs,
        details: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  };

  const createManualCommandMeta = (commandKey: string, ttlMs: number): ManualCommandMeta => ({
    commandId: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    commandKey,
    createdAt: Date.now(),
    ttlMs,
  });

  const shouldShowCommandWarning = (commandKey: string): boolean => {
    const now = Date.now();
    if (commandWarningTimestampsRef.current.size >= COMMAND_WARNING_MAP_MAX_SIZE) {
      for (const [key, timestamp] of commandWarningTimestampsRef.current.entries()) {
        if (now - timestamp > COMMAND_WARNING_RETENTION_MS) {
          commandWarningTimestampsRef.current.delete(key);
        }
      }
      if (commandWarningTimestampsRef.current.size >= COMMAND_WARNING_MAP_MAX_SIZE) {
        commandWarningTimestampsRef.current.clear();
      }
    }
    const lastAt = commandWarningTimestampsRef.current.get(commandKey) ?? 0;
    if (now - lastAt < COMMAND_WARNING_COOLDOWN_MS) {
      return false;
    }
    commandWarningTimestampsRef.current.set(commandKey, now);
    return true;
  };

  const abortPopupRuntimeCommands = (popupInstanceId: string): void => {
    let abortedCount = 0;
    for (const meta of activeRuntimeCommandsRef.current.values()) {
      if (meta.popupInstanceId !== popupInstanceId) {
        continue;
      }
      meta.abortController?.abort();
      abortedCount += 1;
    }
    for (const [commandKey, pending] of pendingCommandKeysRef.current.entries()) {
      if (pending.popupInstanceId === popupInstanceId) {
        pendingCommandKeysRef.current.delete(commandKey);
      }
    }
    debugRuntimeCommand("popup-close-abort", {
      popupInstanceId,
      abortedCount,
    });
  };

  const closePopupById = (popupInstanceId?: string): void => {
    if (popupInstanceId) {
      abortPopupRuntimeCommands(popupInstanceId);
      dispatchPopup({ type: "close", payload: { id: popupInstanceId } });
      return;
    }
    const top = popupState.items.reduce<PopupInstance | undefined>(
      (acc, item) => (!acc || item.zIndex > acc.zIndex ? item : acc),
      undefined,
    );
    if (top) {
      abortPopupRuntimeCommands(top.id);
      dispatchPopup({ type: "close", payload: { id: top.id } });
      return;
    }
    dispatchPopup({ type: "close", payload: {} });
  };

  const logRuntimeCommand = (params: {
    level: "warning" | "error";
    reason: ManualCommandRejectReason | "disabled" | "already_running";
    actionType: RuntimeAction["type"];
    commandKey: string;
    context: RenderContext;
    macroId?: string;
    durationMs?: number;
    messageText?: string;
  }): void => {
    const payload = {
      timestamp: new Date().toISOString(),
      level: params.level,
      actionType: params.actionType,
      commandKey: params.commandKey,
      objectId: getRuntimeActionObjectId(params.context),
      macroId: params.macroId,
      reason: params.reason,
      durationMs: params.durationMs,
      message: params.messageText,
    };
    if (params.level === "error") {
      // eslint-disable-next-line no-console
      console.error("[RuntimeCommand]", payload);
      return;
    }
    // eslint-disable-next-line no-console
    console.warn("[RuntimeCommand]", payload);
  };

  const parseManualCommandError = (error: unknown): { reason: ManualCommandRejectReason; messageText: string } => {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        reason: "timeout",
        messageText: `Command timeout after ${COMMAND_TIMEOUT_MS} ms`,
      };
    }

    const err = error as { message?: string; reason?: string; status?: number; details?: { reason?: string; message?: string } } | undefined;
    const explicitReason = typeof err?.reason === "string"
      ? err.reason
      : typeof err?.details?.reason === "string"
        ? err.details.reason
        : undefined;
    const reason = toManualCommandRejectReason(explicitReason, err?.status);
    const messageText = (typeof err?.details?.message === "string" && err.details.message.trim())
      || (typeof err?.message === "string" && err.message.trim())
      || "Command failed";
    return { reason, messageText };
  };

  const runGuardedManualCommand = async <T,>(params: {
    action: RuntimeAction;
    context: RenderContext;
    clickTs?: number;
    commandKey: string;
    actionId: string;
    macroId?: string;
    timeoutMs?: number;
    duplicatePolicy?: "strict" | "in_flight_only";
    run: (signal: AbortSignal | undefined, commandMeta: ManualCommandMeta) => Promise<T>;
    statusFromResult?: (result: T) => string;
  }): Promise<T | undefined> => {
    const timeoutMs = Math.max(1, Math.floor(params.timeoutMs ?? COMMAND_TIMEOUT_MS));
    const duplicatePolicy = params.duplicatePolicy ?? "strict";
    debugRuntimeCommand(
      "pending-check",
      createRuntimeCommandDebugPayload({
        status: "start",
        actionType: params.action.type,
        commandKey: params.commandKey,
        context: params.context,
        macroId: params.macroId,
      }),
    );
    const existing = pendingCommandKeysRef.current.get(params.commandKey);
    const inFlightForKey = isCommandKeyInFlight(params.commandKey);
    debugRuntimeCommand("pending-check-result", {
      timestamp: getCommandDebugTimestamp(),
      actionType: params.action.type,
      commandKey: params.commandKey,
      macroId: params.macroId,
      objectId: getRuntimeActionObjectId(params.context),
      objectScope: getRuntimeActionObjectScope(params.context),
      screenId: params.context.screenId,
      popupInstanceId: params.context.popupInstanceId,
      pendingFound: Boolean(existing),
      pendingForMs: existing ? Date.now() - existing.startedAt : 0,
      inFlightForKey,
      duplicatePolicy,
      clickTs: params.clickTs,
    });
    if (existing) {
      const shouldBlock = duplicatePolicy === "in_flight_only"
        ? inFlightForKey
        : Date.now() - existing.startedAt <= existing.timeoutMs + 750;
      if (shouldBlock) {
        const warnText = params.macroId
          ? "Macro ignored: already pending"
          : "Command ignored: already pending";
        debugRuntimeCommand("pending-hit", {
          timestamp: getCommandDebugTimestamp(),
          actionType: params.action.type,
          commandKey: params.commandKey,
          macroId: params.macroId,
          durationMs: Date.now() - existing.startedAt,
          reason: "already_pending",
          duplicatePolicy,
          inFlightForKey,
        });
        debugRuntimeCommand(
          "skipped",
          createRuntimeCommandDebugPayload({
            status: "skipped",
            actionType: params.action.type,
            commandKey: params.commandKey,
            context: params.context,
            macroId: params.macroId,
            reason: "already_pending",
            details: {
              pendingForMs: Date.now() - existing.startedAt,
            },
          }),
        );
        logRuntimeCommand({
          level: "warning",
          reason: "already_pending",
          actionType: params.action.type,
          commandKey: params.commandKey,
          context: params.context,
          macroId: params.macroId,
          messageText: warnText,
        });
        if (shouldShowCommandWarning(params.commandKey)) {
          void message.warning(warnText);
        }
        if (debugActionTiming) {
          logActionTiming({
            actionType: params.action.type,
            actionId: params.actionId,
            status: "already_pending",
            context: params.context,
            clickTs: params.clickTs,
            requestStartTs: performance.now(),
          });
        }
        return undefined;
      }
      pendingCommandKeysRef.current.delete(params.commandKey);
      debugRuntimeCommand("pending-delete", {
        timestamp: getCommandDebugTimestamp(),
        actionType: params.action.type,
        commandKey: params.commandKey,
        macroId: params.macroId,
        durationMs: Date.now() - existing.startedAt,
        reason: "stale_pending",
      });
    }

    const pendingStartedAt = Date.now();
    pendingCommandKeysRef.current.set(params.commandKey, {
      startedAt: pendingStartedAt,
      timeoutMs,
      popupInstanceId: params.context.popupInstanceId,
    });
    debugRuntimeCommand("pending-add", {
      timestamp: getCommandDebugTimestamp(),
      actionType: params.action.type,
      commandKey: params.commandKey,
      macroId: params.macroId,
      timeoutMs,
      duplicatePolicy,
    });
    const startedAt = Date.now();
    debugRuntimeCommand(
      "start",
      createRuntimeCommandDebugPayload({
        status: "start",
        actionType: params.action.type,
        commandKey: params.commandKey,
        context: params.context,
        macroId: params.macroId,
      }),
    );
    const commandMeta = createManualCommandMeta(params.commandKey, timeoutMs);
    const abortController = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    activeRuntimeCommandsRef.current.set(commandMeta.commandId, {
      commandKey: params.commandKey,
      popupInstanceId: params.context.popupInstanceId,
      abortController,
    });
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let pendingDeleteReason = "completed";

    try {
      const timedResult = await runTimedRequest({
        action: params.action,
        actionId: params.actionId,
        context: params.context,
        clickTs: params.clickTs,
        statusFromResult: params.statusFromResult,
        run: async () => {
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              abortController?.abort();
              const timeoutError = new Error(`Command timeout after ${timeoutMs} ms`) as Error & { reason?: ManualCommandRejectReason };
              timeoutError.reason = "timeout";
              reject(timeoutError);
            }, timeoutMs);
          });
          return await Promise.race([
            params.run(abortController?.signal, commandMeta),
            timeoutPromise,
          ]);
        },
      });
      debugRuntimeCommand(
        "success",
        createRuntimeCommandDebugPayload({
          status: "success",
          actionType: params.action.type,
          commandKey: params.commandKey,
          context: params.context,
          macroId: params.macroId,
          details: {
            durationMs: Date.now() - startedAt,
          },
        }),
      );
      return timedResult;
    } catch (error) {
      const parsed = parseManualCommandError(error);
      pendingDeleteReason = parsed.reason;
      const durationMs = Date.now() - startedAt;
      debugRuntimeCommand(
        "error",
        createRuntimeCommandDebugPayload({
          status: "error",
          actionType: params.action.type,
          commandKey: params.commandKey,
          context: params.context,
          macroId: params.macroId,
          reason: parsed.reason,
          details: {
            durationMs,
            error: parsed.messageText,
          },
        }),
      );
      const level: "warning" | "error" = parsed.reason === "busy" ? "warning" : "error";
      logRuntimeCommand({
        level,
        reason: parsed.reason,
        actionType: params.action.type,
        commandKey: params.commandKey,
        context: params.context,
        macroId: params.macroId,
        durationMs,
        messageText: parsed.messageText,
      });
      const toastText = params.macroId
        ? `Macro failed: ${parsed.messageText}`
        : `Command failed: ${parsed.messageText}`;
      if (parsed.reason === "busy") {
        void message.warning(toastText);
      } else {
        void message.error(toastText);
      }
      return undefined;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      activeRuntimeCommandsRef.current.delete(commandMeta.commandId);
      pendingCommandKeysRef.current.delete(params.commandKey);
      debugRuntimeCommand("pending-delete", {
        timestamp: getCommandDebugTimestamp(),
        actionType: params.action.type,
        commandKey: params.commandKey,
        macroId: params.macroId,
        durationMs: Date.now() - pendingStartedAt,
        reason: pendingDeleteReason,
      });
    }
  };

  const executeAction = async (inputAction: RuntimeAction, context: RenderContext): Promise<void> => {
    const action = resolveRuntimeAction(inputAction, context);
    const clickTs = getActionClickTimestamp(context);
    const actor = useScadaStore.getState().authUser;
    const guestRuntimeActionsEnabled = project.runtimeSettings?.allowGuestRuntimeActions !== false;
    const guestRuntimeControlAllowed = !actor && guestRuntimeActionsEnabled && isGuestRuntimeControlAction(action);
    const actorRoleLevel = guestRuntimeControlAllowed ? 1 : getUserRoleLevel(actor);
    const requiredRoleLevel = resolveRequiredRoleLevel(action);
    const requiresAuth = action.requireAuth === true;

    if (requiresAuth && !actor) {
      openAccessWindow({
        requiredRole: Math.max(requiredRoleLevel, 1) as AccessRoleLevel,
        currentRole: 0,
      });
      return;
    }

    if (!hasRoleAccess(actorRoleLevel, requiredRoleLevel)) {
      openAccessWindow({
        requiredRole: requiredRoleLevel,
        currentRole: actorRoleLevel,
      });
      return;
    }

    if ("confirm" in action && action.confirm) {
      setConfirmState({
        open: true,
        text: action.confirmText ?? "Confirm action?",
        action: { ...action, confirm: false },
        context,
      });
      return;
    }

    if (action.type === "write") {
      await runGuardedManualCommand({
        action,
        actionId: action.tag,
        context,
        clickTs,
        commandKey: getRuntimeActionCommandKey(action, context),
        run: (signal, commandMeta) => writeTag(action.tag, action.value, { signal, commandMeta }),
      });
      return;
    }

    if (action.type === "pulse") {
      const result = await runGuardedManualCommand({
        action,
        actionId: action.tag,
        context,
        clickTs,
        commandKey: getRuntimeActionCommandKey(action, context),
        run: (signal, commandMeta) => writeTag(action.tag, action.value, { signal, commandMeta }),
      });
      if (result === undefined) {
        return;
      }
      setTimeout(() => {
        void writeTag(action.tag, false);
      }, action.durationMs);
      return;
    }

    if (action.type === "toggle") {
      const current = tags[action.tag];
      await runGuardedManualCommand({
        action,
        actionId: action.tag,
        context,
        clickTs,
        commandKey: getRuntimeActionCommandKey(action, context),
        run: (signal, commandMeta) => writeTag(action.tag, !Boolean(current?.value), { signal, commandMeta }),
      });
      return;
    }

    if (action.type === "writeConst") {
      if (action.target === "variable") {
        await runGuardedManualCommand({
          action,
          actionId: action.name,
          context,
          clickTs,
          commandKey: getRuntimeActionCommandKey(action, context),
          run: (signal, commandMeta) => writeVariable(action.name, action.value, { signal, commandMeta }),
        });
      } else {
        await runGuardedManualCommand({
          action,
          actionId: action.name,
          context,
          clickTs,
          commandKey: getRuntimeActionCommandKey(action, context),
          run: (signal, commandMeta) => writeTag(action.name, action.value, { signal, commandMeta }),
        });
      }
      return;
    }

    if (action.type === "writeNumberPrompt") {
      setNumberPrompt({ open: true, action, context, value: undefined });
      return;
    }

    if (action.type === "openUrl") {
      if (action.newTab ?? true) {
        window.open(action.url, "_blank", "noopener,noreferrer");
      } else {
        window.location.href = action.url;
      }
      return;
    }

    if (action.type === "runMacro") {
      const macroRunStartedAt = performance.now();
      const macroId = normalizeMacroId(action.macroId);
      const commandKey = getRuntimeActionCommandKey(action, context);
      debugRuntimeCommand("macro-before-guard", {
        timestamp: getCommandDebugTimestamp(),
        clickTs,
        commandKey,
        macroId: typeof macroId === "string" ? macroId : undefined,
        objectId: getRuntimeActionObjectId(context),
        objectScope: getRuntimeActionObjectScope(context),
        objectName: getRuntimeActionObjectName(context),
        screenId: context.screenId,
        popupInstanceId: context.popupInstanceId,
        args: action.args,
        pendingFound: pendingCommandKeysRef.current.has(commandKey),
      });
      if (!macroId) {
        debugRuntimeCommand(
          "error",
          createRuntimeCommandDebugPayload({
            status: "error",
            actionType: action.type,
            commandKey,
            context,
            macroId: typeof action.macroId === "string" ? action.macroId : undefined,
            reason: "invalid_macro_id",
          }),
        );
        void message.error("Macro id is invalid");
        return;
      }
      const selectedMacro = macros.find((macro) => macro.id === macroId);
      const macroExists = Boolean(selectedMacro);
      if (!macroExists) {
        debugRuntimeCommand(
          "error",
          createRuntimeCommandDebugPayload({
            status: "error",
            actionType: action.type,
            commandKey,
            context,
            macroId,
            reason: "macro_not_found",
          }),
        );
        void message.error(`Macro ${macroId} not found`);
        return;
      }
      const internalOnlyMacro = isInternalOnlyMacroCode(selectedMacro?.code);
      const allowRepeatedMacroRun = action.allowRepeat === true || macroId === "inc_counter" || internalOnlyMacro;
      const macroTimeoutMs = internalOnlyMacro ? FAST_INTERNAL_MACRO_TIMEOUT_MS : COMMAND_TIMEOUT_MS;
      const result = await runGuardedManualCommand({
        action,
        actionId: macroId,
        context,
        clickTs,
        commandKey,
        macroId,
        timeoutMs: macroTimeoutMs,
        duplicatePolicy: allowRepeatedMacroRun ? "in_flight_only" : "strict",
        run: async (signal, commandMeta) => {
          const fetchStartedAt = performance.now();
          debugRuntimeCommand("macro-before-fetch", {
            timestamp: getCommandDebugTimestamp(),
            clickTs,
            commandKey,
            macroId,
            objectId: getRuntimeActionObjectId(context),
            objectScope: getRuntimeActionObjectScope(context),
            objectName: getRuntimeActionObjectName(context),
            screenId: context.screenId,
            popupInstanceId: context.popupInstanceId,
            args: action.args,
            durationMs: roundMs(fetchStartedAt - macroRunStartedAt),
            commandId: commandMeta.commandId,
          });
          const macroResult = await runMacro(macroId, action.args, {
            signal,
            commandMeta,
            context: {
              popupInstanceId: context.popupInstanceId,
              screenId: context.screenId,
              tagPrefix: context.tagPrefix,
              parameters: stripRuntimeActionMeta(context.parameters),
            },
          });
          const fetchCompletedAt = performance.now();
          debugRuntimeCommand("macro-after-fetch", {
            timestamp: getCommandDebugTimestamp(),
            clickTs,
            commandKey,
            macroId,
            objectId: getRuntimeActionObjectId(context),
            objectScope: getRuntimeActionObjectScope(context),
            objectName: getRuntimeActionObjectName(context),
            screenId: context.screenId,
            popupInstanceId: context.popupInstanceId,
            args: action.args,
            status: macroResult.status,
            reason: macroResult.reason,
            diagnostics: macroResult.diagnostics,
            durationMs: roundMs(fetchCompletedAt - fetchStartedAt),
            totalMs: roundMs(fetchCompletedAt - macroRunStartedAt),
          });
          return macroResult;
        },
        statusFromResult: (value) => value.status === "skipped" ? `skipped:${value.reason ?? "unknown"}` : (value.status ?? "ok"),
      });
      if (!result) {
        return;
      }
      if (result.status === "skipped" && result.reason === "disabled") {
        debugRuntimeCommand(
          "skipped",
          createRuntimeCommandDebugPayload({
            status: "skipped",
            actionType: action.type,
            commandKey,
            context,
            macroId,
            reason: "disabled",
          }),
        );
        logRuntimeCommand({
          level: "warning",
          reason: "disabled",
          actionType: action.type,
          commandKey,
          context,
          macroId,
          messageText: `Macro "${selectedMacro?.name ?? macroId}" is disabled`,
        });
        if (shouldShowCommandWarning(commandKey)) {
          void message.warning(`Macro "${selectedMacro?.name ?? macroId}" is disabled and was not executed`);
        }
        debugRuntimeCommand("macro-total", {
          timestamp: getCommandDebugTimestamp(),
          clickTs,
          commandKey,
          macroId,
          status: "skipped",
          reason: "disabled",
          durationMs: roundMs(performance.now() - macroRunStartedAt),
          args: action.args,
        });
        return;
      }
      if (result.status === "skipped" && result.reason === "already_running") {
        debugRuntimeCommand(
          "skipped",
          createRuntimeCommandDebugPayload({
            status: "skipped",
            actionType: action.type,
            commandKey,
            context,
            macroId,
            reason: "already_running",
          }),
        );
        logRuntimeCommand({
          level: "warning",
          reason: "already_running",
          actionType: action.type,
          commandKey,
          context,
          macroId,
          messageText: "Macro ignored: already running",
        });
        if (shouldShowCommandWarning(commandKey)) {
          void message.warning(`Macro "${selectedMacro?.name ?? macroId}" is already running`);
        }
        debugRuntimeCommand("macro-total", {
          timestamp: getCommandDebugTimestamp(),
          clickTs,
          commandKey,
          macroId,
          status: "skipped",
          reason: "already_running",
          durationMs: roundMs(performance.now() - macroRunStartedAt),
          args: action.args,
        });
        return;
      }
      const effectsStartedAt = performance.now();
      for (const effect of result.effects ?? []) {
        await executeAction(effect as RuntimeAction, context);
      }
      const effectsCompletedAt = performance.now();
      debugRuntimeCommand("macro-after-effects", {
        timestamp: getCommandDebugTimestamp(),
        clickTs,
        commandKey,
        macroId,
        objectId: getRuntimeActionObjectId(context),
        objectScope: getRuntimeActionObjectScope(context),
        objectName: getRuntimeActionObjectName(context),
        screenId: context.screenId,
        popupInstanceId: context.popupInstanceId,
        args: action.args,
        effectsCount: result.effects?.length ?? 0,
        effectsDurationMs: roundMs(effectsCompletedAt - effectsStartedAt),
        durationMs: roundMs(effectsCompletedAt - macroRunStartedAt),
      });
      return;
    }

    if (action.type === "setLW") {
      await runGuardedManualCommand({
        action,
        actionId: `LW${Math.max(0, Math.floor(action.address))}`,
        context,
        clickTs,
        commandKey: getRuntimeActionCommandKey(action, context),
        run: (signal, commandMeta) =>
          writeVariable(`LW${Math.max(0, Math.floor(action.address))}`, action.value, { signal, commandMeta }),
      });
      return;
    }

    if (action.type === "setInternalVar") {
      await runGuardedManualCommand({
        action,
        actionId: action.name,
        context,
        clickTs,
        commandKey: getRuntimeActionCommandKey(action, context),
        run: (signal, commandMeta) => writeVariable(action.name, action.value, { signal, commandMeta }),
      });
      return;
    }

    if (action.type === "openScreen") {
      setCurrentScreen(action.screenId);
      return;
    }

    if (action.type === "openPopup") {
      const popupScreen = project.screens.find((s) => s.id === action.popupScreenId && s.kind === "popup");
      if (!popupScreen) {
        return;
      }
      const popupKey = getPopupKey(action);
      if (popupKey) {
        const existing = popupState.items.find((item) => item.popupKey === popupKey);
        if (existing) {
          dispatchPopup({ type: "focus", payload: { id: existing.id } });
          return;
        }
      }
      const popupOptions = popupScreen.popupOptions ?? {};
      dispatchPopup({
        type: "open",
        payload: {
          id: `popup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          popupKey,
          popupScreenId: action.popupScreenId,
          title: action.title ?? popupOptions.title ?? popupScreen.name,
          x: action.x ?? popupOptions.defaultX ?? 120,
          y: action.y ?? popupOptions.defaultY ?? 120,
          tagPrefix: action.tagPrefix,
          args: action.args,
          modal: popupOptions.modal ?? false,
          draggable: popupOptions.draggable ?? true,
          closable: popupOptions.closable ?? true,
          resizable: popupOptions.resizable ?? false,
        },
      });
      return;
    }

    if (action.type === "closePopup") {
      closePopupById(action.popupInstanceId);
    }
  };

  const handleRequestNumericInput = (payload: NumericInputOpenPayload) => {
    const dialogState: NumericInputDialogState = {
      objectId: payload.objectId,
      objectName: payload.objectName,
      targetTag: payload.writeTag ?? "",
      currentValue: payload.currentValue,
      min: payload.min,
      max: payload.max,
      step: payload.step,
      decimals: payload.decimals,
      formatMode: payload.formatMode,
      formatPattern: payload.formatPattern,
      unit: payload.unit,
      requiredActionRole: payload.requiredActionRole,
      backgroundColor: payload.backgroundColor,
      textColor: payload.textColor,
      borderColor: payload.borderColor,
      fontFamily: payload.fontFamily,
      fontSize: payload.fontSize,
    };
    setNumericDialogState(dialogState);
    openWindow({
      id: numericDialogId,
      title: payload.objectName || "Numeric Input",
      defaultRect: { x: 200, y: 150, width: 320, height: 200 },
      minWidth: 260,
      minHeight: 160,
      render: () => {
        const state = numericDialogState;
        if (!state) return null;
        return (
          <NumericInputDialog
            state={state}
            onCommit={async (value) => {
              const targetTag = state.targetTag;
              if (!targetTag) return;
              await executeAction(
                {
                  type: "write",
                  tag: targetTag,
                  value,
                  confirm: false,
                  requireAuth: false,
                },
                {
                  screenId: screen?.id,
                  userRoles: runtimeUserRoles,
                  userRoleLevel,
                  isAuthenticated: Boolean(authUser),
                },
              );
              closeWindow(numericDialogId);
              setNumericDialogState(null);
            }}
            onCancel={() => {
              closeWindow(numericDialogId);
              setNumericDialogState(null);
            }}
          />
        );
      },
    });
  };

  const stageElement = (
    <HmiStage
      project={project}
      mode="runtime"
      screen={screen}
      tags={tags}
      libraries={libraries}
      fullscreenRuntime={fullscreen}
      currentUserRoleLevel={userRoleLevel}
      renderContext={mainRenderContext}
      onAction={(action, context) => executeAction(action, context)}
      onRequestNumericInput={handleRequestNumericInput}
    />
  );

  const popupOverlay = (
    <>
      {modalOpen ? <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 1000 }} /> : null}
      {popupScreens.map(({ item, screen: popupScreen }) => (
        <div
          key={item.id}
          style={{
            position: "fixed",
            left: item.x,
            top: item.y,
            width: popupScreen.width,
            height: popupScreen.height + 34,
            border: "1px solid #4b5968",
            background: "#121a23",
            boxShadow: "0 12px 26px rgba(0,0,0,0.45)",
            zIndex: 1000 + item.zIndex,
          }}
          onMouseDown={() => dispatchPopup({ type: "focus", payload: { id: item.id } })}
        >
          <div
            style={{
              height: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 10px",
              background: "#1f2a38",
              color: "#fff",
              cursor: item.draggable ? "move" : "default",
              userSelect: "none",
            }}
            onMouseDown={(event) => {
              if (!item.draggable) {
                return;
              }
              dragRefs.current[item.id] = {
                dx: event.clientX - item.x,
                dy: event.clientY - item.y,
              };

              const onMove = (moveEvent: MouseEvent) => {
                const drag = dragRefs.current[item.id];
                if (!drag) {
                  return;
                }
                dispatchPopup({
                  type: "move",
                  payload: {
                    id: item.id,
                    x: moveEvent.clientX - drag.dx,
                    y: moveEvent.clientY - drag.dy,
                  },
                });
              };

              const onUp = () => {
                delete dragRefs.current[item.id];
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };

              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
          >
            <span>{item.title ?? popupScreen.name}</span>
            {item.closable ? (
              <Button size="small" onClick={() => closePopupById(item.id)}>
                X
              </Button>
            ) : null}
          </div>
          <HmiStage
            project={project}
            mode="runtime"
            screen={popupScreen}
            tags={tags}
            libraries={libraries}
            fullscreenRuntime={false}
            currentUserRoleLevel={userRoleLevel}
            renderContext={{
              popupInstanceId: item.id,
              screenId: popupScreen.id,
              title: item.title,
              tagPrefix: item.tagPrefix,
              parameters: item.args,
              args: item.args,
              userRoles: runtimeUserRoles,
              userRoleLevel,
              isAuthenticated: Boolean(authUser),
            }}
            onAction={(action, context) => {
              return executeAction(action, context);
            }}
            onRequestNumericInput={handleRequestNumericInput}
          />
        </div>
      ))}
    </>
  );

  const runtimeWindowDefinitions: WorkbenchWindowDefinition[] = [
    {
      id: RUNTIME_ACCESS_WINDOW_ID,
      title: "Authorization Required",
      defaultRect: runtimeAccessWindowRect,
      minWidth: 360,
      minHeight: 160,
      render: () => (
        <div className="runtime-access-window">
          <div className="runtime-access-window__roles">
            <div className="runtime-access-dialog__text">
              Required role: <strong>{accessState.requiredRole} - {ACCESS_ROLE_LABELS_RU[accessState.requiredRole]}</strong>
            </div>
            <div className="runtime-access-dialog__text">
              Current role: <strong>{accessState.currentRole} - {ACCESS_ROLE_LABELS_RU[accessState.currentRole]}</strong>
            </div>
            {accessState.details ? (
              <div className="runtime-access-dialog__text runtime-access-dialog__details">
                {accessState.details}
              </div>
            ) : null}
          </div>
          <div className="runtime-access-dialog__actions">
            <WorkbenchButton
              variant="primary"
              onClick={() => {
                closeAccessWindow();
                openAuthWindow();
              }}
            >
              Authorization
            </WorkbenchButton>
            <WorkbenchButton
              onClick={() => {
                closeAccessWindow();
              }}
            >
              Cancel
            </WorkbenchButton>
          </div>
        </div>
      ),
    },
    {
      id: RUNTIME_AUTH_WINDOW_ID,
      title: "Authorization",
      defaultRect: runtimeAuthWindowRect,
      minWidth: 360,
      minHeight: 230,
      render: () => (
        <div className="workbench-login-window">
          <WorkbenchLoginForm
            submitLabel="Login"
            showCancel
            onCancel={() => {
              closeAuthWindow();
            }}
            onSubmit={async (username, password) => {
              try {
                const ok = await login(username, password);
                if (!ok) {
                  return { ok: false, error: "Invalid credentials." };
                }
                closeAuthWindow();
                closeAccessWindow();
                void message.success("Authorized. Press the control again.");
                return { ok: true };
              } catch (error) {
                return { ok: false, error: error instanceof Error ? error.message : String(error) };
              }
            }}
          />
        </div>
      ),
    },
    {
      id: numericDialogId,
      title: "Numeric Input",
      defaultRect: { x: 200, y: 150, width: 320, height: 200 },
      minWidth: 260,
      minHeight: 160,
      render: () => {
        const state = numericDialogState;
        if (!state) return null;
        return (
          <NumericInputDialog
            state={state}
            onCommit={async (value) => {
              const targetTag = state.targetTag;
              if (!targetTag) return;
              await executeAction(
                {
                  type: "write",
                  tag: targetTag,
                  value,
                  confirm: false,
                  requireAuth: false,
                },
                {
                  screenId: screen?.id,
                  userRoles: runtimeUserRoles,
                  userRoleLevel,
                  isAuthenticated: Boolean(authUser),
                },
              );
              closeWindow(numericDialogId);
            }}
            onCancel={() => {
              closeWindow(numericDialogId);
            }}
          />
        );
      },
    },
  ];

  const runtimeAuthWindows = (
    <WorkbenchWindowManager
      windows={openWindows}
      definitions={runtimeWindowDefinitions}
      onClose={(id) => {
        closeWindow(id);
      }}
      onFocus={focusWindow}
      onMove={moveWindow}
      onResize={resizeWindow}
    />
  );

  const runtimeState = runtime.state ?? (runtime.running ? "running" : "stopped");
  const runtimeStartedAtText = runtime.startedAt ? new Date(runtime.startedAt).toLocaleString() : "-";
  const runtimeStoppedAtText = runtime.stoppedAt ? new Date(runtime.stoppedAt).toLocaleString() : "-";

  const refreshRuntime = async () => {
    setRuntimeActionPending("refresh");
    try {
      await loadRuntimeStatus();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void message.error(text || "Failed to refresh runtime status");
    } finally {
      setRuntimeActionPending(null);
    }
  };

  const startRuntimeWithStatus = async () => {
    setRuntimeActionPending("start");
    try {
      await startRuntime();
      await loadRuntimeStatus();
      void message.success("Runtime started");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void message.error(text || "Failed to start runtime");
    } finally {
      setRuntimeActionPending(null);
    }
  };

  const stopRuntimeWithStatus = async () => {
    setRuntimeActionPending("stop");
    try {
      await stopRuntime();
      await loadRuntimeStatus();
      void message.success("Runtime stopped");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void message.error(text || "Failed to stop runtime");
    } finally {
      setRuntimeActionPending(null);
    }
  };

  if (fullscreen) {
    return (
      <div
        ref={runtimeRootRef}
        className="screen-editor-workbench-page runtime-workbench-page"
        style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}
      >
        {stageElement}
        {popupOverlay}
        <RuntimeDialogs
          confirmState={confirmState}
          numberPrompt={numberPrompt}
          onConfirm={async () => {
            const nextAction = confirmState.action;
            const nextContext = confirmState.context;
            setConfirmState({ open: false, text: "Confirm action?" });
            if (nextAction && nextContext) {
              await executeAction(nextAction, nextContext);
            }
          }}
          onCancelConfirm={() => setConfirmState({ open: false, text: "Confirm action?" })}
          onCloseNumberPrompt={() => setNumberPrompt({ open: false })}
          onApplyNumberPrompt={async () => {
            const action = numberPrompt.action;
            const promptContext = numberPrompt.context;
            const value = numberPrompt.value;
            if (!action || !promptContext || typeof value !== "number" || Number.isNaN(value)) {
              void message.warning("Numeric value is required");
              return;
            }
            if (typeof action.min === "number" && value < action.min) {
              void message.warning(`Value must be >= ${action.min}`);
              return;
            }
            if (typeof action.max === "number" && value > action.max) {
              void message.warning(`Value must be <= ${action.max}`);
              return;
            }
            await executeAction(
              {
                type: "writeConst",
                target: action.target,
                name: action.name,
                value,
              },
              promptContext,
            );
            setNumberPrompt({ open: false });
          }}
          onChangeNumberValue={(value) => setNumberPrompt((prev) => ({ ...prev, value: value === null ? undefined : Number(value) }))}
        />
        {runtimeAuthWindows}
      </div>
    );
  }

  return (
    <div className="screen-editor-workbench-page runtime-workbench-page" style={{ position: "relative" }}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Card size="small">
          <Space>
            <Button
              onClick={() => void startRuntimeWithStatus()}
              type="primary"
              disabled={runtimeState === "running" || runtimeState === "starting" || runtimeActionPending !== null}
            >
              {runtimeActionPending === "start" ? "Starting..." : "Start Runtime"}
            </Button>
            <Button
              onClick={() => void stopRuntimeWithStatus()}
              disabled={runtimeState === "stopped" || runtimeState === "stopping" || runtimeActionPending !== null}
            >
              {runtimeActionPending === "stop" ? "Stopping..." : "Stop Runtime"}
            </Button>
            <Button onClick={() => void refreshRuntime()} disabled={runtimeActionPending !== null}>
              {runtimeActionPending === "refresh" ? "Refreshing..." : "Refresh"}
            </Button>
            <Typography.Text>Runtime: {runtimeState}</Typography.Text>
            <Typography.Text type="secondary">Started: {runtimeStartedAtText}</Typography.Text>
            <Typography.Text type="secondary">Stopped: {runtimeStoppedAtText}</Typography.Text>
            {runtime.lastError ? <Typography.Text type="danger">Error: {runtime.lastError}</Typography.Text> : null}
            <Typography.Text strong>{screen.name}</Typography.Text>
          </Space>
        </Card>

        <div style={{ position: "relative" }}>
          {stageElement}
          {popupOverlay}
        </div>
        <RuntimeDialogs
          confirmState={confirmState}
          numberPrompt={numberPrompt}
          onConfirm={async () => {
            const nextAction = confirmState.action;
            const nextContext = confirmState.context;
            setConfirmState({ open: false, text: "Confirm action?" });
            if (nextAction && nextContext) {
              await executeAction(nextAction, nextContext);
            }
          }}
          onCancelConfirm={() => setConfirmState({ open: false, text: "Confirm action?" })}
          onCloseNumberPrompt={() => setNumberPrompt({ open: false })}
          onApplyNumberPrompt={async () => {
            const action = numberPrompt.action;
            const promptContext = numberPrompt.context;
            const value = numberPrompt.value;
            if (!action || !promptContext || typeof value !== "number" || Number.isNaN(value)) {
              void message.warning("Numeric value is required");
              return;
            }
            if (typeof action.min === "number" && value < action.min) {
              void message.warning(`Value must be >= ${action.min}`);
              return;
            }
            if (typeof action.max === "number" && value > action.max) {
              void message.warning(`Value must be <= ${action.max}`);
              return;
            }
            await executeAction(
              {
                type: "writeConst",
                target: action.target,
                name: action.name,
                value,
              },
              promptContext,
            );
            setNumberPrompt({ open: false });
          }}
          onChangeNumberValue={(value) => setNumberPrompt((prev) => ({ ...prev, value: value === null ? undefined : Number(value) }))}
        />
      </Space>
      {runtimeAuthWindows}
    </div>
  );
}

function unwrapRuntimeTagValue(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in value) {
    return (value as { value?: unknown }).value;
  }
  return value;
}

function getRuntimeActionCommandKey(action: RuntimeAction, context: RenderContext): string {
  if (action.type === "runMacro") {
    const popupInstanceId = typeof context.popupInstanceId === "string" ? context.popupInstanceId.trim() : "";
    const tagPrefix = typeof context.tagPrefix === "string" ? context.tagPrefix.trim() : "";
    const objectScope = typeof context.parameters?.__runtimeObjectScope === "string"
      ? context.parameters.__runtimeObjectScope.trim()
      : "";
    const objectId = typeof context.parameters?.__runtimeObjectId === "string"
      ? context.parameters.__runtimeObjectId.trim()
      : typeof context.parameters?.objectId === "string"
        ? context.parameters.objectId.trim()
        : "";
    const screenId = typeof context.screenId === "string" ? context.screenId.trim() : "";
    return [
      `macro:${action.macroId}`,
      `screen:${screenId || "none"}`,
      `popup:${popupInstanceId || "none"}`,
      `prefix:${tagPrefix || "none"}`,
      `object:${objectScope || objectId || "none"}`,
    ].join(":");
  }
  if (action.type === "write" || action.type === "pulse" || action.type === "toggle") {
    return `tag:${action.tag}`;
  }
  if (action.type === "writeConst") {
    if (action.target === "variable") {
      return `variable:${action.name}`;
    }
    return `tag:${action.name}`;
  }
  if (action.type === "setLW") {
    return `lw:${Math.max(0, Math.floor(action.address))}`;
  }
  if (action.type === "setInternalVar") {
    return `variable:${action.name}`;
  }
  if (action.type === "openScreen") {
    return `navigation:openScreen:${action.screenId}`;
  }
  if (action.type === "openPopup") {
    const popupKey = getPopupKey(action) ?? action.popupScreenId;
    return `navigation:openPopup:${popupKey}`;
  }
  if (action.type === "closePopup") {
    return `navigation:closePopup:${action.popupInstanceId ?? "active"}`;
  }
  const objectId = typeof context.parameters?.__runtimeObjectId === "string"
    ? context.parameters.__runtimeObjectId.trim()
    : typeof context.parameters?.objectId === "string"
      ? context.parameters.objectId.trim()
      : "";
  return objectId ? `object:${objectId}` : `action:${action.type}`;
}

function toManualCommandRejectReason(reason: string | undefined, status: number | undefined): ManualCommandRejectReason {
  if (reason === "already_pending" || reason === "busy" || reason === "expired" || reason === "timeout" || reason === "driver_offline") {
    return reason;
  }
  if (status === 408) {
    return "timeout";
  }
  if (status === 409) {
    return "busy";
  }
  if (status === 410) {
    return "expired";
  }
  return "error";
}

function isGuestRuntimeControlAction(action: RuntimeAction): boolean {
  return action.type === "runMacro"
    || action.type === "write"
    || action.type === "pulse"
    || action.type === "toggle"
    || action.type === "writeConst"
    || action.type === "writeNumberPrompt"
    || action.type === "setLW"
    || action.type === "setInternalVar";
}

function getPopupKey(action: Extract<RuntimeAction, { type: "openPopup" }>): string | undefined {
  const valveId = typeof action.args?.valveId === "string" ? action.args.valveId.trim() : "";
  if (valveId) {
    return `${action.popupScreenId}::${valveId}`;
  }
  const prefix = typeof action.tagPrefix === "string" ? action.tagPrefix.trim() : "";
  if (prefix) {
    return `${action.popupScreenId}::prefix::${prefix}`;
  }
  return undefined;
}

function RuntimeDialogs({
  confirmState,
  numberPrompt,
  onConfirm,
  onCancelConfirm,
  onCloseNumberPrompt,
  onApplyNumberPrompt,
  onChangeNumberValue,
}: {
  confirmState: { open: boolean; text: string };
  numberPrompt: { open: boolean; action?: Extract<RuntimeAction, { type: "writeNumberPrompt" }>; context?: RenderContext; value?: number };
  onConfirm: () => Promise<void>;
  onCancelConfirm: () => void;
  onCloseNumberPrompt: () => void;
  onApplyNumberPrompt: () => Promise<void>;
  onChangeNumberValue: (value: number | null) => void;
}) {
  return (
    <>
      <Modal title="Confirm" open={confirmState.open} onOk={() => void onConfirm()} onCancel={onCancelConfirm}>
        <Typography.Text>{confirmState.text}</Typography.Text>
      </Modal>
      <Modal
        title={numberPrompt.action ? `Write value: ${numberPrompt.action.name}` : "Write value"}
        open={numberPrompt.open}
        onCancel={onCloseNumberPrompt}
        onOk={() => void onApplyNumberPrompt()}
      >
        <Form layout="vertical">
          <Form.Item label="Value">
            <InputNumber style={{ width: "100%" }} value={numberPrompt.value} onChange={onChangeNumberValue} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
