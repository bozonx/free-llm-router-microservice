import { Test, TestingModule } from '@nestjs/testing';
import { RoundRobinStrategy } from '../../../../src/modules/selector/strategies/round-robin.strategy.js';
import type { ModelDefinition } from '../../../../src/modules/models/interfaces/model.interface.js';

describe('RoundRobinStrategy', () => {
    let strategy: RoundRobinStrategy;

    const mockModels: ModelDefinition[] = [
        { name: 'model1', provider: 'p1', available: true } as any,
        { name: 'model2', provider: 'p2', available: true } as any,
        { name: 'model3', provider: 'p3', available: true } as any,
    ];

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [RoundRobinStrategy],
        }).compile();

        strategy = module.get<RoundRobinStrategy>(RoundRobinStrategy);
    });

    it('should be defined', () => {
        expect(strategy).toBeDefined();
    });

    describe('select', () => {
        it('should cycle through models sequentially', () => {
            expect(strategy.select(mockModels, {})?.name).toBe('model1');
            expect(strategy.select(mockModels, {})?.name).toBe('model2');
            expect(strategy.select(mockModels, {})?.name).toBe('model3');
            expect(strategy.select(mockModels, {})?.name).toBe('model1');
        });

        it('should skip excluded models', () => {
            const result = strategy.select(mockModels, { excludeModels: ['model1'] });
            // Since model1 is excluded, and index starts at 0, logic might vary depending on implementation detail.
            // Our implementation filters first, then selects by index.
            // available: [model2, model3]. index=0 -> model2.

            expect(result?.name).toBe('model2');

            // Next call: index=1 -> model3
            expect(strategy.select(mockModels, { excludeModels: ['model1'] })?.name).toBe('model3');
        });

        it('should return null if all models excluded', () => {
            const result = strategy.select(mockModels, {
                excludeModels: ['model1', 'model2', 'model3']
            });
            expect(result).toBeNull();
        });

        it('should return null for empty models list', () => {
            expect(strategy.select([], {})).toBeNull();
        });
    });

    describe('reset', () => {
        it('should reset index to 0', () => {
            strategy.select(mockModels, {}); // index becomes 1
            strategy.select(mockModels, {}); // index becomes 2

            strategy.reset();

            // Should start from beginning
            expect(strategy.select(mockModels, {})?.name).toBe('model1');
        });
    });
});
