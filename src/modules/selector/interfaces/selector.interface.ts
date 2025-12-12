import type { ModelDefinition } from '../../models/interfaces/model.interface.js';

/**
 * Selection criteria for model choosing
 */
export interface SelectionCriteria {
    /**
     * Specific model name (if provided, use this model)
     */
    model?: string;

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
}

/**
 * Selection strategy interface
 */
export interface SelectionStrategy {
    /**
     * Select a model from the list based on criteria
     */
    select(models: ModelDefinition[], criteria: SelectionCriteria): ModelDefinition | null;
}
