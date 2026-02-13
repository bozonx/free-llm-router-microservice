import type { FetchClient } from '../../http/fetch-client.js';
import type { RouterConfig } from '../../config/router-config.interface.js';
import type { BaseProviderConfig } from './base.provider.js';
import type { LlmProvider } from './interfaces/provider.interface.js';
import { OpenRouterProvider } from './openrouter.provider.js';
import { DeepSeekProvider } from './deepseek.provider.js';

export type ProvidersMap = Map<string, LlmProvider>;

export function createProvidersMap(params: {
  config: RouterConfig;
  fetchClient: FetchClient;
}): ProvidersMap {
  const map = new Map<string, LlmProvider>();

  const openRouterCfg = params.config.providers['openrouter'];
  if (openRouterCfg?.enabled) {
    const providerConfig: BaseProviderConfig = {
      apiKey: openRouterCfg.apiKey,
      baseUrl: openRouterCfg.baseUrl ?? 'https://openrouter.ai/api/v1',
      timeoutSecs: params.config.routing.timeoutSecs,
    };
    map.set('openrouter', new OpenRouterProvider(params.fetchClient, providerConfig));
  }

  const deepSeekCfg = params.config.providers['deepseek'];
  if (deepSeekCfg?.enabled) {
    const providerConfig: BaseProviderConfig = {
      apiKey: deepSeekCfg.apiKey,
      baseUrl: deepSeekCfg.baseUrl ?? 'https://api.deepseek.com',
      timeoutSecs: params.config.routing.timeoutSecs,
    };
    map.set('deepseek', new DeepSeekProvider(params.fetchClient, providerConfig));
  }

  return map;
}
