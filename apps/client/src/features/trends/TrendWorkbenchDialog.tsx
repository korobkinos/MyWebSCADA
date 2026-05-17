import { useEffect, useState, type ReactNode } from "react";
import { WorkbenchWindow, type WorkbenchWindowRect } from "../../components/workbench/windows";

type TrendWorkbenchDialogProps = {
  id: string;
  title: string;
  open: boolean;
  defaultRect: WorkbenchWindowRect;
  minWidth?: number;
  minHeight?: number;
  zIndex?: number;
  bodyClassName?: string;
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
};

export function TrendWorkbenchDialog({
  id,
  title,
  open,
  defaultRect,
  minWidth = 520,
  minHeight = 320,
  zIndex = 2400,
  bodyClassName,
  footer,
  children,
  onClose,
}: TrendWorkbenchDialogProps) {
  const [rect, setRect] = useState<WorkbenchWindowRect>(defaultRect);

  useEffect(() => {
    if (!open) {
      return;
    }
    const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
    setRect({
      ...defaultRect,
      x: Math.max(24, Math.round((viewportWidth - defaultRect.width) / 2)),
      y: Math.max(24, Math.round((viewportHeight - defaultRect.height) / 2)),
    });
  }, [defaultRect.height, defaultRect.width, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="archive-workbench-dialog-layer" style={{ zIndex }}>
      <WorkbenchWindow
        id={id}
        title={title}
        rect={rect}
        zIndex={zIndex}
        minWidth={minWidth}
        minHeight={minHeight}
        onClose={onClose}
        onFocus={() => undefined}
        onMove={(x, y) => setRect((prev) => ({ ...prev, x, y }))}
        onResize={setRect}
      >
        <div className="archive-workbench-dialog">
          <div className={bodyClassName ? `archive-workbench-dialog__body ${bodyClassName}` : "archive-workbench-dialog__body"}>
            {children}
          </div>
          {footer ? <div className="archive-workbench-dialog__footer">{footer}</div> : null}
        </div>
      </WorkbenchWindow>
    </div>
  );
}
