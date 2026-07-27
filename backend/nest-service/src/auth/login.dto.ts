import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 64)
  @Matches(/^[\p{L}\p{N}_.@-]+$/u)
  username: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password: string;
}
