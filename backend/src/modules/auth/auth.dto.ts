import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import type {
  IdentityLinkRequestDto,
  LoginRequestDto,
  OAuthExchangeRequestDto,
  RefreshRequestDto,
  RegisterRequestDto,
} from '../../common/api/schemas';

export class RegisterDto implements RegisterRequestDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @Length(8, 200)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  displayName?: string;
}

export class LoginDto implements LoginRequestDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto implements RefreshRequestDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class OAuthExchangeDto implements OAuthExchangeRequestDto {
  @IsIn(['apple', 'google'])
  provider!: 'apple' | 'google';

  @IsString()
  @MinLength(1)
  idToken!: string;
}

export class IdentityLinkDto implements IdentityLinkRequestDto {
  @IsIn(['email', 'apple', 'google'])
  provider!: 'email' | 'apple' | 'google';

  @IsOptional()
  @IsString()
  idToken?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(8, 200)
  password?: string;
}
