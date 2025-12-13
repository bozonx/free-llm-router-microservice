import { Test, type TestingModule } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { SelectorService } from '../../../../src/modules/selector/selector.service.js';
import { ModelsService } from '../../../../src/modules/models/models.service.js';
import { RoundRobinStrategy } from '../../../../src/modules/selector/strategies/round-robin.strategy.js';
import type { ModelDefinition } from '../../../../src/modules/models/interfaces/model.interface.js';

describe('SelectorService', () => {
  let service: SelectorService;
  let modelsService: ModelsService;
  let strategy: RoundRobinStrategy;

  const mockModel: ModelDefinition = {
    name: 'test-model',
    provider: 'openrouter',
    type: 'fast',
    contextSize: 8000,
    maxOutputTokens: 2000,
    speed: 'fast',
    tags: ['general'],
    jsonResponse: true,
    available: true,
    model: 'provider/test-model',
  };

  const mockModelsService = {
    findByName: jest.fn(),
    filter: jest.fn(),
  };

  const mockStrategy = {
    select: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SelectorService,
        { provide: ModelsService, useValue: mockModelsService },
        { provide: RoundRobinStrategy, useValue: mockStrategy },
      ],
    }).compile();

    service = module.get<SelectorService>(SelectorService);
    modelsService = module.get<ModelsService>(ModelsService);
    strategy = module.get<RoundRobinStrategy>(RoundRobinStrategy);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('selectModel', () => {
    it('should return specific model if requested and found', () => {
      mockModelsService.findByName.mockReturnValue(mockModel);

      const result = service.selectModel({ model: 'test-model' });

      expect(modelsService.findByName).toHaveBeenCalledWith('test-model');
      expect(result).toEqual(mockModel);
    });

    it('should return null if specific model not found', () => {
      mockModelsService.findByName.mockReturnValue(undefined);

      const result = service.selectModel({ model: 'non-existent' });

      expect(result).toBeNull();
    });

    it('should use strategy to select from filtered models', () => {
      const filteredModels = [mockModel];
      mockModelsService.filter.mockReturnValue(filteredModels);
      mockStrategy.select.mockReturnValue(mockModel);

      const criteria = { type: 'fast' as const, tags: ['general'] };
      const result = service.selectModel(criteria);

      expect(modelsService.filter).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'fast',
          tags: ['general'],
        }),
      );
      expect(strategy.select).toHaveBeenCalledWith(filteredModels, criteria);
      expect(result).toEqual(mockModel);
    });

    it('should return null if no models match filters', () => {
      mockModelsService.filter.mockReturnValue([]);

      const result = service.selectModel({ type: 'fast' });

      expect(result).toBeNull();
      expect(strategy.select).not.toHaveBeenCalled();
    });
  });

  describe('selectNextModel', () => {
    it('should add excludeModels to criteria', () => {
      const filteredModels = [mockModel];
      mockModelsService.filter.mockReturnValue(filteredModels);
      mockStrategy.select.mockReturnValue(mockModel);

      service.selectNextModel({ type: 'fast' }, ['excluded-model']);

      expect(strategy.select).toHaveBeenCalledWith(
        filteredModels,
        expect.objectContaining({
          excludeModels: ['excluded-model'],
        }),
      );
    });

    it('should merge existing excludeModels', () => {
      mockModelsService.filter.mockReturnValue([mockModel]);

      service.selectNextModel({ type: 'fast', excludeModels: ['initial'] }, ['added']);

      expect(strategy.select).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          excludeModels: ['initial', 'added'],
        }),
      );
    });
  });
});
