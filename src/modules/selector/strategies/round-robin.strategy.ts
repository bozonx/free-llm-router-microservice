import { Injectable } from '@nestjs/common';
import type { ModelDefinition } from '../../models/interfaces/model.interface.js';
import type { SelectionStrategy, SelectionCriteria } from '../interfaces/selector.interface.js';

/**
 * Round-robin selection strategy
 * Cycles through available models sequentially
 */
@Injectable()
export class RoundRobinStrategy implements SelectionStrategy {
  private currentIndex = 0;

  /**
   * Select next model using round-robin algorithm
   */
  public select(models: ModelDefinition[], criteria: SelectionCriteria): ModelDefinition | null {
    if (models.length === 0) {
      return null;
    }

    // Filter out excluded models
    let availableModels = models;
    if (criteria.excludeModels && criteria.excludeModels.length > 0) {
      availableModels = models.filter(model => !criteria.excludeModels?.includes(model.name));
    }

    if (availableModels.length === 0) {
      return null;
    }

    // Get next model in round-robin fashion
    const selectedModel = availableModels[this.currentIndex % availableModels.length];
    if (!selectedModel) {
      return null;
    }

    // Increment index for next call
    this.currentIndex = (this.currentIndex + 1) % availableModels.length;

    return selectedModel;
  }

  /**
   * Reset the round-robin counter
   */
  public reset(): void {
    this.currentIndex = 0;
  }
}
