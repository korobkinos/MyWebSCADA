export const DEFAULT_OPERATOR_ACTION_VALUE_CHANGE_TEMPLATE =
  'Пользователь {user} изменил значение у объекта "{description}" с {oldValue} на {newValue}';

export const DEFAULT_OPERATOR_ACTION_BUTTON_TEMPLATE =
  'Пользователь {user} нажал кнопку "{description}"';

export const DEFAULT_OPERATOR_ACTION_CHECKBOX_TEMPLATE =
  'Пользователь {user} изменил состояние "{description}" с {oldValue} на {newValue}';

export const DEFAULT_OPERATOR_ACTION_SLIDER_TEMPLATE =
  'Пользователь {user} изменил значение "{description}" с {oldValue} на {newValue}';

export const DEFAULT_OPERATOR_ACTION_NUMERIC_INPUT_TEMPLATE =
  'Пользователь {user} изменил значение у объекта "{description}" с {oldValue} на {newValue}';

export type OperatorActionLoggingConfig = {
  enabled?: boolean;
  messageTemplate?: string;
};

export type OperatorActionKind =
  | 'write'
  | 'toggle'
  | 'pulse'
  | 'button'
  | 'checkbox'
  | 'slider'
  | 'numericInput'
  | 'macro'
  | 'variable'
  | 'lw'
  | 'screen';

export type OperatorActionResult = 'success' | 'failed' | 'denied';

export type OperatorActionTargetType = 'tag' | 'variable' | 'lw' | 'macro' | 'screen' | 'unknown';

export type OperatorActionContext = {
  screenId?: string;
  screenName?: string;
  objectId: string;
  objectName?: string;
  objectDescription?: string;
  objectType: string;
  actionKind: OperatorActionKind;
  targetType?: OperatorActionTargetType;
  targetName?: string;
  unit?: string;
  messageTemplate?: string;
  clientOldValue?: string | number | boolean | null;
  requestedValue?: string | number | boolean | null;
  details?: Record<string, unknown>;
};

export type OperatorActionRecord = {
  id: string;
  occurredAt: string;
  userId?: string | null;
  username?: string | null;
  userRole?: string | null;
  ip?: string | null;
  screenId?: string | null;
  screenName?: string | null;
  objectId: string;
  objectName?: string | null;
  objectDescription?: string | null;
  objectType: string;
  actionKind: OperatorActionKind;
  targetType?: OperatorActionTargetType | null;
  targetName?: string | null;
  oldValue?: string | number | boolean | null;
  newValue?: string | number | boolean | null;
  unit?: string | null;
  messageTemplate?: string | null;
  messageText: string;
  result: OperatorActionResult;
  errorText?: string | null;
  details?: Record<string, unknown> | null;
  createdAt?: string;
};

export type OperatorActionHistoryQuery = {
  from?: string;
  to?: string;
  user?: string;
  objectId?: string;
  objectType?: string;
  targetName?: string;
  result?: OperatorActionResult;
  search?: string;
  limit?: number;
  offset?: number;
};

export type OperatorActionHistoryPage = {
  items: OperatorActionRecord[];
  total: number;
  limit: number;
  offset: number;
};

export type OperatorActionArchiveSettings = {
  enabled: boolean;
  retentionDays: number;
  maxDatabaseSizeMb: number;
  cleanupMode: 'byAge' | 'bySize' | 'byAgeAndSize';
  cleanupIntervalMinutes: number;
  optimizeAfterCleanup: boolean;
  deleteBatchSize?: number;
  maintenanceIntervalMs?: number;
  maxMaintenanceTickMs?: number;
  maxDeleteTransactionMs?: number;
  updatedAt?: string;
};

export type ProjectOperatorActionSettings = {
  enabled?: boolean;
  defaultValueChangeTemplate?: string;
  defaultButtonTemplate?: string;
  defaultCheckboxTemplate?: string;
  defaultSliderTemplate?: string;
  defaultNumericInputTemplate?: string;
  archiveSettings?: OperatorActionArchiveSettings;
};

type OperatorActionObjectLike = {
  type?: string;
  operatorActionLogging?: OperatorActionLoggingConfig;
} | null | undefined;

type OperatorActionProjectLike = {
  operatorActionSettings?: {
    enabled?: boolean;
  };
} | null | undefined;

const DEFAULT_ENABLED_OPERATOR_ACTION_TYPES = new Set<string>([
  "button",
  "checkbox",
  "slider",
  "numeric-input",
  "select",
  "radio-group",
  "switch",
  "valueSelect",
  "value-input",
]);

export function isOperatorActionEnabledForObject(
  object: OperatorActionObjectLike,
  project?: OperatorActionProjectLike,
): boolean {
  if (project?.operatorActionSettings?.enabled === false) {
    return false;
  }
  if (!object) {
    return false;
  }
  if (object.operatorActionLogging?.enabled === false) {
    return false;
  }
  if (object.operatorActionLogging?.enabled === true) {
    return true;
  }
  return DEFAULT_ENABLED_OPERATOR_ACTION_TYPES.has(object.type ?? "");
}
