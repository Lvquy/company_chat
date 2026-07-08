import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { memoryStorage } from 'multer';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.types';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';

@Controller('attachments')
@UseGuards(AuthGuard)
export class AttachmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const extension = file.originalname.includes('.')
      ? file.originalname.split('.').pop()
      : 'bin';
    const storageKey = `${randomUUID()}.${extension}`;

    await this.storage.uploadBuffer(
      storageKey,
      file.buffer,
      file.mimetype || 'application/octet-stream',
    );

    const attachment = await this.prisma.attachment.create({
      data: {
        originalName: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
        storageKey,
        uploadedById: user.sub,
      },
    });

    return {
      ...attachment,
      downloadUrl: await this.storage.getDownloadUrl(storageKey),
    };
  }
}
