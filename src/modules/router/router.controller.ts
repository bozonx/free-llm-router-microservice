import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
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
   * Supports both streaming (SSE) and non-streaming modes
   */
  @Post('chat/completions')
  @HttpCode(HttpStatus.OK)
  public async chatCompletion(
    @Body() request: ChatCompletionRequestDto,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ): Promise<ChatCompletionResponseDto | void> {
    const abortController = new AbortController();
    const signal = abortController.signal;

    // Safely abort on client disconnect with try-catch to handle edge cases
    const closeListener = () => {
      try {
        if (!signal.aborted) {
          this.logger.debug('Client disconnected, cancelling request');
          abortController.abort();
        }
      } catch {
        // Ignore abort errors - request may have already completed
      }
    };

    req.raw.on('close', closeListener);

    try {
      // Check if streaming is requested
      if (request.stream) {
        // Set SSE headers
        res.raw.setHeader('Content-Type', 'text/event-stream');
        res.raw.setHeader('Cache-Control', 'no-cache');
        res.raw.setHeader('Connection', 'keep-alive');

        // Stream chunks
        try {
          for await (const chunk of this.routerService.chatCompletionStream(request, signal)) {
            // Format as SSE event
            const sseData: Record<string, unknown> = {
              id: chunk.id,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: chunk.model,
              choices: [
                {
                  index: 0,
                  delta: chunk.delta,
                  finish_reason: chunk.finishReason ?? null,
                },
              ],
            };

            // Include router metadata if present (usually in first chunk)
            if (chunk._router) {
              sseData._router = chunk._router;
            }

            res.raw.write(`data: ${JSON.stringify(sseData)}\n\n`);
          }

          // Send [DONE] message
          res.raw.write('data: [DONE]\n\n');
          res.raw.end();
        } catch (error) {
          if (signal.aborted) {
            this.logger.debug('Streaming request cancelled due to client disconnection');
          } else {
            this.logger.error(
              `Streaming chat completion failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          // Try to send error as SSE if stream not ended
          if (!res.raw.writableEnded) {
            res.raw.write(
              `data: ${JSON.stringify({ error: { message: error instanceof Error ? error.message : 'Unknown error' } })}\n\n`,
            );
            res.raw.end();
          }
          throw error;
        }
      } else {
        // Non-streaming mode
        const response = await this.routerService.chatCompletion(request, signal);
        res.send(response);
        return response;
      }
    } catch (error) {
      if (!request.stream) {
        if (signal.aborted) {
          this.logger.debug('Request cancelled due to client disconnection');
        } else {
          this.logger.error(
            `Chat completion failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        throw error;
      }
      // For streaming, error already handled above
    } finally {
      req.raw.off('close', closeListener);
    }
  }

  /**
   * Get available models
   * GET /api/v1/models
   */
  @Get('models')
  public getModels(): ModelsResponseDto {
    const models = this.modelsService.getAvailable();

    return {
      models: models.map(model => ({
        name: model.name,
        provider: model.provider,
        model: model.model,
        type: model.type,
        contextSize: model.contextSize,
        maxOutputTokens: model.maxOutputTokens,
        tags: model.tags,
        jsonResponse: model.jsonResponse,
        available: model.available,
        weight: model.weight,

        // Multimodal support fields
        supportsVision: model.supportsVision,
        supportsImage: model.supportsImage,
        supportsVideo: model.supportsVideo,
        supportsAudio: model.supportsAudio,
        supportsFile: model.supportsFile,
      })),
    };
  }
}
