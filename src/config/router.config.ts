import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { config as loadDotenv } from 'dotenv';
import type { RouterConfig } from './router-config.interface.js';
import { RouterConfigValidator } from './validators/router-config-validator.js';

/**
 * Load router configuration from YAML file
 */
export function loadRouterConfig(): RouterConfig {
  // Load environment variables from .env files
  loadEnvironmentVariables();

  const configPath = process.env['ROUTER_CONFIG_PATH'] ?? './config.yaml';
  const absolutePath = resolve(configPath);

  const fileContent = readConfigFile(absolutePath);
  const substitutedContent = substituteEnvVariables(fileContent);
  const config = parseYamlConfig(substitutedContent, absolutePath);

  validateRouterConfig(config);

  return config;
}

/**
 * Load environment variables from .env files
 * Follows the same pattern as ConfigModule in AppModule
 */
function loadEnvironmentVariables(): void {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const envFiles = [`.env.${nodeEnv}`, '.env'];

  // Load each env file if it exists
  for (const envFile of envFiles) {
    const envPath = resolve(envFile);
    if (existsSync(envPath)) {
      loadDotenv({ path: envPath });
    }
  }
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
 * Skips YAML comments (lines starting with #)
 */
function substituteEnvVariables(content: string): string {
  const lines = content.split('\n');
  const processedLines = lines.map(line => {
    // Skip comment lines
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      return line;
    }

    // Process non-comment lines
    return line.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
      const value = process.env[varName];
      if (value === undefined) {
        throw new Error(`Environment variable ${varName} is not defined`);
      }
      return value;
    });
  });

  return processedLines.join('\n');
}

function validateRouterConfig(config: unknown): asserts config is RouterConfig {
  const validator: RouterConfigValidator = new RouterConfigValidator();
  validator.validate(config);
}
