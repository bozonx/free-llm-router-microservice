# Quick Start Guide

Get started with the Free LLM Router n8n node in 5 minutes.

## Prerequisites

1. ✅ Running Free LLM Router microservice
2. ✅ n8n instance (self-hosted or cloud)

## Step 1: Install the Node

### Option A: n8n UI (Recommended)

1. Open n8n
2. Go to **Settings** → **Community Nodes**
3. Click **Install a community node**
4. Enter: `n8n-nodes-bozonx-free-llm-router-microservice`
5. Click **Install**
6. Wait for installation to complete

### Option B: Manual

```bash
cd ~/.n8n/nodes
npm install n8n-nodes-bozonx-free-llm-router-microservice
# Restart n8n
```

## Step 2: Create Credentials

1. In n8n, click **Credentials** → **New**
2. Search for "Free LLM Router API"
3. Fill in:
   - **Base URL**: `http://your-service:8080/api/v1`
   - **Authentication**: Choose method (usually "None" for local)
4. Click **Save**

Test the connection - it should ping `/health` endpoint.

## Step 3: Create Your First Workflow

### Simple Chat Example

1. Create new workflow
2. Add **Free LLM Router Model** node
   - Select your credentials
   - Model Selection: `Auto (Smart Strategy)`
   - Temperature: `0.7`
   - Maximum Tokens: `1000`

3. Add **Basic LLM Chain** node
   - Connect Free LLM Router to `model` input
   - Prompt: `What is 2+2? Explain step by step.`

4. Execute the workflow!

### Example with Code Generation

1. Add **Free LLM Router Model** node
   - Model Selection: `Auto`
   - In Filter Options:
     - Tags: `code`
     - Type: `fast`
     - Prefer Fast: `Yes`

2. Add **Basic LLM Chain**
   - Prompt: `Write a Python function to sort a list`

3. Execute!

### Using Specific Models

1. Add **Free LLM Router Model** node
   - Model Selection: `Specific Model`
   - Model Name: `llama-3.3-70b`
   - (or with provider: `openrouter/deepseek-r1`)

2. Add **Basic LLM Chain**
   - Your prompt here

3. Execute!

## Step 4: Check Results

The response will include:
- Standard OpenAI format response
- `_router` metadata showing:
  - Which provider was used
  - Which model was selected
  - Number of attempts
  - Whether fallback was used
  - Any errors encountered

## Common Use Cases

### 1. Smart Routing for General Tasks

```
Model Selection: Auto
Temperature: 0.7
Filter Options: (leave default)
```

### 2. Fast Code Generation

```
Model Selection: Auto
Filter Options:
  - Tags: code
  - Type: fast
  - Prefer Fast: Yes
```

### 3. Reasoning Tasks

```
Model Selection: Auto
Filter Options:
  - Tags: reasoning, math
  - Type: reasoning
```

### 4. Custom Fallback Chain

```
Model Selection: Priority List
Model Priority List: openrouter/deepseek-r1, llama-3.3-70b, auto
```

This tries DeepSeek R1 first, then Llama, then falls back to Smart Strategy.

## Troubleshooting

### Node not appearing

1. Restart n8n completely
2. Clear browser cache
3. Check installation succeeded

### Connection errors

```bash
# Test microservice is running
curl http://your-service:8080/api/v1/health
```

Should return `{"status":"ok"}`

### No models available

Check microservice configuration:
- `models.yaml` has models configured
- Provider API keys are set
- Circuit breaker hasn't blocked all models

```bash
# Check model states
curl http://your-service:8080/api/v1/admin/state
```

## Next Steps

- Read full [README.md](./README.md) for all features
- Check [DEVELOPMENT.md](./DEVELOPMENT.md) for development
- Explore [examples](./README.md#example-workflows)
- Check microservice [documentation](../../README.md)

## Need Help?

- [GitHub Issues](https://github.com/bozonx/free-llm-router-microservice/issues)
- [n8n Community](https://community.n8n.io/)

Happy routing! 🚀
