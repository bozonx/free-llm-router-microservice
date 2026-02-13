import type { Hono } from 'hono';
import { createApp } from '../../src/http/create-app.js';
import { NodeFetchClient } from '../../src/adapters/node/node-fetch-client.js';
import type { FetchClient } from '../../src/http/fetch-client.js';

export async function createTestApp(params?: { fetchClient?: FetchClient }): Promise<Hono> {
  process.env['ROUTER_CONFIG_PATH'] = './test/setup/config.yaml';
  process.env['BASE_PATH'] = '';

  return createApp({
    fetchClient: params?.fetchClient ?? new NodeFetchClient(),
    serveStaticFiles: false,
  });
}
