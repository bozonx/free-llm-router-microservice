import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './test-app.factory.js';

describe('Vision Support (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('POST /api/v1/chat/completions', () => {
    it('accepts plain string content (regression)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: 'Hello, world!',
            },
          ],
        },
      });

      if (response.statusCode === 400) {
        const body = JSON.parse(response.body);
        if (Array.isArray(body.message)) {
          throw new Error(`Validation failed for string content: ${JSON.stringify(body.message)}`);
        }
      }
    });

    it('accepts image_url content block in messages', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
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
        },
      });

      // We mainly care that validation doesn't fail.
      if (response.statusCode === 400) {
        const body = JSON.parse(response.body);
        // Throw if it's a validation error about the content structure
        if (Array.isArray(body.message)) {
          throw new Error(`Validation failed: ${JSON.stringify(body.message)}`);
        }
      }
    });

    it('accepts image_url with detail parameter', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/completions',
        payload: {
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
        },
      });

      if (response.statusCode === 400) {
        const body = JSON.parse(response.body);
        if (Array.isArray(body.message)) {
          throw new Error(`Validation failed: ${JSON.stringify(body.message)}`);
        }
      }
    });
  });
});
