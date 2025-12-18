import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { RateLimiterService } from './rate-limiter.service.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Guard that enforces rate limiting on protected routes.
 * Adds X-RateLimit-* headers to responses.
 */
@Injectable()
export class RateLimiterGuard implements CanActivate {
  private readonly logger = new Logger(RateLimiterGuard.name);

  constructor(private readonly rateLimiterService: RateLimiterService) { }

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();

    // Skip if rate limiting is disabled
    if (!this.rateLimiterService.isEnabled()) {
      return true;
    }

    // Get client ID from header (optional)
    const clientId = this.getClientId(request);

    // Check rate limits (we don't know the model yet at guard level)
    const result = this.rateLimiterService.checkAll(clientId);

    // Get rate limit info for headers
    const rateLimitInfo = this.rateLimiterService.getRateLimitInfo(clientId);

    if (rateLimitInfo) {
      // Add headers to response
      void response.header('X-RateLimit-Limit', String(rateLimitInfo.limit));
      void response.header('X-RateLimit-Remaining', String(rateLimitInfo.remaining));
      void response.header('X-RateLimit-Reset', String(rateLimitInfo.reset));
    }

    if (!result.allowed) {
      const retryAfter = rateLimitInfo?.retryAfter;
      if (retryAfter) {
        void response.header('Retry-After', String(retryAfter));
      }

      this.logger.warn(
        `Rate limit exceeded for ${result.limitType} (client: ${clientId ?? 'unknown'}, retry after: ${retryAfter ?? 'N/A'}s)`,
      );

      throw new HttpException(
        {
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_error',
            limit_type: result.limitType,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.logger.debug(
      `Rate limit check passed (client: ${clientId ?? 'unknown'}, remaining: ${rateLimitInfo?.remaining ?? 'N/A'}/${rateLimitInfo?.limit ?? 'N/A'})`,
    );

    return true;
  }

  /**
   * Extract client ID from request headers
   */
  private getClientId(request: FastifyRequest): string | undefined {
    // Try X-Client-ID header first
    const clientIdHeader = request.headers['x-client-id'];
    if (clientIdHeader) {
      return Array.isArray(clientIdHeader) ? clientIdHeader[0] : clientIdHeader;
    }

    // Fall back to IP address if no client ID provided
    const ip = request.ip;
    return ip || undefined;
  }
}
