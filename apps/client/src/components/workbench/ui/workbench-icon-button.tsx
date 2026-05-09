import type { ButtonHTMLAttributes, ReactNode } from "react";

type WorkbenchIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  active?: boolean;
  title: string;
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
    <button
      type={type}
      title={title}
      aria-label={title}
      className={[
        "workbench-icon-button",
        active ? "workbench-icon-button--active" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
      {...props}
    >
      {icon}
    </button>
  );
}