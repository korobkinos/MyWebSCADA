import { useRef, type ReactNode } from "react";
import { Button, Typography } from "antd";

export type FloatingRect = { x: number; y: number; width: number; height: number };

type Props = {
  title: string;
  rect: FloatingRect;
  onRectChange: (rect: FloatingRect) => void;
  onClose: () => void;
  onDockLeft?: () => void;
  onDockRight?: () => void;
  children: ReactNode;
};

export function FloatingPanel({
  title,
  rect,
  onRectChange,
  onClose,
  onDockLeft,
  onDockRight,
  children,
}: Props) {
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ w: number; h: number; x: number; y: number } | null>(null);

  const startDrag = (event: MouseEvent | React.MouseEvent): void => {
    dragRef.current = { dx: event.clientX - rect.x, dy: event.clientY - rect.y };
    const onMove = (moveEvent: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      onRectChange({
        ...rect,
        x: Math.max(0, moveEvent.clientX - drag.dx),
        y: Math.max(0, moveEvent.clientY - drag.dy),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startResize = (event: MouseEvent | React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = { w: rect.width, h: rect.height, x: event.clientX, y: event.clientY };
    const onMove = (moveEvent: MouseEvent) => {
      const resize = resizeRef.current;
      if (!resize) {
        return;
      }
      onRectChange({
        ...rect,
        width: Math.max(280, resize.w + (moveEvent.clientX - resize.x)),
        height: Math.max(220, resize.h + (moveEvent.clientY - resize.y)),
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className="floating-window"
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        background: "#fff",
        border: "1px solid #d9d9d9",
        borderRadius: 8,
        boxShadow: "0 14px 30px rgba(0,0,0,0.18)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: 34,
          borderBottom: "1px solid #f0f0f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 10px",
          cursor: "move",
          userSelect: "none",
          background: "#fafafa",
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
        }}
        onMouseDown={startDrag}
      >
        <Typography.Text strong>{title}</Typography.Text>
        <div style={{ display: "flex", gap: 6 }}>
          {onDockLeft ? <Button size="small" onClick={onDockLeft}>Dock Left</Button> : null}
          {onDockRight ? <Button size="small" onClick={onDockRight}>Dock Right</Button> : null}
          <Button size="small" onClick={onClose}>Close</Button>
        </div>
      </div>
      <div style={{ padding: 10, overflow: "auto", flex: 1 }}>{children}</div>
      <div
        style={{
          width: 12,
          height: 12,
          position: "absolute",
          right: 2,
          bottom: 2,
          cursor: "nwse-resize",
          background: "linear-gradient(135deg, transparent 50%, #999 50%)",
        }}
        onMouseDown={startResize}
      />
    </div>
  );
}

