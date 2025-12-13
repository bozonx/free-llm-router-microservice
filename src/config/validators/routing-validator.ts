import { BaseValidator } from './config-validator.js';
import type { RouterConfig } from '../router-config.interface.js';

export class RoutingValidator extends BaseValidator<RouterConfig['routing']> {
  validate(value: unknown, path: string): asserts value is RouterConfig['routing'] {
    this.assertType(value, 'object', path);

    const routing = value as Record<string, unknown>;

    this.assertNumber(routing.maxRetries, `${path}.maxRetries`, 0);
    this.assertNumber(routing.rateLimitRetries, `${path}.rateLimitRetries`, 0);
    this.assertNumber(routing.retryDelay, `${path}.retryDelay`, 0);
    this.assertNumber(routing.timeoutSecs, `${path}.timeoutSecs`, 0);

    this.validateFallback(routing.fallback, `${path}.fallback`);
  }

  private validateFallback(value: unknown, path: string): void {
    this.assertType(value, 'object', path);

    const fallback = value as Record<string, unknown>;

    this.assertBoolean(fallback.enabled, `${path}.enabled`);
    this.assertString(fallback.provider, `${path}.provider`);
    this.assertString(fallback.model, `${path}.model`);
  }
}
