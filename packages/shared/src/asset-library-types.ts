import type { HmiObject } from "./hmi-object-types";
import type { ExtendedTagDataType } from "./tag-types";

export type AssetType = "png" | "jpg" | "jpeg" | "svg";

export type AssetGroup = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

export type Asset = {
  id: string;
  groupId?: string;
  name: string;
  description?: string;
  category?: string;
  type: AssetType;
  mimeType: string;
  fileName: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
  updatedAt: string;
  storagePath: string;
  previewUrl: string;
};

export type ProjectLibraryRef = {
  libraryId: string;
  name: string;
  version?: string;
  path?: string;
  enabled: boolean;
};

export type LibraryParameter = {
  name: string;
  displayName?: string;
  description?: string;
  type: "string" | "number" | "boolean" | "color" | "tag" | "tagPrefix" | "index";
  defaultValue?: unknown;
  required?: boolean;
};

export type PrefixApplyMode =
  | { type: "none" }
  | { type: "segment"; segmentIndex: number; position: "append" | "prepend" }
  | { type: "segmentByName"; segmentName: string; position: "append" | "prepend" }
  | { type: "lastSegment"; position: "append" | "prepend" };

export type IndexApplyMode =
  | { type: "none" }
  | { type: "arrayIndex"; occurrence: number; operation: "add"; valueFrom: "indexOffset" }
  | { type: "arrayIndexBySegment"; segmentName: string; operation: "add"; valueFrom: "indexOffset" };

export type ElementBindingAssignment = {
  baseTag: string;
  prefix?: string;
  prefixMode?: PrefixApplyMode;
  indexOffset?: number;
  indexMode?: IndexApplyMode;
  overrideTag?: string;
};

export type ElementBindingDefinition = {
  id: string;
  key: string;
  displayName: string;
  description?: string;
  kind: "tag" | "writeTag" | "state" | "command" | "custom";
  dataType?: ExtendedTagDataType;
  required?: boolean;
  defaultBaseTag?: string;
  overridable?: boolean;
};

export type ElementStateAction =
  | {
      type: "setVisible";
      objectId: string;
      visible: boolean;
    }
  | {
      type: "setAsset";
      objectId: string;
      assetId: string;
    }
  | {
      type: "setText";
      objectId: string;
      text: string;
    }
  | {
      type: "setFill";
      objectId: string;
      color: string;
    }
  | {
      type: "setStroke";
      objectId: string;
      color: string;
    };

export type ElementStateCase = {
  id: string;
  name: string;
  condition:
    | { type: "equals"; value?: unknown }
    | { type: "notEquals"; value?: unknown }
    | { type: "greaterThan"; value: number }
    | { type: "lessThan"; value: number }
    | { type: "between"; min: number; max: number }
    | { type: "true" }
    | { type: "false" };
  actions: ElementStateAction[];
};

export type ElementStateRule = {
  id: string;
  name: string;
  source:
    | {
        type: "tag";
        value: string;
      }
    | {
        type: "parameter";
        value: string;
      }
    | {
        type: "expression";
        value: string;
      };
  cases: ElementStateCase[];
};

export type LibraryElement = {
  id: string;
  libraryId?: string;
  elementKey?: string;
  name: string;
  description?: string;
  category?: string;
  width: number;
  height: number;
  previewAssetId?: string;
  objects: HmiObject[];
  bindings?: ElementBindingDefinition[];
  parameters?: LibraryParameter[];
  stateRules?: ElementStateRule[];
  createdAt: string;
  updatedAt: string;
};

export type ElementLibrary = {
  id: string;
  name: string;
  description?: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  assets: Asset[];
  elements: LibraryElement[];
};
