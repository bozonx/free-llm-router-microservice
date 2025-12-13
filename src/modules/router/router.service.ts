import { Injectable, Logger, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SelectorService } from '../selector/selector.service.js';
import { StateService } from '../state/state.service.js';
import { CircuitBreakerService } from '../state/circuit-breaker.service.js';
import { ShutdownService } from '../shutdown/shutdown.service.js';
import { RETRY_JITTER_PERCENT } from '../../config/router.config.js';
import { ROUTER_CONFIG } from '../../config/router-config.provider.js';
import type { ProvidersMap } from '../providers/providers.module.js';
import { PROVIDERS_MAP } from '../providers/providers.module.js';
import type { ChatCompletionRequestDto } from './dto/chat-completion.request.dto.js';
import type { ChatCompletionResponseDto } from './dto/chat-completion.response.dto.js';
import type {
  ChatCompletionParams,
  ChatCompletionResult,
} from '../providers/interfaces/provider.interface.js';
import type { RouterConfig } from '../../config/router-config.interface.js';
import type { ModelDefinition } from '../models/interfaces/model.interface.js';

/**
 * Error information for retry tracking
 */
interface ErrorInfo {
  provider: string;
  model: string;
  error: string;
  code?: number;
}

/**
 * Router service for handling chat completion requests with fallback logic
 */
@Injectable()
export class RouterService {
  private readonly logger = new Logger(RouterService.name);

  constructor(
    private readonly selectorService: SelectorService,
    private readonly stateService: StateService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly shutdownService: ShutdownService,
    @Inject(PROVIDERS_MAP) private readonly providersMap: ProvidersMap,
    @Inject(ROUTER_CONFIG) private readonly config: RouterConfig,
  ) { }

  /**
   * Handle chat completion request with retry and fallback logic
   */
  public async chatCompletion(
    request: ChatCompletionRequestDto,
    clientSignal?: AbortSignal,
  ): Promise<ChatCompletionResponseDto> {
    // Register request for graceful shutdown tracking
    this.shutdownService.registerRequest();

    try {
      return await this.executeWithShutdownHandling(request, clientSignal);
    } finally {
      // Always unregister request when done
      this.shutdownService.unregisterRequest();
    }
  }

  /**
   * Execute chat completion with shutdown abort signal support
   */
  private async executeWithShutdownHandling(
    request: ChatCompletionRequestDto,
    clientSignal?: AbortSignal,
  ): Promise<ChatCompletionResponseDto> {
    const shutdownSignal = this.shutdownService.createRequestSignal();
    // Combine signals: abort if either shutdown occurs or client cancels
    const abortSignal = clientSignal
      ? AbortSignal.any([shutdownSignal, clientSignal])
      : shutdownSignal;
    const errors: ErrorInfo[] = [];
    const excludedModels: string[] = [];
    let attemptCount = 0;

    // Try free models with retries
    for (let i = 0; i < this.config.routing.maxRetries; i++) {
      attemptCount++;

      // Select a model
      const model = this.selectorService.selectNextModel(
        {
          model: request.model,
          tags: request.tags,
          type: request.type,
          minContextSize: request.min_context_size,
          jsonResponse: request.json_response,
          preferFast: request.prefer_fast,
          minSuccessRate: request.min_success_rate,
        },
        excludedModels,
      );

      if (!model) {
        this.logger.warn('No suitable model found');
        break;
      }

      this.logger.debug(`Attempt ${attemptCount}: Using model ${model.name} (${model.provider})`);

      // Try to execute request with rate limit retries
      try {
        const result = await this.executeWithRateLimitRetry({
          model,
          request,
          errors,
          abortSignal,
        });

        // Success!
        return this.buildSuccessResponse({
          result,
          model,
          attemptCount,
          errors,
          fallbackUsed: false,
        });
      } catch (error) {
        // Stop if request was cancelled
        if (abortSignal.aborted) {
          throw error;
        }

        // Add model to exclusion list
        excludedModels.push(model.name);

        const errorInfo = this.extractErrorInfo(error, model);
        errors.push(errorInfo);

        this.logger.warn(
          `Model ${model.name} failed: ${errorInfo.error} (code: ${errorInfo.code ?? 'N/A'})`,
        );

        // Don't retry on client errors (4xx except 429)
        if (
          errorInfo.code &&
          errorInfo.code >= 400 &&
          errorInfo.code < 500 &&
          errorInfo.code !== 429
        ) {
          this.logger.error('Client error detected, not retrying');
          throw error;
        }
      }
    }

    // All free models exhausted, try fallback if enabled
    if (this.config.routing.fallback.enabled) {
      attemptCount++;
      this.logger.warn('All free models failed, attempting fallback to paid model');

      try {
        const fallbackResult = await this.executeFallback(request, errors, abortSignal);

        return this.buildSuccessResponse({
          result: fallbackResult.result,
          model: fallbackResult.model,
          attemptCount,
          errors,
          fallbackUsed: true,
        });
      } catch (error) {
        const fallbackError = this.extractErrorInfo(error, {
          name: this.config.routing.fallback.model,
          provider: this.config.routing.fallback.provider,
        } as ModelDefinition);
        errors.push(fallbackError);
        this.logger.error(`Fallback model failed: ${fallbackError.error}`);
      }
    }

    // Everything failed
    throw new Error(
      `All models failed after ${attemptCount} attempts. Errors: ${JSON.stringify(errors)}`,
    );
  }

