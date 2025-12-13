import { Test, type TestingModule } from '@nestjs/testing';
import { ModelsService } from '../../../../src/modules/models/models.service.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

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
    speedTier: fast
    tags: [general, code]
    jsonResponse: true
    available: true

  - name: test-reasoning-model
    provider: deepseek
    model: test/reasoning
    type: reasoning
    contextSize: 64000
    maxOutputTokens: 8000
    speedTier: slow
    tags: [reasoning, math]
    jsonResponse: true
    available: true

  - name: test-unavailable-model
    provider: openrouter
    model: test/unavailable:free
    type: fast
    contextSize: 4000
    maxOutputTokens: 1000
    speedTier: fast
    tags: [simple]
    jsonResponse: false
    available: false
`;

  beforeEach(async () => {
    // Create test models file
    writeFileSync(testModelsFile, testModelsYaml, 'utf-8');
    process.env['MODELS_FILE_PATH'] = testModelsFile;

    const module: TestingModule = await Test.createTestingModule({
      providers: [ModelsService],
    }).compile();

    service = module.get<ModelsService>(ModelsService);
    service.onModuleInit();
  });

  afterEach(() => {
    // Clean up test file
    try {
      unlinkSync(testModelsFile);
    } catch {
      // ignore
    }
    delete process.env['MODELS_FILE_PATH'];
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
  });
});
