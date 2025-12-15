import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage, AIMessage, AIMessageChunk, ToolMessage } from '@langchain/core/messages';
import { ChatResult, ChatGeneration, ChatGenerationChunk } from '@langchain/core/outputs';
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
    lc_namespace = ['langchain', 'chat_models', 'free_llm_router'];

    constructor(config: FreeLlmRouterChatModelConfig) {
        super({});
        this.config = config;
    }

    _llmType(): string {
        return 'free-llm-router';
    }

    /**
     * Bind tools to the model for function calling
     */
    bindTools(tools: any[], kwargs?: any): FreeLlmRouterChatModel {
        return new FreeLlmRouterChatModel({
            ...this.config,
            modelKwargs: {
                ...this.config.modelKwargs,
                tools,
                tool_choice: kwargs?.tool_choice,
            },
        });
    }

    /**
     * Convert LangChain messages to OpenAI format
     */
    private formatMessages(messages: BaseMessage[]): Array<{
        role: string;
        content: string | null;
        tool_calls?: any[];
        tool_call_id?: string;
    }> {
        return messages.map((msg) => {
            let role = 'user';
            const msgType = msg._getType();

            if (msgType === 'ai') {
                role = 'assistant';
            } else if (msgType === 'system') {
                role = 'system';
            } else if (msgType === 'tool') {
                role = 'tool';
            } else if (msgType === 'function') {
                role = 'function';
            }

            const formatted: {
                role: string;
                content: string | null;
                tool_calls?: any[];
                tool_call_id?: string;
            } = {
                role,
                content: msg.content as string,
            };

            // Handle tool calls in AI messages
            if (msgType === 'ai' && 'tool_calls' in msg.additional_kwargs && msg.additional_kwargs.tool_calls) {
                formatted.tool_calls = msg.additional_kwargs.tool_calls as any[];
                if (formatted.tool_calls && formatted.tool_calls.length > 0) {
                    formatted.content = null;
                }
            }

            // Handle tool message with tool_call_id
            if (msg instanceof ToolMessage) {
                formatted.tool_call_id = msg.tool_call_id;
            }

            return formatted;
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

        // Add model kwargs (filter options and tools)
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
                    message?: {
                        content?: string | null;
                        tool_calls?: any[];
                    };
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
            const toolCalls = data.choices?.[0]?.message?.tool_calls;

            // Create AI message with tool calls if present
            const aiMessage = new AIMessage({
                content: messageContent,
                additional_kwargs: toolCalls ? { tool_calls: toolCalls } : {},
            });

            const generation: ChatGeneration = {
                text: messageContent,
                message: aiMessage,
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

    /**
     * Stream chat completions (Server-Sent Events)
     */
    async *_streamResponseChunks(
        messages: BaseMessage[],
        options?: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun,
    ): AsyncGenerator<ChatGenerationChunk> {
        const formattedMessages = this.formatMessages(messages);

        // Build request body with stream=true
        const requestBody: Record<string, unknown> = {
            messages: formattedMessages,
            stream: true,
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

        // Add model kwargs (filter options and tools)
        if (this.config.modelKwargs && Object.keys(this.config.modelKwargs).length > 0) {
            Object.assign(requestBody, this.config.modelKwargs);
        }

        // Make streaming API request
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
                    `Free LLM Router streaming API error: ${response.status} ${response.statusText} - ${errorText}`,
                );
            }

            if (!response.body) {
                throw new Error('Response body is null');
            }

            // Parse SSE stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) {
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });
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
                                const chunk = JSON.parse(jsonData) as {
                                    id?: string;
                                    object?: string;
                                    model?: string;
                                    choices?: Array<{
                                        index?: number;
                                        delta?: {
                                            role?: string;
                                            content?: string;
                                            tool_calls?: any[];
                                        };
                                        finish_reason?: string | null;
                                    }>;
                                };

                                const delta = chunk.choices?.[0]?.delta;
                                const finishReason = chunk.choices?.[0]?.finish_reason;

                                if (delta) {
                                    const content = delta.content || '';

                                    // Create AI message chunk
                                    const aiMessageChunk = new AIMessageChunk({
                                        content,
                                        additional_kwargs: delta.tool_calls ? { tool_calls: delta.tool_calls } : {},
                                    });

                                    const generation = new ChatGenerationChunk({
                                        text: content,
                                        message: aiMessageChunk,
                                        generationInfo: {
                                            finishReason: finishReason || undefined,
                                        },
                                    });

                                    yield generation;

                                    // Call streaming callback if available
                                    if (content) {
                                        await runManager?.handleLLMNewToken(content);
                                    }
                                }
                            } catch (parseError) {
                                console.error('Failed to parse SSE chunk:', trimmedLine, parseError);
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
        } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error) {
                throw new Error(`Free LLM Router streaming request failed: ${error.message}`);
            }
            throw error;
        }
    }
}
