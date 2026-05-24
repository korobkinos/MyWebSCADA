export type MacroApiDocItem = {
  name: string;
  category: string;
  signature: string;
  description: string;
  example: string;
  params?: Array<{
    name: string;
    type: string;
    required?: boolean;
    description: string;
  }>;
  returns?: string;
  async?: boolean;
  safety?: "read" | "write" | "ui" | "navigation" | "debug" | "utility";
  related?: string[];
};

export type MacroExample = {
  id: string;
  title: string;
  description: string;
  code: string;
};

export const macroApiDocumentation: MacroApiDocItem[] = [
  {
    name: "readTag",
    category: "Теги",
    signature: "readTag(tagName: string): unknown",
    description: "Читает текущее значение тега.",
    params: [
      {
        name: "tagName",
        type: "string",
        required: true,
        description: "Полное имя тега (или относительное имя после resolveTag).",
      },
    ],
    returns: "Текущее значение тега или null, если значение недоступно.",
    safety: "read",
    related: ["resolveTag", "writeTag", "pulseTag", "toggleTag", "getTagQuality"],
    example: "const pressure = readTag(\"Boiler.Pressure\");",
  },
  {
    name: "writeTag",
    category: "Теги",
    signature: "writeTag(tagName: string, value: unknown): Promise<void>",
    description: "Записывает значение в тег.",
    params: [
      {
        name: "tagName",
        type: "string",
        required: true,
        description: "Имя командного/целевого тега.",
      },
      {
        name: "value",
        type: "unknown",
        required: true,
        description: "Значение для записи (обычно BOOL/число/строка).",
      },
    ],
    returns: "Promise<void>",
    async: true,
    safety: "write",
    related: ["readTag", "pulseTag", "toggleTag"],
    example: "await writeTag(\"Burner_1.StartCmd\", true);",
  },
  {
    name: "pulseTag",
    category: "Теги",
    signature: "pulseTag(tagName: string, value: unknown, durationMs: number, resetValue?: unknown): Promise<void>",
    description: "Импульсная запись с авто-сбросом.",
    params: [
      {
        name: "tagName",
        type: "string",
        required: true,
        description: "Имя командного тега.",
      },
      {
        name: "value",
        type: "unknown",
        required: true,
        description: "Значение на время импульса.",
      },
      {
        name: "durationMs",
        type: "number",
        required: true,
        description: "Длительность импульса в миллисекундах.",
      },
      {
        name: "resetValue",
        type: "unknown",
        description: "Значение после сброса. По умолчанию false.",
      },
    ],
    returns: "Promise<void>",
    async: true,
    safety: "write",
    related: ["writeTag", "toggleTag"],
    example: "await pulseTag(\"Burner_1.StartCmd\", true, 500, false);",
  },
  {
    name: "toggleTag",
    category: "Теги",
    signature: "toggleTag(tagName: string): Promise<void>",
    description: "Переключает BOOL-тег.",
    params: [
      {
        name: "tagName",
        type: "string",
        required: true,
        description: "Имя BOOL-тега.",
      },
    ],
    returns: "Promise<void>",
    async: true,
    safety: "write",
    related: ["readTag", "writeTag", "pulseTag"],
    example: "await toggleTag(\"Pump_1.Enable\");",
  },
  {
    name: "getTagQuality",
    category: "Теги",
    signature: "getTagQuality(tagName: string): \"Good\" | \"Bad\" | \"Uncertain\"",
    description: "Возвращает качество тега.",
    example: "if (getTagQuality(\"Boiler.Pressure\") !== \"Good\") warn(\"Bad quality\");",
  },
  {
    name: "tagExists",
    category: "Теги",
    signature: "tagExists(tagName: string): boolean",
    description: "Проверяет наличие тега в проекте.",
    example: "if (tagExists(\"Pump_1.Run\")) log(\"exists\");",
  },
  {
    name: "getLW",
    category: "LW/Vars",
    signature: "getLW(address: number): unknown",
    description: "Читает LW-регистр.",
    params: [
      {
        name: "address",
        type: "number",
        required: true,
        description: "Номер LW-адреса (например 10, 100, 9200).",
      },
    ],
    returns: "Значение LW или null, если переменная не инициализирована.",
    safety: "read",
    related: ["setLW", "getVar", "setVar"],
    example: "const selected = getLW(10);",
  },
  {
    name: "setLW",
    category: "LW/Vars",
    signature: "setLW(address: number, value: unknown): void",
    description: "Записывает LW-регистр.",
    params: [
      {
        name: "address",
        type: "number",
        required: true,
        description: "Номер LW-адреса.",
      },
      {
        name: "value",
        type: "unknown",
        required: true,
        description: "Новое значение.",
      },
    ],
    returns: "void",
    safety: "write",
    related: ["getLW", "setVar"],
    example: "setLW(9200, 123);",
  },
  {
    name: "getVar",
    category: "LW/Vars",
    signature: "getVar(name: string): unknown",
    description: "Читает внутреннюю переменную.",
    params: [
      {
        name: "name",
        type: "string",
        required: true,
        description: "Имя переменной проекта.",
      },
    ],
    returns: "Значение переменной или null.",
    safety: "read",
    related: ["setVar", "readVariable", "writeVariable"],
    example: "const mode = getVar(\"Mode\");",
  },
  {
    name: "setVar",
    category: "LW/Vars",
    signature: "setVar(name: string, value: unknown): void",
    description: "Записывает внутреннюю переменную.",
    params: [
      {
        name: "name",
        type: "string",
        required: true,
        description: "Имя переменной проекта.",
      },
      {
        name: "value",
        type: "unknown",
        required: true,
        description: "Новое значение.",
      },
    ],
    returns: "void",
    safety: "write",
    related: ["getVar", "readVariable", "writeVariable"],
    example: "setVar(\"SelectedValveName\", \"ПЗК-1\");",
  },
  {
    name: "readVariable",
    category: "LW/Vars",
    signature: "readVariable(name: string): unknown",
    description: "Alias для getVar.",
    example: "const value = readVariable(\"Counter\");",
  },
  {
    name: "writeVariable",
    category: "LW/Vars",
    signature: "writeVariable(name: string, value: unknown): void",
    description: "Alias для setVar.",
    example: "writeVariable(\"Counter\", 10);",
  },
  {
    name: "openScreen",
    category: "Экраны/Popup",
    signature: "openScreen(screenId: string): void",
    description: "Открывает обычный экран.",
    params: [
      {
        name: "screenId",
        type: "string",
        required: true,
        description: "ID экрана типа screen.",
      },
    ],
    returns: "void",
    safety: "navigation",
    related: ["openPopup", "closePopup"],
    example: "openScreen(\"main_screen\");",
  },
  {
    name: "openPopup",
    category: "Экраны/Popup",
    signature: "openPopup(popupScreenId: string, options?: { title?: string; x?: number; y?: number; tagPrefix?: string; args?: Record<string, unknown> }): void",
    description: "Открывает popup и передаёт context.",
    params: [
      {
        name: "popupScreenId",
        type: "string",
        required: true,
        description: "ID экрана типа popup.",
      },
      {
        name: "options",
        type: "{ title?: string; x?: number; y?: number; tagPrefix?: string; args?: Record<string, unknown> }",
        description: "Параметры окна и runtime-контекст (tagPrefix/args).",
      },
    ],
    returns: "void",
    safety: "navigation",
    related: ["closePopup", "openScreen", "resolveTag"],
    example: "openPopup(\"Popup_ValveControl\", { title: \"Управление\", tagPrefix: \"VALVES.PZK_1\", args: { valveName: \"ПЗК-1\" } });",
  },
  {
    name: "closePopup",
    category: "Экраны/Popup",
    signature: "closePopup(popupInstanceId?: string): void",
    description: "Закрывает popup по id или верхний активный.",
    params: [
      {
        name: "popupInstanceId",
        type: "string",
        description: "ID экземпляра popup. Если не задан, закроется верхний активный.",
      },
    ],
    returns: "void",
    safety: "navigation",
    related: ["openPopup", "openScreen"],
    example: "closePopup();",
  },
  {
    name: "getCurrentTagPrefix",
    category: "Контекст/Bindings",
    signature: "getCurrentTagPrefix(): string | undefined",
    description: "Текущий tagPrefix runtime-контекста.",
    example: "const prefix = getCurrentTagPrefix();",
  },
  {
    name: "getContext",
    category: "Контекст/Bindings",
    signature: "getContext(): { tagPrefix?: string; popupInstanceId?: string; screenId?: string; parameters?: Record<string, unknown> }",
    description: "Возвращает runtime context текущего запуска макроса.",
    example: "const ctx = getContext(); log(ctx.screenId, ctx.popupInstanceId);",
  },
  {
    name: "resolveTag",
    category: "Контекст/Bindings",
    signature: "resolveTag(relativeOrAbsoluteTag: string, tagPrefix?: string): string",
    description: "Разворачивает относительный тег `.Name` в полный.",
    params: [
      {
        name: "relativeOrAbsoluteTag",
        type: "string",
        required: true,
        description: "Относительный `.Name` или уже абсолютный тег.",
      },
      {
        name: "tagPrefix",
        type: "string",
        description: "Префикс для относительных тегов. Если не задан, берётся из текущего контекста.",
      },
    ],
    returns: "Полное имя тега.",
    safety: "utility",
    related: ["getCurrentTagPrefix", "getContext", "readTag"],
    example: "const openedTag = resolveTag(\".Opened\", getCurrentTagPrefix());",
  },
  {
    name: "log",
    category: "Логи/Отладка",
    signature: "log(...items: unknown[]): void",
    description: "Инфо-лог макроса.",
    params: [
      {
        name: "items",
        type: "unknown[]",
        required: true,
        description: "Любые значения для записи в лог.",
      },
    ],
    returns: "void",
    safety: "debug",
    related: ["warn", "error"],
    example: "log(\"macro started\", args);",
  },
  {
    name: "warn",
    category: "Логи/Отладка",
    signature: "warn(...items: unknown[]): void",
    description: "Warning-лог макроса.",
    params: [
      {
        name: "items",
        type: "unknown[]",
        required: true,
        description: "Любые значения для warning-сообщения.",
      },
    ],
    returns: "void",
    safety: "debug",
    related: ["log", "error"],
    example: "warn(\"bad quality\");",
  },
  {
    name: "error",
    category: "Логи/Отладка",
    signature: "error(...items: unknown[]): void",
    description: "Error-лог макроса.",
    params: [
      {
        name: "items",
        type: "unknown[]",
        required: true,
        description: "Любые значения для error-сообщения.",
      },
    ],
    returns: "void",
    safety: "debug",
    related: ["log", "warn"],
    example: "error(\"command failed\");",
  },
];

