import { createTestApp } from './test-app.factory.js';
import type { Hono } from 'hono';
import { MockFetchClient } from '../helpers/mock-fetch-client.js';

describe('Function Calling (e2e)', () => {
  let app: Hono;
  let fetchClient: MockFetchClient;

  beforeEach(async () => {
    fetchClient = new MockFetchClient();
    fetchClient.setResponse({
      method: 'POST',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      response: {
        status: 500,
        body: JSON.stringify({ error: { message: 'Test error' } }),
        headers: { 'content-type': 'application/json' },
      },
    });
    fetchClient.setResponse({
      method: 'POST',
      url: 'https://api.deepseek.com/chat/completions',
      response: {
        status: 500,
        body: JSON.stringify({ error: { message: 'Test error' } }),
        headers: { 'content-type': 'application/json' },
      },
    });

    app = await createTestApp({ fetchClient });
  });

  describe('POST /api/v1/chat/completions', () => {
    it('accepts tools and tool_choice fields', async () => {
      const response = await app.request('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: 'What is the weather in London?',
            },
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_weather',
                description: 'Get current weather',
                parameters: {
                  type: 'object',
                  properties: {
                    location: {
                      type: 'string',
                      description: 'City name',
                    },
                  },
                },
              },
            },
          ],
          tool_choice: 'auto',
        }),
      });

      // We expect 500 or 4xx because we don't have valid keys, but we want to ensure
      // the validation passed. If validation failed, it would be 400 Bad Request
      // with a specific error message about forbidden fields.
      // Here we just verify we didn't get a validation error for 'tools'.

      // If we get 400, checks if it is related to tools
      expect(response.status).not.toBe(400);

      // In a real e2e with mocks, we would assert 200 and the response content.
      // Here we just verify we didn't get a validation error for 'tools'.
    });

    it('accepts tool messages', async () => {
      const response = await app.request('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: 'What is the weather in London?',
            },
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "London"}',
                  },
                },
              ],
            },
            {
              role: 'tool',
              tool_call_id: 'call_123',
              content: '{"temp": 20}',
            },
          ],
        }),
      });

      expect(response.status).not.toBe(400);
    });
  });
});
