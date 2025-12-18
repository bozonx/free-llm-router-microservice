# Multimodal Support Fields

## Обзор изменений

Добавлены детальные параметры для определения поддержки различных типов входных данных моделями. Вместо общего флага `supportsVision` теперь используются более специфичные поля:

- `supportsImage` — поддержка изображений (vision)
- `supportsVideo` — поддержка видео
- `supportsAudio` — поддержка аудио
- `supportsFile` — поддержка файлов/документов

Поле `supportsVision` помечено как устаревшее (`@deprecated`), но сохранено для обратной совместимости.

## Изменённые файлы

### Интерфейсы и типы

1. **`src/modules/models/interfaces/model.interface.ts`**
   - Добавлены поля: `supportsImage`, `supportsVideo`, `supportsAudio`, `supportsFile`
   - `supportsVision` помечен как `@deprecated`

2. **`src/modules/selector/interfaces/selector.interface.ts`**
   - Добавлены критерии выбора для новых полей
   - `supportsVision` помечен как `@deprecated`

3. **`src/config/router-config.interface.ts`**
   - Добавлены поля переопределения (overrides) для новых параметров
   - `supportsVision` помечен как `@deprecated`

### Сервисы

4. **`src/modules/models/models.service.ts`**
   - Обновлён `FilterCriteria` с новыми полями
   - Добавлена загрузка новых полей из `models.yaml`
   - Добавлена поддержка переопределений (overrides)
   - Обновлена логика фильтрации моделей

5. **`src/modules/selector/selector.service.ts`**
   - Обновлена передача новых критериев в `modelsService.filter()`

6. **`src/modules/router/router.service.ts`**
   - Обновлена логика выбора модели с поддержкой новых полей
   - Валидация изображений проверяет оба поля (`supportsImage` и `supportsVision`)

### API

7. **`src/modules/router/dto/chat-completion.request.dto.ts`**
   - Добавлены параметры запроса: `supports_image`, `supports_video`, `supports_audio`, `supports_file`
   - `supports_vision` помечен как `@deprecated`

8. **`src/modules/router/router.controller.ts`**
   - Endpoint `/models` теперь возвращает все новые поля

### Скрипты и конфигурация

9. **`scripts/fetch-models.ts`**
   - Обновлён интерфейс `FilteredModel`
   - Автоматическое определение поддержки модальностей из `input_modalities` OpenRouter API
   - Установка флагов `supportsImage`, `supportsVideo`, `supportsAudio`, `supportsFile`

10. **`models.yaml`**
    - Обновлены модели с поддержкой изображений: заменено `supportsVision` на `supportsImage`
    - `gemini-2.0-flash-exp`: `supportsImage: true`
    - `nemotron-nano-12b-v2-vl`: `supportsImage: true`

### Документация

11. **`README.md`**
    - Обновлена секция Vision Support
    - Добавлено описание новых параметров фильтрации
    - Примеры использования `supports_image` вместо `supports_vision`

12. **`update-models-prompt.md`**
    - Обновлены правила тегирования
    - Добавлена секция "Multimodal Support Fields"
    - Обновлён пример модели

## Использование

### В запросах к API

```bash
# Фильтрация по поддержке изображений
curl -X POST http://localhost:8080/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "supports_image": true,
    "messages": [...]
  }'

# Фильтрация по поддержке видео
curl -X POST http://localhost:8080/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "supports_video": true,
    "messages": [...]
  }'
```

### В models.yaml

```yaml
models:
  - name: gemini-2.0-flash-exp
    provider: openrouter
    model: google/gemini-2.0-flash-exp:free
    type: fast
    contextSize: 1048576
    maxOutputTokens: 8192
    tags:
      - general
      - vision
    jsonResponse: true
    available: true
    weight: 3
    supportsImage: true  # Новое поле
```

### В конфигурации (overrides)

```yaml
modelOverrides:
  - name: custom-model
    supportsImage: true
    supportsVideo: false
    supportsAudio: false
    supportsFile: false
```

## Обратная совместимость

- Поле `supportsVision` продолжает работать и автоматически маппится на `supportsImage`
- Параметр запроса `supports_vision` продолжает работать
- При валидации изображений проверяются оба поля: `supportsImage` и `supportsVision`
- Endpoint `/models` возвращает оба поля

## Миграция

Для миграции с `supportsVision` на новые поля:

1. **В models.yaml**: Замените `supportsVision: true` на `supportsImage: true`
2. **В API запросах**: Замените `supports_vision: true` на `supports_image: true`
3. **В коде**: Используйте `model.supportsImage` вместо `model.supportsVision`

Старые поля продолжат работать, но рекомендуется перейти на новые для лучшей ясности и поддержки будущих модальностей.
