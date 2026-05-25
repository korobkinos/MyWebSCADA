import { Checkbox } from "@blueprintjs/core";
import type { ComponentProps } from "react";

export type AppCheckboxProps = ComponentProps<typeof Checkbox>;

export function AppCheckbox({ className, ...props }: AppCheckboxProps) {
  return <Checkbox className={["app-checkbox", className ?? ""].filter(Boolean).join(" ")} {...props} />;
}
