import { BaseProvider, type BaseProviderConfig } from './base.provider.js';
import type {
  ChatCompletionParams,
  ChatCompletionResult,
  ChatCompletionStreamChunk,
} from './interfaces/provider.interface.js';
import type { Tool, ToolCall, ToolChoice } from './interfaces/tools.interface.js';

/**
 * DeepSeek API request format (OpenAI-compatible)
 */
interface DeepSeekRequest {
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
  response_format?: {
    type: 'text' | 'json_object' | 'json_schema';
    json_schema?: Record<string, any>;
  };
  tools?: Tool[];
  tool_choice?: ToolChoice;
  stream?: boolean;
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
      content: string | null;
      tool_calls?: ToolCall[];
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
 * DeepSeek API streaming response format (SSE chunks)
 */
interface DeepSeekStreamChunk {
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
 * DeepSeek LLM provider implementation
 */
export class DeepSeekProvider extends BaseProvider {
  constructor(fetchClient: BaseProvider['fetchClient'], config: BaseProviderConfig) {
    super(fetchClient, config);
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
      tools: params.tools,
      tool_choice: params.toolChoice,
    };

    if (params.responseFormat) {
      request.response_format = params.responseFormat;
    }

    const abortSignal = this.createAbortSignalWithTimeout({
      abortSignal: params.abortSignal,
      timeoutSecs: params.timeoutSecs,
    });

    const response = await this.fetchClient.fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: abortSignal,
    });

    if (!response.ok) {
      const httpError = await this.parseErrorResponse(response);
      this.throwProviderHttpError({
        statusCode: httpError.statusCode,
        message: `DeepSeek API error: ${httpError.message}`,
        code: httpError.code,
        details: httpError.details,
        providerRequestId: httpError.providerRequestId,
        providerResponse: httpError.providerResponse,
      });
    }

    const data = (await response.json()) as DeepSeekResponse;
    return this.mapResponse(data);
  }

  /**
   * Perform chat completion with streaming using DeepSeek API
   */
  public async *chatCompletionStream(
    params: ChatCompletionParams,
  ): AsyncGenerator<ChatCompletionStreamChunk, void, unknown> {
    const request: DeepSeekRequest = {
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

    if (params.responseFormat) {
      request.response_format = params.responseFormat;
    }

    const abortSignal = this.createAbortSignalWithTimeout({
      abortSignal: params.abortSignal,
      timeoutSecs: params.timeoutSecs,
    });

    const response = await this.fetchClient.fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: abortSignal,
    });

    if (!response.ok) {
      const httpError = await this.parseErrorResponse(response);
      this.throwProviderHttpError({
        statusCode: httpError.statusCode,
        message: `DeepSeek streaming API error: ${httpError.message}`,
        code: httpError.code,
        details: httpError.details,
        providerRequestId: httpError.providerRequestId,
        providerResponse: httpError.providerResponse,
      });
    }

    if (!response.body) {
      this.throwProviderHttpError({
        statusCode: 502,
        message: 'DeepSeek streaming API error: empty response body',
      });
    }

    for await (const sseChunk of this.parseStream(response.body as ReadableStream<Uint8Array>)) {
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
        finishReason: choice.finish_reason ? this.mapFinishReason(choice.finish_reason) : undefined,
      };
    }
  }

  private async *parseStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<DeepSeekStreamChunk, void, unknown> {
    const decoder = new TextDecoder();
    const reader = body.getReader();

    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith(':')) {
          continue;
        }

        if (trimmedLine === 'data: [DONE]') {
          return;
        }

        if (trimmedLine.startsWith('data: ')) {
          const jsonData = trimmedLine.slice('data: '.length);
          try {
            yield JSON.parse(jsonData) as DeepSeekStreamChunk;
          } catch (parseError) {
            this.logger.warn(`Failed to parse SSE chunk: ${trimmedLine}`, parseError);
          }
        }
      }
    }
  }

  private createAbortSignalWithTimeout(params: {
    abortSignal?: AbortSignal;
    timeoutSecs?: number;
  }): AbortSignal | undefined {
    const timeoutSecs = params.timeoutSecs ?? this.config.timeoutSecs;
    const timeoutMs = timeoutSecs * 1000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return params.abortSignal;
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    timeoutId.unref?.();

    if (params.abortSignal) {
      params.abortSignal.addEventListener('abort', () => timeoutController.abort(), { once: true });
    }

    return params.abortSignal
      ? AbortSignal.any([timeoutController.signal, params.abortSignal])
      : timeoutController.signal;
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
      content: this.handleContentWithToolCalls(choice.message.content, choice.message.tool_calls),
      toolCalls: choice.message.tool_calls,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
    };
  }
}
