# Web SCADA Lite

Web SCADA Lite - это расширяемая web-SCADA/HMI система на `Node.js + TypeScript + React`.

## Что реализовано в текущем MVP

- Monorepo: `apps/server`, `apps/client`, `packages/shared`
- Backend: Fastify + WebSocket, tag store, simulated driver, runtime
- Frontend: Runtime + Editor (react-konva), role/permission authorization
- Resize/drag/select объектов в Editor
- Popup-окна и template/frame
- Относительные теги с `tagPrefix` (`.Opened` -> `Pump_1.Opened`)
- Внутренние переменные (`LW.*`) и макросы TypeScript
- Новый графический подход:
  - project assets (PNG/JPG/SVG)
  - element libraries
  - library element instances
  - сохранение выбранных объектов в библиотечный элемент
- Новый раздел `Element Editor` (`/element-editor`) для создания библиотечных шаблонов элементов

## Что добавлено в этой доработке (Element Editor)

- В главном меню добавлен отдельный раздел **Element Editor**.
- Реализована отдельная страница редактирования библиотечных элементов:
  - левый dock: выбор библиотеки и списка элементов;
  - центр: canvas шаблона элемента (на базе `HmiStage`);
  - правый dock: свойства элемента/объекта, assets, preview, state rules.
- Реализованы операции:
  - `New / Save / Duplicate / Delete element`;
  - добавление примитивов (`Image`, `Text`, `Line`, `Rectangle`, `StateImage`);
  - drag&drop asset на canvas элемента.
- Расширена модель `LibraryElement`:
  - `elementKey`, `libraryId`,
  - расширенные `parameters` (включая `tagPrefix` и `index`),
  - `stateRules` (`source -> cases -> actions`).
- Runtime для `libraryElementInstance` теперь применяет:
  - parameter substitution,
  - `tagPrefix`,
  - `stateRules` (MVP actions: `setVisible`, `setAsset`, `setText`, `setFill`, `setStroke`).
- Расширен шаблонизатор параметров:
  - поддержка `{{name}}`,
  - поддержка короткого формата `{index}`.
- В свойствах `LibraryElementInstance` улучшено редактирование параметров:
  - отдельные поля по типам параметров,
  - JSON advanced режим сохранён.

## Структура

```text
/apps
  /server
  /client
/packages
  /shared
/projects
  demo-project.json
/libraries
  /amaks-basic-equipment
/docker
  docker-compose.yml
```

## Быстрый запуск

### Вариант 1 (pnpm, рекомендовано)

```bash
corepack enable
pnpm install
pnpm dev
```

### Вариант 2 (npm)

```bash
npm install
npm run dev
```

`pnpm dev` / `npm run dev` запускает единый Node dev-runner, который поднимает:
- `@web-scada/server` (`tsx watch`)
- `@web-scada/client` (`vite`)

Остановка:
- Нажмите `Ctrl+C` один раз.
- Dev-runner корректно завершит оба процесса без `Terminate batch job (Y/N)` и без ввода `Y`.

Открыть:
- UI: `http://localhost:3000`
- API: `http://localhost:3001/api/project`

Проверка:
```bash
pnpm typecheck
pnpm test
pnpm build
```

Если после аварийного завершения порт остался занят:

```bash
pnpm dev:kill
```

Для ручной диагностики на Windows:

```powershell
netstat -ano | findstr :3001
netstat -ano | findstr :5173
taskkill /PID <pid> /F
```

## Аутентификация и пользователи

При первом запуске создается default admin.

Настройка в `.env`:

```env
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=admin
USERS_FILE=../../data/users.json
PORT=3001
PROJECT_FILE=../../projects/demo-project.json
LIBRARIES_DIR=../../libraries
```

Если `DEFAULT_ADMIN_PASSWORD` не задан, сервер использует insecure fallback и пишет warning в лог.

Логин:
- Откройте `http://localhost:3000/login`
- Войдите под admin
- Управление пользователями: раздел `Users`

## Работа с графикой (новый подход)

- Встроенные «рисованные» насосы/клапаны не являются основным подходом.
- Основной путь:
  1. Загрузить PNG/JPG/SVG в Asset Panel.
  2. Добавить изображения/базовые объекты на экран.
  3. Выделить набор объектов и сохранить в библиотеку как reusable element.
  4. Использовать `libraryElementInstance` на разных экранах/проектах.

## Профессиональное редактирование (MVP)

- Multi-select: клик, `Ctrl+Click`, `Shift+Click`, рамка выделения
- Group / Ungroup
- Lock / Unlock
- Align: left/right/top/bottom/h-center/v-center
- Same size: width/height/size
- Distribute: horizontal/vertical
- Space evenly: horizontal/vertical (+ configurable gap)

### Горячие клавиши

- `Ctrl+G`: Group
- `Ctrl+Shift+G`: Ungroup
- `Ctrl+L`: Lock selected
- `Ctrl+Shift+L`: Unlock selected
- `Delete`: удалить выбранные unlocked-объекты

## Основные API

### Проект и runtime
- `GET /api/project`
- `POST /api/project`
- `GET /api/tags`
- `POST /api/tags/:name/write`
- `GET /api/drivers`
- `POST /api/runtime/start`
- `POST /api/runtime/stop`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`

### Users
- `GET /api/users`
- `POST /api/users`
- `PUT /api/users/:id`
- `DELETE /api/users/:id`
- `POST /api/users/:id/change-password`

### Assets
- `POST /api/assets/upload`
- `GET /api/assets`
- `GET /api/assets/:assetId`
- `GET /api/assets/:assetId/file`
- `DELETE /api/assets/:assetId`

### Libraries
- `GET /api/libraries`
- `GET /api/libraries/:libraryId`
- `GET /api/libraries/:libraryId/elements`
- `POST /api/libraries`
- `POST /api/libraries/:libraryId/assets/upload`
- `GET /api/libraries/:libraryId/assets/:assetId/file`
- `POST /api/libraries/:libraryId/elements`
- `PUT /api/libraries/:libraryId/elements/:elementId`
- `DELETE /api/libraries/:libraryId/elements/:elementId`
- `POST /api/project/libraries/attach`
- `POST /api/project/libraries/detach`

## Element Editor: быстрый сценарий

1. Откройте `Element Editor`.
2. Выберите библиотеку слева.
3. Нажмите `New`, задайте имя/размеры элемента.
4. Добавьте объекты на canvas (`Add Image`, `Add Text`, ...).
5. Во вкладке `Assets` перетащите изображения на canvas или нажмите `Add`.
6. В `Element` задайте параметры (`tagPrefix`, `index`, `label` и т.д.).
7. В `State Rules` задайте JSON-правила состояний.
8. Нажмите `Save`.
9. В обычном `Editor` добавьте `LibraryElementInstance`, выберите библиотеку/элемент и задайте `parameterValues`/`tagPrefix`.

## Ограничения текущего MVP

- Полноценный визуальный конструктор `stateRules` пока не сделан (редактирование через JSON).
- Advanced docking (tabbed docking / cross-side drag) не реализован.
- Floating detached windows для всех разделов ещё не унифицированы полностью.
