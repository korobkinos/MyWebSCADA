import { useMemo, type ReactNode } from "react";
import type { HmiObject, HmiScreen, RuntimeAction } from "@web-scada/shared";

type SearchString = {
  path: string;
  value: string;
};

type ScreenEditorSearchWindowProps = {
  screens: HmiScreen[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelectScreen: (screenId: string) => void;
  onSelectObject: (screenId: string, objectId: string) => void;
};

type ObjectHit = {
  key: string;
  screenId: string;
  screenName: string;
  objectId: string;
  objectName: string;
  objectType: string;
};

type TagBindingHit = ObjectHit & {
  fieldPath: string;
  fieldValue: string;
};

export function ScreenEditorSearchWindow({
  screens,
  query,
  onQueryChange,
  onSelectScreen,
  onSelectObject,
}: ScreenEditorSearchWindowProps) {
  const normalizedQuery = query.trim().toLowerCase();

  const screenHits = useMemo(
    () =>
      normalizedQuery
        ? screens.filter((screen) => {
            const values = [screen.name, screen.id, screen.kind];
            return values.some((value) => value.toLowerCase().includes(normalizedQuery));
          })
        : [],
    [normalizedQuery, screens],
  );

  const objectHits = useMemo<ObjectHit[]>(() => {
    if (!normalizedQuery) {
      return [];
    }
    const hits: ObjectHit[] = [];
    for (const screen of screens) {
      for (const object of flattenObjects(screen.objects)) {
        const searchable = [
          object.name ?? "",
          object.id,
          object.type,
          object.type === "libraryElementInstance" ? object.libraryId : "",
          object.type === "libraryElementInstance" ? object.elementId : "",
        ]
          .join(" ")
          .toLowerCase();

        if (searchable.includes(normalizedQuery)) {
          hits.push({
            key: `${screen.id}:${object.id}`,
            screenId: screen.id,
            screenName: screen.name,
            objectId: object.id,
            objectName: object.name?.trim() || object.id,
            objectType: object.type,
          });
        }
      }
    }
    return hits;
  }, [normalizedQuery, screens]);

  const tagBindingHits = useMemo<TagBindingHit[]>(() => {
    if (!normalizedQuery) {
      return [];
    }
    const hits: TagBindingHit[] = [];

    for (const screen of screens) {
      for (const object of flattenObjects(screen.objects)) {
        const fields = collectSearchStrings(object);
        for (const field of fields) {
          if (field.value.toLowerCase().includes(normalizedQuery)) {
            hits.push({
              key: `${screen.id}:${object.id}:${field.path}:${field.value}`,
              screenId: screen.id,
              screenName: screen.name,
              objectId: object.id,
              objectName: object.name?.trim() || object.id,
              objectType: object.type,
              fieldPath: field.path,
              fieldValue: field.value,
            });
          }
        }
      }
    }

    return hits;
  }, [normalizedQuery, screens]);

  return (
    <div className="screen-editor-window-content">
      <div style={{ padding: "8px" }}>
        <input
          className="workbench-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search screens, objects, tags, bindings"
        />
      </div>

      {!normalizedQuery ? (
        <div className="screen-editor-empty-state" style={{ paddingTop: 2 }}>
          Enter query to search screens, objects, tags and bindings
        </div>
      ) : (
        <>
          <SearchGroup title={`Screens (${screenHits.length})`}>
            {screenHits.map((screen) => (
              <button
                key={screen.id}
                type="button"
                className="screen-editor-search-result"
                onClick={() => onSelectScreen(screen.id)}
              >
                <div>{screen.name}</div>
                <div className="screen-editor-item-meta">{screen.kind} | {screen.id}</div>
              </button>
            ))}
          </SearchGroup>

          <SearchGroup title={`Objects (${objectHits.length})`}>
            {objectHits.map((hit) => (
              <button
                key={hit.key}
                type="button"
                className="screen-editor-search-result"
                onClick={() => onSelectObject(hit.screenId, hit.objectId)}
              >
                <div>{hit.objectName}</div>
                <div className="screen-editor-item-meta">
                  {hit.screenName} | {hit.objectType} | {hit.objectId}
                </div>
              </button>
            ))}
          </SearchGroup>

          <SearchGroup title={`Tags / Bindings (${tagBindingHits.length})`}>
            {tagBindingHits.map((hit) => (
              <button
                key={hit.key}
                type="button"
                className="screen-editor-search-result"
                onClick={() => onSelectObject(hit.screenId, hit.objectId)}
              >
                <div>{hit.objectName}</div>
                <div className="screen-editor-item-meta">
                  {hit.screenName} | {hit.objectType} | {hit.objectId}
                </div>
                <div className="screen-editor-item-meta">
                  {hit.fieldPath}: {hit.fieldValue}
                </div>
              </button>
            ))}
          </SearchGroup>
        </>
      )}
    </div>
  );
}

type SearchGroupProps = {
  title: string;
  children: ReactNode;
};

function SearchGroup({ title, children }: SearchGroupProps) {
  return (
    <div>
      <div className="workbench-section__header">
        <span className="workbench-section__title">{title}</span>
      </div>
      <div className="screen-editor-search-results">{children}</div>
    </div>
  );
}

function flattenObjects(objects: HmiObject[]): HmiObject[] {
  const result: HmiObject[] = [];
  for (const object of objects) {
    result.push(object);
    if (object.type === "group") {
      result.push(...flattenObjects(object.objects));
    }
  }
  return result;
}

function collectSearchStrings(object: HmiObject): SearchString[] {
  const result: SearchString[] = [];

  const visit = (value: unknown, path: string) => {
    if (typeof value === "string") {
      if (isSearchPath(path)) {
        result.push({ path, value });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      visit(entry, path ? `${path}.${key}` : key);
    }
  };

  visit(object, object.type);

  if (object.type === "button" || object.type === "image" || object.type === "stateImage" || object.type === "libraryElementInstance") {
    collectActionStrings(object.action, `${object.type}.action`, result);
  }
  if (object.type === "button") {
    for (const step of object.actions ?? []) {
      collectActionStrings(step.action, `${object.type}.actions.${step.id}.action`, result);
    }
  }

  return result;
}

function collectActionStrings(action: RuntimeAction | undefined, path: string, result: SearchString[]) {
  if (!action) {
    return;
  }

  for (const [key, value] of Object.entries(action as Record<string, unknown>)) {
    if (typeof value === "string" && isSearchPath(`${path}.${key}`)) {
      result.push({ path: `${path}.${key}`, value });
    }
  }
}

function isSearchPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized.includes("tag") || normalized.includes("binding") || normalized.includes("library") || normalized.includes("element") || normalized.includes("action");
}