  /**
   * Execute request with rate limit retry logic.
   * Tracks latency and reports success/failure to Circuit Breaker.
   */
  private async executeWithRateLimitRetry(params: {
    model: ModelDefinition;
    request: ChatCompletionRequestDto;
    errors: ErrorInfo[];
    abortSignal: AbortSignal;
  }) {
    const { model, request, abortSignal } = params;

    // Track active requests
    this.stateService.incrementActiveRequests(model.name);

    try {
      for (
        let rateLimitAttempt = 0;
        rateLimitAttempt <= this.config.routing.rateLimitRetries;
        rateLimitAttempt++
      ) {
        // Check if shutdown abort was triggered
        if (abortSignal.aborted) {
          if (this.shutdownService.shuttingDown) {
            throw new ServiceUnavailableException(
              'Request cancelled: server is shutting down',
            );
          }
          throw new Error('Request cancelled by client');
        }

        const startTime = Date.now();

        try {
          const provider = this.providersMap.get(model.provider);
          if (!provider) {
            throw new Error(`Provider ${model.provider} not found`);
          }

          const completionParams: ChatCompletionParams = {
            model: model.model,
            messages: request.messages.map(msg => ({
              role: msg.role,
              content: msg.content,
            })),
            temperature: request.temperature,
            maxTokens: request.max_tokens,
            topP: request.top_p,
            frequencyPenalty: request.frequency_penalty,
            presencePenalty: request.presence_penalty,
            stop: request.stop,
            jsonMode: request.json_response,
            abortSignal,
          };

          const result = await provider.chatCompletion(completionParams);

          // Record success with latency
          const latencyMs = Date.now() - startTime;
          this.circuitBreaker.onSuccess(model.name, latencyMs);

          return result;
        } catch (error) {
          // Check if this is an abort error from shutdown/client
          if (this.isAbortError(error)) {
            if (this.shutdownService.shuttingDown) {
              throw new ServiceUnavailableException(
                'Request cancelled: server is shutting down',
              );
            }
            throw new Error('Request cancelled by client');
          }

          const latencyMs = Date.now() - startTime;
          const errorInfo = this.extractErrorInfo(error, model);

          // Report failure to Circuit Breaker
          this.circuitBreaker.onFailure(model.name, errorInfo.code, latencyMs);

          // Retry on 429 (rate limit)
          if (errorInfo.code === 429 && rateLimitAttempt < this.config.routing.rateLimitRetries) {
            const delay = this.calculateRetryDelay(this.config.routing.retryDelay);
            this.logger.debug(
              `Rate limit hit for ${model.name}, retrying in ${delay}ms (attempt ${rateLimitAttempt + 1}/${this.config.routing.rateLimitRetries})`,
            );
            await this.sleep(delay);
            continue;
          }

          // Rethrow for other errors or exhausted retries
          throw error;
        }
      }

      throw new Error('Rate limit retries exhausted');
    } finally {
      // Always decrement active requests
      this.stateService.decrementActiveRequests(model.name);
    }
  }

