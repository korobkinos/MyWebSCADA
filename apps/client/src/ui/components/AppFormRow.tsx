import type { HTMLAttributes } from "react";

export type AppFormRowProps = HTMLAttributes<HTMLDivElement>;

export function AppFormRow({ className, ...props }: AppFormRowProps) {
  return <div className={["app-form-row", className ?? ""].filter(Boolean).join(" ")} {...props} />;
}
