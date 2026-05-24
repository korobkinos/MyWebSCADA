import { WorkbenchButton } from "./workbench-button";

type WorkbenchFilePickerRowProps = {
  label: string;
  file: File | null;
  chooseLabel: string;
  validateLabel?: string;
  onChoose: () => void;
  onValidate?: () => void;
  validateDisabled?: boolean;
  busy?: boolean;
};

export function WorkbenchFilePickerRow({
  label,
  file,
  chooseLabel,
  validateLabel,
  onChoose,
  onValidate,
  validateDisabled,
  busy,
}: WorkbenchFilePickerRowProps) {
  return (
    <div className="workbench-file-picker-row">
      <div className="workbench-file-picker-row__label">{label}</div>
      <div className="workbench-file-picker-row__file" title={file?.name ?? "No archive selected"}>
        {file?.name ?? "No archive selected"}
      </div>
      <div className="workbench-file-picker-row__actions">
        <WorkbenchButton onClick={onChoose} disabled={busy}>{chooseLabel}</WorkbenchButton>
        {onValidate && validateLabel ? (
          <WorkbenchButton onClick={onValidate} disabled={validateDisabled || busy}>
            {busy ? "Working..." : validateLabel}
          </WorkbenchButton>
        ) : null}
      </div>
    </div>
  );
}
