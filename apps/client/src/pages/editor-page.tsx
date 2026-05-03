import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import type {
  Asset,
  EditorCommand,
  HmiObject,
  InternalVariableDefinition,
  LibraryElement,
  ProjectLibraryRef,
  ScreenKind,
} from "@web-scada/shared";
import {
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Typography,
  message,
} from "antd";
import { api } from "../services/api";
import { ObjectPropertyPanel } from "../components/object-property-panel";
import { createObjectByType } from "../hmi/editor/default-object-factory";
import { HmiStage } from "../hmi/runtime/hmi-stage";
import { useScadaStore } from "../store/scada-store";

const basicToolboxTypes: HmiObject["type"][] = [
  "text",
  "line",
  "rectangle",
  "value-display",
  "value-input",
  "state-indicator",
  "button",
  "switch",
  "image",
  "frame",
];

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function EditorPage() {
  const navigate = useNavigate();
  const project = useScadaStore((s) => s.project);
  const tags = useScadaStore((s) => s.tags);
  const assets = useScadaStore((s) => s.assets);
  const libraries = useScadaStore((s) => s.libraries);
  const currentScreenId = useScadaStore((s) => s.currentScreenId);
  const selection = useScadaStore((s) => s.selection);
  const setCurrentScreen = useScadaStore((s) => s.setCurrentScreen);
  const setSelectedObjects = useScadaStore((s) => s.setSelectedObjects);
  const toggleSelectedObject = useScadaStore((s) => s.toggleSelectedObject);
  const setSelectionRect = useScadaStore((s) => s.setSelectionRect);
  const executeCommand = useScadaStore((s) => s.executeCommand);
  const moveObject = useScadaStore((s) => s.moveObject);
  const resizeObject = useScadaStore((s) => s.resizeObject);
  const updateObject = useScadaStore((s) => s.updateObject);
  const removeObject = useScadaStore((s) => s.removeObject);
  const removeSelectedUnlocked = useScadaStore((s) => s.removeSelectedUnlocked);
  const addObject = useScadaStore((s) => s.addObject);
  const addScreen = useScadaStore((s) => s.addScreen);
  const updateScreen = useScadaStore((s) => s.updateScreen);
  const addVariable = useScadaStore((s) => s.addVariable);
  const saveProject = useScadaStore((s) => s.saveProject);
  const loadProject = useScadaStore((s) => s.loadProject);
  const loadAssets = useScadaStore((s) => s.loadAssets);
  const loadLibraries = useScadaStore((s) => s.loadLibraries);
  const updateProjectJson = useScadaStore((s) => s.updateProjectJson);

  const [newVarName, setNewVarName] = useState("Counter1");
  const [newVarType, setNewVarType] = useState<InternalVariableDefinition["dataType"]>("REAL");
  const [newScreenKind, setNewScreenKind] = useState<ScreenKind>("screen");
  const [newLibraryId, setNewLibraryId] = useState("custom-equipment");
  const [newLibraryName, setNewLibraryName] = useState("Пользовательская библиотека");
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveTargetLibraryId, setSaveTargetLibraryId] = useState("");
  const [saveElementName, setSaveElementName] = useState("Новый элемент");
  const [saveElementDescription, setSaveElementDescription] = useState("");
  const [saveElementCategory, setSaveElementCategory] = useState("General");
  const [assetUploadName, setAssetUploadName] = useState("");
  const [spacingGap, setSpacingGap] = useState<number | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const panelDropRef = useRef<HTMLDivElement | null>(null);

  const screen = useMemo(
    () => project?.screens.find((s) => s.id === currentScreenId) ?? project?.screens[0],
    [currentScreenId, project],
  );

  const selectedObjects = useMemo(
    () => screen?.objects.filter((obj) => selection.selectedObjectIds.includes(obj.id)) ?? [],
    [screen?.objects, selection.selectedObjectIds],
  );
  const selectedUnlocked = selectedObjects.filter((obj) => !obj.locked);
  const selectedGroups = selectedObjects.filter((obj) => obj.type === "group");
  const activeObject =
    (selection.activeObjectId ? selectedObjects.find((obj) => obj.id === selection.activeObjectId) : undefined) ??
    selectedObjects[0] ??
    null;

  const enabledLibraryRefs = useMemo(
    () => (project?.libraries ?? []).filter((ref) => ref.enabled),
    [project?.libraries],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!screen) {
        return;
      }
      if (event.key === "Delete") {
        event.preventDefault();
        removeSelectedUnlocked(screen.id);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      if (event.key.toLowerCase() === "g" && event.shiftKey) {
        event.preventDefault();
        runCommand({ type: "ungroupSelected" });
        return;
      }
      if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        runCommand({ type: "groupSelected" });
        return;
      }
      if (event.key.toLowerCase() === "l" && event.shiftKey) {
        event.preventDefault();
        runCommand({ type: "unlockSelected" });
        return;
      }
      if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        runCommand({ type: "lockSelected" });
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screen?.id, selectedObjects.length]);

  if (!project || !screen) {
    return <Typography.Text>Project is not loaded</Typography.Text>;
  }

  const runCommand = (command: EditorCommand): void => {
    const warnings = executeCommand(command);
    if (warnings.length) {
      void message.warning(warnings.join("; "));
    }
    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  const onUploadProjectAsset = async (file: File): Promise<void> => {
    try {
      await api.uploadAsset(file, assetUploadName || file.name);
      setAssetUploadName("");
      await Promise.all([loadAssets(), loadProject()]);
      void message.success("Asset загружен");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Ошибка загрузки asset");
    }
  };

  const addAssetAsImage = (asset: Asset, x = 100, y = 100): void => {
    const object = createObjectByType("image") as Extract<HmiObject, { type: "image" }>;
    addObject(screen.id, {
      ...object,
      x,
      y,
      assetId: asset.id,
      src: undefined,
      fit: "contain",
      preserveAspectRatio: true,
      opacity: 1,
    });
  };

  const addLibraryElementInstance = (libraryId: string, element: LibraryElement, x = 120, y = 120): void => {
    addObject(screen.id, {
      id: id("lib"),
      type: "libraryElementInstance",
      x,
      y,
      width: element.width,
      height: element.height,
      minWidth: 40,
      minHeight: 30,
      libraryId,
      elementId: element.id,
      tagPrefix: "",
      parameterValues: {},
      scaleMode: "fit",
    });
  };

  const attachLibrary = async (libraryId: string): Promise<void> => {
    try {
      const nextProject = await api.attachLibrary(libraryId);
      updateProjectJson(nextProject);
      await loadLibraries();
      void message.success("Библиотека подключена");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Не удалось подключить библиотеку");
    }
  };

  const detachLibrary = async (libraryId: string): Promise<void> => {
    try {
      const nextProject = await api.detachLibrary(libraryId);
      updateProjectJson(nextProject);
      await loadLibraries();
      void message.success("Библиотека отключена");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Не удалось отключить библиотеку");
    }
  };

  const createLibrary = async (): Promise<void> => {
    try {
      const created = await api.createLibrary({ id: newLibraryId, name: newLibraryName });
      const nextProject = await api.attachLibrary(created.id);
      updateProjectJson(nextProject);
      await loadLibraries();
      void message.success("Библиотека создана");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Не удалось создать библиотеку");
    }
  };

  const onSaveSelectionAsLibraryElement = async (): Promise<void> => {
    const targetLibrary = libraries.find((item) => item.id === saveTargetLibraryId);
    if (!targetLibrary) {
      void message.error("Выберите библиотеку");
      return;
    }

    const picked = selectionIds.length
      ? screen.objects.filter((obj) => selectionIds.includes(obj.id))
      : selectedObjects;
    if (!picked.length) {
      void message.error("Нужно выбрать хотя бы один объект");
      return;
    }

    try {
      const copied = await copySelectionAssetsToLibrary(picked, assets, targetLibrary.id);
      const normalized = normalizeObjects(copied);
      const bounds = computeBounds(normalized);
      const now = new Date().toISOString();
      const element: LibraryElement = {
        id: slugify(saveElementName),
        name: saveElementName,
        description: saveElementDescription || undefined,
        category: saveElementCategory || undefined,
        width: bounds.width,
        height: bounds.height,
        objects: normalized,
        parameters: [],
        createdAt: now,
        updatedAt: now,
      };
      await api.createLibraryElement(targetLibrary.id, element);
      await loadLibraries();
      setSaveModalOpen(false);
      void message.success("Элемент сохранен в библиотеку");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Ошибка сохранения в библиотеку");
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const data = event.dataTransfer.getData("application/web-scada-item");
    if (!data) {
      return;
    }
    const rect = panelDropRef.current?.getBoundingClientRect();
    const x = rect ? Math.max(0, event.clientX - rect.left) : 120;
    const y = rect ? Math.max(0, event.clientY - rect.top) : 120;
    try {
      const payload = JSON.parse(data) as
        | { kind: "asset"; assetId: string }
        | { kind: "library-element"; libraryId: string; elementId: string };
      if (payload.kind === "asset") {
        const asset = assets.find((item) => item.id === payload.assetId);
        if (asset) {
          addAssetAsImage(asset, x, y);
        }
        return;
      }
      const library = libraries.find((item) => item.id === payload.libraryId);
      const element = library?.elements.find((item) => item.id === payload.elementId);
      if (library && element) {
        addLibraryElementInstance(library.id, element, x, y);
      }
    } catch {
      // ignore malformed drag payload
    }
  };

  const canGroup = selectedUnlocked.length >= 2;
  const canUngroup = selectedGroups.some((item) => !item.locked);
  const canAlign = selectedUnlocked.length >= 2;
  const canDistribute = selectedUnlocked.length >= 3;
  const canSameSize = selectedUnlocked.length >= 2;
  const canLock = selectedObjects.length > 0;
  const canUnlock = selectedObjects.some((item) => item.locked);

  return (
    <>
      <Row gutter={12}>
        <Col span={6}>
          <Card
            title="Screens"
            size="small"
            extra={
              <Space>
                <Select
                  size="small"
                  value={newScreenKind}
                  style={{ width: 100 }}
                  onChange={(value) => setNewScreenKind(value)}
                  options={[
                    { label: "Screen", value: "screen" },
                    { label: "Popup", value: "popup" },
                    { label: "Template", value: "template" },
                  ]}
                />
                <Button size="small" onClick={() => addScreen(newScreenKind)}>
                  Add
                </Button>
              </Space>
            }
          >
            <List
              size="small"
              dataSource={project.screens}
              renderItem={(item) => (
                <List.Item
                  onClick={() => setCurrentScreen(item.id)}
                  style={{ cursor: "pointer", fontWeight: item.id === screen.id ? 700 : 400 }}
                >
                  {`${item.name} (${item.kind})`}
                </List.Item>
              )}
            />
          </Card>

          <Card title="Current Screen" size="small" style={{ marginTop: 12 }}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input value={screen.name} onChange={(e) => updateScreen(screen.id, { name: e.target.value })} />
              <InputNumber style={{ width: "100%" }} value={screen.width} onChange={(value) => updateScreen(screen.id, { width: Number(value ?? 320) })} />
              <InputNumber style={{ width: "100%" }} value={screen.height} onChange={(value) => updateScreen(screen.id, { height: Number(value ?? 200) })} />
              <Input placeholder="background" value={screen.background ?? ""} onChange={(e) => updateScreen(screen.id, { background: e.target.value })} />
            </Space>
          </Card>

          <Card title="Toolbox (Basic)" size="small" style={{ marginTop: 12 }}>
            <Space wrap>
              {basicToolboxTypes.map((type) => (
                <Button key={type} size="small" onClick={() => addObject(screen.id, createObjectByType(type))}>
                  {type}
                </Button>
              ))}
            </Space>
          </Card>

          <Card title="Assets" size="small" style={{ marginTop: 12 }}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input value={assetUploadName} onChange={(e) => setAssetUploadName(e.target.value)} placeholder="Имя asset (опционально)" />
              <Space>
                <Button onClick={() => uploadInputRef.current?.click()}>Upload PNG/JPG/SVG</Button>
                <Button onClick={() => void loadAssets()}>Refresh</Button>
              </Space>
              <input
                ref={uploadInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) {
                    void onUploadProjectAsset(file);
                  }
                }}
              />
              <List
                size="small"
                dataSource={assets}
                renderItem={(asset) => (
                  <List.Item
                    style={{ cursor: "grab" }}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        "application/web-scada-item",
                        JSON.stringify({ kind: "asset", assetId: asset.id }),
                      );
                    }}
                    actions={[<Button size="small" onClick={() => addAssetAsImage(asset)}>Add</Button>]}
                  >
                    <Space>
                      <img src={asset.previewUrl} alt={asset.name} style={{ width: 30, height: 30, objectFit: "contain", background: "#111" }} />
                      <span>{asset.name}</span>
                    </Space>
                  </List.Item>
                )}
              />
            </Space>
          </Card>
        </Col>

        <Col span={12}>
          <Card
            size="small"
            title={`Editor: ${screen.name}`}
            extra={
              <Space>
                <Button onClick={() => void saveProject()} type="primary">
                  Save
                </Button>
                <Button onClick={() => navigate("/runtime")}>Run Preview</Button>
              </Space>
            }
          >
            <Space wrap style={{ marginBottom: 10 }}>
              <Button onClick={() => runCommand({ type: "groupSelected" })} disabled={!canGroup}>
                Group
              </Button>
              <Button onClick={() => runCommand({ type: "ungroupSelected" })} disabled={!canUngroup}>
                Ungroup
              </Button>
              <Button onClick={() => runCommand({ type: "lockSelected" })} disabled={!canLock}>
                Lock
              </Button>
              <Button onClick={() => runCommand({ type: "unlockSelected" })} disabled={!canUnlock}>
                Unlock
              </Button>
              <Button onClick={() => runCommand({ type: "alignLeft" })} disabled={!canAlign}>
                Align Left
              </Button>
              <Button onClick={() => runCommand({ type: "alignHorizontalCenter" })} disabled={!canAlign}>
                Align H-Center
              </Button>
              <Button onClick={() => runCommand({ type: "alignRight" })} disabled={!canAlign}>
                Align Right
              </Button>
              <Button onClick={() => runCommand({ type: "alignTop" })} disabled={!canAlign}>
                Align Top
              </Button>
              <Button onClick={() => runCommand({ type: "alignVerticalCenter" })} disabled={!canAlign}>
                Align V-Center
              </Button>
              <Button onClick={() => runCommand({ type: "alignBottom" })} disabled={!canAlign}>
                Align Bottom
              </Button>
              <Button onClick={() => runCommand({ type: "makeSameWidth" })} disabled={!canSameSize}>
                Same Width
              </Button>
              <Button onClick={() => runCommand({ type: "makeSameHeight" })} disabled={!canSameSize}>
                Same Height
              </Button>
              <Button onClick={() => runCommand({ type: "makeSameSize" })} disabled={!canSameSize}>
                Same Size
              </Button>
              <Button onClick={() => runCommand({ type: "distributeHorizontally" })} disabled={!canDistribute}>
                Distribute H
              </Button>
              <Button onClick={() => runCommand({ type: "distributeVertically" })} disabled={!canDistribute}>
                Distribute V
              </Button>
              <InputNumber
                placeholder="Gap"
                value={spacingGap}
                onChange={(value) => setSpacingGap(value === null ? undefined : Number(value))}
                style={{ width: 90 }}
              />
              <Button
                onClick={() => runCommand({ type: "spaceEvenlyHorizontally", options: { gap: spacingGap } })}
                disabled={!canDistribute}
              >
                Space H
              </Button>
              <Button
                onClick={() => runCommand({ type: "spaceEvenlyVertically", options: { gap: spacingGap } })}
                disabled={!canDistribute}
              >
                Space V
              </Button>
            </Space>

            <div
              ref={panelDropRef}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({
                  visible: true,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <HmiStage
                project={project}
                mode="editor"
                screen={screen}
                tags={tags}
                libraries={libraries}
                selectedObjectIds={selection.selectedObjectIds}
                activeObjectId={selection.activeObjectId}
                selectionRect={selection.selectionRect}
                onSelectionRectChange={(rect) => setSelectionRect(rect)}
                onSelectObject={({ objectId, additive }) => {
                  if (additive) {
                    toggleSelectedObject(objectId);
                  } else {
                    setSelectedObjects([objectId], objectId);
                  }
                }}
                onSelectObjects={(objectIds, activeId) => {
                  setSelectedObjects(objectIds, activeId);
                }}
                onMoveObject={(id, x, y) => moveObject(screen.id, id, x, y)}
                onResizeObject={(id, patch) => resizeObject(screen.id, id, patch)}
              />
            </div>
          </Card>

          <Card title="Selection -> Library Element" size="small" style={{ marginTop: 12 }}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <List
                size="small"
                dataSource={screen.objects}
                renderItem={(item) => (
                  <List.Item>
                    <Checkbox
                      checked={selectionIds.includes(item.id)}
                      onChange={(event) => {
                        setSelectionIds((prev) =>
                          event.target.checked ? [...prev, item.id] : prev.filter((idValue) => idValue !== item.id),
                        );
                      }}
                    >
                      {item.id} ({item.type})
                    </Checkbox>
                  </List.Item>
                )}
              />
              <Button type="primary" onClick={() => setSaveModalOpen(true)}>
                Save Selection As Library Element
              </Button>
            </Space>
          </Card>
        </Col>

        <Col span={6}>
          <Card title="Libraries" size="small">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input value={newLibraryId} onChange={(e) => setNewLibraryId(e.target.value)} placeholder="library id" />
              <Input value={newLibraryName} onChange={(e) => setNewLibraryName(e.target.value)} placeholder="library name" />
              <Space>
                <Button onClick={() => void createLibrary()}>Create</Button>
                <Button onClick={() => void loadLibraries()}>Refresh</Button>
              </Space>

              <Divider style={{ margin: "8px 0" }} />
              <Typography.Text strong>Available Libraries</Typography.Text>
              <List
                size="small"
                dataSource={libraries}
                renderItem={(library) => {
                  const attached = (project.libraries ?? []).some((item) => item.libraryId === library.id && item.enabled);
                  return (
                    <List.Item
                      actions={[
                        attached ? (
                          <Typography.Text type="secondary">attached</Typography.Text>
                        ) : (
                          <Button size="small" onClick={() => void attachLibrary(library.id)}>Attach</Button>
                        ),
                      ]}
                    >
                      {library.name}
                    </List.Item>
                  );
                }}
              />

              <Divider style={{ margin: "8px 0" }} />
              <Typography.Text strong>Project Libraries</Typography.Text>
              <List
                size="small"
                dataSource={project.libraries ?? []}
                renderItem={(ref: ProjectLibraryRef) => (
                  <List.Item
                    actions={[
                      ref.enabled ? (
                        <Button size="small" onClick={() => void detachLibrary(ref.libraryId)}>Detach</Button>
                      ) : (
                        <Button size="small" type="primary" onClick={() => void attachLibrary(ref.libraryId)}>Attach</Button>
                      ),
                    ]}
                  >
                    {ref.name}
                  </List.Item>
                )}
              />

              <Divider style={{ margin: "8px 0" }} />
              <Typography.Text strong>Library Elements</Typography.Text>
              {enabledLibraryRefs.map((ref) => {
                const library = libraries.find((item) => item.id === ref.libraryId);
                if (!library) {
                  return (
                    <Card key={ref.libraryId} size="small" title={ref.name} style={{ marginBottom: 8 }}>
                      <Typography.Text type="danger">Library not found</Typography.Text>
                    </Card>
                  );
                }
                return (
                  <Card key={library.id} size="small" title={library.name} style={{ marginBottom: 8 }}>
                    <List
                      size="small"
                      dataSource={library.elements}
                      renderItem={(element) => (
                        <List.Item
                          style={{ cursor: "grab" }}
                          draggable
                          onDragStart={(event) =>
                            event.dataTransfer.setData(
                              "application/web-scada-item",
                              JSON.stringify({ kind: "library-element", libraryId: library.id, elementId: element.id }),
                            )
                          }
                          actions={[<Button size="small" onClick={() => addLibraryElementInstance(library.id, element)}>Add</Button>]}
                        >
                          {element.name}
                        </List.Item>
                      )}
                    />
                  </Card>
                );
              })}
            </Space>
          </Card>

          <Card title="Internal Variables (LW)" size="small" style={{ marginTop: 12 }}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input value={newVarName} onChange={(e) => setNewVarName(e.target.value)} placeholder="Variable name" />
              <Select
                value={newVarType}
                onChange={(v) => setNewVarType(v)}
                options={["BOOL", "INT", "DINT", "REAL", "STRING"].map((item) => ({ label: item, value: item }))}
              />
              <Button
                onClick={() => {
                  if (!newVarName.trim()) {
                    return;
                  }
                  addVariable(newVarName.trim(), newVarType, newVarType === "BOOL" ? false : 0);
                }}
              >
                Add LW Variable
              </Button>
              <List
                size="small"
                dataSource={project.variables ?? []}
                renderItem={(item) => <List.Item>{`LW.${item.name} (${item.dataType})`}</List.Item>}
              />
            </Space>
          </Card>

          <Card title="Properties" size="small" style={{ marginTop: 12 }}>
            {selectedObjects.length > 1 ? (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Typography.Text>{`Выбрано объектов: ${selectedObjects.length}`}</Typography.Text>
                <Typography.Text type="secondary">
                  {`Unlocked: ${selectedUnlocked.length}, Locked: ${selectedObjects.length - selectedUnlocked.length}`}
                </Typography.Text>
                <Space wrap>
                  <Button size="small" onClick={() => runCommand({ type: "lockSelected" })} disabled={!canLock}>
                    Lock
                  </Button>
                  <Button size="small" onClick={() => runCommand({ type: "unlockSelected" })} disabled={!canUnlock}>
                    Unlock
                  </Button>
                  <Button size="small" danger onClick={() => removeSelectedUnlocked(screen.id)}>
                    Delete unlocked
                  </Button>
                </Space>
              </Space>
            ) : null}

            <Divider style={{ margin: "10px 0" }} />
            <ObjectPropertyPanel
              project={project}
              screen={screen}
              assets={assets}
              libraries={libraries}
              object={activeObject}
              onPatch={(patch) => {
                if (!activeObject) {
                  return;
                }
                updateObject(screen.id, activeObject.id, patch);
              }}
              onDelete={() => {
                if (!activeObject) {
                  return;
                }
                if (activeObject.locked) {
                  void message.warning("Locked object cannot be deleted");
                  return;
                }
                removeObject(screen.id, activeObject.id);
              }}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        title="Save As Library Element"
        open={saveModalOpen}
        onCancel={() => setSaveModalOpen(false)}
        onOk={() => void onSaveSelectionAsLibraryElement()}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select
            value={saveTargetLibraryId}
            onChange={setSaveTargetLibraryId}
            placeholder="Библиотека"
            options={libraries.map((item) => ({ label: item.name, value: item.id }))}
          />
          <Input value={saveElementName} onChange={(e) => setSaveElementName(e.target.value)} placeholder="Имя элемента" />
          <Input value={saveElementDescription} onChange={(e) => setSaveElementDescription(e.target.value)} placeholder="Описание" />
          <Input value={saveElementCategory} onChange={(e) => setSaveElementCategory(e.target.value)} placeholder="Категория" />
        </Space>
      </Modal>

      {contextMenu.visible ? (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 2000,
            background: "#ffffff",
            border: "1px solid #d9d9d9",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            padding: 8,
          }}
          onMouseLeave={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
        >
          <Space direction="vertical">
            <Button size="small" onClick={() => runCommand({ type: "groupSelected" })} disabled={!canGroup}>Group</Button>
            <Button size="small" onClick={() => runCommand({ type: "ungroupSelected" })} disabled={!canUngroup}>Ungroup</Button>
            <Button size="small" onClick={() => runCommand({ type: "lockSelected" })} disabled={!canLock}>Lock</Button>
            <Button size="small" onClick={() => runCommand({ type: "unlockSelected" })} disabled={!canUnlock}>Unlock</Button>
            <Button size="small" onClick={() => runCommand({ type: "alignLeft" })} disabled={!canAlign}>Align Left</Button>
            <Button size="small" onClick={() => runCommand({ type: "makeSameSize" })} disabled={!canSameSize}>Same Size</Button>
            <Button size="small" onClick={() => runCommand({ type: "distributeHorizontally" })} disabled={!canDistribute}>Distribute H</Button>
          </Space>
        </div>
      ) : null}
    </>
  );
}

