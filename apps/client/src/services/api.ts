import type {
  AdminChangePasswordRequest,
  Asset,
  AuthLoginResponse,
  AuthMeResponse,
  ChangeOwnPasswordRequest,
  CreateUserRequest,
  DriverStatus,
  ElementLibrary,
  LibraryElement,
  MacroDefinition,
  MacroRunResult,
  RuntimeState,
  ScadaProject,
  TagSnapshot,
  TagValue,
  AppUser,
  UpdateUserRequest,
} from "@web-scada/shared";

const ENGINEER_TOKEN_KEY = "scada_engineer_token";

function getEngineerToken(): string | null {
  return window.localStorage.getItem(ENGINEER_TOKEN_KEY);
}

function setEngineerToken(token: string | null): void {
  if (token) {
    window.localStorage.setItem(ENGINEER_TOKEN_KEY, token);
    return;
  }
  window.localStorage.removeItem(ENGINEER_TOKEN_KEY);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getEngineerToken();
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const hasBody = init?.body !== undefined && init?.body !== null;
  const defaultHeaders: Record<string, string> = token ? { "x-engineer-token": token, Authorization: `Bearer ${token}` } : {};
  // Avoid sending JSON content-type on empty-body requests (notably DELETE),
  // otherwise Fastify may reject with FST_ERR_CTP_EMPTY_JSON_BODY.
  if (hasBody && !isFormData) {
    defaultHeaders["Content-Type"] = "application/json";
  }
  const response = await fetch(url, {
    headers: { ...defaultHeaders, ...(init?.headers ?? {}) },
    ...init,
  });

  if (!response.ok) {
    if (response.status === 401) {
      setEngineerToken(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("scada-auth-invalid"));
      }
    }
    let message = `${response.status} ${response.statusText}`;
    let details: unknown = undefined;
    try {
      const text = await response.text();
      // Try to parse JSON error response for a cleaner message
      try {
        const parsed = JSON.parse(text) as { message?: string };
        details = parsed;
        if (parsed.message) {
          message = parsed.message;
        }
      } catch {
        message = text || message;
      }
    } catch {
      // ignore read error
    }
    const error = new Error(message) as Error & { status?: number; details?: unknown };
    error.status = response.status;
    error.details = details;
    throw error;
  }

  return (await response.json()) as T;
}

