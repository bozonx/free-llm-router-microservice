/**
 * Provider configuration
 */
export interface ProviderConfig {
  /**
   * Provider enabled status
   */
  enabled: boolean;

  /**
   * Provider API key
   */
  apiKey: string;

  /**
   * Provider base URL
   */
  baseUrl: string;
}

/**
 * Fallback configuration
 */
export interface FallbackConfig {
  /**
   * Fallback enabled status
   */
  enabled: boolean;

  /**
   * Provider to use for fallback
   */
  provider: string;

  /**
   * Model to use for fallback
   */
  model: string;
}

/**
 * Routing configuration
 */
export interface RoutingConfig {
  /**
   * Selection algorithm (only 'round-robin' for MVP)
   */
  algorithm: 'round-robin';

  /**
   * Maximum retries on free models
   */
  maxRetries: number;

  /**
   * Maximum retries on 429 rate limit for one model
   */
  rateLimitRetries: number;

  /**
   * Retry delay in milliseconds
   */
  retryDelay: number;

  /**
   * Request timeout in milliseconds
   */
  timeout: number;

  /**
   * Fallback configuration
   */
  fallback: FallbackConfig;
}

/**
 * Circuit Breaker configuration (optional, has defaults)
 */
export interface CircuitBreakerConfig {
  /**
   * Number of consecutive failures to open circuit (default: 3)
   */
  failureThreshold?: number;

  /**
   * Cooldown period in milliseconds before trying HALF_OPEN (default: 60000)
   */
  cooldownPeriod?: number;

  /**
   * Number of consecutive successes to close circuit from HALF_OPEN (default: 2)
   */
  successThreshold?: number;

  /**
   * Statistics sliding window size in milliseconds (default: 300000 = 5 min)
   */
  statsWindowSize?: number;
}

/**
 * Model override configuration (for priority/weight adjustments)
 */
export interface ModelOverrideConfig {
  /**
   * Override priority (lower = higher priority)
   */
  priority?: number;

  /**
   * Override weight (1-100)
   */
  weight?: number;
}

/**
 * Router configuration
 */
export interface RouterConfig {
  /**
   * Path to models file
   */
  modelsFile: string;

  /**
   * Provider configurations
   */
  providers: Record<string, ProviderConfig>;

  /**
   * Routing configuration
   */
  routing: RoutingConfig;

  /**
   * Circuit Breaker configuration (optional)
   */
  circuitBreaker?: CircuitBreakerConfig;

  /**
   * Model priority/weight overrides (optional)
   */
  modelOverrides?: Record<string, ModelOverrideConfig>;
}
