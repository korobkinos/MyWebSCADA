import { useEffect, useMemo, useRef, useState } from "react";
import { DeleteOutlined, LeftOutlined, PlusOutlined, RedoOutlined, RightOutlined, SaveOutlined, UndoOutlined } from "@ant-design/icons";
import { Button, Card, Divider, Form, Input, InputNumber, List, Modal, Select, Space, Switch, Tabs, Tooltip, Typography, message } from "antd";
import type { DockPanelState, HmiObject, HmiScreen, LibraryElement, LibraryParameter, TagValue } from "@web-scada/shared";
import { resolveTagName, resolveTemplateString } from "@web-scada/shared";
import { ObjectPropertyPanel } from "../components/object-property-panel";
import { ResizableDockPanel } from "../components/resizable-dock-panel";
import { createObjectByType } from "../hmi/editor/default-object-factory";
import { useSnapshotHistory } from "../hooks/use-snapshot-history";
import { HmiStage } from "../hmi/runtime/hmi-stage";
import { useDockLayout } from "../hooks/use-dock-layout";
import { api } from "../services/api";
import { useScadaStore } from "../store/scada-store";
import { isTextEditingTarget } from "../utils/keyboard";

const defaultDockPanels: DockPanelState[] = [
  { id: "elementEditor.left", side: "left", hidden: false, size: 340, lastVisibleSize: 340 },
  { id: "elementEditor.right", side: "right", hidden: false, size: 380, lastVisibleSize: 380 },
];

