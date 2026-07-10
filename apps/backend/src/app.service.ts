import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  getHealth() {
    return {
      ok: true,
      service: 'inhouse-chat-backend',
      timestamp: new Date().toISOString(),
    };
  }

  async getPublicConfig() {
    const config = await this.prisma.appConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: {
        id: 'default',
        companyName: 'Company Chat',
      },
    });

    return {
      companyName: config.companyName,
      logoUrl: this.storage.resolveStoredUrl(config.logoUrl),
    };
  }

  async updatePublicConfig(companyName: string, logoUrl?: string | null) {
    const config = await this.prisma.appConfig.upsert({
      where: { id: 'default' },
      update: {
        companyName: companyName.trim() || 'Company Chat',
        logoUrl: logoUrl || null,
      },
      create: {
        id: 'default',
        companyName: companyName.trim() || 'Company Chat',
        logoUrl: logoUrl || null,
      },
    });

    return {
      companyName: config.companyName,
      logoUrl: this.storage.resolveStoredUrl(config.logoUrl),
    };
  }
}
