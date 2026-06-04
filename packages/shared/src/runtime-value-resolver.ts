// КУСОК 04 — реализовать безопасные expression-источники для RuntimeValueSource
// Файл: packages/shared/src/runtime-value-resolver.ts
// Заменить файл целиком.

import type { RuntimeValueSource } from "./asset-library-types";
import type { TagDefinition } from "./tag-types";

export type RuntimeDependency =
  | { type: "tag"; tag: string }
  | { type: "lw"; address: number }
  | { type: "internal"; name: string };

export type RuntimeValueResolverWarning = {
  code: "expression-not-implemented" | "expression-error";
  message: string;
  source: RuntimeValueSource;
};

export type RuntimeResolveContext = {
  tagStore?: {
    readTag: (tag: string) => unknown;
  };
  lwStore?: {
    getLW: (address: number) => unknown;
  };
  internalVariableStore?: {
    get: (name: string) => unknown;
  };
  tagValues?: Record<string, unknown>;
  tags?: TagDefinition[];
  warn?: (warning: RuntimeValueResolverWarning) => void;
};

type ExpressionToken =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "%" }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma" };

type ExpressionParser = {
  tokens: ExpressionToken[];
  index: number;
  context: RuntimeResolveContext;
};

function toLwTagName(address: number): string {
  return `LW${Math.max(0, Math.floor(address))}`;
}

function toInternalTagName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^LW\d+$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return trimmed.startsWith("LW.") ? trimmed : `LW.${trimmed}`;
}

function unwrapValue(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return input;
  }
  if ("value" in input) {
    return (input as { value?: unknown }).value;
  }
  return input;
}

function readFromTagValues(tag: string, context: RuntimeResolveContext): unknown {
  const fromTagStore = context.tagStore?.readTag(tag);
  if (fromTagStore !== undefined) {
    return unwrapValue(fromTagStore);
  }
  if (context.tagValues && tag in context.tagValues) {
    return unwrapValue(context.tagValues[tag]);
  }
  return undefined;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized === "false" || normalized === "0" || normalized === "null" || normalized === "undefined" || normalized === "nan") {
      return false;
    }
    return true;
  }
  return Boolean(value);
}

