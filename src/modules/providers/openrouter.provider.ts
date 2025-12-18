import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Readable } from 'stream';
import { BaseProvider, type BaseProviderConfig } from './base.provider.js';
import type {
  ChatCompletionParams,
  ChatCompletionResult,
  ChatCompletionStreamChunk,
} from './interfaces/provider.interface.js';
import type { Tool, ToolCall, ToolChoice } from './interfaces/tools.interface.js';

/**
 * OpenRouter API request format
 */
interface OpenRouterRequest {
  model: string;
  messages: Array<{
    role: string;
    content:
      | string
      | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }>
      | null;
    name?: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  response_format?: { type: 'json_object' };
  tools?: Tool[];
  tool_choice?: ToolChoice;
  stream?: boolean;
}

/**
 * OpenRouter API response format
 */
interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
      // Reasoning models may put response in reasoning field instead of content
      reasoning?: string;
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
 * OpenRouter API streaming response format (SSE chunks)
 */
interface OpenRouterStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
}

/**
 * OpenRouter LLM provider implementation
 */
@Injectable()
export class OpenRouterProvider extends BaseProvider {
  constructor(httpService: HttpService, config: BaseProviderConfig) {
    super(httpService, config);
  }

  public get name(): string {
    return 'openrouter';
  }

  /**
   * Perform chat completion using OpenRouter API
   */
  public async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    const request: OpenRouterRequest = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      top_p: params.topP,
      frequency_penalty: params.frequencyPenalty,
      presence_penalty: params.presencePenalty,
      stop: params.stop,
      tools: params.tools,
      tool_choice: params.toolChoice,
    };

    // Add JSON mode if requested
    if (params.jsonMode) {
      request.response_format = { type: 'json_object' };
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<OpenRouterResponse>('/chat/completions', request, {
          baseURL: this.config.baseUrl,
          timeout: (params.timeoutSecs || this.config.timeoutSecs) * 1000,
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'HTTP-Referer': 'https://github.com/free-llm-router',
            'X-Title': 'Free LLM Router',
          },
          signal: params.abortSignal,
        }),
      );

      return this.mapResponse(response.data);
    } catch (error) {
      const httpError = this.handleHttpError(error);
      throw new Error(`OpenRouter API error: ${httpError.message}`, {
        cause: httpError,
      });
    }
  }

  /**
   * Perform chat completion with streaming using OpenRouter API
   */
  public async *chatCompletionStream(
    params: ChatCompletionParams,
  ): AsyncGenerator<ChatCompletionStreamChunk, void, unknown> {
    const request: OpenRouterRequest = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      top_p: params.topP,
      frequency_penalty: params.frequencyPenalty,
      presence_penalty: params.presencePenalty,
      stop: params.stop,
      tools: params.tools,
      tool_choice: params.toolChoice,
      stream: true,
    };

    // Add JSON mode if requested
    if (params.jsonMode) {
      request.response_format = { type: 'json_object' };
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post('/chat/completions', request, {
          baseURL: this.config.baseUrl,
          timeout: (params.timeoutSecs || this.config.timeoutSecs) * 1000,
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'HTTP-Referer': 'https://github.com/free-llm-router',
            'X-Title': 'Free LLM Router',
          },
          signal: params.abortSignal,
          responseType: 'stream',
        }),
      );

      const stream = response.data as Readable;

      // Parse SSE stream
      let buffer = '';
      for await (const chunk of stream) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine.startsWith(':')) {
            continue; // Skip empty lines and comments
          }

          if (trimmedLine === 'data: [DONE]') {
            return; // Stream completed
          }

          if (trimmedLine.startsWith('data: ')) {
            try {
              const jsonData = trimmedLine.slice(6); // Remove "data: " prefix
              const sseChunk = JSON.parse(jsonData) as OpenRouterStreamChunk;

              const choice = sseChunk.choices[0];
              if (!choice) {
                continue;
              }

              yield {
                id: sseChunk.id,
                model: sseChunk.model,
                delta: {
                  role: choice.delta.role,
                  content: choice.delta.content,
                  tool_calls: choice.delta.tool_calls,
                },
                finishReason: choice.finish_reason
                  ? this.mapFinishReason(choice.finish_reason)
                  : undefined,
              };
            } catch (parseError) {
              this.logger.warn(`Failed to parse SSE chunk: ${trimmedLine}`, parseError);
            }
          }
        }
      }
    } catch (error) {
      const httpError = this.handleHttpError(error);
      throw new Error(`OpenRouter streaming API error: ${httpError.message}`, {
        cause: httpError,
      });
    }
  }

  /**
   * Map OpenRouter response to standard format
   */
  private mapResponse(response: OpenRouterResponse): ChatCompletionResult {
    const choice = response.choices[0];
    if (!choice) {
      console.error('OpenRouter Response Error: No choices', JSON.stringify(response, null, 2));
      throw new Error('No choices in OpenRouter response');
    }

    // Some reasoning models (e.g., gpt-oss-20b) put response in reasoning field instead of content
    // Use reasoning as fallback when content is empty
    let messageContent = choice.message.content;
    if (!messageContent && choice.message.reasoning) {
      this.logger.debug('Using reasoning field as content fallback');
      messageContent = choice.message.reasoning;
    }

    // Debug logging for truly empty responses
    if (!messageContent && !choice.message.tool_calls) {
      console.warn(
        'OpenRouter Warning: Empty content and no tool calls',
        JSON.stringify(choice, null, 2),
      );
    }

    const result: ChatCompletionResult = {
      id: response.id,
      model: response.model,
      content: this.handleContentWithToolCalls(messageContent, choice.message.tool_calls),
      toolCalls: choice.message.tool_calls,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
    };

    return result;
  }
}
