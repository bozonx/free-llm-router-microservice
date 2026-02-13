import type { RedisConfig } from '../../../config/router-config.interface.js';
import type { StateStorage } from '../interfaces/state-storage.interface.js';
import { InMemoryStateStorage } from './in-memory-state-storage.js';
import { RedisStateStorage } from './redis-state-storage.js';
import { UpstashRedisStateStorage } from './upstash-redis-state-storage.js';
import { Logger } from '../../../common/logger.js';

/**
 * Factory for creating the appropriate StateStorage based on configuration
 */
export class StateStorageFactory {
  private static readonly logger = new Logger('StateStorageFactory');

  public static create(config?: RedisConfig): StateStorage {
    const type = config?.type || 'memory';

    switch (type) {
      case 'redis':
        if (!config?.url) {
          this.logger.warn('Redis URL not provided, falling back to memory storage');
          return new InMemoryStateStorage();
        }
        this.logger.log(`Using Redis state storage: ${config.url}`);
        return new RedisStateStorage(config.url);

      case 'upstash':
        if (!config?.url || !config?.token) {
          this.logger.warn('Upstash URL or token not provided, falling back to memory storage');
          return new InMemoryStateStorage();
        }
        this.logger.log(`Using Upstash Redis state storage: ${config.url}`);
        return new UpstashRedisStateStorage(config.url, config.token);

      case 'memory':
      default:
        this.logger.log('Using in-memory state storage');
        return new InMemoryStateStorage();
    }
  }
}
