# Smart Routing: План реализации

> Версия: 2.0  
> Автор: AI Assistant  
> Дата: 2025-12-13

## 📋 Обзор

Данный документ описывает план реализации "умного роутинга" для Free LLM Router Microservice. Цель — повысить отказоустойчивость, производительность и управляемость системы.

---

## 🎯 Цели

1. **Отказоустойчивость** — Circuit Breaker для автоматического исключения проблемных моделей
2. **Оптимальный выбор** — Умный алгоритм с учётом приоритетов, весов, статистики и фильтров запроса
3. **Защита от перегрузки** — Rate limiting на уровне клиентов и моделей
4. **Наблюдаемость** — API для мониторинга состояния системы
5. **Гибкость** — Конфигурируемые параметры через YAML с разумными дефолтами

---

## 🏗️ Архитектура

### Новые компоненты

```
src/modules/
├── state/                          # NEW: Модуль состояния
│   ├── state.module.ts
│   ├── state.service.ts            # In-memory state manager
│   ├── circuit-breaker.service.ts  # Circuit Breaker logic
│   ├── metrics.service.ts          # Latency/success tracking
│   └── interfaces/
│       └── state.interface.ts
│
├── rate-limiter/                   # NEW: Rate Limiting
│   ├── rate-limiter.module.ts
│   ├── rate-limiter.service.ts
│   ├── rate-limiter.guard.ts       # NestJS Guard
│   └── interfaces/
│       └── rate-limiter.interface.ts
│
├── selector/
│   ├── smart.strategy.ts           # NEW: Единый умный алгоритм выбора
│   ├── selector.service.ts         # Обновлённый сервис
│   └── interfaces/
│       └── selector.interface.ts
│
└── admin/                          # NEW: Admin API
    ├── admin.module.ts
    ├── admin.controller.ts         # GET /admin/state, /admin/metrics
    └── dto/
```

**Удаляемые компоненты:**
- `round-robin.strategy.ts` — заменяется на `smart.strategy.ts`

---

## 📦 Фаза 1: State Module (In-Memory State)

### 1.1 Интерфейсы состояния

```typescript
// src/modules/state/interfaces/state.interface.ts

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN' | 'PERMANENTLY_UNAVAILABLE';

export interface ModelState {
  /** Имя модели */
  name: string;
  
  /** Состояние Circuit Breaker */
  circuitState: CircuitState;
  
  /** Время перехода в OPEN (для расчёта cool-down) */
  openedAt?: number;
  
  /** Счётчик последовательных ошибок */
  consecutiveFailures: number;
  
  /** Счётчик последовательных успехов (для HALF_OPEN) */
  consecutiveSuccesses: number;
  
  /** Текущее количество активных запросов */
  activeRequests: number;
  
  /** Статистика за скользящее окно */
  stats: ModelStats;
}

export interface ModelStats {
  /** Общее количество запросов за окно */
  totalRequests: number;
  
  /** Успешные запросы */
  successCount: number;
  
  /** Ошибки */
  errorCount: number;
  
  /** Средняя latency (ms) */
  avgLatency: number;
  
  /** P95 latency (ms) */
  p95Latency: number;
  
  /** Success rate (0-1) */
  successRate: number;
  
  /** Данные запросов для скользящего окна */
  requests: RequestRecord[];
}

export interface RequestRecord {
  timestamp: number;
  latencyMs: number;
  success: boolean;
}
```

### 1.2 Обработка ошибок по типу

| Код ошибки | Действие | Состояние |
|------------|----------|-----------|
| **404 (Not Found)** | Модель не существует у провайдера | `PERMANENTLY_UNAVAILABLE` — не пробуем до рестарта |
| **429 (Rate Limit)** | Временная перегрузка | Retry с задержкой, затем Circuit Breaker |
| **5xx, Timeout** | Временная проблема | Circuit Breaker (CLOSED → OPEN) |
| **400, 401, 403** | Клиентская ошибка | Возврат ошибки клиенту, не влияет на Circuit Breaker |

