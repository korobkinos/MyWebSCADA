import Editor from "@monaco-editor/react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { macroApiDocumentation, macroTemplates, type MacroApiDocItem } from "./macro-api-doc";

export type MacroCodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  height?: number | string;
  readOnly?: boolean;
  enableMacroCompletions?: boolean;
};

export type MacroCodeEditorHandle = {
  focus: () => void;
  insertText: (text: string) => boolean;
};

type MonacoEditorLike = {
  focus: () => void;
  getSelection: () => unknown;
  executeEdits: (
    source: string,
    edits: Array<{ range: unknown; text: string; forceMoveMarkers?: boolean }>,
  ) => void;
};

type MonacoDisposable = {
  dispose: () => void;
};

type MonacoPosition = {
  lineNumber: number;
  column: number;
};

type MonacoWord = {
  startColumn: number;
  endColumn: number;
};

type MonacoTextModelLike = {
  getWordUntilPosition: (position: MonacoPosition) => MonacoWord;
};

function buildApiDocumentation(item: MacroApiDocItem): string {
  const lines: string[] = [item.description];
  if (item.params && item.params.length > 0) {
    lines.push("", "Parameters:");
    for (const param of item.params) {
      const required = param.required ? "required" : "optional";
      lines.push(`- ${param.name}: ${param.type} (${required}) - ${param.description}`);
    }
  }
  if (item.returns) {
    lines.push("", `Returns: ${item.returns}`);
  }
  return lines.join("\n");
}

function buildGenericSnippet(item: MacroApiDocItem): string {
  if (!item.params || item.params.length === 0) {
    return `${item.name}()`;
  }
  const args = item.params.map((param, index) => {
    const placeholder = param.type === "string" ? `"${param.name}"` : param.name;
    return `\${${index + 1}:${placeholder}}`;
  });
  return `${item.name}(${args.join(", ")})`;
}

export function buildApiSnippet(item: MacroApiDocItem): string {
  const knownSnippets: Record<string, string> = {
    readTag: "readTag(${1:\"Tag.Name\"})",
    writeTag: "writeTag(${1:\"Tag.Name\"}, ${2:value})",
    pulseTag: "await pulseTag(${1:\"Tag.Name\"}, ${2:true}, ${3:500}, ${4:false})",
    toggleTag: "await toggleTag(${1:\"Tag.Name\"})",
    getLW: "getLW(${1:10})",
    setLW: "setLW(${1:10}, ${2:value})",
    getVar: "getVar(${1:\"VarName\"})",
    setVar: "setVar(${1:\"VarName\"}, ${2:value})",
    openScreen: "openScreen(${1:\"screen_id\"})",
    openPopup: "openPopup(${1:\"popup_id\"}, ${2:{ title: \"Popup\" }})",
    resolveTag: "resolveTag(${1:\".TagName\"}, ${2:getCurrentTagPrefix()})",
    log: "log(${1:\"message\"})",
    warn: "warn(${1:\"message\"})",
    error: "error(${1:\"message\"})",
  };
  return knownSnippets[item.name] ?? buildGenericSnippet(item);
}

export const MacroCodeEditor = forwardRef<MacroCodeEditorHandle, MacroCodeEditorProps>(
  ({ value, onChange, height = "100%", readOnly = false, enableMacroCompletions = false }, ref) => {
    const editorRef = useRef<MonacoEditorLike | null>(null);
    const completionProviderRef = useRef<MonacoDisposable | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => {
        editorRef.current?.focus();
      },
      insertText: (text: string) => {
        const editor = editorRef.current;
        if (!editor) {
          return false;
        }
        const selection = editor.getSelection();
        if (!selection) {
          return false;
        }
        editor.executeEdits("macro-code-editor", [{ range: selection, text, forceMoveMarkers: true }]);
        editor.focus();
        return true;
      },
    }), []);

    useEffect(() => () => {
      completionProviderRef.current?.dispose();
      completionProviderRef.current = null;
      editorRef.current = null;
    }, []);

    return (
      <Editor
        value={value}
        height={height}
        language="javascript"
        theme="vs-dark"
        onMount={(editor, monaco) => {
          editorRef.current = editor as MonacoEditorLike;
          if (!enableMacroCompletions) {
            return;
          }
          completionProviderRef.current?.dispose();
          completionProviderRef.current = monaco.languages.registerCompletionItemProvider("javascript", {
            provideCompletionItems(model: MonacoTextModelLike, position: MonacoPosition) {
              const word = model.getWordUntilPosition(position);
              const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
              };
              const apiSuggestions = macroApiDocumentation.map((item) => ({
                label: item.name,
                kind: monaco.languages.CompletionItemKind.Function,
                detail: item.signature,
                documentation: buildApiDocumentation(item),
                insertText: buildApiSnippet(item),
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
              }));
              const templateSuggestions = macroTemplates.map((template) => ({
                label: `template: ${template.title}`,
                kind: monaco.languages.CompletionItemKind.Snippet,
                detail: template.category,
                documentation: template.description,
                insertText: template.code,
                range,
              }));
              return {
                suggestions: [...apiSuggestions, ...templateSuggestions],
              };
            },
          });
        }}
        onChange={(nextValue) => onChange(nextValue ?? "")}
        loading={<div style={{ padding: 8, color: "rgba(255, 255, 255, 0.65)" }}>Loading macro editor...</div>}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          wordWrap: "on",
          automaticLayout: true,
          scrollBeyondLastLine: false,
          tabSize: 2,
          insertSpaces: true,
        }}
      />
    );
  },
);

MacroCodeEditor.displayName = "MacroCodeEditor";
