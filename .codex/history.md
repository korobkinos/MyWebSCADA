# MyWebSCADA — журнал Codex

Этот файл хранит долговременный читаемый контекст проекта: задачи, принятые решения, изменения, проверки и ограничения. Это сжатый рабочий журнал, а не дословная стенограмма и не замена Git.

Структурированная версия тех же событий находится в `history.jsonl`. Правила автоматического ведения журнала заданы в корневом `AGENTS.md`.

## Правила ведения

- Перед новой задачей читать этот файл и последние относящиеся к задаче записи из `history.jsonl`.
- После завершения существенной задачи дописывать новую датированную запись в оба файла.
- Не просить пользователя повторять уже зафиксированные требования, пока они не противоречат текущему запросу или состоянию кода.
- При расхождении журнала с кодом, тестами или новым запросом считать актуальными код, проверки и последний запрос; устаревшее решение отметить новой записью.
- Не сохранять секреты, токены, пароли, внутренние рассуждения, полные логи и большие diff.

## Снимок проекта

Актуально на 2026-07-21 20:57 +03:00, ветка `main`, базовый commit `ca5c203`; код приложения соответствует `8aa0558`, а `ca5c203` добавляет только файлы истории. Если текущий HEAD совпадает, повторный полный обзор репозитория не нужен. При новом HEAD смотреть только commits после baseline и изменённые области, затем обновить этот снимок.

### Назначение и устройство

- MyWebSCADA — расширяемая Web SCADA/HMI-система. Текущий проект в `projects/demo-project.json` называется «Котёл K-11».
- Приватный pnpm-монорепозиторий: `apps/client`, `apps/server`, `packages/shared`; package manager — `pnpm@10.10.0`.
- `apps/client` — React 19 + Vite + TypeScript, Zustand, react-konva/Konva, Ant Design, Blueprint, ECharts и Monaco.
- `apps/server` — Fastify + WebSocket, Zod, PostgreSQL/TimescaleDB, OPC UA (`node-opcua`), Modbus dependency и simulated driver.
- `packages/shared` — общие типы, Zod-схемы, runtime/editor helpers и транспортные контракты. Публичная точка экспорта: `packages/shared/src/index.ts`.
- Основные данные: `projects` (проект и project assets), `libraries` (библиотеки элементов), `data` (пользователи/auth/event sounds). `data/auth-db.json`, `.env`, сборки и логи игнорируются Git.
- Размер исходников на момент снимка: client 196 файлов, server 51, shared 27; тестовых файлов 59.

### Точки входа и поток данных

- Клиент: `apps/client/src/main.tsx` → `apps/client/src/app/app.tsx`. Главные маршруты: `/` и `/runtime` — Runtime, `/editor` — защищённый Editor; `/macros` перенаправляется в Editor.
- Bootstrap клиента загружает project, tags, drivers, macros, assets, libraries и runtime status. Состояние находится в `apps/client/src/store/scada-store.ts`, HTTP-клиент — `apps/client/src/services/api.ts`.
- Live-данные: `apps/client/src/services/ws.ts` ↔ `apps/server/src/websocket/websocket-gateway.ts` по `/ws`. Сообщения включают tag update/batch, driver statuses, event update и project update; сервер фильтрует теги по подпискам клиента.
- Runtime дополнительно проверяет `/api/project` каждые 1500 мс как fallback, если WebSocket project update потерян.
- Сервер: `apps/server/src/index.ts` создаёт сервисы и передаёт их в `apps/server/src/api/routes.ts`. После запуска автоматически стартуют RuntimeService и EventEngine.
- Проект загружается и сохраняется через `apps/server/src/project/project-service.ts`; перед записью проходит `projectSchema`, добавляются default event sounds и нормализуются старые macro/OPC UA поля.
- Dev: Vite слушает `3000` и проксирует `/api` и `/ws` на backend `3001`. `pnpm init:dev` готовит TimescaleDB на `55432`. `pnpm start:runtime` требует собранный client dist и сам проксирует HTTP/WebSocket к backend.

### Клиент и UI

- Основные страницы: `runtime-page.tsx`, `editor-page.tsx`, `archive-page.tsx`, `events-page.tsx`, `project-manager-page.tsx`.
- Editor собирает окна через `features/screen-editor/hooks/use-editor-window-definitions.tsx`; управление floating windows — `components/workbench/windows/use-workbench-windows.ts`, `workbench-window-manager.tsx`, `workbench-window.tsx`.
- Окна Editor: Screens, Search, Project Manager/Settings, Users, Screen Settings, Runtime, Layers, Save Selection, Tags, Archive, Events, Macros, Drivers, Assets, Libraries, Asset Viewer, Object Properties.
- Эталон tag UI: `features/screen-editor/windows/screen-editor-tags-window.tsx`; driver UI: `screen-editor-drivers-window.tsx`. Новые связанные окна должны повторять их плотность, таблицы, toolbar, resize и selection behavior.
- Общие UI-компоненты импортировать через `apps/client/src/ui`; правила находятся в `apps/client/src/ui/README.md`. Токены темы — `apps/client/src/ui/theme.css`, общие Workbench-стили — `apps/client/src/app/styles.css`.
- Базовая тема Workbench — VS Code-like dark: Segoe UI 12px, control height 26px, CSS variables `--app-*`. Не создавать параллельную стилистику и не обходить `App*` wrappers без причины.
- Рендер HMI: `apps/client/src/hmi/runtime/hmi-renderer.tsx` и `hmi-stage.tsx`; editor logic — `apps/client/src/hmi/editor`; tag/index helpers — `apps/client/src/hmi/tags`.
- Поддерживаемые HMI-объекты: group, text, line, compound shape, rectangle, value display/input, state indicator, button, switch, image/state image, select/value select/radio, checkbox, slider, progress bar, numeric input/image indicator, valve, pump, frame, library element instance, trend chart и event table.

