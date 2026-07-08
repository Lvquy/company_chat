import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IsString, MinLength } from 'class-validator';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.types';
import { getRequestIp, getUserAgent } from './request-meta';

class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

class ChangePasswordDto {
  @IsString()
  @MinLength(6)
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

class UpdateProfileDto {
  @IsString()
  @MinLength(2)
  fullName!: string;

  @IsString()
  avatarUrl!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.authService.login(
      dto.username,
      dto.password,
      getRequestIp(request),
      getUserAgent(request),
    );
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.authService.getProfile(user.sub);
  }

  @Post('change-password')
  @UseGuards(AuthGuard)
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(
      user.sub,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Post('profile')
  @UseGuards(AuthGuard)
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.sub, dto.fullName, dto.avatarUrl);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  logout(@CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.authService.logout(
      user.sub,
      getRequestIp(request),
      getUserAgent(request),
    );
  }
}
