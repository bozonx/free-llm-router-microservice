import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { ROUTER_CONFIG } from '../../config/router-config.provider.js';
import type { RouterConfig } from '../../config/router-config.interface.js';
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

  constructor(
    @Inject(ROUTER_CONFIG) private readonly config: RouterConfig,
  ) { }

  /**
   * Load models from YAML file or URL on module initialization
   */
  public async onModuleInit(): Promise<void> {
    const modelsSource = this.config.modelsFile;

    if (this.isUrl(modelsSource)) {
      await this.loadModelsFromUrl(modelsSource);
      this.logger.log(`Loaded ${this.models.length} models from URL: ${modelsSource}`);
    } else {
      this.loadModelsFromFile(modelsSource);
      this.logger.log(`Loaded ${this.models.length} models from file: ${modelsSource}`);
    }
  }

  /**
   * Check if the source is a URL (http/https)
   */
  private isUrl(source: string): boolean {
    return source.startsWith('http://') || source.startsWith('https://');
  }

  /**
   * Load models from remote URL
   */
  private async loadModelsFromUrl(url: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new Error(
        `Failed to fetch models file from ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch models file from ${url}: HTTP ${response.status} ${response.statusText}`,
      );
    }

    let content: string;
    try {
      content = await response.text();
    } catch (error) {
      throw new Error(
        `Failed to read models file content from ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.parseModelsContent(content, url);
  }

  /**
   * Load models from local YAML file
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

    this.parseModelsContent(fileContent, absolutePath);
  }

  /**
   * Parse YAML content and populate models
   */
  private parseModelsContent(content: string, source: string): void {
    let config: unknown;
    try {
      config = parseYaml(content);
    } catch (error) {
      throw new Error(
        `Failed to parse YAML models file from ${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (typeof config !== 'object' || config === null || !('models' in config)) {
      throw new Error(`Models file from ${source} must contain "models" array`);
    }

    const modelsConfig = config as ModelsConfig;
    if (!Array.isArray(modelsConfig.models)) {
      throw new Error(`Models "models" property from ${source} must be an array`);
    }

    this.models = modelsConfig.models.map(model =>
      this.convertModel(model as unknown as Record<string, unknown>),
    );

    this.applyOverrides();
  }

  /**
   * Apply overrides from router configuration
   */
  private applyOverrides(): void {
    const overrides = this.config.modelOverrides;
    if (!overrides || !Array.isArray(overrides)) {
      return;
    }

    for (const override of overrides) {
      const model = this.models.find(m =>
        m.name === override.name &&
        (!override.provider || m.provider === override.provider) &&
        (!override.model || m.model === override.model)
      );

      if (model) {
        if (override.priority !== undefined) model.priority = override.priority;
        if (override.weight !== undefined) model.weight = override.weight;
        if (override.tags !== undefined) model.tags = override.tags;
        if (override.contextSize !== undefined) model.contextSize = override.contextSize;
        if (override.maxOutputTokens !== undefined) model.maxOutputTokens = override.maxOutputTokens;
        if (override.speedTier !== undefined) model.speedTier = override.speedTier;
        if (override.available !== undefined) model.available = override.available;
        if (override.maxConcurrent !== undefined) model.maxConcurrent = override.maxConcurrent;

        this.logger.debug(`Applied overrides for model ${model.name}`);
      } else {
        this.logger.warn(`Override specified for model ${override.name} but model not found`);
      }
    }
  }

  /**
   * Convert model from YAML format (snake_case) to TypeScript format (camelCase)
   */
  private convertModel(model: Record<string, unknown>): ModelDefinition {
    const result: ModelDefinition = {
      name: String(model['name']),
      provider: String(model['provider']),
      model: String(model['model']),
      type: model['type'] as 'fast' | 'reasoning',
      contextSize: Number(model['contextSize']),
      maxOutputTokens: Number(model['maxOutputTokens']),
      speedTier: model['speedTier'] as 'fast' | 'medium' | 'slow',
      tags: Array.isArray(model['tags']) ? model['tags'].map(String) : [],
      jsonResponse: Boolean(model['jsonResponse']),
      available: Boolean(model['available']),
    };

    // Optional fields for Smart Strategy
    if (model['priority'] !== undefined) {
      result.priority = Number(model['priority']);
    }
    if (model['weight'] !== undefined) {
      result.weight = Number(model['weight']);
    }
    if (model['maxConcurrent'] !== undefined) {
      result.maxConcurrent = Number(model['maxConcurrent']);
    }

    return result;
  }

  /**
   * Get all models
   */
  public getAll(): ModelDefinition[] {
    return [...this.models];
  }

  /**
   * Get only available models
   */
  public getAvailable(): ModelDefinition[] {
    return this.models.filter(model => model.available);
  }

  /**
   * Find model by name
   */
  public findByName(name: string): ModelDefinition | undefined {
    return this.models.find(model => model.name === name);
  }

  /**
   * Filter models by criteria
   */
  public filter(criteria: FilterCriteria): ModelDefinition[] {
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