### Серверные подсистемы

- API находится в одном крупном файле `apps/server/src/api/routes.ts`; группы: auth/users/security, project/archive/import/cleanup, screens, tags/runtime actions, events/operator actions, archive/trends, variables/macros, OPC UA/drivers, runtime, assets/event sounds, libraries/elements.
- Auth: `auth/auth-service.ts`, permissions — `auth/permissions.ts`, shared roles/types — `packages/shared/src/auth-types.ts`. Роли: admin, engineer, operator, viewer; доступ проверяется на API-границе.
- Runtime: `runtime/runtime-service.ts` строит poll groups по scan rate и subscription groups по driver. Polling ориентирован на active tags; OPC UA subscription scope поддерживает `all` и `active`.
- Команды записи/pulse/hold: `runtime/command-service.ts`; переменные `internal-variable-service.ts`; макросы `macro-service.ts` и `macro-runtime-registry.ts`.
- Drivers: `drivers/driver-manager.ts`, `opcua-driver.ts`, `opcua-inspector.ts`, `simulated-driver.ts`. DriverManager группирует чтение по драйверам, делает OPC UA batches, timeout и возвращает Bad quality при недоступности.
- Events: `events/event-engine.ts`, логика — `event-engine-logic.ts`, действия — `event-action-executor.ts`. Live occurrences работают с in-memory fallback даже без Archive DB.
- Archive: `archive/archive-service.ts` + `archive-repository.ts`; БД необязательна — при ошибке инициализации архив отключается, основной runtime продолжает работу.
- Project portability: `project/project-archive-service.ts` и `project-cleanup-service.ts`; libraries — `libraries/library-service.ts`; assets — `assets/asset-service.ts`.

### Общая модель данных

- Корень `ScadaProject`: version/name, projectInfo, uiSettings/runtimeSettings, assets/groups, libraries, drivers, tags, events/categories/sounds/archive settings, operator action settings, variables/LW, macros, editor settings, screens и startScreenId.
- Типы тегов: BOOL/INT/DINT/REAL/STRING; источники включают opcua, modbus, lw, internal, computed и simulated. Основные определения — `packages/shared/src/tag-types.ts`.
- HMI-object union и RuntimeAction — `packages/shared/src/hmi-object-types.ts`; project/screen/driver/macro types — `project-types.ts`; validation root — `validation.ts`.
- LibraryElement поддерживает parameters, bindings, stateRules и вложенные HMI objects; resolution helpers находятся в shared (`parameter-resolver`, `element-binding-resolver`, `runtime-value-resolver`, `render-context`).

### Текущий demo project

- `projects/demo-project.json`: schema version 1, 5 screens, 6791 tags, 2 drivers, 5 variables, 3 macros, 2 events, 1 attached library, 2 project assets.
- Экраны: `main` (screen 1920×1080, 4 objects, стартовый), `screen_4` Trends, `template_3` Burner, `template_4` burner_template, `popup_5` valve_template.
- Драйверы: `sim_1` simulated и `opcua_f6g773` OPC UA subscription. Распределение тегов: OPC UA 6744, simulated 8, internal 8, LW 3, legacy/без sourceType 28.
- Встроенная библиотека `libraries/amaks-basic-equipment`: «АМАКС. Базовое оборудование», version 1.0.0; элементы Valve, PZK и Gate; 6 assets, без library macros.

### Зафиксированные решения из Git

- Runtime project sync использует одновременно WebSocket `project-update` и polling fallback; не удалять один из каналов без отдельного решения.
- `scripts/start-runtime.mjs` проксирует и `/api`, и `/ws`.
- Большие tag batches режутся на чанки; обновление store оптимизировано для большого проекта с тысячами тегов.
- Polling-mode OPC UA читает активные теги; subscription-mode учитывает configured subscription scope.
- Frame клипует вложенный screen/template и не рендерит полностью выходящие за границы элементы.
- `openPopup` по умолчанию переиспользует popup; режим Open copy сохраняет создание копий.
- Overlay ID для вложенных объектов учитывает `nodeIdPrefix`; повторный клик по открытому select должен закрывать его.
- Event Engine сохраняет live active/cleared/acknowledged occurrences в памяти, если archive service недоступен.

### Куда смотреть для типовых задач

