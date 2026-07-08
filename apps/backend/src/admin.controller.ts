import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AuthGuard } from './auth.guard';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  overview() {
    return this.adminService.overview();
  }

  @Get('login-activities')
  loginActivities(@Query('limit') limit?: string) {
    return this.adminService.loginActivities(limit ? Number(limit) : 20);
  }

  @Get('attendance')
  attendance(@Query('limit') limit?: string) {
    return this.adminService.attendance(limit ? Number(limit) : 20);
  }
}
