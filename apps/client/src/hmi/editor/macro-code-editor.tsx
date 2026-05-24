import Editor from "@monaco-editor/react";
import { forwardRef, useImperativeHandle, useRef } from "react";

export type MacroCodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  height?: number | string;
  readOnly?: boolean;
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

export const MacroCodeEditor = forwardRef<MacroCodeEditorHandle, MacroCodeEditorProps>(
  ({ value, onChange, height = "100%", readOnly = false }, ref) => {
    const editorRef = useRef<MonacoEditorLike | null>(null);

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

    return (
      <Editor
        value={value}
        height={height}
        language="javascript"
        theme="vs-dark"
        onMount={(editor) => {
          editorRef.current = editor as MonacoEditorLike;
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
