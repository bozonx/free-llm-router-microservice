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
} from 'class-validator';
import { Type } from 'class-transformer';

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

  @IsOptional()
  @ValidateIf((o) => typeof o.content === 'string')
  @IsString()
  @ValidateIf((o) => Array.isArray(o.content))
  @IsArray()
  @ValidateIf((o) => Array.isArray(o.content))
  @ValidateNested({ each: true })
  @ValidateIf((o) => Array.isArray(o.content))
  @Type(() => ChatContentPartDto)
  public content!: string | ChatContentPartDto[] | null;

  @IsOptional()
  @IsString()
  public name?: string;

  @IsOptional()
  @IsArray()
  public tool_calls?: any[];

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
  public tools?: any[];

  @IsOptional()
  public tool_choice?: string | any;

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
}
