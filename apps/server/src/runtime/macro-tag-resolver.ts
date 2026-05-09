import ts from "typescript";
import type { MacroDefinition } from "@web-scada/shared";

const TAG_API_NAMES = new Set(["readTag", "writeTag", "pulseTag", "toggleTag", "getTagQuality", "tagExists"]);

function isStaticString(node: ts.Node | undefined): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  if (!node) {
    return false;
  }
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function resolveCallName(node: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text;
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text;
  }
  return undefined;
}

function addTagIfValid(out: Set<string>, raw: string): void {
  const tag = raw.trim();
  if (!tag) {
    return;
  }
  // Relative tags depend on runtime context and cannot be globally tracked here.
  if (tag.startsWith(".")) {
    return;
  }
  out.add(tag);
}

function extractTagsFromCode(code: string): Set<string> {
  const result = new Set<string>();
  const source = ts.createSourceFile("macro.ts", code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callName = resolveCallName(node);
      if (callName && TAG_API_NAMES.has(callName)) {
        const arg0 = node.arguments[0];
        if (isStaticString(arg0)) {
          addTagIfValid(result, arg0.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return result;
}

export function collectAlwaysActiveMacroTags(macros: MacroDefinition[] | undefined): Set<string> {
  const result = new Set<string>();
  if (!macros || macros.length === 0) {
    return result;
  }

  for (const macro of macros) {
    for (const trigger of macro.triggers ?? []) {
      if (trigger.type === "onTagChange") {
        addTagIfValid(result, trigger.tag);
      }
    }

    const fromCode = extractTagsFromCode(macro.code);
    for (const tag of fromCode) {
      result.add(tag);
    }
  }

  return result;
}
