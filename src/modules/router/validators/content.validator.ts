import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ChatContentPartDto } from '../dto/chat-completion.request.dto.js';

/**
 * Validator for message content field
 * Accepts: string, array of ChatContentPartDto, or null
 */
@ValidatorConstraint({ name: 'isValidContent', async: false })
export class IsValidContentConstraint implements ValidatorConstraintInterface {
  validate(content: any, args: ValidationArguments): boolean {
    // Allow null
    if (content === null) {
      return true;
    }

    // Allow string
    if (typeof content === 'string') {
      return true;
    }

    // Allow array of content parts
    if (Array.isArray(content)) {
      return content.every(part => {
        if (typeof part !== 'object' || part === null) {
          return false;
        }

        // Check type field
        if (part.type !== 'text' && part.type !== 'image_url') {
          return false;
        }

        // Validate text part
        if (part.type === 'text') {
          return typeof part.text === 'string';
        }

        // Validate image_url part
        if (part.type === 'image_url') {
          if (!part.image_url || typeof part.image_url !== 'object') {
            return false;
          }
          if (typeof part.image_url.url !== 'string') {
            return false;
          }
          // detail is optional
          if (
            part.image_url.detail !== undefined &&
            !['auto', 'high', 'low'].includes(part.image_url.detail)
          ) {
            return false;
          }
          return true;
        }

        return false;
      });
    }

    return false;
  }

  defaultMessage(args: ValidationArguments): string {
    return 'content must be a string, an array of content parts (text or image_url), or null';
  }
}

/**
 * Decorator for validating message content
 */
export function IsValidContent(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidContentConstraint,
    });
  };
}
