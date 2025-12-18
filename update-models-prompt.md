# Prompt for LLM: Update models.yaml

## Task Overview

You are tasked with updating the `models.yaml` file by fetching the latest model information from the OpenRouter API. The goal is to keep the model list current by adding new models, updating existing ones, and removing models that are no longer available.

## Step 1: Run the Fetch Script

**IMPORTANT**: Before proceeding with the update, you MUST first run the fetch script to get the filtered list of models:

```bash
cd /mnt/disk2/workspace/free-llm-router-microservice
pnpm update-models
```

This script will:
- Fetch all models from OpenRouter API
- Filter out non-LLM models (image/video/STT/embedding models)
- Filter out models that don't support streaming, tools, and JSON response
- Keep only FREE models (pricing.prompt === '0' AND pricing.completion === '0')
- Output the filtered list as JSON to stdout

**Capture the output** of this script - it contains all the models you need to process.

## Step 2: Analyze the Script Output

The script outputs a JSON object with the following structure:

```json
{
  "fetchedAt": "2025-12-18T10:00:00.000Z",
  "totalModels": 500,
  "filteredModels": 30,
  "models": [
    {
      "id": "meta-llama/llama-3.3-70b-instruct:free",
      "name": "Meta: Llama 3.3 70B Instruct",
      "contextLength": 131072,
      "maxOutputTokens": 4096,
      "pricing": {
        "prompt": "0",
        "completion": "0"
      },
      "architecture": {
        "modality": "text",
        "tokenizer": "llama3",
        "instruct_type": "llama3"
      }
    }
  ]
}
```

Use this data to update `models.yaml`.

## Requirements

### 1. Model Filtering

**Note**: The fetch script has already filtered models based on the following criteria:
- ✅ Only FREE models (pricing.prompt === '0' AND pricing.completion === '0')
- ✅ Only text-based LLM models (excludes image/video/STT/embedding models)
- ✅ Only models supporting streaming
- ✅ Only models supporting tools/function calling
- ✅ Only models supporting JSON response mode

You can trust that all models in the script output meet these requirements.

### 2. Model Properties to Extract

For each model, extract and map the following properties:

```yaml
name: string              # Simplified model name (see naming rules below)
provider: string          # Provider name (e.g., 'openrouter', 'deepseek')
model: string            # Full model ID from API (e.g., 'meta-llama/llama-3.3-70b-instruct:free')
type: string             # 'fast' or 'reasoning' (see type detection rules)
contextSize: number      # From context_length field
maxOutputTokens: number  # From top_provider.max_completion_tokens or default 4096
speedTier: string        # 'fast', 'medium', or 'slow' (see speed tier rules)
tags: string[]           # Array of tags (see tagging rules)
jsonResponse: boolean    # Always true (filtered requirement)
available: boolean       # Always true for active models
weight: number           # Priority weight (see weight rules)
supportsVision: boolean  # Optional, only if model supports vision
```

### 3. Naming Rules

**Simplified Name (`name` field)**:
- Extract the model name after the provider prefix
- Remove the `:free` suffix
- Examples:
  - `meta-llama/llama-3.3-70b-instruct:free` → `llama-3.3-70b-instruct`
  - `google/gemini-2.0-flash-exp:free` → `gemini-2.0-flash-exp`
  - `mistralai/mistral-7b-instruct:free` → `mistral-7b-instruct`

### 4. Type Detection Rules

Determine the `type` field based on model characteristics:
- **reasoning**: If model ID contains 'reasoning', 'deepseek-r1', 'r1t', or similar reasoning indicators
- **fast**: All other models (default)

### 5. Speed Tier Detection Rules

Determine `speedTier` based on model size and characteristics:
- **fast**: Models with < 20B parameters, or models optimized for speed
- **medium**: Models with 20B-100B parameters
- **slow**: Models with > 100B parameters, or reasoning models

Use heuristics from model name/ID:
- Contains '3b', '4b', '7b', '9b', '12b' → fast
- Contains '20b', '24b', '27b', '30b', '32b', '70b' → medium
- Contains '120b', '235b', '405b' → slow
- Reasoning models → slow (regardless of size)

### 6. Tagging Rules

Generate tags based on model characteristics:

**Base Tags**:
- `general`: Always include for general-purpose models

