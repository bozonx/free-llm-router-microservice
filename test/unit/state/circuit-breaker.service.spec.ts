import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { CircuitBreakerService } from '../../../src/modules/state/circuit-breaker.service.js';
import { StateService } from '../../../src/modules/state/state.service.js';
import { ModelsService } from '../../../src/modules/models/models.service.js';
import { ROUTER_CONFIG } from '../../../src/config/router-config.provider.js';
import type { RouterConfig } from '../../../src/config/router-config.interface.js';
import type { ModelDefinition } from '../../../src/modules/models/interfaces/model.interface.js';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;
  let stateService: StateService;

  const mockModels: ModelDefinition[] = [
    {
      name: 'test-model',
      provider: 'openrouter',
      model: 'test/model',
      type: 'fast',
      contextSize: 128000,
      maxOutputTokens: 4096,
      speedTier: 'fast',
      tags: ['general'],
      jsonResponse: true,
      available: true,
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
    circuitBreaker: {
      failureThreshold: 3,
      cooldownPeriodSecs: 1, // 1 second for test
      successThreshold: 2,
      statsWindowSizeMins: 5,
    },
  };

  beforeEach(async () => {
    const mockModelsService = {
      getAll: jest.fn().mockReturnValue(mockModels),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StateService,
        CircuitBreakerService,
        { provide: ModelsService, useValue: mockModelsService },
        { provide: ROUTER_CONFIG, useValue: mockRouterConfig },
      ],
    }).compile();

    stateService = module.get<StateService>(StateService);
    service = module.get<CircuitBreakerService>(CircuitBreakerService);

    // Initialize state service
    stateService.onModuleInit();
  });

  afterEach(() => {
    stateService.onModuleDestroy();
  });

  describe('onSuccess', () => {
    it('should record success in state service', () => {
      service.onSuccess('test-model', 100);
      const state = stateService.getState('test-model');
      expect(state.stats.successCount).toBe(1);
    });

    it('should transition HALF_OPEN to CLOSED after enough successes', () => {
      stateService.setCircuitState('test-model', 'HALF_OPEN');

      // Need 2 successes to close (successThreshold: 2)
      service.onSuccess('test-model', 100);
      expect(stateService.getState('test-model').circuitState).toBe('HALF_OPEN');

      service.onSuccess('test-model', 100);
      expect(stateService.getState('test-model').circuitState).toBe('CLOSED');
    });
  });

  describe('onFailure', () => {
    it('should mark model as PERMANENTLY_UNAVAILABLE on 404', () => {
      service.onFailure('test-model', 404);
      const state = stateService.getState('test-model');
      expect(state.circuitState).toBe('PERMANENTLY_UNAVAILABLE');
    });

    it('should open circuit after failure threshold', () => {
      // Need 3 failures to open (failureThreshold: 3)
      service.onFailure('test-model', 500);
      expect(stateService.getState('test-model').circuitState).toBe('CLOSED');

      service.onFailure('test-model', 500);
      expect(stateService.getState('test-model').circuitState).toBe('CLOSED');

      service.onFailure('test-model', 500);
      expect(stateService.getState('test-model').circuitState).toBe('OPEN');
    });

    it('should return to OPEN from HALF_OPEN on failure', () => {
      stateService.setCircuitState('test-model', 'HALF_OPEN');
      service.onFailure('test-model', 500);
      expect(stateService.getState('test-model').circuitState).toBe('OPEN');
    });
  });

  describe('canRequest', () => {
    it('should allow requests for CLOSED circuit', () => {
      expect(service.canRequest('test-model')).toBe(true);
    });

    it('should allow requests for HALF_OPEN circuit', () => {
      stateService.setCircuitState('test-model', 'HALF_OPEN');
      expect(service.canRequest('test-model')).toBe(true);
    });

    it('should block requests for OPEN circuit within cooldown', () => {
      stateService.setCircuitState('test-model', 'OPEN');
      expect(service.canRequest('test-model')).toBe(false);
    });

    it('should transition OPEN to HALF_OPEN after cooldown', async () => {
      stateService.setCircuitState('test-model', 'OPEN');

      // Wait for cooldown (1000ms in test config)
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(service.canRequest('test-model')).toBe(true);
      expect(stateService.getState('test-model').circuitState).toBe('HALF_OPEN');
    });

    it('should block requests for PERMANENTLY_UNAVAILABLE', () => {
      stateService.markPermanentlyUnavailable('test-model');
      expect(service.canRequest('test-model')).toBe(false);
    });
  });

  describe('filterAvailable', () => {
    it('should filter out unavailable models', () => {
      const models: ModelDefinition[] = [
        { ...mockModels[0], name: 'model-1' },
        { ...mockModels[0], name: 'model-2' },
        { ...mockModels[0], name: 'model-3' },
      ];

      // Make model-2 unavailable
      stateService.setCircuitState('model-2', 'OPEN');

      const available = service.filterAvailable(models);
      expect(available).toHaveLength(2);
      expect(available.map(m => m.name)).toContain('model-1');
      expect(available.map(m => m.name)).toContain('model-3');
      expect(available.map(m => m.name)).not.toContain('model-2');
    });
  });

  describe('getRemainingCooldown', () => {
    it('should return 0 for CLOSED circuit', () => {
      expect(service.getRemainingCooldown('test-model')).toBe(0);
    });

    it('should return remaining time for OPEN circuit', () => {
      stateService.setCircuitState('test-model', 'OPEN');
      const remaining = service.getRemainingCooldown('test-model');
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(1000);
    });
  });
});
