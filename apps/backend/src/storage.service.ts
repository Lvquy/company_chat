import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly client: Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly fallbackBaseUrl: string;

  constructor() {
    this.bucket = process.env.MINIO_BUCKET ?? 'chat-attachments';
    const endPoint = process.env.MINIO_ENDPOINT ?? 'localhost';
    const port = Number(process.env.MINIO_PORT ?? 9000);
    const useSSL = (process.env.MINIO_USE_SSL ?? 'false') === 'true';
    this.client = new Client({
      endPoint,
      port,
      useSSL,
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    });
    this.publicBaseUrl = (process.env.MINIO_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
    this.fallbackBaseUrl = `${useSSL ? 'https' : 'http'}://${endPoint}${port ? `:${port}` : ''}`;
  }

  async onModuleInit() {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
    await this.client.setBucketPolicy(
      this.bucket,
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              AWS: ['*'],
            },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.bucket}/*`],
          },
        ],
      }),
    );
  }

  async uploadBuffer(key: string, buffer: Buffer, mimeType: string) {
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
  }

  private encodeObjectKey(key: string) {
    return key
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
  }

  private extractStorageKey(value?: string | null) {
    if (!value) return null;
    try {
      const url = new URL(value);
      const path = url.pathname.replace(/^\/+/, '');
      if (path.startsWith(`${this.bucket}/`)) {
        return decodeURIComponent(path.slice(this.bucket.length + 1));
      }
      const proxyPath = `minio/${this.bucket}/`;
      if (path.startsWith(proxyPath)) {
        return decodeURIComponent(path.slice(proxyPath.length));
      }
      return null;
    } catch {
      return null;
    }
  }

  async getDownloadUrl(key: string) {
    const base = this.publicBaseUrl || this.fallbackBaseUrl;
    return `${base}/${this.bucket}/${this.encodeObjectKey(key)}`;
  }

  resolveStoredUrl(value?: string | null) {
    if (!value) {
      return null;
    }
    const storageKey = this.extractStorageKey(value);
    if (!storageKey) {
      return value;
    }
    return `${this.publicBaseUrl || this.fallbackBaseUrl}/${this.bucket}/${this.encodeObjectKey(storageKey)}`;
  }
}
