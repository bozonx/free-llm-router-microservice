import { Injectable, Logger } from '@nestjs/common';
import { ModelsService } from '../models/models.service.js';
import { RoundRobinStrategy } from './strategies/round-robin.strategy.js';
import type { ModelDefinition } from '../models/interfaces/model.interface.js';
import type { SelectionCriteria } from './interfaces/selector.interface.js';

/**
 * Service for selecting models based on criteria
 */
@Injectable()
export class SelectorService {
    private readonly logger = new Logger(SelectorService.name);

    constructor(
        private readonly modelsService: ModelsService,
        private readonly roundRobinStrategy: RoundRobinStrategy,
    ) { }

    /**
     * Select a model based on criteria
     */
    selectModel(criteria: SelectionCriteria): ModelDefinition | null {
        this.logger.debug(`Selecting model with criteria: ${JSON.stringify(criteria)}`);

        // If specific model is requested, try to find it
        if (criteria.model) {
            const model = this.modelsService.findByName(criteria.model);
            if (model && model.available) {
                this.logger.debug(`Found specific model: ${model.name}`);
                return model;
            }
            this.logger.warn(`Requested model "${criteria.model}" not found or unavailable`);
            return null;
        }

        // Filter models by criteria
        const filteredModels = this.modelsService.filter({
            tags: criteria.tags,
            type: criteria.type,
            minContextSize: criteria.minContextSize,
            jsonResponse: criteria.jsonResponse,
        });

        if (filteredModels.length === 0) {
            this.logger.warn('No models match the criteria');
            return null;
        }

        // Use selection strategy to pick a model
        const selectedModel = this.roundRobinStrategy.select(filteredModels, criteria);

        if (selectedModel) {
            this.logger.debug(`Selected model: ${selectedModel.name} (${selectedModel.provider})`);
        } else {
            this.logger.warn('Selection strategy returned no model');
        }

        return selectedModel;
    }

    /**
     * Select next model excluding already tried ones
     */
    selectNextModel(criteria: SelectionCriteria, excludeModels: string[]): ModelDefinition | null {
        const extendedCriteria: SelectionCriteria = {
            ...criteria,
            excludeModels: [...(criteria.excludeModels || []), ...excludeModels],
        };

        return this.selectModel(extendedCriteria);
    }
}
