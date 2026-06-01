import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ElementLibrary, FrameObject, FrameTagIndexRule, RuntimeValueSource, ScadaProject } from "@web-scada/shared";
import { WorkbenchTable, WorkbenchWindow, type WorkbenchWindowRect, nextGlobalZIndex } from "./workbench";
import { evaluateFrameIndexScanItem, scanFrameIndexTagsDetailed, type FrameIndexScanItem } from "../hmi/tags/frame-index-scan";

type FrameIndexesEditorWindowProps = {
  open: boolean;
  project: ScadaProject;
  libraries: ElementLibrary[];
  frame: FrameObject;
  runtimePreviewValues?: Record<string, unknown>;
  onApplyRules: (nextRules: FrameTagIndexRule[]) => void;
  onClose: () => void;
};

type ScanRow = FrameIndexScanItem & {
  key: string;
  status: string;
  preview: string;
  matchedRuleIds: string[];
  warnings: string[];
};

type FrameIndexColumnId = "object" | "type" | "field" | "rawTag" | "indexes" | "local" | "status" | "preview" | "notes";
type FrameIndexColumnVisibility = Record<FrameIndexColumnId, boolean>;

const FRAME_INDEX_VISIBLE_COLUMNS_STORAGE_KEY = "mywebscada.frameIndexes.visibleColumns";
const FRAME_INDEX_REQUIRED_COLUMNS: FrameIndexColumnId[] = ["object", "field", "rawTag", "preview"];

const FRAME_INDEX_COLUMN_DEFINITIONS: Array<{
  id: FrameIndexColumnId;
  title: string;
  width: number;
  minWidth: number;
}> = [
  { id: "object", title: "OBJECT", width: 150, minWidth: 90 },
  { id: "type", title: "TYPE", width: 90, minWidth: 64 },
  { id: "field", title: "FIELD", width: 140, minWidth: 90 },
  { id: "rawTag", title: "RAW TAG", width: 210, minWidth: 120 },
  { id: "indexes", title: "INDEXES FOUND", width: 150, minWidth: 96 },
  { id: "local", title: "LOCAL INDEXING", width: 120, minWidth: 90 },
  { id: "status", title: "STATUS", width: 130, minWidth: 88 },
  { id: "preview", title: "PREVIEW", width: 210, minWidth: 120 },
  { id: "notes", title: "NOTES", width: 180, minWidth: 120 },
];

const DEFAULT_RECT: WorkbenchWindowRect = { x: 220, y: 90, width: 1180, height: 760 };
const MIN_WIDTH = 860;
const MIN_HEIGHT = 520;
const RECT_STORAGE_KEY = "workbench.frameIndexesEditor.rect";

