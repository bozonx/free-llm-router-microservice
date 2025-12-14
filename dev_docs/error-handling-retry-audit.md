# Аудит обработки ошибок провайдера и логики ретраев

**Дата:** 2025-12-14  
**Версия:** 1.0  
**Статус:** Завершен

## Резюме

Проведен детальный аудит обработки ошибок провайдера, логики ретраев, переключения на другие модели и работы Circuit Breaker. Общая архитектура обработки ошибок **разумна и хорошо продумана**, но выявлены **критические пробелы** в обработке сетевых ошибок и некоторые несоответствия в документации.

### Ключевые выводы

✅ **Сильные стороны:**
- Четкое разделение ответственности между компонентами
- Правильная обработка 404 как постоянной ошибки
- Корректная логика Circuit Breaker с переходами состояний
- Хорошая обработка 429 с jitter и ретраями

❌ **Критические проблемы:**
- **Отсутствует обработка сетевых ошибок** (ECONNREFUSED, ENOTFOUND, EHOSTUNREACH)
- Timeout обрабатывается только на уровне Circuit Breaker, но не ретраится
- Несоответствие документации и кода по обработке 5xx

⚠️ **Рекомендации к улучшению:**
- Добавить ретраи для сетевых ошибок
- Уточнить обработку timeout
- Обновить документацию

---

## 1. Анализ текущей обработки ошибок

### 1.1 Классификация ошибок

#### Файл: `src/common/utils/error-extractor.util.ts`

```typescript
// Проверка на клиентскую ошибку (4xx, кроме 429)
public static isClientError(code?: number): boolean {
  return code !== undefined && code >= 400 && code < 500 && code !== 429;
}

// Проверка на rate limit (429)
public static isRateLimitError(code?: number): boolean {
  return code === 429;
}
```

**Анализ:**
- ✅ Правильно исключает 429 из клиентских ошибок
- ✅ Клиентские ошибки (400, 401, 403, 404) не ретраятся
- ⚠️ **Нет проверки на серверные ошибки (5xx)** в `ErrorExtractor`

#### Файл: `src/modules/providers/base.provider.ts`

```typescript
protected isRateLimitError(error: HttpErrorResponse): boolean {
  return error.statusCode === 429;
}

protected isServerError(error: HttpErrorResponse): boolean {
  return error.statusCode >= 500 && error.statusCode < 600;
}

protected isTimeoutError(error: HttpErrorResponse): boolean {
  return error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED';
}

protected isRetryableError(error: HttpErrorResponse): boolean {
  return this.isRateLimitError(error) || this.isServerError(error) || this.isTimeoutError(error);
}
```

**Анализ:**
- ✅ Есть проверка на 5xx
- ✅ Есть проверка на timeout (`ETIMEDOUT`, `ECONNABORTED`)
- ❌ **Метод `isRetryableError` не используется в коде** - это только вспомогательный метод
- ❌ **Отсутствует обработка сетевых ошибок**: `ECONNREFUSED`, `ENOTFOUND`, `EHOSTUNREACH`, `ENETUNREACH`

---

### 1.2 Логика ретраев

#### Rate Limit Retry (429)

**Файл:** `src/modules/router/router.service.ts:140-167`

```typescript
private async executeWithRateLimitRetry(params: {
  model: ModelDefinition;
  request: ChatCompletionRequestDto;
  abortSignal: AbortSignal;
}): Promise<ChatCompletionResult> {
  const { model, request, abortSignal } = params;

  this.stateService.incrementActiveRequests(model.name);

  try {
    return await this.retryHandler.executeWithRetry({
      operation: async () => this.executeSingleRequest(model, request, abortSignal),
      maxRetries: this.config.routing.rateLimitRetries,
      retryDelay: this.config.routing.retryDelay,
      shouldRetry: error => {
        const errorInfo = ErrorExtractor.extractErrorInfo(error, model);
        return ErrorExtractor.isRateLimitError(errorInfo.code);
      },
      onRetry: attempt => {
        this.logger.debug(
          `Rate limit hit for ${model.name}, retrying (attempt ${attempt}/${this.config.routing.rateLimitRetries})`,
        );
      },
    });
  } finally {
    this.stateService.decrementActiveRequests(model.name);
  }
}
```

**Анализ:**
- ✅ **Правильно**: Ретраи только для 429
- ✅ **Правильно**: Используется jitter для задержки (в `RetryHandlerService.calculateRetryDelay`)
- ✅ **Правильно**: Ретраи на той же модели
- ✅ **Правильно**: Счетчик активных запросов корректно управляется

