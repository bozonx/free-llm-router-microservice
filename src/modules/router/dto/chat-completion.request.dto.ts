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
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Chat message DTO
 */
export class ChatMessageDto {
  @IsString()
  @IsIn(['system', 'user', 'assistant'])
  public role!: 'system' | 'user' | 'assistant';

  @IsString()
  public content!: string;
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

  // Router-specific fields
  @IsOptional()
  @IsString()
  public model?: string;

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
}
