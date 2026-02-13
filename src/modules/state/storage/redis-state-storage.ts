import { Redis } from 'ioredis';
import type { ModelState, RequestRecord } from '../interfaces/state.interface.js';
import type { StateStorage } from '../interfaces/state-storage.interface.js';
import { Logger } from '../../../common/logger.js';

/**
 * Redis implementation of StateStorage using ioredis (TCP).
 * Suitable for Node.js environments.
 */
export class RedisStateStorage implements StateStorage {
  private readonly logger = new Logger(RedisStateStorage.name);
  private readonly redis: Redis;
  private readonly KEY_PREFIX = 'router:';
  private readonly FALLBACK_KEY = `${this.KEY_PREFIX}fallbacks_used`;
  private readonly STATE_KEY_PREFIX = `${this.KEY_PREFIX}state:`;
  private readonly REQUESTS_KEY_PREFIX = `${this.KEY_PREFIX}requests:`;

  constructor(url: string) {
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    });

    this.redis.on('error', (err: Error) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });
  }

  public async init(): Promise<void> {
    // Connection is handled automatically by ioredis
  }

  public async close(): Promise<void> {
    await this.redis.quit();
  }

  public async getFallbacksUsed(): Promise<number> {
    const val = await this.redis.get(this.FALLBACK_KEY);
    return val ? parseInt(val, 10) : 0;
  }

  public async recordFallbackUsage(): Promise<void> {
    await this.redis.incr(this.FALLBACK_KEY);
  }

  public async getState(modelName: string): Promise<ModelState | null> {
    const data = await this.redis.get(this.getStateKey(modelName));
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch (e) {
      this.logger.error(`Failed to parse state for ${modelName}: ${e}`);
      return null;
    }
  }

  public async setState(modelName: string, state: ModelState): Promise<void> {
    // We store the full state as JSON for simplicity, 
    // but exclude request records as they are stored in a separate Sorted Set
    const stateToStore = {
      ...state,
      stats: {
        ...state.stats,
        requests: [], // Store separately
      },
    };
    await this.redis.set(this.getStateKey(modelName), JSON.stringify(stateToStore));
  }

  public async recordRequest(modelName: string, record: RequestRecord): Promise<void> {
    const key = this.getRequestsKey(modelName);
    // Use Sorted Set where score is timestamp and value is JSON representation
    await this.redis.zadd(key, record.timestamp, JSON.stringify(record));
  }

  public async getRequests(modelName: string, windowStart: number): Promise<RequestRecord[]> {
    const key = this.getRequestsKey(modelName);
    // Remove stale records first
    await this.redis.zremrangebyscore(key, '-inf', windowStart - 1);
    
    const records = await this.redis.zrangebyscore(key, windowStart, '+inf');
    return records.map((r: string) => JSON.parse(r));
  }

  public async resetState(modelName: string): Promise<void> {
    await this.redis.del(this.getStateKey(modelName), this.getRequestsKey(modelName));
  }

  public async getModelNames(): Promise<string[]> {
    const keys = await this.redis.keys(`${this.STATE_KEY_PREFIX}*`);
    return keys.map((k: string) => k.replace(this.STATE_KEY_PREFIX, ''));
  }

  private getStateKey(modelName: string): string {
    return `${this.STATE_KEY_PREFIX}${modelName}`;
  }

  private getRequestsKey(modelName: string): string {
    return `${this.REQUESTS_KEY_PREFIX}${modelName}`;
  }
  private getRateLimitKey(key: string): string {
    return `${this.KEY_PREFIX}ratelimit:${key}`;
  }

  public async checkRateLimit(key: string, limit: number, windowSecs: number): Promise<boolean> {
    const redisKey = this.getRateLimitKey(key);
    
    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.expire(redisKey, windowSecs);
    }
    
    return count <= limit;
  }
}
