import axios from 'axios';
import yaml from 'js-yaml';

interface OpenRouterModel {
    id: string;
    name: string;
    context_length: number;
    architecture?: {
        modality?: string;
        tokenizer?: string;
        instruct_type?: string;
        input_modalities?: string[];
        output_modalities?: string[];
    };
    pricing: {
        prompt: string;
        completion: string;
    };
    top_provider?: {
        max_completion_tokens?: number;
        is_moderated?: boolean;
    };
    supported_parameters?: string[];
}

interface FilteredModel {
    name: string;
    provider: string;
    model: string;
    type: 'fast' | 'reasoning';
    contextSize: number;
    maxOutputTokens: number;
    speedTier: 'fast' | 'medium' | 'slow';
    tags: string[];
    jsonResponse: boolean;
    available: boolean;
    weight: number;
    supportsVision?: boolean;
}

/**
 * Determine weight based on model popularity and quality
 */
function determineWeight(id: string): number {
    const lowerId = id.toLowerCase();
    if (lowerId.includes('llama-3.3-70b')) return 10;
    if (lowerId.includes('gemini-2.0-flash')) return 5;
    if (lowerId.includes('r1')) return 5;
    if (lowerId.includes('claude-3')) return 8;
    return 1;
}

/**
 * Extract simplified model name
 */
function extractName(id: string): string {
    const parts = id.split('/');
    const main = parts.length > 1 ? parts[1] : parts[0];
    return main.replace(':free', '');
}

/**
 * Determine speed tier based on model size and characteristics
 */
function determineSpeedTier(id: string, modelName: string, isReasoning: boolean): 'fast' | 'medium' | 'slow' {
    if (isReasoning) return 'slow';

    const combined = `${id} ${modelName}`.toLowerCase();

    // Fast: < 20B parameters
    if (combined.match(/\b(3b|4b|7b|9b|12b)\b/)) return 'fast';

    // Slow: > 100B parameters
    if (combined.match(/\b(120b|235b|405b|670b)\b/)) return 'slow';

    // Medium: 20B-100B parameters
    if (combined.match(/\b(20b|24b|27b|30b|32b|70b)\b/)) return 'medium';

    // Default to fast for unknown sizes
    return 'fast';
}

/**
 * Detect use case tags based on model characteristics
 */
function detectUseCaseTags(id: string, modelName: string): string[] {
    const tags: string[] = [];
    const combined = `${id} ${modelName}`.toLowerCase();

    // Coding
    if (combined.match(/code|coder|codestral|devstral|programming|kat-coder/)) {
        tags.push('coding');
    }

    // Creative writing
    if (combined.match(/creative|story|writer|poet|dolphin|hermes/)) {
        tags.push('creative');
    }

    // Analysis & data
    if (combined.match(/analysis|analyst|research|deepresearch|data/)) {
        tags.push('analysis');
    }

    // Chat & assistants
    if (combined.match(/chat|assistant|instruct|conversational/)) {
        tags.push('chat');
    }

    // Agentic capabilities (models good at following complex instructions)
    if (combined.match(/llama-3\.|gemini|claude|gpt-4|deepseek|qwen|command|agent/)) {
        tags.push('agentic');
    }

    return tags;
}

/**
 * Detect language support tags
 * Returns tags like 'best-for-ru', 'best-for-es', 'best-for-eo'
 */
function detectLanguageTags(id: string, modelName: string): string[] {
    const tags: string[] = [];
    const combined = `${id} ${modelName}`.toLowerCase();

    // Russian language support
    if (combined.match(/deepseek|qwen|glm|tongyi|yandex|saiga|rugpt/)) {
        tags.push('best-for-ru');
    }

    // Spanish language support
    if (combined.match(/llama-3|gemini|mistral|mixtral|command/)) {
        tags.push('best-for-es');
    }

    // Esperanto support (mostly multilingual models)
    if (combined.match(/llama-3\.[2-9]|gemini-2|qwen|glm/)) {
        tags.push('best-for-eo');
    }

    return tags;
}

/**
 * Extract model family and version tags
 */
function extractFamilyTags(id: string, modelName: string): string[] {
    const tags: string[] = [];
    const combined = `${id} ${modelName}`.toLowerCase();

    // Model families
    const families: Record<string, RegExp> = {
        'llama': /llama/,
        'gemini': /gemini/,
        'gemma': /gemma/,
        'qwen': /qwen/,
        'deepseek': /deepseek/,
        'mistral': /mistral/,
        'mixtral': /mixtral/,
        'claude': /claude/,
        'gpt': /gpt-/,
        'phi': /phi-/,
        'command': /command/,
        'nemotron': /nemotron/,
        'glm': /glm/,
        'hermes': /hermes/,
        'dolphin': /dolphin/,
        'yi': /\byi-/,
        'nova': /nova/,
        'olmo': /olmo/,
    };

    for (const [family, pattern] of Object.entries(families)) {
        if (pattern.test(combined)) {
            tags.push(family);

            // Extract major version
            const versionMatch = combined.match(new RegExp(`${family}[\\s-]*(\\d+)`));
            if (versionMatch) {
                tags.push(`${family}-${versionMatch[1]}`);
            }
        }
    }

    return tags;
}

