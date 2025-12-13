export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export abstract class BaseValidator<T> {
  abstract validate(value: unknown, path: string): asserts value is T;

  protected assertType(
    value: unknown,
    type: string,
    path: string,
  ): asserts value is Record<string, unknown> {
    if (typeof value !== type || value === null) {
      throw new ConfigValidationError(
        `${path} must be ${type === 'object' ? 'an object' : `a ${type}`}`,
      );
    }
  }

  protected assertString(value: unknown, path: string): asserts value is string {
    if (typeof value !== 'string') {
      throw new ConfigValidationError(`${path} must be a string`);
    }
  }

  protected assertNumber(value: unknown, path: string, min?: number): asserts value is number {
    if (typeof value !== 'number') {
      throw new ConfigValidationError(`${path} must be a number`);
    }
    if (min !== undefined && value < min) {
      throw new ConfigValidationError(`${path} must be >= ${min}`);
    }
  }

  protected assertBoolean(value: unknown, path: string): asserts value is boolean {
    if (typeof value !== 'boolean') {
      throw new ConfigValidationError(`${path} must be a boolean`);
    }
  }

  protected assertArray(value: unknown, path: string): asserts value is unknown[] {
    if (!Array.isArray(value)) {
      throw new ConfigValidationError(`${path} must be an array`);
    }
  }

  protected assertEnum<T extends string>(
    value: unknown,
    allowedValues: readonly T[],
    path: string,
  ): asserts value is T {
    if (typeof value !== 'string' || !allowedValues.includes(value as T)) {
      throw new ConfigValidationError(`${path} must be one of: ${allowedValues.join(', ')}`);
    }
  }
}
