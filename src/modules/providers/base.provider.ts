import { Logger } from '../../common/logger.js';
import { HttpError } from '../../common/http-errors.js';
import type { FetchClient } from '../../http/fetch-client.js';
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

  /**
   * Provider request id / correlation id returned in response headers (if available)
   */
  providerRequestId?: string;

  /**
   * Truncated provider response body (if available)
   */
  providerResponse?: string;
}

/**
 * Abstract base class for LLM providers
 */
export abstract class BaseProvider implements LlmProvider {
  protected readonly logger: Logger;

  constructor(
    protected readonly fetchClient: FetchClient,
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
    if (error instanceof HttpError) {
      return {
        statusCode: error.statusCode,
        message: error.message,
      };
    }

    const err = error instanceof Error ? error : new Error(String(error));

    const anyErr = err as Error & { code?: string; statusCode?: number; status?: number };
    const statusCode =
      typeof anyErr.statusCode === 'number'
        ? anyErr.statusCode
        : typeof anyErr.status === 'number'
          ? anyErr.status
          : 500;

    return {
      statusCode,
      message: err.message || 'Unknown error',
      code: anyErr.code,
    };
  }

  protected throwProviderHttpError(params: {
    statusCode: number;
    message: string;
    code?: string;
    details?: string;
    providerRequestId?: string;
    providerResponse?: string;
  }): never {
    throw new HttpError({
      statusCode: params.statusCode,
      message: params.message,
      body: {
        error: {
          message: params.message,
          type: 'provider_error',
          code: params.code,
          details: params.details,
          provider_request_id: params.providerRequestId,
          provider_response: params.providerResponse,
        },
      },
    });
  }

  protected async parseErrorResponse(response: Response): Promise<HttpErrorResponse> {
    const statusCode = response.status || 500;

    const truncate = (value: string, maxLen = 500): string =>
      value.length > maxLen ? `${value.slice(0, maxLen)}...` : value;

    const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

    const providerRequestId =
      response.headers.get('x-request-id') ??
      response.headers.get('request-id') ??
      response.headers.get('x-amzn-requestid') ??
      response.headers.get('cf-ray') ??
      undefined;

    let rawText: string | undefined;
    try {
      rawText = await response.text();
    } catch {
      rawText = undefined;
    }

    const providerResponse = rawText ? truncate(normalizeText(rawText), 1000) : undefined;

    let extractedMessage: string | undefined;
    let extractedDetails: string | undefined;
    let code: string | undefined;

    if (rawText) {
      try {
        const parsed = JSON.parse(rawText) as unknown;
        if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          const errObj =
            obj.error && typeof obj.error === 'object' && obj.error !== null
              ? (obj.error as Record<string, unknown>)
              : undefined;

          extractedMessage =
            (typeof errObj?.message === 'string' ? errObj.message : undefined) ??
            (typeof obj.message === 'string' ? obj.message : undefined) ??
            (typeof obj.error_description === 'string' ? obj.error_description : undefined);

          extractedDetails = typeof errObj?.details === 'string' ? errObj.details : undefined;
          code = typeof errObj?.code === 'string' ? errObj.code : undefined;
        }
      } catch {
        // ignore json parse
      }
    }

    const message = truncate(
      normalizeText(extractedMessage ?? response.statusText ?? 'Unknown error'),
      500,
    );

    return {
      statusCode,
      message,
      code,
      details: extractedDetails,
      providerRequestId: providerRequestId ? truncate(providerRequestId, 200) : undefined,
      providerResponse,
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
