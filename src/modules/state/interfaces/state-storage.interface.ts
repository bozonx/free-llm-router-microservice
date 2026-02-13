import type { ModelState, RequestRecord } from './state.interface.js';

/**
 * Interface for model state storage.
 * Abstracts away the actual storage mechanism (memory, redis, etc.)
 */
export interface StateStorage {
  /**
   * Initialize the storage
   */
  init(): Promise<void>;

  /**
   * Close the storage connection
   */
  close(): Promise<void>;

  /**
   * Get total number of times fallback was used
   */
  getFallbacksUsed(): Promise<number>;

  /**
   * Record a single fallback usage
   */
  recordFallbackUsage(): Promise<void>;

  /**
   * Get state for a specific model
   */
  getState(modelName: string): Promise<ModelState | null>;

  /**
   * Set state for a specific model
   */
  setState(modelName: string, state: ModelState): Promise<void>;

  /**
   * Record a successful or failed request
   */
  recordRequest(modelName: string, record: RequestRecord): Promise<void>;

  /**
   * Get request records for a model within a time window
   */
  getRequests(modelName: string, windowStart: number): Promise<RequestRecord[]>;

  /**
   * Reset state for a specific model
   */
  resetState(modelName: string): Promise<void>;

  /**
   * Get all model names with stored states
   */
  getModelNames(): Promise<string[]>;

  /**
   * Check if rate limit is exceeded
   * @param key Unique key for the limit (e.g. model:name)
   * @param limit Maximum number of requests
   * @param windowSecs Time window in seconds
   * @returns true if allowed, false if limited
   */
  checkRateLimit(key: string, limit: number, windowSecs: number): Promise<boolean>;
}
