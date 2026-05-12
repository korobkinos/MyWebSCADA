import { forwardRef, type InputHTMLAttributes } from "react";

type WorkbenchInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export const WorkbenchInput = forwardRef<HTMLInputElement, WorkbenchInputProps>(function WorkbenchInput(
  {
    label,
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
      className={["workbench-input", className ?? ""].filter(Boolean).join(" ")}
      {...props}
    />
  );

  if (!label) {
    return input;
  }

  return (
    <label className="workbench-field">
      <span className="workbench-field__label">{label}</span>
      {input}
    </label>
  );
});
