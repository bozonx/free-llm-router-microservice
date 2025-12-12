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
    role!: 'system' | 'user' | 'assistant';

    @IsString()
    content!: string;
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
    messages!: ChatMessageDto[];

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(2)
    temperature?: number;

    @IsOptional()
    @IsNumber()
    @Min(1)
    max_tokens?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(1)
    top_p?: number;

    @IsOptional()
    @IsNumber()
    @Min(-2)
    @Max(2)
    frequency_penalty?: number;

    @IsOptional()
    @IsNumber()
    @Min(-2)
    @Max(2)
    presence_penalty?: number;

    @IsOptional()
    stop?: string | string[];

    // Router-specific fields
    @IsOptional()
    @IsString()
    model?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @IsOptional()
    @IsString()
    @IsIn(['fast', 'reasoning'])
    type?: 'fast' | 'reasoning';

    @IsOptional()
    @IsNumber()
    @Min(1)
    min_context_size?: number;

    @IsOptional()
    @IsBoolean()
    json_response?: boolean;
}
