import { Injectable, Logger, Inject } from '@nestjs/common';
import { SelectorService } from '../selector/selector.service.js';
import { StateService } from '../state/state.service.js';
import { CircuitBreakerService } from '../state/circuit-breaker.service.js';
import { ShutdownService } from '../shutdown/shutdown.service.js';
import { ROUTER_CONFIG } from '../../config/router-config.provider.js';
import type { ProvidersMap } from '../providers/providers.module.js';
import { PROVIDERS_MAP } from '../providers/providers.module.js';
import type { ChatCompletionRequestDto } from './dto/chat-completion.request.dto.js';
import type { ChatCompletionResponseDto } from './dto/chat-completion.response.dto.js';
import type {
  ChatCompletionResult,
  ChatCompletionStreamChunk,
} from '../providers/interfaces/provider.interface.js';
import type { RouterConfig } from '../../config/router-config.interface.js';
import type { ModelDefinition } from '../models/interfaces/model.interface.js';
import { parseModelInput } from '../selector/utils/model-parser.js';
import { RetryHandlerService } from './services/retry-handler.service.js';
import { RequestBuilderService } from './services/request-builder.service.js';
import { ErrorExtractor, type ErrorInfo } from '../../common/utils/error-extractor.util.js';
import {
  AllModelsFailedError,
  ProviderNotFoundError,
  RequestCancelledError,
} from '../../common/errors/router.errors.js';

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
    private readonly retryHandler: RetryHandlerService,
    private readonly requestBuilder: RequestBuilderService,
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
   * Handle chat completion with streaming (Server-Sent Events)
   * Simplified version: selects first model, no retry/fallback
   */
  public async *chatCompletionStream(
    request: ChatCompletionRequestDto,
    clientSignal?: AbortSignal,
  ): AsyncGenerator<ChatCompletionStreamChunk, void, unknown> {
    // Register request for graceful shutdown tracking
    this.shutdownService.registerRequest();

    try {
      // Combine client signal with shutdown signal
      const abortSignal = this.createCombinedAbortSignal(clientSignal);
      const parsedModel = parseModelInput(request.model);

      // Select first suitable model (no retries for streaming)
      const model = this.selectModel(request, parsedModel, []);
      if (!model) {
        throw new Error('No suitable model found for streaming');
      }

      this.logger.debug(`Streaming with model ${model.name} (${model.provider})`);

      // Get provider
      const provider = this.providersMap.get(model.provider);
      if (!provider) {
        throw new ProviderNotFoundError(model.provider);
      }

      // Build completion params
      const completionParams = this.requestBuilder.buildChatCompletionParams(
        request,
        model.model,
        abortSignal,
      );

      // Stream chunks from provider
      this.stateService.incrementActiveRequests(model.name);
      const startTime = Date.now();

      try {
        for await (const chunk of provider.chatCompletionStream(completionParams)) {
          this.checkAbortSignal(abortSignal);
          yield chunk;
        }

        // Record success
        const latencyMs = Date.now() - startTime;
        this.circuitBreaker.onSuccess(model.name, latencyMs);
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        const errorInfo = ErrorExtractor.extractErrorInfo(error, model);

        if (!ErrorExtractor.isClientError(errorInfo.code)) {
          this.circuitBreaker.onFailure(model.name, errorInfo.code, latencyMs);
        }

        if (ErrorExtractor.isAbortError(error)) {
          throw this.handleAbortError();
        }

        throw error;
      } finally {
        this.stateService.decrementActiveRequests(model.name);
      }
    } finally {
      // Always unregister request when done
      this.shutdownService.unregisterRequest();
    }
  }

  /**
   * Execute chat completion with shutdown abort signal support.
   * This method orchestrates the model selection, retry loop, and fallback logic.
   *
   * @param request The chat completion request
   * @param clientSignal Optional abort signal from the client
   */
  private async executeWithShutdownHandling(
    request: ChatCompletionRequestDto,
    clientSignal?: AbortSignal,
  ): Promise<ChatCompletionResponseDto> {
    // Combine client signal with shutdown signal to handle both cases
    const abortSignal = this.createCombinedAbortSignal(clientSignal);
    const errors: ErrorInfo[] = [];
    const excludedModels: string[] = [];
    let attemptCount = 0;

    const parsedModel = parseModelInput(request.model);

    for (let i = 0; i < this.config.routing.maxModelSwitches; i++) {
      attemptCount++;

      const model = this.selectModel(request, parsedModel, excludedModels);
      if (!model) {
        this.logger.warn('No suitable model found');
        break;
      }

      this.logger.debug(`Attempt ${attemptCount}: Using model ${model.name} (${model.provider})`);

      try {
        const result = await this.executeWithRateLimitRetry({
          model,
          request,
          abortSignal,
        });

        this.logger.debug(
          `Request successful: ${model.name} (${model.provider}) in ${attemptCount} attempt(s)`,
        );

        return this.buildSuccessResponse({
          result,
          model,
          attemptCount,
          errors,
          fallbackUsed: false,
        });
      } catch (error) {
        if (abortSignal.aborted) {
          throw this.handleAbortError();
        }

        // Track models that failed to avoid selecting them again in the next retry
        excludedModels.push(`${model.provider}/${model.name}`);
        const errorInfo = ErrorExtractor.extractErrorInfo(error, model);
        errors.push(errorInfo);

        this.logger.warn(
          `Model ${model.name} (${model.provider}) failed: ${errorInfo.error} (code: ${errorInfo.code ?? 'N/A'})`,
        );

        if (ErrorExtractor.isClientError(errorInfo.code)) {
          this.logger.error('Client error detected, not retrying');
          throw error;
        }
      }
    }

    // If all retries failed, check if fallback is enabled
    if (this.config.routing.fallback.enabled) {
      const fallbackResponse = await this.tryFallback(request, abortSignal, errors, attemptCount);
      if (fallbackResponse) {
        return fallbackResponse;
      }
    }

    throw new AllModelsFailedError(attemptCount, errors);
  }

  private async executeWithRateLimitRetry(params: {
    model: ModelDefinition;
    request: ChatCompletionRequestDto;
    abortSignal: AbortSignal;
  }): Promise<ChatCompletionResult> {
    const { model, request, abortSignal } = params;

    this.stateService.incrementActiveRequests(model.name);

    try {
      return await this.retryHandler.executeWithRetry({
        operation: async () => this.executeSingleRequest(model, request, abortSignal),
        maxRetries: this.config.routing.maxSameModelRetries,
        retryDelay: this.config.routing.retryDelay,
        shouldRetry: error => {
          const errorInfo = ErrorExtractor.extractErrorInfo(error, model);
          // Retry on rate limit (429) or retryable network errors (ENETUNREACH, ECONNRESET)
          return (
            ErrorExtractor.isRateLimitError(errorInfo.code) ||
            ErrorExtractor.isRetryableNetworkError(error)
          );
        },
        onRetry: (attempt, error) => {
          const isNetworkError = ErrorExtractor.isRetryableNetworkError(error);
          const errorType = isNetworkError ? 'Network error' : 'Rate limit';
          this.logger.debug(
            `${errorType} for ${model.name}, retrying (attempt ${attempt}/${this.config.routing.maxSameModelRetries})`,
          );
        },
      });
    } finally {
      this.stateService.decrementActiveRequests(model.name);
    }
  }

  private async executeFallback(
    request: ChatCompletionRequestDto,
    abortSignal: AbortSignal,
  ): Promise<{ result: ChatCompletionResult; model: ModelDefinition }> {
    this.logger.debug(
      `Executing fallback: ${this.config.routing.fallback.provider}/${this.config.routing.fallback.model}`,
    );

    const fallbackProvider = this.providersMap.get(this.config.routing.fallback.provider);
    if (!fallbackProvider) {
      throw new ProviderNotFoundError(this.config.routing.fallback.provider);
    }

    const completionParams = this.requestBuilder.buildChatCompletionParams(
      request,
      this.config.routing.fallback.model,
      abortSignal,
    );

    const result = await fallbackProvider.chatCompletion(completionParams);
    this.stateService.recordFallbackUsage();

    this.logger.debug('Fallback request successful');

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
            tool_calls: result.toolCalls,
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

  private createCombinedAbortSignal(clientSignal?: AbortSignal): AbortSignal {
    const shutdownSignal = this.shutdownService.createRequestSignal();
    // If client provides a signal, we want to abort if EITHER the client cancels OR the server shuts down
    return clientSignal ? AbortSignal.any([shutdownSignal, clientSignal]) : shutdownSignal;
  }

  private selectModel(
    request: ChatCompletionRequestDto,
    parsedModel: ReturnType<typeof parseModelInput>,
    excludedModels: string[],
  ): ModelDefinition | null {
    return this.selectorService.selectNextModel(
      {
        models: parsedModel.models,
        allowAutoFallback: parsedModel.allowAutoFallback,
        tags: request.tags,
        type: request.type,
        minContextSize: request.min_context_size,
        jsonResponse: request.json_response,
        preferFast: request.prefer_fast,
        minSuccessRate: request.min_success_rate,
      },
      excludedModels,
    );
  }

  private async executeSingleRequest(
    model: ModelDefinition,
    request: ChatCompletionRequestDto,
    abortSignal: AbortSignal,
  ): Promise<ChatCompletionResult> {
    this.checkAbortSignal(abortSignal);

    const provider = this.providersMap.get(model.provider);
    if (!provider) {
      throw new ProviderNotFoundError(model.provider);
    }

    const completionParams = this.requestBuilder.buildChatCompletionParams(
      request,
      model.model,
      abortSignal,
    );

    const startTime = Date.now();

    try {
      const result = await provider.chatCompletion(completionParams);
      const latencyMs = Date.now() - startTime;
      this.circuitBreaker.onSuccess(model.name, latencyMs);
      return result;
    } catch (error) {
      if (ErrorExtractor.isAbortError(error)) {
        throw this.handleAbortError();
      }

      const latencyMs = Date.now() - startTime;
      const errorInfo = ErrorExtractor.extractErrorInfo(error, model);

      // Only record in Circuit Breaker if NOT a client error (4xx except 429)
      // Client errors (400, 401, 403, etc.) are problems with the request/config,
      // not with the model itself, so they should not affect the circuit breaker
      if (!ErrorExtractor.isClientError(errorInfo.code)) {
        this.circuitBreaker.onFailure(model.name, errorInfo.code, latencyMs);
      }

      throw error;
    }
  }

  private checkAbortSignal(abortSignal: AbortSignal): void {
    if (abortSignal.aborted) {
      throw this.handleAbortError();
    }
  }

  private handleAbortError(): Error {
    const reason = this.shutdownService.shuttingDown ? 'shutdown' : 'client';
    return new RequestCancelledError(reason);
  }

  private async tryFallback(
    request: ChatCompletionRequestDto,
    abortSignal: AbortSignal,
    errors: ErrorInfo[],
    attemptCount: number,
  ): Promise<ChatCompletionResponseDto | null> {
    this.logger.warn('All free models failed, attempting fallback to paid model');

    try {
      const fallbackResult = await this.executeFallback(request, abortSignal);
      return this.buildSuccessResponse({
        result: fallbackResult.result,
        model: fallbackResult.model,
        attemptCount: attemptCount + 1,
        errors,
        fallbackUsed: true,
      });
    } catch (error) {
      const fallbackError = ErrorExtractor.extractErrorInfo(error, {
        name: this.config.routing.fallback.model,
        provider: this.config.routing.fallback.provider,
      });
      errors.push(fallbackError);
      this.logger.error(`Fallback model failed: ${fallbackError.error}`);
      return null;
    }
  }
}
