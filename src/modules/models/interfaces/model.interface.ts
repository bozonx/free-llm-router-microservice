/**
 * Model type classification
 */
export type ModelType = 'fast' | 'reasoning';

/**
 * Model speed tier classification
 */
export type ModelSpeedTier = 'fast' | 'medium' | 'slow';

/**
 * LLM model definition
 */
export interface ModelDefinition {
  /**
   * Unified model name
   */
  name: string;

  /**
   * Provider name (e.g., 'openrouter', 'deepseek')
   */
  provider: string;

  /**
   * Real model ID at the provider
   */
  model: string;

  /**
   * Model type
   */
  type: ModelType;

  /**
   * Context size in tokens
   */
  contextSize: number;

  /**
   * Maximum output tokens
   */
  maxOutputTokens: number;

  /**
   * Model speed tier category
   */
  speedTier: ModelSpeedTier;

  /**
   * Tags for filtering
   */
  tags: string[];

  /**
   * JSON response support
   */
  jsonResponse: boolean;

  /**
   * Model availability status
   */
  available: boolean;

  /**
   * Priority for model selection (higher = higher priority)
   * Range: >= 0, Default: 1
   */
  priority?: number;

  /**
   * Weight for weighted random selection (1-100)
   * Default: 1
   */
  weight?: number;

  /**
   * Maximum concurrent requests to this model
   * Default: unlimited (Infinity)
   */
  maxConcurrent?: number;
}

/**
 * Models configuration structure
 */
export interface ModelsConfig {
  /**
   * List of model definitions
   */
  models: ModelDefinition[];
}
