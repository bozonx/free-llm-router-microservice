import { Module, forwardRef } from '@nestjs/common';
import { StateService } from './state.service.js';
import { CircuitBreakerService } from './circuit-breaker.service.js';
import { ModelsModule } from '../models/models.module.js';
import { routerConfigProvider, ROUTER_CONFIG } from '../../config/router-config.provider.js';

@Module({
  imports: [forwardRef(() => ModelsModule)],
  providers: [routerConfigProvider, StateService, CircuitBreakerService],
  exports: [StateService, CircuitBreakerService, ROUTER_CONFIG],
})
export class StateModule {}
