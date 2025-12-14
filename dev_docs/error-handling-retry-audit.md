# Аудит обработки ошибок провайдера и логики ретраев

**Дата:** 2025-12-14  
**Версия:** 2.0 (после обновления документации)  
**Статус:** Завершен

## Резюме

Проведен детальный аудит обработки ошибок провайдера, логики ретраев, переключения на другие модели и работы Circuit Breaker. Документация приведена в соответствие с фактическим поведением кода.

### Ключевые выводы

✅ **Сильные стороны:**
- Четкое разделение ответственности между компонентами
- Правильная обработка 404 как постоянной ошибки (`PERMANENTLY_UNAVAILABLE`)
- Корректная логика Circuit Breaker с переходами состояний
- Хорошая обработка 429 с jitter и ретраями на той же модели
- Документация теперь точно отражает поведение кода

❌ **Критические проблемы:**
- **Отсутствует обработка сетевых ошибок** (ECONNREFUSED, ENOTFOUND, EHOSTUNREACH)
- **4xx ошибки учитываются в Circuit Breaker**, хотя это проблемы клиента/конфигурации, а не модели

⚠️ **Спорные моменты (требуют обсуждения):**
- Timeout не ретраится на той же модели (сразу переключается)
- 5xx ошибки не ретраятся на той же модели (сразу переключаются)

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
- ✅ Клиентские ошибки (400, 401, 403, 404) прерывают цикл попыток
- ⚠️ Нет отдельной проверки на серверные ошибки (5xx) в `ErrorExtractor`
- ⚠️ Нет проверки на сетевые ошибки

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
- ❌ **Метод `isRetryableError` не используется в логике роутера**
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
- ⚠️ **Спорно**: Только 429 ретраится, другие ошибки (5xx, timeout, сетевые) сразу переключаются

#### Переключение на другую модель

**Файл:** `src/modules/router/router.service.ts:67-138`

**Логика:**
1. Цикл до `maxRetries` попыток
2. Выбор модели (исключая уже попробованные)
3. Попытка выполнения с ретраями для 429
4. При ошибке:
   - Если abort → прервать
   - Если 4xx (кроме 429) → прервать весь цикл
   - Иначе → добавить модель в `excludedModels` и попробовать следующую

**Анализ:**
- ✅ **Правильно**: При любой ошибке (кроме 4xx) переключается на следующую модель
- ✅ **Правильно**: Исключает уже попробованные модели через `excludedModels`
- ✅ **Правильно**: Клиентские ошибки (4xx кроме 429) прерывают цикл
- ⚠️ **Спорно**: 5xx и timeout не ретраятся на той же модели
- ❌ **Проблема**: Сетевые ошибки (ECONNREFUSED и т.д.) не обрабатываются явно

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
- ⚠️ **Проблема**: Все ошибки (включая 400, 401, 403) учитываются в статистике
  - 401/403 - это проблемы с API ключом, не с моделью
  - 400 - это проблема с запросом клиента, не с моделью
  - Эти ошибки не должны влиять на Circuit Breaker

#### Переходы состояний

**Файл:** `src/modules/state/circuit-breaker.service.ts:86-118`

**Анализ:**
- ✅ **Правильно**: `CLOSED` → запросы разрешены
- ✅ **Правильно**: `OPEN` → запросы блокируются до истечения cooldown
- ✅ **Правильно**: `OPEN` → `HALF_OPEN` после cooldown
- ✅ **Правильно**: `HALF_OPEN` → запросы разрешены для тестирования
- ✅ **Правильно**: `PERMANENTLY_UNAVAILABLE` → запросы навсегда заблокированы
- ✅ **Правильно**: `HALF_OPEN` + успех → `CLOSED` (в `onSuccess`)

---

## 2. Соответствие документации и кода

### Таблица из обновленного README.md

