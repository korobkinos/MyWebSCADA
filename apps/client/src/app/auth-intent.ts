export const AUTH_INTENT_REDIRECT_EDITOR = "/editor" as const;

export type AuthIntentReason = "open-editor" | "login-alias" | "manual-auth";
export type AuthIntentRedirect = typeof AUTH_INTENT_REDIRECT_EDITOR;

export type AuthIntent = {
  openAuthModal: true;
  redirectTo?: AuthIntentRedirect;
  reason?: AuthIntentReason;
};

const AUTH_INTENT_REASONS = new Set<AuthIntentReason>(["open-editor", "login-alias", "manual-auth"]);
const AUTH_INTENT_REDIRECTS = new Set<AuthIntentRedirect>([AUTH_INTENT_REDIRECT_EDITOR]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAuthIntent(
  reason: AuthIntentReason,
  options?: { redirectTo?: AuthIntentRedirect },
): AuthIntent {
  return {
    openAuthModal: true,
    reason,
    redirectTo: options?.redirectTo,
  };
}

export function normalizeAuthIntent(value: unknown): AuthIntent | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.openAuthModal !== true) {
    return null;
  }

  const redirectToRaw = value.redirectTo;
  if (redirectToRaw !== undefined && !AUTH_INTENT_REDIRECTS.has(redirectToRaw as AuthIntentRedirect)) {
    return null;
  }

  const reasonRaw = value.reason;
  if (reasonRaw !== undefined && !AUTH_INTENT_REASONS.has(reasonRaw as AuthIntentReason)) {
    return null;
  }

  const normalized: AuthIntent = {
    openAuthModal: true,
  };
  if (redirectToRaw !== undefined) {
    normalized.redirectTo = redirectToRaw as AuthIntentRedirect;
  }
  if (reasonRaw !== undefined) {
    normalized.reason = reasonRaw as AuthIntentReason;
  }
  return normalized;
}

export function readAuthIntentFromLocationState(state: unknown): AuthIntent | null {
  if (!isRecord(state)) {
    return null;
  }
  return normalizeAuthIntent(state.authIntent);
}

export function buildStateWithAuthIntent(intent: AuthIntent, baseState?: unknown): Record<string, unknown> {
  const nextState: Record<string, unknown> = isRecord(baseState) ? { ...baseState } : {};
  nextState.authIntent = intent;
  return nextState;
}

export function stripAuthIntentFromLocationState(state: unknown): unknown {
  if (!isRecord(state) || !Object.prototype.hasOwnProperty.call(state, "authIntent")) {
    return state;
  }
  const nextState: Record<string, unknown> = { ...state };
  delete nextState.authIntent;
  return Object.keys(nextState).length > 0 ? nextState : null;
}

export function resolvePostLoginRedirect(
  intent: AuthIntent | null,
  hasEditorViewPermission: boolean,
): { redirectTo: AuthIntentRedirect | null; errorText: string | null } {
  if (intent?.redirectTo !== AUTH_INTENT_REDIRECT_EDITOR) {
    return { redirectTo: null, errorText: null };
  }
  if (!hasEditorViewPermission) {
    return { redirectTo: null, errorText: "Insufficient permissions: editor.view" };
  }
  return { redirectTo: AUTH_INTENT_REDIRECT_EDITOR, errorText: null };
}
