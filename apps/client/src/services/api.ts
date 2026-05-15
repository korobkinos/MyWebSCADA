import type {
  AdminChangePasswordRequest,
  Asset,
  AuthLoginResponse,
  AuthMeResponse,
  ChangeOwnPasswordRequest,
  CreateUserRequest,
  DriverStatus,
  ElementLibrary,
  LibraryImportOptions,
  LibraryImportValidationResult,
  LibraryElement,
  MacroDefinition,
  MacroRunResult,
  ManualCommandMeta,
  PasswordPolicy,
  RuntimeState,
  ScadaProject,
  TagSnapshot,
  TagValue,
  AppUser,
  UpdateUserRequest,
} from "@web-scada/shared";

export type OpcUaBrowseItem = {
  nodeId: string;
  browseName: string;
  displayName: string;
  nodeClass: string;
  dataType?: string;
  writable?: boolean;
  hasChildren: boolean;
};

export type OpcUaDriverConfigInput = {
  id: string;
  type: "opcua";
  enabled?: boolean;
  name?: string;
  endpointUrl: string;
  securityPolicy?: "None" | "Basic256Sha256";
  securityMode?: "None" | "Sign" | "SignAndEncrypt";
  readMode?: "polling" | "subscription";
  publishingIntervalMs?: number;
  samplingIntervalMs?: number;
  queueSize?: number;
  discardOldest?: boolean;
  subscriptionBatchSize?: number;
  connectTimeoutMs?: number;
  operationTimeoutMs?: number;
  sessionTimeoutMs?: number;
  keepAliveIntervalMs?: number;
  username?: string;
  password?: string;
  timeoutMs?: number;
  reconnectMs?: number;
};

export type SimulatedDriverSettingsInput = {
  id: string;
  type: "simulated";
  enabled?: boolean;
  name?: string;
  updateIntervalMs?: number;
  defaultMode?: "manual" | "random" | "ramp";
  defaultMin?: number;
  defaultMax?: number;
  defaultStep?: number;
};

export type DriverMacroImpact = {
  macroId: string;
  macroName: string;
  referencedTags: string[];
  dynamicTagAccess: boolean;
};

export type OpcUaDriverImpactResponse = {
  ok: boolean;
  driverId: string;
  tagCount: number;
  tagNamesPreview: string[];
  affectedMacros: DriverMacroImpact[];
  affectedMacroCount: number;
  dynamicMacroCount: number;
};

const ENGINEER_TOKEN_KEY = "scada_engineer_token";
const RUNTIME_COMMAND_DEBUG_LOCAL_STORAGE_KEY = "scada.runtime.debugCommands";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/+$/, "");
type RequestOptions = {
  handleAuthInvalid?: boolean;
};

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

function resolveRequestUrl(url: string): string {
  if (!API_BASE_URL) {
    return url;
  }
  if (!url.startsWith("/api")) {
    return url;
  }
  return `${API_BASE_URL}${url}`;
}

function isRuntimeCommandDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(RUNTIME_COMMAND_DEBUG_LOCAL_STORAGE_KEY) === "1";
}

function sanitizeMacroId(id: unknown): string {
  if (id === undefined || id === null) {
    throw new Error("Invalid macro id");
  }
  const macroId = String(id).trim();
  if (!macroId || macroId === "undefined" || macroId === "null") {
    throw new Error("Invalid macro id");
  }
  return macroId;
}

