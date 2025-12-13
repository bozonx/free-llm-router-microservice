import { Module, forwardRef } from '@nestjs/common';
import { StateService } from './state.service.js';
import { CircuitBreakerService } from './circuit-breaker.service.js';
import { ModelsModule } from '../models/models.module.js';

@Module({
  imports: [forwardRef(() => ModelsModule)],
  providers: [StateService, CircuitBreakerService],
  exports: [StateService, CircuitBreakerService],
})
export class StateModule {}
