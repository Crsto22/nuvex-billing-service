import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class PrivateObjectStorageService {
  private client?: S3Client;

  constructor(private readonly config: ConfigService) {}

  async put(key: string, body: Buffer, contentType: string) {
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string) {
    const response = await this.getClient().send(
      new GetObjectCommand({ Bucket: this.getBucket(), Key: key }),
    );
    if (!response.Body) throw new Error('El objeto privado no tiene contenido');
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string) {
    await this.getClient().send(
      new DeleteObjectCommand({ Bucket: this.getBucket(), Key: key }),
    );
  }

  async temporaryDownloadUrl(
    key: string,
    fileName: string,
    expiresIn = this.signedUrlTtlSeconds(),
  ) {
    return getSignedUrl(
      this.getClient(),
      new GetObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
        ResponseContentDisposition: `attachment; filename="${this.safeFileName(fileName)}"`,
        ResponseCacheControl: 'no-store, no-cache, max-age=0, must-revalidate',
      }),
      { expiresIn },
    );
  }

  private getClient() {
    if (this.client) return this.client;
    this.client = new S3Client({
      endpoint: this.required('PRIVATE_STORAGE_ENDPOINT'),
      region: this.config.get<string>('PRIVATE_STORAGE_REGION') || 'auto',
      credentials: {
        accessKeyId: this.required('PRIVATE_STORAGE_ACCESS_KEY_ID'),
        secretAccessKey: this.required('PRIVATE_STORAGE_SECRET_ACCESS_KEY'),
      },
    });
    return this.client;
  }

  private getBucket() {
    return this.required('PRIVATE_STORAGE_BUCKET');
  }

  signedUrlTtlSeconds() {
    return (
      this.config.get<number>('PRIVATE_STORAGE_SIGNED_URL_TTL_SECONDS') ?? 300
    );
  }

  private required(name: string) {
    const value = this.config.get<string>(name);
    if (!value) {
      throw new ServiceUnavailableException(
        `El almacenamiento privado no esta configurado (${name})`,
      );
    }
    return value;
  }

  private safeFileName(value: string) {
    return value.replace(/[^A-Za-z0-9._-]/g, '_');
  }
}
