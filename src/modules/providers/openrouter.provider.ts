import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BaseProvider, type BaseProviderConfig } from './base.provider.js';
import type {
    ChatCompletionParams,
    ChatCompletionResult,
} from './interfaces/provider.interface.js';

/**
 * OpenRouter API request format
 */
interface OpenRouterRequest {
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
 * OpenRouter API response format
 */
interface OpenRouterResponse {
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
 * OpenRouter LLM provider implementation
 */
@Injectable()
export class OpenRouterProvider extends BaseProvider {
    constructor(httpService: HttpService, config: BaseProviderConfig) {
        super(httpService, config);
    }

    get name(): string {
        return 'openrouter';
    }

    /**
     * Perform chat completion using OpenRouter API
     */
    async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
        const request: OpenRouterRequest = {
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
                this.httpService.post<OpenRouterResponse>('/chat/completions', request, {
                    baseURL: this.config.baseUrl,
                    timeout: this.config.timeout,
                    headers: {
                        Authorization: `Bearer ${this.config.apiKey}`,
                        'HTTP-Referer': 'https://github.com/free-llm-router',
                        'X-Title': 'Free LLM Router',
                    },
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
     * Map OpenRouter response to standard format
     */
    private mapResponse(response: OpenRouterResponse): ChatCompletionResult {
        const choice = response.choices[0];
        if (!choice) {
            throw new Error('No choices in OpenRouter response');
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
