import { Switch } from "@blueprintjs/core";
import type { ComponentProps } from "react";

export type AppSwitchProps = ComponentProps<typeof Switch>;

export function AppSwitch({ className, ...props }: AppSwitchProps) {
  return <Switch className={["app-switch", className ?? ""].filter(Boolean).join(" ")} {...props} />;
}
