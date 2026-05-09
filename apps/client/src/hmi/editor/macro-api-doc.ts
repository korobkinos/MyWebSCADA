export type MacroApiDocItem = {
  name: string;
  category: string;
  signature: string;
  description: string;
  example: string;
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
    example: "const pressure = readTag(\"Boiler.Pressure\");",
  },
  {
    name: "writeTag",
    category: "Теги",
    signature: "writeTag(tagName: string, value: unknown): Promise<void>",
    description: "Записывает значение в тег.",
    example: "await writeTag(\"Burner_1.StartCmd\", true);",
  },
  {
    name: "pulseTag",
    category: "Теги",
    signature: "pulseTag(tagName: string, value: unknown, durationMs: number, resetValue?: unknown): Promise<void>",
    description: "Импульсная запись с авто-сбросом.",
    example: "await pulseTag(\"Burner_1.StartCmd\", true, 500, false);",
  },
  {
    name: "toggleTag",
    category: "Теги",
    signature: "toggleTag(tagName: string): Promise<void>",
    description: "Переключает BOOL-тег.",
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
    example: "const selected = getLW(10);",
  },
  {
    name: "setLW",
    category: "LW/Vars",
    signature: "setLW(address: number, value: unknown): void",
    description: "Записывает LW-регистр.",
    example: "setLW(9200, 123);",
  },
  {
    name: "getVar",
    category: "LW/Vars",
    signature: "getVar(name: string): unknown",
    description: "Читает внутреннюю переменную.",
    example: "const mode = getVar(\"Mode\");",
  },
  {
    name: "setVar",
    category: "LW/Vars",
    signature: "setVar(name: string, value: unknown): void",
    description: "Записывает внутреннюю переменную.",
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
    example: "openScreen(\"main_screen\");",
  },
  {
    name: "openPopup",
    category: "Экраны/Popup",
    signature: "openPopup(popupScreenId: string, options?: { title?: string; x?: number; y?: number; tagPrefix?: string; args?: Record<string, unknown> }): void",
    description: "Открывает popup и передаёт context.",
    example: "openPopup(\"Popup_ValveControl\", { title: \"Управление\", tagPrefix: \"VALVES.PZK_1\", args: { valveName: \"ПЗК-1\" } });",
  },
  {
    name: "closePopup",
    category: "Экраны/Popup",
    signature: "closePopup(popupInstanceId?: string): void",
    description: "Закрывает popup по id или верхний активный.",
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
    example: "const openedTag = resolveTag(\".Opened\", getCurrentTagPrefix());",
  },
  {
    name: "log",
    category: "Логи/Отладка",
    signature: "log(...items: unknown[]): void",
    description: "Инфо-лог макроса.",
    example: "log(\"macro started\", args);",
  },
  {
    name: "warn",
    category: "Логи/Отладка",
    signature: "warn(...items: unknown[]): void",
    description: "Warning-лог макроса.",
    example: "warn(\"bad quality\");",
  },
  {
    name: "error",
    category: "Логи/Отладка",
    signature: "error(...items: unknown[]): void",
    description: "Error-лог макроса.",
    example: "error(\"command failed\");",
  },
];

export const macroExamples: MacroExample[] = [
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
