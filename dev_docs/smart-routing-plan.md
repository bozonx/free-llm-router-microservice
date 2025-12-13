# Smart Routing: План реализации

> Версия: 1.0  
> Автор: AI Assistant  
> Дата: 2025-12-13

## 📋 Обзор

Данный документ описывает план реализации "умного роутинга" для Free LLM Router Microservice. Цель — повысить отказоустойчивость, производительность и управляемость системы.

---

## 🎯 Цели

1. **Отказоустойчивость** — Circuit Breaker для автоматического исключения проблемных моделей
2. **Оптимальный выбор** — Weighted алгоритм с учётом производительности и надёжности
3. **Защита от перегрузки** — Rate limiting на уровне клиентов и моделей
4. **Наблюдаемость** — API для мониторинга состояния системы
5. **Гибкость** — Конфигурируемые параметры через YAML

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
│   ├── strategies/
│   │   ├── round-robin.strategy.ts    # Существующий
│   │   ├── weighted.strategy.ts       # NEW: Weighted selection
│   │   └── smart.strategy.ts          # NEW: Combined strategy
│   └── ...
│
└── admin/                          # NEW: Admin API
    ├── admin.module.ts
    ├── admin.controller.ts         # GET /admin/state, /admin/metrics
    └── dto/
```

---

## 📦 Фаза 1: State Module (In-Memory State)

### 1.1 Интерфейсы состояния

```typescript
// src/modules/state/interfaces/state.interface.ts

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

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
  
  /** Временные метки запросов для скользящего окна */
  requestTimestamps: number[];
}

export interface CircuitBreakerConfig {
  /** Порог ошибок для перехода в OPEN */
  failureThreshold: number;  // default: 3
  
  /** Время в OPEN состоянии (ms) */
  cooldownPeriod: number;    // default: 60000 (1 min)
  
  /** Успехов для перехода из HALF_OPEN в CLOSED */
  successThreshold: number;  // default: 2
  
  /** Размер скользящего окна (ms) */
  statsWindowSize: number;   // default: 300000 (5 min)
}
```

### 1.2 StateService

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
  
  /** Увеличить счётчик активных запросов */
  incrementActiveRequests(modelName: string): void;
  
  /** Уменьшить счётчик активных запросов */
  decrementActiveRequests(modelName: string): void;
  
  /** Проверить, доступна ли модель (CLOSED или HALF_OPEN) */
  isAvailable(modelName: string): boolean;
  
  /** Сбросить состояние модели (для admin API) */
  resetState(modelName: string): void;
  
  /** Очистить устаревшие данные из скользящего окна */
  private cleanupStaleData(): void;
}
```

### 1.3 CircuitBreakerService

```typescript
// src/modules/state/circuit-breaker.service.ts

@Injectable()
export class CircuitBreakerService {
  constructor(
    private readonly stateService: StateService,
    @Inject(CIRCUIT_BREAKER_CONFIG) private readonly config: CircuitBreakerConfig,
  ) {}
  
  /** Обработать успешный ответ */
  onSuccess(modelName: string, latencyMs: number): void {
    // 1. Записать успех в StateService
    // 2. Если HALF_OPEN и consecutiveSuccesses >= successThreshold -> CLOSED
    // 3. Сбросить consecutiveFailures
  }
  
  /** Обработать ошибку */
  onFailure(modelName: string, errorCode?: number): void {
    // 1. Записать ошибку в StateService
    // 2. Увеличить consecutiveFailures
    // 3. Если consecutiveFailures >= failureThreshold -> OPEN
    // 4. Сбросить consecutiveSuccesses
  }
  
  /** Проверить, можно ли делать запрос к модели */
  canRequest(modelName: string): boolean {
    // 1. CLOSED -> true
    // 2. OPEN -> проверить cooldown, если истёк -> HALF_OPEN, return true
    // 3. HALF_OPEN -> true (пробный запрос)
  }
  
  /** Получить список доступных моделей */
  filterAvailable(models: ModelDefinition[]): ModelDefinition[] {
    return models.filter(m => this.canRequest(m.name));
  }
}
```

---

## 📦 Фаза 2: Weighted Selection Strategy

### 2.1 Конфигурация весов в models.yaml

```yaml
models:
  - name: llama-3.3-70b
    provider: openrouter
    model: meta-llama/llama-3.3-70b-instruct:free
    weight: 10              # NEW: Статический вес (1-100)
    priority: 1             # NEW: Приоритет (меньше = выше)
    maxConcurrent: 5        # NEW: Макс. параллельных запросов
    # ... остальные поля
    
  - name: deepseek-r1
    provider: openrouter
    model: deepseek/deepseek-r1:free
    weight: 5
    priority: 2
    maxConcurrent: 3
```

