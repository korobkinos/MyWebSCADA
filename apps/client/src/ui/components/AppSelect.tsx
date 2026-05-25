import { Select } from "antd";
import type { ChangeEvent, SelectHTMLAttributes } from "react";
import { AppField } from "./AppField";

export type AppSelectOption = {
  value: string;
  label: string;
};

export type AppSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  label?: string;
  options: AppSelectOption[];
  placeholder?: string;
};

export function AppSelect({ label, options, className, id, value, defaultValue, onChange, name, disabled, placeholder }: AppSelectProps) {
  const normalizeValue = (next: unknown): string | undefined => {
    if (typeof next === "number") {
      return String(next);
    }
    if (typeof next === "string") {
      return next;
    }
    if (Array.isArray(next)) {
      const first = next[0];
      if (typeof first === "string") {
        return first;
      }
      if (typeof first === "number") {
        return String(first);
      }
    }
    return undefined;
  };

  const emitChange = (nextValue: string): void => {
    if (!onChange) {
      return;
    }
    const syntheticEvent = {
      target: {
        value: nextValue,
        name: name ?? "",
        id: id ?? "",
      },
    } as ChangeEvent<HTMLSelectElement>;
    onChange(syntheticEvent);
  };

  const select = (
    <Select
      id={id}
      className={["app-select", "workbench-select", className ?? ""].filter(Boolean).join(" ")}
      value={normalizeValue(value)}
      defaultValue={normalizeValue(defaultValue)}
      disabled={disabled}
      placeholder={placeholder}
      options={options}
      onChange={emitChange}
      getPopupContainer={(node) => node.parentElement ?? document.body}
    />
  );

  if (!label) {
    return select;
  }

  return (
    <AppField label={label} htmlFor={id}>
      {select}
    </AppField>
  );
}
