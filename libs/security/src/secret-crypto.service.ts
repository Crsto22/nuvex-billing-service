import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

@Injectable()
export class SecretCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(
      config.getOrThrow<string>('SECRETS_ENCRYPTION_KEY'),
      'base64',
    );
  }

  encrypt(plaintext: string, context = '') {
    if (!plaintext) throw new Error('No se puede cifrar un secreto vacío');

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    if (context) cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string, context = '') {
    try {
      const [version, ivValue, tagValue, encryptedValue, extra] =
        payload.split('.');
      if (
        version !== VERSION ||
        !ivValue ||
        !tagValue ||
        !encryptedValue ||
        extra
      ) {
        throw new Error('Formato inválido');
      }

      const decipher = createDecipheriv(
        ALGORITHM,
        this.key,
        Buffer.from(ivValue, 'base64url'),
      );
      if (context) decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));

      return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('No se pudo descifrar el secreto');
    }
  }
}
