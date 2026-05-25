import { Button } from "@blueprintjs/core";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type AppIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  active?: boolean;
  title: string;
  loading?: boolean;
};

export function AppIconButton({
  icon,
  active = false,
  className,
  title,
  type = "button",
  onClick,
  ...props
}: AppIconButtonProps) {
  return (
    <Button
      type={type}
      title={title}
      aria-label={title}
      minimal
      icon={icon as any}
      onClick={onClick as any}
      className={[
        "app-icon-button",
        "workbench-icon-button",
        active ? "workbench-icon-button--active" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...(props as any)}
    />
  );
}