export function FrameIndexesEditorWindow({
  open,
  project,
  libraries,
  frame,
  runtimePreviewValues,
  onApplyRules,
  onClose,
}: FrameIndexesEditorWindowProps) {
  const [rect, setRect] = useState<WorkbenchWindowRect>(() => loadRect());
  const [zIndex, setZIndex] = useState(() => nextGlobalZIndex());
  const [draftRules, setDraftRules] = useState<FrameTagIndexRule[]>(() => normalizeRulesForEditor(frame.tagIndexRules));
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [columnsPanelOpen, setColumnsPanelOpen] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState<FrameIndexColumnVisibility>(() => loadColumnVisibility());

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraftRules(normalizeRulesForEditor(frame.tagIndexRules));
    setSelectedRowId(null);
    setColumnsPanelOpen(false);
  }, [open, frame.id, frame.tagIndexRules]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(RECT_STORAGE_KEY, JSON.stringify(rect));
  }, [rect]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(FRAME_INDEX_VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(columnVisibility));
  }, [columnVisibility]);

  const selectedScreen = useMemo(
    () => project.screens.find((screen) => screen.id === frame.screenId),
    [project.screens, frame.screenId],
  );
  const scanResult = useMemo(
    () => {
      if (!selectedScreen) {
        return { items: [], diagnostics: [] as string[] };
      }
      return scanFrameIndexTagsDetailed(selectedScreen.objects, {
        libraries,
        runtimeValues: runtimePreviewValues,
        renderContext: {
          tagPrefix: frame.tagPrefix,
        },
      });
    },
    [selectedScreen, libraries, runtimePreviewValues, frame.tagPrefix],
  );
  const scanItems = scanResult.items;
  const scanRows = useMemo<ScanRow[]>(
    () =>
      scanItems.map((item) => {
        const evaluation = evaluateFrameIndexScanItem(item, draftRules, {
          runtimeValues: runtimePreviewValues,
          renderContext: {
            tagPrefix: frame.tagPrefix,
          },
        });
        const runtimeSuffix = item.runtimeSupport === "limited" ? " (runtime limited)" : "";
        const warningSuffix = evaluation.warnings.length > 0 ? " (fallback)" : "";
        return {
          ...item,
          key: `${item.objectId}:${item.fieldPath}`,
          status: `${evaluation.status}${runtimeSuffix}${warningSuffix}`,
          preview: evaluation.preview,
          matchedRuleIds: evaluation.matchedRuleIds,
          warnings: evaluation.warnings,
        };
      }),
    [draftRules, scanItems, runtimePreviewValues, frame.tagPrefix],
  );
  const selectedRow = useMemo(() => scanRows.find((item) => item.key === selectedRowId) ?? scanRows[0], [scanRows, selectedRowId]);

  const conflictRows = useMemo(() => scanRows.filter((item) => item.hasLocalIndexing), [scanRows]);
  const visibleColumnIds = useMemo(
    () => FRAME_INDEX_COLUMN_DEFINITIONS
      .filter((column) => columnVisibility[column.id] !== false)
      .map((column) => column.id),
    [columnVisibility],
  );
  const visibleColumns = useMemo(
    () => FRAME_INDEX_COLUMN_DEFINITIONS
      .filter((column) => visibleColumnIds.includes(column.id))
      .map((column) => ({
        id: column.id,
        title: column.title,
        width: column.width,
        minWidth: column.minWidth,
        render: (row: ScanRow) => renderScanColumn(row, column.id),
      })),
    [visibleColumnIds],
  );

  const focusWindow = () => {
    setZIndex(nextGlobalZIndex());
  };

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="frame-indexes-editor-window-layer"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <WorkbenchWindow
        id="frameIndexesEditor"
        title="Frame Indexes"
        rect={rect}
        zIndex={zIndex}
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        onClose={onClose}
        onFocus={focusWindow}
        onMove={(x, y) => setRect((prev) => clampRect({ ...prev, x, y }))}
        onResize={(nextRect) => setRect(clampRect(nextRect))}
      >
        <div className="frame-indexes-editor-window">
          <div className="frame-indexes-editor-toolbar">
            <div className="frame-indexes-editor-toolbar__meta">
              <span>Frame:</span>
              <strong>{frame.name?.trim() || frame.id}</strong>
            </div>
            <div className="frame-indexes-editor-toolbar__meta">
              <span>Screen:</span>
              <strong>{frame.screenId || "-"}</strong>
            </div>
          </div>

          {!frame.screenId ? (
            <div className="frame-indexes-editor-empty-screen">Select frame screen first.</div>
          ) : !selectedScreen ? (
            <div className="frame-indexes-editor-empty-screen">Frame screen/template not found.</div>
          ) : (
            <div className="frame-indexes-editor-content">
              <section className="frame-indexes-editor-section">
                <div className="frame-indexes-editor-section__header">
                  <span>Rules</span>
                  <button
                    type="button"
                    className="workbench-button"
                    onClick={() => setDraftRules((prev) => [...prev, createDefaultFrameTagIndexRule()])}
                  >
                    <span className="workbench-button__label">Add rule</span>
                  </button>
                </div>
                {draftRules.length === 0 ? (
                  <div className="frame-indexes-editor-empty-block">Rules are not configured.</div>
                ) : (
                  <div className="frame-indexes-editor-rules">
                    {draftRules.map((rule, index) => {
                      const modeType = rule.indexMode.type === "arrayIndexBySegment" ? "arrayIndexBySegment" : "arrayIndex";
                      return (
                        <div key={rule.id} className="frame-indexes-editor-rule">
                          <div className="frame-indexes-editor-rule__header">
                            <strong>Rule {index + 1}</strong>
                            <button
                              type="button"
                              className="workbench-button workbench-button--danger"
                              onClick={() => setDraftRules((prev) => prev.filter((item) => item.id !== rule.id))}
                            >
                              <span className="workbench-button__label">Delete</span>
                            </button>
                          </div>
                          <div className="frame-indexes-editor-rule__grid">
                            <label className="frame-indexes-editor-field frame-indexes-editor-field--inline">
                              <span>Enabled</span>
                              <input
                                type="checkbox"
                                checked={rule.enabled !== false}
                                onChange={(event) =>
                                  setDraftRules((prev) =>
                                    prev.map((item) => (item.id === rule.id ? { ...item, enabled: event.target.checked } : item)),
                                  )
                                }
                              />
                            </label>
                            <label className="frame-indexes-editor-field">
                              <span>Name</span>
                              <input
                                className="workbench-input"
                                value={rule.name ?? ""}
                                onChange={(event) =>
                                  setDraftRules((prev) =>
                                    prev.map((item) => (item.id === rule.id ? { ...item, name: event.target.value } : item)),
                                  )
                                }
                              />
                            </label>
                            <label className="frame-indexes-editor-field">
                              <span>Offset Source</span>
                              <select
                                className="workbench-select"
                                value={getOffsetSourceType(rule.indexOffsetSource)}
                                onChange={(event) =>
                                  setDraftRules((prev) =>
                                    prev.map((item) => (
                                      item.id === rule.id
                                        ? { ...item, indexOffsetSource: createOffsetSourceDraft(event.target.value, item.indexOffset) }
                                        : item
                                    )),
                                  )
                                }
                              >
                                <option value="constant">Constant</option>
                                <option value="tag">Tag</option>
                                <option value="lw">LW</option>
                                <option value="internal">Internal</option>
                                <option value="expression">Expression</option>
                              </select>
                            </label>
                            <label className="frame-indexes-editor-field">
                              <span>Source Value</span>
                              {rule.indexOffsetSource?.type === "tag" ? (
                                <input
                                  className="workbench-input"
                                  value={rule.indexOffsetSource.tag}
                                  placeholder="Tag name"
                                  onChange={(event) =>
                                    setDraftRules((prev) =>
                                      prev.map((item) => (
                                        item.id === rule.id && item.indexOffsetSource?.type === "tag"
                                          ? { ...item, indexOffsetSource: { ...item.indexOffsetSource, tag: event.target.value } }
                                          : item
                                      )),
                                    )
                                  }
                                />
                              ) : null}
                              {rule.indexOffsetSource?.type === "lw" ? (
                                <input
                                  className="workbench-input"
                                  type="number"
                                  min={0}
                                  value={String(rule.indexOffsetSource.address)}
                                  placeholder="LW address"
                                  onChange={(event) =>
                                    setDraftRules((prev) =>
                                      prev.map((item) => (
                                        item.id === rule.id && item.indexOffsetSource?.type === "lw"
                                          ? { ...item, indexOffsetSource: { ...item.indexOffsetSource, address: Math.max(0, Math.floor(toFiniteNumber(event.target.value))) } }
                                          : item
                                      )),
                                    )
                                  }
                                />
                              ) : null}
                              {rule.indexOffsetSource?.type === "internal" ? (
                                <input
                                  className="workbench-input"
                                  value={rule.indexOffsetSource.name}
                                  placeholder="Variable name"
                                  onChange={(event) =>
                                    setDraftRules((prev) =>
                                      prev.map((item) => (
                                        item.id === rule.id && item.indexOffsetSource?.type === "internal"
                                          ? { ...item, indexOffsetSource: { ...item.indexOffsetSource, name: event.target.value } }
                                          : item
                                      )),
                                    )
                                  }
                                />
                              ) : null}
                              {rule.indexOffsetSource?.type === "expression" ? (
                                <input
                                  className="workbench-input"
                                  value={rule.indexOffsetSource.expression}
                                  placeholder="Expression"
                                  onChange={(event) =>
                                    setDraftRules((prev) =>
                                      prev.map((item) => (
                                        item.id === rule.id && item.indexOffsetSource?.type === "expression"
                                          ? { ...item, indexOffsetSource: { ...item.indexOffsetSource, expression: event.target.value } }
                                          : item
                                      )),
                                    )
                                  }
                                />
                              ) : null}
                              {(rule.indexOffsetSource?.type === "static" || !rule.indexOffsetSource) ? (
                                <input
                                  className="workbench-input"
                                  type="number"
                                  value={String(
                                    rule.indexOffsetSource?.type === "static"
                                      ? toFiniteNumber(String(rule.indexOffsetSource.value ?? 0))
                                      : rule.indexOffset,
                                  )}
                                  onChange={(event) => {
                                    const numeric = toFiniteNumber(event.target.value);
                                    setDraftRules((prev) =>
                                      prev.map((item) => (
                                        item.id === rule.id
                                          ? {
                                              ...item,
                                              indexOffset: numeric,
                                              indexOffsetSource: {
                                                type: "static",
                                                value: numeric,
                                              },
                                            }
                                          : item
                                      )),
                                    );
                                  }}
                                />
                              ) : null}
                            </label>
                            <label className="frame-indexes-editor-field">
                              <span>Fallback Offset</span>
                              <input
                                className="workbench-input"
                                type="number"
                                value={String(rule.indexOffset)}
                                onChange={(event) =>
                                  setDraftRules((prev) =>
                                    prev.map((item) =>
                                      item.id === rule.id
                                        ? { ...item, indexOffset: toFiniteNumber(event.target.value) }
                                        : item,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label className="frame-indexes-editor-field">
                              <span>Mode</span>
                              <select
                                className="workbench-select"
                                value={modeType}
                                onChange={(event) => {
                                  const nextMode = event.target.value;
                                  if (nextMode === "arrayIndexBySegment") {
                                    setDraftRules((prev) =>
                                      prev.map((item) =>
                                        item.id === rule.id
                                          ? {
                                              ...item,
                                              indexMode: {
                                                type: "arrayIndexBySegment",
                                                segmentName: "",
                                                operation: "add",
                                                valueFrom: "indexOffset",
                                              },
                                            }
                                          : item,
                                      ),
                                    );
                                    return;
                                  }
                                  setDraftRules((prev) =>
                                    prev.map((item) =>
                                      item.id === rule.id
                                        ? {
                                            ...item,
                                            indexMode: {
                                              type: "arrayIndex",
                                              occurrence: 0,
                                              operation: "add",
                                              valueFrom: "indexOffset",
                                            },
                                          }
                                        : item,
                                    ),
                                  );
                                }}
                              >
                                <option value="arrayIndex">Array index occurrence</option>
                                <option value="arrayIndexBySegment">Array index by segment</option>
                              </select>
                            </label>
                            {modeType === "arrayIndexBySegment" ? (
                              <label className="frame-indexes-editor-field">
                                <span>Segment Name</span>
                                <input
                                  className="workbench-input"
                                  value={rule.indexMode.type === "arrayIndexBySegment" ? rule.indexMode.segmentName : ""}
                                  onChange={(event) =>
                                    setDraftRules((prev) =>
                                      prev.map((item) =>
                                        item.id === rule.id
                                          ? {
                                              ...item,
                                              indexMode: {
                                                type: "arrayIndexBySegment",
                                                segmentName: event.target.value,
                                                operation: "add",
                                                valueFrom: "indexOffset",
                                              },
                                            }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                              </label>
                            ) : (
                              <label className="frame-indexes-editor-field">
                                <span>Occurrence</span>
                                <input
                                  className="workbench-input"
                                  type="number"
                                  min={0}
                                  value={String(rule.indexMode.type === "arrayIndex" ? rule.indexMode.occurrence : 0)}
                                  onChange={(event) =>
                                    setDraftRules((prev) =>
                                      prev.map((item) =>
                                        item.id === rule.id
                                          ? {
                                              ...item,
                                              indexMode: {
                                                type: "arrayIndex",
                                                occurrence: Math.max(0, Math.floor(toFiniteNumber(event.target.value))),
                                                operation: "add",
                                                valueFrom: "indexOffset",
                                              },
                                            }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                              </label>
                            )}
                            <div className="frame-indexes-editor-field frame-indexes-editor-field--full">
                              <span>Conflict</span>
                              <div className="frame-indexes-editor-readonly">skipLocal (skip local/manual indexing)</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="frame-indexes-editor-section">
                <div className="frame-indexes-editor-section__header">
                  <span>Detected indexed tags</span>
                  <div className="frame-indexes-editor-section__header-actions">
                    <small>{scanRows.length} fields</small>
                    <button
                      type="button"
                      className={["workbench-button", columnsPanelOpen ? "workbench-button--active" : ""].filter(Boolean).join(" ")}
                      onClick={() => setColumnsPanelOpen((prev) => !prev)}
                    >
                      <span className="workbench-button__label">Columns</span>
                    </button>
                  </div>
                </div>
                {columnsPanelOpen ? (
                  <div className="frame-indexes-editor-columns-panel">
                    {FRAME_INDEX_COLUMN_DEFINITIONS.map((column) => (
                      <label key={column.id} className="frame-indexes-editor-column-toggle">
                        <input
                          type="checkbox"
                          checked={columnVisibility[column.id] !== false}
                          disabled={FRAME_INDEX_REQUIRED_COLUMNS.includes(column.id)}
                          onChange={(event) =>
                            setColumnVisibility((prev) => ({
                              ...prev,
                              [column.id]: event.target.checked,
                              object: true,
                              field: true,
                              rawTag: true,
                              preview: true,
                            }))
                          }
                        />
                        <span>{column.title}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
                <div className="frame-indexes-editor-table-wrap">
                  <WorkbenchTable
                    rows={scanRows}
                    columns={visibleColumns}
                    getRowId={(row) => row.key}
                    emptyText="No tag-like fields found."
                    selectedRowId={selectedRow?.key ?? null}
                    onRowClick={(row) => setSelectedRowId(row.key)}
                    columnStorageKey="frame-indexes-editor.columns"
                  />
                </div>
                {scanResult.diagnostics.length > 0 ? (
                  <div className="frame-indexes-editor-diagnostics">
                    {scanResult.diagnostics.map((diagnostic, index) => (
                      <div key={`diag:${index}`}>{diagnostic}</div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="frame-indexes-editor-section">
                <div className="frame-indexes-editor-section__header">
                  <span>Conflicts / local overrides</span>
                  <small>{conflictRows.length}</small>
                </div>
                {conflictRows.length === 0 ? (
                  <div className="frame-indexes-editor-empty-block">No local overrides detected.</div>
                ) : (
                  <div className="frame-indexes-editor-conflicts">
                    {conflictRows.map((row) => (
                      <div key={`conflict:${row.key}`} className="frame-indexes-editor-conflict">
                        <div>
                          <strong>{row.objectName?.trim() || row.objectId}</strong> ({row.objectType}) · {row.fieldPath}
                        </div>
                        <div>This field has local indexing. Frame Index will not be applied because conflictMode is skipLocal.</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="frame-indexes-editor-section frame-indexes-editor-preview">
                <div className="frame-indexes-editor-section__header">
                  <span>Preview</span>
                </div>
                {!selectedRow ? (
                  <div className="frame-indexes-editor-empty-block">Select a row from Detected indexed tags.</div>
                ) : (
                  <div className="frame-indexes-editor-preview-grid">
                    <div>Object</div>
                    <div>{selectedRow.objectName?.trim() || selectedRow.objectId}</div>
                    <div>Field</div>
                    <div>{selectedRow.fieldPath}</div>
                    <div>Raw tag</div>
                    <div className="frame-indexes-editor-monospace">{selectedRow.rawTag}</div>
                    <div>Result</div>
                    <div className="frame-indexes-editor-monospace">{selectedRow.preview}</div>
                    <div>Matched rules</div>
                    <div>{selectedRow.matchedRuleIds.length > 0 ? selectedRow.matchedRuleIds.join(", ") : "-"}</div>
                    <div>Notes</div>
                    <div>{selectedRow.note ?? (selectedRow.warnings.length > 0 ? selectedRow.warnings.join(" | ") : "-")}</div>
                  </div>
                )}
              </section>
            </div>
          )}

          <div className="frame-indexes-editor-actions">
            <button type="button" className="workbench-button" onClick={onClose}>
              <span className="workbench-button__label">Cancel</span>
            </button>
            <button
              type="button"
              className="workbench-button"
              onClick={() => onApplyRules(normalizeRulesForEditor(draftRules))}
              disabled={!selectedScreen}
            >
              <span className="workbench-button__label">Apply</span>
            </button>
            <button
              type="button"
              className="workbench-button workbench-button--primary"
              onClick={() => {
                onApplyRules(normalizeRulesForEditor(draftRules));
                onClose();
              }}
              disabled={!selectedScreen}
            >
              <span className="workbench-button__label">Apply and Close</span>
            </button>
          </div>
        </div>
      </WorkbenchWindow>
    </div>,
    document.body,
  );
}

function createDefaultFrameTagIndexRule(): FrameTagIndexRule {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return {
    id: `frame-index-rule-${Date.now()}-${randomPart}`,
    enabled: true,
    name: "",
    indexOffset: 0,
    indexOffsetSource: {
      type: "static",
      value: 0,
    },
    indexMode: {
      type: "arrayIndex",
      occurrence: 0,
      operation: "add",
      valueFrom: "indexOffset",
    },
    conflictMode: "skipLocal",
  };
}

function normalizeRulesForEditor(rules: FrameTagIndexRule[] | undefined): FrameTagIndexRule[] {
  return (rules ?? []).map((rule) => {
    const normalizedIndexOffset = Number.isFinite(Number(rule.indexOffset)) ? Number(rule.indexOffset) : 0;
    const normalizedOffsetSource = normalizeOffsetSource(rule.indexOffsetSource, normalizedIndexOffset);
    if (rule.indexMode.type === "arrayIndexBySegment") {
      return {
        ...rule,
        enabled: rule.enabled !== false,
        indexOffset: normalizedIndexOffset,
        indexOffsetSource: normalizedOffsetSource,
        conflictMode: "skipLocal",
        indexMode: {
          type: "arrayIndexBySegment",
          segmentName: rule.indexMode.segmentName ?? "",
          operation: "add",
          valueFrom: "indexOffset",
        },
      };
    }
    return {
      ...rule,
      enabled: rule.enabled !== false,
      indexOffset: normalizedIndexOffset,
      indexOffsetSource: normalizedOffsetSource,
      conflictMode: "skipLocal",
      indexMode: {
        type: "arrayIndex",
        occurrence: Math.max(0, Math.floor(Number((rule.indexMode as { occurrence?: number }).occurrence ?? 0))),
        operation: "add",
        valueFrom: "indexOffset",
      },
    };
  });
}

function normalizeOffsetSource(source: RuntimeValueSource | undefined, fallbackOffset: number): RuntimeValueSource {
  if (!source) {
    return {
      type: "static",
      value: fallbackOffset,
    };
  }
  if (source.type === "static") {
    const numeric = Number(source.value);
    return {
      type: "static",
      value: Number.isFinite(numeric) ? numeric : fallbackOffset,
    };
  }
  if (source.type === "tag") {
    return {
      type: "tag",
      tag: source.tag ?? "",
    };
  }
  if (source.type === "lw") {
    return {
      type: "lw",
      address: Number.isFinite(source.address) ? Math.max(0, Math.floor(source.address)) : 0,
    };
  }
  if (source.type === "internal") {
    return {
      type: "internal",
      name: source.name ?? "",
    };
  }
  return {
    type: "expression",
    expression: source.expression ?? "",
  };
}

function getOffsetSourceType(source: RuntimeValueSource | undefined): "constant" | "tag" | "lw" | "internal" | "expression" {
  if (!source || source.type === "static") {
    return "constant";
  }
  return source.type;
}

function createOffsetSourceDraft(type: string, fallbackOffset: number): RuntimeValueSource {
  switch (type) {
    case "tag":
      return { type: "tag", tag: "" };
    case "lw":
      return { type: "lw", address: 0 };
    case "internal":
      return { type: "internal", name: "" };
    case "expression":
      return { type: "expression", expression: "" };
    default:
      return { type: "static", value: fallbackOffset };
  }
}

function renderScanColumn(row: ScanRow, columnId: FrameIndexColumnId) {
  switch (columnId) {
    case "object":
      return row.objectName?.trim() || row.objectId;
    case "type":
      return row.objectType;
    case "field":
      return row.fieldPath;
    case "rawTag":
      return <span className="frame-indexes-editor-monospace">{row.rawTag}</span>;
    case "indexes":
      return row.indexTokens.length > 0
        ? row.indexTokens.map((token) => `${token.occurrence}:${token.segmentName ?? "?"}${token.token}`).join(", ")
        : "-";
    case "local":
      return row.localIndexingSource ?? "No";
    case "status":
      return row.status;
    case "preview":
      return <span className="frame-indexes-editor-monospace">{row.preview}</span>;
    case "notes":
      return row.note ?? (row.warnings.length > 0 ? row.warnings.join("; ") : "-");
    default:
      return "-";
  }
}

function createDefaultColumnVisibility(): FrameIndexColumnVisibility {
  return FRAME_INDEX_COLUMN_DEFINITIONS.reduce<FrameIndexColumnVisibility>((acc, column) => {
    acc[column.id] = true;
    return acc;
  }, {
    object: true,
    type: true,
    field: true,
    rawTag: true,
    indexes: true,
    local: true,
    status: true,
    preview: true,
    notes: true,
  });
}

function loadColumnVisibility(): FrameIndexColumnVisibility {
  const defaults = createDefaultColumnVisibility();
  if (typeof window === "undefined") {
    return defaults;
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FRAME_INDEX_VISIBLE_COLUMNS_STORAGE_KEY) ?? "null") as Record<string, unknown> | null;
    if (!parsed) {
      return defaults;
    }
    const next = { ...defaults };
    for (const column of FRAME_INDEX_COLUMN_DEFINITIONS) {
      if (typeof parsed[column.id] === "boolean") {
        next[column.id] = parsed[column.id] as boolean;
      }
    }
    for (const required of FRAME_INDEX_REQUIRED_COLUMNS) {
      next[required] = true;
    }
    return next;
  } catch {
    return defaults;
  }
}

function toFiniteNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampRect(rect: WorkbenchWindowRect): WorkbenchWindowRect {
  const width = Math.max(MIN_WIDTH, Math.round(rect.width));
  const height = Math.max(MIN_HEIGHT, Math.round(rect.height));
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  return { x, y, width, height };
}

function loadRect(): WorkbenchWindowRect {
  if (typeof window === "undefined") {
    return DEFAULT_RECT;
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECT_STORAGE_KEY) ?? "null") as Partial<WorkbenchWindowRect> | null;
    if (!parsed) {
      return DEFAULT_RECT;
    }
    return clampRect({
      x: typeof parsed.x === "number" ? parsed.x : DEFAULT_RECT.x,
      y: typeof parsed.y === "number" ? parsed.y : DEFAULT_RECT.y,
      width: typeof parsed.width === "number" ? parsed.width : DEFAULT_RECT.width,
      height: typeof parsed.height === "number" ? parsed.height : DEFAULT_RECT.height,
    });
  } catch {
    return DEFAULT_RECT;
  }
}
