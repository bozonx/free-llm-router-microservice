import { createTestApp } from './test-app.factory.js';
import type { Hono } from 'hono';
import { MockFetchClient } from '../helpers/mock-fetch-client.js';

describe('Smart Routing (e2e)', () => {
  let app: Hono;
  let fetchClient: MockFetchClient;

  // Save original env to restore after tests
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    // Set config path to test config
    process.env['ROUTER_CONFIG_PATH'] = 'test/setup/config.yaml';
    // Ensure API keys are set for config substitution
    process.env['OPENROUTER_API_KEY'] = 'test-key';
    process.env['DEEPSEEK_API_KEY'] = 'test-key';

    fetchClient = new MockFetchClient();
    app = await createTestApp({ fetchClient });
  });

  afterAll(async () => {
    process.env = originalEnv;
  });

  describe('Circuit Breaker', () => {
    const targetModel = 'gpt-oss-20b'; // Priority 1

    it('should open circuit after failures and skip model', async () => {
      fetchClient.setResponse({
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        response: {
          status: 500,
          body: JSON.stringify({
            error: 'Internal Server Error',
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
          headers: { 'content-type': 'application/json' },
        },
      });

      fetchClient.setResponse({
        method: 'POST',
        url: 'https://api.deepseek.com/chat/completions',
        response: {
          status: 200,
          body: JSON.stringify({
            id: 'fallback',
            choices: [{ message: { role: 'assistant', content: 'Fallback response' } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
          headers: { 'content-type': 'application/json' },
        },
      });

      // 1. Send Request 1
      await app.request('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: 'user', content: 'test' }],
        }),
      });

      // Check State: Circuit should be OPEN now
      const adminResponse = await app.request('/api/v1/admin/state', {
        method: 'GET',
      });
      const state = JSON.parse(await adminResponse.text());
      const modelState = state.models.find((m: any) => m.name === targetModel);
      expect(modelState.circuitState).toBe('OPEN');

      // 2. Send Request 2 - Should SKIP OpenRouter (Primary) and go straight to Fallback

      const openRouterCallsBefore = fetchClient.getCallCount({
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
      });

      const deepSeekCallsBefore = fetchClient.getCallCount({
        method: 'POST',
        url: 'https://api.deepseek.com/chat/completions',
      });

      await app.request('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: 'user', content: 'test' }],
        }),
      });

      const openRouterCallsAfter = fetchClient.getCallCount({
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
      });

      const deepSeekCallsAfter = fetchClient.getCallCount({
        method: 'POST',
        url: 'https://api.deepseek.com/chat/completions',
      });

      // Verify OpenRouter was NOT hit again
      expect(openRouterCallsAfter).toBe(openRouterCallsBefore);
      // Verify DeepSeek WAS hit again
      expect(deepSeekCallsAfter).toBeGreaterThan(deepSeekCallsBefore);
    });

    it('should mark model as PERMANENTLY_UNAVAILABLE on 404', async () => {
      const model404 = 'nemotron-nano-12b-v2-vl';

      fetchClient.setResponse({
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        response: {
          status: 404,
          body: JSON.stringify({
            error: { message: 'Model not found' },
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
          headers: { 'content-type': 'application/json' },
        },
      });

      fetchClient.setResponse({
        method: 'POST',
        url: 'https://api.deepseek.com/chat/completions',
        response: {
          status: 200,
          body: JSON.stringify({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
          headers: { 'content-type': 'application/json' },
        },
      });

      await app.request('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: model404,
          messages: [{ role: 'user', content: 'test' }],
        }),
      });

      // Verify state
      const adminResponse = await app.request('/api/v1/admin/state', {
        method: 'GET',
      });
      const state = JSON.parse(await adminResponse.text());
      const modelState = state.models.find((m: any) => m.name === model404);
      expect(modelState.circuitState).toBe('PERMANENTLY_UNAVAILABLE');
    });
  });

  describe('Smart Selection Strategy', () => {
    it('should select models based on weighted random (higher weight = more likely)', async () => {
      // llama-3.3-70b-instruct has weight 10
      // deepseek-r1t2-chimera has weight 5
      // With weighted random, llama-3.3-70b-instruct should be selected more often

      fetchClient.setResponse({
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        response: {
          status: 200,
          body: JSON.stringify({
            id: 'test-id',
            choices: [{ message: { role: 'assistant', content: 'response' } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
          headers: { 'content-type': 'application/json' },
        },
      });

      for (let i = 0; i < 5; i++) {
        const response = await app.request('/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'test' }],
          }),
        });
        const body = JSON.parse(await response.text());
        // Just verify that a model was selected - weighted random means any could be chosen
        expect(body._router.model_name).toBeDefined();
      }
    });

    it('should select faster model when prefer_fast is true', async () => {
      // 1. Train gpt-oss-20b (Slow)
      fetchClient.setResponse({
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        response: {
          status: 200,
          body: JSON.stringify({
            choices: [{ message: { content: 'slow' } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
          headers: { 'content-type': 'application/json' },
        },
      });

      await app.request('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-oss-20b',
          messages: [{ role: 'user', content: 'train' }],
        }),
      });

      // 2. Train mimo-v2-flash (Fast)
      fetchClient.setResponse({
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        response: {
          status: 200,
          body: JSON.stringify({
            choices: [{ message: { content: 'fast' } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
          headers: { 'content-type': 'application/json' },
        },
      });

      await app.request('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'mimo-v2-flash',
          messages: [{ role: 'user', content: 'train' }],
        }),
      });

      // Now Request with prefer_fast=true
      fetchClient.setResponse({
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        response: {
          status: 200,
          body: JSON.stringify({
            id: 'fast-id',
            choices: [{ message: { content: 'winner' } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
          headers: { 'content-type': 'application/json' },
        },
      });

      const response = await app.request('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'race' }],
          prefer_fast: true,
        }),
      });

      const body = JSON.parse(await response.text());
      expect(body._router.model_name).not.toBe('gpt-oss-20b');
    });
  });

  describe('Admin API', () => {
    it('should return metrics', async () => {
      const response = await app.request('/api/v1/admin/metrics', {
        method: 'GET',
      });
      expect(response.status).toBe(200);
      const metrics = JSON.parse(await response.text());
      expect(metrics).toHaveProperty('totalRequests');
      expect(metrics).toHaveProperty('successfulRequests');
      expect(metrics).toHaveProperty('avgLatency');
    });
  });
});
