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
  public static extractErrorInfo(error: unknown, model: ModelIdentifier): ErrorInfo {
    const errorMessage = this.extractErrorMessage(error);
    const errorCode = this.extractErrorCode(error);

    return {
      provider: model.provider,
      model: model.name,
      error: errorMessage,
      code: errorCode,
    };
  }

  public static extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Unknown error';
  }

  public static extractErrorCode(error: unknown): number | undefined {
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

  public static isAbortError(error: unknown): boolean {
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

  /**
   * Check if error is a client error (4xx) but NOT rate limit (429) or not found (404).
   * 400-499 errors usually indicate invalid requests and should not be retried.
   * 429 is excluded because it is a rate limit error which MAY be retried.
   * 404 is excluded because it requires special handling (PERMANENTLY_UNAVAILABLE).
   */
  public static isClientError(code?: number): boolean {
    return code !== undefined && code >= 400 && code < 500 && code !== 429 && code !== 404;
  }

  public static isRateLimitError(code?: number): boolean {
    return code === 429;
  }

  /**
   * Check if error is a retryable network error (local network issues).
   * These errors may be temporary and worth retrying on the same model.
   */
  public static isRetryableNetworkError(error: unknown): boolean {
    const code = this.extractNetworkErrorCode(error);
    if (!code) {
      return false;
    }

    // ENETUNREACH - Network unreachable (local network issue)
    // ECONNRESET - Connection reset (may be temporary)
    return code === 'ENETUNREACH' || code === 'ECONNRESET';
  }

  /**
   * Check if error is a provider network error (provider is unavailable).
   * These errors indicate the provider is down and we should switch to another model.
   */
  public static isProviderNetworkError(error: unknown): boolean {
    const code = this.extractNetworkErrorCode(error);
    if (!code) {
      return false;
    }

    // ECONNREFUSED - Connection refused (provider is down)
    // EHOSTUNREACH - Host unreachable (provider is down)
    // ENOTFOUND - DNS lookup failed (provider doesn't exist)
    // ETIMEDOUT - Connection timeout (provider is slow/down)
    return (
      code === 'ECONNREFUSED' ||
      code === 'EHOSTUNREACH' ||
      code === 'ENOTFOUND' ||
      code === 'ETIMEDOUT'
    );
  }

  /**
   * Extract network error code from error object
   */
  private static extractNetworkErrorCode(error: unknown): string | undefined {
    if (!(error instanceof Error)) {
      return undefined;
    }

    const err = error as Error & { code?: string; cause?: { code?: string } };

    if (typeof err.code === 'string') {
      return err.code;
    }

    // Check cause for wrapped errors
    if (err.cause && typeof err.cause.code === 'string') {
      return err.cause.code;
    }

    return undefined;
  }
}
