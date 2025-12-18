# План реализации: Free LLM Router Microservice

> Этот план оптимизирован для пошаговой реализации с помощью Claude Opus 4.5.
> Каждый шаг изолирован и не требует большого контекста.

---

## Фаза 1: Инфраструктура и конфигурация

### Шаг 1.1: Добавить зависимости

**Цель**: Установить необходимые npm пакеты.

**Действия**:
```bash
pnpm add js-yaml @nestjs/axios axios
pnpm add -D @types/js-yaml
```

**Файлы**: `package.json`

---

### Шаг 1.2: Создать интерфейсы моделей

**Цель**: Определить TypeScript интерфейсы для моделей и конфигурации.

**Файлы для создания**:
- `src/modules/models/interfaces/model.interface.ts`

**Содержимое**:
```typescript
export type ModelType = 'fast' | 'reasoning';
export type ModelSpeedTier = 'fast' | 'medium' | 'slow';

export interface ModelDefinition {
  name: string;
  provider: string;
  model: string;
  type: ModelType;
  contextSize: number;
  maxOutputTokens: number;
  tags: string[];
  jsonResponse: boolean;
  available: boolean;
}

export interface ModelsConfig {
  models: ModelDefinition[];
}
```

---

### Шаг 1.3: Создать интерфейсы конфигурации роутера

**Цель**: Определить структуру конфигурации роутера.

**Файлы для создания**:
- `src/config/router-config.interface.ts`

**Содержимое**:
```typescript
export interface ProviderConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
}

export interface FallbackConfig {
  enabled: boolean;
  provider: string;
  model: string;
}

export interface RoutingConfig {
  algorithm: 'round-robin';
  maxModelSwitches: number;
  maxSameModelRetries: number;
  retryDelay: number;
  timeout: number;
  fallback: FallbackConfig;
}

export interface RouterConfig {
  modelsFile: string;
  providers: Record<string, ProviderConfig>;
  routing: RoutingConfig;
}
```

---

### Шаг 1.4: Создать загрузчик YAML конфигурации

**Цель**: Реализовать загрузку и валидацию YAML конфигурации роутера.

**Файлы для создания**:
- `src/config/router.config.ts`

**Зависимости**: `js-yaml`, `class-validator`, `class-transformer`

**Логика**:
1. Читать путь из `ROUTER_CONFIG_PATH` (default: `./config.yaml`)
2. Парсить YAML
3. Подставлять переменные окружения (`${VAR_NAME}`)
4. Валидировать структуру
5. Возвращать типизированный конфиг

---

### Шаг 1.5: Создать файлы конфигурации по умолчанию

**Цель**: Создать примеры YAML файлов.

**Файлы для создания**:
- `config.yaml.example`
- `models.yaml`

**Примечание**: `models.yaml` содержит реальный список бесплатных моделей OpenRouter.

---

### Шаг 1.6: Обновить переменные окружения

**Цель**: Добавить новые переменные в примеры.

**Файлы для изменения**:
- `env.production.example`
- `env.development.example`

**Добавить**:
```bash
ROUTER_CONFIG_PATH=./config.yaml
OPENROUTER_API_KEY=
DEEPSEEK_API_KEY=
```

---

## Фаза 2: Модуль моделей (Models)

### Шаг 2.1: Создать ModelsService

**Цель**: Сервис для загрузки и управления списком моделей.

**Файлы для создания**:
- `src/modules/models/models.service.ts`

**Методы**:
- `onModuleInit()` — загрузка моделей из YAML
- `getAll()` — все модели
- `getAvailable()` — только доступные
- `findByName(name: string)` — поиск по имени
- `filter(criteria: FilterCriteria)` — фильтрация по тегам, типу, контексту

---

### Шаг 2.2: Создать ModelsModule

**Цель**: NestJS модуль для моделей.

**Файлы для создания**:
- `src/modules/models/models.module.ts`

**Экспорты**: `ModelsService`

---

### Шаг 2.3: Unit тесты для ModelsService

**Цель**: Покрыть тестами основную логику.

**Файлы для создания**:
- `test/unit/modules/models/models.service.spec.ts`

**Тесты**:
- Загрузка моделей из YAML
- Фильтрация по тегам
- Фильтрация по типу
- Поиск по имени

---

## Фаза 3: Модуль провайдеров (Providers)

### Шаг 3.1: Создать базовый интерфейс провайдера

**Цель**: Определить контракт для всех провайдеров.