### 1.3 StateService

```typescript
// src/modules/state/state.service.ts

@Injectable()
export class StateService implements OnModuleInit {
  private states: Map<string, ModelState> = new Map();
  
  /** Инициализация состояний для всех моделей */
  onModuleInit(): void;
  
  /** Получить состояние модели */
  getState(modelName: string): ModelState;
  
  /** Получить все состояния */
  getAllStates(): ModelState[];
  
  /** Записать успешный запрос */
  recordSuccess(modelName: string, latencyMs: number): void;
  
  /** Записать ошибку */
  recordFailure(modelName: string, errorCode?: number): void;
  
  /** Пометить модель как permanently unavailable (404) */
  markPermanentlyUnavailable(modelName: string): void;
  
  /** Увеличить счётчик активных запросов */
  incrementActiveRequests(modelName: string): void;
  
  /** Уменьшить счётчик активных запросов */
  decrementActiveRequests(modelName: string): void;
  
  /** Проверить, доступна ли модель */
  isAvailable(modelName: string): boolean;
  
  /** Сбросить состояние модели (для admin API) */
  resetState(modelName: string): void;
  
  /** Очистить устаревшие данные из скользящего окна */
  private cleanupStaleData(): void;
}
```

### 1.4 CircuitBreakerService

```typescript
// src/modules/state/circuit-breaker.service.ts

@Injectable()
export class CircuitBreakerService {
  constructor(
    private readonly stateService: StateService,
    @Inject(ROUTER_CONFIG) private readonly config: RouterConfig,
  ) {}
  
  /** Обработать успешный ответ */
  onSuccess(modelName: string, latencyMs: number): void {
    // 1. Записать успех в StateService
    // 2. Если HALF_OPEN и consecutiveSuccesses >= successThreshold -> CLOSED
    // 3. Сбросить consecutiveFailures
  }
  
  /** Обработать ошибку */
  onFailure(modelName: string, errorCode?: number): void {
    // 1. Если 404 -> markPermanentlyUnavailable
    // 2. Иначе: записать ошибку, увеличить consecutiveFailures
    // 3. Если consecutiveFailures >= failureThreshold -> OPEN
  }
  
  /** Проверить, можно ли делать запрос к модели */
  canRequest(modelName: string): boolean {
    // 1. PERMANENTLY_UNAVAILABLE -> false
    // 2. CLOSED -> true
    // 3. OPEN -> проверить cooldown, если истёк -> HALF_OPEN, return true
    // 4. HALF_OPEN -> true (пробный запрос)
  }
  
  /** Получить список доступных моделей */
  filterAvailable(models: ModelDefinition[]): ModelDefinition[] {
    return models.filter(m => this.canRequest(m.name));
  }
}
```

---

## 📦 Фаза 2: Умный алгоритм выбора (Smart Strategy)

### 2.1 Конфигурация моделей

**models.yaml** (базовые настройки модели):

```yaml
models:
  - name: llama-3.3-70b
    provider: openrouter
    model: meta-llama/llama-3.3-70b-instruct:free
    type: fast
    contextSize: 128000
    tags: [general, code]
    jsonResponse: true
    available: true
    # Новые поля (опциональные, есть дефолты)
    priority: 1             # Приоритет (меньше = выше), default: 1
    weight: 10              # Статический вес (1-100), default: 1
    maxConcurrent: 5        # Макс. параллельных запросов, default: unlimited
    
  - name: deepseek-r1
    provider: openrouter
    model: deepseek/deepseek-r1:free
    type: reasoning
    priority: 2
    weight: 5
    maxConcurrent: 3
```

**router.yaml** (переопределение приоритетов, опционально):

```yaml
# Переопределение приоритетов моделей (опционально)
# Позволяет пользователю менять приоритеты без редактирования models.yaml
modelOverrides:
  llama-3.3-70b:
    priority: 2        # Понизить приоритет
  deepseek-r1:
    priority: 1        # Повысить приоритет
    weight: 15
```