  /**
   * Execute fallback to paid model
   */
  private async executeFallback(
    request: ChatCompletionRequestDto,
    _errors: ErrorInfo[],
    abortSignal: AbortSignal,
  ) {
    const fallbackProvider = this.providersMap.get(this.config.routing.fallback.provider);
    if (!fallbackProvider) {
      throw new Error(`Fallback provider ${this.config.routing.fallback.provider} not found`);
    }

    const completionParams: ChatCompletionParams = {
      model: this.config.routing.fallback.model,
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      temperature: request.temperature,
      maxTokens: request.max_tokens,
      topP: request.top_p,
      frequencyPenalty: request.frequency_penalty,
      presencePenalty: request.presence_penalty,
      stop: request.stop,
      jsonMode: request.json_response,
      abortSignal,
    };

    const result = await fallbackProvider.chatCompletion(completionParams);

    this.stateService.recordFallbackUsage();

    return {
      result,
      model: {
        name: this.config.routing.fallback.model,
        provider: this.config.routing.fallback.provider,
      } as ModelDefinition,
    };
  }

  /**
   * Build success response with metadata
   */
  private buildSuccessResponse(params: {
    result: ChatCompletionResult;
    model: ModelDefinition;
    attemptCount: number;
    errors: ErrorInfo[];
    fallbackUsed: boolean;
  }): ChatCompletionResponseDto {
    const { result, model, attemptCount, errors, fallbackUsed } = params;

    return {
      id: result.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: result.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: result.content,
          },
          finish_reason: result.finishReason,
        },
      ],
      usage: {
        prompt_tokens: result.usage.promptTokens,
        completion_tokens: result.usage.completionTokens,
        total_tokens: result.usage.totalTokens,
      },
      _router: {
        provider: model.provider,
        model_name: model.name,
        attempts: attemptCount,
        fallback_used: fallbackUsed,
        errors: errors.length > 0 ? errors : undefined,
      },
    };
  }

  /**
   * Extract error information from exception
   */
  private extractErrorInfo(error: unknown, model: ModelDefinition): ErrorInfo {
    let errorMessage = 'Unknown error';
    let errorCode: number | undefined;

    const extractCode = (err: any): number | undefined => {
      if (!err || typeof err !== 'object') return undefined;
      // Axios error structure
      if (err.response?.status && typeof err.response.status === 'number') {
        return err.response.status;
      }
      if (err.statusCode && typeof err.statusCode === 'number') {
        return err.statusCode;
      }
      if (err.status && typeof err.status === 'number') {
        return err.status;
      }
      if (err.code && typeof err.code === 'number') {
        return err.code;
      }
      return undefined;
    };

    if (error instanceof Error) {
      errorMessage = error.message;
      // Check wrapped error
      if ((error as any).cause) {
        errorCode = extractCode((error as any).cause);
      }
    } else if (typeof error === 'string') {
      errorMessage = error;
    }

    // If still no code, check the error object itself
    if (errorCode === undefined) {
      errorCode = extractCode(error);
    }

    return {
      provider: model.provider,
      model: model.name,
      error: errorMessage,
      code: errorCode,
    };
  }

  /**
   * Calculate retry delay with jitter
   */
  private calculateRetryDelay(baseDelay: number): number {
    const jitter = (Math.random() - 0.5) * 2 * ((baseDelay * RETRY_JITTER_PERCENT) / 100);
    return Math.max(0, Math.round(baseDelay + jitter));
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Check if error is an abort error (request cancelled due to shutdown)
   */
  private isAbortError(error: unknown): boolean {
    if (error instanceof Error) {
      // Axios uses 'CanceledError' or 'ERR_CANCELED' code
      if (error.name === 'CanceledError' || error.name === 'AbortError') {
        return true;
      }
      if ((error as any).code === 'ERR_CANCELED' || (error as any).code === 'ECONNABORTED') {
        return true;
      }
    }
    return false;
  }
}
