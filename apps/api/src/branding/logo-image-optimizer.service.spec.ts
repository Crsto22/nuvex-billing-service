import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { LogoImageOptimizerService } from './logo-image-optimizer.service';

describe('LogoImageOptimizerService', () => {
  const service = new LogoImageOptimizerService();

  it('normaliza y genera variantes optimizadas sin deformar el logo', async () => {
    const input = await sharp({
      create: {
        width: 2000,
        height: 800,
        channels: 4,
        background: { r: 20, g: 80, b: 160, alpha: 0.8 },
      },
    })
      .png()
      .toBuffer();

    const result = await service.optimize(file(input, 'Mi Logo.png'));

    expect(result.source).toMatchObject({
      fileName: 'Mi_Logo.png',
      contentType: 'image/png',
      width: 2000,
      height: 800,
    });
    expect(result.master).toMatchObject({
      contentType: 'image/png',
      width: 1600,
      height: 640,
    });
    expect(result.pdf).toMatchObject({
      contentType: 'image/png',
      width: 800,
      height: 320,
    });
    expect(result.preview).toMatchObject({
      contentType: 'image/webp',
      width: 320,
      height: 128,
    });
    expect(result.pdf.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rechaza SVG aunque pueda ser interpretado como imagen', async () => {
    const input = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"></svg>',
    );

    await expect(service.optimize(file(input, 'logo.svg'))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza archivos vacios', async () => {
    await expect(
      service.optimize(file(Buffer.alloc(0), 'logo.png')),
    ).rejects.toThrow('El logo esta vacio');
  });
});

function file(buffer: Buffer, originalname: string): Express.Multer.File {
  return {
    fieldname: 'logo',
    originalname,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
  };
}
