import { useCallback, useEffect, useRef, useState } from "react";

export type NumericInputDialogState = {
  objectId: string;
  objectName: string;
  targetTag: string;
  currentValue: number;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  formatMode?: "decimals" | "pattern";
  formatPattern?: string;
  unit?: string;
  requiredActionRole?: number;
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  fontFamily?: string;
  fontSize?: number;
  dialogBackgroundColor?: string;
  dialogTextColor?: string;
  dialogBorderColor?: string;
  dialogCloseButtonTextColor?: string;
  dialogCloseButtonBackgroundColor?: string;
  dialogSetButtonTextColor?: string;
  dialogSetButtonBackgroundColor?: string;
  dialogSetButtonBorderColor?: string;
  showMeta?: boolean;
  stepButtonUseTextColor?: boolean;
  stepButtonTextColor?: string;
  stepButtonBackgroundColor?: string;
  badTextColor?: string;
  badBackgroundColor?: string;
  badBorderColor?: string;
  signalBad?: boolean;
};

type NumericInputDialogProps = {
  state: NumericInputDialogState;
  onCommit: (value: number) => void | Promise<void>;
  onCancel: () => void;
};

function getStep(state: NumericInputDialogState): number {
  if (typeof state.step === "number" && state.step > 0) return state.step;
  if (typeof state.decimals === "number" && state.decimals > 0) {
    return 1 / Math.pow(10, state.decimals);
  }
  if (state.formatMode === "pattern" && state.formatPattern) {
    const dotIndex = state.formatPattern.indexOf(".");
    if (dotIndex >= 0) {
      const decimalCount = state.formatPattern.slice(dotIndex + 1).length;
      if (decimalCount > 0) return 1 / Math.pow(10, decimalCount);
    }
  }
  return 1;
}

function formatDisplay(value: number, state: NumericInputDialogState): string {
  if (state.formatMode === "decimals" || typeof state.decimals === "number") {
    const dec = state.decimals ?? 0;
    return dec > 0 ? value.toFixed(dec) : String(Math.round(value));
  }
  return String(value);
}

