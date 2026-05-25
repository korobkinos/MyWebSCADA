import type { HTMLAttributes, ReactNode } from "react";

export type AppFieldProps = HTMLAttributes<HTMLLabelElement> & {
  label?: ReactNode;
  errorText?: string;
  htmlFor?: string;
};

export function AppField({
  label,
  errorText,
  className,
  children,
  htmlFor,
  ...props
}: AppFieldProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={[
        "app-field",
        "workbench-field",
        errorText ? "workbench-field--error" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {label ? <span className="workbench-field__label">{label}</span> : null}
      {children}
      {errorText ? <span className="workbench-field__error">{errorText}</span> : null}
    </label>
  );
}