### 2.2 WeightedStrategy

```typescript
// src/modules/selector/strategies/weighted.strategy.ts

@Injectable()
export class WeightedStrategy implements SelectionStrategy {
  constructor(
    private readonly stateService: StateService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}
  
  select(models: ModelDefinition[], criteria: SelectionCriteria): ModelDefinition | null {
    // 1. Отфильтровать модели через CircuitBreaker
    const available = this.circuitBreaker.filterAvailable(models);
    
    // 2. Отфильтровать по maxConcurrent
    const notOverloaded = available.filter(m => {
      const state = this.stateService.getState(m.name);
      return state.activeRequests < (m.maxConcurrent ?? Infinity);
    });
    
    // 3. Рассчитать эффективный вес
    // effectiveWeight = staticWeight * successRate * (1 / avgLatency)
    const weighted = notOverloaded.map(m => ({
      model: m,
      effectiveWeight: this.calculateEffectiveWeight(m),
    }));
    
    // 4. Выбрать модель с учётом весов (weighted random)
    return this.weightedRandomSelect(weighted);
  }
  
  private calculateEffectiveWeight(model: ModelDefinition): number {
    const state = this.stateService.getState(model.name);
    const staticWeight = model.weight ?? 1;
    const successRate = state.stats.successRate || 0.5; // default 50%
    const latencyFactor = 1000 / (state.stats.avgLatency || 1000); // normalize
    
    return staticWeight * successRate * latencyFactor;
  }
  
  private weightedRandomSelect(items: Array<{model: ModelDefinition; effectiveWeight: number}>): ModelDefinition | null {
    const totalWeight = items.reduce((sum, i) => sum + i.effectiveWeight, 0);
    if (totalWeight === 0) return null;
    
    let random = Math.random() * totalWeight;
    for (const item of items) {
      random -= item.effectiveWeight;
      if (random <= 0) return item.model;
    }
    return items[items.length - 1]?.model ?? null;
  }
}
```

### 2.3 SmartStrategy (Комбинированный)

```typescript
// src/modules/selector/strategies/smart.strategy.ts

/**
 * Комбинирует:
 * - Circuit Breaker (исключение проблемных)
 * - Приоритеты (сначала высокоприоритетные)
 * - Weighted selection (в рамках одного приоритета)
 * - Защита от перегрузки (maxConcurrent)
 */
@Injectable()
export class SmartStrategy implements SelectionStrategy {
  select(models: ModelDefinition[], criteria: SelectionCriteria): ModelDefinition | null {
    // 1. Filter by Circuit Breaker
    // 2. Filter by maxConcurrent
    // 3. Group by priority
    // 4. For highest priority group with available models: weighted random
  }
}
```

---

## 📦 Фаза 3: Rate Limiting

### 3.1 Конфигурация в router.yaml

```yaml
rateLimiting:
  enabled: true
  
  # Глобальный лимит (все клиенты суммарно)
  global:
    requestsPerMinute: 100
    
  # Лимит на клиента (по X-Client-ID)
  perClient:
    enabled: true
    requestsPerMinute: 20
    burstSize: 5              # Разрешённый "всплеск" запросов
    
  # Лимит на модель
  perModel:
    enabled: true
    requestsPerMinute: 30     # Защита от перекоса
```

### 3.2 RateLimiterService

```typescript
// src/modules/rate-limiter/rate-limiter.service.ts

@Injectable()
export class RateLimiterService {
  // Token Bucket или Sliding Window алгоритм
  
  /** Проверить глобальный лимит */
  checkGlobal(): boolean;
  
  /** Проверить лимит клиента */
  checkClient(clientId: string): boolean;
  
  /** Проверить лимит модели */
  checkModel(modelName: string): boolean;
  
  /** Получить оставшиеся токены */
  getRemainingTokens(clientId?: string): RateLimitInfo;
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: number;  // Unix timestamp
}
```

### 3.3 RateLimiterGuard

```typescript
// src/modules/rate-limiter/rate-limiter.guard.ts

@Injectable()
export class RateLimiterGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const clientId = request.headers['x-client-id'] ?? request.ip;
    
    if (!this.rateLimiter.checkGlobal()) {
      throw new TooManyRequestsException('Global rate limit exceeded');
    }
    
    if (!this.rateLimiter.checkClient(clientId)) {
      throw new TooManyRequestsException('Client rate limit exceeded');
    }
    
    return true;
  }
}
```

### 3.4 Заголовки ответа

