import type { InputHTMLAttributes } from "react";

type WorkbenchInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export function WorkbenchInput({
  label,
  className,
  id,
  ...props
}: WorkbenchInputProps) {
  const input = (
    <input
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
}