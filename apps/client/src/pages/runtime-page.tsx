import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ACCESS_ROLE_LABELS_RU,
  clampAccessRoleLevel,
  getUserRoleLevel,
  hasRoleAccess,
  roleLevelFromRoles,
  type AccessRoleLevel,
  createInitialPopupState,
  popupReducer,
  resolveRuntimeAction,
  type PopupInstance,
  type RenderContext,
  type RuntimeAction,
} from "@web-scada/shared";
import { Button, Card, Form, InputNumber, Modal, Space, Typography, message } from "antd";
import { HmiStage } from "../hmi/runtime/hmi-stage";
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

export function RuntimePage({ fullscreen = false }: RuntimePageProps) {
  const project = useScadaStore((s) => s.project);
  const tags = useScadaStore((s) => s.tags);
  const libraries = useScadaStore((s) => s.libraries);
  const currentScreenId = useScadaStore((s) => s.currentScreenId);
  const setCurrentScreen = useScadaStore((s) => s.setCurrentScreen);
  const writeTag = useScadaStore((s) => s.writeTag);
  const writeVariable = useScadaStore((s) => s.writeVariable);
  const runMacro = useScadaStore((s) => s.runMacro);
  const macros = useScadaStore((s) => s.macros);
  const startRuntime = useScadaStore((s) => s.startRuntime);
  const stopRuntime = useScadaStore((s) => s.stopRuntime);
  const authUser = useScadaStore((s) => s.authUser);
  const login = useScadaStore((s) => s.login);
  const userRoleLevel = getUserRoleLevel(authUser);

  const [popupState, dispatchPopup] = useReducer(popupReducer, undefined, createInitialPopupState);
  const dragRefs = useRef<Record<string, { dx: number; dy: number }>>({});
  const macroRunGuardsRef = useRef(new Map<string, { running: boolean; lastStartedAt: number }>());
  const macroWarningTimestampsRef = useRef(new Map<string, number>());
  const runtimeRootRef = useRef<HTMLDivElement | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    text: string;
    action?: RuntimeAction;
    context?: RenderContext;
  }>({ open: false, text: "Confirm action?" });
  const [numberPrompt, setNumberPrompt] = useState<{
    open: boolean;
    action?: Extract<RuntimeAction, { type: "writeNumberPrompt" }>;
    value?: number;
  }>({ open: false });
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
  }, [libraries, popupScreens, project, screen]);

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

  const executeAction = async (inputAction: RuntimeAction, context: RenderContext): Promise<void> => {
    const action = resolveRuntimeAction(inputAction, context);
    const actor = useScadaStore.getState().authUser;
    const actorRoleLevel = getUserRoleLevel(actor);
    const requiredRoleLevel = resolveRequiredRoleLevel(action);
    const requiresAuth = action.requireAuth === true || requiredRoleLevel > 0;

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
      await writeTag(action.tag, action.value);
      return;
    }

    if (action.type === "pulse") {
      await writeTag(action.tag, action.value);
      setTimeout(() => {
        void writeTag(action.tag, false);
      }, action.durationMs);
      return;
    }

    if (action.type === "toggle") {
      const current = tags[action.tag];
      await writeTag(action.tag, !Boolean(current?.value));
      return;
    }

    if (action.type === "writeConst") {
      if (action.target === "variable") {
        await writeVariable(action.name, action.value);
      } else {
        await writeTag(action.name, action.value);
      }
      return;
    }

    if (action.type === "writeNumberPrompt") {
      setNumberPrompt({ open: true, action, value: undefined });
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
      const selectedMacro = macros.find((macro) => macro.id === action.macroId);
      const macroExists = Boolean(selectedMacro);
      if (!macroExists) {
        void message.error(`Macro ${action.macroId} not found`);
        return;
      }
      const guardKey = getMacroActionKey(action, context);
      const now = Date.now();
      const guard = macroRunGuardsRef.current.get(guardKey) ?? { running: false, lastStartedAt: 0 };
      if (guard.running) {
        return;
      }
      if (now - guard.lastStartedAt < 200) {
        return;
      }
      guard.running = true;
      guard.lastStartedAt = now;
      macroRunGuardsRef.current.set(guardKey, guard);
      try {
        const result = await runMacro(action.macroId, action.args, {
          context: {
            popupInstanceId: context.popupInstanceId,
            screenId: context.screenId,
            tagPrefix: context.tagPrefix,
            parameters: context.parameters,
          },
        });
        if (result.status === "skipped" && result.reason === "disabled") {
          void message.warning(`Macro "${selectedMacro?.name ?? action.macroId}" is disabled and was not executed`);
        } else if (result.status === "skipped" && result.reason === "already_running") {
          const lastWarningAt = macroWarningTimestampsRef.current.get(guardKey) ?? 0;
          if (Date.now() - lastWarningAt >= 1500) {
            macroWarningTimestampsRef.current.set(guardKey, Date.now());
            void message.warning(`Macro "${selectedMacro?.name ?? action.macroId}" is already running`);
          }
        }
        for (const effect of result.effects ?? []) {
          await executeAction(effect as RuntimeAction, context);
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        void message.error(`Macro "${selectedMacro?.name ?? action.macroId}" failed: ${text}`);
      } finally {
        const currentGuard = macroRunGuardsRef.current.get(guardKey);
        if (currentGuard) {
          currentGuard.running = false;
          macroRunGuardsRef.current.set(guardKey, currentGuard);
        }
      }
      return;
    }

    if (action.type === "setLW") {
      await writeVariable(`LW${Math.max(0, Math.floor(action.address))}`, action.value);
      return;
    }

    if (action.type === "setInternalVar") {
      await writeVariable(action.name, action.value);
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
      dispatchPopup({ type: "close", payload: { id: action.popupInstanceId } });
    }
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
      renderContext={{ screenId: screen.id, userRoles: authUser?.roles ?? [], userRoleLevel, isAuthenticated: Boolean(authUser) }}
      onAction={(action, context) => {
        void executeAction(action, context);
      }}
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
              <Button size="small" onClick={() => dispatchPopup({ type: "close", payload: { id: item.id } })}>
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
              userRoles: authUser?.roles ?? [],
              userRoleLevel,
              isAuthenticated: Boolean(authUser),
            }}
            onAction={(action, context) => {
              void executeAction(action, context);
            }}
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
            const value = numberPrompt.value;
            if (!action || typeof value !== "number" || Number.isNaN(value)) {
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
            if (action.target === "variable") {
              await writeVariable(action.name, value);
            } else {
              await writeTag(action.name, value);
            }
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
            <Button onClick={() => void startRuntime()} type="primary">
              Start Runtime
            </Button>
            <Button onClick={() => void stopRuntime()}>Stop Runtime</Button>
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
            const value = numberPrompt.value;
            if (!action || typeof value !== "number" || Number.isNaN(value)) {
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
            if (action.target === "variable") {
              await writeVariable(action.name, value);
            } else {
              await writeTag(action.name, value);
            }
            setNumberPrompt({ open: false });
          }}
          onChangeNumberValue={(value) => setNumberPrompt((prev) => ({ ...prev, value: value === null ? undefined : Number(value) }))}
        />
      </Space>
      {runtimeAuthWindows}
    </div>
  );
}

function getMacroActionKey(action: Extract<RuntimeAction, { type: "runMacro" }>, context: RenderContext): string {
  const objectId =
    typeof context.parameters?.objectId === "string"
      ? context.parameters.objectId.trim()
      : "";
  return [
    context.screenId ?? "",
    context.popupInstanceId ?? "",
    context.tagPrefix ?? "",
    objectId,
    action.macroId,
  ].join("::");
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
  numberPrompt: { open: boolean; action?: Extract<RuntimeAction, { type: "writeNumberPrompt" }>; value?: number };
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
