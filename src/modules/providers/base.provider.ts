import { Logger } from '@nestjs/common';
import type { HttpService } from '@nestjs/axios';
import { AxiosError, isAxiosError } from 'axios';
import type {
  LlmProvider,
  ChatCompletionParams,
  ChatCompletionResult,
} from './interfaces/provider.interface.js';

/**
 * Provider configuration
 */
export interface BaseProviderConfig {
  /**
   * API key
   */
  apiKey: string;

  /**
   * Base URL
   */
  baseUrl: string;

  /**
   * Request timeout in milliseconds
   */
  timeout: number;
}

/**
 * HTTP error response
 */
export interface HttpErrorResponse {
  /**
   * HTTP status code
   */
  statusCode: number;

  /**
   * Error message
   */
  message: string;

  /**
   * Error code (if available)
   */
  code?: string;
}

/**
 * Abstract base class for LLM providers
 */
export abstract class BaseProvider implements LlmProvider {
  protected readonly logger: Logger;

  constructor(
    protected readonly httpService: HttpService,
    protected readonly config: BaseProviderConfig,
  ) {
    this.logger = new Logger(this.constructor.name);
  }

  public abstract get name(): string;

  public abstract chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult>;

  /**
   * Handle HTTP errors and convert to standard error response
   */
  protected handleHttpError(error: unknown): HttpErrorResponse {
    if (isAxiosError(error)) {
      const statusCode = error.response?.status ?? 500;
      const message =
        error.response?.data?.error?.message ??
        error.response?.data?.message ??
        error.message ??
        'Unknown error';
      const code = error.response?.data?.error?.code ?? error.code;

      this.logger.error(
        `HTTP error: ${statusCode} - ${message}`,
        error.response?.data ?? error.message,
      );

      return {
        statusCode,
        message,
        code,
      };
    }

    this.logger.error('Unknown error type', error);
    return {
      statusCode: 500,
      message: String(error),
    };
  }

  /**
   * Check if error is a rate limit error (429)
   */
  protected isRateLimitError(error: HttpErrorResponse): boolean {
    return error.statusCode === 429;
  }

  /**
   * Check if error is a server error (5xx)
   */
  protected isServerError(error: HttpErrorResponse): boolean {
    return error.statusCode >= 500 && error.statusCode < 600;
  }

  /**
   * Check if error is a timeout error
   */
  protected isTimeoutError(error: HttpErrorResponse): boolean {
    return error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED';
  }

  /**
   * Check if error is retryable (rate limit, server error, or timeout)
   */
  protected isRetryableError(error: HttpErrorResponse): boolean {
    return this.isRateLimitError(error) || this.isServerError(error) || this.isTimeoutError(error);
  }
}
