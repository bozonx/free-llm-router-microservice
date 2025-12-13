import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RouterService } from './router.service.js';
import { ModelsService } from '../models/models.service.js';
import { RateLimiterGuard } from '../rate-limiter/rate-limiter.guard.js';
import { ChatCompletionRequestDto } from './dto/chat-completion.request.dto.js';
import type {
  ChatCompletionResponseDto,
  ModelsResponseDto,
} from './dto/chat-completion.response.dto.js';

/**
 * Controller for router endpoints
 */
@Controller()
export class RouterController {
  private readonly logger = new Logger(RouterController.name);

  constructor(
    private readonly routerService: RouterService,
    private readonly modelsService: ModelsService,
  ) {}

  /**
   * Chat completion endpoint (OpenAI compatible)
   * POST /api/v1/chat/completions
   * Protected by rate limiter
   */
  @Post('chat/completions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimiterGuard)
  public async chatCompletion(
    @Body() request: ChatCompletionRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<ChatCompletionResponseDto> {
    this.logger.log('Received chat completion request');
    this.logger.debug(`Request details: ${JSON.stringify(request)}`);

    const abortController = new AbortController();
    const signal = abortController.signal;

    // Handle client disconnection
    const closeListener = () => {
      if (!signal.aborted) {
        this.logger.warn('Client disconnected, cancelling request');
        abortController.abort();
      }
    };

    req.raw.on('close', closeListener);

    try {
      const response = await this.routerService.chatCompletion(request, signal);
      this.logger.log(
        `Request completed successfully using ${response._router.model_name} (${response._router.provider})`,
      );
      return response;
    } catch (error) {
      if (signal.aborted) {
        this.logger.warn('Request processed failed due to client disconnection');
      } else {
        this.logger.error(
          `Chat completion failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      throw error;
    } finally {
      // Clean up listener to avoid memory leaks
      req.raw.off('close', closeListener);
    }
  }

  /**
   * Get available models
   * GET /api/v1/models
   */
  @Get('models')
  public getModels(): ModelsResponseDto {
    this.logger.log('Received models list request');

    const models = this.modelsService.getAvailable();

    return {
      models: models.map(model => ({
        name: model.name,
        provider: model.provider,
        type: model.type,
        context_size: model.contextSize,
        tags: model.tags,
        available: model.available,
      })),
    };
  }
}