**Файлы для создания**:
- `src/modules/providers/interfaces/provider.interface.ts`

**Содержимое**:
```typescript
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string | string[];
  jsonMode?: boolean;
}

export interface ChatCompletionResult {
  id: string;
  model: string;
  content: string;
  finishReason: 'stop' | 'length' | 'content_filter';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LlmProvider {
  readonly name: string;
  chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult>;
}
```

---

### Шаг 3.2: Создать BaseProvider

**Цель**: Абстрактный класс с общей логикой для провайдеров.

**Файлы для создания**:
- `src/modules/providers/base.provider.ts`

**Логика**:
- Инициализация HttpService с baseUrl и headers
- Обработка ошибок HTTP
- Таймауты

---

### Шаг 3.3: Создать OpenRouterProvider

**Цель**: Реализация провайдера OpenRouter.

**Файлы для создания**:
- `src/modules/providers/openrouter.provider.ts`

**Особенности**:
- Endpoint: `POST /chat/completions`
- Headers: `Authorization: Bearer {api_key}`, `HTTP-Referer`, `X-Title`
- Маппинг запроса/ответа в OpenAI формат

---

### Шаг 3.4: Создать DeepSeekProvider

**Цель**: Реализация провайдера DeepSeek.

**Файлы для создания**:
- `src/modules/providers/deepseek.provider.ts`

**Особенности**:
- Endpoint: `POST /chat/completions`
- OpenAI-совместимый API
- Headers: `Authorization: Bearer {api_key}`

---

### Шаг 3.5: Создать ProvidersModule

**Цель**: NestJS модуль, регистрирующий провайдеров.

**Файлы для создания**:
- `src/modules/providers/providers.module.ts`

**Логика**:
- Динамическая регистрация провайдеров на основе конфига
- Фабрика для получения провайдера по имени

---

### Шаг 3.6: Unit тесты для провайдеров

**Цель**: Покрыть тестами провайдеров.

**Файлы для создания**:
- `test/unit/modules/providers/openrouter.provider.spec.ts`
- `test/unit/modules/providers/deepseek.provider.spec.ts`

**Тесты**:
- Успешный запрос
- Обработка ошибок (429, 500, timeout)
- Маппинг ответа

---

## Фаза 4: Модуль селектора (Selector)

### Шаг 4.1: Создать интерфейс стратегии выбора

**Цель**: Определить контракт для алгоритмов выбора.

**Файлы для создания**:
- `src/modules/selector/interfaces/selector.interface.ts`

**Содержимое**:
```typescript
export interface SelectionCriteria {
  model?: string;
  tags?: string[];
  type?: 'fast' | 'reasoning';
  minContextSize?: number;
  jsonResponse?: boolean;
  excludeModels?: string[];  // Для исключения уже попробованных
}

export interface SelectionStrategy {
  select(models: ModelDefinition[], criteria: SelectionCriteria): ModelDefinition | null;
}
```

---

### Шаг 4.2: Создать RoundRobinStrategy

**Цель**: Реализация round-robin алгоритма.

**Файлы для создания**:
- `src/modules/selector/strategies/round-robin.strategy.ts`

**Логика**:
- Хранить индекс последней выбранной модели
- При каждом вызове увеличивать индекс
- Учитывать фильтры и исключения

---

### Шаг 4.3: Создать SelectorService

**Цель**: Сервис для выбора модели.

**Файлы для создания**:
- `src/modules/selector/selector.service.ts`

**Методы**:
- `selectModel(criteria: SelectionCriteria): ModelDefinition | null`
- `selectNextModel(criteria: SelectionCriteria, excludeModels: string[]): ModelDefinition | null`

---

### Шаг 4.4: Создать SelectorModule

**Цель**: NestJS модуль для селектора.

**Файлы для создания**:
- `src/modules/selector/selector.module.ts`

**Зависимости**: `ModelsModule`

---

### Шаг 4.5: Unit тесты для SelectorService

**Цель**: Покрыть тестами логику выбора.

**Файлы для создания**:
- `test/unit/modules/selector/selector.service.spec.ts`
- `test/unit/modules/selector/round-robin.strategy.spec.ts`

**Тесты**:
- Round-robin выбор
- Фильтрация по критериям
- Исключение моделей
- Пустой результат при отсутствии подходящих моделей

---

## Фаза 5: Модуль роутера (Router)

### Шаг 5.1: Создать DTO для запроса

**Цель**: Валидация входящего запроса.

