import { Logger } from '../../common/logger.js';
import { ModelsService } from '../models/models.service.js';
import type { ModelState, ModelStats, CircuitBreakerConfig, RequestRecord } from './interfaces/state.interface.js';
import { DEFAULT_CIRCUIT_BREAKER_CONFIG } from './interfaces/state.interface.js';
import type { StateStorage } from './interfaces/state-storage.interface.js';

/**
 * Service for managing state of all models.
 * Tracks Circuit Breaker state, active requests, and statistics.
 * Uses a StateStorage implementation (memory, Redis, Upstash) for persistence.
 */
export class StateService {
  private readonly logger = new Logger(StateService.name);


  public constructor(
    private readonly deps: {
      modelsService: ModelsService;
      storage: StateStorage;
      config?: Partial<CircuitBreakerConfig>;
    },
  ) {}

  private get modelsService(): ModelsService {
    return this.deps.modelsService;
  }

  private get storage(): StateStorage {
    return this.deps.storage;
  }

  private get config(): CircuitBreakerConfig {
    return {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      ...(this.deps.config ?? {}),
    };
  }

  /**
   * Initialize states for all models on module start
   */
  public async init(): Promise<void> {
    await this.storage.init();
    const models = this.modelsService.getModels();

    for (const model of models) {
      const existing = await this.storage.getState(model.name);
      if (!existing) {
        await this.storage.setState(model.name, this.createInitialState(model.name));
      }
    }

    this.logger.log(`Initialized state for ${models.length} models`);
  }

  /**
   * Clean up on module destroy
   */
  public async close(): Promise<void> {
    await this.storage.close();
  }

  /**
   * Get state for a specific model.
   * Creates initial state if model doesn't exist.
   */
  public async getState(modelName: string): Promise<ModelState> {
    let state = await this.storage.getState(modelName);

    if (!state) {
      state = this.createInitialState(modelName);
      await this.storage.setState(modelName, state);
    }

    const now = Date.now();
    const windowStart = now - this.config.statsWindowSizeMins * 60 * 1000;
    state.stats.requests = await this.storage.getRequests(modelName, windowStart);

    return state;
  }

  /**
   * Get all model states
   */
  public async getAllStates(): Promise<ModelState[]> {
    const modelNames = await this.storage.getModelNames();
    const states = await Promise.all(modelNames.map(name => this.getState(name)));
    return states;
  }

  /**
   * Record a successful request
   */
  public async recordSuccess(modelName: string, latencyMs: number): Promise<void> {
    const now = Date.now();
    const record: RequestRecord = {
      timestamp: now,
      latencyMs,
      success: true,
    };

    // 1. Store the request record first
    await this.storage.recordRequest(modelName, record);

    // 2. Pull the most recent state (now contains the new record)
    const state = await this.getState(modelName);

    // 3. Update lifetime/consecutive counters
    state.stats.lifetimeTotalRequests++;
    state.consecutiveFailures = 0;
    state.consecutiveSuccesses++;

    // 4. Recalculate based on the refreshed list of requests
    this.recalculateStats(state);
    
    // 5. Persist the updated state object
    await this.storage.setState(modelName, state);
  }

  /**
   * Record a failed request
   */
  public async recordFailure(modelName: string, latencyMs: number = 0): Promise<void> {
    const now = Date.now();
    const record: RequestRecord = {
      timestamp: now,
      latencyMs,
      success: false,
    };

    // 1. Store the request record first
    await this.storage.recordRequest(modelName, record);

    // 2. Pull the most recent state
    const state = await this.getState(modelName);

    // 3. Update lifetime/consecutive counters
    state.stats.lifetimeTotalRequests++;
    state.consecutiveFailures++;
    state.consecutiveSuccesses = 0;

    // 4. Recalculate
    this.recalculateStats(state);

    // 5. Persist
    await this.storage.setState(modelName, state);
  }

