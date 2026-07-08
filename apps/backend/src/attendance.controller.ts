import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.types';
import { AuthService } from './auth.service';
import { getRequestIp, getUserAgent } from './request-meta';

@Controller('attendance')
@UseGuards(AuthGuard)
export class AttendanceController {
  constructor(private readonly authService: AuthService) {}

  @Post('check-in')
  checkIn(@CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.authService.checkIn(user.sub, getRequestIp(request), getUserAgent(request));
  }

  @Post('check-out')
  checkOut(@CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.authService.checkOut(user.sub, getRequestIp(request), getUserAgent(request));
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.authService.myAttendance(user.sub);
  }
}
