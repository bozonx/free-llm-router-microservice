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
    tags: string[];
    jsonResponse: boolean;
    available: boolean;
    weight: number;
    supportsImage?: boolean;
    supportsVideo?: boolean;
    supportsAudio?: boolean;
    supportsFile?: boolean;
}

/**
 * Determine weight - always returns 1 as requested
 */
function determineWeight(id: string): number {
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
 * Detect language support tags for 15 major European and Asian languages
 * Returns tags like 'best-for-en', 'best-for-ru', 'best-for-zh', etc.
 */
function detectLanguageTags(id: string, modelName: string): string[] {
    const tags: string[] = [];
    const combined = `${id} ${modelName}`.toLowerCase();

    // English - most multilingual models
    if (combined.match(/llama-3|gemini|gpt-|claude|mistral|mixtral|qwen|deepseek|command|phi/)) {
        tags.push('best-for-en');
    }

    // Spanish - major multilingual models
    if (combined.match(/llama-3|gemini|mistral|mixtral|command|gpt-|claude/)) {
        tags.push('best-for-es');
    }

    // French - major multilingual models
    if (combined.match(/llama-3|gemini|mistral|mixtral|command|gpt-|claude/)) {
        tags.push('best-for-fr');
    }

    // German - major multilingual models
    if (combined.match(/llama-3|gemini|mistral|mixtral|command|gpt-|claude/)) {
        tags.push('best-for-de');
    }

    // Italian - major multilingual models
    if (combined.match(/llama-3|gemini|mistral|mixtral|command|gpt-|claude/)) {
        tags.push('best-for-it');
    }

    // Portuguese - major multilingual models
    if (combined.match(/llama-3|gemini|mistral|mixtral|command|gpt-|claude/)) {
        tags.push('best-for-pt');
    }

    // Russian - models with good Russian support
    if (combined.match(/deepseek|qwen|glm|tongyi|yandex|saiga|rugpt|llama-3|gemini/)) {
        tags.push('best-for-ru');
    }

    // Chinese - Chinese and multilingual models
    if (combined.match(/qwen|glm|deepseek|tongyi|yi-|llama-3|gemini|gpt-|claude/)) {
        tags.push('best-for-zh');
    }

    // Japanese - multilingual models with Asian language support
    if (combined.match(/llama-3|gemini|gpt-|claude|qwen|deepseek|command/)) {
        tags.push('best-for-ja');
    }

    // Korean - multilingual models with Asian language support
    if (combined.match(/llama-3|gemini|gpt-|claude|qwen|deepseek|command/)) {
        tags.push('best-for-ko');
    }

    // Arabic - multilingual models
    if (combined.match(/llama-3|gemini|gpt-|claude|command|qwen/)) {
        tags.push('best-for-ar');
    }

    // Hindi - multilingual models with Indian language support
    if (combined.match(/llama-3|gemini|gpt-|claude|command|qwen/)) {
        tags.push('best-for-hi');
    }

    // Turkish - multilingual models
    if (combined.match(/llama-3|gemini|gpt-|claude|mistral|mixtral|command/)) {
        tags.push('best-for-tr');
    }

    // Polish - European multilingual models
    if (combined.match(/llama-3|gemini|gpt-|claude|mistral|mixtral|command/)) {
        tags.push('best-for-pl');
    }

    // Dutch - European multilingual models
    if (combined.match(/llama-3|gemini|gpt-|claude|mistral|mixtral|command/)) {
        tags.push('best-for-nl');
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
function generateTags(id: string, modelName: string, isReasoning: boolean, supportsImage: boolean): string[] {
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
    if (supportsImage) {
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
        // - output_modalities: [ "text" ] (text output only)
        // - support for: json output and tools
        // Modalities are set as parameters (supportsImage, supportsVideo, etc.)

        const filtered = allModels.filter(model => {
            // Must be free (standard for this project)
            const isFree = model.pricing.prompt === '0' && model.pricing.completion === '0';
            if (!isFree) return false;

            // Output modalities check
            const outputModalities = model.architecture?.output_modalities || ['text'];

            // Output must be text only as requested
            if (!outputModalities.includes('text')) return false;

            // Capability check - filter only by json output and tools support
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

            // Filter only by json output and tools support
            if (!supportsTools || !supportsJson) return false;

            return true;
        });

        const mapped: FilteredModel[] = filtered.map(model => {
            const isReasoning = model.id.toLowerCase().includes('reasoning') ||
                model.id.toLowerCase().includes('r1') ||
                model.id.toLowerCase().includes('think');

            const name = extractName(model.id);
            const inputModalities = model.architecture?.input_modalities || ['text'];
            const supportsImage = inputModalities.includes('image');

            const result: FilteredModel = {
                name: name,
                provider: 'openrouter',
                model: model.id,
                type: isReasoning ? 'reasoning' : 'fast',
                contextSize: model.context_length || 4096,
                maxOutputTokens: model.top_provider?.max_completion_tokens || 4096,
                tags: generateTags(model.id, name, isReasoning, supportsImage),
                jsonResponse: true,
                available: true,
                weight: determineWeight(model.id),
            };

            // Set multimodal support flags based on input_modalities
            if (inputModalities.includes('image')) {
                result.supportsImage = true;
            }
            if (inputModalities.includes('video')) {
                result.supportsVideo = true;
            }
            if (inputModalities.includes('audio')) {
                result.supportsAudio = true;
            }
            if (inputModalities.includes('file')) {
                result.supportsFile = true;
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