| Код ошибки | Действие | Circuit Breaker | Прерывает цикл? |
|------------|----------|------------------|-----------------|
| 404 (Not Found) | Модель не существует, прервать | `PERMANENTLY_UNAVAILABLE` | ✅ Да |
| 429 (Rate Limit) | Ретрай на той же модели с задержкой + jitter | Учитывается в статистике | ❌ Нет (ретрай) |
| 5xx (500-599) | Переключиться на следующую модель | Учитывается, `CLOSED → OPEN` после failureThreshold | ❌ Нет (переключение) |
| Timeout | Переключиться на следующую модель | Учитывается, `CLOSED → OPEN` после failureThreshold | ❌ Нет (переключение) |
| 400 (Bad Request) | Вернуть ошибку клиенту | Учитывается в статистике | ✅ Да |
| 401 (Unauthorized) | Вернуть ошибку клиенту | Учитывается в статистике | ✅ Да |
| 403 (Forbidden) | Вернуть ошибку клиенту | Учитывается в статистике | ✅ Да |
| Другие 4xx | Вернуть ошибку клиенту | Учитывается в статистике | ✅ Да |

### Проверка соответствия

| Код ошибки | Документация | Фактическое поведение | Соответствие |
|------------|-------------|----------------------|--------------|
| 404 | ✅ `PERMANENTLY_UNAVAILABLE`, прервать | ✅ `PERMANENTLY_UNAVAILABLE`, прервать | ✅ **Да** |
| 429 | ✅ Ретрай с jitter, учитывается | ✅ Ретрай с jitter, учитывается | ✅ **Да** |
| 5xx | ✅ Переключение, учитывается | ✅ Переключение, учитывается | ✅ **Да** |
| Timeout | ✅ Переключение, учитывается | ✅ Переключение, учитывается | ✅ **Да** |
| 400/401/403 | ✅ Прервать, учитывается | ✅ Прервать, учитывается | ✅ **Да** |

**Вывод:** ✅ **Документация полностью соответствует коду**

---

## 3. Выявленные проблемы

### 3.1 Критические проблемы

#### Проблема 1: Отсутствует обработка сетевых ошибок

**Описание:**
Сетевые ошибки (ECONNREFUSED, ENOTFOUND, EHOSTUNREACH и т.д.) не обрабатываются явно.

**Текущее поведение:**
- Эти ошибки не имеют HTTP кода
- `ErrorExtractor.extractErrorCode` вернет `undefined`
- `ErrorExtractor.isClientError(undefined)` → `false`
- Ошибка **не прервет цикл**, произойдет переключение на другую модель
- Circuit Breaker **учтет ошибку** и может открыть circuit

**Проблема:**
Сетевые ошибки обрабатываются как серверные (переключение на другую модель), но это может быть неоптимально:
- `ECONNREFUSED` - сервер недоступен, возможно стоит ретраить
- `ENOTFOUND` - DNS не может разрешить хост, ретрай бесполезен
- `ETIMEDOUT` - таймаут, возможно стоит ретраить

**Рекомендация:**
Добавить явную обработку сетевых ошибок с возможностью ретраев для некоторых типов.

#### Проблема 2: 4xx ошибки учитываются в Circuit Breaker

**Описание:**
Ошибки 400, 401, 403 учитываются в статистике Circuit Breaker, хотя это проблемы клиента/конфигурации, а не модели.

**Почему это проблема:**
- **401/403** - неверный API ключ или отсутствие доступа. Это проблема конфигурации, а не модели.
- **400** - неверный запрос клиента. Это проблема клиента, а не модели.
- Эти ошибки могут привести к открытию Circuit Breaker, хотя модель работает нормально.

**Пример сценария:**
1. API ключ истек → все запросы возвращают 401
2. После 3 попыток (failureThreshold) Circuit Breaker открывается
3. Модель исключается из ротации, хотя проблема в API ключе, а не в модели

**Рекомендация:**
Исключить 4xx ошибки (кроме 429) из Circuit Breaker статистики.

---

### 3.2 Спорные моменты (требуют обсуждения)

#### Спорный момент 1: Timeout не ретраится

**Текущее поведение:**
- Timeout → переключение на другую модель
- Не делается ретрай на той же модели

**Аргументы "за" текущее поведение:**
- Если модель не отвечает в течение 30 секунд, вряд ли она ответит при повторной попытке
- Быстрое переключение на другую модель улучшает user experience