export function NumericInputDialog({ state, onCommit, onCancel }: NumericInputDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(
    Number.isFinite(state.currentValue) ? formatDisplay(state.currentValue, state) : "",
  );
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = getStep(state);
  const inputBg = state.backgroundColor ?? "#1e1e1e";
  const inputTextColor = state.textColor ?? "#ffffff";
  const inputBorderColor = state.borderColor ?? "#3c3c3c";
  const inputFontFamily = state.fontFamily ?? "Consolas";
  const inputFontSize = state.fontSize ?? 14;
  const dialogBackgroundColor = state.dialogBackgroundColor ?? "#252526";
  const dialogTextColor = state.dialogTextColor ?? "#cccccc";
  const dialogBorderColor = state.dialogBorderColor ?? "#3c3c3c";
  const closeButtonTextColor = state.dialogCloseButtonTextColor ?? dialogTextColor;
  const closeButtonBackgroundColor = state.dialogCloseButtonBackgroundColor ?? "#2d2d2d";
  const setButtonTextColor = state.dialogSetButtonTextColor ?? "#ffffff";
  const setButtonBackgroundColor = state.dialogSetButtonBackgroundColor ?? "#0e639c";
  const setButtonBorderColor = state.dialogSetButtonBorderColor ?? "#007acc";
  const signalBad = state.signalBad === true;
  const badTextColor = state.badTextColor ?? "#f14c4c";
  const badBackgroundColor = state.badBackgroundColor ?? "#2b1a1a";
  const badBorderColor = state.badBorderColor ?? "#a03030";
  const inputEffectiveBackground = signalBad ? badBackgroundColor : inputBg;
  const inputEffectiveTextColor = signalBad ? badTextColor : inputTextColor;
  const inputEffectiveBorderColor = signalBad ? badBorderColor : inputBorderColor;
  const stepButtonColor = state.stepButtonUseTextColor === false
    ? (state.stepButtonTextColor ?? dialogTextColor)
    : inputEffectiveTextColor;
  const stepButtonBackground = state.stepButtonBackgroundColor ?? inputBg;

  const minVal = state.min;
  const maxVal = state.max;
  const hasMin = typeof minVal === "number" && Number.isFinite(minVal);
  const hasMax = typeof maxVal === "number" && Number.isFinite(maxVal);
  const metaParts: string[] = [];
  metaParts.push(`Step: ${step}`);
  if (hasMin) metaParts.push(`Min: ${minVal}`);
  if (hasMax) metaParts.push(`Max: ${maxVal}`);
  if (state.unit) metaParts.push(`Unit: ${state.unit}`);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const parseDraft = useCallback((): number => {
    const cleaned = draft.replace(/,/g, ".").trim();
    const val = Number(cleaned);
    if (cleaned === "" || cleaned === "-" || !Number.isFinite(val)) {
      return NaN;
    }
    return val;
  }, [draft]);

  const doCommit = useCallback(async () => {
    const parsed = parseDraft();
    if (!Number.isFinite(parsed)) {
      setError("Invalid value");
      return;
    }
    const min = state.min ?? -Infinity;
    const max = state.max ?? Infinity;
    if (parsed < min) {
      setError(`Value must be >= ${min}`);
      return;
    }
    if (parsed > max) {
      setError(`Value must be <= ${max}`);
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    const rounded = step < 1
      ? Math.round(clamped * (1 / step)) / (1 / step)
      : Math.round(clamped / step) * step;
    setError(null);
    setCommitting(true);
    try {
      await onCommit(rounded);
      setDraft(formatDisplay(rounded, state));
    } finally {
      setCommitting(false);
    }
  }, [parseDraft, state, step, onCommit]);

  const adjust = useCallback((delta: number) => {
    const current = parseDraft();
    const base = Number.isFinite(current) ? current : 0;
    const min = state.min ?? -Infinity;
    const max = state.max ?? Infinity;
    const next = Math.min(max, Math.max(min, base + delta));
    const rounded = step < 1
      ? Math.round(next * (1 / step)) / (1 / step)
      : next;
    setDraft(formatDisplay(rounded, state));
    setError(null);
  }, [parseDraft, state, step]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "" || raw === "-" || /^-?\d*[.,]?\d*$/.test(raw)) {
      setDraft(raw.replace(/,/g, "."));
      setError(null);
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void doCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      adjust(step);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      adjust(-step);
    }
  }, [doCommit, onCancel, adjust, step]);

  return (
    <div
      className="hmi-numeric-dialog"
      style={{
        background: dialogBackgroundColor,
        color: dialogTextColor,
      }}
    >
      <div className="hmi-numeric-dialog__body">
        <div className="hmi-numeric-dialog__input-row">
          <button
            type="button"
            className="hmi-numeric-dialog__step"
            tabIndex={-1}
            onClick={() => adjust(-step)}
            title={`-${step}`}
            style={{
              background: stepButtonBackground,
              borderColor: dialogBorderColor,
              color: stepButtonColor,
            }}
          >
            {"\u2212"}
          </button>
          <input
            ref={inputRef}
            className="hmi-numeric-dialog__input"
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            style={{
              background: inputEffectiveBackground,
              color: inputEffectiveTextColor,
              borderColor: inputEffectiveBorderColor,
              fontFamily: inputFontFamily,
              fontSize: inputFontSize,
              lineHeight: "1.35",
              padding: "10px 12px",
            }}
          />
          <button
            type="button"
            className="hmi-numeric-dialog__step"
            tabIndex={-1}
            onClick={() => adjust(step)}
            title={`+${step}`}
            style={{
              background: stepButtonBackground,
              borderColor: dialogBorderColor,
              color: stepButtonColor,
            }}
          >
            +
          </button>
        </div>

        {state.showMeta !== false ? (
          <div className="hmi-numeric-dialog__meta">
            {metaParts.join(" \u00B7 ")}
          </div>
        ) : null}

        {error ? (
          <div className="hmi-numeric-dialog__error">
            {error}
          </div>
        ) : null}
      </div>

      <div
        className="hmi-numeric-dialog__actions"
        style={{ borderTopColor: dialogBorderColor }}
      >
        <button
          type="button"
          className="workbench-button"
          onClick={onCancel}
          style={{
            borderColor: dialogBorderColor,
            color: closeButtonTextColor,
            background: closeButtonBackgroundColor,
          }}
        >
          Close
        </button>
        <button
          type="button"
          className="workbench-button workbench-button--primary"
          onClick={() => void doCommit()}
          disabled={committing}
          style={{
            borderColor: setButtonBorderColor,
            color: setButtonTextColor,
            background: setButtonBackgroundColor,
          }}
        >
          Set
        </button>
      </div>
    </div>
  );
}