**Файлы для создания**:
- `src/modules/router/dto/chat-completion.request.dto.ts`

**Валидация**:
- `messages` — обязательный массив
- `temperature` — 0-2
- `max_tokens` — положительное число
- Кастомные поля роутера

---

### Шаг 5.2: Создать DTO для ответа

**Цель**: Типизация ответа.

**Файлы для создания**:
- `src/modules/router/dto/chat-completion.response.dto.ts`

---

### Шаг 5.3: Создать RouterService

**Цель**: Основная логика роутинга с fallback.

**Файлы для создания**:
- `src/modules/router/router.service.ts`

**Методы**:
- `chatCompletion(request: ChatCompletionRequestDto): Promise<ChatCompletionResponseDto>`

**Логика**:
1. Выбрать модель через SelectorService
2. Получить провайдер через ProvidersModule
3. Выполнить запрос
4. При ошибке 429 — повторить `maxSameModelRetries` раз с задержкой `retryDelay` (с jitter ±20%)
5. При других ошибках — retry с другой моделью
6. При исчерпании попыток — fallback на платную модель
7. Собрать информацию о попытках в `_router`

**Константы**:
- `RETRY_JITTER_PERCENT = 20` — захардкоженный процент jitter для задержки

---

### Шаг 5.4: Создать RouterController

**Цель**: HTTP endpoint для chat completions.

**Файлы для создания**:
- `src/modules/router/router.controller.ts`

**Endpoints**:
- `POST /v1/chat/completions`
- `GET /v1/models`

---

### Шаг 5.5: Создать RouterModule

**Цель**: NestJS модуль роутера.

**Файлы для создания**:
- `src/modules/router/router.module.ts`

**Зависимости**: `ModelsModule`, `ProvidersModule`, `SelectorModule`

---

### Шаг 5.6: Подключить RouterModule к AppModule

**Цель**: Интеграция в приложение.

**Файлы для изменения**:
- `src/app.module.ts`

---

### Шаг 5.7: Unit тесты для RouterService

**Цель**: Покрыть тестами логику роутинга.

**Файлы для создания**:
- `test/unit/modules/router/router.service.spec.ts`

**Тесты**:
- Успешный запрос с первой попытки
- Retry при ошибке 5xx/timeout с переходом к другой модели
- Retry при 429 с задержкой и jitter
- Fallback на платную модель
- Формирование `_router` в ответе

---

### Шаг 5.8: Unit тесты для RouterController

**Цель**: Покрыть тестами контроллер.

**Файлы для создания**:
- `test/unit/modules/router/router.controller.spec.ts`

**Тесты**:
- Валидация запроса
- Формат ответа

---

## Фаза 6: E2E тесты и финализация

### Шаг 6.1: E2E тесты для API

**Цель**: Интеграционные тесты всего flow.

**Файлы для создания**:
- `test/e2e/router.e2e-spec.ts`

**Тесты**:
- `POST /api/v1/chat/completions` — успешный запрос
- `GET /api/v1/models` — список моделей
- Обработка ошибок

---

### Шаг 6.2: Обновить README.md

**Цель**: Документация для пользователей.

**Секции**:
- Описание проекта
- Быстрый старт
- Конфигурация
- API Reference
- Примеры использования

---

### Шаг 6.3: Обновить CHANGELOG.md

**Цель**: Зафиксировать изменения.

**Файлы для изменения**:
- `docs/CHANGELOG.md`

---

## Чеклист для каждого шага

При выполнении каждого шага:

1. [ ] Создать/изменить указанные файлы
2. [ ] Следовать стилю существующего кода
3. [ ] Добавить JSDoc комментарии на английском
4. [ ] Использовать именованные экспорты
5. [ ] Для функций с 3+ аргументами использовать объект параметров
6. [ ] Запустить `pnpm lint` и исправить ошибки
7. [ ] Запустить `pnpm test` для unit тестов

---

## Порядок выполнения

```
Фаза 1: 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6
Фаза 2: 2.1 → 2.2 → 2.3
Фаза 3: 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6
Фаза 4: 4.1 → 4.2 → 4.3 → 4.4 → 4.5
Фаза 5: 5.1 → 5.2 → 5.3 → 5.4 → 5.5 → 5.6 → 5.7 → 5.8
Фаза 6: 6.1 → 6.2 → 6.3
```

Всего: **25 шагов**

Примерное время: 4-6 часов работы с AI-ассистентом.