/**
 * Generate all tags for a model
 */
function generateTags(id: string, modelName: string, isReasoning: boolean, supportsVision: boolean): string[] {
    const tags: string[] = ['general'];

    // Add use case tags
    tags.push(...detectUseCaseTags(id, modelName));

    // Add language tags
    tags.push(...detectLanguageTags(id, modelName));

    // Add family tags
    tags.push(...extractFamilyTags(id, modelName));

    // Add reasoning tag if applicable
    if (isReasoning) {
        tags.push('reasoning');
    }

    // Add vision tag if applicable
    if (supportsVision) {
        tags.push('vision');
    }

    // Remove duplicates and sort
    return [...new Set(tags)].sort();
}

async function fetchAndFilterModels() {
    try {
        const response = await axios.get('https://openrouter.ai/api/v1/models');
        const allModels: OpenRouterModel[] = response.data.data;

        // Filter models based on user requirements:
        // - input_modalities: [ "text", "image", "file", "audio", "video" ]
        // - output_modalities: [ "text" ]
        // - support for: json output, tools, stream, vision

        const filtered = allModels.filter(model => {
            // Must be free (standard for this project)
            const isFree = model.pricing.prompt === '0' && model.pricing.completion === '0';
            if (!isFree) return false;

            // Input modalities check
            const inputModalities = model.architecture?.input_modalities || ['text'];
            const outputModalities = model.architecture?.output_modalities || ['text'];

            // Output must be text as requested
            if (!outputModalities.includes('text')) return false;

            /**
             * The user requested input_modalities [ "text", "image", "file", "audio", "video" ].
             * Currently, no free models on OpenRouter support all 5. 
             * We filter for models that support at least vision (text + image) 
             * to keep the list functional while prioritizing high-capability models.
             */
            if (!inputModalities.includes('text') || !inputModalities.includes('image')) return false;

            // Capability check
            const supportsToolsHeuristic = (id: string) => {
                const lowerId = id.toLowerCase();
                return lowerId.includes('gpt-') ||
                    lowerId.includes('claude-3') ||
                    lowerId.includes('gemini-') ||
                    lowerId.includes('llama-3') ||
                    lowerId.includes('mistral') ||
                    lowerId.includes('mixtral') ||
                    lowerId.includes('qwen') ||
                    lowerId.includes('deepseek') ||
                    lowerId.includes('command') ||
                    lowerId.includes('nemotron');
            };

            const supportsJsonHeuristic = (id: string) => {
                const lowerId = id.toLowerCase();
                return supportsToolsHeuristic(id) || lowerId.includes('instruct');
            };

            const supportsTools = model.supported_parameters?.includes('tools') || supportsToolsHeuristic(model.id);
            const supportsJson = model.supported_parameters?.includes('response_format') ||
                model.supported_parameters?.includes('structured_outputs') ||
                supportsJsonHeuristic(model.id);

            // Vision check (already checked in modalities)
            // Stream check (most modern models support it)

            if (!supportsTools || !supportsJson) return false;

            return true;
        });

        const mapped: FilteredModel[] = filtered.map(model => {
            const isReasoning = model.id.toLowerCase().includes('reasoning') ||
                model.id.toLowerCase().includes('r1') ||
                model.id.toLowerCase().includes('think');

            const name = extractName(model.id);
            const inputModalities = model.architecture?.input_modalities || ['text'];
            const supportsVision = inputModalities.includes('image');

            const result: FilteredModel = {
                name: name,
                provider: 'openrouter',
                model: model.id,
                type: isReasoning ? 'reasoning' : 'fast',
                contextSize: model.context_length || 4096,
                maxOutputTokens: model.top_provider?.max_completion_tokens || 4096,
                speedTier: determineSpeedTier(model.id, name, isReasoning),
                tags: generateTags(model.id, name, isReasoning, supportsVision),
                jsonResponse: true,
                available: true,
                weight: determineWeight(model.id),
            };

            // Set vision support flag
            if (supportsVision) {
                result.supportsVision = true;
            }

            return result;
        });

        // Group by provider prefix
        const grouped: Record<string, FilteredModel[]> = {};
        for (const model of mapped) {
            const providerPrefix = model.model.split('/')[0] || 'other';
            if (!grouped[providerPrefix]) grouped[providerPrefix] = [];
            grouped[providerPrefix].push(model);
        }

        // Sort providers and models
        const sortedProviders = Object.keys(grouped).sort();
        const finalModels: FilteredModel[] = [];

        for (const provider of sortedProviders) {
            const models = grouped[provider].sort((a, b) => a.name.localeCompare(b.name));
            finalModels.push(...models);
        }

        const output = {
            models: finalModels
        };

        // Output as YAML
        console.log(yaml.dump(output, { noRefs: true, indent: 2, lineWidth: -1 }));

    } catch (error) {
        console.error('Error fetching models:', error);
        process.exit(1);
    }
}

fetchAndFilterModels();
