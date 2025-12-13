import { BaseValidator } from './config-validator.js';
import { ProviderValidator } from './provider-validator.js';
import { RoutingValidator } from './routing-validator.js';
import { CircuitBreakerValidator } from './circuit-breaker-validator.js';
import { RateLimitingValidator } from './rate-limiting-validator.js';
import type { RouterConfig } from '../router-config.interface.js';

export class RouterConfigValidator extends BaseValidator<RouterConfig> {
  private readonly providerValidator: ProviderValidator = new ProviderValidator();
  private readonly routingValidator: RoutingValidator = new RoutingValidator();
  private readonly circuitBreakerValidator: CircuitBreakerValidator = new CircuitBreakerValidator();
  private readonly rateLimitingValidator: RateLimitingValidator = new RateLimitingValidator();

  validate(value: unknown, path = 'RouterConfig'): asserts value is RouterConfig {
    this.assertType(value, 'object', path);

    const config = value as Record<string, unknown>;

    this.assertString(config.modelsFile, `${path}.modelsFile`);
    this.providerValidator.validate(config.providers, `${path}.providers`);
    this.routingValidator.validate(config.routing, `${path}.routing`);
    this.circuitBreakerValidator.validate(config.circuitBreaker, `${path}.circuitBreaker`);
    this.rateLimitingValidator.validate(config.rateLimiting, `${path}.rateLimiting`);

    if (config.modelOverrides !== undefined) {
      this.validateModelOverrides(config.modelOverrides, `${path}.modelOverrides`);
    }
  }

  private validateModelOverrides(value: unknown, path: string): void {
    this.assertArray(value, path);

    const overrides = value as unknown[];

    for (const [index, override] of overrides.entries()) {
      this.validateModelOverride(override, `${path}[${index}]`);
    }
  }

  private validateModelOverride(value: unknown, path: string): void {
    this.assertType(value, 'object', path);

    const override = value as Record<string, unknown>;

    this.assertString(override.name, `${path}.name`);

    if (override.provider !== undefined) {
      this.assertString(override.provider, `${path}.provider`);
    }

    if (override.model !== undefined) {
      this.assertString(override.model, `${path}.model`);
    }

    if (override.priority !== undefined) {
      this.assertNumber(override.priority, `${path}.priority`);
    }

    if (override.weight !== undefined) {
      this.assertNumber(override.weight, `${path}.weight`);
    }

    if (override.tags !== undefined) {
      this.assertArray(override.tags, `${path}.tags`);
    }

    if (override.contextSize !== undefined) {
      this.assertNumber(override.contextSize, `${path}.contextSize`);
    }

    if (override.maxOutputTokens !== undefined) {
      this.assertNumber(override.maxOutputTokens, `${path}.maxOutputTokens`);
    }

    if (override.speedTier !== undefined) {
      this.assertString(override.speedTier, `${path}.speedTier`);
    }

    if (override.available !== undefined) {
      this.assertBoolean(override.available, `${path}.available`);
    }

    if (override.maxConcurrent !== undefined) {
      this.assertNumber(override.maxConcurrent, `${path}.maxConcurrent`);
    }
  }
}
