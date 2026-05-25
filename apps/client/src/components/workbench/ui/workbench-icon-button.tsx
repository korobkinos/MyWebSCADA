import type { ReactNode } from "react";
import { AppIconButton, type AppIconButtonProps } from "../../../ui";

type WorkbenchIconButtonProps = Omit<AppIconButtonProps, "icon" | "active" | "title" | "type"> & {
  icon: ReactNode;
  active?: boolean;
  title: string;
  type?: "button" | "submit" | "reset";
};

export function WorkbenchIconButton({
  icon,
  active = false,
  className,
  title,
  type = "button",
  ...props
}: WorkbenchIconButtonProps) {
  return (
    <AppIconButton
      type={type}
      title={title}
      icon={icon}
      active={active}
      className={className}
      {...props}
    />
  );
}
