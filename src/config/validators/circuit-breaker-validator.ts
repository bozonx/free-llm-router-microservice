import { BaseValidator } from './config-validator.js';
import type { RouterConfig } from '../router-config.interface.js';

export class CircuitBreakerValidator extends BaseValidator<RouterConfig['circuitBreaker']> {
  validate(value: unknown, path: string): asserts value is RouterConfig['circuitBreaker'] {
    if (value === undefined) {
      return;
    }

    this.assertType(value, 'object', path);

    const cb = value as Record<string, unknown>;

    if (cb.failureThreshold !== undefined) {
      this.assertNumber(cb.failureThreshold, `${path}.failureThreshold`, 1);
    }

    if (cb.cooldownPeriodSecs !== undefined) {
      this.assertNumber(cb.cooldownPeriodSecs, `${path}.cooldownPeriodSecs`, 0);
    }

    if (cb.successThreshold !== undefined) {
      this.assertNumber(cb.successThreshold, `${path}.successThreshold`, 1);
    }

    if (cb.statsWindowSizeMins !== undefined) {
      this.assertNumber(cb.statsWindowSizeMins, `${path}.statsWindowSizeMins`, 0);
    }
  }
}
