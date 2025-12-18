# Поддержка supportsTools

## Дата: 2025-12-18

## Изменения

### 1. Удалено поле `inputModalities`

Поле `inputModalities?: string[]` было удалено из интерфейса `FilteredModel` в `scripts/fetch-models.ts`, так как оно дублировало отдельные boolean поля:
- `supportsImage`
- `supportsVideo`
- `supportsAudio`
- `supportsFile`

Эти boolean поля остались и используются для фильтрации моделей по поддержке различных входных модальностей.

### 2. Добавлена полная поддержка `supportsTools`

Параметр `supportsTools` теперь полностью поддерживается в проекте:

#### Интерфейсы:
- ✅ `ModelDefinition` (`src/modules/models/interfaces/model.interface.ts`)
- ✅ `FilterCriteria` (`src/modules/models/models.service.ts`)
- ✅ `SelectionCriteria` (`src/modules/selector/interfaces/selector.interface.ts`)
- ✅ `ModelOverrideConfig` (`src/config/router-config.interface.ts`)

#### Функциональность:
- ✅ Фильтрация моделей по `supportsTools` в `ModelsService.matchesCriteria()`
- ✅ Загрузка из `models.yaml` в `ModelsService.addOptionalFields()`
- ✅ Переопределение через конфигурацию в `ModelsService.applyOverrideToModel()`
- ✅ Генерация в `scripts/fetch-models.ts` на основе эвристик и API параметров

#### Теги:
При генерации моделей через `scripts/fetch-models.ts`:
- Если модель поддерживает Tools → добавляется тег `'tools'`
- Если модель поддерживает JSON → добавляется тег `'json-mode'`

## Использование

### Фильтрация моделей с поддержкой Tools:

```typescript
// В коде
const modelsWithTools = modelsService.filter({
  supportsTools: true
});

// Через API
{
  "tags": ["tools"]
}

// Или напрямую через параметр (если будет добавлено в API)
{
  "supports_tools": true
}
```

### Переопределение в конфигурации:

```yaml
modelOverrides:
  - name: "my-model"
    supportsTools: true
```

### Использование в n8n:

В n8n ноде `Free LLM Router Model` доступен фильтр:
- **Filter: Supports Tools** - фильтрация моделей с поддержкой function calling

Этот фильтр передается в API как параметр `supports_tools`.

## Обоснование

### Почему отдельные параметры, а не только теги?

1. **Производительность**: Проверка boolean поля O(1) vs поиск в массиве тегов O(n)
2. **Типобезопасность**: TypeScript гарантирует тип для `supportsTools: boolean`
3. **Явность API**: `supportsTools: true` понятнее чем `tags: ['tools']`
4. **Разделение ответственности**:
   - Параметры (`supportsTools`, `jsonResponse`) = технические возможности
   - Теги (`coding`, `creative`, `tier-1`) = семантические характеристики

### Зачем дублировать в тегах?

Теги полезны для:
- Комбинированной фильтрации: `tags: ['tier-1', 'tools', 'vision']`
- UI: показ бейджей возможностей
- Гибкой фильтрации с OR-логикой: `tags: ['tools|json-mode']`

## Тесты

Все существующие тесты проходят успешно ✅
