# ValveUniversal checklist

## Цель

ValveUniversal — эталонный библиотечный элемент арматуры/клапана. Он не должен содержать прямые теги конкретной арматуры. Все внутренние объекты должны ссылаться на `$binding.*`, а конкретные теги должны задаваться на уровне экземпляра `libraryElementInstance` через `bindingAssignments`.

## Обязательные binding keys

ValveUniversal должен использовать следующие binding keys:

- visualState
- commandState
- openCmd
- closeCmd
- fault

## Типовая формула индекса

Для выбора арматуры по горелке и номеру арматуры используется expression:

```text
lw(20) * 32 + lw(10)
```

Где:

- LW20 — выбранная горелка;
- LW10 — выбранная арматура;
- 32 — количество арматуры на одну горелку.

Пример:

```text
LW20 = 2
LW10 = 5
index = 2 * 32 + 5 = 69
```

Базовый тег:

```text
GVL_VALVE.valves[0].VisualState
```

Должен разрешиться в:

```text
GVL_VALVE.valves[69].VisualState
```

## Проверка Element Editor

1. Открыть Element Editor.
2. Найти или создать элемент ValveUniversal.
3. Проверить bindings:
   - visualState -> GVL_VALVE.valves[0].VisualState
   - commandState -> GVL_VALVE.valves[0].CommandState
   - openCmd -> GVL_VALVE.valves[0].OpenCmd
   - closeCmd -> GVL_VALVE.valves[0].CloseCmd
   - fault -> GVL_VALVE.valves[0].Fault
4. Проверить, что внутренние объекты используют `$binding.*`, а не прямые теги.
5. Проверить State Rules:
   - source = `$binding.visualState`
   - case equals 0 — состояние закрыто;
   - case equals 1 — промежуточное состояние;
   - case equals 2 — открыто;
   - case equals 3 — авария.

## Проверка Editor screen

1. Открыть Editor.
2. Разместить ValveUniversal на экране.
3. Выбрать экземпляр `libraryElementInstance`.
4. Нажать `Fill ValveUniversal bindings`.
5. Проверить compact resolved status около каждого binding.
6. Проверить `Resolved Bindings Debug`.
7. При LW20 = 2 и LW10 = 5 должно быть:

```text
visualState  -> GVL_VALVE.valves[69].VisualState
commandState -> GVL_VALVE.valves[69].CommandState
openCmd      -> GVL_VALVE.valves[69].OpenCmd
closeCmd     -> GVL_VALVE.valves[69].CloseCmd
fault        -> GVL_VALVE.valves[69].Fault
```

## Проверка Runtime

1. Запустить Runtime.
2. Убедиться, что runtime subscriptions содержат:
   - LW20
   - LW10
   - GVL_VALVE.valves[69].VisualState
   - GVL_VALVE.valves[69].CommandState
   - GVL_VALVE.valves[69].Fault
3. Изменить LW20/LW10.
4. Убедиться, что resolved bindings пересчитываются.
5. Изменить значение visualState.
6. Убедиться, что stateRules меняют внутренний вид ValveUniversal.

## Что считается готовым

Задача считается завершённой, если:

- expression source работает;
- bindingAssignments могут использовать expression;
- runtime subscriptions учитывают зависимости expression;
- HmiRenderer пересчитывает resolved bindings по текущим tag values;
- в ObjectPropertyPanel есть preview expression;
- в ObjectPropertyPanel есть Resolved Bindings Debug;
- есть кнопка Fill ValveUniversal bindings;
- ValveUniversal содержит правильные binding keys;
- stateRules можно редактировать визуально;
- stateRules применяются в Runtime;
- есть тесты на binding resolve и stateRules.