import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './test-app.factory.js';

describe('Router (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    // Create fresh app instance for each test for better isolation
    app = await createTestApp();
  });

  afterEach(async () => {
    // Clean up app instance after each test
    if (app) {
      await app.close();
    }
  });

  describe('GET /api/v1/models', () => {
    it('returns list of available models', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/models',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('models');
      expect(Array.isArray(body.models)).toBe(true);
      expect(body.models.length).toBeGreaterThan(0);

      // Check structure of first model
      const firstModel = body.models[0];
      expect(firstModel).toHaveProperty('name');
      expect(firstModel).toHaveProperty('provider');
      expect(firstModel).toHaveProperty('type');
      expect(firstModel).toHaveProperty('contextSize');
      expect(firstModel).toHaveProperty('tags');
      expect(firstModel).toHaveProperty('available');

      expect(firstModel).toHaveProperty('model');
      expect(firstModel).toHaveProperty('maxOutputTokens');
      expect(firstModel).toHaveProperty('speedTier');
      expect(firstModel).toHaveProperty('jsonResponse');

      expect(['fast', 'reasoning']).toContain(firstModel.type);
      expect(typeof firstModel.contextSize).toBe('number');
      expect(Array.isArray(firstModel.tags)).toBe(true);
    });
  });

  describe('POST /api/v1/chat/completions', () => {
    it('validates required messages field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('messages');
    });

    it('validates messages array is not empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          messages: [],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('validates message role is valid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          messages: [
            {
              role: 'invalid',
              content: 'test',
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('validates temperature is in range 0-2', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          messages: [
            {
              role: 'user',
              content: 'test',
            },
          ],
          temperature: 3,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('validates top_p is in range 0-1', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          messages: [
            {
              role: 'user',
              content: 'test',
            },
          ],
          top_p: 2,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('validates type field with valid values', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          messages: [
            {
              role: 'user',
              content: 'test',
            },
          ],
          type: 'invalid',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects non-whitelisted fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          messages: [
            {
              role: 'user',
              content: 'test',
            },
          ],
          unexpected_field: 'should be rejected',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    // Note: This test requires actual API keys and is skipped in CI
    // Run manually with valid API keys to test integration
    it.skip('successfully completes chat with valid request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          messages: [
            {
              role: 'user',
              content: 'Say hello in one word',
            },
          ],
          temperature: 0.7,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Check standard OpenAI fields
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('object');
      expect(body.object).toBe('chat.completion');
      expect(body).toHaveProperty('created');
      expect(body).toHaveProperty('model');
      expect(body).toHaveProperty('choices');
      expect(body).toHaveProperty('usage');

      // Check choices
      expect(Array.isArray(body.choices)).toBe(true);
      expect(body.choices.length).toBeGreaterThan(0);
      const firstChoice = body.choices[0];
      expect(firstChoice).toHaveProperty('index');
      expect(firstChoice).toHaveProperty('message');
      expect(firstChoice.message).toHaveProperty('role', 'assistant');
      expect(firstChoice.message).toHaveProperty('content');
      expect(firstChoice).toHaveProperty('finish_reason');

      // Check usage
      expect(body.usage).toHaveProperty('prompt_tokens');
      expect(body.usage).toHaveProperty('completion_tokens');
      expect(body.usage).toHaveProperty('total_tokens');

      // Check router metadata
      expect(body).toHaveProperty('_router');
      expect(body._router).toHaveProperty('provider');
      expect(body._router).toHaveProperty('model_name');
      expect(body._router).toHaveProperty('attempts');
      expect(body._router).toHaveProperty('fallback_used');
      expect(typeof body._router.attempts).toBe('number');
      expect(typeof body._router.fallback_used).toBe('boolean');
    });

    it.skip('filters models by type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          messages: [
            {
              role: 'user',
              content: 'Test message',
            },
          ],
          type: 'fast',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body._router.model_name).toBeDefined();
    });

    it.skip('filters models by tags', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          messages: [
            {
              role: 'user',
              content: 'Test message',
            },
          ],
          tags: ['code'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body._router.model_name).toBeDefined();
    });

    it.skip('uses specified model when provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          messages: [
            {
              role: 'user',
              content: 'Test message',
            },
          ],
          model: 'llama-3.3-70b',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body._router.model_name).toBe('llama-3.3-70b');
    });
  });
});