#### Переключение на другую модель

**Файл:** `src/modules/router/router.service.ts:67-138`

```typescript
private async executeWithShutdownHandling(
  request: ChatCompletionRequestDto,
  clientSignal?: AbortSignal,
): Promise<ChatCompletionResponseDto> {
  const abortSignal = this.createCombinedAbortSignal(clientSignal);
  const errors: ErrorInfo[] = [];
  const excludedModels: string[] = [];
  let attemptCount = 0;

  const parsedModel = parseModelInput(request.model);

  for (let i = 0; i < this.config.routing.maxRetries; i++) {
    attemptCount++;

    const model = this.selectModel(request, parsedModel, excludedModels);
    if (!model) {
      this.logger.warn('No suitable model found');
      break;
    }

    this.logger.debug(`Attempt ${attemptCount}: Using model ${model.name} (${model.provider})`);

    try {
      const result = await this.executeWithRateLimitRetry({
        model,
        request,
        abortSignal,
      });

      // Success - return immediately
      return this.buildSuccessResponse({
        result,
        model,
        attemptCount,
        errors,
        fallbackUsed: false,
      });
    } catch (error) {
      if (abortSignal.aborted) {
        throw this.handleAbortError();
      }

      // Track models that failed to avoid selecting them again in the next retry
      excludedModels.push(`${model.provider}/${model.name}`);
      const errorInfo = ErrorExtractor.extractErrorInfo(error, model);
      errors.push(errorInfo);

      this.logger.warn(
        `Model ${model.name} (${model.provider}) failed: ${errorInfo.error} (code: ${errorInfo.code ?? 'N/A'})`,
      );

      if (ErrorExtractor.isClientError(errorInfo.code)) {
        this.logger.error('Client error detected, not retrying');
        throw error;
      }
    }
  }

  // If all retries failed, check if fallback is enabled
  if (this.config.routing.fallback.enabled) {
    const fallbackResponse = await this.tryFallback(request, abortSignal, errors, attemptCount);
    if (fallbackResponse) {
      return fallbackResponse;
    }
  }

  throw new AllModelsFailedError(attemptCount, errors);
}
```

**Анализ:**
- ✅ **Правильно**: При любой ошибке (кроме 4xx) переключается на следующую модель
- ✅ **Правильно**: Исключает уже попробованные модели через `excludedModels`
- ✅ **Правильно**: Клиентские ошибки (4xx кроме 429) прерывают цикл
- ⚠️ **Проблема**: **Нет явной проверки на 5xx или timeout** - переключение происходит для ВСЕХ ошибок, кроме 4xx
- ⚠️ **Проблема**: Timeout не ретраится на той же модели, сразу переключается на другую

---

### 1.3 Circuit Breaker

#### Обработка ошибок

**Файл:** `src/modules/state/circuit-breaker.service.ts:53-80`

```typescript
public onFailure(modelName: string, errorCode?: number, latencyMs: number = 0): void {
  // 404 means model doesn't exist - mark as permanently unavailable
  if (errorCode === 404) {
    this.stateService.markPermanentlyUnavailable(modelName, '404 Not Found');
    return;
  }

  this.stateService.recordFailure(modelName, latencyMs);
  const state = this.stateService.getState(modelName);

  // Check if we should open the circuit
  if (
    state.circuitState !== 'OPEN' &&
    state.circuitState !== 'PERMANENTLY_UNAVAILABLE' &&
    state.consecutiveFailures >= this.config.failureThreshold
  ) {
    this.stateService.setCircuitState(modelName, 'OPEN');
    this.logger.warn(
      `Model ${modelName} circuit opened after ${state.consecutiveFailures} consecutive failures`,
    );
  }

  // If in HALF_OPEN and a failure occurs, go back to OPEN
  if (state.circuitState === 'HALF_OPEN') {
    this.stateService.setCircuitState(modelName, 'OPEN');
    this.logger.warn(`Model ${modelName} failed during HALF_OPEN, returning to OPEN`);
  }
}
```

**Анализ:**
- ✅ **Правильно**: 404 → `PERMANENTLY_UNAVAILABLE`
- ✅ **Правильно**: После `failureThreshold` последовательных ошибок → `OPEN`
- ✅ **Правильно**: В `HALF_OPEN` любая ошибка → обратно в `OPEN`
- ✅ **Правильно**: Все ошибки (кроме 404) учитываются в статистике

