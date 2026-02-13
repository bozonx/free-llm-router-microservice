import type { RouterConfig } from '../../config/router-config.interface.js';
import type { RateLimitStatus } from './interfaces/rate-limiter.interface.js';
import { Logger } from '../../common/logger.js';
import type { StateStorage } from '../state/interfaces/state-storage.interface.js';

/**
 * Rate Limiter Service.
 * Provides global, per-client, and per-model rate limiting.
 * Uses StateStorage (Redis/Upstash) for persistence.
 */
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly modelRequestsPerMinute?: number;

  public constructor(
    private readonly deps: { 
      config: RouterConfig;
      storage: StateStorage;
    }
  ) {
    this.modelRequestsPerMinute = deps.config.modelRequestsPerMinute;

    if (this.modelRequestsPerMinute) {
      this.logger.log(`Rate limiting enabled for models: ${this.modelRequestsPerMinute} req/min`);
    }
  }

  private get storage(): StateStorage {
    return this.deps.storage;
  }

  /**
   * Cleanup (no-op as we don't use intervals anymore)
   */
  public close(): void {
  }

  /**
   * Check if rate limiting is enabled
   */
  public isEnabled(): boolean {
    return !!this.modelRequestsPerMinute;
  }

  /**
   * Check per-model rate limit
   * @param modelName Model name
   * @returns true if allowed, false if rate limited
   */
  public async checkModel(modelName: string): Promise<boolean> {
    if (!this.modelRequestsPerMinute) return true;

    // Use storage to check rate limit (works across Workers/Nodes via Redis)
    return await this.storage.checkRateLimit(
      `model:${modelName}`,
      this.modelRequestsPerMinute,
      60, // 1 minute window
    );
  }

  /**
   * Get current rate limiting status
   */
  public getStatus(): RateLimitStatus {
    return {
      enabled: !!this.modelRequestsPerMinute,
      requestsPerMinute: this.modelRequestsPerMinute,
      activeBuckets: {
        models: -1, // No longer tracking local buckets
      },
    };
  }
}
