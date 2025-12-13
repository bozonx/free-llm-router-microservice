import { Injectable, Logger } from '@nestjs/common';
import { RETRY_JITTER_PERCENT } from '../../../common/constants/retry.constants.js';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
}

@Injectable()
export class RetryHandlerService {
  private readonly logger = new Logger(RetryHandlerService.name);

  calculateRetryDelay(baseDelay: number): number {
    const jitter = (Math.random() - 0.5) * 2 * ((baseDelay * RETRY_JITTER_PERCENT) / 100);
    return Math.max(0, Math.round(baseDelay + jitter));
  }

  async sleep(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      setTimeout(resolve, ms);
    });
  }

  async executeWithRetry<T>(params: {
    operation: () => Promise<T>;
    maxRetries: number;
    retryDelay: number;
    shouldRetry: (error: unknown) => boolean;
    onRetry?: (attempt: number, error: unknown) => void;
  }): Promise<T> {
    const { operation, maxRetries, retryDelay, shouldRetry, onRetry } = params;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxRetries || !shouldRetry(error)) {
          throw error;
        }

        const delay = this.calculateRetryDelay(retryDelay);
        onRetry?.(attempt + 1, error);

        await this.sleep(delay);
      }
    }

    throw new Error('Retry logic failed unexpectedly');
  }
}
