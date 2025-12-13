/**
 * Rate limiting configuration for the router
 */
export interface RateLimitingConfig {
  /**
   * Enable rate limiting globally
   */
  enabled: boolean;

  /**
   * Global rate limit (all clients combined)
   */
  global?: GlobalRateLimitConfig;

  /**
   * Per-client rate limit (by X-Client-ID header)
   */
  perClient?: PerClientRateLimitConfig;

  /**
   * Per-model rate limit (protection against skew)
   */
  perModel?: PerModelRateLimitConfig;
}

/**
 * Global rate limit configuration
 */
export interface GlobalRateLimitConfig {
  /**
   * Maximum requests per minute
   */
  requestsPerMinute: number;
}

/**
 * Per-client rate limit configuration
 */
export interface PerClientRateLimitConfig {
  /**
   * Enable per-client limiting
   */
  enabled: boolean;

  /**
   * Maximum requests per minute per client
   */
  requestsPerMinute: number;

  /**
   * Allowed burst size (extra tokens for spiky traffic)
   */
  burstSize?: number;
}

/**
 * Per-model rate limit configuration
 */
export interface PerModelRateLimitConfig {
  /**
   * Enable per-model limiting
   */
  enabled: boolean;

  /**
   * Maximum requests per minute per model
   */
  requestsPerMinute: number;
}

/**
 * Rate limit status info for headers
 */
export interface RateLimitInfo {
  /**
   * Maximum requests allowed
   */
  limit: number;

  /**
   * Remaining requests in current window
   */
  remaining: number;

  /**
   * Unix timestamp when the limit resets
   */
  reset: number;

  /**
   * Seconds until the limit resets (for Retry-After)
   */
  retryAfter?: number;
}

/**
 * Token Bucket state for a limiter
 */
export interface TokenBucket {
  /**
   * Current number of tokens available
   */
  tokens: number;

  /**
   * Timestamp of last refill
   */
  lastRefill: number;

  /**
   * Maximum tokens (bucket capacity)
   */
  maxTokens: number;

  /**
   * Tokens added per millisecond
   */
  refillRate: number;
}


/**
 * Rate limit status for admin API
 */
export interface RateLimitStatus {
  enabled: boolean;
  config: RateLimitingConfig;
  activeBuckets: {
    global: boolean;
    clients: number;
    models: number;
  };
}

/**
 * Default rate limiting configuration
 */
export const DEFAULT_RATE_LIMITING_CONFIG: RateLimitingConfig = {
  enabled: false,
  global: {
    requestsPerMinute: 100,
  },
  perClient: {
    enabled: true,
    requestsPerMinute: 20,
    burstSize: 5,
  },
  perModel: {
    enabled: true,
    requestsPerMinute: 30,
  },
};