- Теги: client tags window/store/api → server routes/tag-store → shared tag types/validation.
- Драйверы/OPC UA: drivers window → API driver endpoints → driver-manager/opcua-driver/opcua-inspector.
- Runtime rendering: runtime-page → hmi-stage/hmi-renderer → shared render/binding/value resolvers.
- Editor/Workbench: editor-page → window definitions → конкретное `screen-editor-*-window` → UI layer/theme/styles.
- Events: `features/events` → event API → event-engine/action executor → shared event types.
- Trends/archive: `features/trends` и archive page → archive/trend API → archive service/repository → shared archive types.
- Libraries/assets: libraries/assets windows → corresponding client API → library/asset services → shared asset-library types.
- Project import/export/cleanup: project manager → archive/cleanup API → project archive/cleanup services → shared archive/cleanup schemas.
- Auth/users: app/store → auth API → auth service/permissions → shared auth/password-policy types.

## Основные команды

```text
pnpm install
pnpm init:dev
pnpm dev
pnpm dev:kill
pnpm typecheck
pnpm test
pnpm -r test
pnpm build
```

- `pnpm test` запускает только тесты `@web-scada/shared`.
- `pnpm -r test` запускает полный набор client/server/shared.
- Для локальной области можно использовать `pnpm --filter @web-scada/client test`, `pnpm --filter @web-scada/server test` или `pnpm --filter @web-scada/shared test`.

## Текущее состояние проверок

Проверено 2026-07-21 на commit `8aa0558`:

- `pnpm typecheck` — успешно во всех трёх workspace packages.
- `pnpm build` — успешно; Vite предупреждает о chunk `numeric-input-dialog` около 1013 kB, выше лимита 900 kB.
- `pnpm -r test` — client: 32 files / 191 tests passed; shared: 11 files / 100 tests passed; server: 15 files passed, 1 failed, 151 tests passed и 1 failed.
- Стабильно падает `apps/server/src/drivers/driver-manager.test.ts:58`: тест порядка результатов ожидает `[101, 201, 102, 202]`, получает `[100, 100, 100, 100]`. Отдельный повтор подтвердил ошибку. В рамках создания истории исправление не выполнялось.
- Известные TODO: отдельный role gate для event-table sound mute; дальнейшая оптимизация trend snapshot/append; persistence API для event-table overlay context без screen binding.

## Журнал

### 2026-07-21 — включена проектная память Codex

- Запрос: сохранять контекст переписки и выполненной работы в репозитории, чтобы не повторять однотипные требования в следующих сессиях.
- Решение: вести читаемый журнал `history.md`, машинно-читаемый append-only журнал `history.jsonl` и подключить их через корневой `AGENTS.md`, который Codex загружает как постоянные инструкции репозитория.
- Выполнено: проанализированы структура монорепозитория, стандартные команды, основные клиентские и серверные подсистемы, README и недавняя история Git.
- Ограничение: журнал обновляется агентом при работе в репозитории; он не является гарантированной побайтовой записью всего интерфейсного чата.
- Проверки: валидность JSONL, наличие файлов и `git diff --check`.
- Следующий шаг: при следующих задачах автоматически читать журнал и дописывать итог после завершения работы.

### 2026-07-21 — сохранена подробная карта проекта

- Запрос: изучить проект и репозиторий один раз, сохранить знания и не тратить токены на повторное полное сканирование.
- Выполнено: зафиксированы архитектура client/server/shared, точки входа, data flow, UI-паттерны, серверные подсистемы, модель проекта, demo dataset, маршрутизация типовых задач и важные решения из Git.
- Workflow: если HEAD равен `8aa0558`, использовать этот снимок и читать только файлы текущей задачи; при изменении HEAD анализировать только новые commits и затронутые области.
- Проверки: typecheck и build успешны; полный test suite обнаружил один подтверждённый failing server test, описанный выше.
- Изменены только `AGENTS.md`, `.codex/history.md` и `.codex/history.jsonl`; исходный код приложения не менялся.

### 2026-07-21 — подтверждён fix подтормаживания rotation animation

- Вывод по текущему коду и истории Git: найденная проблема исправлена, оптимизации остаются в `hmi-renderer.tsx`.
- Основные fixes: единый global RAF ticker; временное отключение Konva auto-draw внутри handlers; один aggregated layer flush; остановка inactive/zero-speed handlers; игнорирование tag timestamp в memo comparison; кэширование вращаемой Konva group.
- Текущий rotation path делает `clearCache + cache` один раз при restart эффекта, затем каждый кадр меняет rotation закэшированного bitmap и запрашивает один dirty-layer draw. Дочерние элементы не должны перерисовываться каждый кадр.
- Дополнительный общий fix: tag store больше не строит цепочку Proxy, а большие batches обрабатываются chunks до 250 значений.
- Связанные commits: `480712e`, `787837f`, `f4b3e60`, `2d722a0`, `a30975b`, `1ff2350`, `fa21f33`, итоговый `cb21619`, затем `a2ac8ea`.
- Проверка: `runtime-animation-policy.test.ts` и `hmi-renderer.test.tsx` — 2 test files, 17 tests passed.
- Ограничение: это подтверждение кода, commits и unit tests; фактический FPS в браузере на целевой машине в этой сессии не измерялся.
