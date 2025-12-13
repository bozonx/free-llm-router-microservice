export interface ErrorInfo {
  provider: string;
  model: string;
  error: string;
  code?: number;
}

export interface ModelIdentifier {
  name: string;
  provider: string;
}

export class ErrorExtractor {
  static extractErrorInfo(error: unknown, model: ModelIdentifier): ErrorInfo {
    const errorMessage = this.extractErrorMessage(error);
    const errorCode = this.extractErrorCode(error);

    return {
      provider: model.provider,
      model: model.name,
      error: errorMessage,
      code: errorCode,
    };
  }

  static extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Unknown error';
  }

  static extractErrorCode(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    const err = error as Record<string, unknown>;

    if (err.response && typeof err.response === 'object') {
      const response = err.response as Record<string, unknown>;
      if (typeof response.status === 'number') {
        return response.status;
      }
    }

    if (typeof err.statusCode === 'number') {
      return err.statusCode;
    }

    if (typeof err.status === 'number') {
      return err.status;
    }

    if (typeof err.code === 'number') {
      return err.code;
    }

    if (err.cause) {
      return this.extractErrorCode(err.cause);
    }

    return undefined;
  }

  static isAbortError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    if (error.name === 'CanceledError' || error.name === 'AbortError') {
      return true;
    }

    const err = error as Error & { code?: string };
    if (err.code === 'ERR_CANCELED' || err.code === 'ECONNABORTED') {
      return true;
    }

    return false;
  }

  static isClientError(code?: number): boolean {
    return code !== undefined && code >= 400 && code < 500 && code !== 429;
  }

  static isRateLimitError(code?: number): boolean {
    return code === 429;
  }
}
