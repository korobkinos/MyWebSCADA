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
  if (!open) {
    return null;
  }

  return (
    <div className="workbench-confirm-backdrop">
      <div className="workbench-confirm-dialog">
        <div className="workbench-confirm-dialog__header">{title}</div>
        <div className="workbench-confirm-dialog__body">{message}</div>
        <div className="workbench-confirm-dialog__actions">
          <WorkbenchButton onClick={onCancel} disabled={busy}>Cancel</WorkbenchButton>
          <WorkbenchButton variant={confirmVariant} onClick={onConfirm} disabled={busy}>
            {busy ? "Working..." : confirmLabel}
          </WorkbenchButton>
        </div>
      </div>
    </div>
  );
}
