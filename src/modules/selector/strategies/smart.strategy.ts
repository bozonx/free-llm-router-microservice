import { Injectable, Inject, Logger } from '@nestjs/common';
import { StateService } from '../../state/state.service.js';
import { CircuitBreakerService } from '../../state/circuit-breaker.service.js';
import { ROUTER_CONFIG } from '../../../config/router-config.provider.js';
import type { RouterConfig } from '../../../config/router-config.interface.js';
import type { ModelDefinition } from '../../models/interfaces/model.interface.js';
import type {
  SelectionStrategy,
  SelectionCriteria,
  ModelWithEffectivePriority,
} from '../interfaces/selector.interface.js';

/**
 * Smart selection strategy.
 * Replaces round-robin and considers:
 * - Circuit Breaker state
 * - Priorities (from models.yaml + overrides from router.yaml)
 * - Model weights
 * - Statistics (latency, success rate)
 * - Request filters (tags, type, min_context_size, prefer_fast, min_success_rate)
 * - Overload protection (maxConcurrent)
 */
@Injectable()
export class SmartStrategy implements SelectionStrategy {
  private readonly logger = new Logger(SmartStrategy.name);

  constructor(
    private readonly stateService: StateService,
    private readonly circuitBreaker: CircuitBreakerService,
    @Inject(ROUTER_CONFIG) private readonly config: RouterConfig,
  ) {}

  /**
   * Select best model based on criteria and current state
   */
  public select(models: ModelDefinition[], criteria: SelectionCriteria): ModelDefinition | null {
    if (models.length === 0) {
      return null;
    }

    // 1. Filter out excluded models
    let candidates = this.filterExcluded(models, criteria.excludeModels);

    // 2. Filter by Circuit Breaker (exclude OPEN and PERMANENTLY_UNAVAILABLE)
    candidates = this.circuitBreaker.filterAvailable(candidates);

    // 3. Filter by maxConcurrent capacity
    candidates = this.filterByCapacity(candidates);

    // 4. Filter by min_success_rate (if specified in request)
    if (criteria.minSuccessRate !== undefined) {
      candidates = this.filterBySuccessRate(candidates, criteria.minSuccessRate);
    }

    // 5. If nothing remains — return null (will trigger fallback)
    if (candidates.length === 0) {
      this.logger.debug('No candidates after filtering');
      return null;
    }

    // 6. If prefer_fast — select model with lowest latency
    if (criteria.preferFast) {
      return this.selectFastest(candidates);
    }

    // 7. Apply priority overrides (from models.yaml + router.yaml)
    const withPriorities = this.applyPriorityOverrides(candidates);

    // 8. Group by priority
    const priorityGroups = this.groupByPriority(withPriorities);

    // 9. Take the highest priority group (minimum priority value)
    const topPriorityGroup = priorityGroups[0];

    // 10. Within group — weighted random selection
    return this.weightedRandomSelect(topPriorityGroup);
  }

  /**
   * Filter out excluded models
   */
  private filterExcluded(models: ModelDefinition[], excludeModels?: string[]): ModelDefinition[] {
    if (!excludeModels || excludeModels.length === 0) {
      return models;
    }
    return models.filter(m => !excludeModels.includes(m.name));
  }

  /**
   * Filter models that have capacity for more requests
   */
  private filterByCapacity(models: ModelDefinition[]): ModelDefinition[] {
    return models.filter(m => {
      const state = this.stateService.getState(m.name);
      const maxConcurrent = m.maxConcurrent ?? Infinity;
      return state.activeRequests < maxConcurrent;
    });
  }

  /**
   * Filter models with success rate above threshold
   */
  private filterBySuccessRate(models: ModelDefinition[], minRate: number): ModelDefinition[] {
    return models.filter(m => {
      const state = this.stateService.getState(m.name);
      // If no statistics — assume success rate = 1.0 (give a chance)
      const successRate = state.stats.totalRequests > 0 ? state.stats.successRate : 1.0;
      return successRate >= minRate;
    });
  }

  /**
   * Select model with lowest average latency
   */
  private selectFastest(models: ModelDefinition[]): ModelDefinition {
    return models.reduce((fastest, current) => {
      const fastestLatency = this.stateService.getState(fastest.name).stats.avgLatency || Infinity;
      const currentLatency = this.stateService.getState(current.name).stats.avgLatency || Infinity;
      return currentLatency < fastestLatency ? current : fastest;
    });
  }

  /**
   * Apply priority/weight overrides from router.yaml
   */
  private applyPriorityOverrides(models: ModelDefinition[]): ModelWithEffectivePriority[] {
    return models.map(m => {
      const override = this.config.modelOverrides?.[m.name];
      return {
        ...m,
        effectivePriority: override?.priority ?? m.priority ?? 1,
        effectiveWeight: override?.weight ?? m.weight ?? 1,
      };
    });
  }

  /**
   * Group models by priority (sorted ascending)
   */
  private groupByPriority(models: ModelWithEffectivePriority[]): ModelWithEffectivePriority[][] {
    // Sort by priority (lower = higher priority)
    const sorted = [...models].sort((a, b) => a.effectivePriority - b.effectivePriority);

    // Group
    const groups: ModelWithEffectivePriority[][] = [];
    let currentPriority = -1;

    for (const model of sorted) {
      if (model.effectivePriority !== currentPriority) {
        groups.push([]);
        currentPriority = model.effectivePriority;
      }
      groups[groups.length - 1].push(model);
    }

    return groups;
  }

  /**
   * Weighted random selection within priority group
   */
  private weightedRandomSelect(models: ModelWithEffectivePriority[]): ModelDefinition | null {
    if (models.length === 0) return null;
    if (models.length === 1) return models[0];

    // Calculate effective weight based on statistics
    const weighted = models.map(m => ({
      model: m,
      weight: this.calculateEffectiveWeight(m),
    }));

    const totalWeight = weighted.reduce((sum, i) => sum + i.weight, 0);
    if (totalWeight === 0) return models[0]; // fallback to first

    let random = Math.random() * totalWeight;
    for (const item of weighted) {
      random -= item.weight;
      if (random <= 0) return item.model;
    }

    return models[models.length - 1];
  }

  /**
   * Calculate effective weight considering static weight and statistics
   */
  private calculateEffectiveWeight(model: ModelWithEffectivePriority): number {
    const state = this.stateService.getState(model.name);
    const staticWeight = model.effectiveWeight;

    // If no statistics — use only static weight
    if (state.stats.totalRequests === 0) {
      return staticWeight;
    }

    const successRate = state.stats.successRate;
    // Latency normalization: lower latency = higher multiplier
    const latencyFactor = 1000 / Math.max(state.stats.avgLatency, 100);

    return staticWeight * successRate * latencyFactor;
  }
}
