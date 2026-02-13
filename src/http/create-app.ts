import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { Logger } from '../common/logger.js';
import type { RouterConfig } from '../config/router-config.interface.js';
import { ModelsService } from '../modules/models/models.service.js';
import { createProvidersMap } from '../modules/providers/providers.factory.js';
import { SelectorService } from '../modules/selector/selector.service.js';
import { SmartStrategy } from '../modules/selector/strategies/smart.strategy.js';
import { StateService } from '../modules/state/state.service.js';
import { CircuitBreakerService } from '../modules/state/circuit-breaker.service.js';
import { ShutdownService } from '../modules/shutdown/shutdown.service.js';
import { RetryHandlerService } from '../modules/router/services/retry-handler.service.js';
import { RequestBuilderService } from '../modules/router/services/request-builder.service.js';
import { RouterService } from '../modules/router/router.service.js';
import { RateLimiterService } from '../modules/rate-limiter/rate-limiter.service.js';
import { registerRoutes } from './routes.js';
import type { FetchClient } from './fetch-client.js';

export interface CreateAppOptions {
  fetchClient: FetchClient;
  serveStaticFiles?: boolean;
  routerConfig?: RouterConfig;
}

export async function createApp(options: CreateAppOptions): Promise<Hono> {
  const logger = new Logger('App');
  const routerConfig =
    options.routerConfig ?? (await import('../config/router.config.js')).loadRouterConfig();

  const modelsService = new ModelsService({
    config: routerConfig,
    fetchClient: options.fetchClient,
  });
  await modelsService.loadModels();

  const providersMap = createProvidersMap({
    config: routerConfig,
    fetchClient: options.fetchClient,
  });

  const stateService = new StateService({ modelsService, config: routerConfig.circuitBreaker });
  stateService.init();

  const circuitBreaker = new CircuitBreakerService({
    stateService,
    config: stateService.getConfig(),
  });

  const smartStrategy = new SmartStrategy({
    stateService,
    circuitBreaker,
    config: routerConfig,
  });

  const selectorService = new SelectorService({
    modelsService,
    smartStrategy,
    circuitBreaker,
  });

  const shutdownService = new ShutdownService();
  const retryHandler = new RetryHandlerService();
  const requestBuilder = new RequestBuilderService();
  const rateLimiterService = new RateLimiterService({ config: routerConfig });

  const routerService = new RouterService({
    selectorService,
    stateService,
    circuitBreaker,
    shutdownService,
    retryHandler,
    requestBuilder,
    providersMap,
    config: routerConfig,
    rateLimiterService,
  });

  const app = new Hono();

  registerRoutes(app, {
    logger,
    routerConfig,
    modelsService,
    routerService,
    stateService,
    rateLimiterService,
    shutdownService,
    streamSSE,
  });

  if (options.serveStaticFiles) {
    const { serveStatic } = await import('@hono/node-server/serve-static');
    app.use(
      '/*',
      serveStatic({
        root: './public',
        rewriteRequestPath: (path: string) => {
          if (path === '/' || path === '') {
            return '/index.html';
          }
          return path;
        },
      }),
    );
  }

  return app;
}