### 2.2 Расширенные критерии выбора в запросе

```typescript
// src/modules/router/dto/chat-completion.request.dto.ts

export class ChatCompletionRequestDto {
  // Существующие поля
  messages: Message[];
  model?: string;
  tags?: string[];
  type?: 'fast' | 'reasoning';
  min_context_size?: number;
  json_response?: boolean;
  
  // ... стандартные OpenAI поля ...
  
  // Новые поля для умного выбора
  /**
   * Предпочитать модели с наименьшей latency
   * Если true, выбирает модель с лучшим avgLatency из доступных
   */
  prefer_fast?: boolean;
  
  /**
   * Минимальный success rate модели (0-1)
   * Отфильтрует модели с success rate ниже указанного
   */
  min_success_rate?: number;
}
```

### 2.3 SmartStrategy (Единый алгоритм)

```typescript
// src/modules/selector/smart.strategy.ts

/**
 * Умный алгоритм выбора модели.
 * Заменяет round-robin и учитывает:
 * - Circuit Breaker состояние
 * - Приоритеты (из models.yaml + переопределения из router.yaml)
 * - Веса моделей
 * - Статистику (latency, success rate)
 * - Фильтры из запроса (tags, type, min_context_size, prefer_fast, min_success_rate)
 * - Защиту от перегрузки (maxConcurrent)
 */
@Injectable()
export class SmartStrategy implements SelectionStrategy {
  constructor(
    private readonly stateService: StateService,
    private readonly circuitBreaker: CircuitBreakerService,
    @Inject(ROUTER_CONFIG) private readonly config: RouterConfig,
  ) {}
  
  select(models: ModelDefinition[], criteria: SelectionCriteria): ModelDefinition | null {
    // 1. Базовая фильтрация (tags, type, min_context_size, json_response)
    let candidates = this.filterByCriteria(models, criteria);
    
    // 2. Фильтрация по Circuit Breaker (исключить OPEN и PERMANENTLY_UNAVAILABLE)
    candidates = this.circuitBreaker.filterAvailable(candidates);
    
    // 3. Фильтрация по maxConcurrent
    candidates = this.filterByCapacity(candidates);
    
    // 4. Фильтрация по min_success_rate (если указан в запросе)
    if (criteria.minSuccessRate) {
      candidates = this.filterBySuccessRate(candidates, criteria.minSuccessRate);
    }
    
    // 5. Если ничего не осталось — вернуть null (будет fallback)
    if (candidates.length === 0) {
      return null;
    }
    
    // 6. Если prefer_fast — выбрать модель с наименьшей latency
    if (criteria.preferFast) {
      return this.selectFastest(candidates);
    }
    
    // 7. Применить приоритеты (из models.yaml + переопределения router.yaml)
    const withPriorities = this.applyPriorityOverrides(candidates);
    
    // 8. Сгруппировать по приоритету
    const priorityGroups = this.groupByPriority(withPriorities);
    
    // 9. Взять группу с наивысшим приоритетом (минимальное значение priority)
    const topPriorityGroup = priorityGroups[0];
    
    // 10. Внутри группы — weighted random selection
    return this.weightedRandomSelect(topPriorityGroup);
  }
  
  private filterByCapacity(models: ModelDefinition[]): ModelDefinition[] {
    return models.filter(m => {
      const state = this.stateService.getState(m.name);
      const maxConcurrent = m.maxConcurrent ?? Infinity;
      return state.activeRequests < maxConcurrent;
    });
  }
  
  private filterBySuccessRate(models: ModelDefinition[], minRate: number): ModelDefinition[] {
    return models.filter(m => {
      const state = this.stateService.getState(m.name);
      // Если нет статистики — считаем success rate = 1.0 (даём шанс)
      const successRate = state.stats.totalRequests > 0 ? state.stats.successRate : 1.0;
      return successRate >= minRate;
    });
  }
  
  private selectFastest(models: ModelDefinition[]): ModelDefinition {
    return models.reduce((fastest, current) => {
      const fastestLatency = this.stateService.getState(fastest.name).stats.avgLatency || Infinity;
      const currentLatency = this.stateService.getState(current.name).stats.avgLatency || Infinity;
      return currentLatency < fastestLatency ? current : fastest;
    });
  }
  
  private applyPriorityOverrides(models: ModelDefinition[]): ModelWithEffectivePriority[] {
    return models.map(m => {
      const override = this.config.modelOverrides?.[m.name];
      return {
        ...m,
        effectivePriority: override?.priority ?? m.priority ?? 1,
        effectiveWeight: override?.weight ?? m.weight ?? 1,
      };
    });
  }
  
  private groupByPriority(models: ModelWithEffectivePriority[]): ModelWithEffectivePriority[][] {
    // Сортировка по приоритету (меньше = выше)
    const sorted = [...models].sort((a, b) => a.effectivePriority - b.effectivePriority);
    
    // Группировка
    const groups: ModelWithEffectivePriority[][] = [];
    let currentPriority = -1;
    
    for (const model of sorted) {
      if (model.effectivePriority !== currentPriority) {
        groups.push([]);
        currentPriority = model.effectivePriority;
      }
      groups[groups.length - 1].push(model);
    }
    
    return groups;
  }
  
  private weightedRandomSelect(models: ModelWithEffectivePriority[]): ModelDefinition | null {
    if (models.length === 0) return null;
    if (models.length === 1) return models[0];
    
    // Рассчитать эффективный вес с учётом статистики
    const weighted = models.map(m => ({
      model: m,
      weight: this.calculateEffectiveWeight(m),
    }));
    
    const totalWeight = weighted.reduce((sum, i) => sum + i.weight, 0);
    if (totalWeight === 0) return models[0]; // fallback to first
    
    let random = Math.random() * totalWeight;
    for (const item of weighted) {
      random -= item.weight;
      if (random <= 0) return item.model;
    }
    
    return models[models.length - 1];
  }
  
  private calculateEffectiveWeight(model: ModelWithEffectivePriority): number {
    const state = this.stateService.getState(model.name);
    const staticWeight = model.effectiveWeight;
    
    // Если нет статистики — используем только статический вес
    if (state.stats.totalRequests === 0) {
      return staticWeight;
    }
    
    const successRate = state.stats.successRate;
    // Нормализация latency: чем меньше latency, тем выше множитель
    const latencyFactor = 1000 / Math.max(state.stats.avgLatency, 100);
    
    return staticWeight * successRate * latencyFactor;
  }
}
```

