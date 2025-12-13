import { Controller, Post, Get, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { RouterService } from './router.service.js';
import { ModelsService } from '../models/models.service.js';
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
   */
  @Post('chat/completions')
  @HttpCode(HttpStatus.OK)
  public async chatCompletion(
    @Body() request: ChatCompletionRequestDto,
  ): Promise<ChatCompletionResponseDto> {
    this.logger.log('Received chat completion request');
    this.logger.debug(`Request details: ${JSON.stringify(request)}`);

    try {
      const response = await this.routerService.chatCompletion(request);
      this.logger.log(
        `Request completed successfully using ${response._router.model_name} (${response._router.provider})`,
      );
      return response;
    } catch (error) {
      this.logger.error(
        `Chat completion failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
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