async function copySelectionAssetsToLibrary(
  objects: HmiObject[],
  projectAssets: Asset[],
  libraryId: string,
): Promise<HmiObject[]> {
  const assetIds = [...new Set(objects.flatMap((obj) => collectAssetIds(obj)))];
  if (!assetIds.length) {
    return objects;
  }

  const mappedIds = new Map<string, string>();
  for (const assetId of assetIds) {
    const asset = projectAssets.find((item) => item.id === assetId);
    if (!asset) {
      continue;
    }
    const fileResponse = await fetch(asset.previewUrl);
    const blob = await fileResponse.blob();
    const file = new File([blob], asset.fileName, { type: asset.mimeType });
    const uploaded = await api.uploadLibraryAsset(libraryId, file, asset.name);
    mappedIds.set(assetId, uploaded.id);
  }

  return objects.map((obj) => replaceAssetIds(obj, mappedIds));
}

function replaceAssetIds(object: HmiObject, mappedIds: Map<string, string>): HmiObject {
  if (object.type !== "image") {
    return object;
  }
  return {
    ...object,
    assetId: object.assetId ? mappedIds.get(object.assetId) ?? object.assetId : undefined,
    stateImages: object.stateImages?.map((state) => ({
      ...state,
      assetId: state.assetId ? mappedIds.get(state.assetId) ?? state.assetId : undefined,
    })),
  };
}

function collectAssetIds(object: HmiObject): string[] {
  if (object.type !== "image") {
    return [];
  }
  const ids: string[] = [];
  if (object.assetId) {
    ids.push(object.assetId);
  }
  for (const state of object.stateImages ?? []) {
    if (state.assetId) {
      ids.push(state.assetId);
    }
  }
  return ids;
}

function computeBounds(objects: HmiObject[]): { minX: number; minY: number; width: number; height: number } {
  const minX = Math.min(...objects.map((obj) => obj.x));
  const minY = Math.min(...objects.map((obj) => obj.y));
  const maxX = Math.max(...objects.map((obj) => obj.x + obj.width));
  const maxY = Math.max(...objects.map((obj) => obj.y + obj.height));
  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function normalizeObjects(objects: HmiObject[]): HmiObject[] {
  const bounds = computeBounds(objects);
  return objects.map((obj) => ({
    ...obj,
    id: id(obj.type.replace(/[^a-z0-9]/gi, "_")),
    x: obj.x - bounds.minX,
    y: obj.y - bounds.minY,
  }));
}

function slugify(input: string): string {
  const clean = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || `element-${Math.random().toString(36).slice(2, 8)}`;
}
