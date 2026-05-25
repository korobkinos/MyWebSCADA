import { Button, type Intent } from "@blueprintjs/core";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type AppButtonVariant = "default" | "primary" | "danger" | "ghost";

export type AppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: AppButtonVariant;
  icon?: ReactNode;
  loading?: boolean;
};

function toIntent(variant: AppButtonVariant): Intent | undefined {
  if (variant === "primary") {
    return "primary";
  }
  if (variant === "danger") {
    return "danger";
  }
  return undefined;
}

export function AppButton({
  variant = "default",
  icon,
  className,
  children,
  type = "button",
  onClick,
  ...props
}: AppButtonProps) {
  return (
    <Button
      type={type}
      intent={toIntent(variant)}
      minimal={variant === "ghost"}
      icon={icon ? <span className="workbench-button__icon">{icon}</span> : undefined}
      onClick={onClick as any}
      className={[
        "app-button",
        "workbench-button",
        `workbench-button--${variant}`,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...(props as any)}
    >
      {children ? <span className="workbench-button__label">{children}</span> : null}
    </Button>
  );
}
