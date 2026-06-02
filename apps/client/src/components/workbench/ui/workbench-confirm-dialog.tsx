import { useEffect } from "react";
import { createPortal } from "react-dom";
import { WorkbenchButton } from "./workbench-button";

type WorkbenchConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function WorkbenchConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  confirmVariant = "primary",
  busy,
  onCancel,
  onConfirm,
}: WorkbenchConfirmDialogProps) {
  useEffect(() => {
    if (!open || busy) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="workbench-confirm-backdrop"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="workbench-confirm-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="workbench-confirm-dialog__header">{title}</div>
        <div className="workbench-confirm-dialog__body">{message}</div>
        <div className="workbench-confirm-dialog__actions">
          <WorkbenchButton onClick={onCancel} disabled={busy}>Cancel</WorkbenchButton>
          <WorkbenchButton variant={confirmVariant} onClick={onConfirm} disabled={busy}>
            {busy ? "Working..." : confirmLabel}
          </WorkbenchButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
