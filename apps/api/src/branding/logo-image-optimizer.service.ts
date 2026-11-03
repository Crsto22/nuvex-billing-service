import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp, { type FormatEnum } from 'sharp';

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 20_000_000;
const ALLOWED_FORMATS = new Set<keyof FormatEnum>(['jpeg', 'png', 'webp']);

export type OptimizedLogoVariant = {
  body: Buffer;
  contentType: string;
  extension: 'png' | 'webp';
  sizeBytes: number;
  sha256: string;
  width: number;
  height: number;
};

export type OptimizedTenantLogo = {
  source: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    width: number;
    height: number;
  };
  master: OptimizedLogoVariant;
  pdf: OptimizedLogoVariant;
  preview: OptimizedLogoVariant;
};

@Injectable()
export class LogoImageOptimizerService {
  async optimize(file: Express.Multer.File): Promise<OptimizedTenantLogo> {
    if (!file.buffer.length) {
      throw new BadRequestException('El logo esta vacio');
    }
    if (file.size > MAX_SOURCE_BYTES || file.buffer.length > MAX_SOURCE_BYTES) {
      throw new BadRequestException('El logo no debe superar 5 MB');
    }

    let metadata: sharp.Metadata;
    try {
      metadata = await this.image(file.buffer).metadata();
    } catch {
      throw new BadRequestException('El archivo no es una imagen valida');
    }

    if (
      !metadata.format ||
      !ALLOWED_FORMATS.has(metadata.format) ||
      !metadata.width ||
      !metadata.height
    ) {
      throw new BadRequestException('Solo se permiten logos PNG, JPEG o WebP');
    }
    if ((metadata.pages ?? 1) > 1) {
      throw new BadRequestException('El logo no puede ser animado');
    }
    if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
      throw new BadRequestException(
        'El logo supera el limite de 20 megapixeles',
      );
    }

    try {
      const [master, pdf, preview] = await Promise.all([
        this.pngVariant(file.buffer, 1600, 640),
        this.pngVariant(file.buffer, 800, 320),
        this.webpVariant(file.buffer, 320, 128),
      ]);
      return {
        source: {
          fileName: this.safeFileName(file.originalname),
          contentType: this.contentType(metadata.format),
          sizeBytes: file.buffer.length,
          width: metadata.width,
          height: metadata.height,
        },
        master,
        pdf,
        preview,
      };
    } catch {
      throw new BadRequestException('No se pudo optimizar el logo');
    }
  }

  private image(input: Buffer) {
    return sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
    }).rotate();
  }

  private async pngVariant(input: Buffer, width: number, height: number) {
    const body = await this.image(input)
      .resize({ width, height, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    return this.variant(body, 'image/png', 'png');
  }

  private async webpVariant(input: Buffer, width: number, height: number) {
    const body = await this.image(input)
      .resize({ width, height, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, alphaQuality: 100, effort: 5 })
      .toBuffer();
    return this.variant(body, 'image/webp', 'webp');
  }

  private async variant(
    body: Buffer,
    contentType: string,
    extension: 'png' | 'webp',
  ): Promise<OptimizedLogoVariant> {
    const metadata = await sharp(body).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('La variante optimizada no tiene dimensiones');
    }
    return {
      body,
      contentType,
      extension,
      sizeBytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      width: metadata.width,
      height: metadata.height,
    };
  }

  private contentType(format: keyof FormatEnum) {
    return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
  }

  private safeFileName(value: string) {
    const name = value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);
    return name || 'logo';
  }
}
