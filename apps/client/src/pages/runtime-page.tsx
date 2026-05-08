import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  createInitialPopupState,
  popupReducer,
  resolveRuntimeAction,
  type PopupInstance,
  type RenderContext,
  type RuntimeAction,
} from "@web-scada/shared";
import { Button, Card, Form, InputNumber, Modal, Space, Typography, message } from "antd";
import { HmiStage } from "../hmi/runtime/hmi-stage";
import { useScadaStore } from "../store/scada-store";

type RuntimePageProps = {
  fullscreen?: boolean;
};

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

  const [popupState, dispatchPopup] = useReducer(popupReducer, undefined, createInitialPopupState);
  const dragRefs = useRef<Record<string, { dx: number; dy: number }>>({});
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

  const screen = useMemo(
    () => project?.screens.find((item) => item.id === currentScreenId) ?? project?.screens[0],
    [currentScreenId, project],
  );

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

  if (!project || !screen) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const executeAction = async (inputAction: RuntimeAction, context: RenderContext): Promise<void> => {
    const action = resolveRuntimeAction(inputAction, context);

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
      const result = await runMacro(action.macroId, action.args);
      if (result.status === "skipped") {
        void message.warning(`Macro "${selectedMacro?.name ?? action.macroId}" is disabled and was not executed`);
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
      const popupOptions = popupScreen.popupOptions ?? {};
      dispatchPopup({
        type: "open",
        payload: {
          id: `popup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          popupScreenId: action.popupScreenId,
          title: action.title ?? popupOptions.title ?? popupScreen.name,
          x: action.x ?? popupOptions.defaultX ?? 120,
          y: action.y ?? popupOptions.defaultY ?? 120,
          tagPrefix: action.tagPrefix,
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
      renderContext={{}}
      onAction={(action, context) => {
        void executeAction(action, context);
      }}
    />
  );

  const popups = popupState.items
    .map((item) => ({ item, screen: project.screens.find((s) => s.id === item.popupScreenId) }))
    .filter((entry): entry is { item: PopupInstance; screen: NonNullable<typeof entry.screen> } => Boolean(entry.screen));

  const popupOverlay = (
    <>
      {modalOpen ? <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 1000 }} /> : null}
      {popups.map(({ item, screen: popupScreen }) => (
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
            renderContext={{ tagPrefix: item.tagPrefix }}
            onAction={(action, context) => {
              void executeAction(action, context);
            }}
          />
        </div>
      ))}
    </>
  );

  if (fullscreen) {
    return (
      <div ref={runtimeRootRef} style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
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
      </div>
    );
  }

  return (
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
  );
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
