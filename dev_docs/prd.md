# PRD: Free LLM Router Microservice

## Обзор

Микросервис для маршрутизации запросов к бесплатным LLM моделям через различных провайдеров. Основная цель — абстрагировать клиента от конкретного провайдера и обеспечить надёжную доставку запросов с автоматическим fallback.

## Цели MVP

1. Единый API совместимый с OpenAI Chat Completions для доступа к бесплатным LLM
2. Smart Strategy для выбора модели
3. Fallback при ошибках с финальным переключением на платную модель
4. Поддержка провайдеров: OpenRouter (бесплатные модели), DeepSeek и OpenRouter (платные модели для fallback)

---

## Архитектура

### Модули

```
src/
├── config/
│   ├── app.config.ts           # Существующий конфиг приложения
│   └── router.config.ts        # Конфиг роутера (загрузка YAML)
├── modules/
│   ├── health/                 # Существующий модуль
│   ├── router/                 # Основной модуль роутинга
│   │   ├── router.module.ts
│   │   ├── router.controller.ts
│   │   ├── router.service.ts
│   │   ├── dto/
│   │   │   ├── chat-completion.request.dto.ts
│   │   │   └── chat-completion.response.dto.ts
│   │   └── interfaces/
│   │       └── router.interfaces.ts
│   ├── models/                 # Управление списком моделей
│   │   ├── models.module.ts
│   │   ├── models.service.ts
│   │   └── interfaces/
│   │       └── model.interface.ts
│   ├── providers/              # Провайдеры LLM
│   │   ├── providers.module.ts
│   │   ├── base-provider.ts
│   │   ├── openrouter.provider.ts
│   │   └── deepseek.provider.ts
│   └── selector/               # Алгоритмы выбора
│       ├── selector.module.ts
│       ├── selector.service.ts
│       └── strategies/
│           └── smart.strategy.ts
└── common/
    ├── filters/                # Существующий
    └── interfaces/
        └── common.interfaces.ts
```

---

## API Endpoints

### POST `/api/v1/chat/completions`

OpenAI-совместимый endpoint для chat completions.

#### Request Body

```typescript
interface ChatCompletionRequest {
  // Стандартные OpenAI поля
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  
  // Опциональные OpenAI поля
  temperature?: number;        // 0-2, default 1
  max_tokens?: number;         // Максимум токенов в ответе
  top_p?: number;              // 0-1
  frequency_penalty?: number;  // -2 to 2
  presence_penalty?: number;   // -2 to 2
  stop?: string | string[];    // Stop sequences
  
  // Расширенные поля роутера
  model?: string;              // Конкретная модель или "auto" (default)
  tags?: string[];             // Фильтр по тегам
  type?: 'fast' | 'reasoning'; // Фильтр по типу
  min_context_size?: number;   // Минимальный размер контекста
  response_format?: { type: 'text' | 'json_object' | 'json_schema'; json_schema?: unknown }; // Требуется JSON ответ
}
```

#### Response Body

```typescript
interface ChatCompletionResponse {
  // Стандартные OpenAI поля
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;               // Реальное имя использованной модели
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: 'stop' | 'length' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  
  // Расширенные поля роутера
  _router: {
    provider: string;          // Использованный провайдер
    model_name: string;        // Унифицированное имя модели
    attempts: number;          // Количество попыток
    fallback_used: boolean;    // Использован ли платный fallback
    errors?: Array<{           // Ошибки предыдущих попыток
      provider: string;
      model: string;
      error: string;
      code?: number;
    }>;
  };
}
```

### GET `/api/v1/models`

Получение списка доступных моделей.

```typescript
interface ModelsResponse {
  models: Array<{
    name: string;
    provider: string;
    type: 'fast' | 'reasoning';
    contextSize: number;
    tags: string[];
    available: boolean;
  }>;
}
```

---

## Конфигурация

### Переменные окружения

```bash
# Существующие
NODE_ENV=production
LISTEN_HOST=0.0.0.0
LISTEN_PORT=8080
LOG_LEVEL=warn

# Новые
ROUTER_CONFIG_PATH=./config.yaml  # Путь к конфигу роутера
```

### Конфиг роутера (`config.yaml`)

