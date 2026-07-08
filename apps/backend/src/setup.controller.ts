import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AuthGuard } from './auth.guard';
import { PrismaService } from './prisma.service';

@Controller('setup')
@UseGuards(AuthGuard, AdminGuard)
export class SetupController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('status')
  async getStatus() {
    const [users, departments, conversations, messages] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.department.count(),
      this.prisma.conversation.count(),
      this.prisma.message.count(),
    ]);

    return {
      ok: true,
      users,
      departments,
      conversations,
      messages,
      initialized: users > 0,
    };
  }
}
