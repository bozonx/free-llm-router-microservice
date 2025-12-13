import type { ModelDefinition } from '../../models/interfaces/model.interface.js';
import type { ModelReference } from '../utils/model-parser.js';

/**
 * Selection criteria for model choosing
 */
export interface SelectionCriteria {
  /**
   * Specific model name (if provided, use this model)
   * @deprecated Use `models` array instead for multi-model support
   */
  model?: string;

  /**
   * Priority list of models to try (in order).
   * Each entry can specify an optional provider.
   * If empty, Smart Strategy is used.
   */
  models?: ModelReference[];

  /**
   * If true, fall back to Smart Strategy after exhausting `models`.
   * If false, go directly to paid fallback after `models` are exhausted.
   */
  allowAutoFallback?: boolean;

  /**
   * Tags filter (all must match)
   */
  tags?: string[];

  /**
   * Model type filter
   */
  type?: 'fast' | 'reasoning';

  /**
   * Minimum context size required
   */
  minContextSize?: number;

  /**
   * JSON response support required
   */
  jsonResponse?: boolean;

  /**
   * Models to exclude (already tried)
   */
  excludeModels?: string[];

  /**
   * Prefer models with lowest latency
   */
  preferFast?: boolean;

  /**
   * Minimum success rate for model selection (0-1)
   */
  minSuccessRate?: number;
}

/**
 * Model with effective priority and weight after applying overrides
 */
export interface ModelWithEffectivePriority extends ModelDefinition {
  effectivePriority: number;
  effectiveWeight: number;
}

/**
 * Selection strategy interface
 */
export interface SelectionStrategy {
  /**
   * Select a model from the list based on criteria
   */
  select(_models: ModelDefinition[], _criteria: SelectionCriteria): ModelDefinition | null;
}