---

## 📦 Фаза 3: Rate Limiting

### 3.1 Конфигурация в router.yaml

```yaml
rateLimiting:
  enabled: false  # По умолчанию выключен
  
  # Глобальный лимит (все клиенты суммарно)
  global:
    requestsPerMinute: 100
    
  # Лимит на клиента (по X-Client-ID header)
  perClient:
    enabled: true
    requestsPerMinute: 20
    burstSize: 5              # Разрешённый "всплеск" запросов
    
  # Лимит на модель (защита от перекоса)
  perModel:
    enabled: true
    requestsPerMinute: 30
```

### 3.2 RateLimiterService

```typescript
// src/modules/rate-limiter/rate-limiter.service.ts

@Injectable()
export class RateLimiterService {
  // Token Bucket алгоритм
  
  /** Проверить глобальный лимит */
  checkGlobal(): boolean;
  
  /** Проверить лимит клиента */
  checkClient(clientId: string): boolean;
  
  /** Проверить лимит модели */
  checkModel(modelName: string): boolean;
  
  /** Получить информацию о лимитах */
  getRateLimitInfo(clientId?: string): RateLimitInfo;
}
```

### 3.3 Заголовки ответа

Добавляются в **каждый ответ** API (успешный или 429):

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 17
X-RateLimit-Reset: 1702469100
```

При превышении лимита:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1702469100

{
  "error": {
    "message": "Rate limit exceeded",
    "type": "rate_limit_error"
  }
}
```

