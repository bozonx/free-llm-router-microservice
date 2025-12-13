import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import type { RouterConfig } from './router-config.interface.js';
import { RouterConfigValidator } from './validators/router-config-validator.js';

/**
 * Load router configuration from YAML file
 */
export function loadRouterConfig(): RouterConfig {
  const configPath = process.env['ROUTER_CONFIG_PATH'] ?? './router.yaml';
  const absolutePath = resolve(configPath);

  const fileContent = readConfigFile(absolutePath);
  const substitutedContent = substituteEnvVariables(fileContent);
  const config = parseYamlConfig(substitutedContent, absolutePath);

  validateRouterConfig(config);

  return config;
}

function readConfigFile(absolutePath: string): string {
  try {
    return readFileSync(absolutePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to read router config file at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseYamlConfig(content: string, source: string): unknown {
  try {
    return parseYaml(content);
  } catch (error) {
    throw new Error(
      `Failed to parse YAML config file at ${source}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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

function validateRouterConfig(config: unknown): asserts config is RouterConfig {
  const validator: RouterConfigValidator = new RouterConfigValidator();
  validator.validate(config);
}
