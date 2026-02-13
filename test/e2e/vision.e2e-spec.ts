import { createTestApp } from './test-app.factory.js';
import type { Hono } from 'hono';
import { MockFetchClient } from '../helpers/mock-fetch-client.js';

describe('Vision Support (e2e)', () => {
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
    it('accepts plain string content (regression)', async () => {
      const response = await app.request('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: 'Hello, world!',
            },
          ],
        }),
      });

      expect(response.status).not.toBe(400);
    });

    it('accepts image_url content block in messages', async () => {
      const response = await app.request('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'What is in this image?',
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg',
                  },
                },
              ],
            },
          ],
        }),
      });

      // We mainly care that validation doesn't fail.
      expect(response.status).not.toBe(400);
    });

    it('accepts image_url with detail parameter', async () => {
      const response = await app.request('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: 'https://example.com/image.jpg',
                    detail: 'high',
                  },
                },
              ],
            },
          ],
        }),
      });

      expect(response.status).not.toBe(400);
    });
  });
});
