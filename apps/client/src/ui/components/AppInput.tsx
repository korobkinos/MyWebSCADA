import { InputGroup } from "@blueprintjs/core";
import { forwardRef, type ComponentProps } from "react";
import { AppField } from "./AppField";

export type AppInputProps = Omit<ComponentProps<typeof InputGroup>, "inputRef"> & {
  label?: string;
  errorText?: string;
};

export const AppInput = forwardRef<HTMLInputElement, AppInputProps>(function AppInput(
  { label, errorText, className, id, ...props },
  ref,
) {
  const input = (
    <InputGroup
      id={id}
      inputRef={ref}
      className={["app-input-root", className ?? ""].filter(Boolean).join(" ")}
      inputClassName={[
        "app-input",
        "workbench-input",
        errorText ? "workbench-input--error" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );

  if (!label) {
    return input;
  }

  return (
    <AppField label={label} errorText={errorText} htmlFor={id}>
      {input}
    </AppField>
  );
});
