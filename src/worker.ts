import { createApp } from './http/create-app.js';
import { WorkerFetchClient } from './adapters/worker/worker-fetch-client.js';

import { load as parseYaml } from 'js-yaml';
import type { RouterConfig } from './config/router-config.interface.js';

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function loadRouterConfigFromEnv(env: Record<string, string | undefined>): RouterConfig {
  const rawConfig = env['ROUTER_CONFIG_YAML'];
  if (!rawConfig) {
    throw new Error('ROUTER_CONFIG_YAML is required in Cloudflare Workers environment');
  }

  const substituted = rawConfig.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
    const value = env[varName];
    if (value === undefined) {
      throw new Error(`Environment variable ${varName} is not defined`);
    }
    return value;
  });

  const parsed = parseYaml(substituted) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('ROUTER_CONFIG_YAML must be a valid YAML object');
  }

  const config = parsed as RouterConfig;

  const modelsFileUrl = env['MODELS_FILE_URL'];
  if (modelsFileUrl) {
    config.modelsFile = modelsFileUrl;
  }

  if (
    !config.modelsFile ||
    !(config.modelsFile.startsWith('http://') || config.modelsFile.startsWith('https://'))
  ) {
    throw new Error(
      'In Cloudflare Workers environment modelsFile must be an http(s) URL. Provide MODELS_FILE_URL.',
    );
  }

  return config;
}

export default {
  async fetch(
    request: Request,
    env: Record<string, string>,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const routerConfig = loadRouterConfigFromEnv(env);

    const app = await createApp({
      fetchClient: new WorkerFetchClient(),
      serveStaticFiles: false,
      routerConfig,
    });

    return app.fetch(request, env, ctx);
  },
};
