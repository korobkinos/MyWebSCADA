import { TextArea } from "@blueprintjs/core";
import { forwardRef, type ComponentProps } from "react";
import { AppField } from "./AppField";

export type AppTextareaProps = ComponentProps<typeof TextArea> & {
  label?: string;
  errorText?: string;
};

export const AppTextarea = forwardRef<HTMLTextAreaElement, AppTextareaProps>(function AppTextarea(
  { label, errorText, className, id, ...props },
  ref,
) {
  const textarea = (
    <TextArea
      id={id}
      inputRef={ref}
      fill
      className={[
        "app-textarea",
        "workbench-input",
        errorText ? "workbench-input--error" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );

  if (!label) {
    return textarea;
  }

  return (
    <AppField label={label} errorText={errorText} htmlFor={id}>
      {textarea}
    </AppField>
  );
});
