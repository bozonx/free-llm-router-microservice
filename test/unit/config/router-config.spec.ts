import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { loadRouterConfig } from '../../../src/config/router.config.js';

describe('loadRouterConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Clear relevant env vars
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ROUTER_MODELS_FILE;
    delete process.env.ROUTER_MODEL_REQUESTS_PER_MINUTE;
    delete process.env.ROUTER_MODEL_OVERRIDES;
    delete process.env.ROUTING_MAX_MODEL_SWITCHES;
    delete process.env.ROUTING_FALLBACK_PROVIDER;

    // By default enabled DeepSeek to satisfy validation if fallback is enabled
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_ENABLED = 'true';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load default configuration when no env vars are set', () => {
    const config = loadRouterConfig(process.env);
    expect(config.modelRequestsPerMinute).toBe(200);
    expect(config.providers.openrouter.enabled).toBe(false);
    expect(config.providers.deepseek.enabled).toBe(true);
    expect(config.routing.maxModelSwitches).toBe(3);
    expect(config.routing.fallback.enabled).toBe(true);
    expect(config.routing.fallback.provider).toBe('deepseek');
  });

  it('should load configuration from environment variables', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-123';
    process.env.DEEPSEEK_API_KEY = 'sk-ds-123';
    process.env.ROUTER_MODELS_FILE = './custom-models.yaml';
    process.env.ROUTER_MODEL_REQUESTS_PER_MINUTE = '500';
    process.env.ROUTING_MAX_MODEL_SWITCHES = '10';
    process.env.ROUTING_FALLBACK_PROVIDER = 'openrouter';
    process.env.ROUTING_FALLBACK_MODEL = 'fallback-model';

    const config = loadRouterConfig(process.env);
    expect(config.modelRequestsPerMinute).toBe(500);
    expect(config.providers.openrouter.apiKey).toBe('sk-or-123');
    expect(config.providers.openrouter.enabled).toBe(true);
    expect(config.providers.deepseek.apiKey).toBe('sk-ds-123');
    expect(config.providers.deepseek.enabled).toBe(true);
    expect(config.routing.maxModelSwitches).toBe(10);
    expect(config.routing.fallback.provider).toBe('openrouter');
    expect(config.routing.fallback.model).toBe('fallback-model');
  });

  it('should parse model overrides from JSON string', () => {
    const overrides = [
      { name: 'model-1', weight: 50 },
      { name: 'model-2', available: false }
    ];
    process.env.ROUTER_MODEL_OVERRIDES = JSON.stringify(overrides);

    const config = loadRouterConfig(process.env);
    expect(config.modelOverrides).toEqual(overrides);
  });

  it('should throw error on invalid overrides JSON', () => {
    process.env.ROUTER_MODEL_OVERRIDES = '{ invalid json }';
    expect(() => loadRouterConfig(process.env)).toThrow('Failed to parse ROUTER_MODEL_OVERRIDES JSON');
  });

  it('should respect explicit ENABLED flags', () => {
    process.env.OPENROUTER_API_KEY = 'key';
    process.env.OPENROUTER_ENABLED = 'false';
    const config = loadRouterConfig(process.env);
    expect(config.providers.openrouter.enabled).toBe(false);
  });
});
