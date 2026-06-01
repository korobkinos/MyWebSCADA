import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { FrameObject, FrameTagIndexRule, ScadaProject } from "@web-scada/shared";
import { WorkbenchTable, WorkbenchWindow, type WorkbenchWindowRect, nextGlobalZIndex } from "./workbench";
import { evaluateFrameIndexScanItem, scanFrameIndexTags, type FrameIndexScanItem } from "../hmi/tags/frame-index-scan";

type FrameIndexesEditorWindowProps = {
  open: boolean;
  project: ScadaProject;
  frame: FrameObject;
  onApplyRules: (nextRules: FrameTagIndexRule[]) => void;
  onClose: () => void;
};

type ScanRow = FrameIndexScanItem & {
  key: string;
  status: string;
  preview: string;
  matchedRuleIds: string[];
};

const DEFAULT_RECT: WorkbenchWindowRect = { x: 220, y: 90, width: 1180, height: 760 };
const MIN_WIDTH = 860;
const MIN_HEIGHT = 520;
const RECT_STORAGE_KEY = "workbench.frameIndexesEditor.rect";

export function FrameIndexesEditorWindow({
  open,
  project,
  frame,
  onApplyRules,
  onClose,
}: FrameIndexesEditorWindowProps) {
  const [rect, setRect] = useState<WorkbenchWindowRect>(() => loadRect());
  const [zIndex, setZIndex] = useState(() => nextGlobalZIndex());
  const [draftRules, setDraftRules] = useState<FrameTagIndexRule[]>(() => normalizeRulesForEditor(frame.tagIndexRules));
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraftRules(normalizeRulesForEditor(frame.tagIndexRules));
    setSelectedRowId(null);
  }, [open, frame.id, frame.tagIndexRules]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(RECT_STORAGE_KEY, JSON.stringify(rect));
  }, [rect]);

  const selectedScreen = useMemo(
    () => project.screens.find((screen) => screen.id === frame.screenId),
    [project.screens, frame.screenId],
  );
  const scanItems = useMemo(
    () => (selectedScreen ? scanFrameIndexTags(selectedScreen.objects) : []),
    [selectedScreen],
  );
  const scanRows = useMemo<ScanRow[]>(
    () =>
      scanItems.map((item) => {
        const evaluation = evaluateFrameIndexScanItem(item, draftRules);
        const runtimeSuffix = item.runtimeSupport === "limited" ? " (runtime limited)" : "";
        return {
          ...item,
          key: `${item.objectId}:${item.fieldPath}`,
          status: `${evaluation.status}${runtimeSuffix}`,
          preview: evaluation.preview,
          matchedRuleIds: evaluation.matchedRuleIds,
        };
      }),
    [draftRules, scanItems],
  );
  const selectedRow = useMemo(() => scanRows.find((item) => item.key === selectedRowId) ?? scanRows[0], [scanRows, selectedRowId]);

  const conflictRows = useMemo(() => scanRows.filter((item) => item.hasLocalIndexing), [scanRows]);

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
                              <span>Offset</span>
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
                  <small>{scanRows.length} fields</small>
                </div>
                <div className="frame-indexes-editor-table-wrap">
                  <WorkbenchTable
                    rows={scanRows}
                    columns={[
                      {
                        id: "object",
                        title: "OBJECT",
                        width: 160,
                        minWidth: 120,
                        render: (row) => row.objectName?.trim() || row.objectId,
                      },
                      {
                        id: "type",
                        title: "TYPE",
                        width: 100,
                        minWidth: 84,
                        render: (row) => row.objectType,
                      },
                      {
                        id: "field",
                        title: "FIELD",
                        width: 170,
                        minWidth: 140,
                        render: (row) => row.fieldPath,
                      },
                      {
                        id: "rawTag",
                        title: "RAW TAG",
                        width: 260,
                        minWidth: 180,
                        render: (row) => <span className="frame-indexes-editor-monospace">{row.rawTag}</span>,
                      },
                      {
                        id: "indexes",
                        title: "INDEXES FOUND",
                        width: 220,
                        minWidth: 140,
                        render: (row) =>
                          row.indexTokens.length > 0
                            ? row.indexTokens.map((token) => `${token.occurrence}:${token.segmentName ?? "?"}${token.token}`).join(", ")
                            : "-",
                      },
                      {
                        id: "local",
                        title: "LOCAL INDEXING",
                        width: 150,
                        minWidth: 110,
                        render: (row) => row.localIndexingSource ?? "No",
                      },
                      {
                        id: "status",
                        title: "STATUS",
                        width: 180,
                        minWidth: 130,
                        render: (row) => row.status,
                      },
                      {
                        id: "preview",
                        title: "PREVIEW",
                        width: 260,
                        minWidth: 180,
                        render: (row) => <span className="frame-indexes-editor-monospace">{row.preview}</span>,
                      },
                    ]}
                    getRowId={(row) => row.key}
                    emptyText="No tag-like fields found."
                    selectedRowId={selectedRow?.key ?? null}
                    onRowClick={(row) => setSelectedRowId(row.key)}
                    columnStorageKey="frame-indexes-editor.columns"
                  />
                </div>
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
    if (rule.indexMode.type === "arrayIndexBySegment") {
      return {
        ...rule,
        enabled: rule.enabled !== false,
        indexOffset: normalizedIndexOffset,
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