```
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 15
X-RateLimit-Reset: 1702468800
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
      "name": "deepseek-r1",
      "provider": "openrouter",
      "circuitState": "OPEN",
      "openedAt": 1702468500000,
      "cooldownRemainingMs": 45000,
      "stats": { ... }
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
  "modelsInOpenState": 1,
  "activeConnections": 5
}
```

---

## 📦 Фаза 5: Graceful Degradation

### 5.1 Что делать, если ВСЕ модели в OPEN?

```typescript
// В RouterService

if (availableModels.length === 0) {
  // Вариант 1: Force HALF_OPEN на модель с наибольшим cooldown
  const leastBadModel = this.findLeastBadModel();
  if (leastBadModel) {
    this.circuitBreaker.forceHalfOpen(leastBadModel.name);
    return this.tryModel(leastBadModel, request);
  }
  
  // Вариант 2: Сразу использовать fallback
  if (this.config.routing.fallback.enabled) {
    return this.executeFallback(request, errors);
  }
  
  // Вариант 3: Вернуть 503 Service Unavailable
  throw new ServiceUnavailableException('All models are currently unavailable');
}
```

### 5.2 Конфигурация

```yaml
routing:
  gracefulDegradation:
    # Стратегия при отсутствии доступных моделей
    strategy: force_half_open  # или: immediate_fallback, fail_fast
    
    # Не ждать cooldown, если прошло больше этого времени
    maxWaitTime: 30000
```

---

## 📦 Фаза 6: Обновление конфигурации

### 6.1 Расширенный router.yaml

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
  # Алгоритм выбора: round-robin | weighted | smart
  algorithm: smart
  
  maxRetries: 3
  rateLimitRetries: 2
  retryDelay: 1000
  timeout: 30000
  
  fallback:
    enabled: true
    provider: deepseek
    model: deepseek-chat
    
  gracefulDegradation:
    strategy: force_half_open
    maxWaitTime: 30000

circuitBreaker:
  enabled: true
  failureThreshold: 3
  cooldownPeriod: 60000
  successThreshold: 2
  statsWindowSize: 300000

rateLimiting:
  enabled: true
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

---

## 📋 Порядок реализации

### Этап 1: Основа (Приоритет: Высокий)
1. **State Module** — базовый in-memory state
2. **Circuit Breaker** — базовая логика CLOSED/OPEN/HALF_OPEN
3. Интеграция с RouterService

### Этап 2: Улучшение выбора (Приоритет: Средний)
4. **Metrics tracking** — latency, success rate
5. **WeightedStrategy** — выбор с учётом весов
6. **SmartStrategy** — комбинированный алгоритм
7. Обновление models.yaml (weight, priority, maxConcurrent)

### Этап 3: Защита (Приоритет: Средний)
8. **Rate Limiter Module** — Token Bucket
9. **RateLimiterGuard** — интеграция с NestJS
10. Заголовки X-RateLimit-*

### Этап 4: Наблюдаемость (Приоритет: Средний)
11. **Admin Module** — контроллер и DTO
12. Эндпоинты /admin/state, /admin/metrics

### Этап 5: Устойчивость (Приоритет: Низкий)
13. **Graceful Degradation** — стратегии при недоступности
14. Расширенная конфигурация

### Этап 6: Документация и тесты
15. Обновление README.md
16. Unit тесты для новых модулей
17. E2E тесты для сценариев отказа

---

## ⚠️ Осознанные ограничения

1. **In-Memory State** — состояние сбрасывается при рестарте сервиса.  
   *Обоснование:* Для простоты. Redis-backed state можно добавить позже.

2. **Нет отдельного Health Check провайдеров** — используем пассивный мониторинг через ошибки.  
   *Обоснование:* Экономия запросов, Circuit Breaker справляется.

3. **Нет персистентной статистики** — метрики живут только в памяти.  
   *Обоснование:* Для длительного хранения использовать OpenTelemetry/Prometheus.

---

## 📊 Оценка трудозатрат

| Этап | Компонент | Сложность | Часы |
|------|-----------|-----------|------|
| 1 | State Module | Средняя | 4-6 |
| 1 | Circuit Breaker | Средняя | 4-6 |
| 2 | Metrics Service | Низкая | 2-3 |
| 2 | Weighted/Smart Strategy | Средняя | 4-6 |
| 3 | Rate Limiter | Средняя | 4-6 |
| 4 | Admin API | Низкая | 3-4 |
| 5 | Graceful Degradation | Низкая | 2-3 |
| 6 | Тесты + Документация | Средняя | 6-8 |
| **Итого** | | | **29-42** |

---

## 🔗 Связанные документы

- [PRD](./prd.md)
- [Implementation Plan](./implementation-plan.md)
- [Development Guide](../docs/dev.md)
