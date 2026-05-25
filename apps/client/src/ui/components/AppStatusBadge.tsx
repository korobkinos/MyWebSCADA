import type { HTMLAttributes } from "react";

export type AppStatusBadgeVariant = "info" | "success" | "warning" | "error";

export type AppStatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: AppStatusBadgeVariant;
};

export function AppStatusBadge({ variant = "info", className, ...props }: AppStatusBadgeProps) {
  return (
    <span
      className={[
        "app-status-badge",
        `app-status-badge--${variant}`,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
