import { Module } from '@nestjs/common';
import { SelectorService } from './selector.service.js';
import { RoundRobinStrategy } from './strategies/round-robin.strategy.js';
import { ModelsModule } from '../models/models.module.js';

/**
 * Module for model selection
 */
@Module({
  imports: [ModelsModule],
  providers: [SelectorService, RoundRobinStrategy],
  exports: [SelectorService],
})
export class SelectorModule {}
