import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class TokenHashService {
  private readonly pepper: string;

  constructor(config: ConfigService) {
    this.pepper = config.getOrThrow<string>('API_KEY_PEPPER');
  }

  hash(token: string) {
    if (!token) throw new Error('No se puede procesar un token vacío');
    return createHmac('sha256', this.pepper)
      .update(token, 'utf8')
      .digest('base64url');
  }

  verify(token: string, expectedHash: string) {
    if (!token || !expectedHash) return false;
    const actual = Buffer.from(this.hash(token), 'base64url');
    const expected = Buffer.from(expectedHash, 'base64url');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
