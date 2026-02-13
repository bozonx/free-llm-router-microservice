import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SelectorService } from '../../../../src/modules/selector/selector.service.js';
import { ModelsService } from '../../../../src/modules/models/models.service.js';
import { SmartStrategy } from '../../../../src/modules/selector/strategies/smart.strategy.js';
import { CircuitBreakerService } from '../../../../src/modules/state/circuit-breaker.service.js';
import type { ModelDefinition } from '../../../../src/modules/models/interfaces/model.interface.js';

describe('SelectorService', () => {
  let service: SelectorService;
  let modelsService: jest.Mocked<ModelsService>;
  let strategy: jest.Mocked<SmartStrategy>;
  let circuitBreaker: jest.Mocked<CircuitBreakerService>;

  const mockModel: ModelDefinition = {
    name: 'test-model',
    provider: 'openrouter',
    type: 'fast',
    contextSize: 8000,
    maxOutputTokens: 2000,
    tags: ['general'],
    jsonResponse: true,
    available: true,
    model: 'provider/test-model',
  };

  beforeEach(() => {
    modelsService = {
      findByNameAndProvider: jest.fn<() => ModelDefinition[]>(),
      filter: jest.fn<() => ModelDefinition[]>(),
    } as unknown as jest.Mocked<ModelsService>;

    strategy = {
      select: jest.fn<() => Promise<ModelDefinition | null>>(),
    } as unknown as jest.Mocked<SmartStrategy>;

    circuitBreaker = {
      canRequest: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    } as unknown as jest.Mocked<CircuitBreakerService>;

    service = new SelectorService({
      modelsService,
      smartStrategy: strategy,
      circuitBreaker,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('selectModel', () => {
    it('should return specific model from priority list if found', async () => {
      modelsService.findByNameAndProvider.mockReturnValue([mockModel]);
      circuitBreaker.canRequest.mockResolvedValue(true);

      const result = await service.selectModel({
        models: [{ name: 'test-model' }],
        allowAutoFallback: false,
      });

      expect(modelsService.findByNameAndProvider).toHaveBeenCalledWith('test-model', undefined);
      expect(result).toEqual(mockModel);
    });

    it('should return null if specific model not found in priority list', async () => {
      modelsService.findByNameAndProvider.mockReturnValue([]);

      const result = await service.selectModel({
        models: [{ name: 'non-existent' }],
        allowAutoFallback: false,
      });

      expect(result).toBeNull();
    });

    it('should use strategy to select from filtered models', async () => {
      const filteredModels = [mockModel];
      modelsService.filter.mockReturnValue(filteredModels);
      strategy.select.mockResolvedValue(mockModel);

      const criteria = { type: 'fast' as const, tags: ['general'] };
      const result = await service.selectModel(criteria);

      expect(modelsService.filter).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'fast',
          tags: ['general'],
        }),
      );
      expect(strategy.select).toHaveBeenCalledWith(filteredModels, criteria);
      expect(result).toEqual(mockModel);
    });

    it('should return null if no models match filters', async () => {
      modelsService.filter.mockReturnValue([]);

      const result = await service.selectModel({ type: 'fast' });

      expect(result).toBeNull();
      expect(strategy.select).not.toHaveBeenCalled();
    });
  });

  describe('selectNextModel', () => {
    it('should add excludeModels to criteria', async () => {
      const filteredModels = [mockModel];
      modelsService.filter.mockReturnValue(filteredModels);
      strategy.select.mockResolvedValue(mockModel);

      await service.selectNextModel({ type: 'fast' }, ['excluded-model']);

      expect(strategy.select).toHaveBeenCalledWith(
        filteredModels,
        expect.objectContaining({
          excludeModels: ['excluded-model'],
        }),
      );
    });

    it('should merge existing excludeModels', async () => {
      modelsService.filter.mockReturnValue([mockModel]);
      strategy.select.mockResolvedValue(mockModel);

      await service.selectNextModel({ type: 'fast', excludeModels: ['initial'] }, ['added']);

      expect(strategy.select).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          excludeModels: ['initial', 'added'],
        }),
      );
    });
  });
});
