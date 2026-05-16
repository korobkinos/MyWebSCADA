import type { ElementLibrary, HmiObject } from "@web-scada/shared";

export type LibraryOriginContext =
  | {
      kind: "instanceRoot";
      libraryId: string;
      libraryName: string;
      elementId: string;
      elementName: string;
      instanceId: string;
      instanceName?: string;
      missing?: boolean;
    }
  | {
      kind: "instanceChild";
      libraryId: string;
      libraryName: string;
      elementId: string;
      elementName: string;
      instanceId: string;
      instanceName?: string;
      childId: string;
      childName?: string;
      childType: string;
      childPath: string;
      missing?: boolean;
    }
  | null;

export function resolveLibraryMeta(libraryId: string, elementId: string, libraries: ElementLibrary[]) {
  const library = libraries.find((item) => item.id === libraryId);
  const element = library?.elements.find((item) => item.id === elementId);
  return {
    libraryName: library?.name ?? libraryId,
    elementName: element?.name ?? elementId,
    missing: !library || !element,
  };
}

export function findLibraryOriginForObject(
  objects: HmiObject[],
  targetObjectId: string,
  libraries: ElementLibrary[],
  currentInstanceContext?: {
    instanceId: string;
    instanceName?: string;
    libraryId: string;
    elementId: string;
  },
  currentPath: string = "",
): LibraryOriginContext {
  for (const obj of objects) {
    if (obj.id === targetObjectId) {
      if (currentInstanceContext) {
        if (obj.id === currentInstanceContext.instanceId) {
          const meta = resolveLibraryMeta(
            currentInstanceContext.libraryId,
            currentInstanceContext.elementId,
            libraries,
          );
          return {
            kind: "instanceRoot",
            libraryId: currentInstanceContext.libraryId,
            libraryName: meta.libraryName,
            elementId: currentInstanceContext.elementId,
            elementName: meta.elementName,
            instanceId: currentInstanceContext.instanceId,
            instanceName: currentInstanceContext.instanceName,
            missing: meta.missing,
          };
        } else {
          const meta = resolveLibraryMeta(
            currentInstanceContext.libraryId,
            currentInstanceContext.elementId,
            libraries,
          );
          return {
            kind: "instanceChild",
            libraryId: currentInstanceContext.libraryId,
            libraryName: meta.libraryName,
            elementId: currentInstanceContext.elementId,
            elementName: meta.elementName,
            instanceId: currentInstanceContext.instanceId,
            instanceName: currentInstanceContext.instanceName,
            childId: obj.id,
            childName: obj.name,
            childType: obj.type,
            childPath: currentPath ? `${currentPath}/${obj.type}` : obj.type,
            missing: meta.missing,
          };
        }
      } else if (obj.type === "libraryElementInstance") {
        const meta = resolveLibraryMeta(obj.libraryId, obj.elementId, libraries);
        return {
          kind: "instanceRoot",
          libraryId: obj.libraryId,
          libraryName: meta.libraryName,
          elementId: obj.elementId,
          elementName: meta.elementName,
          instanceId: obj.id,
          instanceName: obj.name,
          missing: meta.missing,
        };
      }
      return null;
    }

    let nextContext = currentInstanceContext;
    if (obj.type === "libraryElementInstance") {
      nextContext = {
        instanceId: obj.id,
        instanceName: obj.name,
        libraryId: obj.libraryId,
        elementId: obj.elementId,
      };
    }

    const children = obj.type === "group" ? obj.objects : (obj as any).objects;
    if (Array.isArray(children)) {
      const childPath = currentPath ? `${currentPath}/${obj.type}` : obj.type;
      const found = findLibraryOriginForObject(children, targetObjectId, libraries, nextContext, childPath);
      if (found) return found;
    }
  }

  return null;
}
