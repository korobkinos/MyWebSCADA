import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type { WorkbenchWindowRect } from "./workbench-window.types";

type WorkbenchWindowProps = {
  id: string;
  title: string;
  rect: WorkbenchWindowRect;
  zIndex: number;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  children: ReactNode;
  onClose: () => void;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (rect: WorkbenchWindowRect) => void;
};

export function WorkbenchWindow({
  id,
  title,
  rect,
  zIndex,
  minWidth = 260,
  minHeight = 160,
  resizable = true,
  children,
  onClose,
  onFocus,
  onMove,
  onResize,
}: WorkbenchWindowProps) {
  const dragRef = useRef<{
    isDragging: boolean;
    isResizing: boolean;
    pointerId: number | null;
    pointerTarget: Element | null;
    startX: number;
    startY: number;
    startRect: WorkbenchWindowRect;
  }>({
    isDragging: false,
    isResizing: false,
    pointerId: null,
    pointerTarget: null,
    startX: 0,
    startY: 0,
    startRect: { x: 0, y: 0, width: 0, height: 0 },
  });
  const onMoveRef = useRef(onMove);
  const onResizeRef = useRef(onResize);
  const minWidthRef = useRef(minWidth);
  const minHeightRef = useRef(minHeight);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    minWidthRef.current = minWidth;
    minHeightRef.current = minHeight;
  }, [minHeight, minWidth]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.stopPropagation();
      onFocus();

      const target = event.target as HTMLElement;
      const isCloseButton = target.closest(".workbench-window__close");
      if (isCloseButton) {
        return;
      }
      const isHeader = target.closest(".workbench-window__header");
      const isResizeHandle = resizable && target.closest(".workbench-window__resize-handle");

      if (!isHeader && !isResizeHandle) {
        return;
      }
      event.preventDefault();

      dragRef.current = {
        isDragging: !!isHeader,
        isResizing: !!isResizeHandle,
        pointerId: event.pointerId,
        pointerTarget: event.currentTarget as Element,
        startX: event.clientX,
        startY: event.clientY,
        startRect: { ...rect },
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore capture failures
      }
      if (typeof document !== "undefined") {
        document.body.style.userSelect = "none";
        document.body.style.cursor = isResizeHandle ? "nwse-resize" : "move";
      }
    },
    [onFocus, rect],
  );

  useEffect(() => {
    const releaseInteractionState = () => {
      const state = dragRef.current;
      if (state.pointerTarget && state.pointerId !== null) {
        try {
          (state.pointerTarget as HTMLElement).releasePointerCapture(state.pointerId);
        } catch {
          // ignore release failures
        }
      }
      dragRef.current.isDragging = false;
      dragRef.current.isResizing = false;
      dragRef.current.pointerId = null;
      dragRef.current.pointerTarget = null;
      if (typeof document !== "undefined") {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const state = dragRef.current;
      if (!state.isDragging && !state.isResizing) {
        return;
      }
      if (state.pointerId !== null && event.pointerId !== state.pointerId) {
        return;
      }

      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;

      if (state.isDragging) {
        onMoveRef.current(state.startRect.x + dx, state.startRect.y + dy);
      }

      if (state.isResizing) {
        const newWidth = Math.max(minWidthRef.current, state.startRect.width + dx);
        const newHeight = Math.max(minHeightRef.current, state.startRect.height + dy);
        onResizeRef.current({
          x: state.startRect.x,
          y: state.startRect.y,
          width: newWidth,
          height: newHeight,
        });
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const state = dragRef.current;
      if (!state.isDragging && !state.isResizing) {
        return;
      }
      if (state.pointerId !== null && event.pointerId !== state.pointerId) {
        return;
      }
      releaseInteractionState();
    };

    const handleMouseUpFallback = () => {
      if (!dragRef.current.isDragging && !dragRef.current.isResizing) {
        return;
      }
      releaseInteractionState();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("mouseup", handleMouseUpFallback);
    window.addEventListener("blur", handleMouseUpFallback);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("mouseup", handleMouseUpFallback);
      window.removeEventListener("blur", handleMouseUpFallback);
      releaseInteractionState();
    };
  }, []);

  return (
    <div
      className="workbench-window"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        zIndex,
      }}
      onPointerDown={handlePointerDown}
      onClick={(event) => event.stopPropagation()}
      data-window-id={id}
    >
      <div className="workbench-window__header">
        <span className="workbench-window__title">{title}</span>
        <div className="workbench-window__actions">
          <button
            className="workbench-window__close"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            aria-label="Close window"
            title="Close"
          >
            x
          </button>
        </div>
      </div>
      <div className="workbench-window__content">{children}</div>
      {resizable ? <div className="workbench-window__resize-handle" /> : null}
    </div>
  );
}
