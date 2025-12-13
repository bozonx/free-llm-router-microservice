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
}
