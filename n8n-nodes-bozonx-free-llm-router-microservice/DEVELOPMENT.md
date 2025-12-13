# Development Guide

This guide covers development and testing of the Free LLM Router n8n node.

## Setup for Development

### 1. Install Dependencies

From the n8n-nodes directory:

```bash
cd n8n-nodes-bozonx-free-llm-router-microservice
pnpm install
```

### 2. Build the Node

```bash
pnpm build
```

This will:
- Compile TypeScript to JavaScript in `dist/` directory
- Copy icon files to `dist/nodes/`

### 3. Link to Local n8n Instance

To test the node in a local n8n instance:

```bash
# Link the package
pnpm link

# In your n8n installation directory
cd ~/.n8n/nodes
pnpm link n8n-nodes-bozonx-free-llm-router-microservice

# Restart n8n
```

### 4. Development Workflow

Watch mode for automatic rebuilds:

```bash
pnpm dev
```

After changes, restart your n8n instance to see updates.

## Testing

### Manual Testing

1. Start the Free LLM Router microservice:
   ```bash
   cd ../
   pnpm start:dev
   ```

2. Open n8n and create a test workflow:
   - Add "Free LLM Router Model" node
   - Configure credentials
   - Connect to "Basic LLM Chain"
   - Add a prompt and execute

### Example Test Workflow

```json
{
  "nodes": [
    {
      "type": "n8n-nodes-bozonx-free-llm-router-microservice.freeLlmRouter",
      "parameters": {
        "modelSelection": "auto",
        "temperature": 0.7,
        "maxTokens": 1000
      },
      "credentials": {
        "freeLlmRouterApi": "My Router Credentials"
      }
    },
    {
      "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      "parameters": {
        "prompt": "Tell me a joke"
      }
    }
  ]
}
```

## Code Quality

### Linting

```bash
pnpm lint
```

Fix automatically:

```bash
pnpm lintfix
```

### Formatting

```bash
pnpm format
```

## Publishing

### Before Publishing

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Test build: `pnpm build`
4. Test lint: `pnpm lint`

### Publish to npm

```bash
npm publish
```

## Project Structure

```
n8n-nodes-bozonx-free-llm-router-microservice/
├── credentials/
│   └── FreeLlmRouterApi.credentials.ts    # Authentication credentials
├── nodes/
│   └── FreeLlmRouter/
│       ├── FreeLlmRouter.node.ts          # Main node implementation
│       └── free-llm-router.svg            # Node icon
├── dist/                                   # Compiled output (git-ignored)
├── package.json                           # Package metadata
├── tsconfig.json                          # TypeScript config
├── gulpfile.js                            # Build scripts
└── README.md                              # User documentation
```

## Common Issues

### TypeScript Errors

If you see errors about missing types:
```bash
pnpm install
```

### Node Not Appearing in n8n

1. Check `package.json` - ensure paths in `n8n` section are correct
2. Rebuild: `pnpm build`
3. Check `dist/` folder has all files
4. Restart n8n completely

### Icon Not Showing

1. Check `nodes/FreeLlmRouter/free-llm-router.svg` exists
2. Ensure gulp built successfully: `pnpm build`
3. Check `dist/nodes/FreeLlmRouter/free-llm-router.svg` exists

## Resources

- [n8n Node Development Docs](https://docs.n8n.io/integrations/creating-nodes/)
- [LangChain JavaScript Docs](https://js.langchain.com/)
- [Free LLM Router Microservice](https://github.com/bozonx/free-llm-router-microservice)
