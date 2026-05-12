import { forwardRef, type InputHTMLAttributes } from "react";

type WorkbenchInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  errorText?: string;
};

export const WorkbenchInput = forwardRef<HTMLInputElement, WorkbenchInputProps>(function WorkbenchInput(
  {
    label,
    errorText,
    className,
    id,
    ...props
  },
  ref,
) {
  const input = (
    <input
      ref={ref}
      id={id}
      className={["workbench-input", errorText ? "workbench-input--error" : "", className ?? ""].filter(Boolean).join(" ")}
      {...props}
    />
  );

  if (!label) {
    return input;
  }

  return (
    <label className={["workbench-field", errorText ? "workbench-field--error" : ""].filter(Boolean).join(" ")}>
      <span className="workbench-field__label">{label}</span>
      {input}
      {errorText ? <span className="workbench-field__error">{errorText}</span> : null}
    </label>
  );
});
