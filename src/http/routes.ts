import type { Context, Hono } from 'hono';
import type { LoggerLike } from '../common/logger.js';
import type { RouterConfig } from '../config/router-config.interface.js';
import type { ModelsService } from '../modules/models/models.service.js';
import type { RouterService } from '../modules/router/router.service.js';
import type { StateService } from '../modules/state/state.service.js';
import type { RateLimiterService } from '../modules/rate-limiter/rate-limiter.service.js';
import type { ShutdownService } from '../modules/shutdown/shutdown.service.js';
import type { SSEStreamingApi, streamSSE } from 'hono/streaming';
import { HttpError, NotFoundError } from '../common/http-errors.js';
import { validateDto } from './validation.js';
import { ChatCompletionRequestDto } from '../modules/router/dto/chat-completion.request.dto.js';

const startedAt = Date.now();

export function registerRoutes(
  app: Hono,
  deps: {
    logger: LoggerLike;
    routerConfig: RouterConfig;
    modelsService: ModelsService;
    routerService: RouterService;
    stateService: StateService;
    rateLimiterService: RateLimiterService;
    shutdownService: ShutdownService;
    streamSSE: typeof streamSSE;
  },
): void {
  // Use config instead of process.env
  // Note: Hono can also use basePath if needed, but here it's used to construct apiPrefix
  const apiPrefix = '/api/v1'; 

  app.onError((err: Error, c: Context) => {
    if (err instanceof HttpError) {
      return c.json(err.body ?? { message: err.message }, err.statusCode as any);
    }

    const message = err instanceof Error ? err.message : String(err);
    deps.logger.error(message, err);

    return c.json(
      {
        statusCode: 500,
        timestamp: new Date().toISOString(),
        path: c.req.path,
        method: c.req.method,
        message,
        error: 'InternalServerError',
      },
      500,
    );
  });

  // Health
  app.get(`${apiPrefix}/health`, (c: Context) => c.json({ status: 'ok' }));

  // Models
  app.get(`${apiPrefix}/models`, (c: Context) => {
    const models = deps.modelsService.getAvailable();
    return c.json({
      models: models.map(model => ({
        name: model.name,
        provider: model.provider,
        model: model.model,
        type: model.type,
        contextSize: model.contextSize,
        maxOutputTokens: model.maxOutputTokens,
        tags: model.tags,
        jsonResponse: model.jsonResponse,
        available: model.available,
        weight: model.weight,
        supportsImage: model.supportsImage,
        supportsVideo: model.supportsVideo,
        supportsAudio: model.supportsAudio,
        supportsFile: model.supportsFile,
      })),
    });
  });

  // Admin
  app.get(`${apiPrefix}/admin/state`, async (c: Context) => {
    const states = await deps.stateService.getAllStates();
    const models = states.map(state => {
      const modelDef = deps.modelsService.findModel(state.name);
      const provider = modelDef?.provider
        ? modelDef.provider.charAt(0).toUpperCase() + modelDef.provider.slice(1)
        : 'Unknown';

      return {
        ...state,
        modelName: state.name,
        providerName: provider,
        tags: modelDef?.tags || [],
        type: modelDef?.type || 'fast',
        contextSize: modelDef?.contextSize || 0,
        weight: modelDef?.weight || 1,
        supportsImage: modelDef?.supportsImage || false,
        supportsVideo: modelDef?.supportsVideo || false,
        supportsAudio: modelDef?.supportsAudio || false,
        supportsFile: modelDef?.supportsFile || false,
        jsonResponse: modelDef?.jsonResponse || false,
        model: modelDef?.model || '',
        provider: modelDef?.provider || '',
      };
    });

    return c.json({ models, timestamp: new Date().toISOString() });
  });

  app.get(`${apiPrefix}/admin/state/:modelName`, async (c: Context) => {
    const modelName = c.req.param('modelName');
    // Check if model exists in definitions first as hasState is less reliable now with Redis
    const modelDef = deps.modelsService.findModel(modelName);
    if (!modelDef) {
      throw new NotFoundError(`Model \"${modelName}\" not found`);
    }
    return c.json(await deps.stateService.getState(modelName));
  });

  app.post(`${apiPrefix}/admin/state/:modelName/reset`, async (c: Context) => {
    const modelName = c.req.param('modelName');
    const modelDef = deps.modelsService.findModel(modelName);
    if (!modelDef) {
      throw new NotFoundError(`Model \"${modelName}\" not found`);
    }
    await deps.stateService.resetState(modelName);
    return c.json({ message: `State for model ${modelName} reset` });
  });

  app.get(`${apiPrefix}/admin/metrics`, async (c: Context) => {
    const states = await deps.stateService.getAllStates();

    const totalRequests = states.reduce((sum, s) => sum + s.stats.totalRequests, 0);
    const successfulRequests = states.reduce((sum, s) => sum + s.stats.successCount, 0);
    const failedRequests = states.reduce((sum, s) => sum + s.stats.errorCount, 0);

    let totalLatencyProduct = 0;
    let totalLatencyCount = 0;
    states.forEach(s => {
      if (s.stats.successCount > 0) {
        totalLatencyProduct += s.stats.avgLatency * s.stats.successCount;
        totalLatencyCount += s.stats.successCount;
      }
    });

    const avgLatency = totalLatencyCount > 0 ? totalLatencyProduct / totalLatencyCount : 0;

    const modelsAvailable = states.filter(
      s => s.circuitState === 'CLOSED' || s.circuitState === 'HALF_OPEN',
    ).length;
    const modelsInOpenState = states.filter(s => s.circuitState === 'OPEN').length;
    const modelsPermanentlyUnavailable = states.filter(
      s => s.circuitState === 'PERMANENTLY_UNAVAILABLE',
    ).length;

    return c.json({
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      totalRequests,
      successfulRequests,
      failedRequests,
      fallbacksUsed: await deps.stateService.getFallbacksUsed(),
      avgLatency: Math.round(avgLatency),
      modelsAvailable,
      modelsInOpenState,
      modelsPermanentlyUnavailable,
    });
  });
 
  app.post(`${apiPrefix}/admin/maintenance`, async (c: Context) => {
    await deps.routerService.performMaintenance();
    return c.json({ message: 'Maintenance completed successfully' });
  });

  app.get('/admin/rate-limits', (c: Context) =>
    c.json(deps.rateLimiterService.getStatus()),
  );

  // Chat completions
  app.post(`${apiPrefix}/chat/completions`, async (c: Context) => {
    const payload = await c.req.json();
    const request = validateDto({ dtoClass: ChatCompletionRequestDto, payload });

    const abortController = new AbortController();
    const clientSignal = abortController.signal;

    if (request.stream) {
      c.header('Content-Encoding', 'Identity');
      return deps.streamSSE(c, async (stream: SSEStreamingApi) => {
        for await (const chunk of deps.routerService.chatCompletionStream(request, clientSignal)) {
          const sseData: Record<string, unknown> = {
            id: chunk.id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: chunk.model,
            choices: [
              {
                index: 0,
                delta: chunk.delta,
                finish_reason: chunk.finishReason ?? null,
              },
            ],
          };

          if (chunk._router) {
            sseData._router = chunk._router;
          }

          await stream.writeSSE({ data: JSON.stringify(sseData) });
        }

        await stream.writeSSE({ data: '[DONE]' });
      });
    }

    const response = await deps.routerService.chatCompletion(request, clientSignal);
    return c.json(response);
  });

  // Root UI is handled by static middleware in createApp (must be after API routes)
  app.get('/', (c: Context) => c.text('Not Found', 404));
}
