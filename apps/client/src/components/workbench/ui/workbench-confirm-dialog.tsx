import { AppButton, AppDialog } from "../../../ui";

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
  return (
    <AppDialog
      isOpen={open}
      onClose={onCancel}
      title={title}
      canEscapeKeyClose={!busy}
      canOutsideClickClose={!busy}
      className="workbench-confirm-dialog"
      bodyClassName="workbench-confirm-dialog__body"
      footer={(
        <div className="workbench-confirm-dialog__actions">
          <AppButton onClick={onCancel} disabled={busy}>Cancel</AppButton>
          <AppButton variant={confirmVariant} onClick={onConfirm} disabled={busy}>
            {busy ? "Working..." : confirmLabel}
          </AppButton>
        </div>
      )}
    >
      {message}
    </AppDialog>
  );
}
