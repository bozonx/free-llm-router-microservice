# Free LLM Router Microservice

Микросервис для маршрутизации запросов к бесплатным LLM моделям через различных провайдеров с поддержкой автоматического fallback на платные модели.

## 🎯 Возможности

- 🤖 **OpenAI-совместимый API** — единый интерфейс для доступа к различным LLM
- 🔄 **Автоматический выбор модели** — round-robin rotation между доступными бесплатными моделями
- 🛡️ **Умный fallback** — автоматическое переключение на платную модель при исчерпании попыток
- 🎲 **Интеллектуальный retry** — обработка rate limits и других ошибок с jitter-задержкой
- 🏷️ **Гибкая фильтрация** — выбор моделей по тегам, типу, размеру контекста
- 📊 **Прозрачная метаинформация** — полная информация о попытках и ошибках в ответе
- 🚀 **Провайдеры** — OpenRouter (бесплатные модели) и DeepSeek (платная модель для fallback)

## 📋 Требования

- Node.js 22+
- pnpm 10+
- API ключи: OpenRouter и/или DeepSeek (опционально)

## ⚡ Быстрый старт

```bash
# 1) Установка зависимостей
pnpm install

# 2) Настройка конфигурации
cp router.yaml.example router.yaml
cp env.production.example .env.production

# 3) Настройте API ключи в .env.production
# OPENROUTER_API_KEY=your_key_here
# DEEPSEEK_API_KEY=your_key_here (опционально, для fallback)

# 4) Сборка и запуск
pnpm build
pnpm start:prod
```

URL по умолчанию: `http://localhost:8080/api/v1`

## 🔧 Конфигурация

### Переменные окружения

Основные переменные (`.env.production`):

```bash
# Основные настройки
NODE_ENV=production
LISTEN_HOST=0.0.0.0
LISTEN_PORT=8080
API_BASE_PATH=api
LOG_LEVEL=warn
TZ=UTC

# Путь к конфигу роутера
ROUTER_CONFIG_PATH=./router.yaml

# API ключи провайдеров
OPENROUTER_API_KEY=your_openrouter_key
DEEPSEEK_API_KEY=your_deepseek_key
```

### Конфигурация роутера

Основной конфиг (`router.yaml`):

```yaml
# Путь к файлу со списком моделей
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
  algorithm: round-robin
  maxRetries: 3              # Максимум попыток на бесплатных моделях
  rateLimitRetries: 2        # Максимум повторов при 429 для одной модели
  retryDelay: 1000           # Задержка между попытками (мс)
  timeout: 30000             # Таймаут запроса к провайдеру (мс)
  
  # Fallback на платную модель
  fallback:
    enabled: true
    provider: deepseek
    model: deepseek-chat
```

### Список моделей

Модели настраиваются в `models.yaml`. Пример:

```yaml
models:
  - name: deepseek-r1
    provider: openrouter
    model: deepseek/deepseek-r1:free
    type: reasoning
    contextSize: 64000
    maxOutputTokens: 8000
    speed: slow
    tags: [reasoning, code, math]
    jsonResponse: true
    available: true
```

## 📡 API Endpoints

### POST `/api/v1/chat/completions`

OpenAI-совместимый endpoint для chat completions.

#### Request Body

```typescript
{
  // Стандартные OpenAI поля (обязательные)
  "messages": [
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  
  // Опциональные OpenAI поля
  "temperature": 0.7,          // 0-2, default 1
  "max_tokens": 1000,          // Максимум токенов в ответе
  "top_p": 0.9,                // 0-1
  "frequency_penalty": 0.0,    // -2 to 2
  "presence_penalty": 0.0,     // -2 to 2
  "stop": ["END"],             // Stop sequences
  
  // Расширенные поля роутера
  "model": "llama-3.3-70b",    // Конкретная модель или "auto" (default)
  "tags": ["code"],            // Фильтр по тегам
  "type": "fast",              // Фильтр по типу: "fast" | "reasoning"
  "min_context_size": 32000,   // Минимальный размер контекста
  "json_response": true        // Требуется JSON ответ
}
```

#### Response Body

