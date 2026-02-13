import { serve } from '@hono/node-server';
import { Logger } from './common/logger.js';
import { createApp } from './http/create-app.js';
import { NodeFetchClient } from './adapters/node/node-fetch-client.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';

  const app = await createApp({
    fetchClient: new NodeFetchClient(),
    serveStaticFiles: true,
  });

  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  logger.log(`Service is running on: http://${host}:${port}`);

  const shutdown = async (signal: string) => {
    logger.warn(`Shutdown signal received: ${signal}`);
    server.close();
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void bootstrap();
