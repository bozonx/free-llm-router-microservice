# n8n Node Implementation

## Overview

The n8n node package provides a LangChain-compatible interface for the Free LLM Router Microservice. This allows n8n users to leverage the smart routing capabilities within their LangChain workflows.

## Architecture

### Components

1. **FreeLlmRouterApi.credentials.ts**
   - Credential type definition
   - Supports three authentication methods: None, Basic Auth, Bearer Token
   - Includes credential test endpoint (`/health`)

2. **FreeLlmRouter.node.ts**
   - Main node implementation
   - Supplies `ChatOpenAI` model to LangChain
   - Maps n8n parameters to router API format
   - Handles model selection modes (auto/specific/priority)

3. **Icon & Assets**
   - SVG icon for visual identification in n8n UI

## Design Decisions

### LangChain Compatibility

The node uses `ChatOpenAI` from `@langchain/openai` with custom configuration:
- Base URL points to the router microservice
- API key is set to dummy value (not used by microservice)
- All router-specific parameters are passed via `modelKwargs`

This approach ensures:
- ✅ Full compatibility with existing LangChain nodes
- ✅ Standard OpenAI parameter support
- ✅ Router-specific features via model kwargs

### Model Selection

Three modes are supported:

1. **Auto Mode**
   - Uses Smart Strategy from the microservice
   - Supports all filter options (tags, type, context size, etc.)
   - Best for letting the router optimize model selection

2. **Specific Model**
   - User specifies exact model name
   - Can include provider prefix (e.g., `openrouter/model-name`)
   - Best for deterministic behavior

3. **Priority List**
   - Comma-separated list of models
   - Router tries them in order
   - Can include `auto` at the end for fallback
   - Best for custom fallback strategies

### Parameter Mapping

n8n UI parameters → Router API format:

```typescript
{
  // Standard OpenAI params (direct mapping)
  temperature: number
  max_tokens: number
  top_p: number
  frequency_penalty: number
  presence_penalty: number
  
  // Model selection
  model: string | string[]
  
  // Router filters (via modelKwargs)
  tags: string[]
  type: 'fast' | 'reasoning'
  min_context_size: number
  response_format: { type: 'json_object' }
  prefer_fast: boolean
  min_success_rate: number
}
```

## Implementation Notes

### Authentication Flow

1. User configures credentials in n8n
2. Credential data is retrieved in `supplyData()`
3. Headers are constructed based on auth type:
   - None: No Authorization header
   - Basic: `Authorization: Basic <base64>`
   - Bearer: `Authorization: Bearer <token>`
4. Headers are passed to ChatOpenAI via `configuration.defaultHeaders`

### Error Handling

Error handling is delegated to:
- LangChain's built-in error handling
- Router microservice error responses
- n8n's workflow error handling

### Performance Considerations

- Node initialization is lightweight (configuration only)
- Actual LLM calls happen during LangChain execution
- No caching or state management in the node itself

## Future Enhancements

Potential improvements:

1. **Streaming Support**
   - Add streaming mode when microservice supports it
   - Use LangChain's streaming callbacks

2. **Dynamic Model List**
   - Fetch available models from `/api/v1/models`
   - Populate dropdown in UI

3. **Response Metadata Display**
   - Extract `_router` metadata from responses
   - Display in n8n UI for debugging

4. **Advanced Monitoring**
   - Connect to Admin API endpoints
   - Show circuit breaker status
   - Display model metrics

## Testing Strategy

### Manual Testing

1. Unit tests for parameter mapping
2. Integration tests with running microservice
3. End-to-end workflow tests in n8n

### Continuous Integration

Future CI/CD pipeline could include:
- TypeScript compilation check
- ESLint validation
- Build artifact verification
- Version consistency checks

## Maintenance

### Version Updates

When updating the node:

1. Update version in `package.json`
2. Document changes in `CHANGELOG.md`
3. Test against target microservice version
4. Publish to npm

### Compatibility

The node should maintain backward compatibility with:
- n8n API version 1
- LangChain OpenAI provider interface
- Free LLM Router API v1

## Resources

- [n8n Node Development Guide](https://docs.n8n.io/integrations/creating-nodes/)
- [LangChain JS Documentation](https://js.langchain.com/)
- [Free LLM Router API Spec](../../README.md)
