import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { ROUTER_CONFIG } from '../../config/router-config.provider.js';
import type { RouterConfig } from '../../config/router-config.interface.js';
import type { ModelDefinition, ModelsConfig } from './interfaces/model.interface.js';
import { ModelValidator } from './validators/model-validator.js';
import { MODELS_FETCH_TIMEOUT_MS } from '../../common/constants/app.constants.js';

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

  constructor(@Inject(ROUTER_CONFIG) private readonly config: RouterConfig) {}

  public async onModuleInit(): Promise<void> {
    const modelsSource = this.config.modelsFile;

    if (this.isUrl(modelsSource)) {
      await this.loadModelsFromUrl(modelsSource);
    } else {
      this.loadModelsFromFile(modelsSource);
    }

    this.logger.log(
      `Loaded ${this.models.length} models from ${this.isUrl(modelsSource) ? 'URL' : 'file'}: ${modelsSource}`,
    );
  }

  /**
   * Check if the source is a URL (http/https)
   */
  private isUrl(source: string): boolean {
    return source.startsWith('http://') || source.startsWith('https://');
  }

  private async loadModelsFromUrl(url: string): Promise<void> {
    const response = await this.fetchModelsFile(url);
    const content = await this.readResponseContent(response, url);
    this.parseModelsContent(content, url);
  }

  private async fetchModelsFile(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MODELS_FETCH_TIMEOUT_MS);

    try {
      this.logger.debug(`Fetching models file from URL: ${url}`);
      // eslint-disable-next-line no-undef
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      // Warn if Content-Type is unexpected
      const contentType = response.headers.get('content-type');
      if (
        contentType &&
        !contentType.includes('yaml') &&
        !contentType.includes('text/plain') &&
        !contentType.includes('application/octet-stream')
      ) {
        this.logger.warn(
          `Unexpected Content-Type: ${contentType}, expecting YAML. Proceeding anyway.`,
        );
      }

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Timeout fetching models file from ${url} (${MODELS_FETCH_TIMEOUT_MS}ms exceeded)`,
        );
      }
      throw new Error(
        `Failed to fetch models file from ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async readResponseContent(response: Response, url: string): Promise<string> {
    try {
      return await response.text();
    } catch (error) {
      throw new Error(
        `Failed to read models file content from ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private loadModelsFromFile(filePath: string): void {
    const absolutePath = resolve(filePath);
    const fileContent = this.readFileContent(absolutePath);
    this.parseModelsContent(fileContent, absolutePath);
  }

  private readFileContent(absolutePath: string): string {
    try {
      return readFileSync(absolutePath, 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to read models file at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private parseModelsContent(content: string, source: string): void {
    const config = this.parseYaml(content, source);
    this.validateModelsConfig(config, source);

    const modelsConfig = config as ModelsConfig;
    this.models = modelsConfig.models.map(model =>
      this.convertModel(model as unknown as Record<string, unknown>),
    );

    this.applyOverrides();
  }

  private parseYaml(content: string, source: string): unknown {
    try {
      return parseYaml(content);
    } catch (error) {
      throw new Error(
        `Failed to parse YAML models file from ${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private validateModelsConfig(config: unknown, source: string): void {
    if (typeof config !== 'object' || config === null || !('models' in config)) {
      throw new Error(`Models file from ${source} must contain "models" array`);
    }

    const modelsConfig = config as ModelsConfig;
    if (!Array.isArray(modelsConfig.models)) {
      throw new Error(`Models "models" property from ${source} must be an array`);
    }
  }

  private applyOverrides(): void {
    const overrides = this.config.modelOverrides;
    if (!overrides || !Array.isArray(overrides)) {
      return;
    }

    for (const override of overrides) {
      const model = this.findModelForOverride(override);

      if (model) {
        this.applyOverrideToModel(model, override);
        this.logger.debug(`Applied overrides for model ${model.name}`);
      } else {
        this.logger.warn(`Override specified for model ${override.name} but model not found`);
      }
    }
  }

  private findModelForOverride(
    override: NonNullable<RouterConfig['modelOverrides']>[number],
  ): ModelDefinition | undefined {
    return this.models.find(
      m =>
        m.name === override.name &&
        (!override.provider || m.provider === override.provider) &&
        (!override.model || m.model === override.model),
    );
  }

  private applyOverrideToModel(
    model: ModelDefinition,
    override: NonNullable<RouterConfig['modelOverrides']>[number],
  ): void {
    if (override.weight !== undefined) model.weight = override.weight;
    if (override.tags !== undefined) model.tags = override.tags;
    if (override.contextSize !== undefined) model.contextSize = override.contextSize;
    if (override.maxOutputTokens !== undefined) model.maxOutputTokens = override.maxOutputTokens;
    if (override.speedTier !== undefined) model.speedTier = override.speedTier;
    if (override.available !== undefined) model.available = override.available;
    if (override.maxConcurrent !== undefined) model.maxConcurrent = override.maxConcurrent;
  }

  private convertModel(model: Record<string, unknown>): ModelDefinition {
    ModelValidator.validateRequired(model);
    ModelValidator.validateOptional(model);

    return this.buildModelDefinition(model);
  }

  private buildModelDefinition(model: Record<string, unknown>): ModelDefinition {
    const result: ModelDefinition = {
      name: model.name as string,
      provider: model.provider as string,
      model: model.model as string,
      type: model.type as 'fast' | 'reasoning',
      contextSize: model.contextSize as number,
      maxOutputTokens: model.maxOutputTokens as number,
      speedTier: model.speedTier as 'fast' | 'medium' | 'slow',
      tags: (model.tags as unknown[]).map(String),
      jsonResponse: model.jsonResponse as boolean,
      available: model.available as boolean,
    };

    this.addOptionalFields(result, model);

    return result;
  }

  private addOptionalFields(result: ModelDefinition, model: Record<string, unknown>): void {
    if (model.weight !== undefined) {
      result.weight = model.weight as number;
    }
    if (model.maxConcurrent !== undefined) {
      result.maxConcurrent = model.maxConcurrent as number;
    }
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
   * Find model by name (case-insensitive)
   */
  public findByName(name: string): ModelDefinition | undefined {
    const lowerName = name.toLowerCase();
    return this.models.find(model => model.name.toLowerCase() === lowerName);
  }

  /**
   * Find models by name, optionally filtered by provider.
   * If provider is specified, returns only the model from that provider.
   * If provider is not specified, returns all models with that name from all providers.
   *
   * @param name - Model name (unified name, not provider-specific ID)
   * @param provider - Optional provider filter
   * @returns Array of matching models (may be empty)
   */
  public findByNameAndProvider(name: string, provider?: string): ModelDefinition[] {
    const lowerName = name.toLowerCase();
    const lowerProvider = provider?.toLowerCase();

    return this.models.filter(model => {
      // Case-insensitive name comparison
      if (model.name.toLowerCase() !== lowerName) {
        return false;
      }

      if (!model.available) {
        return false;
      }

      // Case-insensitive provider comparison
      if (lowerProvider && model.provider.toLowerCase() !== lowerProvider) {
        return false;
      }

      return true;
    });
  }

  public filter(criteria: FilterCriteria): ModelDefinition[] {
    return this.models.filter(model => this.matchesCriteria(model, criteria));
  }

  private matchesCriteria(model: ModelDefinition, criteria: FilterCriteria): boolean {
    if (!model.available) {
      return false;
    }

    if (criteria.tags && !this.hasAllTags(model, criteria.tags)) {
      return false;
    }

    if (criteria.type && model.type !== criteria.type) {
      return false;
    }

    if (criteria.minContextSize && model.contextSize < criteria.minContextSize) {
      return false;
    }

    if (criteria.jsonResponse && !model.jsonResponse) {
      return false;
    }

    if (criteria.provider && model.provider !== criteria.provider) {
      return false;
    }

    return true;
  }

  private hasAllTags(model: ModelDefinition, requiredTags: string[]): boolean {
    return requiredTags.every(tag => model.tags.includes(tag));
  }
}
