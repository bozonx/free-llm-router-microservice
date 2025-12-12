/**
 * Chat message structure
 */
export interface ChatMessage {
    /**
     * Message role
     */
    role: 'system' | 'user' | 'assistant';

    /**
     * Message content
     */
    content: string;
}

/**
 * Chat completion request parameters
 */
export interface ChatCompletionParams {
    /**
     * Model ID to use
     */
    model: string;

    /**
     * Chat messages
     */
    messages: ChatMessage[];

    /**
     * Temperature (0-2)
     */
    temperature?: number;

    /**
     * Maximum tokens to generate
     */
    maxTokens?: number;

    /**
     * Top P sampling
     */
    topP?: number;

    /**
     * Frequency penalty
     */
    frequencyPenalty?: number;

    /**
     * Presence penalty
     */
    presencePenalty?: number;

    /**
     * Stop sequences
     */
    stop?: string | string[];

    /**
     * JSON mode enabled
     */
    jsonMode?: boolean;
}

/**
 * Chat completion result
 */
export interface ChatCompletionResult {
    /**
     * Completion ID
     */
    id: string;

    /**
     * Model used
     */
    model: string;

    /**
     * Generated content
     */
    content: string;

    /**
     * Finish reason
     */
    finishReason: 'stop' | 'length' | 'content_filter';

    /**
     * Token usage statistics
     */
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

/**
 * LLM provider interface
 */
export interface LlmProvider {
    /**
     * Provider name
     */
    readonly name: string;

    /**
     * Perform chat completion
     */
    chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult>;
}
