import { useMemo, useReducer, useRef } from "react";
import {
  createInitialPopupState,
  popupReducer,
  resolveRuntimeAction,
  type PopupInstance,
  type RenderContext,
  type RuntimeAction,
} from "@web-scada/shared";
import { Button, Card, Space, Typography } from "antd";
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

  const screen = useMemo(
    () => project?.screens.find((item) => item.id === currentScreenId) ?? project?.screens[0],
    [currentScreenId, project],
  );

  const modalOpen = popupState.items.some((item) => item.modal);

  if (!project || !screen) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const executeAction = async (inputAction: RuntimeAction, context: RenderContext): Promise<void> => {
    const action = resolveRuntimeAction(inputAction, context);

    if ("confirm" in action && action.confirm) {
      const accepted = window.confirm(action.confirmText ?? "Confirm action?");
      if (!accepted) {
        return;
      }
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
      const input = window.prompt(`Enter numeric value for ${action.name}`);
      if (input === null) {
        return;
      }
      const value = Number(input);
      if (Number.isNaN(value)) {
        window.alert("Only numbers are allowed");
        return;
      }
      if (typeof action.min === "number" && value < action.min) {
        window.alert(`Value must be >= ${action.min}`);
        return;
      }
      if (typeof action.max === "number" && value > action.max) {
        window.alert(`Value must be <= ${action.max}`);
        return;
      }
      if (action.target === "variable") {
        await writeVariable(action.name, value);
      } else {
        await writeTag(action.name, value);
      }
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
      const macroExists = macros.some((macro) => macro.id === action.macroId);
      if (!macroExists) {
        window.alert(`Macro ${action.macroId} not found`);
        return;
      }
      await runMacro(action.macroId);
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
      <div style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
        {stageElement}
        {popupOverlay}
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
    </Space>
  );
}
