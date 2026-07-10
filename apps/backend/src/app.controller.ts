import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AppService } from './app.service';
import { AuthGuard } from './auth.guard';

class UpdateAppConfigDto {
  companyName!: string;
  logoUrl?: string | null;
}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('app-config')
  getAppConfig() {
    return this.appService.getPublicConfig();
  }

  @Post('app-config')
  @UseGuards(AuthGuard, AdminGuard)
  updateAppConfig(@Body() dto: UpdateAppConfigDto) {
    return this.appService.updatePublicConfig(dto.companyName, dto.logoUrl);
  }
}
