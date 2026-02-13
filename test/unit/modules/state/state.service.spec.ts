import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { StateService } from '../../../../src/modules/state/state.service.js';
import { ModelsService } from '../../../../src/modules/models/models.service.js';
import { InMemoryStateStorage } from '../../../../src/modules/state/storage/in-memory-state-storage.js';
import type { CircuitBreakerConfig } from '../../../../src/modules/state/interfaces/state.interface.js';
import type { ModelDefinition } from '../../../../src/modules/models/interfaces/model.interface.js';

describe('StateService', () => {
  let service: StateService;
  let storage: InMemoryStateStorage;

  const mockModels: ModelDefinition[] = [
    {
      name: 'test-model-1',
      provider: 'openrouter',
      model: 'test/model-1',
      type: 'fast',
      contextSize: 128000,
      maxOutputTokens: 4096,
      tags: ['general'],
      jsonResponse: true,
      available: true,
    },
    {
      name: 'test-model-2',
      provider: 'deepseek',
      model: 'test/model-2',
      type: 'reasoning',
      contextSize: 64000,
      maxOutputTokens: 8192,
      tags: ['code'],
      jsonResponse: false,
      available: true,
    },
  ];

  const mockCircuitBreakerConfig: Partial<CircuitBreakerConfig> = {
    failureThreshold: 3,
    cooldownPeriodMins: 1,
    successThreshold: 2,
    statsWindowSizeMins: 10,
  };

  beforeEach(async () => {
    const mockModelsService = {
      getModels: jest.fn<() => ModelDefinition[]>().mockReturnValue(mockModels),
    } as unknown as ModelsService;

    storage = new InMemoryStateStorage();
    
    service = new StateService({
      modelsService: mockModelsService,
      storage,
      config: mockCircuitBreakerConfig,
    });

    // Trigger initialization
    await service.init();
  });

  afterEach(async () => {
    await service.close();
  });

  describe('init', () => {
    it('should initialize states for all models', async () => {
      const states = await service.getAllStates();
      expect(states).toHaveLength(2);
      expect(states.map(s => s.name)).toContain('test-model-1');
      expect(states.map(s => s.name)).toContain('test-model-2');
    });

    it('should set initial state to CLOSED', async () => {
      const state = await service.getState('test-model-1');
      expect(state.circuitState).toBe('CLOSED');
      expect(state.consecutiveFailures).toBe(0);
      expect(state.consecutiveSuccesses).toBe(0);
    });
  });

  describe('getState', () => {
    it('should return existing state', async () => {
      const state = await service.getState('test-model-1');
      expect(state.name).toBe('test-model-1');
    });

    it('should create initial state for unknown model', async () => {
      const state = await service.getState('unknown-model');
      expect(state.name).toBe('unknown-model');
      expect(state.circuitState).toBe('CLOSED');
    });
  });

  describe('recordSuccess', () => {
    it('should increment consecutive successes', async () => {
      await service.recordSuccess('test-model-1', 100);
      const state = await service.getState('test-model-1');
      expect(state.consecutiveSuccesses).toBe(1);
      expect(state.consecutiveFailures).toBe(0);
    });

    it('should reset consecutive failures on success', async () => {
      await service.recordFailure('test-model-1');
      await service.recordFailure('test-model-1');
      await service.recordSuccess('test-model-1', 100);
      const state = await service.getState('test-model-1');
      expect(state.consecutiveFailures).toBe(0);
    });

    it('should add request to stats', async () => {
      await service.recordSuccess('test-model-1', 150);
      const state = await service.getState('test-model-1');
      expect(state.stats.totalRequests).toBe(1);
      expect(state.stats.successCount).toBe(1);
      expect(state.stats.avgLatency).toBe(150);
    });
  });

  describe('recordFailure', () => {
    it('should increment consecutive failures', async () => {
      await service.recordFailure('test-model-1');
      const state = await service.getState('test-model-1');
      expect(state.consecutiveFailures).toBe(1);
      expect(state.consecutiveSuccesses).toBe(0);
    });

    it('should reset consecutive successes on failure', async () => {
      await service.recordSuccess('test-model-1', 100);
      await service.recordSuccess('test-model-1', 100);
      await service.recordFailure('test-model-1');
      const state = await service.getState('test-model-1');
      expect(state.consecutiveSuccesses).toBe(0);
    });

    it('should add request to stats', async () => {
      await service.recordFailure('test-model-1', 50);
      const state = await service.getState('test-model-1');
      expect(state.stats.totalRequests).toBe(1);
      expect(state.stats.errorCount).toBe(1);
    });
  });

  describe('markPermanentlyUnavailable', () => {
    it('should set circuit state to PERMANENTLY_UNAVAILABLE', async () => {
      await service.markPermanentlyUnavailable('test-model-1', '404 Not Found');
      const state = await service.getState('test-model-1');
      expect(state.circuitState).toBe('PERMANENTLY_UNAVAILABLE');
      expect(state.unavailableReason).toBe('404 Not Found');
    });
  });

  describe('setCircuitState', () => {
    it('should set circuit state', async () => {
      await service.setCircuitState('test-model-1', 'OPEN');
      const state = await service.getState('test-model-1');
      expect(state.circuitState).toBe('OPEN');
      expect(state.openedAt).toBeDefined();
    });

    it('should clear openedAt when closing circuit', async () => {
      await service.setCircuitState('test-model-1', 'OPEN');
      await service.setCircuitState('test-model-1', 'CLOSED');
      const state = await service.getState('test-model-1');
      expect(state.openedAt).toBeUndefined();
      expect(state.consecutiveFailures).toBe(0);
    });
  });

  describe('isAvailable', () => {
    it('should return true for CLOSED state', async () => {
      expect(await service.isAvailable('test-model-1')).toBe(true);
    });

    it('should return true for HALF_OPEN state', async () => {
      await service.setCircuitState('test-model-1', 'HALF_OPEN');
      expect(await service.isAvailable('test-model-1')).toBe(true);
    });

    it('should return false for OPEN state', async () => {
      await service.setCircuitState('test-model-1', 'OPEN');
      expect(await service.isAvailable('test-model-1')).toBe(false);
    });

    it('should return false for PERMANENTLY_UNAVAILABLE state', async () => {
      await service.markPermanentlyUnavailable('test-model-1');
      expect(await service.isAvailable('test-model-1')).toBe(false);
    });
  });

  describe('resetState', () => {
    it('should reset model state to initial', async () => {
      await service.recordFailure('test-model-1');
      await service.setCircuitState('test-model-1', 'OPEN');
      await service.resetState('test-model-1');

      const state = await service.getState('test-model-1');
      expect(state.circuitState).toBe('CLOSED');
      expect(state.consecutiveFailures).toBe(0);
    });
  });

  describe('statistics calculation', () => {
    it('should calculate success rate correctly', async () => {
      await service.recordSuccess('test-model-1', 100);
      await service.recordSuccess('test-model-1', 100);
      await service.recordFailure('test-model-1', 50);

      const state = await service.getState('test-model-1');
      expect(state.stats.totalRequests).toBe(3);
      expect(state.stats.successCount).toBe(2);
      expect(state.stats.errorCount).toBe(1);
      expect(state.stats.successRate).toBeCloseTo(0.667, 2);
    });

    it('should calculate average latency from successful requests', async () => {
      await service.recordSuccess('test-model-1', 100);
      await service.recordSuccess('test-model-1', 200);
      await service.recordSuccess('test-model-1', 300);

      const state = await service.getState('test-model-1');
      expect(state.stats.avgLatency).toBe(200);
    });
  });
});
