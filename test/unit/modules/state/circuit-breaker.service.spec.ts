import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { CircuitBreakerService } from '../../../../src/modules/state/circuit-breaker.service.js';
import { StateService } from '../../../../src/modules/state/state.service.js';
import { ModelsService } from '../../../../src/modules/models/models.service.js';
import { InMemoryStateStorage } from '../../../../src/modules/state/storage/in-memory-state-storage.js';
import type { CircuitBreakerConfig } from '../../../../src/modules/state/interfaces/state.interface.js';
import type { ModelDefinition } from '../../../../src/modules/models/interfaces/model.interface.js';

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
      tags: ['general'],
      jsonResponse: true,
      available: true,
    },
  ];

  const mockCircuitBreakerConfig: CircuitBreakerConfig = {
    failureThreshold: 3,
    cooldownPeriodMins: 0.0167, // ~1 second for test (1/60 minute)
    successThreshold: 2,
    statsWindowSizeMins: 10,
  };

  beforeEach(async () => {
    const mockModelsService = {
      getModels: jest.fn<() => ModelDefinition[]>().mockReturnValue(mockModels),
    } as unknown as ModelsService;

    const storage = new InMemoryStateStorage();
    stateService = new StateService({
      modelsService: mockModelsService,
      storage,
      config: mockCircuitBreakerConfig,
    });

    service = new CircuitBreakerService({
      stateService,
      config: mockCircuitBreakerConfig,
    });

    // Initialize state service
    await stateService.init();
  });

  afterEach(async () => {
    await stateService.close();
    jest.useRealTimers();
  });

  describe('onSuccess', () => {
    it('should record success in state service', async () => {
      await service.onSuccess('test-model', 100);
      const state = await stateService.getState('test-model');
      expect(state.stats.successCount).toBe(1);
    });

    it('should transition HALF_OPEN to CLOSED after enough successes', async () => {
      await stateService.setCircuitState('test-model', 'HALF_OPEN');

      // Need 2 successes to close (successThreshold: 2)
      await service.onSuccess('test-model', 100);
      expect((await stateService.getState('test-model')).circuitState).toBe('HALF_OPEN');

      await service.onSuccess('test-model', 100);
      expect((await stateService.getState('test-model')).circuitState).toBe('CLOSED');
    });
  });

  describe('onFailure', () => {
    it('should mark model as PERMANENTLY_UNAVAILABLE on 404', async () => {
      await service.onFailure('test-model', 404);
      const state = await stateService.getState('test-model');
      expect(state.circuitState).toBe('PERMANENTLY_UNAVAILABLE');
    });

    it('should open circuit after failure threshold', async () => {
      // Need 3 failures to open (failureThreshold: 3)
      await service.onFailure('test-model', 501);
      expect((await stateService.getState('test-model')).circuitState).toBe('CLOSED');

      await service.onFailure('test-model', 501);
      expect((await stateService.getState('test-model')).circuitState).toBe('CLOSED');

      await service.onFailure('test-model', 501);
      expect((await stateService.getState('test-model')).circuitState).toBe('OPEN');
    });

    it('should return to OPEN from HALF_OPEN on failure', async () => {
      await stateService.setCircuitState('test-model', 'HALF_OPEN');
      await service.onFailure('test-model', 501);
      expect((await stateService.getState('test-model')).circuitState).toBe('OPEN');
    });
  });

  describe('canRequest', () => {
    it('should allow requests for CLOSED circuit', async () => {
      expect(await service.canRequest('test-model')).toBe(true);
    });

    it('should allow requests for HALF_OPEN circuit', async () => {
      await stateService.setCircuitState('test-model', 'HALF_OPEN');
      expect(await service.canRequest('test-model')).toBe(true);
    });

    it('should block requests for OPEN circuit within cooldown', async () => {
      await stateService.setCircuitState('test-model', 'OPEN');
      expect(await service.canRequest('test-model')).toBe(false);
    });

    it('should transition OPEN to HALF_OPEN after cooldown', async () => {
      jest.useFakeTimers();
      await stateService.setCircuitState('test-model', 'OPEN');

      // Cooldown is ~1 second (0.0167 min)
      jest.advanceTimersByTime(1100);

      expect(await service.canRequest('test-model')).toBe(true);
      expect((await stateService.getState('test-model')).circuitState).toBe('HALF_OPEN');
    });

    it('should block requests for PERMANENTLY_UNAVAILABLE', async () => {
      await stateService.markPermanentlyUnavailable('test-model');
      expect(await service.canRequest('test-model')).toBe(false);
    });
  });

  describe('filterAvailable', () => {
    it('should filter out unavailable models', async () => {
      const models: ModelDefinition[] = [
        { ...mockModels[0], name: 'model-1' },
        { ...mockModels[0], name: 'model-2' },
        { ...mockModels[0], name: 'model-3' },
      ];

      // Make model-2 unavailable
      await stateService.setCircuitState('model-2', 'OPEN');

      const available = await service.filterAvailable(models);
      expect(available).toHaveLength(2);
      expect(available.map(m => m.name)).toContain('model-1');
      expect(available.map(m => m.name)).toContain('model-3');
      expect(available.map(m => m.name)).not.toContain('model-2');
    });
  });

  describe('getRemainingCooldown', () => {
    it('should return 0 for CLOSED circuit', async () => {
      expect(await service.getRemainingCooldown('test-model')).toBe(0);
    });

    it('should return remaining time for OPEN circuit', async () => {
      await stateService.setCircuitState('test-model', 'OPEN');
      const remaining = await service.getRemainingCooldown('test-model');
      expect(remaining).toBeGreaterThan(0);
      // 0.0167 minutes * 60 * 1000 = ~1002ms (rounding)
      expect(remaining).toBeLessThanOrEqual(1005);
    });
  });
});