**Аргументы "против":**
- Timeout может быть временным (сетевая задержка, перегрузка)
- 1-2 ретрая с небольшой задержкой могут помочь

**Рекомендация:**
Оставить как есть, но можно добавить конфигурируемую опцию `timeoutRetries`.

#### Спорный момент 2: 5xx ошибки не ретраятся

**Текущее поведение:**
- 5xx → переключение на другую модель
- Не делается ретрай на той же модели

**Аргументы "за" текущее поведение:**
- 502/503/504 обычно указывают на проблемы с провайдером
- Быстрое переключение на другую модель улучшает надежность

**Аргументы "против":**
- 500 может быть временной ошибкой
- 502/503 могут быть кратковременными
- 1-2 ретрая могут помочь

**Рекомендация:**
Можно добавить конфигурируемую опцию `serverErrorRetries` для 500/502/503.

---

## 4. Распределение кодов ошибок

### Постоянные ошибки (прерывают цикл)

| Код | Причина | Обработка | Правильно? |
|-----|---------|-----------|------------|
| 400 | Bad Request - неверный запрос | ✅ Прерывание | ✅ Да |
| 401 | Unauthorized - неверный API ключ | ✅ Прерывание | ✅ Да |
| 403 | Forbidden - доступ запрещен | ✅ Прерывание | ✅ Да |
| 404 | Not Found - модель не существует | ✅ `PERMANENTLY_UNAVAILABLE` | ✅ Да |
| 405-499 | Другие клиентские ошибки | ✅ Прерывание | ✅ Да |

**Анализ:**
- ✅ Все клиентские ошибки (кроме 429) правильно прерывают цикл
- ⚠️ Но они учитываются в Circuit Breaker, что неправильно

### Временные ошибки (ретраятся или переключаются)

| Код | Причина | Обработка | Правильно? |
|-----|---------|-----------|------------|
| 429 | Rate Limit | ✅ Ретрай на той же модели | ✅ Да |
| 500 | Internal Server Error | ⚠️ Переключение | ⚠️ Спорно |
| 502 | Bad Gateway | ✅ Переключение | ✅ Да |
| 503 | Service Unavailable | ✅ Переключение | ✅ Да |
| 504 | Gateway Timeout | ✅ Переключение | ✅ Да |
| Timeout | Request timeout | ⚠️ Переключение | ⚠️ Спорно |
| ECONNREFUSED | Connection refused | ❌ Переключение (не ретрай) | ❌ Нет |
| ENOTFOUND | DNS error | ✅ Переключение | ✅ Да |
| EHOSTUNREACH | Host unreachable | ✅ Переключение | ✅ Да |

---

## 5. Рекомендации

### 5.1 Критические (должны быть исправлены)

#### Рекомендация 1: Исключить 4xx из Circuit Breaker

**Файл:** `src/modules/router/router.service.ts:295-304`

**Изменение:**
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

**Обоснование:**
- 4xx ошибки (кроме 429) - это проблемы клиента/конфигурации, а не модели
- Они не должны влиять на Circuit Breaker

#### Рекомендация 2: Добавить обработку сетевых ошибок

**Файл:** `src/common/utils/error-extractor.util.ts`

**Добавить метод:**
```typescript
/**
 * Check if error is a network error (connection issues)
 */
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

/**
 * Check if network error is retryable (not DNS issues)
 */
public static isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const err = error as Error & { code?: string };
  // ECONNREFUSED and ECONNRESET are retryable
  // ENOTFOUND (DNS) is not retryable
  return err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET';
}
```

**Файл:** `src/modules/router/router.service.ts`

**Изменить `shouldRetry`:**
```typescript
shouldRetry: error => {
  const errorInfo = ErrorExtractor.extractErrorInfo(error, model);
  // Retry on rate limit OR retryable network errors
  return ErrorExtractor.isRateLimitError(errorInfo.code) || 
         ErrorExtractor.isRetryableNetworkError(error);
},
```

---

