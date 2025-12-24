import { Logger } from '@nestjs/common';
import type { HttpService } from '@nestjs/axios';
import { isAxiosError } from 'axios';
import type {
  LlmProvider,
  ChatCompletionParams,
  ChatCompletionResult,
  ChatCompletionStreamChunk,
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
   * Request timeout in seconds
   */
  timeoutSecs: number;
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

  /**
   * Provider-specific details (if available)
   */
  details?: string;
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

  public abstract chatCompletionStream(
    params: ChatCompletionParams,
  ): AsyncGenerator<ChatCompletionStreamChunk, void, unknown>;

  /**
   * Handle HTTP errors and convert to standard error response
   */
  protected handleHttpError(error: unknown): HttpErrorResponse {
    if (isAxiosError(error)) {
      const statusCode = error.response?.status ?? 500;

      const truncate = (value: string, maxLen = 500): string =>
        value.length > maxLen ? `${value.slice(0, maxLen)}...` : value;

      const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

      const extractString = (value: unknown): string | undefined => {
        if (typeof value === 'string') {
          const normalized = normalizeText(value);
          return normalized ? truncate(normalized) : undefined;
        }
        return undefined;
      };

      const responseData = error.response?.data as unknown;

      const responseDataObj =
        responseData && typeof responseData === 'object'
          ? (responseData as Record<string, unknown>)
          : undefined;

      const errorObj =
        responseDataObj && responseDataObj.error && typeof responseDataObj.error === 'object'
          ? (responseDataObj.error as Record<string, unknown>)
          : undefined;

      const metadataObj =
        errorObj && errorObj.metadata && typeof errorObj.metadata === 'object'
          ? (errorObj.metadata as Record<string, unknown>)
          : undefined;

      const extractedMessage =
        extractString(responseData) ??
        extractString(errorObj?.message) ??
        extractString(responseDataObj?.message) ??
        extractString((responseDataObj?.error as unknown) ?? undefined) ??
        extractString(error.message) ??
        'Unknown error';

      const extractedDetails =
        extractString(metadataObj?.raw) ??
        extractString(metadataObj?.details) ??
        extractString(errorObj?.details) ??
        extractString(responseDataObj?.details);

      const message = extractedDetails
        ? `${extractedMessage} - ${extractedDetails}`
        : extractedMessage;

      const code = (typeof errorObj?.code === 'string' ? errorObj.code : undefined) ?? error.code;

      if (statusCode >= 500) {
        this.logger.error(
          `HTTP error: ${statusCode} - ${message}`,
          error.response?.data ?? error.message,
        );
      } else {
        this.logger.warn(`HTTP error: ${statusCode} - ${message}`);
      }

      return {
        statusCode,
        message,
        code,
        details: extractedDetails,
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

  /**
   * Map finish reason to standard format
   * Common implementation for all providers
   */
  protected mapFinishReason(reason: string): 'stop' | 'length' | 'content_filter' | 'tool_calls' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      case 'tool_calls':
        return 'tool_calls';
      default:
        this.logger.warn(`Unknown finish reason: ${reason}, defaulting to 'stop'`);
        return 'stop';
    }
  }

  /**
   * Handle content field when tool calls are present
   * According to OpenAI spec, content should be null when tool_calls are present
   */
  protected handleContentWithToolCalls(content: string | null, toolCalls?: any[]): string | null {
    if (toolCalls && toolCalls.length > 0) {
      return null;
    }
    return content || '';
  }
}
