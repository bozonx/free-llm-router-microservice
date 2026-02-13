import { Redis } from '@upstash/redis';
import type { ModelState, RequestRecord } from '../interfaces/state.interface.js';
import type { StateStorage } from '../interfaces/state-storage.interface.js';
import { Logger } from '../../../common/logger.js';

/**
 * Upstash Redis implementation of StateStorage using @upstash/redis (HTTP).
 * Suitable for Cloudflare Workers and serverless environments.
 */
export class UpstashRedisStateStorage implements StateStorage {
  private readonly logger = new Logger(UpstashRedisStateStorage.name);
  private readonly redis: Redis;
  private readonly KEY_PREFIX = 'router:';
  private readonly FALLBACK_KEY = `${this.KEY_PREFIX}fallbacks_used`;
  private readonly STATE_KEY_PREFIX = `${this.KEY_PREFIX}state:`;
  private readonly REQUESTS_KEY_PREFIX = `${this.KEY_PREFIX}requests:`;

  constructor(url: string, token: string) {
    this.redis = new Redis({
      url,
      token,
    });
  }

  public async init(): Promise<void> {
    // Connectionless (HTTP)
  }

  public async close(): Promise<void> {
    // Nothing to close
  }

  public async getFallbacksUsed(): Promise<number> {
    const val = await this.redis.get<number>(this.FALLBACK_KEY);
    return val || 0;
  }

  public async recordFallbackUsage(): Promise<void> {
    await this.redis.incr(this.FALLBACK_KEY);
  }

  public async getState(modelName: string): Promise<ModelState | null> {
    return await this.redis.get<ModelState>(this.getStateKey(modelName));
  }

  public async setState(modelName: string, state: ModelState): Promise<void> {
    const stateToStore = {
      ...state,
      stats: {
        ...state.stats,
        requests: [], // Store separately
      },
    };
    await this.redis.set(this.getStateKey(modelName), stateToStore);
  }

  public async recordRequest(modelName: string, record: RequestRecord): Promise<void> {
    const key = this.getRequestsKey(modelName);
    await this.redis.zadd(key, { score: record.timestamp, member: JSON.stringify(record) });
  }

  public async getRequests(modelName: string, windowStart: number): Promise<RequestRecord[]> {
    const key = this.getRequestsKey(modelName);
    // Remove stale records
    await this.redis.zremrangebyscore(key, 0, windowStart - 1);
    
    // Upstash returns members as strings if they were added as strings
    const records = await this.redis.zrange<string[]>(key, windowStart, '+inf', { byScore: true });
    return records.map(r => typeof r === 'string' ? JSON.parse(r) : r);
  }

  public async resetState(modelName: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.del(this.getStateKey(modelName));
    pipeline.del(this.getRequestsKey(modelName));
    await pipeline.exec();
  }

  public async getModelNames(): Promise<string[]> {
    // Upstash keys() works similarly to Redis keys command
    const keys = await this.redis.keys(`${this.STATE_KEY_PREFIX}*`);
    return keys.map(k => k.replace(this.STATE_KEY_PREFIX, ''));
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
