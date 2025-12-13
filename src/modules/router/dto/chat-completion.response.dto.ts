/**
 * Chat completion response DTO
 */
export interface ChatCompletionResponseDto {
  // Standard OpenAI fields
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: 'stop' | 'length' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };

  // Router-specific metadata
  _router: {
    provider: string;
    model_name: string;
    attempts: number;
    fallback_used: boolean;
    errors?: Array<{
      provider: string;
      model: string;
      error: string;
      code?: number;
    }>;
  };
}

/**
 * Models list response DTO
 */
export interface ModelsResponseDto {
  models: Array<{
    name: string;
    provider: string;
    type: 'fast' | 'reasoning';
    context_size: number;
    tags: string[];
    available: boolean;
  }>;
}
