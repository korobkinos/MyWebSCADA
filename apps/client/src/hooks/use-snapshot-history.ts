import { useMemo, useState } from "react";

export type SnapshotHistoryEntry<T> = {
  id: string;
  label: string;
  timestamp: number;
  before: T;
  after: T;
};

type SnapshotHistoryState<T> = {
  past: SnapshotHistoryEntry<T>[];
  future: SnapshotHistoryEntry<T>[];
};

type UseSnapshotHistoryOptions = {
  maxSteps?: number;
};

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function sameSnapshot<T>(left: T, right: T): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return left === right;
  }
}

export function useSnapshotHistory<T>(options?: UseSnapshotHistoryOptions) {
  const maxSteps = Math.max(1, options?.maxSteps ?? 50);
  const [state, setState] = useState<SnapshotHistoryState<T>>({
    past: [],
    future: [],
  });

  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;

  const api = useMemo(
    () => ({
      canUndo,
      canRedo,
      pushEntry(label: string, before: T, after: T) {
        if (sameSnapshot(before, after)) {
          return;
        }
        const entry: SnapshotHistoryEntry<T> = {
          id: `hist_${Math.random().toString(36).slice(2, 10)}`,
          label,
          timestamp: Date.now(),
          before: deepClone(before),
          after: deepClone(after),
        };
        setState((prev) => ({
          past: [...prev.past, entry].slice(-maxSteps),
          future: [],
        }));
      },
      undo(currentPresent: T): T | null {
        let nextState: T | null = null;
        setState((prev) => {
          const entry = prev.past[prev.past.length - 1];
          if (!entry) {
            return prev;
          }
          nextState = deepClone(entry.before);
          return {
            past: prev.past.slice(0, -1),
            future: [
              {
                ...entry,
                after: deepClone(currentPresent),
              },
              ...prev.future,
            ].slice(0, maxSteps),
          };
        });
        return nextState;
      },
      redo(currentPresent: T): T | null {
        let nextState: T | null = null;
        setState((prev) => {
          const entry = prev.future[0];
          if (!entry) {
            return prev;
          }
          nextState = deepClone(entry.after);
          return {
            past: [
              ...prev.past,
              {
                ...entry,
                before: deepClone(currentPresent),
              },
            ].slice(-maxSteps),
            future: prev.future.slice(1),
          };
        });
        return nextState;
      },
      clear() {
        setState({ past: [], future: [] });
      },
    }),
    [canRedo, canUndo, maxSteps],
  );

  return api;
}

