import type { ButtonHTMLAttributes, ReactNode } from "react";

type WorkbenchButtonVariant = "default" | "primary" | "danger" | "ghost";

type WorkbenchButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: WorkbenchButtonVariant;
  icon?: ReactNode;
};

export function WorkbenchButton({
  variant = "default",
  icon,
  className,
  children,
  type = "button",
  ...props
}: WorkbenchButtonProps) {
  return (
    <button
      type={type}
      className={[
        "workbench-button",
        `workbench-button--${variant}`,
        className ?? "",
      ].filter(Boolean).join(" ")}
      {...props}
    >
      {icon ? <span className="workbench-button__icon">{icon}</span> : null}
      {children ? <span className="workbench-button__label">{children}</span> : null}
    </button>
  );
}