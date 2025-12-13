import { describe, it, expect, beforeEach } from '@jest/globals';
import { RateLimitingValidator } from '../../../src/config/validators/rate-limiting-validator.js';
import { ConfigValidationError } from '../../../src/config/validators/config-validator.js';

describe('RateLimitingValidator', () => {
  let validator: RateLimitingValidator;

  beforeEach(() => {
    validator = new RateLimitingValidator();
  });

  describe('valid configurations', () => {
    it('should pass for undefined (optional)', () => {
      expect(() => validator.validate(undefined, 'rateLimiting')).not.toThrow();
    });

    it('should pass for minimal config', () => {
      const config = { enabled: false };
      expect(() => validator.validate(config, 'rateLimiting')).not.toThrow();
    });

    it('should pass for full valid config', () => {
      const config = {
        enabled: true,
        global: { requestsPerMinute: 100 },
        perClient: { enabled: true, requestsPerMinute: 20, burstSize: 5 },
        perModel: { enabled: true, requestsPerMinute: 30 },
      };
      expect(() => validator.validate(config, 'rateLimiting')).not.toThrow();
    });

    it('should pass for config without burstSize', () => {
      const config = {
        enabled: true,
        perClient: { enabled: true, requestsPerMinute: 20 },
      };
      expect(() => validator.validate(config, 'rateLimiting')).not.toThrow();
    });

    it('should pass for zero requestsPerMinute', () => {
      const config = {
        enabled: true,
        global: { requestsPerMinute: 0 },
      };
      expect(() => validator.validate(config, 'rateLimiting')).not.toThrow();
    });
  });

  describe('invalid configurations', () => {
    it('should reject non-object', () => {
      expect(() => validator.validate('invalid', 'rateLimiting')).toThrow(ConfigValidationError);
    });

    it('should reject invalid enabled type', () => {
      const config = { enabled: 'true' };
      expect(() => validator.validate(config, 'rateLimiting')).toThrow(ConfigValidationError);
    });

    it('should reject global with invalid requestsPerMinute', () => {
      const config = {
        global: { requestsPerMinute: 'high' },
      };
      expect(() => validator.validate(config, 'rateLimiting')).toThrow(ConfigValidationError);
    });

    it('should reject global with negative requestsPerMinute', () => {
      const config = {
        global: { requestsPerMinute: -1 },
      };
      expect(() => validator.validate(config, 'rateLimiting')).toThrow(/must be >= 0/);
    });

    it('should reject perClient with missing requestsPerMinute', () => {
      const config = {
        perClient: { enabled: true },
      };
      expect(() => validator.validate(config, 'rateLimiting')).toThrow(ConfigValidationError);
    });

    it('should reject perClient with invalid burstSize', () => {
      const config = {
        perClient: { enabled: true, requestsPerMinute: 20, burstSize: 'large' },
      };
      expect(() => validator.validate(config, 'rateLimiting')).toThrow(ConfigValidationError);
    });

    it('should reject perClient with negative burstSize', () => {
      const config = {
        perClient: { enabled: true, requestsPerMinute: 20, burstSize: -5 },
      };
      expect(() => validator.validate(config, 'rateLimiting')).toThrow(/must be >= 0/);
    });

    it('should reject perModel with missing requestsPerMinute', () => {
      const config = {
        perModel: { enabled: true },
      };
      expect(() => validator.validate(config, 'rateLimiting')).toThrow(ConfigValidationError);
    });

    it('should reject perModel with invalid enabled type', () => {
      const config = {
        perModel: { enabled: 1, requestsPerMinute: 30 },
      };
      expect(() => validator.validate(config, 'rateLimiting')).toThrow(ConfigValidationError);
    });
  });
});
