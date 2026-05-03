export type ParameterMap = Record<string, unknown>;

const TOKEN_REGEX = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function resolveTemplateString(input: string, params: ParameterMap): string {
  return input.replace(TOKEN_REGEX, (_, token: string) => {
    const value = params[token];
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
}

export function resolveParameters(value: unknown, params: ParameterMap): unknown {
  if (typeof value === "string") {
    return resolveTemplateString(value, params);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveParameters(item, params));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, resolveParameters(item, params)]);
    return Object.fromEntries(entries);
  }

  return value;
}

