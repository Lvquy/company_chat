import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const today = new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${today}T00:00:00.000Z`);

    const [users, departments, conversations, messages, loginsToday, attendanceToday, activeAttendance] =
      await Promise.all([
        this.prisma.user.count({
          where: {
            username: { not: 'system-upload' },
          },
        }),
        this.prisma.department.count(),
        this.prisma.conversation.count(),
        this.prisma.message.count(),
        this.prisma.loginActivity.count({
          where: {
            loggedInAt: {
              gte: dayStart,
            },
          },
        }),
        this.prisma.attendanceRecord.count({
          where: {
            workDate: today,
          },
        }),
        this.prisma.attendanceRecord.count({
          where: {
            workDate: today,
            checkOutAt: null,
          },
        }),
      ]);

    const [recentLogins, recentAttendance] = await Promise.all([
      this.loginActivities(8),
      this.attendance(8),
    ]);

    return {
      users,
      departments,
      conversations,
      messages,
      loginsToday,
      attendanceToday,
      activeAttendance,
      recentLogins,
      recentAttendance,
    };
  }

  loginActivities(limit = 20) {
    return this.prisma.loginActivity.findMany({
      orderBy: { loggedInAt: 'desc' },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
            status: true,
          },
        },
      },
    });
  }

  attendance(limit = 20) {
    return this.prisma.attendanceRecord.findMany({
      orderBy: [{ workDate: 'desc' }, { checkInAt: 'desc' }],
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
            status: true,
          },
        },
      },
    });
  }
}
