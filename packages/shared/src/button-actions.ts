import type { ButtonActionStep, ButtonObject } from "./hmi-object-types";

export const DEFAULT_BUTTON_ACTION_TIMEOUT_MS = 5000;
export const MIN_BUTTON_ACTION_TIMEOUT_MS = 100;

export function getButtonActionSteps(button: ButtonObject): ButtonActionStep[] {
  if (button.actions?.length) {
    return button.actions;
  }
  if (!button.action) {
    return [];
  }
  return [
    {
      id: "legacy-action",
      enabled: true,
      action: button.action,
      onError: "showErrorAndStop",
      timeoutMs: DEFAULT_BUTTON_ACTION_TIMEOUT_MS,
    },
  ];
}
