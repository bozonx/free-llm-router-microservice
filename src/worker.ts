import { createApp } from './http/create-app.js';
import { WorkerFetchClient } from './adapters/worker/worker-fetch-client.js';
import { loadRouterConfig } from './config/router.config.js';
import type { Hono } from 'hono';

let appInstance: Hono | null = null;

async function getApp(env: Record<string, string>): Promise<Hono> {
  if (appInstance) {
    return appInstance;
  }

  const routerConfig = loadRouterConfig(env);

  appInstance = await createApp({
    fetchClient: new WorkerFetchClient(),
    serveStaticFiles: false,
    routerConfig,
  });

  return appInstance;
}

export default {
  async fetch(
    request: Request,
    env: Record<string, string>,
    ctx: any,
  ): Promise<Response> {
    const app = await getApp(env);
    return app.fetch(request, env, ctx);
  },
};
