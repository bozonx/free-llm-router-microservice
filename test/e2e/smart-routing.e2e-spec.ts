import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './test-app.factory.js';
import nock from 'nock';

describe('Smart Routing (e2e)', () => {
  let app: NestFastifyApplication;

  // Save original env to restore after tests
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    // Set config path to test config
    process.env['ROUTER_CONFIG_PATH'] = 'test/setup/config.yaml';
    // Ensure API keys are set for config substitution
    process.env['OPENROUTER_API_KEY'] = 'test-key';
    process.env['DEEPSEEK_API_KEY'] = 'test-key';

    app = await createTestApp();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    process.env = originalEnv;
    nock.enableNetConnect();
  });

  beforeEach(() => {
    nock.cleanAll();
    nock.disableNetConnect();
  });

  describe('Circuit Breaker', () => {
    const targetModel = 'llama-3.1-8b'; // Priority 1

    it('should open circuit after failures and skip model', async () => {
      // Setup:
      // 1. Mock OpenRouter to always fail (500)
      nock('https://openrouter.ai')
        .post('/api/v1/chat/completions', () => true)
        .times(100)
        .reply(500, {
          error: 'Internal Server Error',
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });

      // 2. Mock DeepSeek (fallback) to succeed
      nock('https://api.deepseek.com')
        .post('/chat/completions', () => true)
        .times(100)
        .reply(200, {
          id: 'fallback',
          choices: [{ message: { role: 'assistant', content: 'Fallback response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });

      // 1. Send Request 1
      await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          model: targetModel,
          messages: [{ role: 'user', content: 'test' }],
        },
      });

      // Check State: Circuit should be OPEN now
      const adminResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/state',
      });
      const state = JSON.parse(adminResponse.body);
      const modelState = state.models.find((m: any) => m.name === targetModel);
      expect(modelState.circuitState).toBe('OPEN');

      // 2. Send Request 2 - Should SKIP OpenRouter (Primary) and go straight to Fallback

      nock.cleanAll();
      nock.disableNetConnect(); // Ensure blocked

      const openRouterScope2 = nock('https://openrouter.ai')
        .post('/api/v1/chat/completions', () => true)
        .reply(500, {
          error: 'Should not happen',
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });

      const deepSeekScope2 = nock('https://api.deepseek.com')
        .post('/chat/completions', () => true)
        .reply(200, {
          id: 'fallback-2',
          choices: [{ message: { role: 'assistant', content: 'Fallback response 2' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });

      await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          model: targetModel,
          messages: [{ role: 'user', content: 'test' }],
        },
      });

      // Verify OpenRouter was NOT hit
      expect(openRouterScope2.isDone()).toBe(false);
      // Verify DeepSeek WAS hit
      expect(deepSeekScope2.isDone()).toBe(true);
    });

    it('should mark model as PERMANENTLY_UNAVAILABLE on 404', async () => {
      const model404 = 'qwen-2.5-7b';

      nock('https://openrouter.ai')
        .post('/api/v1/chat/completions', () => true)
        .reply(404, {
          error: { message: 'Model not found' },
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });

      // Mock Fallback
      nock('https://api.deepseek.com')
        .post('/chat/completions', () => true)
        .reply(200, {
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });

      await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          model: model404,
          messages: [{ role: 'user', content: 'test' }],
        },
      });

      // Verify state
      const adminResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/state',
      });
      const state = JSON.parse(adminResponse.body);
      const modelState = state.models.find((m: any) => m.name === model404);
      expect(modelState.circuitState).toBe('PERMANENTLY_UNAVAILABLE');
    });
  });

  describe('Smart Selection Strategy', () => {
    it('should respect priority overrides (prefer Priority 1 over 2)', async () => {
      // llama-3.3-70b is Priority 1
      // deepseek-r1 is Priority 2

      nock('https://openrouter.ai')
        .post('/api/v1/chat/completions', () => true)
        .times(5)
        .reply(200, (uri, body) => {
          const reqBody = body as any;
          return {
            id: 'test-id',
            choices: [{ message: { role: 'assistant', content: 'response' } }],
            model: reqBody.model,
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        });

      for (let i = 0; i < 5; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/chat/completions',
          payload: {
            messages: [{ role: 'user', content: 'test' }],
          },
        });
        const body = JSON.parse(response.body);
        expect(body._router.model_name).not.toBe('deepseek-r1');
      }
    });

    it('should select faster model when prefer_fast is true', async () => {
      // 1. Train Llama 70B (Slow)
      nock('https://openrouter.ai')
        .post('/api/v1/chat/completions', () => true)
        .delay(200)
        .reply(200, {
          choices: [{ message: { content: 'slow' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });

      await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          model: 'llama-3.3-70b',
          messages: [{ role: 'user', content: 'train' }],
        },
      });

      // 2. Train DeepSeek (Fast)
      nock('https://openrouter.ai')
        .post('/api/v1/chat/completions', () => true)
        .delay(10)
        .reply(200, {
          choices: [{ message: { content: 'fast' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });

      await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          model: 'deepseek-r1',
          messages: [{ role: 'user', content: 'train' }],
        },
      });

      // Now Request with prefer_fast=true
      nock('https://openrouter.ai')
        .post('/api/v1/chat/completions', () => true)
        .reply(200, (uri, body: any) => {
          return {
            id: 'fast-id',
            choices: [{ message: { content: 'winner' } }],
            model: body.model,
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          messages: [{ role: 'user', content: 'race' }],
          prefer_fast: true,
        },
      });

      const body = JSON.parse(response.body);
      expect(body._router.model_name).not.toBe('llama-3.3-70b');
    });
  });

  describe('Admin API', () => {
    it('should return metrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/metrics',
      });
      expect(response.statusCode).toBe(200);
      const metrics = JSON.parse(response.body);
      expect(metrics).toHaveProperty('totalRequests');
      expect(metrics).toHaveProperty('successfulRequests');
      expect(metrics).toHaveProperty('avgLatency');
    });
  });
});
