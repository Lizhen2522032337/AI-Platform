import { Transform, type TransformFnParams } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const MODEL_PROVIDERS = ['deepseek', 'qwen'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export class CreateTaskDto {
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  prompt: string;

  @IsIn(MODEL_PROVIDERS)
  modelProvider: ModelProvider;
}