#### Переходы состояний

**Файл:** `src/modules/state/circuit-breaker.service.ts:86-118`

```typescript
public canRequest(modelName: string): boolean {
  const state = this.stateService.getState(modelName);

  switch (state.circuitState) {
    case 'CLOSED':
      return true;

    case 'HALF_OPEN':
      // Allow test requests in HALF_OPEN state to verify recovery
      return true;

    case 'OPEN':
      // Check if cooldown has expired
      if (state.openedAt) {
        const elapsed = Date.now() - state.openedAt;
        if (elapsed >= this.config.cooldownPeriodSecs * 1000) {
          // Transition to HALF_OPEN to test if the service has recovered
          this.stateService.setCircuitState(modelName, 'HALF_OPEN');
          this.logger.log(`Model ${modelName} cooldown expired, transitioning to HALF_OPEN`);
          return true;
        }
      }
      // Still in cooldown period
      return false;

    case 'PERMANENTLY_UNAVAILABLE':
      // Never allow requests to models that are permanently broken (e.g. 404s)
      return false;

    default:
      return false;
  }
}
```

**Анализ:**
- ✅ **Правильно**: `CLOSED` → запросы разрешены
- ✅ **Правильно**: `OPEN` → запросы блокируются до истечения cooldown
- ✅ **Правильно**: `OPEN` → `HALF_OPEN` после cooldown
- ✅ **Правильно**: `HALF_OPEN` → запросы разрешены для тестирования
- ✅ **Правильно**: `PERMANENTLY_UNAVAILABLE` → запросы навсегда заблокированы
- ✅ **Правильно**: `HALF_OPEN` + успех → `CLOSED` (в `onSuccess`)

---

## 2. Сравнение с документацией

### Таблица из README.md (строки 358-364)

| Код ошибки | Действие | Circuit Breaker |
|------------|----------|------------------|
| 404 (Not Found) | Модель не существует | `PERMANENTLY_UNAVAILABLE` — исключение до рестарта |
| 429 (Rate Limit) | Повторить с задержкой + jitter | Учитывается в статистике |
| 5xx, Timeout | Retry с другой моделью | `CLOSED → OPEN` после failureThreshold |
| 400 (Bad Request) | Вернуть ошибку клиенту | Не влияет |
| 401/403 | Вернуть ошибку клиенту | Не влияет |

### Фактическое поведение

| Код ошибки | Фактическое действие | Circuit Breaker | Соответствие |
|------------|---------------------|------------------|--------------|
| 404 | Модель не существует | ✅ `PERMANENTLY_UNAVAILABLE` | ✅ **Соответствует** |
| 429 | ✅ Ретрай на той же модели с jitter | ✅ Учитывается в статистике | ✅ **Соответствует** |
| 5xx | ⚠️ Переключение на другую модель (НЕ ретрай) | ✅ `CLOSED → OPEN` после threshold | ⚠️ **Частично** |
| Timeout | ⚠️ Переключение на другую модель (НЕ ретрай) | ✅ `CLOSED → OPEN` после threshold | ⚠️ **Частично** |
| 400 | ✅ Прерывание, ошибка клиенту | ❌ **Учитывается в статистике** | ⚠️ **Несоответствие** |
| 401/403 | ✅ Прерывание, ошибка клиенту | ❌ **Учитывается в статистике** | ⚠️ **Несоответствие** |

### Проблемы

1. **5xx и Timeout**: Документация говорит "Retry с другой моделью", код делает именно это, но это **не ретрай, а переключение**. Термин "retry" может вводить в заблуждение.

2. **400/401/403**: Документация говорит "Не влияет" на Circuit Breaker, но код **учитывает их в статистике** через `recordFailure`. Это может быть проблемой, так как:
   - 401/403 - это проблемы с API ключом, а не с моделью
   - 400 - это проблема с запросом клиента, а не с моделью
   - Эти ошибки **не должны** влиять на Circuit Breaker

---

## 3. Критические пробелы

### 3.1 Сетевые ошибки

**Проблема:** Отсутствует обработка сетевых ошибок:
- `ECONNREFUSED` - соединение отклонено (сервер недоступен)
- `ENOTFOUND` - DNS не может разрешить хост
- `EHOSTUNREACH` - хост недостижим
- `ENETUNREACH` - сеть недостижима
- `ECONNRESET` - соединение сброшено

