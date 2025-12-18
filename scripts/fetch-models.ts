import axios from 'axios';

interface OpenRouterModel {
    id: string;
    name: string;
    context_length: number;
    pricing: {
        prompt: string;
        completion: string;
    };
    architecture?: {
        modality?: string;
        tokenizer?: string;
        instruct_type?: string;
    };
    top_provider?: {
        max_completion_tokens?: number;
        is_moderated?: boolean;
    };
    per_request_limits?: {
        prompt_tokens?: string;
        completion_tokens?: string;
    };
}

interface FilteredModel {
    id: string;
    name: string;
    contextLength: number;
    maxOutputTokens: number;
    pricing: {
        prompt: string;
        completion: string;
    };
    architecture?: {
        modality?: string;
        tokenizer?: string;
        instruct_type?: string;
    };
}

/**
 * Check if model is a text-based LLM (not image/video/audio/STT model)
 */
function isTextLLM(model: OpenRouterModel): boolean {
    const lowerId = model.id.toLowerCase();
    const lowerName = model.name.toLowerCase();

    // Exclude non-LLM models
    const excludePatterns = [
        'whisper',           // STT models
        'dall-e',            // Image generation
        'stable-diffusion',  // Image generation
        'midjourney',        // Image generation
        'imagen',            // Image generation
        'tts',               // Text-to-speech
        'speech',            // Speech models
        'audio',             // Audio models
        'video',             // Video models
        'embedding',         // Embedding models
        'moderation',        // Moderation models
    ];

    for (const pattern of excludePatterns) {
        if (lowerId.includes(pattern) || lowerName.includes(pattern)) {
            return false;
        }
    }

    // Check modality if available
    if (model.architecture?.modality) {
        const modality = model.architecture.modality.toLowerCase();
        // Only accept text-based or multimodal models that include text
        if (!modality.includes('text') && !modality.includes('chat')) {
            return false;
        }
    }

    return true;
}

/**
 * Check if model supports streaming
 * Most modern LLMs support streaming, so we assume true unless explicitly indicated otherwise
 */
function supportsStreaming(model: OpenRouterModel): boolean {
    // For now, assume all text LLMs support streaming
    // This can be refined if OpenRouter API provides explicit streaming support info
    return true;
}

/**
 * Check if model supports tools/function calling
 * This is a heuristic based on model capabilities
 */
function supportsTools(model: OpenRouterModel): boolean {
    const lowerId = model.id.toLowerCase();

    // Models known to support function calling
    const toolsSupportPatterns = [
        'gpt-4',
        'gpt-3.5',
        'claude',
        'gemini',
        'llama-3',
        'mistral',
        'mixtral',
        'qwen',
        'deepseek',
        'command',
    ];

    // Check if model matches known patterns
    for (const pattern of toolsSupportPatterns) {
        if (lowerId.includes(pattern)) {
            return true;
        }
    }

    // If instruct_type suggests function calling capability
    if (model.architecture?.instruct_type) {
        const instructType = model.architecture.instruct_type.toLowerCase();
        if (instructType.includes('function') || instructType.includes('tool')) {
            return true;
        }
    }

    // Conservative approach: exclude if we're not sure
    return false;
}

/**
 * Check if model supports JSON response mode
 * Most modern instruct models support JSON output
 */
function supportsJSON(model: OpenRouterModel): boolean {
    const lowerId = model.id.toLowerCase();

    // Models known to support JSON mode
    const jsonSupportPatterns = [
        'gpt-4',
        'gpt-3.5',
        'claude',
        'gemini',
        'llama-3',
        'mistral',
        'mixtral',
        'qwen',
        'deepseek',
        'command',
        'instruct',
    ];

    for (const pattern of jsonSupportPatterns) {
        if (lowerId.includes(pattern)) {
            return true;
        }
    }

    return false;
}

/**
 * Check if model supports vision (multimodal with image input)
 */
function supportsVision(model: OpenRouterModel): boolean {
    const lowerId = model.id.toLowerCase();
    const lowerName = model.name.toLowerCase();

    // Vision model patterns
    const visionPatterns = [
        'vision',
        'multimodal',
        '-vl',
        'llava',
        'gpt-4-turbo',
        'gpt-4o',
        'claude-3',
        'gemini-pro-vision',
        'gemini-1.5',
        'gemini-2',
    ];

    for (const pattern of visionPatterns) {
        if (lowerId.includes(pattern) || lowerName.includes(pattern)) {
            return true;
        }
    }

    return false;
}

async function fetchAndFilterModels() {
    try {
        // Fetch models from OpenRouter API
        const response = await axios.get('https://openrouter.ai/api/v1/models');
        const allModels: OpenRouterModel[] = response.data.data;

        // Filter models based on criteria
        const filteredModels = allModels.filter(model => {
            // Must be free
            const isFree = model.pricing.prompt === '0' && model.pricing.completion === '0';
            if (!isFree) return false;

            // Must be a text-based LLM
            if (!isTextLLM(model)) return false;

            // Must support streaming
            if (!supportsStreaming(model)) return false;

            // Must support tools/function calling
            if (!supportsTools(model)) return false;

            // Must support JSON response
            if (!supportsJSON(model)) return false;

            return true;
        });

        // Map to simplified format
        const result: FilteredModel[] = filteredModels.map(model => ({
            id: model.id,
            name: model.name,
            contextLength: model.context_length || 4096,
            maxOutputTokens: model.top_provider?.max_completion_tokens || 4096,
            pricing: {
                prompt: model.pricing.prompt,
                completion: model.pricing.completion,
            },
            architecture: model.architecture,
        }));

        // Add metadata
        const output = {
            fetchedAt: new Date().toISOString(),
            totalModels: allModels.length,
            filteredModels: result.length,
            models: result,
        };

        // Output to stdout as JSON
        console.log(JSON.stringify(output, null, 2));

    } catch (error) {
        console.error('Error fetching models:', error);
        process.exit(1);
    }
}

fetchAndFilterModels();
