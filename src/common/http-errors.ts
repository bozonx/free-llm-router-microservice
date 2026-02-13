export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly body?: unknown;

  public constructor(params: { message: string; statusCode: number; body?: unknown }) {
    super(params.message);
    this.name = 'HttpError';
    this.statusCode = params.statusCode;
    this.body = params.body;
  }
}

export class NotFoundError extends HttpError {
  public constructor(message: string) {
    super({ message, statusCode: 404 });
    this.name = 'NotFoundError';
  }
}

export class ServiceUnavailableError extends HttpError {
  public constructor(message: string) {
    super({ message, statusCode: 503 });
    this.name = 'ServiceUnavailableError';
  }
}
