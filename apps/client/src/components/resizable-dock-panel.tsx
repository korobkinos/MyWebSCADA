import { useMemo, useRef } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import type { DockPanelState, DockSide } from "@web-scada/shared";

export type ResizableDockPanelProps = {
  id: string;
  side: DockSide;
  hidden: boolean;
  size: number;
  lastVisibleSize?: number;
  minSize: number;
  maxSize: number;
  autoHideThreshold: number;
  restoreSize?: number;
  workspaceRef: RefObject<HTMLElement | null>;
  className?: string;
  restoreTooltip?: string;
  restoreIcon?: ReactNode;
  onStateChange: (state: DockPanelState) => void;
  children: ReactNode;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeLastVisibleSize(size: number, minSize: number, fallback: number): number {
  if (size >= minSize) {
    return size;
  }
  return fallback;
}

function isHorizontal(side: DockSide): boolean {
  return side === "left" || side === "right";
}

function computeResize(side: DockSide, startSize: number, deltaX: number, deltaY: number): number {
  if (side === "left") {
    return startSize + deltaX;
  }
  if (side === "right") {
    return startSize - deltaX;
  }
  if (side === "top") {
    return startSize + deltaY;
  }
  return startSize - deltaY;
}

function computeFromEdge(side: DockSide, rect: DOMRect, clientX: number, clientY: number): number {
  if (side === "left") {
    return clientX - rect.left;
  }
  if (side === "right") {
    return rect.right - clientX;
  }
  if (side === "top") {
    return clientY - rect.top;
  }
  return rect.bottom - clientY;
}

export function ResizableDockPanel({
  id,
  side,
  hidden,
  size,
  lastVisibleSize,
  minSize,
  maxSize,
  autoHideThreshold,
  restoreSize,
  workspaceRef,
  className,
  restoreTooltip,
  restoreIcon,
  onStateChange,
  children,
}: ResizableDockPanelProps) {
  const dragRef = useRef<{ startX: number; startY: number; startSize: number } | null>(null);

  const panelStyle = useMemo<CSSProperties>(() => {
    if (isHorizontal(side)) {
      return {
        flex: `0 0 ${size}px`,
        width: size,
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        display: "flex",
        overflow: "hidden",
        position: "relative",
      };
    }
    return {
      flex: `0 0 ${size}px`,
      height: size,
      minWidth: 0,
      minHeight: 0,
      width: "100%",
      display: "flex",
      overflow: "hidden",
      flexDirection: "column",
      position: "relative",
    };
  }, [side, size]);

  const setNextVisibleSize = (nextSize: number): void => {
    const clamped = clamp(nextSize, 0, maxSize);
    if (clamped < autoHideThreshold) {
      onStateChange({
        id,
        side,
        hidden: true,
        size: 0,
        lastVisibleSize: normalizeLastVisibleSize(size, minSize, lastVisibleSize ?? restoreSize ?? minSize),
      });
      return;
    }
    const visibleSize = clamp(clamped, minSize, maxSize);
    onStateChange({
      id,
      side,
      hidden: false,
      size: visibleSize,
      lastVisibleSize: visibleSize,
    });
  };

  const startResize = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startSize: size,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = isHorizontal(side) ? "col-resize" : "row-resize";

    const onMove = (moveEvent: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const nextRaw = computeResize(
        side,
        drag.startSize,
        moveEvent.clientX - drag.startX,
        moveEvent.clientY - drag.startY,
      );
      setNextVisibleSize(nextRaw);
    };

    const onUp = () => {
      dragRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startRestoreDrag = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const workspaceRect = workspaceRef.current?.getBoundingClientRect();
    if (!workspaceRect) {
      return;
    }
    document.body.style.userSelect = "none";
    document.body.style.cursor = isHorizontal(side) ? "col-resize" : "row-resize";

    const onMove = (moveEvent: MouseEvent) => {
      const nextRaw = computeFromEdge(side, workspaceRect, moveEvent.clientX, moveEvent.clientY);
      setNextVisibleSize(nextRaw);
    };

    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const restoreByClick = (): void => {
    const target = clamp(lastVisibleSize ?? restoreSize ?? minSize, minSize, maxSize);
    onStateChange({
      id,
      side,
      hidden: false,
      size: target,
      lastVisibleSize: target,
    });
  };

  const handleClassName = isHorizontal(side)
    ? `dock-resize-handle ${side === "left" ? "dock-resize-handle-right" : "dock-resize-handle-left"}`
    : `dock-resize-handle dock-resize-handle-${side === "top" ? "bottom" : "top"}`;

  const restoreButtonClass = `dock-restore-button dock-restore-${side}`;
  const edgeClass = `dock-edge-restore-handle dock-edge-restore-${side}`;

  if (hidden) {
    return (
      <>
        <button
          type="button"
          className={restoreButtonClass}
          onClick={restoreByClick}
          title={restoreTooltip}
          aria-label={restoreTooltip ?? `Show ${id}`}
        >
          {restoreIcon ?? "+"}
        </button>
        <div className={edgeClass} onMouseDown={startRestoreDrag} />
      </>
    );
  }

  return (
    <div className={className ?? "dock-panel"} style={panelStyle}>
      <div className="dock-panel-content">{children}</div>
      <div
        className={handleClassName}
        onMouseDown={startResize}
        onDoubleClick={() => {
          const target = clamp(restoreSize ?? minSize, minSize, maxSize);
          onStateChange({
            id,
            side,
            hidden: false,
            size: target,
            lastVisibleSize: target,
          });
        }}
      />
    </div>
  );
}
