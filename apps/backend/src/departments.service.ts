import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

type CreateDepartmentInput = {
  name: string;
};

type UpdateDepartmentInput = {
  name?: string;
};

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeCodeSeed(name: string) {
    return (
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24) || 'DEPARTMENT'
    );
  }

  private async generateUniqueCode(name: string, excludeId?: string) {
    const seed = this.normalizeCodeSeed(name);
    let attempt = seed;
    let index = 1;

    for (;;) {
      const existing = await this.prisma.department.findFirst({
        where: {
          code: attempt,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      });

      if (!existing) {
        return attempt;
      }

      index += 1;
      attempt = `${seed}-${index}`.slice(0, 32);
    }
  }

  async findAll() {
    return this.prisma.department.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        members: {
          select: {
            id: true,
            userId: true,
            title: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                fullName: true,
                avatarUrl: true,
                status: true,
              },
            },
          },
        },
      },
    });
  }

  async create(input: CreateDepartmentInput) {
    const existing = await this.prisma.department.findFirst({
      where: {
        name: input.name,
      },
    });
    if (existing) {
      throw new BadRequestException('Department name already exists');
    }

    const code = await this.generateUniqueCode(input.name);

    return this.prisma.department.create({
      data: {
        name: input.name,
        code,
      },
    });
  }

  async update(id: string, input: UpdateDepartmentInput) {
    const current = await this.prisma.department.findUnique({ where: { id } });
    if (!current) {
      throw new BadRequestException('Department not found');
    }

    if (input.name) {
      const existing = await this.prisma.department.findFirst({
        where: {
          id: { not: id },
          name: input.name,
        },
      });
      if (existing) {
        throw new BadRequestException('Department name already exists');
      }
    }

    const nextName = input.name ?? current.name;
    const nextCode = nextName !== current.name ? await this.generateUniqueCode(nextName, id) : current.code;

    return this.prisma.department.update({
      where: { id },
      data: {
        name: nextName,
        code: nextCode,
      },
      include: {
        members: {
          select: {
            id: true,
            userId: true,
            title: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                fullName: true,
                avatarUrl: true,
                status: true,
              },
            },
          },
        },
      },
    });
  }

  async remove(id: string) {
    await this.prisma.department.delete({
      where: { id },
    });

    return { ok: true };
  }
}