**Текущее поведение:**
- Эти ошибки не имеют HTTP кода
- `ErrorExtractor.extractErrorCode` вернет `undefined`
- `ErrorExtractor.isClientError(undefined)` → `false`
- Ошибка **не прервет цикл**, произойдет переключение на другую модель
- Circuit Breaker **учтет ошибку** и может открыть circuit

**Проблема:**
- Сетевые ошибки **должны ретраиться** на той же модели (как 429), а не переключаться
- Или хотя бы должны быть явно задокументированы

### 3.2 Timeout

**Проблема:** Timeout обрабатывается только на уровне Circuit Breaker, но не ретраится.

**Текущее поведение:**
- Axios timeout → `ETIMEDOUT` или `ECONNABORTED`
- `BaseProvider.isTimeoutError` распознает это
- Но `isTimeoutError` **не используется** в логике ретраев
- Timeout → переключение на другую модель

**Вопрос:** Должен ли timeout ретраиться на той же модели или сразу переключаться?

**Рекомендация:**
- Кратковременные timeout (например, 1-2 секунды) → ретрай на той же модели
- Длительные timeout (30+ секунд) → переключение на другую модель
- Или сделать это конфигурируемым

---

## 4. Распределение кодов ошибок

### Постоянные ошибки (не ретраятся, прерывают цикл)

| Код | Причина | Обработка |
|-----|---------|-----------|
| 400 | Bad Request - неверный запрос клиента | ✅ Прерывание |
| 401 | Unauthorized - неверный API ключ | ✅ Прерывание |
| 403 | Forbidden - доступ запрещен | ✅ Прерывание |
| 404 | Not Found - модель не существует | ✅ `PERMANENTLY_UNAVAILABLE` |
| 405-499 | Другие клиентские ошибки | ✅ Прерывание |

**Анализ:**
- ✅ **Правильно**: Все клиентские ошибки (кроме 429) прерывают цикл
- ⚠️ **Проблема**: 401/403/400 учитываются в Circuit Breaker, хотя не должны

### Временные ошибки (ретраятся или переключаются)

| Код | Причина | Обработка | Правильно? |
|-----|---------|-----------|------------|
| 429 | Rate Limit | ✅ Ретрай на той же модели | ✅ Да |
| 500 | Internal Server Error | ⚠️ Переключение на другую модель | ⚠️ Спорно |
| 502 | Bad Gateway | ⚠️ Переключение на другую модель | ✅ Да |
| 503 | Service Unavailable | ⚠️ Переключение на другую модель | ✅ Да |
| 504 | Gateway Timeout | ⚠️ Переключение на другую модель | ✅ Да |
| Timeout | Request timeout | ⚠️ Переключение на другую модель | ⚠️ Спорно |
| ECONNREFUSED | Connection refused | ❌ Переключение (не ретрай) | ❌ **Нет** |
| ENOTFOUND | DNS error | ❌ Переключение (не ретрай) | ❌ **Нет** |

**Проблемы:**
1. **500** - может быть временной ошибкой, стоит ретраить 1-2 раза на той же модели
2. **Timeout** - может быть временным, стоит ретраить 1-2 раза
3. **Сетевые ошибки** - должны ретраиться, а не сразу переключаться

---

## 5. Рекомендации

### 5.1 Критические (должны быть исправлены)

#### 1. Добавить обработку сетевых ошибок

**Файл:** `src/common/utils/error-extractor.util.ts`

Добавить метод:
```typescript
public static isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const err = error as Error & { code?: string };
  const networkCodes = [
    'ECONNREFUSED',  // Connection refused
    'ENOTFOUND',     // DNS lookup failed
    'EHOSTUNREACH',  // Host unreachable
    'ENETUNREACH',   // Network unreachable
    'ECONNRESET',    // Connection reset
    'EPIPE',         // Broken pipe
  ];

  return err.code !== undefined && networkCodes.includes(err.code);
}
```

#### 2. Добавить ретраи для сетевых ошибок

**Файл:** `src/modules/router/router.service.ts`

Изменить `shouldRetry` в `executeWithRateLimitRetry`:
```typescript
shouldRetry: error => {
  const errorInfo = ErrorExtractor.extractErrorInfo(error, model);
  // Retry on rate limit OR network errors
  return ErrorExtractor.isRateLimitError(errorInfo.code) || 
         ErrorExtractor.isNetworkError(error);
},
```

#### 3. Исключить 4xx (кроме 429) из Circuit Breaker

**Файл:** `src/modules/router/router.service.ts:295-304`

