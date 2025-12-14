import {
    type INodeType,
    type INodeTypeDescription,
    type SupplyData,
    type ISupplyDataFunctions,
    type INodeProperties,
    NodeConnectionTypes,
} from 'n8n-workflow';
import { ChatOpenAI } from '@langchain/openai';

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
                displayName: 'Model Selection',
                name: 'modelSelection',
                type: 'options',
                options: [
                    {
                        name: 'Auto (Smart Strategy)',
                        value: 'auto',
                        description: 'Let the router automatically select the best model',
                    },
                    {
                        name: 'Specific Model',
                        value: 'specific',
                        description: 'Choose a specific model',
                    },
                    {
                        name: 'Priority List',
                        value: 'priority',
                        description: 'Provide a list of models in priority order',
                    },
                ],
                default: 'auto',
                description: 'How to select the model for requests',
            },
            {
                displayName: 'Model Name',
                name: 'modelName',
                type: 'string',
                default: '',
                placeholder: 'llama-3.3-70b',
                description: 'Name of the model to use (can include provider: openrouter/model-name)',
                displayOptions: {
                    show: {
                        modelSelection: ['specific'],
                    },
                },
            },
            {
                displayName: 'Model Priority List',
                name: 'modelList',
                type: 'string',
                default: '',
                placeholder: 'openrouter/deepseek-r1, llama-3.3-70b, auto',
                description:
                    'Comma-separated list of models in priority order. Add "auto" at the end to fallback to Smart Strategy',
                displayOptions: {
                    show: {
                        modelSelection: ['priority'],
                    },
                },
            },
            // Model parameters
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
            // Advanced options
            {
                displayName: 'Options',
                name: 'options',
                type: 'collection',
                placeholder: 'Add Option',
                default: {},
                options: [
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
                ],
            },
            // Router-specific filtering
            {
                displayName: 'Filter Options',
                name: 'filterOptions',
                type: 'collection',
                placeholder: 'Add Filter',
                default: {},
                description: 'Options for filtering models in Smart Strategy mode',
                displayOptions: {
                    show: {
                        modelSelection: ['auto'],
                    },
                },
                options: [
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
                        displayName: 'Minimum Context Size',
                        name: 'minContextSize',
                        type: 'number',
                        default: 0,
                        description: 'Minimum context window size required',
                    },
                    {
                        displayName: 'JSON Response',
                        name: 'jsonResponse',
                        type: 'boolean',
                        default: false,
                        description: 'Whether to require models that support JSON response mode',
                    },
                    {
                        displayName: 'Prefer Fast',
                        name: 'preferFast',
                        type: 'boolean',
                        default: false,
                        description: 'Whether to prefer models with lowest latency',
                    },
                    {
                        displayName: 'Minimum Success Rate',
                        name: 'minSuccessRate',
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
        const modelSelection = this.getNodeParameter('modelSelection', itemIndex) as string;
        const temperature = this.getNodeParameter('temperature', itemIndex) as number;
        const maxTokens = this.getNodeParameter('maxTokens', itemIndex) as number;
        const options = this.getNodeParameter('options', itemIndex, {}) as {
            topP?: number;
            frequencyPenalty?: number;
            presencePenalty?: number;
            timeout?: number;
        };

        let model: string | string[] = 'auto';

        if (modelSelection === 'specific') {
            model = this.getNodeParameter('modelName', itemIndex) as string;
        } else if (modelSelection === 'priority') {
            const modelList = this.getNodeParameter('modelList', itemIndex) as string;
            model = modelList.split(',').map((m) => m.trim());
        }

        const filterOptions =
            modelSelection === 'auto'
                ? (this.getNodeParameter('filterOptions', itemIndex, {}) as {
                    tags?: string;
                    type?: string;
                    minContextSize?: number;
                    jsonResponse?: boolean;
                    preferFast?: boolean;
                    minSuccessRate?: number;
                })
                : {};

        const configuration: Record<string, unknown> = {
            temperature,
            maxTokens,
            modelName: model,
            openAIApiKey: 'not-needed',
        };

        if (options.topP !== undefined) {
            configuration.topP = options.topP;
        }
        if (options.frequencyPenalty !== undefined) {
            configuration.frequencyPenalty = options.frequencyPenalty;
        }
        if (options.presencePenalty !== undefined) {
            configuration.presencePenalty = options.presencePenalty;
        }
        if (options.timeout !== undefined) {
            configuration.timeout = options.timeout;
        }

        // Add filter options as model kwargs
        const modelKwargs: Record<string, unknown> = {};

        if (filterOptions.tags) {
            modelKwargs.tags = filterOptions.tags.split(',').map((t) => t.trim());
        }
        if (filterOptions.type) {
            modelKwargs.type = filterOptions.type;
        }
        if (filterOptions.minContextSize) {
            modelKwargs.min_context_size = filterOptions.minContextSize;
        }
        if (filterOptions.jsonResponse) {
            modelKwargs.json_response = filterOptions.jsonResponse;
        }
        if (filterOptions.preferFast) {
            modelKwargs.prefer_fast = filterOptions.preferFast;
        }
        if (filterOptions.minSuccessRate) {
            modelKwargs.min_success_rate = filterOptions.minSuccessRate;
        }

        if (Object.keys(modelKwargs).length > 0) {
            configuration.modelKwargs = modelKwargs;
        }

        configuration.configuration = {
            baseURL: credentials.baseUrl as string,
            defaultHeaders:
                credentials.authentication !== 'none'
                    ? {
                        Authorization:
                            credentials.authentication === 'bearer'
                                ? `Bearer ${credentials.token}`
                                : `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
                    }
                    : {},
        };

        const llm = new ChatOpenAI(configuration);

        return {
            response: llm,
        };
    }
}
