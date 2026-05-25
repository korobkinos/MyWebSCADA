import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AppButton, type AppButtonVariant } from "../../../ui";

type WorkbenchButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: AppButtonVariant;
  icon?: ReactNode;
};

export function WorkbenchButton({ variant = "default", icon, className, children, type = "button", ...props }: WorkbenchButtonProps) {
  return (
    <AppButton
      type={type}
      variant={variant}
      icon={icon}
      className={className}
      {...props}
    >
      {children}
    </AppButton>
  );
}
