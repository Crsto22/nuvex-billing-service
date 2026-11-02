import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateApplicationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @Matches(/^[a-z][a-z0-9-]{1,49}$/)
  code!: string;
}