---

## 📦 Фаза 4: Admin API

### 4.1 Эндпоинты

```
GET  /admin/state              # Состояние всех моделей
GET  /admin/state/:modelName   # Состояние конкретной модели
POST /admin/state/:modelName/reset  # Сбросить состояние модели
GET  /admin/metrics            # Общие метрики системы
GET  /admin/rate-limits        # Статус rate limiting
```

### 4.2 Примеры ответов

```typescript
// GET /admin/state
{
  "models": [
    {
      "name": "llama-3.3-70b",
      "provider": "openrouter",
      "circuitState": "CLOSED",
      "effectivePriority": 1,
      "effectiveWeight": 10,
      "activeRequests": 2,
      "stats": {
        "totalRequests": 150,
        "successCount": 145,
        "errorCount": 5,
        "successRate": 0.967,
        "avgLatency": 2340,
        "p95Latency": 4500
      }
    },
    {
      "name": "old-model",
      "provider": "openrouter",
      "circuitState": "PERMANENTLY_UNAVAILABLE",
      "reason": "404 Not Found"
    }
  ],
  "timestamp": "2025-12-13T12:30:00Z"
}
```

```typescript
// GET /admin/metrics
{
  "uptime": 86400,
  "totalRequests": 5000,
  "successfulRequests": 4850,
  "failedRequests": 150,
  "fallbacksUsed": 45,
  "avgLatency": 2100,
  "modelsAvailable": 5,
  "modelsInOpenState": 1,
  "modelsPermanentlyUnavailable": 1,
  "activeConnections": 5
}
```

---

## 📦 Фаза 5: Graceful Degradation

### 5.1 Поведение при отсутствии доступных моделей

Если все модели в состоянии OPEN или PERMANENTLY_UNAVAILABLE:

```typescript
// В RouterService

if (availableModels.length === 0) {
  // Сразу переключаемся на fallback (платную модель)
  if (this.config.routing.fallback.enabled) {
    this.logger.warn('All free models unavailable, using paid fallback');
    return this.executeFallback(request, errors);
  }
  
  // Если fallback отключен — возвращаем 503
  throw new ServiceUnavailableException('All models are currently unavailable');
}
```

**Никаких `force_half_open`** — упрощаем логику. Если всё сломано, пусть платная модель спасает.

---

## 📦 Фаза 6: Конфигурация

### 6.1 Полный router.yaml

```yaml
modelsFile: ./models.yaml

providers:
  openrouter:
    enabled: true
    apiKey: ${OPENROUTER_API_KEY}
    baseUrl: https://openrouter.ai/api/v1
  deepseek:
    enabled: true
    apiKey: ${DEEPSEEK_API_KEY}
    baseUrl: https://api.deepseek.com

routing:
  maxRetries: 3
  rateLimitRetries: 2
  retryDelay: 1000
  timeout: 30000
  
  fallback:
    enabled: true
    provider: deepseek
    model: deepseek-chat

# Переопределение приоритетов моделей (опционально)
modelOverrides:
  # llama-3.3-70b:
  #   priority: 2
  #   weight: 5

# Настройки Circuit Breaker (опционально, есть дефолты)
circuitBreaker:
  failureThreshold: 3       # Ошибок для перехода в OPEN (default: 3)
  cooldownPeriod: 60000     # Время в OPEN, мс (default: 60000)
  successThreshold: 2       # Успехов для выхода из HALF_OPEN (default: 2)
  statsWindowSize: 300000   # Окно статистики, мс (default: 300000 = 5 мин)

# Rate Limiting (опционально, по умолчанию выключен)
rateLimiting:
  enabled: false
  global:
    requestsPerMinute: 100
  perClient:
    enabled: true
    requestsPerMinute: 20
    burstSize: 5
  perModel:
    enabled: true
    requestsPerMinute: 30
```

