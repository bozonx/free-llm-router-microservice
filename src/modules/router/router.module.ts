import { Module } from '@nestjs/common';
import { RouterController } from './router.controller.js';
import { RouterService } from './router.service.js';
import { ModelsModule } from '../models/models.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { SelectorModule } from '../selector/selector.module.js';
import { StateModule } from '../state/state.module.js';

/**
 * Router module for handling chat completion requests
 */
@Module({
  imports: [ModelsModule, ProvidersModule.forRoot(), SelectorModule, StateModule],
  controllers: [RouterController],
  providers: [RouterService],
  exports: [RouterService],
})
export class RouterModule {}
