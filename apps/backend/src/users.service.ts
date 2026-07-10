import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';

type CreateUserInput = {
  username: string;
  fullName: string;
  avatarUrl?: string;
  password: string;
  status?: 'ACTIVE' | 'INACTIVE';
  departmentIds?: string[];
};

type UpdateUserInput = {
  username?: string;
  fullName?: string;
  avatarUrl?: string;
  password?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  departmentIds?: string[];
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private adminUserSelect = {
    id: true,
    username: true,
    fullName: true,
    avatarUrl: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    departments: {
      select: {
        id: true,
        departmentId: true,
        userId: true,
        title: true,
        createdAt: true,
        department: true,
      },
    },
    loginActivities: {
      orderBy: {
        loggedInAt: 'desc' as const,
      },
      take: 1,
      select: {
        loggedInAt: true,
        ipAddress: true,
      },
    },
  } satisfies Prisma.UserSelect;

  private normalizeAdminUser<T extends { avatarUrl?: string | null }>(user: T) {
    return {
      ...user,
      avatarUrl: this.storage.resolveStoredUrl(user.avatarUrl),
    };
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      where: {
        username: {
          not: 'system-upload',
        },
      },
      orderBy: { createdAt: 'desc' },
      select: this.adminUserSelect,
    });

    return users.map((user) => ({
      ...this.normalizeAdminUser(user),
      lastLoginAt: user.loginActivities[0]?.loggedInAt ?? null,
      lastLoginIp: user.loginActivities[0]?.ipAddress ?? null,
      loginActivities: undefined,
    }));
  }

  async directory(currentUserId: string) {
    const users = await this.prisma.user.findMany({
      where: {
        id: { not: currentUserId },
        username: {
          not: 'system-upload',
        },
      },
      orderBy: [{ fullName: 'asc' }],
      select: {
        id: true,
        username: true,
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

    return users.map((user) => this.normalizeAdminUser(user));
  }

  async create(input: CreateUserInput) {
    const existing = await this.prisma.user.findFirst({
      where: {
        username: input.username,
      },
    });
    if (existing) {
      throw new BadRequestException('Username already exists');
    }

    const passwordHash = createHash('sha256').update(input.password).digest('hex');

    const user = await this.prisma.user.create({
      data: {
        username: input.username,
        fullName: input.fullName,
        avatarUrl: input.avatarUrl || null,
        status: input.status ?? 'ACTIVE',
        passwordHash,
        departments: input.departmentIds?.length
          ? {
              create: input.departmentIds.map((departmentId) => ({ departmentId })),
            }
          : undefined,
      },
      select: this.adminUserSelect,
    });

    return {
      ...this.normalizeAdminUser(user),
      lastLoginAt: user.loginActivities[0]?.loggedInAt ?? null,
      lastLoginIp: user.loginActivities[0]?.ipAddress ?? null,
      loginActivities: undefined,
    };
  }

  async update(id: string, input: UpdateUserInput) {
    const current = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
      },
    });

    if (!current) {
      throw new BadRequestException('User not found');
    }

    if (current.username === 'system-upload') {
      throw new BadRequestException('This user cannot be edited');
    }

    if (input.username) {
      const existing = await this.prisma.user.findFirst({
        where: {
          id: { not: id },
          username: input.username,
        },
      });
      if (existing) {
        throw new BadRequestException('Username already exists');
      }
    }

    const passwordHash = input.password
      ? createHash('sha256').update(input.password).digest('hex')
      : undefined;

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        username: input.username ?? undefined,
        fullName: input.fullName ?? undefined,
        avatarUrl: input.avatarUrl === undefined ? undefined : input.avatarUrl || null,
        status: input.status ?? undefined,
        passwordHash,
        departments:
          input.departmentIds !== undefined
            ? {
                deleteMany: {},
                create: input.departmentIds.map((departmentId) => ({ departmentId })),
              }
            : undefined,
      },
      select: this.adminUserSelect,
    });

    return {
      ...this.normalizeAdminUser(user),
      lastLoginAt: user.loginActivities[0]?.loggedInAt ?? null,
      lastLoginIp: user.loginActivities[0]?.ipAddress ?? null,
      loginActivities: undefined,
    };
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        _count: {
          select: {
            messages: true,
            attachments: true,
          },
        },
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.username === 'admin' || user.username === 'system-upload') {
      throw new BadRequestException('This user cannot be deleted');
    }

    if (user._count.messages > 0 || user._count.attachments > 0) {
      throw new BadRequestException('User already has chat history, please set status to INACTIVE instead');
    }

    await this.prisma.user.delete({
      where: { id },
    });

    return { ok: true };
  }

  async resetPassword(id: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.username === 'system-upload') {
      throw new BadRequestException('This user cannot be edited');
    }

    const passwordHash = createHash('sha256').update(password).digest('hex');
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    return { ok: true };
  }
}
