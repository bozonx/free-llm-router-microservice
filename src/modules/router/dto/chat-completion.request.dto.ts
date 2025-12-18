import {
  IsArray,
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  ValidateNested,
  IsIn,
  Min,
  Max,
  ArrayMinSize,
  ValidateIf,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Tool, ToolChoice } from '../../providers/interfaces/tools.interface.js';
import { IsValidToolChoice } from '../validators/tool-choice.validator.js';
import { IsValidContent } from '../validators/content.validator.js';

/**
 * Function parameters DTO (JSON Schema)
 */
export class FunctionParametersDto {
  @IsString()
  @IsIn(['object'])
  public type!: 'object';

  @IsObject()
  public properties!: Record<string, any>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public required?: string[];
}

/**
 * Tool function DTO
 */
export class ToolFunctionDto {
  @IsString()
  public name!: string;

  @IsOptional()
  @IsString()
  public description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => FunctionParametersDto)
  public parameters?: FunctionParametersDto;
}

/**
 * Tool DTO
 */
export class ToolDto {
  @IsString()
  @IsIn(['function'])
  public type!: 'function';

  @ValidateNested()
  @Type(() => ToolFunctionDto)
  public function!: ToolFunctionDto;
}

/**
 * Chat message DTO
 */
/**
 * Chat image URL detailed DTO
 */
export class ChatImageUrlDto {
  @IsString()
  public url!: string;

  @IsOptional()
  @IsString()
  @IsIn(['auto', 'high', 'low'])
  public detail?: 'auto' | 'high' | 'low';
}

/**
 * Chat content part DTO (text or image)
 */
export class ChatContentPartDto {
  @IsString()
  @IsIn(['text', 'image_url'])
  public type!: 'text' | 'image_url';

  @IsOptional()
  @IsString()
  public text?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChatImageUrlDto)
  public image_url?: ChatImageUrlDto;
}

/**
 * Chat message DTO
 */
export class ChatMessageDto {
  @IsString()
  @IsIn(['system', 'user', 'assistant', 'tool'])
  public role!: 'system' | 'user' | 'assistant' | 'tool';

  @IsValidContent()
  public content!: string | ChatContentPartDto[] | null;

  @IsOptional()
  @IsString()
  public name?: string;

  @IsOptional()
  @IsArray()
  public tool_calls?: any[]; // Keep flexible for different formats from LLMs

  @IsOptional()
  @IsString()
  public tool_call_id?: string;
}

/**
 * Chat completion request DTO
 */
export class ChatCompletionRequestDto {
  // Standard OpenAI fields
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  @ArrayMinSize(1)
  public messages!: ChatMessageDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  public temperature?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(128000)
  public max_tokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  public top_p?: number;

  @IsOptional()
  @IsNumber()
  @Min(-2)
  @Max(2)
  public frequency_penalty?: number;

  @IsOptional()
  @IsNumber()
  @Min(-2)
  @Max(2)
  public presence_penalty?: number;

  @IsOptional()
  public stop?: string | string[];

  // Function calling fields
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ToolDto)
  public tools?: ToolDto[];

  @IsOptional()
  @IsValidToolChoice()
  public tool_choice?: ToolChoice;

  // Router-specific fields
  @IsOptional()
  public model?: string | string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public tags?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['fast', 'reasoning'])
  public type?: 'fast' | 'reasoning';

  @IsOptional()
  @IsNumber()
  @Min(1)
  public min_context_size?: number;

  @IsOptional()
  @IsBoolean()
  public json_response?: boolean;

  // Smart routing fields
  /**
   * Prefer models with lowest latency
   * If true, selects model with best avgLatency
   */
  @IsOptional()
  @IsBoolean()
  public prefer_fast?: boolean;

  /**
   * Minimum success rate for model selection (0-1)
   * Filters out models with success rate below this threshold
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  public min_success_rate?: number;

  /**
   * Enable streaming mode (Server-Sent Events)
   * If true, response will be streamed incrementally
   */
  @IsOptional()
  @IsBoolean()
  public stream?: boolean;

  /**
   * Vision support required (multimodal - text + images)
   * If true, only select models that support image_url content
   */
  @IsOptional()
  @IsBoolean()
  public supports_vision?: boolean;

  // Routing behavior overrides (per-request)
  /**
   * Maximum number of model switches for this request
   * Overrides config.routing.maxModelSwitches for this request only
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  public max_model_switches?: number;

  /**
   * Maximum retries on the same model for this request
   * Overrides config.routing.maxSameModelRetries for this request only
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  public max_same_model_retries?: number;

  /**
   * Delay between retries in milliseconds for this request
   * Overrides config.routing.retryDelay for this request only
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(30000)
  public retry_delay?: number;

  /**
   * Request timeout in seconds for this request
   * Overrides config.routing.timeoutSecs and provider configuration
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(600)
  public timeout_secs?: number;

  /**
   * Fallback provider for this request
   * Overrides config.routing.fallback.provider if fallback is enabled
   * Applied only if routing.fallback.enabled is true or undefined
   */
  @IsOptional()
  @IsString()
  public fallback_provider?: string;

  /**
   * Fallback model for this request
   * Overrides config.routing.fallback.model if fallback is enabled
   * Applied only if routing.fallback.enabled is true or undefined
   */
  @IsOptional()
  @IsString()
  public fallback_model?: string;
}
