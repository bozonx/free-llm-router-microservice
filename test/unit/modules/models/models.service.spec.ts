import { Test, type TestingModule } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { ModelsService } from '../../../../src/modules/models/models.service.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTER_CONFIG } from '../../../../src/config/router-config.provider.js';

describe('ModelsService', () => {
  let service: ModelsService;
  const testModelsFile = join(process.cwd(), 'test-models.yaml');

  const testModelsYaml = `
models:
  - name: test-fast-model
    provider: openrouter
    model: test/fast:free
    type: fast
    contextSize: 8000
    maxOutputTokens: 2000
    tags: [general, code]
    jsonResponse: true
    available: true

  - name: test-reasoning-model
    provider: deepseek
    model: test/reasoning
    type: reasoning
    contextSize: 64000
    maxOutputTokens: 8000
    tags: [reasoning, math]
    jsonResponse: true
    available: true

  - name: test-unavailable-model
    provider: openrouter
    model: test/unavailable:free
    type: fast
    contextSize: 4000
    maxOutputTokens: 1000
    tags: [simple]
    jsonResponse: false
    available: false
`;

  beforeEach(async () => {
    // Create test models file
    writeFileSync(testModelsFile, testModelsYaml, 'utf-8');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelsService,
        {
          provide: ROUTER_CONFIG,
          useValue: {
            modelsFile: testModelsFile,
            modelOverrides: [],
          },
        },
      ],
    }).compile();

    service = module.get<ModelsService>(ModelsService);
    await service.onModuleInit();
  });

  afterEach(() => {
    // Clean up test file
    try {
      unlinkSync(testModelsFile);
    } catch {
      // ignore
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAll', () => {
    it('should return all models', () => {
      const models = service.getAll();
      expect(models).toHaveLength(3);
      expect(models.map(m => m.name)).toEqual([
        'test-fast-model',
        'test-reasoning-model',
        'test-unavailable-model',
      ]);
    });
  });

  describe('getAvailable', () => {
    it('should return only available models', () => {
      const models = service.getAvailable();
      expect(models).toHaveLength(2);
      expect(models.map(m => m.name)).toEqual(['test-fast-model', 'test-reasoning-model']);
    });
  });

  describe('findByName', () => {
    it('should find model by name', () => {
      const model = service.findByName('test-fast-model');
      expect(model).toBeDefined();
      expect(model?.name).toBe('test-fast-model');
      expect(model?.provider).toBe('openrouter');
    });

    it('should return undefined for non-existent model', () => {
      const model = service.findByName('non-existent');
      expect(model).toBeUndefined();
    });
  });

  describe('filter', () => {
    it('should filter by tags', () => {
      const models = service.filter({ tags: ['code'] });
      expect(models).toHaveLength(1);
      expect(models[0]?.name).toBe('test-fast-model');
    });

    it('should filter by type', () => {
      const models = service.filter({ type: 'reasoning' });
      expect(models).toHaveLength(1);
      expect(models[0]?.name).toBe('test-reasoning-model');
    });

    it('should filter by minimum context size', () => {
      const models = service.filter({ minContextSize: 60000 });
      expect(models).toHaveLength(1);
      expect(models[0]?.name).toBe('test-reasoning-model');
    });

    it('should filter by minimum max output tokens', () => {
      const models = service.filter({ minMaxOutputTokens: 5000 });
      expect(models).toHaveLength(1);
      expect(models[0]?.name).toBe('test-reasoning-model');
    });

    it('should filter by JSON response support', () => {
      const models = service.filter({ jsonResponse: true });
      expect(models).toHaveLength(2);
      expect(models.map(m => m.name)).toEqual(['test-fast-model', 'test-reasoning-model']);
    });

    it('should filter by provider', () => {
      const models = service.filter({ provider: 'deepseek' });
      expect(models).toHaveLength(1);
      expect(models[0]?.name).toBe('test-reasoning-model');
    });

    it('should filter by multiple criteria', () => {
      const models = service.filter({
        type: 'fast',
        tags: ['code'],
        jsonResponse: true,
      });
      expect(models).toHaveLength(1);
      expect(models[0]?.name).toBe('test-fast-model');
    });

    it('should exclude unavailable models', () => {
      const models = service.filter({ tags: ['simple'] });
      expect(models).toHaveLength(0);
    });

    it('should return empty array when no models match', () => {
      const models = service.filter({ tags: ['nonexistent'] });
      expect(models).toHaveLength(0);
    });

    it('should filter using OR logic with | separator', () => {
      // Should match model with either 'code' OR 'reasoning' tag
      const modelsOr = service.filter({ tags: ['code|reasoning'] });
      expect(modelsOr).toHaveLength(2);
      expect(modelsOr.map(m => m.name)).toContain('test-fast-model');
      expect(modelsOr.map(m => m.name)).toContain('test-reasoning-model');

      // Should match models that have 'math' tag AND (either 'code' OR 'reasoning')
      const modelsAndOr = service.filter({ tags: ['code|reasoning', 'math'] });
      expect(modelsAndOr).toHaveLength(1);
      expect(modelsAndOr[0]?.name).toBe('test-reasoning-model');
    });
  });

  describe('overrides', () => {
    it('should apply overrides correctly', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ModelsService,
          {
            provide: ROUTER_CONFIG,
            useValue: {
              modelsFile: testModelsFile,
              modelOverrides: [
                {
                  name: 'test-fast-model',
                  weight: 10,
                  available: false,
                },
              ],
            },
          },
        ],
      }).compile();

      const overrideService = module.get<ModelsService>(ModelsService);
      await overrideService.onModuleInit();

      const model = overrideService.findByName('test-fast-model');
      expect(model).toBeDefined();
      expect(model?.weight).toBe(10);
      expect(model?.available).toBe(false);
    });
  });

  describe('URL loading', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should load models from HTTP URL', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve(testModelsYaml),
        headers: {
          get: () => 'text/yaml',
        },
      } as unknown as Response;

      global.fetch = jest.fn(() => Promise.resolve(mockResponse)) as typeof global.fetch;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ModelsService,
          {
            provide: ROUTER_CONFIG,
            useValue: {
              modelsFile: 'https://example.com/models.yaml',
              modelOverrides: [],
            },
          },
        ],
      }).compile();

      const urlService = module.get<ModelsService>(ModelsService);
      await urlService.onModuleInit();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/models.yaml',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(urlService.getAll()).toHaveLength(3);
    });

    it('should throw error on fetch failure', async () => {
      global.fetch = jest.fn(() =>
        Promise.reject(new Error('Network error')),
      ) as typeof global.fetch;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ModelsService,
          {
            provide: ROUTER_CONFIG,
            useValue: {
              modelsFile: 'https://example.com/models.yaml',
              modelOverrides: [],
            },
          },
        ],
      }).compile();

      const urlService = module.get<ModelsService>(ModelsService);

      await expect(urlService.onModuleInit()).rejects.toThrow(
        'Failed to fetch models file from https://example.com/models.yaml: Network error',
      );
    });

    it('should throw error on non-OK response', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response;

      global.fetch = jest.fn(() => Promise.resolve(mockResponse)) as typeof global.fetch;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ModelsService,
          {
            provide: ROUTER_CONFIG,
            useValue: {
              modelsFile: 'https://example.com/models.yaml',
              modelOverrides: [],
            },
          },
        ],
      }).compile();

      const urlService = module.get<ModelsService>(ModelsService);

      await expect(urlService.onModuleInit()).rejects.toThrow(
        'Failed to fetch models file from https://example.com/models.yaml: HTTP 404 Not Found',
      );
    });
  });
});
