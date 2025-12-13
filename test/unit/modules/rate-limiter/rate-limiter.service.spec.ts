import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { RateLimiterService } from '../../../../src/modules/rate-limiter/rate-limiter.service.js';
import { ROUTER_CONFIG } from '../../../../src/config/router-config.provider.js';
import type { RouterConfig } from '../../../../src/config/router-config.interface.js';

describe('RateLimiterService', () => {
  let service: RateLimiterService;

  const createMockConfig = (
    overrides: Partial<RouterConfig['rateLimiting']> = {},
  ): RouterConfig => ({
    modelsFile: './models.yaml',
    providers: {
      openrouter: { enabled: true, apiKey: 'test', baseUrl: 'https://test.com' },
    },
    routing: {
      maxRetries: 3,
      rateLimitRetries: 2,
      retryDelay: 100,
      timeoutSecs: 30,
      fallback: { enabled: false, provider: 'deepseek', model: 'deepseek-chat' },
    },
    rateLimiting: {
      enabled: true,
      global: { requestsPerMinute: 10 },
      perClient: { enabled: true, requestsPerMinute: 5, burstSize: 2 },
      perModel: { enabled: true, requestsPerMinute: 8 },
      ...overrides,
    },
  });

  afterEach(() => {
    if (service) {
      service.onModuleDestroy();
    }
    jest.clearAllMocks();
  });

  describe('when rate limiting is disabled', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RateLimiterService,
          { provide: ROUTER_CONFIG, useValue: createMockConfig({ enabled: false }) },
        ],
      }).compile();

      service = module.get<RateLimiterService>(RateLimiterService);
    });

    it('should not be enabled', () => {
      expect(service.isEnabled()).toBe(false);
    });

    it('should always allow requests', () => {
      expect(service.checkGlobal()).toBe(true);
      expect(service.checkClient('client-1')).toBe(true);
      expect(service.checkModel('model-1')).toBe(true);
    });
  });

  describe('when rate limiting is enabled', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [RateLimiterService, { provide: ROUTER_CONFIG, useValue: createMockConfig() }],
      }).compile();

      service = module.get<RateLimiterService>(RateLimiterService);
    });

    it('should be enabled', () => {
      expect(service.isEnabled()).toBe(true);
    });

    describe('global rate limit', () => {
      it('should allow requests within limit', () => {
        for (let i = 0; i < 10; i++) {
          expect(service.checkGlobal()).toBe(true);
        }
      });

      it('should block requests when limit exceeded', () => {
        // Consume all tokens
        for (let i = 0; i < 10; i++) {
          service.checkGlobal();
        }

        // Next request should be blocked
        expect(service.checkGlobal()).toBe(false);
      });
    });

    describe('per-client rate limit', () => {
      it('should track clients separately', () => {
        // Each client has 5 + 2 (burst) = 7 tokens max
        for (let i = 0; i < 7; i++) {
          expect(service.checkClient('client-1')).toBe(true);
        }

        // client-1 exhausted
        expect(service.checkClient('client-1')).toBe(false);

        // client-2 still has tokens
        expect(service.checkClient('client-2')).toBe(true);
      });

      it('should include burst size in initial tokens', () => {
        // requestsPerMinute: 5, burstSize: 2 = 7 initial tokens
        let allowed = 0;
        for (let i = 0; i < 10; i++) {
          if (service.checkClient('client-3')) {
            allowed++;
          }
        }
        expect(allowed).toBe(7);
      });
    });

    describe('per-model rate limit', () => {
      it('should track models separately', () => {
        // Each model has 8 tokens
        for (let i = 0; i < 8; i++) {
          expect(service.checkModel('model-1')).toBe(true);
        }

        // model-1 exhausted
        expect(service.checkModel('model-1')).toBe(false);

        // model-2 still has tokens
        expect(service.checkModel('model-2')).toBe(true);
      });
    });

    describe('checkAll', () => {
      it('should check all limits and return which was hit', () => {
        // Exhaust client limit
        for (let i = 0; i < 7; i++) {
          service.checkClient('client-4');
        }

        const result = service.checkAll('client-4', 'model-3');
        expect(result.allowed).toBe(false);
        expect(result.limitType).toBe('client');
      });

      it('should allow when all limits pass', () => {
        const result = service.checkAll('new-client', 'new-model');
        expect(result.allowed).toBe(true);
        expect(result.limitType).toBeUndefined();
      });
    });

    describe('getRateLimitInfo', () => {
      it('should return rate limit info for headers', () => {
        // Make some requests
        service.checkClient('client-5');
        service.checkClient('client-5');

        const info = service.getRateLimitInfo('client-5');

        expect(info.limit).toBe(5);
        expect(info.remaining).toBe(5); // 7 - 2 = 5
        expect(info.reset).toBeGreaterThan(0);
      });

      it('should include retryAfter when limit exceeded', () => {
        // Exhaust client limit
        for (let i = 0; i < 7; i++) {
          service.checkClient('client-6');
        }

        const info = service.getRateLimitInfo('client-6');

        expect(info.remaining).toBe(0);
        expect(info.retryAfter).toBeGreaterThan(0);
      });

      it('should use global info when no client specified', () => {
        const info = service.getRateLimitInfo();

        expect(info.limit).toBe(10); // global limit
      });
    });

    describe('getConfig', () => {
      it('should return current configuration', () => {
        const config = service.getConfig();

        expect(config.enabled).toBe(true);
        expect(config.global?.requestsPerMinute).toBe(10);
        expect(config.perClient?.requestsPerMinute).toBe(5);
        expect(config.perModel?.requestsPerMinute).toBe(8);
      });
    });
  });

  describe('token bucket refill', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RateLimiterService,
          {
            provide: ROUTER_CONFIG,
            useValue: createMockConfig({
              enabled: true,
              // High rate to make refill fast for testing
              global: { requestsPerMinute: 60000 }, // 1000 tokens per second
              perClient: { enabled: true, requestsPerMinute: 60000 },
            }),
          },
        ],
      }).compile();

      service = module.get<RateLimiterService>(RateLimiterService);
    });

    it('should refill tokens over time', async () => {
      // Consume some tokens
      for (let i = 0; i < 1000; i++) {
        service.checkGlobal();
      }

      // Wait a bit for tokens to refill (at 1000/sec, 10ms = 10 tokens)
      await new Promise(resolve => setTimeout(resolve, 20));

      // Should have some tokens now
      expect(service.checkGlobal()).toBe(true);
    });
  });
});
