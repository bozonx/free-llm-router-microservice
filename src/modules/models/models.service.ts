import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import type { ModelDefinition, ModelsConfig } from './interfaces/model.interface.js';

/**
 * Filter criteria for model selection
 */
export interface FilterCriteria {
  /**
   * Tags to filter by (all must match)
   */
  tags?: string[];

  /**
   * Model type
   */
  type?: 'fast' | 'reasoning';

  /**
   * Minimum context size
   */
  minContextSize?: number;

  /**
   * JSON response support required
   */
  jsonResponse?: boolean;

  /**
   * Provider filter
   */
  provider?: string;
}

/**
 * Service for managing LLM models
 */
@Injectable()
export class ModelsService implements OnModuleInit {
  private readonly logger = new Logger(ModelsService.name);
  private models: ModelDefinition[] = [];

  /**
   * Load models from YAML file on module initialization
   */
  async onModuleInit(): Promise<void> {
    const modelsFilePath = process.env['MODELS_FILE_PATH'] || './config/models.yaml';
    this.loadModelsFromFile(modelsFilePath);
    this.logger.log(`Loaded ${this.models.length} models from ${modelsFilePath}`);
  }

  /**
   * Load models from YAML file
   */
  private loadModelsFromFile(filePath: string): void {
    const absolutePath = resolve(filePath);

    let fileContent: string;
    try {
      fileContent = readFileSync(absolutePath, 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to read models file at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let config: unknown;
    try {
      config = parseYaml(fileContent);
    } catch (error) {
      throw new Error(
        `Failed to parse YAML models file at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (typeof config !== 'object' || config === null || !('models' in config)) {
      throw new Error('Models file must contain "models" array');
    }

    const modelsConfig = config as ModelsConfig;
    if (!Array.isArray(modelsConfig.models)) {
      throw new Error('Models "models" property must be an array');
    }

    this.models = modelsConfig.models.map(model =>
      this.convertModel(model as unknown as Record<string, unknown>),
    );
  }

  /**
   * Convert model from YAML format (snake_case) to TypeScript format (camelCase)
   */
  private convertModel(model: Record<string, unknown>): ModelDefinition {
    return {
      name: String(model['name']),
      provider: String(model['provider']),
      model: String(model['model']),
      type: model['type'] as 'fast' | 'reasoning',
      contextSize: Number(model['contextSize']),
      maxOutputTokens: Number(model['maxOutputTokens']),
      speed: model['speed'] as 'fast' | 'medium' | 'slow',
      tags: Array.isArray(model['tags']) ? model['tags'].map(String) : [],
      jsonResponse: Boolean(model['jsonResponse']),
      available: Boolean(model['available']),
    };
  }

  /**
   * Get all models
   */
  getAll(): ModelDefinition[] {
    return [...this.models];
  }

  /**
   * Get only available models
   */
  getAvailable(): ModelDefinition[] {
    return this.models.filter(model => model.available);
  }

  /**
   * Find model by name
   */
  findByName(name: string): ModelDefinition | undefined {
    return this.models.find(model => model.name === name);
  }

  /**
   * Filter models by criteria
   */
  filter(criteria: FilterCriteria): ModelDefinition[] {
    return this.models.filter(model => {
      // Only available models
      if (!model.available) {
        return false;
      }

      // Filter by tags (all must match)
      if (criteria.tags && criteria.tags.length > 0) {
        const hasAllTags = criteria.tags.every(tag => model.tags.includes(tag));
        if (!hasAllTags) {
          return false;
        }
      }

      // Filter by type
      if (criteria.type && model.type !== criteria.type) {
        return false;
      }

      // Filter by minimum context size
      if (criteria.minContextSize && model.contextSize < criteria.minContextSize) {
        return false;
      }

      // Filter by JSON response support
      if (criteria.jsonResponse && !model.jsonResponse) {
        return false;
      }

      // Filter by provider
      if (criteria.provider && model.provider !== criteria.provider) {
        return false;
      }

      return true;
    });
  }
}
