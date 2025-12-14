import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage, AIMessage } from '@langchain/core/messages';
import { ChatResult, ChatGeneration } from '@langchain/core/outputs';
import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';

/**
 * Configuration for Free LLM Router Chat Model
 */
export interface FreeLlmRouterChatModelConfig {
    baseUrl: string;
    headers?: Record<string, string>;
    model?: string | string[];
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    timeout?: number;
    modelKwargs?: Record<string, unknown>;
}

/**
 * Custom Chat Model implementation for Free LLM Router Microservice
 * Directly calls the router API without requiring OpenAI credentials
 */
export class FreeLlmRouterChatModel extends BaseChatModel {
    private config: FreeLlmRouterChatModelConfig;

    constructor(config: FreeLlmRouterChatModelConfig) {
        super({});
        this.config = config;
    }

    _llmType(): string {
        return 'free-llm-router';
    }

    /**
     * Convert LangChain messages to OpenAI format
     */
    private formatMessages(messages: BaseMessage[]): Array<{ role: string; content: string }> {
        return messages.map((msg) => {
            let role = 'user';
            if (msg._getType() === 'ai') {
                role = 'assistant';
            } else if (msg._getType() === 'system') {
                role = 'system';
            } else if (msg._getType() === 'function') {
                role = 'function';
            }

            return {
                role,
                content: msg.content as string,
            };
        });
    }

    /**
     * Main method to generate chat completions
     */
    async _generate(
        messages: BaseMessage[],
        options?: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun,
    ): Promise<ChatResult> {
        const formattedMessages = this.formatMessages(messages);

        // Build request body
        const requestBody: Record<string, unknown> = {
            messages: formattedMessages,
        };

        if (this.config.model) {
            requestBody.model = this.config.model;
        }

        if (this.config.temperature !== undefined) {
            requestBody.temperature = this.config.temperature;
        }

        if (this.config.maxTokens !== undefined) {
            requestBody.max_tokens = this.config.maxTokens;
        }

        if (this.config.topP !== undefined) {
            requestBody.top_p = this.config.topP;
        }

        if (this.config.frequencyPenalty !== undefined) {
            requestBody.frequency_penalty = this.config.frequencyPenalty;
        }

        if (this.config.presencePenalty !== undefined) {
            requestBody.presence_penalty = this.config.presencePenalty;
        }

        // Add model kwargs (filter options)
        if (this.config.modelKwargs && Object.keys(this.config.modelKwargs).length > 0) {
            Object.assign(requestBody, this.config.modelKwargs);
        }

        // Make API request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, this.config.timeout || 60000);

        try {
            const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.config.headers,
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `Free LLM Router API error: ${response.status} ${response.statusText} - ${errorText}`,
                );
            }

            const data = (await response.json()) as {
                choices?: Array<{
                    message?: { content?: string };
                    finish_reason?: string;
                }>;
                usage?: {
                    prompt_tokens?: number;
                    completion_tokens?: number;
                    total_tokens?: number;
                };
                _router?: unknown;
            };

            // Extract response
            const messageContent = data.choices?.[0]?.message?.content || '';
            const generation: ChatGeneration = {
                text: messageContent,
                message: new AIMessage(messageContent),
                generationInfo: {
                    finishReason: data.choices?.[0]?.finish_reason,
                    _router: data._router,
                },
            };

            return {
                generations: [generation],
                llmOutput: {
                    tokenUsage: {
                        promptTokens: data.usage?.prompt_tokens,
                        completionTokens: data.usage?.completion_tokens,
                        totalTokens: data.usage?.total_tokens,
                    },
                    _router: data._router,
                },
            };
        } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error) {
                throw new Error(`Free LLM Router request failed: ${error.message}`);
            }
            throw error;
        }
    }
}