function createElementId(name: string): string {
  return (name || "element")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createDefaultElement(): LibraryElement {
  const now = new Date().toISOString();
  return {
    id: `element_${Math.random().toString(36).slice(2, 8)}`,
    elementKey: `element_${Math.random().toString(36).slice(2, 8)}`,
    name: "Новый элемент",
    description: "",
    category: "",
    width: 180,
    height: 120,
    objects: [],
    parameters: [
      { name: "tagPrefix", displayName: "Tag Prefix", type: "tagPrefix", defaultValue: "", required: false },
      { name: "index", displayName: "Index", type: "index", defaultValue: 1, required: false },
      { name: "label", displayName: "Label", type: "string", defaultValue: "Element", required: false },
    ],
    stateRules: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createVirtualScreen(element: LibraryElement): HmiScreen {
  return {
    id: `element_screen_${element.id}`,
    name: element.name,
    kind: "template",
    width: element.width,
    height: element.height,
    background: "#17212b",
    objects: element.objects,
  };
}

function updateObjectInList(objects: HmiObject[], objectId: string, updater: (current: HmiObject) => HmiObject): HmiObject[] {
  return objects.map((item) => {
    if (item.id === objectId) {
      return updater(item);
    }
    if (item.type === "group") {
      return { ...item, objects: updateObjectInList(item.objects, objectId, updater) };
    }
    return item;
  });
}

function removeObjectInList(objects: HmiObject[], objectId: string): HmiObject[] {
  return objects
    .filter((item) => item.id !== objectId)
    .map((item) => (item.type === "group" ? { ...item, objects: removeObjectInList(item.objects, objectId) } : item));
}

function resolveParameterValue(param: LibraryParameter, raw: string): unknown {
  if (param.type === "number" || param.type === "index") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (param.type === "boolean") {
    return raw === "true" || raw === "1";
  }
  return raw;
}

function countElementUsages(project: ReturnType<typeof useScadaStore.getState>["project"], libraryId: string, elementId: string): number {
  if (!project) {
    return 0;
  }
  let count = 0;
  for (const screen of project.screens) {
    const queue = [...screen.objects];
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        continue;
      }
      if (item.type === "libraryElementInstance" && item.libraryId === libraryId && item.elementId === elementId) {
        count += 1;
      }
      if (item.type === "group") {
        queue.push(...item.objects);
      }
    }
  }
  return count;
}

export function ElementEditorPage() {
  const project = useScadaStore((s) => s.project);
  const tags = useScadaStore((s) => s.tags);
  const libraries = useScadaStore((s) => s.libraries);
  const assets = useScadaStore((s) => s.assets);
  const loadLibraries = useScadaStore((s) => s.loadLibraries);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const dockLayout = useDockLayout(defaultDockPanels, { autoSaveMs: 900 });

  const [selectedLibraryId, setSelectedLibraryId] = useState<string>("");
  const [selectedElementId, setSelectedElementId] = useState<string>("");
  const [draftElement, setDraftElement] = useState<LibraryElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number }>();
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [activeObjectId, setActiveObjectId] = useState<string>();
  const [stateRulesJson, setStateRulesJson] = useState<string>("[]");
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [previewStateTag, setPreviewStateTag] = useState(".State");
  const [previewStateValue, setPreviewStateValue] = useState<string>("0");
  const history = useSnapshotHistory<LibraryElement>({ maxSteps: 50 });

  const leftPanel = dockLayout.getPanelState("elementEditor.left") ?? defaultDockPanels[0]!;
  const rightPanel = dockLayout.getPanelState("elementEditor.right") ?? defaultDockPanels[1]!;

  const selectedLibrary = libraries.find((library) => library.id === selectedLibraryId) ?? null;
  const filteredElements = useMemo(() => {
    const list = selectedLibrary?.elements ?? [];
    const term = search.trim().toLowerCase();
    const byCategory =
      categoryFilter === "all"
        ? list
        : list.filter((item) => (item.category ?? "").toLowerCase() === categoryFilter.toLowerCase());
    if (!term) {
      return byCategory;
    }
    return byCategory.filter((item) => item.name.toLowerCase().includes(term) || item.id.toLowerCase().includes(term));
  }, [categoryFilter, search, selectedLibrary?.elements]);

  const categoryOptions = useMemo(() => {
    const categories = new Set(
      (selectedLibrary?.elements ?? [])
        .map((item) => item.category?.trim())
        .filter((item): item is string => Boolean(item)),
    );
    return ["all", ...[...categories].sort((a, b) => a.localeCompare(b, "ru"))];
  }, [selectedLibrary?.elements]);

  const requestSwitchLibrary = (nextLibraryId: string) => {
    if (!dirty) {
      setSelectedLibraryId(nextLibraryId);
      setSelectedElementId("");
      return;
    }
    Modal.confirm({
      title: "Unsaved changes",
      content: "Discard current changes and switch library?",
      okText: "Discard",
      cancelText: "Cancel",
      onOk: () => {
        setDirty(false);
        setSelectedLibraryId(nextLibraryId);
        setSelectedElementId("");
      },
    });
  };

  const updateDraftWithHistory = (label: string, updater: (current: LibraryElement) => LibraryElement) => {
    setDraftElement((prev) => {
      if (!prev) {
        return prev;
      }
      const before = structuredClone(prev);
      const next = updater(prev);
      history.pushEntry(label, before, next);
      return next;
    });
    setDirty(true);
  };

  useEffect(() => {
    if (!selectedLibraryId && libraries[0]) {
      setSelectedLibraryId(libraries[0].id);
    }
  }, [libraries, selectedLibraryId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedLibrary) {
      return;
    }
    if (!selectedElementId) {
      if (selectedLibrary.elements[0]) {
        setSelectedElementId(selectedLibrary.elements[0].id);
      }
      return;
    }
    void (async () => {
      try {
        const element = await api.getLibraryElement(selectedLibrary.id, selectedElementId);
        if (cancelled) {
          return;
        }
        const clone = deepClone(element);
        setDraftElement(clone);
        setStateRulesJson(JSON.stringify(clone.stateRules ?? [], null, 2));
        setPreviewValues(
          Object.fromEntries((clone.parameters ?? []).map((param) => [param.name, String(param.defaultValue ?? "")])),
        );
        setSelectedObjectIds([]);
        setActiveObjectId(undefined);
        setDirty(false);
        history.clear();
      } catch (error) {
        if (!cancelled) {
          void message.error(error instanceof Error ? error.message : "Failed to load element");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedElementId, selectedLibrary]);

  const activeObject = useMemo(() => {
    if (!draftElement || !activeObjectId) {
      return null;
    }
    const stack: HmiObject[] = [...draftElement.objects];
    while (stack.length > 0) {
      const item = stack.shift();
      if (!item) {
        continue;
      }
      if (item.id === activeObjectId) {
        return item;
      }
      if (item.type === "group") {
        stack.push(...item.objects);
      }
    }
    return null;
  }, [activeObjectId, draftElement]);

  const previewParameters = useMemo(() => {
    if (!draftElement) {
      return {};
    }
    const result: Record<string, unknown> = {};
    for (const param of draftElement.parameters ?? []) {
      const raw = previewValues[param.name];
      if (raw === undefined || raw === "") {
        result[param.name] = param.defaultValue;
      } else {
        result[param.name] = resolveParameterValue(param, raw);
      }
    }
    return result;
  }, [draftElement, previewValues]);

  const previewTagPrefix = String(previewParameters.tagPrefix ?? "");

  const previewTags = useMemo(() => {
    const next: Record<string, TagValue> = { ...tags };
    const resolvedTag = resolveTagName(resolveTemplateString(previewStateTag, previewParameters), {
      tagPrefix: previewTagPrefix || undefined,
      parameters: previewParameters,
    });
    if (resolvedTag) {
      const numericValue = Number(previewStateValue);
      const parsedValue = Number.isFinite(numericValue) ? numericValue : previewStateValue;
      next[resolvedTag] = {
        name: resolvedTag,
        value: parsedValue,
        quality: "Good",
        timestamp: Date.now(),
        source: "preview",
      };
    }
    return next;
  }, [previewParameters, previewStateTag, previewStateValue, previewTagPrefix, tags]);
  const debugPerformance =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    window.localStorage.getItem("debugPerformance") === "1";

  useEffect(() => {
    if (!debugPerformance) {
      return;
    }
    // eslint-disable-next-line no-console
    console.debug("[Render] ElementEditor", {
      libraryId: selectedLibraryId,
      elementId: draftElement?.id,
      objects: draftElement?.objects.length ?? 0,
      selected: selectedObjectIds.length,
      history: {
        undo: history.canUndo,
        redo: history.canRedo,
      },
    });
  }, [debugPerformance, draftElement?.id, draftElement?.objects.length, history.canRedo, history.canUndo, selectedLibraryId, selectedObjectIds.length]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!draftElement) {
        return;
      }
      const ctrlOrMeta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const editing = isTextEditingTarget(event.target);

      if (ctrlOrMeta && key === "z" && !event.shiftKey) {
        event.preventDefault();
        const previous = history.undo(draftElement);
        if (previous) {
          setDraftElement(previous);
          setDirty(true);
        }
        return;
      }

      if (ctrlOrMeta && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        const next = history.redo(draftElement);
        if (next) {
          setDraftElement(next);
          setDirty(true);
        }
        return;
      }

      if (ctrlOrMeta && key === "s") {
        event.preventDefault();
        void saveElement();
        return;
      }

      if (!editing && (event.key === "Delete" || event.key === "Backspace")) {
        if (!activeObjectId) {
          return;
        }
        if (activeObject?.locked) {
          void message.warning("Locked objects were not deleted.");
          return;
        }
        event.preventDefault();
        updateDraftWithHistory("Delete object", (current) => ({
          ...current,
          objects: removeObjectInList(current.objects, activeObjectId),
        }));
        setSelectedObjectIds([]);
        setActiveObjectId(undefined);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeObject, activeObjectId, draftElement, history]);

  if (!project) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const applyDraftPatch = (patch: Partial<LibraryElement>) => {
    if (!draftElement) {
      return;
    }
    updateDraftWithHistory("Update element properties", (current) => ({ ...current, ...patch }));
  };

  const setObjects = (updater: (objects: HmiObject[]) => HmiObject[]) => {
    if (!draftElement) {
      return;
    }
    updateDraftWithHistory("Update element objects", (current) => ({
      ...current,
      objects: updater(current.objects),
    }));
  };

  const addObject = (type: HmiObject["type"]) => {
    if (!draftElement) {
      return;
    }
    const object = createObjectByType(type);
    object.x = 60 + draftElement.objects.length * 8;
    object.y = 60 + draftElement.objects.length * 8;
    setObjects((prev) => [...prev, object]);
    setSelectedObjectIds([object.id]);
    setActiveObjectId(object.id);
  };

  const addImageFromAsset = (assetId: string) => {
    const image = createObjectByType("image") as Extract<HmiObject, { type: "image" }>;
    image.assetId = assetId;
    image.width = 100;
    image.height = 80;
    setObjects((prev) => [...prev, image]);
    setSelectedObjectIds([image.id]);
    setActiveObjectId(image.id);
  };

  const newElement = () => {
    if (dirty) {
      Modal.confirm({
        title: "Unsaved changes",
        content: "Discard current draft and create new element?",
        okText: "Discard",
        cancelText: "Cancel",
        onOk: () => {
          const element = createDefaultElement();
          setDraftElement(element);
          setSelectedElementId("");
          setSelectedObjectIds([]);
          setActiveObjectId(undefined);
          setStateRulesJson(JSON.stringify([], null, 2));
          setPreviewValues(
            Object.fromEntries((element.parameters ?? []).map((param) => [param.name, String(param.defaultValue ?? "")])),
          );
          setDirty(true);
          history.clear();
        },
      });
      return;
    }
    const element = createDefaultElement();
    setDraftElement(element);
    setSelectedElementId("");
    setSelectedObjectIds([]);
    setActiveObjectId(undefined);
    setStateRulesJson(JSON.stringify([], null, 2));
    setPreviewValues(
      Object.fromEntries((element.parameters ?? []).map((param) => [param.name, String(param.defaultValue ?? "")])),
    );
    setDirty(true);
    history.clear();
  };

  async function saveElement() {
    if (!selectedLibraryId) {
      void message.warning("Select library first");
      return;
    }
    if (!draftElement) {
      return;
    }
    if (!draftElement.name.trim()) {
      void message.warning("Element name is required");
      return;
    }
    let parsedRules = draftElement.stateRules ?? [];
    try {
      parsedRules = JSON.parse(stateRulesJson) as NonNullable<LibraryElement["stateRules"]>;
    } catch {
      void message.error("State rules JSON is invalid");
      return;
    }

    const normalized: LibraryElement = {
      ...draftElement,
      id: draftElement.id?.trim() || createElementId(draftElement.name),
      elementKey: draftElement.elementKey?.trim() || createElementId(draftElement.name),
      libraryId: selectedLibraryId,
      name: draftElement.name.trim(),
      width: Math.max(20, draftElement.width),
      height: Math.max(20, draftElement.height),
      stateRules: parsedRules,
      updatedAt: new Date().toISOString(),
      createdAt: draftElement.createdAt || new Date().toISOString(),
    };

    const existing = selectedLibrary?.elements.find((item) => item.id === normalized.id);
    if (existing) {
      await api.updateLibraryElement(selectedLibraryId, normalized.id, normalized);
    } else {
      await api.createLibraryElement(selectedLibraryId, normalized);
    }
    await loadLibraries();
    setSelectedElementId(normalized.id);
    setDraftElement(normalized);
    setDirty(false);
    void message.success("Element saved");
  }

  const deleteElement = async () => {
    if (!selectedLibraryId || !selectedElementId) {
      return;
    }
    const usageCount = countElementUsages(project, selectedLibraryId, selectedElementId);
    if (usageCount > 0) {
      void message.warning(`Element is used ${usageCount} time(s) on screens. Detach references before delete.`);
      return;
    }
    Modal.confirm({
      title: "Delete element",
      content: `Delete element "${draftElement?.name ?? selectedElementId}" from library "${selectedLibrary?.name ?? selectedLibraryId}"?`,
      okText: "Delete",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        await api.deleteLibraryElement(selectedLibraryId, selectedElementId);
        await loadLibraries();
        setSelectedElementId("");
        setDraftElement(null);
        setDirty(false);
        history.clear();
        void message.success("Element deleted");
      },
    });
  };

  const duplicateElement = async () => {
    if (!selectedLibraryId || !draftElement) {
      return;
    }
    const copyId = `${createElementId(draftElement.name)}-${Math.random().toString(36).slice(2, 6)}`;
    const copy: LibraryElement = {
      ...deepClone(draftElement),
      id: copyId,
      elementKey: copyId,
      name: `${draftElement.name} Copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await api.createLibraryElement(selectedLibraryId, copy);
    await loadLibraries();
    setSelectedElementId(copy.id);
    void message.success("Element duplicated");
  };

  const attachLibrary = async () => {
    if (!selectedLibraryId) {
      return;
    }
    const next = await api.attachLibrary(selectedLibraryId);
    updateProjectJson(next);
    void message.success("Library attached to project");
  };

  const handleDropAsset = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/web-scada-asset");
    if (!raw) {
      return;
    }
    try {
      const payload = JSON.parse(raw) as { assetId: string };
      const image = createObjectByType("image") as Extract<HmiObject, { type: "image" }>;
      image.assetId = payload.assetId;
      image.x = Math.max(0, event.nativeEvent.offsetX - image.width / 2);
      image.y = Math.max(0, event.nativeEvent.offsetY - image.height / 2);
      setObjects((prev) => [...prev, image]);
      setSelectedObjectIds([image.id]);
      setActiveObjectId(image.id);
    } catch {
      // ignore malformed payload
    }
  };

  const virtualScreen = draftElement ? createVirtualScreen(draftElement) : null;

  return (
    <div ref={workspaceRef} className="route-page-fill" style={{ display: "flex", minWidth: 0, minHeight: 0, overflow: "hidden", position: "relative", gap: 10 }}>
      <ResizableDockPanel
        id="elementEditor.left"
        side="left"
        hidden={leftPanel.hidden}
        size={clamp(leftPanel.size, 0, 620)}
        lastVisibleSize={leftPanel.lastVisibleSize}
        minSize={250}
        maxSize={620}
        autoHideThreshold={80}
        restoreSize={340}
        workspaceRef={workspaceRef}
        restoreTooltip="Show element list"
        restoreIcon={<RightOutlined />}
        onStateChange={(state) => dockLayout.setPanelState("elementEditor.left", () => state)}
      >
        <Card
          size="small"
          title="Element List"
          style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}
          bodyStyle={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, overflow: "auto" }}
        >
          <Select
            value={selectedLibraryId || undefined}
            onChange={requestSwitchLibrary}
            placeholder="Select library"
            options={libraries.map((item) => ({ label: item.name, value: item.id }))}
          />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search elements" />
          <Select
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={categoryOptions.map((item) => ({ label: item === "all" ? "All categories" : item, value: item }))}
          />
          <Space wrap>
            <Button icon={<PlusOutlined />} onClick={newElement}>New</Button>
            <Button onClick={() => void duplicateElement()} disabled={!draftElement}>Duplicate</Button>
            <Button danger onClick={() => void deleteElement()} disabled={!selectedElementId}>Delete</Button>
            <Button onClick={() => void attachLibrary()} disabled={!selectedLibraryId}>Attach Library</Button>
          </Space>
          <List
            size="small"
            dataSource={filteredElements}
            renderItem={(item) => (
              <List.Item
                style={{ cursor: "pointer", background: selectedElementId === item.id ? "#e6f4ff" : undefined, borderRadius: 6 }}
                onClick={() => {
                  if (dirty) {
                    Modal.confirm({
                      title: "Unsaved changes",
                      content: "Save current element before switching?",
                      okText: "Save and switch",
                      cancelText: "Discard",
                      onOk: async () => {
                        await saveElement();
                        setSelectedElementId(item.id);
                      },
                      onCancel: () => {
                        setDirty(false);
                        setSelectedElementId(item.id);
                      },
                    });
                    return;
                  }
                  setSelectedElementId(item.id);
                }}
              >
                <Space direction="vertical" size={0}>
                  <Typography.Text>{item.name}</Typography.Text>
                  <Typography.Text type="secondary">{item.elementKey ?? item.id}</Typography.Text>
                  <Typography.Text type="secondary">{item.category || "General"} · {new Date(item.updatedAt).toLocaleString()}</Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      </ResizableDockPanel>

      <div style={{ flex: "1 1 auto", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", gap: 10 }}>
        <Card size="small" bodyStyle={{ padding: 10 }}>
          <Space wrap>
            <Tooltip title="Undo Ctrl+Z">
              <Button icon={<UndoOutlined />} onClick={() => {
                if (!draftElement) {
                  return;
                }
                const previous = history.undo(draftElement);
                if (previous) {
                  setDraftElement(previous);
                  setDirty(true);
                }
              }} disabled={!draftElement || !history.canUndo} />
            </Tooltip>
            <Tooltip title="Redo Ctrl+Y">
              <Button icon={<RedoOutlined />} onClick={() => {
                if (!draftElement) {
                  return;
                }
                const next = history.redo(draftElement);
                if (next) {
                  setDraftElement(next);
                  setDirty(true);
                }
              }} disabled={!draftElement || !history.canRedo} />
            </Tooltip>
            <Button type="primary" icon={<SaveOutlined />} onClick={() => void saveElement()} disabled={!draftElement}>
              Save
            </Button>
            <Tooltip title="Delete selected object Del/Backspace">
              <Button icon={<DeleteOutlined />} onClick={() => {
                if (!activeObjectId) {
                  return;
                }
                if (activeObject?.locked) {
                  void message.warning("Locked objects were not deleted.");
                  return;
                }
                updateDraftWithHistory("Delete object", (current) => ({
                  ...current,
                  objects: removeObjectInList(current.objects, activeObjectId),
                }));
                setSelectedObjectIds([]);
                setActiveObjectId(undefined);
              }} disabled={!activeObjectId} />
            </Tooltip>
            <Switch checked={previewMode} onChange={setPreviewMode} checkedChildren="Preview" unCheckedChildren="Edit" />
            <Button onClick={() => addObject("image")} disabled={!draftElement}>Add Image</Button>
            <Button onClick={() => addObject("text")} disabled={!draftElement}>Add Text</Button>
            <Button onClick={() => addObject("line")} disabled={!draftElement}>Add Line</Button>
            <Button onClick={() => addObject("rectangle")} disabled={!draftElement}>Add Rectangle</Button>
            <Button onClick={() => addObject("stateImage")} disabled={!draftElement}>Add StateImage</Button>
            <Typography.Text type={dirty ? "warning" : "secondary"}>{dirty ? "Unsaved changes" : "Saved"}</Typography.Text>
          </Space>
        </Card>
        <Card
          size="small"
          title={draftElement ? `Element Canvas: ${draftElement.name}` : "Element Canvas"}
          className="editor-stage-card"
          bodyStyle={{ padding: 10 }}
        >
          <div
            className="canvas-viewport"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDropAsset}
            style={{ minHeight: 0, overflow: "auto" }}
          >
            {virtualScreen ? (
              <HmiStage
                project={project}
                mode={previewMode ? "runtime" : "editor"}
                screen={virtualScreen}
                tags={previewTags}
                libraries={libraries}
                renderContext={{ tagPrefix: previewTagPrefix || undefined, parameters: previewParameters }}
                selectedObjectIds={selectedObjectIds}
                activeObjectId={activeObjectId}
                selectionRect={selectionRect}
                onSelectionRectChange={(rect) => setSelectionRect(rect)}
                onSelectObject={({ objectId, additive }) => {
                  if (previewMode) {
                    return;
                  }
                  if (additive) {
                    setSelectedObjectIds((prev) =>
                      prev.includes(objectId) ? prev.filter((id) => id !== objectId) : [...prev, objectId],
                    );
                    setActiveObjectId(objectId);
                  } else {
                    setSelectedObjectIds([objectId]);
                    setActiveObjectId(objectId);
                  }
                }}
                onSelectObjects={(ids, active) => {
                  if (previewMode) {
                    return;
                  }
                  setSelectedObjectIds(ids);
                  setActiveObjectId(active);
                }}
                onMoveObject={(id, x, y) => {
                  if (previewMode) {
                    return;
                  }
                  setObjects((objects) => updateObjectInList(objects, id, (item) => ({ ...item, x, y })));
                }}
                onResizeObject={(id, patch) => {
                  if (previewMode) {
                    return;
                  }
                  setObjects((objects) =>
                    updateObjectInList(objects, id, (item) => ({ ...item, ...patch } as HmiObject)),
                  );
                }}
              />
            ) : (
              <Typography.Text type="secondary">Create or open element to start editing</Typography.Text>
            )}
          </div>
        </Card>
      </div>

      <ResizableDockPanel
        id="elementEditor.right"
        side="right"
        hidden={rightPanel.hidden}
        size={clamp(rightPanel.size, 0, 720)}
        lastVisibleSize={rightPanel.lastVisibleSize}
        minSize={280}
        maxSize={720}
        autoHideThreshold={80}
        restoreSize={380}
        workspaceRef={workspaceRef}
        restoreTooltip="Show element properties"
        restoreIcon={<LeftOutlined />}
        onStateChange={(state) => dockLayout.setPanelState("elementEditor.right", () => state)}
      >
        <div className="element-editor-right-panel">
          <Tabs
            size="small"
            style={{ height: "100%" }}
            items={[
            {
              key: "element",
              label: "Element",
              children: draftElement ? (
                <Form layout="vertical" size="small">
                  <Form.Item label="Element ID">
                    <Input value={draftElement.id} onChange={(event) => applyDraftPatch({ id: event.target.value })} />
                  </Form.Item>
                  <Form.Item label="Element Key">
                    <Input value={draftElement.elementKey ?? ""} onChange={(event) => applyDraftPatch({ elementKey: event.target.value })} />
                  </Form.Item>
                  <Form.Item label="Name">
                    <Input value={draftElement.name} onChange={(event) => applyDraftPatch({ name: event.target.value })} />
                  </Form.Item>
                  <Form.Item label="Description">
                    <Input value={draftElement.description ?? ""} onChange={(event) => applyDraftPatch({ description: event.target.value })} />
                  </Form.Item>
                  <Form.Item label="Category">
                    <Input value={draftElement.category ?? ""} onChange={(event) => applyDraftPatch({ category: event.target.value })} />
                  </Form.Item>
                  <Space style={{ width: "100%" }} direction="vertical">
                    <Typography.Text strong>Canvas size</Typography.Text>
                    <Space>
                      <InputNumber min={20} value={draftElement.width} onChange={(value) => applyDraftPatch({ width: Number(value ?? 20) })} />
                      <InputNumber min={20} value={draftElement.height} onChange={(value) => applyDraftPatch({ height: Number(value ?? 20) })} />
                    </Space>
                  </Space>
                  <Divider />
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Typography.Text strong>Parameters</Typography.Text>
                    <Space wrap>
                      <Button
                        size="small"
                        onClick={() => {
                          const next: LibraryParameter = { name: `param_${(draftElement.parameters?.length ?? 0) + 1}`, type: "string", defaultValue: "" };
                          applyDraftPatch({ parameters: [...(draftElement.parameters ?? []), next] });
                        }}
                      >
                        Add Parameter
                      </Button>
                    </Space>
                    <List
                      size="small"
                      dataSource={draftElement.parameters ?? []}
                      renderItem={(param, index) => (
                        <List.Item
                          actions={[
                            <Button
                              key="remove"
                              size="small"
                              danger
                              onClick={() =>
                                applyDraftPatch({
                                  parameters: (draftElement.parameters ?? []).filter((_, i) => i !== index),
                                })
                              }
                            >
                              Del
                            </Button>,
                          ]}
                        >
                          <Space direction="vertical" style={{ width: "100%" }}>
                            <Input
                              value={param.name}
                              placeholder="name"
                              onChange={(event) => {
                                const next = [...(draftElement.parameters ?? [])];
                                const current = next[index];
                                if (!current) {
                                  return;
                                }
                                next[index] = { ...current, name: event.target.value };
                                applyDraftPatch({ parameters: next });
                              }}
                            />
                            <Select
                              value={param.type}
                              options={["string", "number", "boolean", "color", "tag", "tagPrefix", "index"].map((type) => ({
                                label: type,
                                value: type,
                              }))}
                              onChange={(value) => {
                                const next = [...(draftElement.parameters ?? [])];
                                const current = next[index];
                                if (!current) {
                                  return;
                                }
                                next[index] = { ...current, type: value };
                                applyDraftPatch({ parameters: next });
                              }}
                            />
                            <Input
                              value={String(param.defaultValue ?? "")}
                              placeholder="default"
                              onChange={(event) => {
                                const next = [...(draftElement.parameters ?? [])];
                                const current = next[index];
                                if (!current) {
                                  return;
                                }
                                next[index] = { ...current, defaultValue: event.target.value };
                                applyDraftPatch({ parameters: next });
                              }}
                            />
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Space>
                </Form>
              ) : (
                <Typography.Text type="secondary">Select element</Typography.Text>
              ),
            },
            {
              key: "object",
              label: "Object",
              children: virtualScreen ? (
                <ObjectPropertyPanel
                  project={project}
                  screen={virtualScreen}
                  assets={[...assets, ...(selectedLibrary?.assets ?? [])]}
                  libraries={libraries}
                  object={activeObject}
                  onPatch={(patch) => {
                    if (!activeObject) {
                      return;
                    }
                    setObjects((objects) =>
                      updateObjectInList(objects, activeObject.id, (item) => ({ ...item, ...patch } as HmiObject)),
                    );
                  }}
                  onDelete={() => {
                    if (!activeObject) {
                      return;
                    }
                    if (activeObject.locked) {
                      void message.warning("Locked objects were not deleted.");
                      return;
                    }
                    setObjects((objects) => removeObjectInList(objects, activeObject.id));
                    setSelectedObjectIds([]);
                    setActiveObjectId(undefined);
                  }}
                />
              ) : (
                <Typography.Text type="secondary">No object selected</Typography.Text>
              ),
            },
            {
              key: "assets",
              label: "Assets",
              children: (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Typography.Text type="secondary">Drag asset to canvas or click Add</Typography.Text>
                  <List
                    size="small"
                    dataSource={selectedLibrary?.assets ?? []}
                    renderItem={(asset) => (
                      <List.Item
                        draggable
                        onDragStart={(event) =>
                          event.dataTransfer.setData("application/web-scada-asset", JSON.stringify({ assetId: asset.id }))
                        }
                        actions={[
                          <Button key="add" size="small" onClick={() => addImageFromAsset(asset.id)}>
                            Add
                          </Button>,
                        ]}
                      >
                        <Space direction="vertical" size={0}>
                          <Typography.Text>{asset.name}</Typography.Text>
                          <Typography.Text type="secondary">{asset.fileName}</Typography.Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                </Space>
              ),
            },
            {
              key: "stateRules",
              label: "State Rules",
              children: draftElement ? (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Typography.Text type="secondary">
                    JSON rules. Source tag supports relative values like <code>.State</code>.
                  </Typography.Text>
                  <Input.TextArea rows={12} value={stateRulesJson} onChange={(event) => setStateRulesJson(event.target.value)} />
                  <Button
                    onClick={() => {
                      try {
                        const parsed = JSON.parse(stateRulesJson) as NonNullable<LibraryElement["stateRules"]>;
                        applyDraftPatch({ stateRules: parsed });
                        void message.success("State rules applied to draft");
                      } catch {
                        void message.error("Invalid state rules JSON");
                      }
                    }}
                  >
                    Apply Rules
                  </Button>
                </Space>
              ) : (
                <Typography.Text type="secondary">Select element</Typography.Text>
              ),
            },
            {
              key: "preview",
              label: "Preview",
              children: draftElement ? (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Typography.Text strong>Preview values</Typography.Text>
                  <Input value={previewStateTag} onChange={(event) => setPreviewStateTag(event.target.value)} placeholder="State tag (.State)" />
                  <Input value={previewStateValue} onChange={(event) => setPreviewStateValue(event.target.value)} placeholder="State value" />
                  <Divider style={{ margin: "8px 0" }} />
                  {(draftElement.parameters ?? []).map((param) => (
                    <Form.Item key={param.name} label={param.displayName || param.name} style={{ marginBottom: 8 }}>
                      <Input
                        value={previewValues[param.name] ?? ""}
                        onChange={(event) =>
                          setPreviewValues((prev) => ({ ...prev, [param.name]: event.target.value }))
                        }
                      />
                    </Form.Item>
                  ))}
                </Space>
              ) : (
                <Typography.Text type="secondary">Select element</Typography.Text>
              ),
            },
            ]}
          />
        </div>
      </ResizableDockPanel>
    </div>
  );
}
