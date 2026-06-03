import type { ScadaProject, TagDefinition } from "@web-scada/shared";
import {
  type OpcUaImportCandidate,
  opcUaDataTypeToTagDataType,
} from "../drivers/opcua-inspector.js";

export type ApplyOpcUaImportResult = {
  tags: TagDefinition[];
  created: number;
  updated: number;
};

export function applyOpcUaImportCandidates(
  project: ScadaProject,
  driverId: string,
  candidates: OpcUaImportCandidate[],
  options?: { overwrite?: boolean; scanRateMs?: number },
): ApplyOpcUaImportResult {
  const overwrite = options?.overwrite ?? false;
  const nextTags = [...project.tags];
  const existingByName = new Map(nextTags.map((tag) => [tag.name, tag]));
  let created = 0;
  let updated = 0;

  for (const item of candidates) {
    const tagNameBase = item.browsePath;
    let tagName = tagNameBase;
    if (!overwrite) {
      let suffix = 2;
      while (existingByName.has(tagName) || nextTags.some((tag) => tag.name === tagName)) {
        tagName = `${tagNameBase}_${suffix}`;
        suffix += 1;
      }
    }
    const prevTag = existingByName.get(tagName);
    const nextTag: TagDefinition = {
      ...prevTag,
      name: tagName,
      sourceType: "opcua",
      dataType: opcUaDataTypeToTagDataType(item.dataType),
      driverId,
      nodeId: item.nodeId,
      address: {
        nodeId: item.nodeId,
        ...(item.indexRange ? { indexRange: item.indexRange } : {}),
        ...(item.memberPath?.length ? { memberPath: item.memberPath } : {}),
      },
      writable: item.writable ?? prevTag?.writable ?? false,
      scanRateMs: options?.scanRateMs ?? prevTag?.scanRateMs ?? 500,
    };
    const existingIndex = nextTags.findIndex((tag) => tag.name === tagName);
    if (existingIndex >= 0) {
      if (!overwrite) {
        continue;
      }
      nextTags[existingIndex] = nextTag;
      existingByName.set(tagName, nextTag);
      updated += 1;
    } else {
      nextTags.push(nextTag);
      existingByName.set(tagName, nextTag);
      created += 1;
    }
  }

  return { tags: nextTags, created, updated };
}
