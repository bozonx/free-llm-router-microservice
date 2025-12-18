import {
  registerDecorator,
  type ValidationOptions,
  type ValidationArguments,
} from 'class-validator';
import type { ToolChoice } from '../../providers/interfaces/tools.interface.js';

/**
 * Custom validator for tool_choice field
 * Validates that tool_choice is either 'auto', 'none', or a valid function selection object
 */
export function IsValidToolChoice(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidToolChoice',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any): boolean {
          if (value === undefined || value === null) {
            return true; // Optional field
          }

          // String values: 'auto' or 'none'
          if (typeof value === 'string') {
            return value === 'auto' || value === 'none';
          }

          // Object value: { type: 'function', function: { name: string } }
          if (typeof value === 'object' && value !== null) {
            return (
              value.type === 'function' &&
              typeof value.function === 'object' &&
              value.function !== null &&
              typeof value.function.name === 'string' &&
              value.function.name.length > 0
            );
          }

          return false;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be "auto", "none", or { type: "function", function: { name: string } }`;
        },
      },
    });
  };
}
