# План реализации: Множественные модели с приоритетами

## Цель

Добавить поддержку указания нескольких моделей с приоритетами в запросе.

## Синтаксис

```json
// Одна модель (как сейчас, обратная совместимость)
"model": "deepseek-r1"

// С провайдером (новое)
"model": "openrouter/deepseek-r1"

// Массив с приоритетами (новое)
"model": ["openrouter/deepseek-r1", "llama-3.3-70b", "auto"]

// Без auto — после списка сразу fallback
"model": ["openrouter/deepseek-r1", "llama-3.3-70b"]
```

## Логика работы

1. **Строгий приоритет** — модели пробуются в порядке указания
2. **`provider/model`** — использовать только указанный провайдер
3. **Без провайдера** — ротация по всем провайдерам этой модели (если модель доступна у нескольких)
4. **`auto` в конце** — после явных моделей переход к Smart Strategy (выбор из оставшихся)
5. **Без `auto`** — после исчерпания списка сразу fallback на платную модель

## Фазы реализации

### Фаза 1: Интерфейсы и парсинг

**Файлы:**
- `src/modules/selector/interfaces/selector.interface.ts`
- `src/modules/selector/utils/model-parser.ts` (новый)

**Задачи:**

1. Создать интерфейс `ModelReference`:
```typescript
interface ModelReference {
  name: string;           // Название модели
  provider?: string;      // Провайдер (опционально)
  isAuto?: boolean;       // Флаг auto
}
```

2. Обновить `SelectionCriteria`:
```typescript
interface SelectionCriteria {
  // Старое поле для обратной совместимости
  model?: string;
  
  // Новое: список моделей с приоритетами
  models?: ModelReference[];
  
  // Флаг: при исчерпании списка использовать Smart Strategy
  allowAutoFallback?: boolean;
  
  // ... остальные поля без изменений
}
```

3. Создать парсер `parseModelInput(input: string | string[]): ParsedModelInput`:
   - Распознаёт `provider/model-name`
   - Распознаёт `auto`
   - Возвращает массив `ModelReference[]` и флаг `allowAutoFallback`

### Фаза 2: ModelsService — поиск с провайдером

**Файлы:**
- `src/modules/models/models.service.ts`
- `src/modules/models/interfaces/model.interface.ts`

**Задачи:**

1. Добавить метод `findByNameAndProvider(name: string, provider?: string): ModelDefinition[]`:
   - Если provider указан — вернуть модель только от этого провайдера
   - Если provider не указан — вернуть все модели с этим name от всех провайдеров

2. Обновить `findByName` для обработки формата `provider/model`:
   - Парсить входную строку
   - Делегировать в `findByNameAndProvider`

### Фаза 3: SelectorService — логика приоритетов

**Файлы:**
- `src/modules/selector/selector.service.ts`

**Задачи:**

1. Обновить `selectModel(criteria)`:
   - Если есть `criteria.models` — использовать новую логику с приоритетами
   - Если только `criteria.model` (строка) — обратная совместимость

2. Новая логика выбора:
```typescript
selectModelWithPriorities(models: ModelReference[], criteria: SelectionCriteria):
  for each modelRef in models:
    if modelRef.isAuto:
      // Переход к Smart Strategy для оставшихся моделей
      return smartStrategy.select(availableModels, criteria)
    
    candidates = modelsService.findByNameAndProvider(modelRef.name, modelRef.provider)
    
    for each candidate in candidates:
      if circuitBreaker.canRequest(candidate.name):
        return candidate
        
  // Все модели из списка недоступны
  return null  // Роутер сделает fallback
```

3. Обновить `selectNextModel`:
   - Учитывать уже попробованные модели
   - Продолжать с текущей позиции в списке приоритетов

### Фаза 4: RouterService — интеграция

**Файлы:**
- `src/modules/router/router.service.ts`
- `src/modules/router/dto/chat-request.dto.ts`

**Задачи:**

1. Обновить DTO:
```typescript
@IsOptional()
@ValidateIf((o) => typeof o.model === 'string' || Array.isArray(o.model))
model?: string | string[];
```

2. Обновить `routeRequest`:
   - Парсить `model` в `SelectionCriteria`
   - Передавать `allowAutoFallback` для определения поведения после исчерпания списка

3. Логика retry:
   - При ошибке — следующая модель из списка (с учётом провайдера)
   - При исчерпании списка:
     - Если был `auto` → Smart Strategy
     - Если не было `auto` → fallback

### Фаза 5: Тесты

**Файлы:**
- `src/modules/selector/utils/model-parser.spec.ts` (новый)
- `src/modules/selector/selector.service.spec.ts`
- `src/modules/router/router.service.spec.ts`
- `test/e2e/multiple-models.e2e-spec.ts` (новый)

**Тест-кейсы:**

1. Парсер:
   - `"deepseek-r1"` → `[{ name: "deepseek-r1" }]`, allowAutoFallback: false
   - `"openrouter/deepseek-r1"` → `[{ name: "deepseek-r1", provider: "openrouter" }]`
   - `["model1", "model2", "auto"]` → 2 модели + allowAutoFallback: true
   - `["openrouter/model1", "deepseek/model2"]` → каждый с провайдером

2. Selector:
   - Приоритет соблюдается
   - Пропуск недоступных моделей (Circuit Breaker)
   - Ротация провайдеров для модели без указания провайдера
   - `auto` переключает на Smart Strategy

3. Router:
   - Retry идёт по списку
   - Fallback только после исчерпания
   - Метаданные содержат все попытки

### Фаза 6: Документация

**Файлы:**
- `README.md`
- `docs/api.md` (если есть)

**Задачи:**

1. Обновить описание поля `model`
2. Добавить примеры использования
3. Описать поведение `auto`

## Порядок реализации

1. [ ] Фаза 1: Интерфейсы и парсер
2. [ ] Фаза 2: ModelsService
3. [ ] Фаза 3: SelectorService
4. [ ] Фаза 4: RouterService и DTO
5. [ ] Фаза 5: Тесты
6. [ ] Фаза 6: Документация

## Обратная совместимость

- Строка `"model": "name"` работает как раньше
- `"model": "auto"` или отсутствие поля → Smart Strategy
- Массив — новая функциональность

## Вопросы для уточнения

1. ✅ Приоритет строгий (порядок указания)
2. ✅ Без провайдера — ротация по провайдерам
3. ✅ `auto` в конце — переход к Smart Strategy
4. ✅ Без `auto` — сразу fallback