### 6.2 Дефолтные значения (в коде)

| Параметр | Дефолт | Описание |
|----------|--------|----------|
| `model.priority` | 1 | Приоритет модели (меньше = выше) |
| `model.weight` | 1 | Статический вес |
| `model.maxConcurrent` | Infinity | Без ограничений |
| `circuitBreaker.failureThreshold` | 3 | Ошибок до OPEN |
| `circuitBreaker.cooldownPeriod` | 60000 | 1 минута в OPEN |
| `circuitBreaker.successThreshold` | 2 | Успехов для выхода из HALF_OPEN |
| `circuitBreaker.statsWindowSize` | 300000 | 5 минут статистики |
| `rateLimiting.enabled` | false | Rate limiting выключен |

---

## 📋 Порядок реализации

### Этап 1: Основа (Приоритет: Высокий)
1. **State Module** — интерфейсы, StateService
2. **Circuit Breaker** — логика CLOSED/OPEN/HALF_OPEN/PERMANENTLY_UNAVAILABLE
3. **Обработка 404** — переход в PERMANENTLY_UNAVAILABLE
4. Интеграция с RouterService

### Этап 2: Умный выбор (Приоритет: Высокий)
5. **SmartStrategy** — единый алгоритм выбора
6. Удаление round-robin.strategy.ts
7. Обновление models.yaml (priority, weight, maxConcurrent)
8. Поддержка modelOverrides в router.yaml
9. Новые фильтры в запросе (prefer_fast, min_success_rate)

### Этап 3: Защита (Приоритет: Средний)
10. **Rate Limiter Module** — Token Bucket
11. **RateLimiterGuard** — интеграция с NestJS
12. Заголовки X-RateLimit-* и Retry-After

### Этап 4: Наблюдаемость (Приоритет: Средний)
13. **Admin Module** — контроллер и DTO
14. Эндпоинты /admin/state, /admin/metrics, /admin/rate-limits

### Этап 5: Документация и тесты
15. Обновление README.md
16. Unit тесты для новых модулей
17. E2E тесты для сценариев отказа

---

## ⚠️ Осознанные ограничения

1. **In-Memory State** — состояние сбрасывается при рестарте сервиса.  
   *Обоснование:* Для простоты. Redis-backed state можно добавить позже.

2. **PERMANENTLY_UNAVAILABLE сбрасывается при рестарте** — если модель вернула 404, она не будет использоваться до перезапуска сервиса.  
   *Обоснование:* 404 означает "модель не существует" — это обычно факт, а не временная проблема.

3. **Нет отдельного Health Check провайдеров** — используем пассивный мониторинг через ошибки.  
   *Обоснование:* Экономия запросов, Circuit Breaker справляется.

4. **Нет персистентной статистики** — метрики живут только в памяти.  
   *Обоснование:* Для длительного хранения использовать OpenTelemetry/Prometheus.

5. **Один алгоритм выбора (SmartStrategy)** — round-robin удаляется.  
   *Обоснование:* Smart покрывает все сценарии и учитывает глобальный стейт.

---

## 📊 Оценка трудозатрат

| Этап | Компонент | Сложность | Часы |
|------|-----------|-----------|------|
| 1 | State Module + Circuit Breaker | Средняя | 6-8 |
| 2 | SmartStrategy + Фильтры | Средняя | 6-8 |
| 3 | Rate Limiter | Средняя | 4-6 |
| 4 | Admin API | Низкая | 3-4 |
| 5 | Тесты + Документация | Средняя | 6-8 |
| **Итого** | | | **25-34** |

---

## 🔗 Связанные документы

- [PRD](./prd.md)
- [Implementation Plan](./implementation-plan.md)
- [Development Guide](../docs/dev.md)
