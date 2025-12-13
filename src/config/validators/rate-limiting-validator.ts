import { BaseValidator } from './config-validator.js';
import type { RouterConfig } from '../router-config.interface.js';

export class RateLimitingValidator extends BaseValidator<RouterConfig['rateLimiting']> {
  public validate(value: unknown, path: string): asserts value is RouterConfig['rateLimiting'] {
    if (value === undefined) {
      return;
    }

    this.assertType(value, 'object', path);

    const rl = value;

    if (rl.enabled !== undefined) {
      this.assertBoolean(rl.enabled, `${path}.enabled`);
    }

    if (rl.global !== undefined) {
      this.validateGlobal(rl.global, `${path}.global`);
    }

    if (rl.perClient !== undefined) {
      this.validatePerClient(rl.perClient, `${path}.perClient`);
    }

    if (rl.perModel !== undefined) {
      this.validatePerModel(rl.perModel, `${path}.perModel`);
    }
  }

  private validateGlobal(value: unknown, path: string): void {
    this.assertType(value, 'object', path);
    const global = value;
    this.assertNumber(global.requestsPerMinute, `${path}.requestsPerMinute`, 0);
  }

  private validatePerClient(value: unknown, path: string): void {
    this.assertType(value, 'object', path);
    const perClient = value;

    if (perClient.enabled !== undefined) {
      this.assertBoolean(perClient.enabled, `${path}.enabled`);
    }

    this.assertNumber(perClient.requestsPerMinute, `${path}.requestsPerMinute`, 0);

    if (perClient.burstSize !== undefined) {
      this.assertNumber(perClient.burstSize, `${path}.burstSize`, 0);
    }
  }

  private validatePerModel(value: unknown, path: string): void {
    this.assertType(value, 'object', path);
    const perModel = value;

    if (perModel.enabled !== undefined) {
      this.assertBoolean(perModel.enabled, `${path}.enabled`);
    }

    this.assertNumber(perModel.requestsPerMinute, `${path}.requestsPerMinute`, 0);
  }
}
