
import axios from 'axios';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';


import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODELS_FILE = path.join(__dirname, '../models.yaml');
const OUT_FILE = path.join(__dirname, '../models_updated.yaml');


interface OpenRouterModel {
    id: string;
    name: string;
    context_length: number;
    pricing: {
        prompt: string;
        completion: string;
    };
    architecture?: {
        output_modalities?: string[];
    };
    top_provider?: {
        max_completion_tokens?: number;
    }
}

interface AppModelConfig {
    models: Array<{
        name: string;
        provider: string;
        model: string;
        type?: string;
        contextSize?: number;
        maxOutputTokens?: number;
        speedTier?: string;
        tags?: string[];
        jsonResponse?: boolean;
        available?: boolean;
        weight?: number;
        maxConcurrent?: number;
    }>;
}

async function updateModels() {
    console.log('Fetching models from OpenRouter...');
    try {
        const response = await axios.get('https://openrouter.ai/api/v1/models');
        const allModels: OpenRouterModel[] = response.data.data;

        const freeModels = allModels.filter(m =>
            m.pricing.prompt === '0' &&
            m.pricing.completion === '0'
        );

        console.log(`Found ${freeModels.length} free models.`);

        const newModels = freeModels.map(m => {
            // heuristics for metadata
            const lowerId = m.id.toLowerCase();
            const isCode = lowerId.includes('code') || lowerId.includes('coder');
            const isReasoning = lowerId.includes('reasoning') || lowerId.includes('deepseek-r1');

            // Default tags
            const tags = ['general'];
            if (isCode) tags.push('code');
            if (isReasoning) tags.push('reasoning');

            // Heuristic for simple names
            // e.g. meta-llama/llama-3.3-70b-instruct:free -> llama-3.3-70b-instruct
            let simpleName = m.id.split('/')[1] || m.id;
            simpleName = simpleName.replace(':free', '');

            // Weight heuristics logic
            let weight = 1;
            if (lowerId.includes('llama-3.3-70b')) weight = 10;
            else if (lowerId.includes('deepseek-r1')) weight = 5;
            else if (lowerId.includes('gemini')) weight = 3;

            // Context size fallback
            const contextSize = m.context_length || 4096;

            return {
                name: simpleName,
                provider: 'openrouter',
                model: m.id,
                type: isReasoning ? 'reasoning' : 'fast', // simple heuristic
                contextSize: contextSize,
                maxOutputTokens: m.top_provider?.max_completion_tokens || 4096,
                speedTier: 'fast', // default
                tags: tags,
                jsonResponse: true,
                available: true,
                weight: weight,
            };
        });

        // Read existing file to keep non-openrouter models
        let doc: AppModelConfig = { models: [] };
        if (fs.existsSync(MODELS_FILE)) {
            const fileContent = fs.readFileSync(MODELS_FILE, 'utf8');
            doc = yaml.load(fileContent) as AppModelConfig;
        }

        // Filter out existing openrouter models to replace them completely with the new list
        // Or we could maintain overrides if we matched by ID, but simpler to just refresh list.
        const startNonOpenRouter = doc.models.filter(m => m.provider !== 'openrouter');

        const mergedModels = [...newModels, ...startNonOpenRouter];

        const newDoc = { models: mergedModels };

        const newYaml = yaml.dump(newDoc, { lineWidth: -1, noRefs: true });

        fs.writeFileSync(OUT_FILE, newYaml);
        console.log(`Updated models list written to ${OUT_FILE}`);
        console.log(`You can now review it and replace ${MODELS_FILE} if satisfied.`);

    } catch (error) {
        console.error("Error fetching models:", error);
    }
}

updateModels();
