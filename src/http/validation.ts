import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { HttpError } from '../common/http-errors.js';

export function validateDto<T extends object>(params: {
  dtoClass: new () => T;
  payload: unknown;
}): T {
  const instance = plainToInstance(params.dtoClass, params.payload);
  const errors = validateSync(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  if (errors.length > 0) {
    const message = errors
      .map(err => {
        if (err.constraints) {
          return Object.values(err.constraints).join(', ');
        }
        return 'Validation error';
      })
      .join('; ');

    throw new HttpError({
      message,
      statusCode: 400,
      body: {
        statusCode: 400,
        message,
        error: 'Bad Request',
      },
    });
  }

  return instance;
}
