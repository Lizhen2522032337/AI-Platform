import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const normalizeText = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateUserDto {
  @Transform(normalizeText)
  @IsString()
  @Length(3, 64)
  @Matches(/^[\p{L}\p{N}_.@-]+$/u)
  username: string;

  @Transform(normalizeText)
  @IsString()
  @Length(1, 100)
  displayName: string;

  @IsString()
  @MinLength(12)
  @MaxLength(256)
  password: string;

  @IsIn(['admin', 'user'])
  role: 'admin' | 'user';
}

export class UpdateUserDto {
  @IsOptional()
  @Transform(normalizeText)
  @IsString()
  @Length(1, 100)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  password?: string;

  @IsOptional()
  @IsIn(['admin', 'user'])
  role?: 'admin' | 'user';

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
