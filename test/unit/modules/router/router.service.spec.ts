import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { RouterService } from '../../../../src/modules/router/router.service.js';
import { SelectorService } from '../../../../src/modules/selector/selector.service.js';
import { StateService } from '../../../../src/modules/state/state.service.js';
import { CircuitBreakerService } from '../../../../src/modules/state/circuit-breaker.service.js';
import { ShutdownService } from '../../../../src/modules/shutdown/shutdown.service.js';
import { RetryHandlerService } from '../../../../src/modules/router/services/retry-handler.service.js';
import { RequestBuilderService } from '../../../../src/modules/router/services/request-builder.service.js';
import { RateLimiterService } from '../../../../src/modules/rate-limiter/rate-limiter.service.js';
import type { ChatCompletionRequestDto } from '../../../../src/modules/router/dto/chat-completion.request.dto.js';
import type { LlmProvider } from '../../../../src/modules/providers/interfaces/provider.interface.js';
import type { ModelDefinition } from '../../../../src/modules/models/interfaces/model.interface.js';
import type { RouterConfig } from '../../../../src/config/router-config.interface.js';

describe('RouterService', () => {
  let service: RouterService;
  let selectorService: jest.Mocked<SelectorService>;
  let stateService: jest.Mocked<StateService>;
  let circuitBreaker: jest.Mocked<CircuitBreakerService>;
  let shutdownService: jest.Mocked<ShutdownService>;
  let rateLimiterService: jest.Mocked<RateLimiterService>;
  let providersMap: Map<string, LlmProvider>;
  let mockProvider: jest.Mocked<LlmProvider>;

  const mockConfig: RouterConfig = {
    modelsFile: './models.yaml',
    providers: {
      openrouter: {
        enabled: true,
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      deepseek: {
        enabled: true,
        apiKey: 'test-key',
        baseUrl: 'https://api.deepseek.com',
      },
    },
    routing: {
      maxModelSwitches: 3,
      maxSameModelRetries: 2,
      retryDelay: 10, // speed up tests
      timeoutSecs: 30,
      fallback: {
        enabled: true,
        provider: 'deepseek',
        model: 'deepseek-chat',
      },
    },
  };

  const mockModel: ModelDefinition = {
    name: 'test-model',
    provider: 'openrouter',
    model: 'test/model',
    type: 'fast',
    contextSize: 4096,
    maxOutputTokens: 2048,
    tags: ['general'],
    jsonResponse: true,
    available: true,
  };

  const mockRequest: ChatCompletionRequestDto = {
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const mockCompletionResult = {
    id: 'test-id-123',
    model: 'test/model',
    content: 'Hello! How can I help you?',
    finishReason: 'stop' as const,
    usage: {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    },
  };

  beforeEach(() => {
    // Create mock provider
    mockProvider = {
      name: 'openrouter',
      chatCompletion: jest.fn<() => Promise<any>>(),
      chatCompletionStream: jest.fn<() => AsyncGenerator<any, void, unknown>>(),
    } as unknown as jest.Mocked<LlmProvider>;

    // Create providers map
    providersMap = new Map();
    providersMap.set('openrouter', mockProvider);
    providersMap.set('deepseek', mockProvider);

    // Create mock services
    selectorService = {
      selectNextModel: jest.fn<() => Promise<ModelDefinition | null>>(),
    } as any;

    stateService = {
      incrementActiveRequests: jest.fn(),
      decrementActiveRequests: jest.fn(),
      recordSuccess: jest.fn<() => Promise<void>>(),
      recordFailure: jest.fn<() => Promise<void>>(),
      recordFallbackUsage: jest.fn<() => Promise<void>>(),
      getState: jest.fn<() => Promise<any>>().mockResolvedValue({
        name: 'test-model',
        circuitState: 'CLOSED',
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        activeRequests: 0,
        stats: {
          totalRequests: 0,
          successCount: 0,
          errorCount: 0,
          avgLatency: 0,
          p95Latency: 0,
          successRate: 1,
          requests: [],
        },
      }),
    } as any;

    circuitBreaker = {
      onSuccess: jest.fn<() => Promise<void>>(),
      onFailure: jest.fn<() => Promise<void>>(),
      canRequest: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
      filterAvailable: jest.fn<() => Promise<ModelDefinition[]>>().mockImplementation(async models => models),
    } as any;

    shutdownService = {
      shuttingDown: false,
      registerRequest: jest.fn(),
      unregisterRequest: jest.fn(),
      createRequestSignal: jest.fn().mockReturnValue(new AbortController().signal),
      getAbortSignal: jest.fn().mockReturnValue(null),
    } as any;

    rateLimiterService = {
      checkModel: jest.fn().mockReturnValue(true),
    } as any;

    service = new RouterService({
      selectorService,
      stateService,
      circuitBreaker,
      shutdownService,
      retryHandler: new RetryHandlerService(),
      requestBuilder: new RequestBuilderService(),
      providersMap,
      config: mockConfig,
      rateLimiterService,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('chatCompletion', () => {
    it('should succeed on first attempt', async () => {
      selectorService.selectNextModel.mockResolvedValue(mockModel);
      mockProvider.chatCompletion.mockResolvedValue(mockCompletionResult);

      const result = await service.chatCompletion(mockRequest);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockCompletionResult.id);
      expect(result._router.attempts).toBe(1);
    });

    it('should retry with another model on 5xx error', async () => {
      const failedModel = { ...mockModel, name: 'failed-model' };
      const successModel = { ...mockModel, name: 'success-model' };

      selectorService.selectNextModel
        .mockResolvedValueOnce(failedModel)
        .mockResolvedValueOnce(successModel);

      const serverError = new Error('Server error');
      (serverError as any).response = { status: 500 };

      mockProvider.chatCompletion
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(mockCompletionResult);

      const result = await service.chatCompletion(mockRequest);

      expect(result).toBeDefined();
      expect(result._router.attempts).toBe(2);
      expect(result._router.errors).toHaveLength(1);
      expect(selectorService.selectNextModel).toHaveBeenCalledTimes(2);
    });

    it('should retry on 429 rate limit error', async () => {
      selectorService.selectNextModel.mockResolvedValue(mockModel);

      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).response = { status: 429 };

      mockProvider.chatCompletion
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(mockCompletionResult);

      const result = await service.chatCompletion(mockRequest);

      expect(result).toBeDefined();
      // Notice: 429 should retry on SAME model first depending on config, 
      // but if SelectorService is called again or provider.chatCompletion is just called again...
      // in current implementation it retries with the SAME model instance if possible.
      expect(mockProvider.chatCompletion).toHaveBeenCalledTimes(2);
    });

    it('should use fallback when all free models fail', async () => {
      const model1 = { ...mockModel, name: 'model-1' };
      const model2 = { ...mockModel, name: 'model-2' };

      selectorService.selectNextModel
        .mockResolvedValueOnce(model1)
        .mockResolvedValueOnce(model2)
        .mockResolvedValueOnce(null);

      const error = new Error('Service unavailable');
      (error as any).response = { status: 503 };

      mockProvider.chatCompletion
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(mockCompletionResult);

      const result = await service.chatCompletion(mockRequest);

      expect(result).toBeDefined();
      expect(result._router.fallback_used).toBe(true);
      expect(result._router.attempts).toBe(4); // 2 free models + 1 fallback (which might retry internally or be an attempt itself)
    });

    it('should throw on client error (400)', async () => {
      selectorService.selectNextModel.mockResolvedValue(mockModel);
      const clientError = new Error('Bad request');
      (clientError as any).response = { status: 400 };
      mockProvider.chatCompletion.mockRejectedValue(clientError);

      await expect(service.chatCompletion(mockRequest)).rejects.toThrow('Bad request');
    });

    it('should switch model when capability error occurs', async () => {
      const failedModel = { ...mockModel, name: 'failed-model' };
      const successModel = { ...mockModel, name: 'success-model' };

      selectorService.selectNextModel
        .mockResolvedValueOnce(failedModel)
        .mockResolvedValueOnce(successModel);

      const capabilityError = new Error('response_format is not supported by this model');
      (capabilityError as any).response = { status: 400 };

      mockProvider.chatCompletion
        .mockRejectedValueOnce(capabilityError)
        .mockResolvedValueOnce(mockCompletionResult);

      const result = await service.chatCompletion({ 
        ...mockRequest, 
        response_format: { type: 'json_object' } 
      });

      expect(result).toBeDefined();
      expect(result._router.attempts).toBe(2);
    });

    it('should exclude already tried models', async () => {
      const model1 = { ...mockModel, name: 'model-1' };
      const model2 = { ...mockModel, name: 'model-2' };

      selectorService.selectNextModel
        .mockResolvedValueOnce(model1)
        .mockResolvedValueOnce(model2);

      const error = new Error('Service unavailable');
      (error as any).response = { status: 503 };

      mockProvider.chatCompletion
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(mockCompletionResult);

      await service.chatCompletion(mockRequest);

      expect(selectorService.selectNextModel).toHaveBeenNthCalledWith(2, expect.anything(), [
        'openrouter/model-1',
      ]);
    });
  });
});