export const macroExamples: MacroExample[] = [
  {
    id: "read-tag-log",
    title: "Чтение тега и лог значения",
    description: "Проверка текущего значения аналогового тега.",
    code: "const pressure = readTag(\"Boiler.Pressure\");\nlog(\"Boiler.Pressure =\", pressure);",
  },
  {
    id: "write-command-tag",
    title: "Запись командного тега",
    description: "Отправка команды ПУСК.",
    code: "await writeTag(\"Pump_1.StartCmd\", true);\nlog(\"StartCmd sent\");",
  },
  {
    id: "pulse-command-tag",
    title: "Импульс командного тега",
    description: "Подача импульса 300 мс с авто-сбросом.",
    code: "await pulseTag(\"Burner_1.StartCmd\", true, 300, false);",
  },
  {
    id: "popup-with-tagprefix-args",
    title: "Popup с tagPrefix и args",
    description: "Открытие универсального popup для выбранного агрегата.",
    code: "const unit = Number(getLW(10) ?? 1);\nconst prefix = \"UNITS.U\" + unit;\nopenPopup(\"Popup_UnitControl\", {\n  title: \"Unit U\" + unit,\n  tagPrefix: prefix,\n  args: { unit, source: \"macro\" }\n});",
  },
  {
    id: "lw-selector",
    title: "LW как селектор",
    description: "Выбор активного насоса через LW10.",
    code: "const selectedPump = Number(getLW(10) ?? 1);\nconst cmdTag = \"Pumps.P\" + selectedPump + \".StartCmd\";\nawait writeTag(cmdTag, true);",
  },
  {
    id: "named-var-temp-state",
    title: "Named variable как временное состояние",
    description: "Сохранение этапа операции между запусками.",
    code: "const step = Number(getVar(\"StartSequenceStep\") ?? 0);\nif (step === 0) {\n  await writeTag(\"Line.FillCmd\", true);\n  setVar(\"StartSequenceStep\", 1);\n} else {\n  await writeTag(\"Line.RunCmd\", true);\n  setVar(\"StartSequenceStep\", 0);\n}",
  },
  {
    id: "resolve-relative-tag",
    title: "Resolve относительного тега",
    description: "Безопасная работа с .Tag внутри popup по prefix.",
    code: "const prefix = String(getCurrentTagPrefix() || \"VALVES.PZK_1\");\nconst openedTag = resolveTag(\".Opened\", prefix);\nconst opened = readTag(openedTag);\nlog(openedTag, opened);",
  },
  {
    id: "javascript-lite-simple",
    title: "javascript-lite: простой if/else",
    description: "Минимальный стиль без TypeScript-аннотаций.",
    code: `const isEnabled = readTag("Pump_1.Enable") === true;\nif (isEnabled) {\n  writeTag("Pump_1.StartCmd", true);\n} else {\n  writeTag("Pump_1.StopCmd", true);\n}`,
  },
  {
    id: "javascript-lite-popup",
    title: "javascript-lite: popup с context",
    description: "Открытие popup и передача tagPrefix/args.",
    code: `const prefix = String(getVar("SelectedValvePrefix") || "VALVES.PZK_1");\nopenPopup("Popup_ValveControl", {\n  title: "Control: " + prefix,\n  tagPrefix: prefix,\n  args: { valvePrefix: prefix }\n});`,
  },
  {
    id: "read-and-write",
    title: "Чтение тега и запись результата",
    description: "Сравнение давления с уставкой.",
    code: `const pressure = Number(readTag("Boiler.Pressure") ?? 0);\n\nif (pressure > 10.0) {\n  await writeTag("Boiler.HighPressure", true);\n} else {\n  await writeTag("Boiler.HighPressure", false);\n}`,
  },
  {
    id: "pulse-start",
    title: "Импульс команды пуска",
    description: "Пусковая команда на 500 мс.",
    code: `await pulseTag("Burner_1.StartCmd", true, 500, false);`,
  },
  {
    id: "lw-index",
    title: "Расчет индекса по LW",
    description: "Пример вычисления и записи индекса.",
    code: `const selectedValve = Number(getLW(10) ?? 0);\nconst selectedBurner = Number(getLW(20) ?? 1);\n\nconst index = selectedBurner <= 1\n  ? selectedValve\n  : (selectedBurner - 1) * 32 + selectedValve;\n\nsetLW(9200, index);`,
  },
  {
    id: "popup-prefix",
    title: "Открытие popup с tagPrefix",
    description: "Один popup для разных клапанов.",
    code: `const selectedBurner = Number(getLW(20) ?? 1);\nconst selectedValve = Number(getLW(10) ?? 1);\nconst prefix = "VALVES.BURNER_" + selectedBurner + ".PZK_" + selectedValve;\n\nopenPopup("Popup_ValveControl", {\n  title: "Управление арматурой",\n  x: 320,\n  y: 160,\n  tagPrefix: prefix,\n  args: {\n    valveName: "PZK-" + selectedValve,\n    valvePrefix: prefix\n  }\n});`,
  },
  {
    id: "dynamic-binding-prefix",
    title: "Dynamic prefix через var",
    description: "Переключение префикса через internal variable.",
    code: `setVar("selectedBurnerPrefix", "_2");`,
  },
  {
    id: "interval-counter",
    title: "Макрос по интервалу",
    description: "Инкремент internal var и LW.",
    code: `const counter = Number(getVar("Counter") ?? 0) + 1;\nsetVar("Counter", counter);\nsetLW(100, counter);\nlog("counter=", counter);`,
  },
  {
    id: "quality-check",
    title: "Проверка качества тега",
    description: "Лог и var при плохом качестве.",
    code: `const quality = getTagQuality("Boiler.Pressure");\nif (quality !== "Good") {\n  warn("Boiler.Pressure quality:", quality);\n  setVar("LastTagError", "Boiler.Pressure: " + quality);\n}`,
  },
];
