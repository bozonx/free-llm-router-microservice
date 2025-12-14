import {
    type INodeType,
    type INodeTypeDescription,
    type SupplyData,
    type ISupplyDataFunctions,
    type INodeProperties,
    NodeConnectionTypes,
} from 'n8n-workflow';
import { FreeLlmRouterChatModel } from './FreeLlmRouterChatModel';

/**
 * Free LLM Router node for n8n
 * Provides a LangChain-compatible model interface for the Free LLM Router Microservice
 */
export class FreeLlmRouter implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Free LLM Router Model',
        name: 'freeLlmRouter',
        icon: 'file:free-llm-router.svg',
        group: ['transform'],
        version: 1,
        description: 'Chat Model using Free LLM Router Microservice',
        defaults: {
            name: 'Free LLM Router',
        },
        codex: {
            categories: ['AI'],
            subcategories: {
                AI: ['Language Models', 'Chat Models (Recommended)'],
            },
            resources: {
                primaryDocumentation: [
                    {
                        url: 'https://github.com/bozonx/free-llm-router-microservice/tree/main/n8n-nodes-bozonx-free-llm-router-microservice#readme',
                    },
                ],
            },
        },
        credentials: [
            {
                name: 'freeLlmRouterApi',
                required: true,
            },
        ],
        // eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node
        inputs: [],
        // eslint-disable-next-line n8n-nodes-base/node-class-description-outputs-wrong
        outputs: [NodeConnectionTypes.AiLanguageModel],
        outputNames: ['Model'],
        properties: [
            // Model configuration
            {
                displayName: 'Model',
                name: 'model',
                type: 'string',
                default: 'auto',
                placeholder: 'auto',
                description: 'Model selection. Options:<br>' +
                    '• <b>auto</b> - Smart Strategy automatically selects the best model<br>' +
                    '• <b>Specific model</b> - Enter model name (e.g., llama-3.3-70b or openrouter/deepseek-r1)<br>' +
                    '• <b>Priority list</b> - Comma-separated models in priority order (e.g., "openrouter/deepseek-r1, llama-3.3-70b, auto")',
            },

            // Model filtering
            {
                displayName: 'Tags',
                name: 'tags',
                type: 'string',
                default: '',
                placeholder: 'code, reasoning',
                description: 'Comma-separated list of tags to filter models',
            },
            {
                displayName: 'Type',
                name: 'type',
                type: 'options',
                options: [
                    {
                        name: 'Any',
                        value: '',
                    },
                    {
                        name: 'Fast',
                        value: 'fast',
                    },
                    {
                        name: 'Reasoning',
                        value: 'reasoning',
                    },
                ],
                default: '',
                description: 'Filter models by type',
            },
            {
                displayName: 'JSON Response',
                name: 'jsonResponse',
                type: 'boolean',
                default: false,
                description: 'Whether to require models that support JSON response mode',
            },

            // Advanced options
            {
                displayName: 'Options',
                name: 'options',
                type: 'collection',
                placeholder: 'Add Option',
                default: {},
                options: [
                    {
                        displayName: 'Temperature',
                        name: 'temperature',
                        type: 'number',
                        typeOptions: {
                            numberPrecision: 1,
                            minValue: 0,
                            maxValue: 2,
                            numberStepSize: 0.1,
                        },
                        default: 0.7,
                        description: 'Controls randomness in the output. Higher values make output more random',
                    },
                    {
                        displayName: 'Maximum Tokens',
                        name: 'maxTokens',
                        type: 'number',
                        typeOptions: {
                            minValue: 1,
                        },
                        default: 1000,
                        description: 'Maximum number of tokens to generate in the response',
                    },
                    {
                        displayName: 'Top P',
                        name: 'topP',
                        type: 'number',
                        typeOptions: {
                            numberPrecision: 2,
                            minValue: 0,
                            maxValue: 1,
                            numberStepSize: 0.1,
                        },
                        default: 1,
                        description:
                            'Controls diversity via nucleus sampling. Lower values make output more focused',
                    },
                    {
                        displayName: 'Frequency Penalty',
                        name: 'frequencyPenalty',
                        type: 'number',
                        typeOptions: {
                            numberPrecision: 1,
                            minValue: -2,
                            maxValue: 2,
                            numberStepSize: 0.1,
                        },
                        default: 0,
                        description:
                            'Penalizes new tokens based on their frequency. Positive values decrease repetition',
                    },
                    {
                        displayName: 'Presence Penalty',
                        name: 'presencePenalty',
                        type: 'number',
                        typeOptions: {
                            numberPrecision: 1,
                            minValue: -2,
                            maxValue: 2,
                            numberStepSize: 0.1,
                        },
                        default: 0,
                        description:
                            'Penalizes new tokens based on their presence. Positive values encourage new topics',
                    },
                    {
                        displayName: 'Timeout',
                        name: 'timeout',
                        type: 'number',
                        default: 60000,
                        description: 'Maximum time to wait for a response in milliseconds',
                    },
                    {
                        displayName: 'Filter: Minimum Context Size',
                        name: 'filterMinContextSize',
                        type: 'number',
                        default: 0,
                        description: 'Minimum context window size required for model filtering',
                    },
                    {
                        displayName: 'Filter: Prefer Fast',
                        name: 'filterPreferFast',
                        type: 'boolean',
                        default: false,
                        description: 'Whether to prefer models with lowest latency',
                    },
                    {
                        displayName: 'Filter: Minimum Success Rate',
                        name: 'filterMinSuccessRate',
                        type: 'number',
                        typeOptions: {
                            numberPrecision: 2,
                            minValue: 0,
                            maxValue: 1,
                            numberStepSize: 0.05,
                        },
                        default: 0,
                        description: 'Minimum success rate for model selection (0-1)',
                    },
                ],
            },
        ],
    };

    async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
        const credentials = await this.getCredentials('freeLlmRouterApi');
        const modelInput = (this.getNodeParameter('model', itemIndex) as string).trim();
        const options = this.getNodeParameter('options', itemIndex, {}) as {
            topP?: number;
            frequencyPenalty?: number;
            presencePenalty?: number;
            timeout?: number;
            temperature?: number;
            maxTokens?: number;
            filterMinContextSize?: number;
            filterPreferFast?: boolean;
            filterMinSuccessRate?: number;
        };

        const temperature = options.temperature ?? 0.7;
        const maxTokens = options.maxTokens ?? 1000;

        // Parse model input
        let model: string | string[];
        const isAuto = modelInput === 'auto' || modelInput === '';

        if (modelInput.includes(',')) {
            // Priority list
            model = modelInput.split(',').map((m) => m.trim());
        } else {
            // Single model or auto
            model = modelInput || 'auto';
        }

        // Get main-level filter parameters
        const tags = this.getNodeParameter('tags', itemIndex, '') as string;
        const type = this.getNodeParameter('type', itemIndex, '') as string;
        const jsonResponse = this.getNodeParameter('jsonResponse', itemIndex, false) as boolean;

        // Build headers for authentication
        const headers: Record<string, string> = {};
        if (credentials.authentication !== 'none') {
            headers.Authorization =
                credentials.authentication === 'bearer'
                    ? `Bearer ${credentials.token}`
                    : `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
        }

        // Build model kwargs (filter options)
        const modelKwargs: Record<string, unknown> = {};

        if (tags) {
            modelKwargs.tags = tags.split(',').map((t) => t.trim());
        }
        if (type) {
            modelKwargs.type = type;
        }
        if (jsonResponse) {
            modelKwargs.json_response = jsonResponse;
        }
        if (options.filterMinContextSize !== undefined && options.filterMinContextSize > 0) {
            modelKwargs.min_context_size = options.filterMinContextSize;
        }
        if (options.filterPreferFast) {
            modelKwargs.prefer_fast = options.filterPreferFast;
        }
        if (options.filterMinSuccessRate !== undefined && options.filterMinSuccessRate > 0) {
            modelKwargs.min_success_rate = options.filterMinSuccessRate;
        }

        // Create model instance
        const llm = new FreeLlmRouterChatModel({
            baseUrl: credentials.baseUrl as string,
            headers,
            model,
            temperature,
            maxTokens,
            topP: options.topP,
            frequencyPenalty: options.frequencyPenalty,
            presencePenalty: options.presencePenalty,
            timeout: options.timeout,
            modelKwargs: Object.keys(modelKwargs).length > 0 ? modelKwargs : undefined,
        });

        return {
            response: llm,
        };
    }
}
