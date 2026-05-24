import { describe, expect, it } from "vitest";
import {
  AUTH_INTENT_REDIRECT_EDITOR,
  buildStateWithAuthIntent,
  createAuthIntent,
  readAuthIntentFromLocationState,
  resolvePostLoginRedirect,
  stripAuthIntentFromLocationState,
} from "./auth-intent";

describe("auth-intent", () => {
  it("reads valid auth intent from location state", () => {
    const state = buildStateWithAuthIntent(
      createAuthIntent("open-editor", { redirectTo: AUTH_INTENT_REDIRECT_EDITOR }),
      { source: "menu" },
    );
    const intent = readAuthIntentFromLocationState(state);
    expect(intent).toEqual({
      openAuthModal: true,
      reason: "open-editor",
      redirectTo: AUTH_INTENT_REDIRECT_EDITOR,
    });
  });

  it("returns null for invalid auth intent payload", () => {
    expect(readAuthIntentFromLocationState({ authIntent: { openAuthModal: false } })).toBeNull();
    expect(readAuthIntentFromLocationState({ authIntent: { openAuthModal: true, redirectTo: "/unknown" } })).toBeNull();
    expect(readAuthIntentFromLocationState({ authIntent: { openAuthModal: true, reason: "unexpected" } })).toBeNull();
    expect(readAuthIntentFromLocationState(null)).toBeNull();
  });

  it("strips auth intent from location state while preserving other keys", () => {
    const withExtra = stripAuthIntentFromLocationState({
      authIntent: createAuthIntent("manual-auth"),
      from: "/runtime",
    });
    const onlyIntent = stripAuthIntentFromLocationState({
      authIntent: createAuthIntent("manual-auth"),
    });
    expect(withExtra).toEqual({ from: "/runtime" });
    expect(onlyIntent).toBeNull();
  });
});

describe("resolvePostLoginRedirect", () => {
  it("redirects to editor when permission is available", () => {
    const intent = createAuthIntent("open-editor", { redirectTo: AUTH_INTENT_REDIRECT_EDITOR });
    expect(resolvePostLoginRedirect(intent, true)).toEqual({
      redirectTo: AUTH_INTENT_REDIRECT_EDITOR,
      errorText: null,
    });
  });

  it("keeps runtime and returns permission error when editor.view is missing", () => {
    const intent = createAuthIntent("open-editor", { redirectTo: AUTH_INTENT_REDIRECT_EDITOR });
    expect(resolvePostLoginRedirect(intent, false)).toEqual({
      redirectTo: null,
      errorText: "Insufficient permissions: editor.view",
    });
  });
});