Изменить:
```typescript
} catch (error) {
  if (ErrorExtractor.isAbortError(error)) {
    throw this.handleAbortError();
  }

  const latencyMs = Date.now() - startTime;
  const errorInfo = ErrorExtractor.extractErrorInfo(error, model);
  
  // Only record in Circuit Breaker if NOT a client error (4xx except 429)
  if (!ErrorExtractor.isClientError(errorInfo.code)) {
    this.circuitBreaker.onFailure(model.name, errorInfo.code, latencyMs);
  }
  
  throw error;
}
```

### 5.2 Желательные (улучшения)

#### 4. Добавить ретраи для 500 и timeout

Создать отдельную категорию "retryable server errors":
```typescript
public static isRetryableServerError(code?: number): boolean {
  // 500 - Internal Server Error (может быть временным)
  // 502 - Bad Gateway (обычно временная проблема)
  // 503 - Service Unavailable (временная перегрузка)
  // 504 - Gateway Timeout (временная проблема)
  return code === 500 || code === 502 || code === 503 || code === 504;
}
```

Добавить конфиг:
```yaml
routing:
  serverErrorRetries: 1  # Ретраи для 5xx на той же модели
```

#### 5. Обновить документацию

**Файл:** `README.md:356-364`

Обновить таблицу:
```markdown
| Код ошибки | Действие | Circuit Breaker |
|------------|----------|------------------|
| 404 (Not Found) | Модель не существует | `PERMANENTLY_UNAVAILABLE` — исключение до рестарта |
| 429 (Rate Limit) | Ретрай на той же модели с задержкой + jitter | Учитывается в статистике |
| 5xx | Переключение на следующую модель | `CLOSED → OPEN` после failureThreshold |
| Timeout | Переключение на следующую модель | `CLOSED → OPEN` после failureThreshold |
| Network errors | Переключение на следующую модель | `CLOSED → OPEN` после failureThreshold |
| 400 (Bad Request) | Вернуть ошибку клиенту | **Не учитывается** |
| 401/403 | Вернуть ошибку клиенту | **Не учитывается** |
```

### 5.3 Опциональные (для обсуждения)

#### 6. Добавить конфигурируемые стратегии ретраев

Позволить настраивать, какие ошибки ретраить:
```yaml
routing:
  retryStrategies:
    rateLimit:
      enabled: true
      maxRetries: 2
      delay: 1000
    networkErrors:
      enabled: true
      maxRetries: 1
      delay: 500
    serverErrors:
      enabled: false
      codes: [500, 502, 503]
      maxRetries: 1
```

---

## 6. Итоговая оценка

### Общая архитектура: ⭐⭐⭐⭐ (4/5)

**Сильные стороны:**
- ✅ Четкое разделение ответственности
- ✅ Правильная обработка Circuit Breaker
- ✅ Хорошая обработка 429
- ✅ Корректная обработка 404

**Слабые стороны:**
- ❌ Отсутствует обработка сетевых ошибок
- ❌ 4xx учитываются в Circuit Breaker
- ⚠️ Timeout не ретраится

### Соответствие документации: ⭐⭐⭐ (3/5)

- ⚠️ Несоответствие по 400/401/403
- ⚠️ Неточная терминология ("retry" vs "переключение")
- ⚠️ Отсутствует описание сетевых ошибок

### Надежность: ⭐⭐⭐ (3/5)

- ✅ Хорошо обрабатывает типичные случаи
- ❌ Проблемы с сетевыми ошибками
- ⚠️ Может быть улучшена обработка 5xx

---

## 7. План действий

### Приоритет 1 (Критично)
1. ✅ Добавить обработку сетевых ошибок
2. ✅ Исключить 4xx из Circuit Breaker
3. ✅ Обновить документацию

### Приоритет 2 (Желательно)
4. ⚠️ Добавить ретраи для 5xx (обсудить)
5. ⚠️ Добавить ретраи для timeout (обсудить)

### Приоритет 3 (Опционально)
6. ⚠️ Конфигурируемые стратегии ретраев

---

## Заключение

Текущая реализация обработки ошибок **в целом разумна и хорошо продумана**, но имеет **критические пробелы** в обработке сетевых ошибок. Рекомендуется:

1. **Обязательно** исправить обработку сетевых ошибок
2. **Обязательно** исключить 4xx из Circuit Breaker
3. **Обязательно** обновить документацию
4. **Желательно** добавить ретраи для 5xx и timeout
5. **Опционально** сделать стратегии ретраев конфигурируемыми

После внесения этих изменений система будет более надежной и предсказуемой.
