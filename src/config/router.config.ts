import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { config as loadDotenv } from 'dotenv';
import type { RouterConfig } from './router-config.interface.js';
import { RouterConfigValidator } from './validators/router-config-validator.js';

/**
 * Load router configuration from environment variables
 */
export function loadRouterConfig(): RouterConfig {
  // Load environment variables from .env files
  loadEnvironmentVariables();

  const getEnv = (name: string, defaultValue?: string): string | undefined =>
    process.env[name] ?? defaultValue;
  const getEnvNum = (name: string, defaultValue: number): number => {
    const val = process.env[name];
    return val ? Number(val) : defaultValue;
  };
  const getEnvBool = (name: string, defaultValue: boolean): boolean => {
    const val = process.env[name];
    if (val === undefined) return defaultValue;
    return val.toLowerCase() === 'true' || val === '1';
  };

  const openrouterKey = getEnv('OPENROUTER_API_KEY');
  const deepseekKey = getEnv('DEEPSEEK_API_KEY');

  const config: RouterConfig = {
    modelsFile: getEnv('ROUTER_MODELS_FILE', './models.yaml')!,
    modelRequestsPerMinute: getEnvNum('ROUTER_MODEL_REQUESTS_PER_MINUTE', 200),
    providers: {
      openrouter: {
        enabled: getEnvBool('OPENROUTER_ENABLED', !!openrouterKey),
        apiKey: openrouterKey ?? '',
        baseUrl: getEnv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
      },
      deepseek: {
        enabled: getEnvBool('DEEPSEEK_ENABLED', !!deepseekKey),
        apiKey: deepseekKey ?? '',
        baseUrl: getEnv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
      },
    },
    routing: {
      maxModelSwitches: getEnvNum('ROUTING_MAX_MODEL_SWITCHES', 3),
      maxSameModelRetries: getEnvNum('ROUTING_MAX_SAME_MODEL_RETRIES', 2),
      retryDelay: getEnvNum('ROUTING_RETRY_DELAY', 3000),
      timeoutSecs: getEnvNum('ROUTING_TIMEOUT_SECS', 60),
      fallback: {
        enabled: getEnvBool('ROUTING_FALLBACK_ENABLED', true),
        provider: getEnv('ROUTING_FALLBACK_PROVIDER', 'deepseek')!,
        model: getEnv('ROUTING_FALLBACK_MODEL', 'deepseek-chat')!,
      },
    },
    circuitBreaker: {
      failureThreshold: getEnvNum('CB_FAILURE_THRESHOLD', 3),
      cooldownPeriodMins: getEnvNum('CB_COOLDOWN_PERIOD_MINS', 3),
      successThreshold: getEnvNum('CB_SUCCESS_THRESHOLD', 2),
      statsWindowSizeMins: getEnvNum('CB_STATS_WINDOW_SIZE_MINS', 10),
    },
  };

  // Load model overrides from JSON string if provided
  const overridesJson = getEnv('ROUTER_MODEL_OVERRIDES');
  if (overridesJson) {
    try {
      config.modelOverrides = JSON.parse(overridesJson);
    } catch (error) {
      throw new Error(
        `Failed to parse ROUTER_MODEL_OVERRIDES JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  validateRouterConfig(config);
  return config;

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

  function validateRouterConfig(config: unknown): asserts config is RouterConfig {
    const validator: RouterConfigValidator = new RouterConfigValidator();
    validator.validate(config);
  }
}