```yaml
# Путь к файлу со списком моделей (опционально, по умолчанию берется из корня репозитория models_file.yaml)
modelsFile: ./models.yaml

# Настройки провайдеров
providers:
  openrouter:
    enabled: true
    apiKey: ${OPENROUTER_API_KEY}
    baseUrl: https://openrouter.ai/api/v1
    
  deepseek:
    enabled: true
    apiKey: ${DEEPSEEK_API_KEY}
    baseUrl: https://api.deepseek.com

# Настройки роутинга
routing:
  # Smart Strategy для выбора модели (алгоритм реализован в коде, без отдельного поля в конфиге)
  
  # Максимум попыток на бесплатных моделях
  maxModelSwitches: 3
  
  # Максимум повторов при 429 ошибке для одной модели
  maxSameModelRetries: 2
  
  # Задержка между попытками (мс)
  retryDelay: 1000
  # Jitter ±20% захардкожен в константе RETRY_JITTER_PERCENT
  
  # Таймаут запроса к провайдеру (мс)
  timeoutSecs: 30
  
  # Fallback на платную модель
  fallback:
    enabled: true
    provider: deepseek        # или openrouter
    model: deepseek-chat      # модель для fallback
```

### Список моделей (`models.yaml`)

```yaml
models:
  - name: deepseek-r1           # Унифицированное имя
    provider: openrouter
    model: deepseek/deepseek-r1:free
    type: reasoning
    contextSize: 64000
    maxOutputTokens: 8000
    tags: [reasoning, code, math]
    jsonResponse: true
    available: true
    
  - name: llama-3.3-70b
    provider: openrouter
    model: meta-llama/llama-3.3-70b-instruct:free
    type: fast
    contextSize: 128000
    maxOutputTokens: 4096
    tags: [general, code]
    jsonResponse: true
    available: true
    
  # ... другие модели
```

---

## Параметры модели

| Параметр | Тип | Описание |
|----------|-----|----------|
| `name` | string | Унифицированное имя модели |
| `provider` | string | Имя провайдера (openrouter, deepseek) |
| `model` | string | Реальный ID модели у провайдера |
| `type` | enum | fast / reasoning |
| `contextSize` | number | Размер контекста в токенах |
| `maxOutputTokens` | number | Максимум токенов в ответе |
| `tags` | string[] | Теги для фильтрации |
| `jsonResponse` | boolean | Поддержка JSON mode |
| `available` | boolean | Доступна ли модель |

---

## Логика работы

### Выбор модели

1. Получаем запрос с фильтрами (tags, type, min_context_size, model)
2. Если указан конкретный `model` — используем его, она может быть у нескольких провайдеров, выбор провайдера по указанному алгоритму в auto
3. Иначе фильтруем доступные модели по критериям
4. Применяем Smart Strategy для выбора модели

### Fallback

1. Делаем запрос к выбранной модели
2. При ошибке (5xx, timeout, rate limit) — выбираем следующую модель
3. Повторяем до `maxModelSwitches`
4. Если все попытки исчерпаны и `fallback.enabled` — делаем запрос к платной модели
5. Возвращаем результат с информацией о попытках в `_router`

### Обработка ошибок

| Код ошибки | Действие |
|------------|----------|
| 429 (Rate Limit) | Повторить `maxSameModelRetries` раз с задержкой, затем переход к следующей модели |
| 500-503 | Retry с другой моделью |
| Timeout | Retry с другой моделью |
| 400 (Bad Request) | Вернуть ошибку клиенту |
| 401/403 | Вернуть ошибку клиенту |
| 404 | Retry с другой моделью |

---

## Отложено на будущие версии

### v1.1
- [ ] Streaming (SSE) поддержка
- [ ] Загрузка списка моделей по URL
- [ ] Vanilla UI для просмотра моделей

### v1.2
- [ ] Алгоритмы выбора: random, weighted, least-errors, fastest-response
- [ ] Статистика запросов и выбор на основе статистики
- [ ] Поддержка vision (изображения)
- [ ] Поддержка function calling / tools

### v1.3
- [ ] OpenTelemetry интеграция для метрик, трейсинга и алертов
- [ ] Кэширование ответов

---

## Технические требования

- **Node.js**: 22
- **Framework**: NestJS + Fastify
- **Package Manager**: pnpm
- **Формат конфигов**: YAML
- **Тестирование**: Jest (unit + e2e)
- **Логирование**: Pino (уже настроен)

---

## Примечания

### Webhook vs OpenTelemetry

Для уведомлений о проблемах с моделями рекомендуется использовать **OpenTelemetry**:
- Стандартизированный подход
- Интеграция с существующей инфраструктурой мониторинга
- Возможность настройки алертов в Grafana/Prometheus
- Не требует дополнительной логики в микросервисе

Webhook можно добавить как опциональную фичу для простых случаев, но это увеличивает сложность и создаёт дополнительную точку отказа.


