# План рефакторинга Router Service

## Цели
- Поддержка Cloudflare Workers и Node.js.
- Удаление зависимостей от `fs` и `process` в основной логике.
- Оптимизация инициализации в Workers (кэширование инстанса приложения).
- Перенос Rate Limiting в Redis/Upstash.
- Удаление интервалов для обслуживания (перенос в эндпоинт).
- Использование статического импорта JSON для моделей.

## Выполненные шаги

1. **Модели (Models):**
   - Конвертировал `models.yaml` в `models.json`.
   - Обновил `ModelsService` для использования `import modelsData from './models.json'`.
   - Удалил использование `fs` для загрузки моделей.

2. **Конфигурация (Config):**
   - Унифицировал загрузку конфигурации через `loadRouterConfig(env)`.
   - Удалил `dotenv` из загрузчика (переменные окружения теперь передаются явно).
   - Удалил `modelsFile` из конфигурации, так как модели теперь вкомпилированы.

3. **Rate Limiting:**
   - Добавил метод `checkRateLimit` в интерфейс `StateStorage`.
   - Реализовал `checkRateLimit` для `InMemory`, `Redis` и `Upstash`.
   - Рефакторинг `RateLimiterService`: теперь он использует `StateStorage` и не имеет внутренних таймеров.

4. **Инициализация (App Initialization):**
   - Обновил `createApp`: теперь `routerConfig` обязателен, а зависимости от `process.env` удалены.
   - В `worker.ts` реализовано кэширование `appInstance`, приложение создается один раз при первом запросе.
   - В `main.ts` (Node) конфигурация грузится один раз из `process.env`.

5. **Runtime (Environment):**
   - `ShutdownService` теперь безопасен для Workers (проверка `unref`).
   - `registerRoutes` больше не использует `process.uptime()` и `process.env.BASE_PATH` (используется `startedAt` и фиксированный префикс).

6. **Очистка (Cleanup):**
   - Удалена библиотека `js-yaml`.
   - Удалены устаревшие тесты на NestJS.
   - Обновлены существующие тесты для работы с новой структурой.

## Результат
Приложение теперь может запускаться в Cloudflare Workers без модификаций, все состояния (Circuit Breaker и Rate Limit) сохраняются в Redis (Upstash). Инициализация происходит один раз, что экономит ресурсы в serverless среде.
