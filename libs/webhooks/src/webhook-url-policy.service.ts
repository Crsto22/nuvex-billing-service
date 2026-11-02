import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

@Injectable()
export class WebhookUrlPolicyService {
  async assertSafe(value: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('La URL del webhook no es válida');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new BadRequestException(
        'El webhook debe usar HTTPS y no incluir credenciales ni fragmentos',
      );
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      throw new BadRequestException('El destino del webhook no es público');
    }
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await this.resolve(hostname);
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicIp(address))
    ) {
      throw new BadRequestException('El destino del webhook no es público');
    }
    return url;
  }

  private async resolve(hostname: string) {
    try {
      return await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new BadRequestException(
        'No se pudo resolver el destino del webhook',
      );
    }
  }
}

export function isPublicIp(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) {
      return isPublicIp(normalized.slice(7));
    }
    return !(
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('2001:db8:')
    );
  }
  return false;
}
