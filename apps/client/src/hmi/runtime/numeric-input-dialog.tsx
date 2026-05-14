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
  const step = getStep(state);
  const inputBg = state.backgroundColor ?? "#1e1e1e";
  const inputTextColor = state.textColor ?? "#ffffff";
  const inputBorderColor = state.borderColor ?? "#3c3c3c";
  const inputFontFamily = state.fontFamily ?? "Consolas";
  const inputFontSize = state.fontSize ?? 14;

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
      return;
    }
    const min = state.min ?? -Infinity;
    const max = state.max ?? Infinity;
    const clamped = Math.min(max, Math.max(min, parsed));
    const rounded = step < 1
      ? Math.round(clamped * (1 / step)) / (1 / step)
      : Math.round(clamped / step) * step;
    setCommitting(true);
    try {
      await onCommit(rounded);
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
  }, [parseDraft, state, step]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "" || raw === "-" || /^-?\d*[.,]?\d*$/.test(raw)) {
      setDraft(raw.replace(/,/g, "."));
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
    <div className="hmi-numeric-dialog">
      <div className="hmi-numeric-dialog__body">
        <div className="hmi-numeric-dialog__label">
          {state.objectName ? `Object: ${state.objectName}` : "Numeric Input"}
        </div>
        {state.unit ? (
          <div className="hmi-numeric-dialog__label" style={{ fontSize: 11, opacity: 0.7 }}>
            Unit: {state.unit}
          </div>
        ) : null}
        <div className="hmi-numeric-dialog__input-row">
          <input
            ref={inputRef}
            className="hmi-numeric-dialog__input"
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            style={{
              background: inputBg,
              color: inputTextColor,
              borderColor: inputBorderColor,
              fontFamily: inputFontFamily,
              fontSize: inputFontSize,
            }}
          />
          <button
            type="button"
            className="hmi-numeric-dialog__step"
            tabIndex={-1}
            onClick={() => adjust(step)}
            title={`+${step}`}
          >
            +
          </button>
          <button
            type="button"
            className="hmi-numeric-dialog__step"
            tabIndex={-1}
            onClick={() => adjust(-step)}
            title={`-${step}`}
          >
            −
          </button>
        </div>
      </div>
      <div className="hmi-numeric-dialog__actions">
        <button
          type="button"
          className="hmi-numeric-dialog__button hmi-numeric-dialog__button--cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="hmi-numeric-dialog__button hmi-numeric-dialog__button--ok"
          onClick={() => void doCommit()}
          disabled={committing}
        >
          OK
        </button>
      </div>
    </div>
  );
}
