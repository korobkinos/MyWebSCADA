import { forwardRef, type InputHTMLAttributes } from "react";
import { AppInput } from "../../../ui";

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
  return <AppInput ref={ref} id={id} label={label} errorText={errorText} className={className} {...(props as any)} />;
});