```typescript
{
  // Стандартные OpenAI поля
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677858242,
  "model": "meta-llama/llama-3.3-70b-instruct:free",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "I'm doing well, thank you for asking!"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  },
  
  // Метаданные роутера
  "_router": {
    "provider": "openrouter",
    "model_name": "llama-3.3-70b",
    "attempts": 1,
    "fallback_used": false, // Использовалась ли платная модель (fallback)
    "errors": []  // Ошибки предыдущих попыток (если были)
  }
}
```

### GET `/api/v1/models`

Получение списка доступных моделей.

#### Response Body

```typescript
{
  "models": [
    {
      "name": "llama-3.3-70b",
      "provider": "openrouter",
      "type": "fast",
      "context_size": 128000,
      "tags": ["general", "code"],
      "available": true
    },
    // ... другие модели
  ]
}
```

## 💡 Примеры использования

### Простой запрос

```bash
curl -X POST http://localhost:8080/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "What is 2+2?"}
    ]
  }'
```

### Запрос с фильтрацией

```bash
curl -X POST http://localhost:8080/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Write a Python function to sort a list"}
    ],
    "tags": ["code"],
    "type": "fast",
    "temperature": 0.5
  }'
```

### Выбор конкретной модели

```bash
curl -X POST http://localhost:8080/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Explain quantum computing"}
    ],
    "model": "deepseek-r1"
  }'
```

### Получение списка моделей

```bash
curl http://localhost:8080/api/v1/models
```

## 🔄 Логика работы

### Выбор модели

1. Если указан конкретный `model` — используем его
2. Иначе фильтруем модели по критериям (`tags`, `type`, `min_context_size`, `json_response`)
3. Применяем алгоритм выбора (round-robin)
4. Выполяем запрос к выбранной модели

### Обработка ошибок и fallback

1. При ошибке **429** (Rate Limit) — повторить до `rateLimitRetries` раз с задержкой
2. При ошибках **5xx/timeout** — переключиться на следующую модель
3. Повторяем до `maxRetries` попыток
4. Если все бесплатные модели исчерпаны и `fallback.enabled = true` — используем платную модель
5. Возвращаем результат с полной информацией о попытках в поле `_router`

### Обработка различных кодов ошибок

| Код ошибки | Действие |
|------------|----------|
| 429 (Rate Limit) | Повторить с задержкой + jitter, затем переход к следующей модели |
| 500-503 | Retry с другой моделью |
| Timeout | Retry с другой моделью |
| 400 (Bad Request) | Вернуть ошибку клиенту |
| 401/403 | Вернуть ошибку клиенту |
| 404 | Retry с другой моделью |

## 🧪 Тестирование

```bash
# Unit тесты
pnpm test

# E2E тесты
pnpm test:e2e

# Тесты с coverage
pnpm test:cov

# Линтинг
pnpm lint
```

См. подробности в `docs/dev.md`.

## 🐳 Docker

```bash
# Сборка приложения
pnpm build

# Запуск через Docker Compose
docker compose -f docker/docker-compose.yml up -d --build
```

После запуска: `http://localhost:8080/api/v1/health`

## 📚 Документация

- [PRD](dev_docs/prd.md) — Product Requirements Document
- [Implementation Plan](dev_docs/implementation-plan.md) — План реализации
- [Development Guide](docs/dev.md) — Руководство для разработчиков
- [CHANGELOG](docs/CHANGELOG.md) — История изменений

## 🧩 Архитектура

```
src/
├── config/              # Конфигурация приложения и роутера
├── modules/
│   ├── models/          # Управление списком моделей
│   ├── providers/       # Провайдеры LLM (OpenRouter, DeepSeek)
│   ├── selector/        # Алгоритмы выбора моделей
│   └── router/          # Основная логика роутинга
└── common/              # Общие утилиты и интерфейсы
```

## 🚀 Дорожная карта

### v1.1
- [ ] Streaming (SSE) поддержка
- [ ] Загрузка списка моделей по URL
- [ ] Vanilla UI для просмотра моделей и статистики

### v1.2
- [ ] Дополнительные алгоритмы выбора (random, weighted, least-errors, fastest-response)
- [ ] Статистика запросов
- [ ] Поддержка vision (изображения)
- [ ] Поддержка function calling / tools

### v1.3
- [ ] OpenTelemetry интеграция
- [ ] Кэширование ответов
- [ ] Мониторинг и алерты

## 📄 Лицензия

MIT
