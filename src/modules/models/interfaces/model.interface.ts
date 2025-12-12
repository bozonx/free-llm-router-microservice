/**
 * Model type classification
 */
export type ModelType = 'fast' | 'reasoning';

/**
 * Model speed classification
 */
export type ModelSpeed = 'fast' | 'medium' | 'slow';

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
   * Model speed category
   */
  speed: ModelSpeed;

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
