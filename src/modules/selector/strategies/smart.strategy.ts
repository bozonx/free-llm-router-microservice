import { Logger } from '../../../common/logger.js';
import { StateService } from '../../state/state.service.js';
import { CircuitBreakerService } from '../../state/circuit-breaker.service.js';
import type { RouterConfig } from '../../../config/router-config.interface.js';
import type { ModelDefinition } from '../../models/interfaces/model.interface.js';
import type { SelectionStrategy, SelectionCriteria } from '../interfaces/selector.interface.js';
import {
  MIN_LATENCY_MS_FOR_CALCULATION,
  DEFAULT_MODEL_WEIGHT,
  DEFAULT_SUCCESS_RATE,
  LATENCY_NORMALIZATION_FACTOR,
} from './constants.js';

/**
 * Smart selection strategy.
 */
export class SmartStrategy implements SelectionStrategy {
  private readonly logger = new Logger(SmartStrategy.name);

  public constructor(
    private readonly deps: {
      stateService: StateService;
      circuitBreaker: CircuitBreakerService;
      config: RouterConfig;
    },
  ) {}

  private get stateService(): StateService {
    return this.deps.stateService;
  }

  private get circuitBreaker(): CircuitBreakerService {
    return this.deps.circuitBreaker;
  }

  private get config(): RouterConfig {
    return this.deps.config;
  }

  public async select(models: ModelDefinition[], criteria: SelectionCriteria): Promise<ModelDefinition | null> {
    if (models.length === 0) {
      return null;
    }

    const candidates = await this.applyFilters(models, criteria);

    if (candidates.length === 0) {
      this.logger.debug('No candidates after filtering');
      return null;
    }

    this.logger.debug(
      `SmartStrategy: ${candidates.length} candidates available: ${candidates.map(c => c.name).join(', ')}`,
    );

    let selected: ModelDefinition | null;

    const mode = criteria.selectionMode || 'weighted_random';

    if (criteria.preferFast) {
      selected = await this.selectFastest(candidates);
      this.logger.debug(`Selected fastest model: ${selected?.name ?? 'none'}`);
    } else if (mode === 'best') {
      selected = await this.selectBest(candidates);
      this.logger.debug(`Selected best model: ${selected?.name ?? 'none'}`);
    } else if (mode === 'top_n_random') {
      selected = await this.selectTopNRandom(candidates, 3);
      this.logger.debug(`Selected from top 3: ${selected?.name ?? 'none'}`);
    } else {
      selected = await this.weightedRandomSelect(candidates);
      this.logger.debug(`Selected by weight: ${selected?.name ?? 'none'}`);
    }

    return selected;
  }

  private async applyFilters(models: ModelDefinition[], criteria: SelectionCriteria): Promise<ModelDefinition[]> {
    let candidates = this.filterExcluded(models, criteria.excludeModels);
    candidates = await this.circuitBreaker.filterAvailable(candidates);

    if (criteria.minSuccessRate !== undefined) {
      candidates = await this.filterBySuccessRate(candidates, criteria.minSuccessRate);
    }

    return candidates;
  }

  private filterExcluded(models: ModelDefinition[], excludeModels?: string[]): ModelDefinition[] {
    if (!excludeModels || excludeModels.length === 0) {
      return models;
    }

    return models.filter(model => !this.isModelExcluded(model, excludeModels));
  }

  private isModelExcluded(model: ModelDefinition, excludeModels: string[]): boolean {
    return (
      excludeModels.includes(model.name) ||
      excludeModels.includes(`${model.provider}/${model.name}`)
    );
  }

  private async filterBySuccessRate(models: ModelDefinition[], minRate: number): Promise<ModelDefinition[]> {
    const results = await Promise.all(models.map(m => this.meetsSuccessRateThreshold(m, minRate)));
    return models.filter((_, index) => results[index]);
  }

  private async meetsSuccessRateThreshold(model: ModelDefinition, minRate: number): Promise<boolean> {
    const state = await this.stateService.getState(model.name);
    const successRate =
      state.stats.totalRequests > 0 ? state.stats.successRate : DEFAULT_SUCCESS_RATE;
    return successRate >= minRate;
  }

  private async selectFastest(models: ModelDefinition[]): Promise<ModelDefinition> {
    const latencies = await Promise.all(models.map(m => this.getModelLatency(m)));
    let fastestIndex = 0;
    for (let i = 1; i < latencies.length; i++) {
        if (latencies[i] < latencies[fastestIndex]) {
            fastestIndex = i;
        }
    }
    return models[fastestIndex];
  }

  private async getModelLatency(model: ModelDefinition): Promise<number> {
    const state = await this.stateService.getState(model.name);
    return state.stats.avgLatency || Infinity;
  }

  private async weightedRandomSelect(models: ModelDefinition[]): Promise<ModelDefinition | null> {
    if (models.length === 0) {
      return null;
    }
    if (models.length === 1) {
      return models[0];
    }

    const weightedModels = await this.calculateWeights(models);
    return this.selectRandomWeighted(weightedModels, models);
  }

  private async calculateWeights(
    models: ModelDefinition[],
  ): Promise<Array<{ model: ModelDefinition; weight: number }>> {
    return await Promise.all(models.map(async model => ({
      model,
      weight: await this.calculateEffectiveWeight(model),
    })));
  }

  private selectRandomWeighted(
    weightedModels: Array<{ model: ModelDefinition; weight: number }>,
    fallbackModels: ModelDefinition[],
  ): ModelDefinition {
    const totalWeight = weightedModels.reduce((sum, item) => sum + item.weight, 0);

    if (totalWeight === 0) {
      return fallbackModels[0];
    }

    let random = Math.random() * totalWeight;
    for (const item of weightedModels) {
      random -= item.weight;
      if (random <= 0) {
        return item.model;
      }
    }

    return fallbackModels[fallbackModels.length - 1];
  }

  private async calculateEffectiveWeight(model: ModelDefinition): number | Promise<number> {
    const state = await this.stateService.getState(model.name);
    const staticWeight = model.weight ?? DEFAULT_MODEL_WEIGHT;

    if (state.stats.totalRequests === 0) {
      return staticWeight;
    }

    const successRate = state.stats.successRate;
    const latencyFactor = this.calculateLatencyFactor(state.stats.avgLatency);

    return staticWeight * successRate * latencyFactor;
  }

  private calculateLatencyFactor(avgLatency: number): number {
    const normalizedLatency = Math.max(avgLatency, MIN_LATENCY_MS_FOR_CALCULATION);
    return LATENCY_NORMALIZATION_FACTOR / normalizedLatency;
  }

  private async selectBest(models: ModelDefinition[]): Promise<ModelDefinition> {
    if (models.length === 0) throw new Error('No models to select from');
    if (models.length === 1) return models[0];

    const weightedModels = await this.calculateWeights(models);
    weightedModels.sort((a, b) => b.weight - a.weight);

    return weightedModels[0].model;
  }

  private async selectTopNRandom(models: ModelDefinition[], n: number): Promise<ModelDefinition> {
    if (models.length === 0) throw new Error('No models to select from');
    if (models.length <= n) {
      return (await this.weightedRandomSelect(models))!;
    }

    const weightedModels = await this.calculateWeights(models);
    weightedModels.sort((a, b) => b.weight - a.weight);

    const topN = weightedModels.slice(0, n);

    return this.selectRandomWeighted(
      topN,
      topN.map(x => x.model),
    );
  }
}
