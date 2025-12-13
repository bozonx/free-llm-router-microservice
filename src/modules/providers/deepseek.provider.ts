import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BaseProvider, type BaseProviderConfig } from './base.provider.js';
import type {
  ChatCompletionParams,
  ChatCompletionResult,
} from './interfaces/provider.interface.js';

/**
 * DeepSeek API request format (OpenAI-compatible)
 */
interface DeepSeekRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  response_format?: { type: 'json_object' };
}

/**
 * DeepSeek API response format (OpenAI-compatible)
 */
interface DeepSeekResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * DeepSeek LLM provider implementation
 */
@Injectable()
export class DeepSeekProvider extends BaseProvider {
  constructor(httpService: HttpService, config: BaseProviderConfig) {
    super(httpService, config);
  }

  public get name(): string {
    return 'deepseek';
  }

  /**
   * Perform chat completion using DeepSeek API
   */
  public async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    const request: DeepSeekRequest = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      top_p: params.topP,
      frequency_penalty: params.frequencyPenalty,
      presence_penalty: params.presencePenalty,
      stop: params.stop,
    };

    // Add JSON mode if requested
    if (params.jsonMode) {
      request.response_format = { type: 'json_object' };
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<DeepSeekResponse>('/chat/completions', request, {
          baseURL: this.config.baseUrl,
          timeout: this.config.timeout,
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      return this.mapResponse(response.data);
    } catch (error) {
      const httpError = this.handleHttpError(error);
      throw new Error(`DeepSeek API error: ${httpError.message}`, {
        cause: httpError,
      });
    }
  }

  /**
   * Map DeepSeek response to standard format
   */
  private mapResponse(response: DeepSeekResponse): ChatCompletionResult {
    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No choices in DeepSeek response');
    }

    return {
      id: response.id,
      model: response.model,
      content: choice.message.content,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
    };
  }

  /**
   * Map finish reason to standard format
   */
  private mapFinishReason(reason: string): 'stop' | 'length' | 'content_filter' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      default:
        this.logger.warn(`Unknown finish reason: ${reason}, defaulting to 'stop'`);
        return 'stop';
    }
  }
}
