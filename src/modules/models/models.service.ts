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
   * Tags filter. 
   * Supports DNF logic: 
   * - Array elements (or comma-separated string) are AND-ed.
   * - Tags within an element joined by '|' are OR-ed.
   * Example: ["tier-1|tier-2", "coding"] means (tier-1 OR tier-2) AND (coding)
   */
  tags?: string | string[];

  /**
   * Model type
   */
  type?: 'fast' | 'reasoning';

  /**
   * Minimum context size
   */
  minContextSize?: number;

  /**
   * Minimum max output tokens
   */
  minMaxOutputTokens?: number;

  /**
   * JSON response support required
   */
  jsonResponse?: boolean;

  /**
   * Image input support required
   */
  supportsImage?: boolean;

  /**
   * Video input support required
   */
  supportsVideo?: boolean;

  /**
   * Audio input support required
   */
  supportsAudio?: boolean;

  /**
   * File/document input support required
   */
  supportsFile?: boolean;

  /**
   * Tools/function calling support required
   */
  supportsTools?: boolean;

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

  constructor(@Inject(ROUTER_CONFIG) private readonly config: RouterConfig) { }

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
    if (override.available !== undefined) model.available = override.available;
    if (override.jsonResponse !== undefined) model.jsonResponse = override.jsonResponse;
    if (override.supportsImage !== undefined) model.supportsImage = override.supportsImage;
    if (override.supportsVideo !== undefined) model.supportsVideo = override.supportsVideo;
    if (override.supportsAudio !== undefined) model.supportsAudio = override.supportsAudio;
    if (override.supportsFile !== undefined) model.supportsFile = override.supportsFile;
    if (override.supportsTools !== undefined) model.supportsTools = override.supportsTools;
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
      tags: model.tags as string[],
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
    if (model.supportsImage !== undefined) {
      result.supportsImage = model.supportsImage as boolean;
    }
    if (model.supportsVideo !== undefined) {
      result.supportsVideo = model.supportsVideo as boolean;
    }
    if (model.supportsAudio !== undefined) {
      result.supportsAudio = model.supportsAudio as boolean;
    }
    if (model.supportsFile !== undefined) {
      result.supportsFile = model.supportsFile as boolean;
    }
    if (model.supportsTools !== undefined) {
      result.supportsTools = model.supportsTools as boolean;
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

    if (criteria.minContextSize && model.contextSize < criteria.minContextSize) {
      return false;
    }

    if (criteria.minMaxOutputTokens && model.maxOutputTokens < criteria.minMaxOutputTokens) {
      return false;
    }

    if (criteria.jsonResponse && !model.jsonResponse) {
      return false;
    }

    if (criteria.supportsImage && !model.supportsImage) {
      return false;
    }

    if (criteria.supportsVideo && !model.supportsVideo) {
      return false;
    }

    if (criteria.supportsAudio && !model.supportsAudio) {
      return false;
    }

    if (criteria.supportsFile && !model.supportsFile) {
      return false;
    }

    if (criteria.supportsTools && !model.supportsTools) {
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

    // AND between groups (array elements)
    return tagGroups.every(group => {
      // Tags within group (e.g. "coding|reasoning")
      // Legacy split by '&' for AND is still supported but array is preferred now
      const splitChar = group.includes('|') ? '|' : '&';
      const tags = group.split(splitChar).map(t => t.trim()).filter(t => t.length > 0);

      if (tags.length === 0) return true;

      if (splitChar === '|') {
        // OR within group
        return tags.some(tag => model.tags.includes(tag));
      } else {
        // AND within group
        return tags.every(tag => model.tags.includes(tag));
      }
    });
  }
}