  /**
   * Mark model as permanently unavailable (e.g., 404 response)
   */
  public async markPermanentlyUnavailable(modelName: string, reason: string = '404 Not Found'): Promise<void> {
    const state = await this.getState(modelName);
    state.circuitState = 'PERMANENTLY_UNAVAILABLE';
    state.unavailableReason = reason;
    await this.storage.setState(modelName, state);
    this.logger.warn(`Model ${modelName} marked as permanently unavailable: ${reason}`);
  }

  /**
   * Set circuit state for a model
   */
  public async setCircuitState(modelName: string, circuitState: ModelState['circuitState']): Promise<void> {
    const state = await this.getState(modelName);
    const previousState = state.circuitState;
    state.circuitState = circuitState;

    if (circuitState === 'OPEN') {
      state.openedAt = Date.now();
    } else if (circuitState === 'CLOSED') {
      state.openedAt = undefined;
      state.consecutiveFailures = 0;
      state.consecutiveSuccesses = 0;
    }

    if (previousState !== circuitState) {
      await this.storage.setState(modelName, state);
      this.logger.log(`Model ${modelName} circuit state: ${previousState} -> ${circuitState}`);
    }
  }

  /**
   * Check if model is available for requests
   */
  public async isAvailable(modelName: string): Promise<boolean> {
    const state = await this.getState(modelName);
    return state.circuitState === 'CLOSED' || state.circuitState === 'HALF_OPEN';
  }

  /**
   * Reset model state (for admin API)
   */
  public async resetState(modelName: string): Promise<void> {
    await this.storage.resetState(modelName);
    this.logger.log(`Model ${modelName} state reset`);
  }

  public async recordFallbackUsage(): Promise<void> {
    await this.storage.recordFallbackUsage();
  }

  public async getFallbacksUsed(): Promise<number> {
    return await this.storage.getFallbacksUsed();
  }

  /**
   * Get Circuit Breaker configuration
   */
  public getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  /**
   * Create initial state for a model
   */
  private createInitialState(modelName: string): ModelState {
    return {
      name: modelName,
      circuitState: 'CLOSED',
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      stats: this.createInitialStats(),
    };
  }

  /**
   * Create initial statistics object
   */
  private createInitialStats(): ModelStats {
    return {
      totalRequests: 0,
      lifetimeTotalRequests: 0,
      successCount: 0,
      errorCount: 0,
      avgLatency: 0,
      p95Latency: 0,
      successRate: 1.0,
      requests: [],
    };
  }

  /**
   * Recalculate statistics from request records
   */
  private recalculateStats(state: ModelState): void {
    const records = state.stats.requests;

    if (records.length === 0) {
      const lifetimeTotal = state.stats.lifetimeTotalRequests;
      state.stats = this.createInitialStats();
      state.stats.lifetimeTotalRequests = lifetimeTotal;
      return;
    }

    // Calculate totals
    state.stats.totalRequests = records.length;
    state.stats.successCount = records.filter(r => r.success).length;
    state.stats.errorCount = records.filter(r => !r.success).length;

    // Success rate
    state.stats.successRate = state.stats.successCount / state.stats.totalRequests;

    // Average latency (only from successful requests)
    const successfulLatencies = records.filter(r => r.success).map(r => r.latencyMs);

    if (successfulLatencies.length > 0) {
      state.stats.avgLatency =
        successfulLatencies.reduce((a, b) => a + b, 0) / successfulLatencies.length;

      // P95 latency
      const sorted = [...successfulLatencies].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      state.stats.p95Latency = sorted[Math.min(p95Index, sorted.length - 1)];
    } else {
      state.stats.avgLatency = 0;
      state.stats.p95Latency = 0;
    }
  }

  /**
   * Clean up stale data from all models.
   * Periodically called to ensure stats are fresh even when no requests occur.
   */
  public async cleanupStaleData(): Promise<void> {
    const modelNames = await this.storage.getModelNames();
    for (const name of modelNames) {
      const state = await this.getState(name);
      const beforeCount = state.stats.requests.length;
      
      this.recalculateStats(state);
      
      if (beforeCount !== state.stats.requests.length) {
        await this.storage.setState(name, state);
      }
    }
  }
}
