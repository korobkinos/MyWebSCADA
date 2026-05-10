import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type { WorkbenchWindowRect } from "./workbench-window.types";

type WorkbenchWindowProps = {
  id: string;
  title: string;
  rect: WorkbenchWindowRect;
  zIndex: number;
  minWidth?: number;
  minHeight?: number;
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
  children,
  onClose,
  onFocus,
  onMove,
  onResize,
}: WorkbenchWindowProps) {
  const dragRef = useRef<{
    isDragging: boolean;
    isResizing: boolean;
    startX: number;
    startY: number;
    startRect: WorkbenchWindowRect;
  }>({
    isDragging: false,
    isResizing: false,
    startX: 0,
    startY: 0,
    startRect: { x: 0, y: 0, width: 0, height: 0 },
  });

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      onFocus();
      const target = event.target as HTMLElement;
      const isHeader = target.closest(".workbench-window__header");
      const isResizeHandle = target.closest(".workbench-window__resize-handle");

      if (!isHeader && !isResizeHandle) {
        return;
      }

      dragRef.current = {
        isDragging: !!isHeader,
        isResizing: !!isResizeHandle,
        startX: event.clientX,
        startY: event.clientY,
        startRect: { ...rect },
      };
    },
    [onFocus, rect],
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const state = dragRef.current;
      if (!state.isDragging && !state.isResizing) {
        return;
      }

      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;

      if (state.isDragging) {
        onMove(state.startRect.x + dx, state.startRect.y + dy);
      }

      if (state.isResizing) {
        const newWidth = Math.max(minWidth, state.startRect.width + dx);
        const newHeight = Math.max(minHeight, state.startRect.height + dy);
        onResize({
          x: state.startRect.x,
          y: state.startRect.y,
          width: newWidth,
          height: newHeight,
        });
      }
    };

    const handleMouseUp = () => {
      dragRef.current.isDragging = false;
      dragRef.current.isResizing = false;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [minWidth, minHeight, onMove, onResize]);

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
      onMouseDown={handleMouseDown}
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
            title="Close"
          >
            ×
          </button>
        </div>
      </div>
      <div className="workbench-window__content">{children}</div>
      <div className="workbench-window__resize-handle" />
    </div>
  );
}