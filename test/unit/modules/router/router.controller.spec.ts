import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { RouterController } from '../../../../src/modules/router/router.controller.js';
import { RouterService } from '../../../../src/modules/router/router.service.js';
import { ModelsService } from '../../../../src/modules/models/models.service.js';
import { RateLimiterGuard } from '../../../../src/modules/rate-limiter/rate-limiter.guard.js';
import { RateLimiterService } from '../../../../src/modules/rate-limiter/rate-limiter.service.js';
import type { ChatCompletionRequestDto } from '../../../../src/modules/router/dto/chat-completion.request.dto.js';
import type { ChatCompletionResponseDto } from '../../../../src/modules/router/dto/chat-completion.response.dto.js';
import type { ModelDefinition } from '../../../../src/modules/models/interfaces/model.interface.js';

describe('RouterController', () => {
  let controller: RouterController;
  let routerService: jest.Mocked<RouterService>;
  let modelsService: jest.Mocked<ModelsService>;

  const mockRequest: ChatCompletionRequestDto = {
    messages: [{ role: 'user', content: 'Hello' }],
  };

  const mockResponse: ChatCompletionResponseDto = {
    id: 'test-id-123',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'test/model',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello! How can I help you?',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
    _router: {
      provider: 'openrouter',
      model_name: 'test-model',
      attempts: 1,
      fallback_used: false,
    },
  };

  const mockModels: ModelDefinition[] = [
    {
      name: 'model-1',
      provider: 'openrouter',
      model: 'test/model-1',
      type: 'fast',
      contextSize: 4096,
      maxOutputTokens: 2048,
      speed: 'fast',
      tags: ['general'],
      jsonResponse: true,
      available: true,
    },
    {
      name: 'model-2',
      provider: 'deepseek',
      model: 'deepseek/model-2',
      type: 'reasoning',
      contextSize: 8192,
      maxOutputTokens: 4096,
      speed: 'medium',
      tags: ['reasoning', 'code'],
      jsonResponse: false,
      available: true,
    },
  ];

  // Mock for RateLimiterService
  const mockRateLimiterService = {
    isEnabled: jest.fn().mockReturnValue(false),
    checkAll: jest.fn().mockReturnValue({ allowed: true }),
    getRateLimitInfo: jest
      .fn()
      .mockReturnValue({ limit: 100, remaining: 99, reset: Math.floor(Date.now() / 1000) + 60 }),
  };

  beforeEach(async () => {
    // Create mocks
    routerService = {
      chatCompletion: jest.fn(),
    } as any;

    modelsService = {
      getAvailable: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RouterController],
      providers: [
        {
          provide: RouterService,
          useValue: routerService,
        },
        {
          provide: ModelsService,
          useValue: modelsService,
        },
        {
          provide: RateLimiterService,
          useValue: mockRateLimiterService,
        },
        RateLimiterGuard,
      ],
    }).compile();

    controller = module.get<RouterController>(RouterController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('chatCompletion', () => {
    it('should handle chat completion request successfully', async () => {
      // Arrange
      routerService.chatCompletion.mockResolvedValue(mockResponse);

      // Act
      const result = await controller.chatCompletion(mockRequest);

      // Assert
      expect(result).toEqual(mockResponse);
      expect(routerService.chatCompletion).toHaveBeenCalledWith(mockRequest);
      expect(routerService.chatCompletion).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors from router service', async () => {
      // Arrange
      const error = new Error('Service unavailable');
      routerService.chatCompletion.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.chatCompletion(mockRequest)).rejects.toThrow('Service unavailable');
      expect(routerService.chatCompletion).toHaveBeenCalledWith(mockRequest);
    });

    it('should handle request with all optional parameters', async () => {
      // Arrange
      const fullRequest: ChatCompletionRequestDto = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.7,
        max_tokens: 500,
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.5,
        stop: ['END'],
        model: 'specific-model',
        tags: ['code'],
        type: 'reasoning',
        min_context_size: 8192,
        json_response: true,
      };

      routerService.chatCompletion.mockResolvedValue(mockResponse);

      // Act
      const result = await controller.chatCompletion(fullRequest);

      // Assert
      expect(result).toEqual(mockResponse);
      expect(routerService.chatCompletion).toHaveBeenCalledWith(fullRequest);
    });
  });

  describe('getModels', () => {
    it('should return list of available models', () => {
      // Arrange
      modelsService.getAvailable.mockReturnValue(mockModels);

      // Act
      const result = controller.getModels();

      // Assert
      expect(result).toEqual({
        models: [
          {
            name: 'model-1',
            provider: 'openrouter',
            type: 'fast',
            context_size: 4096,
            tags: ['general'],
            available: true,
          },
          {
            name: 'model-2',
            provider: 'deepseek',
            type: 'reasoning',
            context_size: 8192,
            tags: ['reasoning', 'code'],
            available: true,
          },
        ],
      });
      expect(modelsService.getAvailable).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no models available', () => {
      // Arrange
      modelsService.getAvailable.mockReturnValue([]);

      // Act
      const result = controller.getModels();

      // Assert
      expect(result).toEqual({ models: [] });
      expect(modelsService.getAvailable).toHaveBeenCalledTimes(1);
    });
  });
});
