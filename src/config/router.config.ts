import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import type { RouterConfig } from './router-config.interface.js';

/**
 * Retry jitter percentage (±20%)
 */
export const RETRY_JITTER_PERCENT = 20;

/**
 * Load router configuration from YAML file
 */
export function loadRouterConfig(): RouterConfig {
  const configPath = process.env['ROUTER_CONFIG_PATH'] ?? './router.yaml';
  const absolutePath = resolve(configPath);

  let fileContent: string;
  try {
    fileContent = readFileSync(absolutePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to read router config file at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Substitute environment variables
  const substitutedContent = substituteEnvVariables(fileContent);

  let config: unknown;
  try {
    config = parseYaml(substitutedContent);
  } catch (error) {
    throw new Error(
      `Failed to parse YAML config file at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Basic validation
  validateRouterConfig(config);

  return config;
}

/**
 * Substitute environment variables in the format ${VAR_NAME}
 */
function substituteEnvVariables(content: string): string {
  return content.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(`Environment variable ${varName} is not defined`);
    }
    return value;
  });
}

/**
 * Validate router configuration structure
 */
function validateRouterConfig(config: unknown): asserts config is RouterConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error('Router config must be an object');
  }

  const cfg = config as Record<string, unknown>;

  // Validate modelsFile
  if (typeof cfg['modelsFile'] !== 'string') {
    throw new Error('Router config: modelsFile must be a string');
  }

  // Validate providers
  if (typeof cfg['providers'] !== 'object' || cfg['providers'] === null) {
    throw new Error('Router config: providers must be an object');
  }

  const providers = cfg['providers'] as Record<string, unknown>;
  for (const [providerName, providerConfig] of Object.entries(providers)) {
    if (typeof providerConfig !== 'object' || providerConfig === null) {
      throw new Error(`Router config: providers.${providerName} must be an object`);
    }

    const pc = providerConfig as Record<string, unknown>;
    if (typeof pc['enabled'] !== 'boolean') {
      throw new Error(`Router config: providers.${providerName}.enabled must be a boolean`);
    }
    if (typeof pc['apiKey'] !== 'string') {
      throw new Error(`Router config: providers.${providerName}.apiKey must be a string`);
    }
    if (typeof pc['baseUrl'] !== 'string') {
      throw new Error(`Router config: providers.${providerName}.baseUrl must be a string`);
    }
  }

  // Validate routing
  if (typeof cfg['routing'] !== 'object' || cfg['routing'] === null) {
    throw new Error('Router config: routing must be an object');
  }

  const routing = cfg['routing'] as Record<string, unknown>;

  if (routing['algorithm'] && routing['algorithm'] !== 'smart') {
    throw new Error('Router config: routing.algorithm must be "smart"');
  }
  if (typeof routing['maxRetries'] !== 'number' || routing['maxRetries'] < 0) {
    throw new Error('Router config: routing.maxRetries must be a non-negative number');
  }
  if (typeof routing['rateLimitRetries'] !== 'number' || routing['rateLimitRetries'] < 0) {
    throw new Error('Router config: routing.rateLimitRetries must be a non-negative number');
  }
  if (typeof routing['retryDelay'] !== 'number' || routing['retryDelay'] < 0) {
    throw new Error('Router config: routing.retryDelay must be a non-negative number');
  }
  if (typeof routing['timeout'] !== 'number' || routing['timeout'] < 0) {
    throw new Error('Router config: routing.timeout must be a non-negative number');
  }

  // Validate fallback
  if (typeof routing['fallback'] !== 'object' || routing['fallback'] === null) {
    throw new Error('Router config: routing.fallback must be an object');
  }

  const fallback = routing['fallback'] as Record<string, unknown>;
  if (typeof fallback['enabled'] !== 'boolean') {
    throw new Error('Router config: routing.fallback.enabled must be a boolean');
  }
  if (typeof fallback['provider'] !== 'string') {
    throw new Error('Router config: routing.fallback.provider must be a string');
  }
  if (typeof fallback['model'] !== 'string') {
    throw new Error('Router config: routing.fallback.model must be a string');
  }

  // Validate circuitBreaker (optional)
  if (cfg['circuitBreaker'] !== undefined) {
    if (typeof cfg['circuitBreaker'] !== 'object' || cfg['circuitBreaker'] === null) {
      throw new Error('Router config: circuitBreaker must be an object');
    }

    const cb = cfg['circuitBreaker'] as Record<string, unknown>;

    if (cb['failureThreshold'] !== undefined) {
      if (typeof cb['failureThreshold'] !== 'number' || cb['failureThreshold'] < 1) {
        throw new Error('Router config: circuitBreaker.failureThreshold must be a positive number');
      }
    }
    if (cb['cooldownPeriod'] !== undefined) {
      if (typeof cb['cooldownPeriod'] !== 'number' || cb['cooldownPeriod'] < 0) {
        throw new Error(
          'Router config: circuitBreaker.cooldownPeriod must be a non-negative number',
        );
      }
    }
    if (cb['successThreshold'] !== undefined) {
      if (typeof cb['successThreshold'] !== 'number' || cb['successThreshold'] < 1) {
        throw new Error('Router config: circuitBreaker.successThreshold must be a positive number');
      }
    }
    if (cb['statsWindowSize'] !== undefined) {
      if (typeof cb['statsWindowSize'] !== 'number' || cb['statsWindowSize'] < 0) {
        throw new Error(
          'Router config: circuitBreaker.statsWindowSize must be a non-negative number',
        );
      }
    }
  }

  // Validate modelOverrides (optional)
  if (cfg['modelOverrides'] !== undefined) {
    if (typeof cfg['modelOverrides'] !== 'object' || cfg['modelOverrides'] === null) {
      throw new Error('Router config: modelOverrides must be an object');
    }

    const overrides = cfg['modelOverrides'] as Record<string, unknown>;
    for (const [modelName, override] of Object.entries(overrides)) {
      if (typeof override !== 'object' || override === null) {
        throw new Error(`Router config: modelOverrides.${modelName} must be an object`);
      }

      const mo = override as Record<string, unknown>;
      if (mo['priority'] !== undefined && typeof mo['priority'] !== 'number') {
        throw new Error(`Router config: modelOverrides.${modelName}.priority must be a number`);
      }
      if (mo['weight'] !== undefined && typeof mo['weight'] !== 'number') {
        throw new Error(`Router config: modelOverrides.${modelName}.weight must be a number`);
      }
    }
  }
}
