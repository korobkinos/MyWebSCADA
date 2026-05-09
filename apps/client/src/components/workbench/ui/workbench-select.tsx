import type { SelectHTMLAttributes } from "react";

export type WorkbenchSelectOption = {
  value: string;
  label: string;
};

type WorkbenchSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  options: WorkbenchSelectOption[];
};

export function WorkbenchSelect({
  label,
  options,
  className,
  id,
  ...props
}: WorkbenchSelectProps) {
  const select = (
    <select
      id={id}
      className={["workbench-select", className ?? ""].filter(Boolean).join(" ")}
      {...props}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  if (!label) {
    return select;
  }

  return (
    <label className="workbench-field">
      <span className="workbench-field__label">{label}</span>
      {select}
    </label>
  );
}