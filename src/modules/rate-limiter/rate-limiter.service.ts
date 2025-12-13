import { Injectable, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { ROUTER_CONFIG } from '../../config/router-config.provider.js';
import type { RouterConfig } from '../../config/router-config.interface.js';
import type {
  RateLimitingConfig,
  RateLimitInfo,
  RateLimitStatus,
  TokenBucket,
} from './interfaces/rate-limiter.interface.js';
import { DEFAULT_RATE_LIMITING_CONFIG } from './interfaces/rate-limiter.interface.js';
import {
  STALE_BUCKET_THRESHOLD_MS,
  RATE_LIMITER_CLEANUP_INTERVAL_MS,
} from '../../common/constants/app.constants.js';

/**
 * Rate Limiter Service implementing Token Bucket algorithm.
 * Provides global, per-client, and per-model rate limiting.
 */
@Injectable()
export class RateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly config: RateLimitingConfig;

  // Token buckets for different limiter types
  private readonly globalBucket: TokenBucket;
  private readonly clientBuckets: Map<string, TokenBucket> = new Map();
  private readonly modelBuckets: Map<string, TokenBucket> = new Map();

  // Cleanup interval for stale buckets
  private cleanupIntervalId?: ReturnType<typeof setInterval>;

  constructor(@Inject(ROUTER_CONFIG) routerConfig: RouterConfig) {
    this.config = {
      ...DEFAULT_RATE_LIMITING_CONFIG,
      ...routerConfig.rateLimiting,
    };

    // Initialize global bucket
    const globalRpm = this.config.global?.requestsPerMinute ?? 100;
    this.globalBucket = this.createBucket(globalRpm, globalRpm);

    if (this.config.enabled) {
      this.logger.log('Rate limiting enabled');
      this.logger.debug(`Global: ${globalRpm} req/min`);
      if (this.config.perClient?.enabled) {
        this.logger.debug(`Per-client: ${this.config.perClient.requestsPerMinute} req/min`);
      }
      if (this.config.perModel?.enabled) {
        this.logger.debug(`Per-model: ${this.config.perModel.requestsPerMinute} req/min`);
      }
    }

    // Schedule cleanup of stale client/model buckets (unref to not block exit)
    this.cleanupIntervalId = setInterval(
      () => this.cleanupStaleBuckets(),
      RATE_LIMITER_CLEANUP_INTERVAL_MS,
    );
    this.cleanupIntervalId.unref();
  }

  /**
   * Clean up on module destroy
   */
  public onModuleDestroy(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }
  }

  /**
   * Check if rate limiting is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check global rate limit
   * @returns true if allowed, false if rate limited
   */
  public checkGlobal(): boolean {
    if (!this.config.enabled) return true;
    return this.tryConsume(this.globalBucket);
  }

  /**
   * Check per-client rate limit
   * @param clientId Client identifier (from X-Client-ID header)
   * @returns true if allowed, false if rate limited
   */
  public checkClient(clientId: string): boolean {
    if (!this.config.enabled || !this.config.perClient?.enabled) return true;

    let bucket = this.clientBuckets.get(clientId);
    if (!bucket) {
      const rpm = this.config.perClient.requestsPerMinute;
      const burst = this.config.perClient.burstSize ?? 0;
      bucket = this.createBucket(rpm, rpm + burst);
      this.clientBuckets.set(clientId, bucket);
    }

    return this.tryConsume(bucket);
  }

  /**
   * Check per-model rate limit
   * @param modelName Model name
   * @returns true if allowed, false if rate limited
   */
  public checkModel(modelName: string): boolean {
    if (!this.config.enabled || !this.config.perModel?.enabled) return true;

    let bucket = this.modelBuckets.get(modelName);
    if (!bucket) {
      const rpm = this.config.perModel.requestsPerMinute;
      bucket = this.createBucket(rpm, rpm);
      this.modelBuckets.set(modelName, bucket);
    }

    return this.tryConsume(bucket);
  }

  /**
   * Check all rate limits for a request
   * @returns Object with which limit was hit (if any)
   */
  public checkAll(
    clientId?: string,
    modelName?: string,
  ): {
    allowed: boolean;
    limitType?: 'global' | 'client' | 'model';
  } {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    if (!this.checkGlobal()) {
      return { allowed: false, limitType: 'global' };
    }

    if (clientId && !this.checkClient(clientId)) {
      return { allowed: false, limitType: 'client' };
    }

    if (modelName && !this.checkModel(modelName)) {
      return { allowed: false, limitType: 'model' };
    }

    return { allowed: true };
  }

  /**
   * Get rate limit info for response headers
   * Prioritizes client bucket if available, otherwise global
   */
  public getRateLimitInfo(clientId?: string): RateLimitInfo {
    let bucket: TokenBucket;
    let limit: number;

    if (clientId && this.config.perClient?.enabled) {
      bucket = this.clientBuckets.get(clientId) ?? this.globalBucket;
      limit = this.config.perClient.requestsPerMinute;
    } else {
      bucket = this.globalBucket;
      limit = this.config.global?.requestsPerMinute ?? 100;
    }

    // Refill before getting info
    this.refillBucket(bucket);

    const remaining = Math.floor(bucket.tokens);
    const resetTime = this.calculateResetTime(bucket);
    const retryAfter =
      remaining === 0 ? Math.ceil((resetTime * 1000 - Date.now()) / 1000) : undefined;

    return {
      limit,
      remaining: Math.max(0, remaining),
      reset: resetTime,
      retryAfter: retryAfter && retryAfter > 0 ? retryAfter : undefined,
    };
  }

  /**
   * Get current configuration
   */
  public getConfig(): RateLimitingConfig {
    return { ...this.config };
  }

  /**
   * Get current rate limiting status
   */
  public getStatus(): RateLimitStatus {
    return {
      enabled: this.config.enabled,
      config: this.config,
      activeBuckets: {
        global: true, // Always initialized
        clients: this.clientBuckets.size,
        models: this.modelBuckets.size,
      },
    };
  }

  /**
   * Create a new token bucket
   */
  private createBucket(requestsPerMinute: number, maxTokens: number): TokenBucket {
    // Convert requests per minute to refill rate (tokens per millisecond)
    const refillRate = requestsPerMinute / 60000;

    return {
      tokens: maxTokens,
      lastRefill: Date.now(),
      maxTokens,
      refillRate,
    };
  }

  /**
   * Try to consume a token from the bucket
   * @returns true if token consumed, false if bucket empty
   */
  private tryConsume(bucket: TokenBucket): boolean {
    this.refillBucket(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = elapsed * bucket.refillRate;

    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  /**
   * Calculate when the bucket will have at least 1 token
   */
  private calculateResetTime(bucket: TokenBucket): number {
    if (bucket.tokens >= 1) {
      // Already have tokens, reset is end of current minute
      return Math.ceil(Date.now() / 60000) * 60;
    }

    // Calculate when we'll have 1 token
    const tokensNeeded = 1 - bucket.tokens;
    const msUntilToken = tokensNeeded / bucket.refillRate;
    return Math.ceil((Date.now() + msUntilToken) / 1000);
  }

  /**
   * Clean up buckets that haven't been used in a while
   */
  private cleanupStaleBuckets(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [clientId, bucket] of this.clientBuckets.entries()) {
      if (now - bucket.lastRefill > STALE_BUCKET_THRESHOLD_MS) {
        this.clientBuckets.delete(clientId);
        cleaned++;
      }
    }

    for (const [modelName, bucket] of this.modelBuckets.entries()) {
      if (now - bucket.lastRefill > STALE_BUCKET_THRESHOLD_MS) {
        this.modelBuckets.delete(modelName);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} stale rate limit buckets`);
    }
  }
}
