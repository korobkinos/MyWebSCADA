import { Dialog, type DialogProps } from "@blueprintjs/core";
import type { ReactNode } from "react";

export type AppDialogProps = Omit<DialogProps, "title"> & {
  title?: ReactNode;
  bodyClassName?: string;
  footer?: ReactNode;
};

export function AppDialog({
  title,
  className,
  bodyClassName,
  footer,
  children,
  ...props
}: AppDialogProps) {
  return (
    <Dialog className={["app-dialog", className ?? ""].filter(Boolean).join(" ")} title={title} {...props}>
      <div className={["app-dialog__body", bodyClassName ?? ""].filter(Boolean).join(" ")}>{children}</div>
      {footer ? <div className="app-dialog__footer">{footer}</div> : null}
    </Dialog>
  );
}