export const api = {
  getEngineerToken,
  setEngineerToken,

  login: async (username: string, password: string) => {
    const response = await request<AuthLoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (response.ok && response.token) {
      setEngineerToken(response.token);
    }
    return response;
  },

  loginEngineer: async (password: string) => {
    const response = await request<AuthLoginResponse>("/api/auth/engineer", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    if (response.ok && response.token) {
      setEngineerToken(response.token);
    }
    return response;
  },

  authMe: () => request<AuthMeResponse>("/api/auth/me"),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  changeOwnPassword: (payload: ChangeOwnPasswordRequest) =>
    request<{ ok: boolean }>("/api/auth/change-password", { method: "POST", body: JSON.stringify(payload) }),

  listUsers: () => request<AppUser[]>("/api/users"),
  createUser: (payload: CreateUserRequest) => request<AppUser>("/api/users", { method: "POST", body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: UpdateUserRequest) =>
    request<AppUser>(`/api/users/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteUser: (id: string) => request<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
  changeUserPassword: (id: string, payload: AdminChangePasswordRequest) =>
    request<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}/change-password`, { method: "POST", body: JSON.stringify(payload) }),

  getProject: () => request<ScadaProject>("/api/project"),
  saveProject: (project: ScadaProject) =>
    request<ScadaProject>("/api/project", {
      method: "POST",
      body: JSON.stringify(project),
    }),
  getTags: () => request<TagSnapshot[]>("/api/tags"),
  getDrivers: () => request<DriverStatus[]>("/api/drivers"),
  getVariables: () => request<TagValue[]>("/api/variables"),
  writeVariable: (name: string, value: boolean | number | string | null) =>
    request<{ ok: boolean }>(`/api/variables/${encodeURIComponent(name)}/write`, {
      method: "POST",
      body: JSON.stringify({ value }),
    }),
  listMacros: () => request<MacroDefinition[]>("/api/macros"),
  getMacro: (id: string) => request<MacroDefinition>(`/api/macros/${encodeURIComponent(id)}`),
  updateMacro: (id: string, payload: {
    name: string;
    description?: string;
    enabled: boolean;
    language: "ts" | "javascript-lite" | "expression" | "blockly";
    code: string;
    triggers?: unknown[];
    options?: Record<string, unknown>;
  }) =>
    request<MacroDefinition>(`/api/macros/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  runMacro: (
    id: string,
    args?: Record<string, unknown>,
    options?: { allowDisabledForTest?: boolean; context?: Record<string, unknown> },
  ) =>
    request<MacroRunResult>(`/api/macros/${encodeURIComponent(id)}/run`, {
      method: "POST",
      body: JSON.stringify({ args: args ?? {}, allowDisabledForTest: options?.allowDisabledForTest, context: options?.context }),
    }),
  writeTag: (name: string, value: boolean | number | string | null) =>
    request<{ ok: boolean }>(`/api/tags/${encodeURIComponent(name)}/write`, {
      method: "POST",
      body: JSON.stringify({ value }),
    }),
  startRuntime: () => request<RuntimeState>("/api/runtime/start", { method: "POST" }),
  stopRuntime: () => request<RuntimeState>("/api/runtime/stop", { method: "POST" }),

  listAssets: () => request<Asset[]>("/api/assets"),
  uploadAsset: (file: File, name?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (name?.trim()) {
      form.append("name", name.trim());
    }
    return request<Asset>("/api/assets/upload", { method: "POST", body: form });
  },
  deleteAsset: (assetId: string) => request<{ ok: boolean }>(`/api/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" }),

  listLibraries: () => request<ElementLibrary[]>("/api/libraries"),
  getLibrary: (libraryId: string) => request<ElementLibrary>(`/api/libraries/${encodeURIComponent(libraryId)}`),
  createLibrary: (payload: { id: string; name: string; description?: string; version?: string }) =>
    request<ElementLibrary>("/api/libraries", { method: "POST", body: JSON.stringify(payload) }),
  uploadLibraryAsset: (libraryId: string, file: File, name?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (name?.trim()) {
      form.append("name", name.trim());
    }
    return request<Asset>(`/api/libraries/${encodeURIComponent(libraryId)}/assets/upload`, { method: "POST", body: form });
  },
  createLibraryElement: (libraryId: string, element: LibraryElement) =>
    request<LibraryElement>(`/api/libraries/${encodeURIComponent(libraryId)}/elements`, {
      method: "POST",
      body: JSON.stringify(element),
    }),
  getLibraryElement: (libraryId: string, elementId: string) =>
    request<LibraryElement>(`/api/libraries/${encodeURIComponent(libraryId)}/elements/${encodeURIComponent(elementId)}`),
  getLibraryElementUsage: (libraryId: string, elementId: string) =>
    request<{ items: Array<{ screenId: string; screenName: string; objectId: string; objectName?: string; path: string }> }>(
      `/api/libraries/${encodeURIComponent(libraryId)}/elements/${encodeURIComponent(elementId)}/usage`,
    ),
  updateLibraryElement: (libraryId: string, elementId: string, patch: Partial<LibraryElement>) =>
    request<LibraryElement>(`/api/libraries/${encodeURIComponent(libraryId)}/elements/${encodeURIComponent(elementId)}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  deleteLibraryElement: (libraryId: string, elementId: string, options?: { force?: boolean }) =>
    request<{ ok: boolean; deletedId?: string; removedUsages?: number }>(
      `/api/libraries/${encodeURIComponent(libraryId)}/elements/${encodeURIComponent(elementId)}${options?.force ? "?force=true" : ""}`,
      { method: "DELETE" },
    ),
  attachLibrary: (libraryId: string) =>
    request<ScadaProject>("/api/project/libraries/attach", {
      method: "POST",
      body: JSON.stringify({ libraryId }),
    }),
  detachLibrary: (libraryId: string) =>
    request<ScadaProject>("/api/project/libraries/detach", {
      method: "POST",
      body: JSON.stringify({ libraryId }),
    }),
};
