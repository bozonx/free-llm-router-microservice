/**
 * Model type classification
 */
export type ModelType = 'fast' | 'reasoning';

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
   * Weight for weighted random selection (1-100)
   * Higher weight = more likely to be selected
   * Default: 1
   */
  weight?: number;

  /**
   * Vision support (multimodal - text + images)
   * If true, model can process image_url content parts
   * @deprecated Use supportsImage instead
   * Default: false
   */
  supportsVision?: boolean;

  /**
   * Image input support
   * If true, model can process image_url content parts
   * Default: false
   */
  supportsImage?: boolean;

  /**
   * Video input support
   * If true, model can process video content
   * Default: false
   */
  supportsVideo?: boolean;

  /**
   * Audio input support
   * If true, model can process audio content
   * Default: false
   */
  supportsAudio?: boolean;

  /**
   * File/document input support
   * If true, model can process file/document content
   * Default: false
   */
  supportsFile?: boolean;
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
