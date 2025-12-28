import { Injectable, Logger } from '@nestjs/common';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import { ConfigService } from '../../config/config.service.js';
import type { ModelDefinition } from './interfaces/model.interface.js';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/**
 * Filter criteria for model selection
 */
export interface FilterCriteria {
  /**
   * Tags filter. 
   * Supports DNF logic: 
   * - Array elements (or comma-separated string) are OR-ed.
   * - Tags within an element joined by '&' are AND-ed.
   * Example: ["coding&tier-1", "llama"] means (coding AND tier-1) OR (llama)
   */
  tags?: string | string[];

  /**
   * Model type
   */
  type?: 'fast' | 'reasoning';

  /**
   * Minimum context size required
   */
  minContextSize?: number;

  /**
   * Minimum max output tokens required
   */
  minMaxOutputTokens?: number;

  /**
   * Whether model must support JSON response
   */
  jsonResponse?: boolean;

  /**
   * Whether model must support image input
   */
  supportsImage?: boolean;

  /**
   * Whether model must support video input
   */
  supportsVideo?: boolean;

  /**
   * Whether model must support audio input
   */
  supportsAudio?: boolean;

  /**
   * Whether model must support file input
   */
  supportsFile?: boolean;

  /**
   * Whether model must support tools/function calling
   */
  supportsTools?: boolean;

  /**
   * Filter by provider
   */
  provider?: string;
}

@Injectable()
export class ModelsService {
  private readonly logger = new Logger(ModelsService.name);
  private models: ModelDefinition[] = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) { }

  async onModuleInit() {
    await this.loadModels();
  }

  /**
   * Load models from YAML file or URL
   */
  async loadModels() {
    try {
      const modelsFile = this.configService.config.modelsFile;
      let content: string;

      if (modelsFile.startsWith('http://') || modelsFile.startsWith('https://')) {
        this.logger.log(`Loading models from URL: ${modelsFile}`);
        const response = await firstValueFrom(this.httpService.get(modelsFile));
        content = typeof response.data === 'string' ? response.data : yaml.dump(response.data);
      } else {
        this.logger.log(`Loading models from file: ${modelsFile}`);
        content = fs.readFileSync(modelsFile, 'utf8');
      }

      const data = yaml.load(content) as { models: ModelDefinition[] };
      this.models = data.models || [];
      this.logger.log(`Loaded ${this.models.length} models`);
    } catch (error) {
      this.logger.error(`Failed to load models: ${error.message}`);
      this.models = [];
    }
  }

  /**
   * Get all loaded models
   */
  getModels(): ModelDefinition[] {
    return this.models;
  }

  /**
   * Find a model by its name or ID
   */
  findModel(modelName: string, provider?: string): ModelDefinition | undefined {
    // If provider is specified, look for exact match
    if (provider) {
      return this.models.find(m => m.model === modelName && m.provider === provider);
    }

    // Try finding by model name/id (OpenRouter format: provider/model)
    if (modelName.includes('/')) {
      const [p, m] = modelName.split('/');
      const match = this.models.find(model => model.provider === p && model.model === m);
      if (match) return match;
    }

    // Try finding by name field or model field
    return this.models.find(m => m.name === modelName || m.model === modelName);
  }

  /**
   * Filter models based on criteria
   */
  filter(criteria: FilterCriteria): ModelDefinition[] {
    return this.models.filter(model => this.matchesCriteria(model, criteria));
  }

  /**
   * Check if a model matches the given selection criteria
   */
  matchesCriteria(model: ModelDefinition, criteria: FilterCriteria): boolean {
    // Model must be marked as available
    if (model.available === false) {
      return false;
    }

    if (criteria.tags) {
      const tagGroups = typeof criteria.tags === 'string'
        ? criteria.tags.split(',').map(t => t.trim())
        : criteria.tags;

      if (!this.matchesTagGroups(model, tagGroups)) {
        return false;
      }
    }

    if (criteria.type && model.type !== criteria.type) {
      return false;
    }

    if (criteria.minContextSize && (model.contextSize || 0) < criteria.minContextSize) {
      return false;
    }

    if (criteria.minMaxOutputTokens && (model.maxOutputTokens || 0) < criteria.minMaxOutputTokens) {
      return false;
    }

    if (criteria.jsonResponse && model.jsonResponse !== true) {
      return false; // Model doesn't support JSON via our config
    }

    if (criteria.supportsImage && model.supportsImage !== true) {
      return false;
    }

    if (criteria.supportsVideo && model.supportsVideo !== true) {
      return false;
    }

    if (criteria.supportsAudio && model.supportsAudio !== true) {
      return false;
    }

    if (criteria.supportsFile && model.supportsFile !== true) {
      return false;
    }

    if (criteria.supportsTools && model.supportsTools !== true) {
      return false;
    }

    if (criteria.provider && model.provider !== criteria.provider) {
      return false;
    }

    return true;
  }

  /**
   * Check if model matches any of the tag groups (OR logic between groups)
   * Each group can contain multiple tags joined by '&' (AND logic within group)
   */
  private matchesTagGroups(model: ModelDefinition, tagGroups: string[]): boolean {
    if (tagGroups.length === 0) return true;

    // OR between groups (array elements or comma-separated)
    return tagGroups.some(group => {
      // AND within group (e.g. "coding&tier-2")
      const requiredTags = group.split('&').map(t => t.trim()).filter(t => t.length > 0);

      if (requiredTags.length === 0) return false;

      return requiredTags.every(tag => {
        // Support legacy '|' for OR inside AND group if needed
        if (tag.includes('|')) {
          const orTags = tag.split('|').map(t => t.trim());
          return orTags.some(orTag => model.tags.includes(orTag));
        }
        return model.tags.includes(tag);
      });
    });
  }
}
