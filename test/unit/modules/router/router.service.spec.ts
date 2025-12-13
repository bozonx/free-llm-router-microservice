/* global jest */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { RouterService } from '../../../../src/modules/router/router.service.js';
import { SelectorService } from '../../../../src/modules/selector/selector.service.js';
import { PROVIDERS_MAP } from '../../../../src/modules/providers/providers.module.js';
import type { ChatCompletionRequestDto } from '../../../../src/modules/router/dto/chat-completion.request.dto.js';
import type { LlmProvider } from '../../../../src/modules/providers/interfaces/provider.interface.js';
import type { ModelDefinition } from '../../../../src/modules/models/interfaces/model.interface.js';

// Mock loadRouterConfig
jest.mock('../../../../src/config/router.config.js', () => ({
  loadRouterConfig: jest.fn(() => ({
    modelsFile: './config/models.yaml',
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
      algorithm: 'round-robin',
      maxRetries: 3,
      rateLimitRetries: 2,
      retryDelay: 100,
      timeout: 30000,
      fallback: {
        enabled: true,
        provider: 'deepseek',
        model: 'deepseek-chat',
      },
    },
  })),
  RETRY_JITTER_PERCENT: 20,
}));

describe('RouterService', () => {
  let service: RouterService;
  let selectorService: jest.Mocked<SelectorService>;
  let providersMap: Map<string, LlmProvider>;
  let mockProvider: jest.Mocked<LlmProvider>;

  const mockModel: ModelDefinition = {
    name: 'test-model',
    provider: 'openrouter',
    model: 'test/model',
    type: 'fast',
    contextSize: 4096,
    maxOutputTokens: 2048,
    speed: 'fast',
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

  beforeEach(async () => {
    // Create mock provider
    mockProvider = {
      name: 'openrouter',
      chatCompletion: jest.fn(),
    } as jest.Mocked<LlmProvider>;

    // Create providers map
    providersMap = new Map();
    providersMap.set('openrouter', mockProvider);
    providersMap.set('deepseek', mockProvider);

    // Create mock selector service
    selectorService = {
      selectNextModel: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouterService,
        {
          provide: SelectorService,
          useValue: selectorService,
        },
        {
          provide: PROVIDERS_MAP,
          useValue: providersMap,
        },
      ],
    }).compile();

    service = module.get<RouterService>(RouterService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('chatCompletion', () => {
    it('should succeed on first attempt', async () => {
      // Arrange
      selectorService.selectNextModel.mockReturnValue(mockModel);
      mockProvider.chatCompletion.mockResolvedValue(mockCompletionResult);

      // Act
      const result = await service.chatCompletion(mockRequest);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(mockCompletionResult.id);
      expect(result.model).toBe(mockCompletionResult.model);
      expect(result.choices[0].message.content).toBe(mockCompletionResult.content);
      expect(result._router.provider).toBe('openrouter');
      expect(result._router.model_name).toBe('test-model');
      expect(result._router.attempts).toBe(1);
      expect(result._router.fallback_used).toBe(false);
      expect(result._router.errors).toBeUndefined();
    });

    it('should retry with another model on 5xx error', async () => {
      // Arrange
      const failedModel = { ...mockModel, name: 'failed-model' };
      const successModel = { ...mockModel, name: 'success-model' };

      selectorService.selectNextModel
        .mockReturnValueOnce(failedModel)
        .mockReturnValueOnce(successModel);

      const serverError = new Error('Server error');

      (serverError as any).response = { status: 500 };

      mockProvider.chatCompletion
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(mockCompletionResult);

      // Act
      const result = await service.chatCompletion(mockRequest);

      // Assert
      expect(result).toBeDefined();
      expect(result._router.attempts).toBe(2);
      expect(result._router.fallback_used).toBe(false);
      expect(result._router.errors).toHaveLength(1);
      const errors = result._router.errors;
      if (errors) {
        expect(errors[0].model).toBe('failed-model');
        expect(errors[0].code).toBe(500);
      }
      expect(selectorService.selectNextModel).toHaveBeenCalledTimes(2);
    });

    it('should retry on 429 rate limit error', async () => {
      // Arrange
      selectorService.selectNextModel.mockReturnValue(mockModel);

      const rateLimitError = new Error('Rate limit exceeded');

      (rateLimitError as any).response = { status: 429 };

      mockProvider.chatCompletion
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(mockCompletionResult);

      // Act
      const result = await service.chatCompletion(mockRequest);

      // Assert
      expect(result).toBeDefined();
      expect(result._router.attempts).toBe(1);
      expect(mockProvider.chatCompletion).toHaveBeenCalledTimes(2);
    });

    it('should use fallback when all free models fail', async () => {
      // Arrange
      const model1 = { ...mockModel, name: 'model-1' };
      const model2 = { ...mockModel, name: 'model-2' };

      selectorService.selectNextModel
        .mockReturnValueOnce(model1)
        .mockReturnValueOnce(model2)
        .mockReturnValueOnce(null); // No more models

      const error = new Error('Service unavailable');

      (error as any).response = { status: 503 };

      mockProvider.chatCompletion
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(mockCompletionResult); // Fallback succeeds

      // Act
      const result = await service.chatCompletion(mockRequest);

      // Assert
      expect(result).toBeDefined();
      expect(result._router.fallback_used).toBe(true);
      expect(result._router.attempts).toBe(3);
      expect(result._router.errors).toHaveLength(2);
    });

    it('should throw on client error (400)', async () => {
      // Arrange
      selectorService.selectNextModel.mockReturnValue(mockModel);

      const clientError = new Error('Bad request');

      (clientError as any).response = { status: 400 };

      mockProvider.chatCompletion.mockRejectedValue(clientError);

      // Act & Assert
      await expect(service.chatCompletion(mockRequest)).rejects.toThrow('Bad request');
      expect(selectorService.selectNextModel).toHaveBeenCalledTimes(1);
    });

    it('should throw when all models and fallback fail', async () => {
      // Arrange
      selectorService.selectNextModel.mockReturnValueOnce(mockModel).mockReturnValueOnce(null);

      const error = new Error('Service unavailable');

      (error as any).response = { status: 503 };

      mockProvider.chatCompletion.mockRejectedValue(error);

      // Act & Assert
      await expect(service.chatCompletion(mockRequest)).rejects.toThrow(/All models failed/);
    });

    it('should exclude already tried models', async () => {
      // Arrange
      const model1 = { ...mockModel, name: 'model-1' };
      const model2 = { ...mockModel, name: 'model-2' };

      selectorService.selectNextModel.mockReturnValueOnce(model1).mockReturnValueOnce(model2);

      const error = new Error('Timeout');
      mockProvider.chatCompletion
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(mockCompletionResult);

      // Act
      await service.chatCompletion(mockRequest);

      // Assert
      expect(selectorService.selectNextModel).toHaveBeenNthCalledWith(2, expect.anything(), [
        'model-1',
      ]);
    });

    it('should include router metadata in response', async () => {
      // Arrange
      selectorService.selectNextModel.mockReturnValue(mockModel);
      mockProvider.chatCompletion.mockResolvedValue(mockCompletionResult);

      // Act
      const result = await service.chatCompletion(mockRequest);

      // Assert
      expect(result._router).toEqual({
        provider: 'openrouter',
        model_name: 'test-model',
        attempts: 1,
        fallback_used: false,
        errors: undefined,
      });
    });
  });
});
