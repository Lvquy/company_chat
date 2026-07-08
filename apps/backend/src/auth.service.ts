import { Injectable, UnauthorizedException } from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { AuthUser } from './auth.types';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private get accessSecret() {
    return process.env.JWT_ACCESS_SECRET ?? 'local-access-secret-123';
  }

  private getWorkDateKey(value = new Date()) {
    return value.toISOString().slice(0, 10);
  }

  async login(username: string, password: string, ipAddress?: string | null, userAgent?: string | null) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        status: true,
        passwordHash: true,
        departments: {
          select: {
            department: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const hashed = createHash('sha256').update(password).digest('hex');
    if (hashed !== user.passwordHash) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const token = sign({ sub: user.id, username: user.username }, this.accessSecret, {
      expiresIn: '7d',
    });

    await this.prisma.loginActivity.create({
      data: {
        userId: user.id,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });

    await this.checkIn(user.id, ipAddress, userAgent);

    return {
      accessToken: token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        status: user.status,
        isAdmin: user.username === 'admin',
        departments: user.departments.map((item) => item.department),
      },
    };
  }

  verifyToken(token: string): AuthUser {
    try {
      return verify(token, this.accessSecret) as AuthUser;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        status: true,
        departments: {
          select: {
            department: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      ...user,
      isAdmin: user.username === 'admin',
      departments: user.departments.map((item) => item.department),
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        passwordHash: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const currentHash = createHash('sha256').update(currentPassword).digest('hex');
    if (currentHash !== user.passwordHash) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const nextHash = createHash('sha256').update(newPassword).digest('hex');
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: nextHash,
      },
    });

    return {
      ok: true,
    };
  }

  async updateProfile(userId: string, fullName: string, avatarUrl: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        fullName,
        avatarUrl: avatarUrl || null,
      },
    });

    return this.getProfile(userId);
  }

  async logout(userId: string, ipAddress?: string | null, userAgent?: string | null) {
    await this.checkOut(userId, ipAddress, userAgent);
    return { ok: true };
  }

  async checkIn(userId: string, ipAddress?: string | null, userAgent?: string | null) {
    const workDate = this.getWorkDateKey();
    const existing = await this.prisma.attendanceRecord.findUnique({
      where: {
        userId_workDate: {
          userId,
          workDate,
        },
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.attendanceRecord.create({
      data: {
        userId,
        workDate,
        checkInAt: new Date(),
        checkInIp: ipAddress ?? null,
        checkInUserAgent: userAgent ?? null,
      },
    });
  }

  async checkOut(userId: string, ipAddress?: string | null, userAgent?: string | null) {
    const workDate = this.getWorkDateKey();
    const existing = await this.prisma.attendanceRecord.findUnique({
      where: {
        userId_workDate: {
          userId,
          workDate,
        },
      },
    });

    if (!existing) {
      return null;
    }

    if (existing.checkOutAt) {
      return existing;
    }

    return this.prisma.attendanceRecord.update({
      where: {
        userId_workDate: {
          userId,
          workDate,
        },
      },
      data: {
        checkOutAt: new Date(),
        checkOutIp: ipAddress ?? null,
        checkOutUserAgent: userAgent ?? null,
      },
    });
  }

  async myAttendance(userId: string) {
    return this.prisma.attendanceRecord.findMany({
      where: { userId },
      orderBy: [{ workDate: 'desc' }],
      take: 14,
    });
  }
}
