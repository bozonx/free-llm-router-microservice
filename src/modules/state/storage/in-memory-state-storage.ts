import type { ModelState, RequestRecord } from '../interfaces/state.interface.js';
import type { StateStorage } from '../interfaces/state-storage.interface.js';

/**
 * In-memory implementation of StateStorage.
 * Mimics original StateService behavior.
 */
export class InMemoryStateStorage implements StateStorage {
  private states: Map<string, ModelState> = new Map();
  private fallbacksUsed = 0;

  public async init(): Promise<void> {
    // Nothing to initialize
  }

  public async close(): Promise<void> {
    // Nothing to close
  }

  public async getFallbacksUsed(): Promise<number> {
    return this.fallbacksUsed;
  }

  public async recordFallbackUsage(): Promise<void> {
    this.fallbacksUsed++;
  }

  public async getState(modelName: string): Promise<ModelState | null> {
    return this.states.get(modelName) || null;
  }

  public async setState(modelName: string, state: ModelState): Promise<void> {
    this.states.set(modelName, state);
  }

  public async recordRequest(modelName: string, record: RequestRecord): Promise<void> {
    const state = await this.getState(modelName);
    if (state) {
      state.stats.requests.push(record);
      await this.setState(modelName, state);
    }
  }

  public async getRequests(modelName: string, windowStart: number): Promise<RequestRecord[]> {
    const state = await this.getState(modelName);
    if (!state) return [];
    return state.stats.requests.filter(r => r.timestamp >= windowStart);
  }

  public async resetState(modelName: string): Promise<void> {
    this.states.delete(modelName);
  }

  public async getModelNames(): Promise<string[]> {
    return Array.from(this.states.keys());
  }

  private rateLimits: Map<string, { count: number; resetAt: number }> = new Map();

  public async checkRateLimit(key: string, limit: number, windowSecs: number): Promise<boolean> {
    const now = Date.now();
    const bucket = this.rateLimits.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.rateLimits.set(key, { count: 1, resetAt: now + windowSecs * 1000 });
      return true;
    }

    if (bucket.count < limit) {
      bucket.count++;
      return true;
    }

    return false;
  }
}