**Capability Tags**:
- `code`: If model ID contains 'code', 'coder', 'codestral', 'devstral'
- `reasoning`: If model ID contains 'reasoning', 'r1', 'think', 'deepresearch'
- `vision`: If model supports vision (check `architecture.modalities` for image support)

**Provider Tags** (simplified name without version):
- Extract the actual provider/creator from model ID
- Examples:
  - `meta-llama/llama-3.3-70b-instruct` → add tag `meta-llama-3` (major version)
  - `google/gemini-2.0-flash-exp` → add tag `google-gemini-2`
  - `mistralai/mistral-7b-instruct` → add tag `mistral-7b`
  - `anthropic/claude-3-opus` → add tag `anthropic-claude-3`

**Version Strategy for Tags**:
- Include the provider name
- Include major version number (e.g., '3', '2', '7b')
- Omit minor versions and patch versions
- This allows selecting models by family without being tied to exact versions

### 7. Weight Rules

Assign priority weights based on model quality/popularity:
- **10**: Premium models (e.g., llama-3.3-70b, claude-3-opus)
- **5**: Reasoning models (e.g., deepseek-r1, r1t models)
- **3**: Google Gemini models
- **1**: Default for all other models

### 8. Vision Support Detection

Set `supportsVision: true` only if:
- `architecture.modalities` includes 'image' or 'vision'
- OR model ID contains 'vision', 'vl', 'multimodal'

### 9. File Organization

The `models.yaml` file must be organized as follows:

```yaml
models:
  # ============================================
  # OpenRouter Models
  # ============================================
  # Last updated: YYYY-MM-DD HH:MM UTC
  # Total models: XX
  
  # --- Reasoning Models ---
  - name: model-name
    provider: openrouter
    # ... properties
  
  # --- Vision Models ---
  - name: model-name
    provider: openrouter
    # ... properties
  
  # --- Code Models ---
  - name: model-name
    provider: openrouter
    # ... properties
  
  # --- General Models ---
  - name: model-name
    provider: openrouter
    # ... properties
  
  # ============================================
  # DeepSeek Models (Direct API)
  # ============================================
  # Last updated: YYYY-MM-DD HH:MM UTC
  
  - name: deepseek-chat
    provider: deepseek
    # ... properties
  
  # ============================================
  # Future Providers
  # ============================================
  # Placeholder for additional providers
```

**Sorting Rules**:
1. Group by provider (OpenRouter, DeepSeek, etc.)
2. Within each provider, create subsections by model category:
   - Reasoning Models
   - Vision Models
   - Code Models
   - General Models
3. Within each subsection, sort models alphabetically by `name` field
4. Add comments for each section with metadata (last updated, count)

### 10. Update Strategy

When updating `models.yaml`:

1. **Fetch** latest models from API
2. **Filter** based on requirements (free, streaming, tools, JSON)
3. **Compare** with existing `models.yaml`:
   - **Add**: New models not in current file
   - **Update**: Existing models with changed properties (contextSize, maxOutputTokens, etc.)
   - **Remove**: Models in file but not in API response (no longer available)
4. **Preserve**: Non-OpenRouter models (e.g., DeepSeek direct API models)
5. **Reorganize**: Sort and group according to organization rules
6. **Write**: Output the updated YAML file

### 11. Example Model Entry

```yaml
- name: llama-3.3-70b-instruct
  provider: openrouter
  model: meta-llama/llama-3.3-70b-instruct:free
  type: fast
  contextSize: 131072
  maxOutputTokens: 4096
  speedTier: medium
  tags:
    - general
    - meta-llama-3
  jsonResponse: true
  available: true
  weight: 10
```

### 12. Validation Checklist

Before finalizing the updated `models.yaml`, verify:

- [ ] All models support streaming, tools, and JSON response
- [ ] All models are free (pricing.prompt === '0' AND pricing.completion === '0')
- [ ] Models are grouped by provider
- [ ] Models within each provider are categorized and sorted alphabetically
- [ ] All required fields are present for each model
- [ ] Section comments include update timestamp and model count
- [ ] Non-OpenRouter models are preserved
- [ ] No duplicate model entries
- [ ] YAML syntax is valid

## Output Format

Provide the complete updated `models.yaml` file content, ready to replace the existing file.

## Additional Notes

- Use UTC timezone for all timestamps
- Maintain consistent indentation (2 spaces)
- Keep comments concise and informative
- If a model's capabilities are unclear from API data, err on the side of exclusion
- Document any assumptions made during the update process
