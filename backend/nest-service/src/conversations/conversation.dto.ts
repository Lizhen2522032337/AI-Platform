import { Transform, type TransformFnParams } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import {
  DATABASE_TYPES,
  MODEL_PROVIDERS,
  type DatabaseType,
  type ModelProvider,
} from '../tasks/create-task.dto';

export class CreateConversationDto {
  @IsIn(MODEL_PROVIDERS)
  modelProvider: ModelProvider;

  @IsIn(DATABASE_TYPES)
  databaseType: DatabaseType = 'postgresql';
}

export class SendMessageDto extends CreateConversationDto {
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;
}
