import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { SmartStrategy } from '../../../../src/modules/selector/strategies/smart.strategy.js';
import { StateService } from '../../../../src/modules/state/state.service.js';
import { CircuitBreakerService } from '../../../../src/modules/state/circuit-breaker.service.js';
import { ROUTER_CONFIG } from '../../../../src/config/router-config.provider.js';
import type { ModelDefinition } from '../../../../src/modules/models/interfaces/model.interface.js';
import type { RouterConfig } from '../../../../src/config/router-config.interface.js';

describe('SmartStrategy', () => {
  let strategy: SmartStrategy;
  let stateService: jest.Mocked<StateService>;
  let circuitBreaker: jest.Mocked<CircuitBreakerService>;

  const mockModels: ModelDefinition[] = [
    {
      name: 'model-high-priority',
      provider: 'openrouter',
      model: 'test/model-1',
      type: 'fast',
      contextSize: 128000,
      maxOutputTokens: 4096,
      speedTier: 'fast',
      tags: ['general'],
      jsonResponse: true,
      available: true,
      priority: 2, // Higher priority (bigger number)
      weight: 10,
    },
    {
      name: 'model-low-priority',
      provider: 'openrouter',
      model: 'test/model-2',
      type: 'reasoning',
      contextSize: 64000,
      maxOutputTokens: 8192,
      speedTier: 'medium',
      tags: ['code'],
      jsonResponse: false,
      available: true,
      priority: 1, // Lower priority (smaller number)
      weight: 5,
    },
    {
      name: 'model-with-max-concurrent',
      provider: 'deepseek',
      model: 'test/model-3',
      type: 'fast',
      contextSize: 32000,
      maxOutputTokens: 4096,
      speedTier: 'fast',
      tags: ['general'],
      jsonResponse: true,
      available: true,
      priority: 2, // Same as model-high-priority
      weight: 1,
      maxConcurrent: 2,
    },
  ];

  const mockRouterConfig: RouterConfig = {
    modelsFile: './models.yaml',
    providers: {
      openrouter: { enabled: true, apiKey: 'test', baseUrl: 'https://test.com' },
    },
    routing: {
      maxRetries: 3,
      rateLimitRetries: 2,
      retryDelay: 1000,
      timeoutSecs: 30,
      fallback: { enabled: true, provider: 'deepseek', model: 'deepseek-chat' },
    },
    modelOverrides: [
      {
        name: 'model-low-priority',
        priority: 2, // Override to high priority
        weight: 20,
      },
    ],
  };

  const createMockState = (overrides: Partial<ReturnType<StateService['getState']>> = {}) => ({
    name: 'test-model',
    circuitState: 'CLOSED' as const,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    activeRequests: 0,
    stats: {
      totalRequests: 0,
      successCount: 0,
      errorCount: 0,
      avgLatency: 0,
      p95Latency: 0,
      successRate: 1.0,
      requests: [],
    },
    ...overrides,
  });

  beforeEach(async () => {
    stateService = {
      getState: jest
        .fn()
        .mockImplementation((name: unknown) => createMockState({ name: String(name) })),
    } as any;

    circuitBreaker = {
      filterAvailable: jest.fn().mockImplementation(models => models),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmartStrategy,
        { provide: StateService, useValue: stateService },
        { provide: CircuitBreakerService, useValue: circuitBreaker },
        { provide: ROUTER_CONFIG, useValue: mockRouterConfig },
      ],
    }).compile();

    strategy = module.get<SmartStrategy>(SmartStrategy);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('select', () => {
    it('should return null for empty models list', () => {
      const result = strategy.select([], {});
      expect(result).toBeNull();
    });

    it('should filter excluded models', () => {
      circuitBreaker.filterAvailable.mockImplementation(models => models);

      const result = strategy.select(mockModels, {
        excludeModels: ['model-high-priority', 'model-with-max-concurrent'],
      });

      expect(result?.name).toBe('model-low-priority');
    });

    it('should use Circuit Breaker filtering', () => {
      circuitBreaker.filterAvailable.mockReturnValue([mockModels[1]]);

      const result = strategy.select(mockModels, {});

      expect(circuitBreaker.filterAvailable).toHaveBeenCalled();
      expect(result?.name).toBe('model-low-priority');
    });

    it('should filter by maxConcurrent capacity', () => {
      stateService.getState.mockImplementation((name: string) => {
        if (name === 'model-with-max-concurrent') {
          return createMockState({ name, activeRequests: 2 });
        }
        return createMockState({ name });
      });

      const result = strategy.select(mockModels, {});

      // model-with-max-concurrent should be filtered out (2 >= 2)
      expect(result?.name).not.toBe('model-with-max-concurrent');
    });

    it('should filter by minSuccessRate', () => {
      stateService.getState.mockImplementation((name: string) => {
        if (name === 'model-high-priority') {
          return createMockState({
            name,
            stats: { ...createMockState().stats, totalRequests: 10, successRate: 0.5 },
          });
        }
        return createMockState({
          name,
          stats: { ...createMockState().stats, totalRequests: 10, successRate: 0.9 },
        });
      });

      const result = strategy.select(mockModels, { minSuccessRate: 0.8 });

      expect(result?.name).not.toBe('model-high-priority');
    });

    it('should select fastest model when preferFast is true', () => {
      stateService.getState.mockImplementation((name: string) => {
        const latencies: Record<string, number> = {
          'model-high-priority': 500,
          'model-low-priority': 100,
          'model-with-max-concurrent': 300,
        };
        return createMockState({
          name,
          stats: {
            ...createMockState().stats,
            totalRequests: 10,
            avgLatency: latencies[name] ?? 200,
          },
        });
      });

      const result = strategy.select(mockModels, { preferFast: true });

      expect(result?.name).toBe('model-low-priority');
    });

    it('should respect model priority and weights', () => {
      // Simulate models with overrides applied (e.g. by ModelsService)
      const models = [
        { ...mockModels[0] }, // P=2, W=10
        { ...mockModels[1], priority: 2, weight: 20 }, // Override applied: P=1->2, W=5->20
      ];

      stateService.getState.mockImplementation((name: string) => createMockState({ name }));

      // High (P=2, W=10) vs Low (P=2, W=20) -> Both P=2, so weighted selection
      // W=10 vs W=20 -> Low should be selected ~66% of time

      // Run multiple times to get weighted distribution
      const selections: Record<string, number> = {};
      for (let i = 0; i < 100; i++) {
        const result = strategy.select(models, {});
        if (result) {
          selections[result.name] = (selections[result.name] ?? 0) + 1;
        }
      }

      // With weight 10 vs 20, model-low-priority should be selected ~66% of time
      expect(selections['model-low-priority']).toBeGreaterThan(50);
    });

    it('should return null when all models filtered out', () => {
      circuitBreaker.filterAvailable.mockReturnValue([]);

      const result = strategy.select(mockModels, {});

      expect(result).toBeNull();
    });

    it('should group models by priority and select from top group', () => {
      // Test grouping logic: higher priority value = higher priority
      const modelsWithDifferentPriorities: ModelDefinition[] = [
        { ...mockModels[0], priority: 1 }, // Lower priority (smaller number)
        { ...mockModels[1], priority: 2 }, // Higher priority (bigger number)
      ];

      const result = strategy.select(modelsWithDifferentPriorities, {});

      // model-low-priority has priority 2 (higher), so should be selected
      expect(result?.name).toBe('model-low-priority');
    });
  });
});