### 5.2 Желательные (улучшения)

#### Рекомендация 3: Добавить конфигурируемые ретраи для 5xx

**Файл:** `config.yaml`

```yaml
routing:
  maxRetries: 3
  rateLimitRetries: 2
  retryDelay: 1000
  timeoutSecs: 30
  
  # Новая опция
  serverErrorRetries: 1  # Ретраи для 5xx на той же модели (0 = отключено)
```

**Обоснование:**
- Некоторые 5xx ошибки могут быть временными
- 1-2 ретрая могут улучшить надежность

#### Рекомендация 4: Обновить документацию

**Файл:** `README.md`

Добавить в раздел "Обработка ошибок":

```markdown
### Сетевые ошибки

| Код ошибки | Описание | Действие |
|------------|----------|----------|
| ECONNREFUSED | Соединение отклонено | Ретрай на той же модели |
| ECONNRESET | Соединение сброшено | Ретрай на той же модели |
| ENOTFOUND | DNS не может разрешить хост | Переключиться на следующую модель |
| EHOSTUNREACH | Хост недостижим | Переключиться на следующую модель |
| ENETUNREACH | Сеть недостижима | Переключиться на следующую модель |
| ETIMEDOUT | Таймаут запроса | Переключиться на следующую модель |
```

---

## 6. Итоговая оценка

### Общая архитектура: ⭐⭐⭐⭐ (4/5)

**Сильные стороны:**
- ✅ Четкое разделение ответственности
- ✅ Правильная обработка Circuit Breaker
- ✅ Хорошая обработка 429
- ✅ Корректная обработка 404
- ✅ Документация соответствует коду

**Слабые стороны:**
- ❌ Отсутствует явная обработка сетевых ошибок
- ❌ 4xx учитываются в Circuit Breaker
- ⚠️ Timeout и 5xx не ретраятся (спорно)

### Соответствие документации: ⭐⭐⭐⭐⭐ (5/5)

- ✅ Документация полностью соответствует коду
- ✅ Четкое описание поведения
- ✅ Понятная терминология

### Надежность: ⭐⭐⭐⭐ (4/5)

- ✅ Хорошо обрабатывает типичные случаи
- ❌ Проблемы с сетевыми ошибками
- ❌ 4xx влияют на Circuit Breaker
- ⚠️ Может быть улучшена обработка 5xx

---

## 7. План действий

### Приоритет 1 (Критично - должно быть исправлено)

1. **Исключить 4xx из Circuit Breaker**
   - Изменить `router.service.ts:executeSingleRequest`
   - Не вызывать `circuitBreaker.onFailure` для клиентских ошибок
   - Обновить тесты

2. **Добавить обработку сетевых ошибок**
   - Добавить методы в `ErrorExtractor`
   - Добавить ретраи для `ECONNREFUSED` и `ECONNRESET`
   - Обновить документацию

### Приоритет 2 (Желательно - улучшения)

3. **Добавить конфигурируемые ретраи для 5xx**
   - Добавить опцию `serverErrorRetries` в конфиг
   - Реализовать логику ретраев
   - Обновить документацию

4. **Добавить раздел о сетевых ошибках в документацию**
   - Описать поведение для каждого типа
   - Добавить примеры

### Приоритет 3 (Опционально - для обсуждения)

5. **Конфигурируемые стратегии ретраев**
   - Позволить настраивать, какие ошибки ретраить
   - Добавить гибкие настройки задержек

---

## Заключение

После приведения документации в соответствие с кодом, основные проблемы сосредоточены в двух областях:

1. **Критические проблемы:**
   - Отсутствие обработки сетевых ошибок
   - 4xx ошибки влияют на Circuit Breaker

2. **Спорные моменты:**
   - Отсутствие ретраев для 5xx и timeout

Текущая реализация **работоспособна и разумна**, но может быть улучшена путем:
- Исключения 4xx из Circuit Breaker (критично)
- Добавления обработки сетевых ошибок (критично)
- Добавления конфигурируемых ретраев для 5xx (желательно)

После внесения критических изменений система станет более надежной и предсказуемой.

