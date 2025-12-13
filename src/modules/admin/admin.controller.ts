import { Controller, Get, Post, Param, NotFoundException, Logger } from '@nestjs/common';
import { StateService } from '../state/state.service.js';
import { RateLimiterService } from '../rate-limiter/rate-limiter.service.js';
import type { ModelState } from '../state/interfaces/state.interface.js';
import type { RateLimitStatus } from '../rate-limiter/interfaces/rate-limiter.interface.js';

@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly stateService: StateService,
    private readonly rateLimiterService: RateLimiterService,
  ) {}

  @Get('state')
  public getStates(): { models: ModelState[]; timestamp: string } {
    return {
      models: this.stateService.getAllStates(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('state/:modelName')
  public getState(@Param('modelName') modelName: string): ModelState {
    if (!this.stateService.hasState(modelName)) {
      throw new NotFoundException(`Model "${modelName}" not found`);
    }
    return this.stateService.getState(modelName);
  }

  @Post('state/:modelName/reset')
  public resetState(@Param('modelName') modelName: string): { message: string } {
    if (!this.stateService.hasState(modelName)) {
      throw new NotFoundException(`Model "${modelName}" not found`);
    }
    this.logger.warn(`Admin action: Resetting state for model ${modelName}`);
    this.stateService.resetState(modelName);
    return { message: `State for model ${modelName} reset` };
  }

  @Get('metrics')
  public getMetrics() {
    const states = this.stateService.getAllStates();

    const totalRequests = states.reduce((sum, s) => sum + s.stats.totalRequests, 0);
    const successfulRequests = states.reduce((sum, s) => sum + s.stats.successCount, 0);
    const failedRequests = states.reduce((sum, s) => sum + s.stats.errorCount, 0);
    const activeConnections = states.reduce((sum, s) => sum + s.activeRequests, 0);

    // Weighted Average Latency
    let totalLatencyProduct = 0;
    let totalLatencyCount = 0;

    states.forEach(s => {
      // Use success count for weighting properly
      if (s.stats.successCount > 0) {
        totalLatencyProduct += s.stats.avgLatency * s.stats.successCount;
        totalLatencyCount += s.stats.successCount;
      }
    });

    const avgLatency = totalLatencyCount > 0 ? totalLatencyProduct / totalLatencyCount : 0;

    const modelsAvailable = states.filter(
      s => s.circuitState === 'CLOSED' || s.circuitState === 'HALF_OPEN',
    ).length;
    const modelsInOpenState = states.filter(s => s.circuitState === 'OPEN').length;
    const modelsPermanentlyUnavailable = states.filter(
      s => s.circuitState === 'PERMANENTLY_UNAVAILABLE',
    ).length;

    return {
      uptime: process.uptime(),
      totalRequests,
      successfulRequests,
      failedRequests,
      fallbacksUsed: this.stateService.getFallbacksUsed(),
      avgLatency: Math.round(avgLatency),
      modelsAvailable,
      modelsInOpenState,
      modelsPermanentlyUnavailable,
      activeConnections,
    };
  }

  @Get('rate-limits')
  public getRateLimits(): RateLimitStatus {
    return this.rateLimiterService.getStatus();
  }
}