function tokenizeExpression(expression: string): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index]!;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }

    if (char === ",") {
      tokens.push({ type: "comma" });
      index += 1;
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/" || char === "%") {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }

    if (char === "\"" || char === "'") {
      const quote = char;
      index += 1;
      let value = "";
      while (index < expression.length) {
        const next = expression[index]!;
        if (next === "\\") {
          const escaped = expression[index + 1];
          if (escaped !== undefined) {
            value += escaped;
            index += 2;
            continue;
          }
        }
        if (next === quote) {
          index += 1;
          break;
        }
        value += next;
        index += 1;
      }
      tokens.push({ type: "string", value });
      continue;
    }

    if (/\d|\./.test(char)) {
      let raw = "";
      while (index < expression.length && /\d|\./.test(expression[index]!)) {
        raw += expression[index]!;
        index += 1;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid number: ${raw}`);
      }
      tokens.push({ type: "number", value });
      continue;
    }

    if (/[a-zA-Z_]/.test(char)) {
      let value = "";
      while (index < expression.length && /[a-zA-Z0-9_.-]/.test(expression[index]!)) {
        value += expression[index]!;
        index += 1;
      }
      tokens.push({ type: "identifier", value });
      continue;
    }

    throw new Error(`Unexpected expression character: ${char}`);
  }

  return tokens;
}

function peek(parser: ExpressionParser): ExpressionToken | undefined {
  return parser.tokens[parser.index];
}

function consume(parser: ExpressionParser): ExpressionToken | undefined {
  const token = parser.tokens[parser.index];
  parser.index += 1;
  return token;
}

function expectParen(parser: ExpressionParser, value: "(" | ")"): void {
  const token = consume(parser);
  if (!token || token.type !== "paren" || token.value !== value) {
    throw new Error(`Expected '${value}'`);
  }
}

function parseExpressionValue(parser: ExpressionParser): unknown {
  return parseAddSub(parser);
}

function parseAddSub(parser: ExpressionParser): unknown {
  let left = parseMulDiv(parser);

  while (true) {
    const token = peek(parser);
    if (!token || token.type !== "operator" || (token.value !== "+" && token.value !== "-")) {
      return left;
    }
    consume(parser);
    const right = parseMulDiv(parser);

    if (token.value === "+" && (typeof left === "string" || typeof right === "string")) {
      left = `${left ?? ""}${right ?? ""}`;
    } else if (token.value === "+") {
      left = toNumber(left) + toNumber(right);
    } else {
      left = toNumber(left) - toNumber(right);
    }
  }
}

function parseMulDiv(parser: ExpressionParser): unknown {
  let left = parseUnary(parser);

  while (true) {
    const token = peek(parser);
    if (!token || token.type !== "operator" || (token.value !== "*" && token.value !== "/" && token.value !== "%")) {
      return left;
    }
    consume(parser);
    const right = parseUnary(parser);

    if (token.value === "*") {
      left = toNumber(left) * toNumber(right);
    } else if (token.value === "/") {
      left = toNumber(left) / toNumber(right);
    } else {
      left = toNumber(left) % toNumber(right);
    }
  }
}

function parseUnary(parser: ExpressionParser): unknown {
  const token = peek(parser);
  if (token?.type === "operator" && token.value === "-") {
    consume(parser);
    return -toNumber(parseUnary(parser));
  }
  if (token?.type === "operator" && token.value === "+") {
    consume(parser);
    return toNumber(parseUnary(parser));
  }
  return parsePrimary(parser);
}

function parsePrimary(parser: ExpressionParser): unknown {
  const token = consume(parser);
  if (!token) {
    throw new Error("Unexpected end of expression");
  }

  if (token.type === "number" || token.type === "string") {
    return token.value;
  }

  if (token.type === "paren" && token.value === "(") {
    const value = parseExpressionValue(parser);
    expectParen(parser, ")");
    return value;
  }

  if (token.type === "identifier") {
    return parseIdentifierValue(parser, token.value);
  }

  throw new Error("Unexpected expression token");
}

function parseIdentifierValue(parser: ExpressionParser, identifier: string): unknown {
  const next = peek(parser);
  if (!next || next.type !== "paren" || next.value !== "(") {
    if (identifier === "true") {
      return true;
    }
    if (identifier === "false") {
      return false;
    }
    if (identifier === "null") {
      return null;
    }
    throw new Error(`Unknown identifier: ${identifier}`);
  }

  consume(parser);
  const args: unknown[] = [];
  if (peek(parser)?.type === "paren" && (peek(parser) as { value: string }).value === ")") {
    consume(parser);
  } else {
    while (true) {
      args.push(parseExpressionValue(parser));
      const separator = peek(parser);
      if (separator?.type === "comma") {
        consume(parser);
        continue;
      }
      expectParen(parser, ")");
      break;
    }
  }

  if (identifier === "tag") {
    return readFromTagValues(String(args[0] ?? ""), parser.context);
  }

  if (identifier === "lw") {
    const address = Math.max(0, Math.floor(toNumber(args[0])));
    const fromLw = parser.context.lwStore?.getLW(address);
    if (fromLw !== undefined) {
      return unwrapValue(fromLw);
    }
    return readFromTagValues(toLwTagName(address), parser.context);
  }

  if (identifier === "internal") {
    const name = String(args[0] ?? "");
    const fromInternal = parser.context.internalVariableStore?.get(name);
    if (fromInternal !== undefined) {
      return unwrapValue(fromInternal);
    }
    const direct = readFromTagValues(name, parser.context);
    if (direct !== undefined) {
      return direct;
    }
    return readFromTagValues(toInternalTagName(name), parser.context);
  }

  if (identifier === "str") {
    return String(args[0] ?? "");
  }

  if (identifier === "num") {
    return toNumber(args[0]);
  }

  if (identifier === "floor") {
    return Math.floor(toNumber(args[0]));
  }

  if (identifier === "ceil") {
    return Math.ceil(toNumber(args[0]));
  }

  if (identifier === "round") {
    return Math.round(toNumber(args[0]));
  }

  if (identifier === "bool") {
    return toBoolean(args[0]);
  }

  if (identifier === "not") {
    return !toBoolean(args[0]);
  }

  if (identifier === "eq") {
    return String(args[0]) === String(args[1]);
  }

  if (identifier === "neq") {
    return String(args[0]) !== String(args[1]);
  }

  if (identifier === "gt") {
    return toNumber(args[0]) > toNumber(args[1]);
  }

  if (identifier === "lt") {
    return toNumber(args[0]) < toNumber(args[1]);
  }

  if (identifier === "gte") {
    return toNumber(args[0]) >= toNumber(args[1]);
  }

  if (identifier === "lte") {
    return toNumber(args[0]) <= toNumber(args[1]);
  }

  if (identifier === "between") {
    const value = toNumber(args[0]);
    const min = toNumber(args[1]);
    const max = toNumber(args[2]);
    return value >= min && value <= max;
  }

  if (identifier === "and") {
    return args.every((arg) => toBoolean(arg));
  }

  if (identifier === "or") {
    return args.some((arg) => toBoolean(arg));
  }

  if (identifier === "xor") {
    let truthyCount = 0;
    for (const arg of args) {
      if (toBoolean(arg)) {
        truthyCount += 1;
      }
    }
    return truthyCount % 2 === 1;
  }

  throw new Error(`Unknown function: ${identifier}`);
}

function evaluateRuntimeExpression(expression: string, context: RuntimeResolveContext): unknown {
  const parser: ExpressionParser = {
    tokens: tokenizeExpression(expression),
    index: 0,
    context,
  };
  const value = parseExpressionValue(parser);
  if (parser.index < parser.tokens.length) {
    throw new Error("Unexpected extra tokens in expression");
  }
  return value;
}

function extractStaticCallArguments(expression: string, functionName: string): string[] {
  const result: string[] = [];
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`${escapedName}\\s*\\(\\s*(['\"])(.*?)\\1\\s*\\)`, "g");
  let match: RegExpExecArray | null = matcher.exec(expression);

  while (match) {
    const value = match[2]?.trim();
    if (value) {
      result.push(value);
    }
    match = matcher.exec(expression);
  }

  return result;
}

function extractStaticNumericCallArguments(expression: string, functionName: string): number[] {
  const result: number[] = [];
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`${escapedName}\\s*\\(\\s*(-?\\d+)\\s*\\)`, "g");
  let match: RegExpExecArray | null = matcher.exec(expression);

  while (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      result.push(Math.max(0, Math.floor(value)));
    }
    match = matcher.exec(expression);
  }

  return result;
}

function getExpressionDependencies(expression: string): RuntimeDependency[] {
  const result: RuntimeDependency[] = [];
  const seen = new Set<string>();

  const add = (dependency: RuntimeDependency): void => {
    const key = `${dependency.type}:${dependency.type === "tag" ? dependency.tag : dependency.type === "lw" ? dependency.address : dependency.name}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(dependency);
  };

  for (const tag of extractStaticCallArguments(expression, "tag")) {
    add({ type: "tag", tag });
  }

  for (const address of extractStaticNumericCallArguments(expression, "lw")) {
    add({ type: "lw", address });
  }

  for (const name of extractStaticCallArguments(expression, "internal")) {
    add({ type: "internal", name });
  }

  return result;
}


export function resolveRuntimeValueSync(
  source: RuntimeValueSource,
  context: RuntimeResolveContext,
): unknown {
  if (source.type === "static") {
    return source.value;
  }

  if (source.type === "tag") {
    return readFromTagValues(source.tag, context);
  }

  if (source.type === "lw") {
    const fromLw = context.lwStore?.getLW(source.address);
    if (fromLw !== undefined) {
      return unwrapValue(fromLw);
    }
    return readFromTagValues(toLwTagName(source.address), context);
  }

  if (source.type === "internal") {
    const fromInternal = context.internalVariableStore?.get(source.name);
    if (fromInternal !== undefined) {
      return unwrapValue(fromInternal);
    }
    const normalized = toInternalTagName(source.name);
    const direct = readFromTagValues(source.name, context);
    if (direct !== undefined) {
      return direct;
    }
    return readFromTagValues(normalized, context);
  }

  try {
    return evaluateRuntimeExpression(source.expression, context);
  } catch (error) {
    context.warn?.({
      code: "expression-error",
      message: error instanceof Error ? error.message : String(error),
      source,
    });
    return undefined;
  }
}

export async function resolveRuntimeValue(
  source: RuntimeValueSource,
  context: RuntimeResolveContext,
): Promise<unknown> {
  return resolveRuntimeValueSync(source, context);
}

export function getRuntimeValueSourceDependencies(source: RuntimeValueSource | undefined): RuntimeDependency[] {
  if (!source) {
    return [];
  }

  if (source.type === "static") {
    return [];
  }

  if (source.type === "tag") {
    return [{ type: "tag", tag: source.tag }];
  }

  if (source.type === "lw") {
    return [{ type: "lw", address: source.address }];
  }

  if (source.type === "internal") {
    return [{ type: "internal", name: source.name }];
  }

  return getExpressionDependencies(source.expression);
}
