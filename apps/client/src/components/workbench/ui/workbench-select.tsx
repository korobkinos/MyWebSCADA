import { AppSelect, type AppSelectOption } from "../../../ui";
import type { SelectHTMLAttributes } from "react";

export type WorkbenchSelectOption = AppSelectOption;

type WorkbenchSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  options: WorkbenchSelectOption[];
};

export function WorkbenchSelect({ label, options, className, id, ...props }: WorkbenchSelectProps) {
  return <AppSelect id={id} label={label} options={options} className={className} {...(props as any)} />;
}