async function request<T>(url: string, init?: RequestInit, options?: RequestOptions): Promise<T> {
  const token = getEngineerToken();
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const hasBody = init?.body !== undefined && init?.body !== null;
  const { headers: initHeaders, ...restInit } = init ?? {};
  const defaultHeaders: Record<string, string> = token ? { "x-engineer-token": token, Authorization: `Bearer ${token}` } : {};
  // Avoid sending JSON content-type on empty-body requests (notably DELETE),
  // otherwise Fastify may reject with FST_ERR_CTP_EMPTY_JSON_BODY.
  if (hasBody && !isFormData) {
    defaultHeaders["Content-Type"] = "application/json";
  }
  const response = await fetch(resolveRequestUrl(url), {
    ...restInit,
    headers: { ...defaultHeaders, ...(initHeaders ?? {}) },
  });

  if (!response.ok) {
    if (response.status === 401) {
      setEngineerToken(null);
      if (options?.handleAuthInvalid !== false && typeof window !== "undefined") {
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
  logout: (options?: { token?: string; suppressAuthInvalidEvent?: boolean }) =>
    request<{ ok: boolean }>(
      "/api/auth/logout",
      {
        method: "POST",
        headers: options?.token
          ? {
              "x-engineer-token": options.token,
              Authorization: `Bearer ${options.token}`,
            }
          : undefined,
      },
      { handleAuthInvalid: !options?.suppressAuthInvalidEvent },
    ),
  changeOwnPassword: (payload: ChangeOwnPasswordRequest) =>
    request<{ ok: boolean }>("/api/auth/change-password", { method: "POST", body: JSON.stringify(payload) }),

  listUsers: () => request<AppUser[]>("/api/users"),
  createUser: (payload: CreateUserRequest) => request<AppUser>("/api/users", { method: "POST", body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: UpdateUserRequest) =>
    request<AppUser>(`/api/users/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteUser: (id: string) => request<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
  changeUserPassword: (id: string, payload: AdminChangePasswordRequest) =>
    request<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}/change-password`, { method: "POST", body: JSON.stringify(payload) }),
  getPasswordPolicy: () => request<PasswordPolicy>("/api/security/password-policy"),
  updatePasswordPolicy: (payload: PasswordPolicy) =>
    request<PasswordPolicy>("/api/security/password-policy", { method: "PUT", body: JSON.stringify(payload) }),

  getProject: () => request<ScadaProject>("/api/project"),
  saveProject: (project: ScadaProject) =>
    request<ScadaProject>("/api/project", {
      method: "POST",
      body: JSON.stringify(project),
    }),
  getTags: () => request<TagSnapshot[]>("/api/tags"),
  getDrivers: () => request<DriverStatus[]>("/api/drivers"),
  opcUaTest: (config: OpcUaDriverConfigInput) =>
    request<{ ok: boolean; message?: string }>("/api/drivers/opcua/test", {
      method: "POST",
      body: JSON.stringify({ config }),
    }),
  getOpcUaConfig: (driverId?: string) =>
    request<{ ok: boolean; config: OpcUaDriverConfigInput }>(
      `/api/drivers/opcua/config${driverId ? `?driverId=${encodeURIComponent(driverId)}` : ""}`,
    ),
  updateOpcUaConfig: (payload: { config: OpcUaDriverConfigInput; driverId?: string }) =>
    request<{ ok: boolean; config: OpcUaDriverConfigInput }>("/api/drivers/opcua/config", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  opcUaConnect: (payload: { driverId?: string; config?: OpcUaDriverConfigInput }) =>
    request<{ ok: boolean; status?: DriverStatus; message?: string }>("/api/drivers/opcua/connect", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  opcUaDisconnect: (driverId: string) =>
    request<{ ok: boolean; status?: DriverStatus; message?: string }>("/api/drivers/opcua/disconnect", {
      method: "POST",
      body: JSON.stringify({ driverId }),
    }),
  getOpcUaStatus: (driverId?: string, options?: { signal?: AbortSignal }) =>
    request<{ ok: boolean; status?: DriverStatus; statuses?: DriverStatus[]; message?: string }>(
      `/api/drivers/opcua/status${driverId ? `?driverId=${encodeURIComponent(driverId)}` : ""}`,
      { signal: options?.signal },
    ),
  getOpcUaDriverImpact: (driverId: string) =>
    request<OpcUaDriverImpactResponse>(`/api/drivers/opcua/${encodeURIComponent(driverId)}/impact`),
  deleteOpcUaTagsByDriver: (driverId: string) =>
    request<{ ok: boolean; driverId: string; deletedTags: number; affectedMacros: DriverMacroImpact[] }>(
      `/api/drivers/opcua/${encodeURIComponent(driverId)}/delete-tags`,
      {
        method: "POST",
      },
    ),
  deleteOpcUaDriver: (driverId: string, options?: { deleteTags?: boolean }) =>
    request<{ ok: boolean; deletedDriverId: string; deletedTags: number; affectedMacros: DriverMacroImpact[] }>(
      `/api/drivers/opcua/${encodeURIComponent(driverId)}${options?.deleteTags ? "?deleteTags=true" : ""}`,
      {
        method: "DELETE",
      },
    ),
  opcUaBrowse: (payload: { driverId?: string; config?: OpcUaDriverConfigInput; nodeId?: string; search?: string }) =>
    request<{ ok: boolean; nodeId: string; nodes: OpcUaBrowseItem[]; message?: string }>("/api/drivers/opcua/browse", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  opcUaRead: (payload: { driverId?: string; config?: OpcUaDriverConfigInput; nodeId: string }) =>
    request<{ ok: boolean; nodeId: string; value: boolean | number | string | null; quality: "Good" | "Bad" | "Uncertain"; timestamp: number; dataType?: string; message?: string }>(
      "/api/drivers/opcua/read",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  opcUaImportTags: (payload: {
    driverId: string;
    overwrite?: boolean;
    items: Array<{ nodeId: string; name: string; dataTypeNodeId?: string; writable?: boolean; scanRateMs?: number }>;
  }) =>
    request<{ ok: boolean; created: number; updated: number; total: number; message?: string }>("/api/drivers/opcua/import-tags", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  opcUaImportSubtree: (payload: {
    driverId: string;
    nodeId: string;
    rootName?: string;
    overwrite?: boolean;
    scanRateMs?: number;
    maxNodes?: number;
  }) =>
    request<{ ok: boolean; created: number; updated: number; total: number; scanned: number; message?: string }>(
      "/api/drivers/opcua/import-subtree",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  getVariables: () => request<TagValue[]>("/api/variables"),
  listMacros: () => request<MacroDefinition[]>("/api/macros"),
  getMacro: (id: string) => request<MacroDefinition>(`/api/macros/${encodeURIComponent(id)}`),
  updateMacro: (id: string, payload: {
    name: string;
    description?: string;
    enabled: boolean;
    language: "javascript-lite";
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
    options?: { allowDisabledForTest?: boolean; context?: Record<string, unknown>; signal?: AbortSignal; commandMeta?: ManualCommandMeta },
  ) => {
    const macroId = sanitizeMacroId(id);
    const url = `/api/macros/${encodeURIComponent(macroId)}/run`;
    const resolvedUrl = resolveRequestUrl(url);
    const debugEnabled = isRuntimeCommandDebugEnabled();
    const payload = {
      args: args ?? {},
      allowDisabledForTest: options?.allowDisabledForTest,
      context: options?.context,
      commandMeta: options?.commandMeta,
    };
    const body = JSON.stringify(payload);
    const bodySize = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(body).length : body.length;
    const requestStartTs = performance.now();

    if (debugEnabled) {
      // eslint-disable-next-line no-console
      console.debug("[api.runMacro]", {
        event: "request-start",
        macroId,
        requestStartTs,
        url: resolvedUrl,
        bodySize,
        signalAborted: options?.signal?.aborted === true,
      });
    }

    return request<MacroRunResult>(url, {
      method: "POST",
      signal: options?.signal,
      headers: debugEnabled ? { "x-debug-runtime-command": "1" } : undefined,
      body,
    }).then((result) => {
      if (debugEnabled) {
        const requestEndTs = performance.now();
        // eslint-disable-next-line no-console
        console.debug("[api.runMacro]", {
          event: "request-end",
          macroId,
          requestStartTs,
          requestEndTs,
          durationMs: Math.round((requestEndTs - requestStartTs) * 1000) / 1000,
          url: resolvedUrl,
          bodySize,
          signalAborted: options?.signal?.aborted === true,
        });
      }
      return result;
    }).catch((error) => {
      if (debugEnabled) {
        const requestEndTs = performance.now();
        // eslint-disable-next-line no-console
        console.debug("[api.runMacro]", {
          event: "request-end",
          macroId,
          requestStartTs,
          requestEndTs,
          durationMs: Math.round((requestEndTs - requestStartTs) * 1000) / 1000,
          url: resolvedUrl,
          bodySize,
          signalAborted:
            options?.signal?.aborted === true
            || (error instanceof DOMException && error.name === "AbortError"),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    });
  },
  writeTag: (name: string, value: boolean | number | string | null, options?: { signal?: AbortSignal; commandMeta?: ManualCommandMeta }) =>
    request<{ ok: boolean }>(`/api/tags/${encodeURIComponent(name)}/write`, {
      method: "POST",
      signal: options?.signal,
      body: JSON.stringify({ value, commandMeta: options?.commandMeta }),
    }),
  writeVariable: (
    name: string,
    value: boolean | number | string | null,
    options?: { signal?: AbortSignal; commandMeta?: ManualCommandMeta },
  ) =>
    request<{ ok: boolean }>(`/api/variables/${encodeURIComponent(name)}/write`, {
      method: "POST",
      signal: options?.signal,
      body: JSON.stringify({ value, commandMeta: options?.commandMeta }),
    }),
  startRuntime: () => request<RuntimeState>("/api/runtime/start", { method: "POST" }),
  stopRuntime: () => request<RuntimeState>("/api/runtime/stop", { method: "POST" }),
  getRuntimeStatus: () => request<RuntimeState>("/api/runtime/status"),

  listAssets: () => request<Asset[]>("/api/assets"),
  uploadAsset: (file: File, name?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (name?.trim()) {
      form.append("name", name.trim());
    }
    return request<Asset>("/api/assets/upload", { method: "POST", body: form });
  },
  deleteAsset: (assetId: string) =>
    request<{ ok: boolean; used?: boolean }>(`/api/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" }),
  updateAsset: (assetId: string, patch: { name?: string; folderPath?: string }) =>
    request<Asset>(`/api/assets/${encodeURIComponent(assetId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  listLibraries: () => request<ElementLibrary[]>("/api/libraries"),
  getLibrary: (libraryId: string) => request<ElementLibrary>(`/api/libraries/${encodeURIComponent(libraryId)}`),
  createLibrary: (payload: { id: string; name: string; description?: string; version?: string }) =>
    request<ElementLibrary>("/api/libraries", { method: "POST", body: JSON.stringify(payload) }),
  updateLibrary: (libraryId: string, patch: { name?: string; description?: string; version?: string }) =>
    request<ElementLibrary>(`/api/libraries/${encodeURIComponent(libraryId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteLibrary: (libraryId: string, options?: { force?: boolean }) =>
    request<{ ok: boolean; deleted?: boolean; detached?: boolean }>(
      `/api/libraries/${encodeURIComponent(libraryId)}${options?.force ? "?force=true" : ""}`,
      { method: "DELETE" },
    ),
  validateLibraryImport: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ ok: boolean } & LibraryImportValidationResult>("/api/libraries/import/validate", {
      method: "POST",
      body: form,
    });
  },
  importLibrary: (file: File, options?: LibraryImportOptions) => {
    const form = new FormData();
    form.append("file", file);
    form.append("options", JSON.stringify(options ?? {}));
    return request<{ ok: boolean; library: ElementLibrary }>("/api/libraries/import", {
      method: "POST",
      body: form,
    });
  },
  exportLibrary: async (libraryId: string) => {
    const token = getEngineerToken();
    const response = await fetch(resolveRequestUrl(`/api/libraries/${encodeURIComponent(libraryId)}/export`), {
      method: "GET",
      headers: token ? { "x-engineer-token": token, Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const nameMatch = /filename=\"?([^\";]+)\"?/i.exec(disposition);
    const fileName = (nameMatch?.[1] ?? `${libraryId}.webscada-library.zip`).trim();
    return { blob, fileName };
  },
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
  createLibraryMacro: (libraryId: string, macro: MacroDefinition) =>
    request<MacroDefinition>(`/api/libraries/${encodeURIComponent(libraryId)}/macros`, {
      method: "POST",
      body: JSON.stringify(macro),
    }),
  updateLibraryMacro: (libraryId: string, macroId: string, patch: Partial<MacroDefinition>) =>
    request<MacroDefinition>(`/api/libraries/${encodeURIComponent(libraryId)}/macros/${encodeURIComponent(macroId)}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  deleteLibraryMacro: (libraryId: string, macroId: string, options?: { force?: boolean }) =>
    request<{ ok: boolean }>(
      `/api/libraries/${encodeURIComponent(libraryId)}/macros/${encodeURIComponent(macroId)}${options?.force ? "?force=true" : ""}`,
      { method: "DELETE" },
    ),
  importLibraryMacroToProject: (
    libraryId: string,
    macroId: string,
    options?: { overwrite?: boolean; importAsCopy?: boolean },
  ) =>
    request<{ ok: boolean; macro: MacroDefinition }>(
      `/api/libraries/${encodeURIComponent(libraryId)}/macros/${encodeURIComponent(macroId)}/import-to-project`,
      {
        method: "POST",
        body: JSON.stringify(options ?? {}),
      },
    ),
  importAllLibraryMacrosToProject: (libraryId: string, options?: { overwrite?: boolean; importAsCopy?: boolean }) =>
    request<{ ok: boolean; imported: number; updated: number; skipped: number }>(
      `/api/libraries/${encodeURIComponent(libraryId)}/import-macros-to-project`,
      {
        method: "POST",
        body: JSON.stringify(options ?? {}),
      },
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
