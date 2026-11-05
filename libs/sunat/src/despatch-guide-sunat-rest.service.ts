import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/src/prisma.service';
import { SecretCryptoService } from '../../security/src/secret-crypto.service';
import { PrivateObjectStorageService } from '../../storage/src/private-object-storage.service';
import { DespatchGuideCdrService } from './despatch-guide-cdr.service';

type JsonRecord = Record<string, unknown>;

@Injectable()
export class DespatchGuideSunatRestService {
  private readonly tokens = new Map<
    string,
    { value: string; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SecretCryptoService,
    private readonly storage: PrivateObjectStorageService,
    private readonly cdr: DespatchGuideCdrService,
    private readonly config: ConfigService,
  ) {}

  async submit(guideId: string) {
    const guide = await this.prisma.despatchGuide.findUnique({
      where: { id: guideId },
      include: { artifacts: true },
    });
    if (!guide) throw new NotFoundException('Guía de remisión no encontrada');
    if (guide.environment !== 'PRODUCTION') {
      throw new ConflictException(
        'El envío REST GRE solo está disponible en PRODUCCIÓN',
      );
    }
    if (
      ['ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS', 'REJECTED'].includes(
        guide.status,
      )
    ) {
      return { status: guide.status };
    }

    const credential = await this.prisma.taxCredential.findUnique({
      where: {
        tenantId_environment: {
          tenantId: guide.tenantId,
          environment: guide.environment,
        },
      },
    });
    if (
      !credential?.active ||
      !credential.solUsernameEncrypted ||
      !credential.solPasswordEncrypted ||
      !credential.clientIdEncrypted ||
      !credential.clientSecretEncrypted
    ) {
      throw new ConflictException(
        'La GRE requiere usuario SOL, clave SOL, clientId y clientSecret activos',
      );
    }

    if (guide.sunatTicket) {
      return this.poll(guide.id, guide.sunatTicket, credential);
    }

    const zip = guide.artifacts.find((artifact) => artifact.type === 'ZIP');
    if (!zip) throw new ConflictException('La GRE no tiene ZIP firmado');
    const zipBytes = await this.storage.get(zip.objectKey);
    const baseName = zip.fileName.replace(/\.zip$/i, '');
    const token = await this.token(
      credential,
      guide.tenantId,
      guide.environment,
    );
    const response = await this.request(
      `${this.cpeBase()}/${encodeURIComponent(baseName)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          archivo: {
            nomArchivo: zip.fileName,
            arcGreZip: zipBytes.toString('base64'),
            hashZip: createHash('sha256').update(zipBytes).digest('hex'),
          },
        }),
      },
    );
    const body = await this.json(response);
    const ticket = this.string(body.numTicket);
    if (!ticket) {
      throw new BadGatewayException(
        this.string(body.msg) || 'SUNAT no devolvió ticket para la GRE',
      );
    }
    await this.prisma.despatchGuide.update({
      where: { id: guide.id },
      data: {
        sunatTicket: ticket,
        sunatCode: this.string(body.codRespuesta).slice(0, 40) || null,
        submittedAt: new Date(),
      },
    });
    return this.poll(guide.id, ticket, credential);
  }

  private async poll(
    guideId: string,
    ticket: string,
    credential: {
      id: string;
      tenantId: string;
      environment: 'BETA' | 'PRODUCTION';
      solUsernameEncrypted: string | null;
      solPasswordEncrypted: string | null;
      clientIdEncrypted: string | null;
      clientSecretEncrypted: string | null;
    },
  ) {
    const token = await this.token(
      credential,
      credential.tenantId,
      credential.environment,
    );
    const response = await this.request(
      `${this.cpeBase()}/envios/${encodeURIComponent(ticket)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await this.json(response);
    const code = this.string(body.codRespuesta);
    const encoded = this.string(body.arcCdr);
    if (encoded)
      return this.cdr.process(guideId, Buffer.from(encoded, 'base64'));
    if (code === '98' || this.string(body.indCdrGenerado) === '0') {
      throw new GrePendingError(ticket);
    }
    throw new BadGatewayException(
      this.string(body.msg) ||
        `SUNAT no generó el CDR de la GRE (${code || 'sin código'})`,
    );
  }

  private async token(
    credential: {
      id: string;
      solUsernameEncrypted: string | null;
      solPasswordEncrypted: string | null;
      clientIdEncrypted: string | null;
      clientSecretEncrypted: string | null;
    },
    tenantId: string,
    environment: 'BETA' | 'PRODUCTION',
  ) {
    const cached = this.tokens.get(credential.id);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.value;
    const decrypt = (value: string | null, field: string) => {
      if (!value) throw new ConflictException(`Falta ${field} para GRE`);
      return this.crypto.decrypt(value, `${tenantId}:${environment}:${field}`);
    };
    const clientId = decrypt(credential.clientIdEncrypted, 'client-id');
    const ruc = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { ruc: true },
    });
    if (!ruc) throw new NotFoundException('Empresa no encontrada');
    const usernameValue = decrypt(
      credential.solUsernameEncrypted,
      'sol-username',
    );
    const form = new URLSearchParams({
      grant_type: 'password',
      scope: 'https://api-cpe.sunat.gob.pe',
      client_id: clientId,
      client_secret: decrypt(credential.clientSecretEncrypted, 'client-secret'),
      username: usernameValue.startsWith(ruc.ruc)
        ? usernameValue
        : `${ruc.ruc}${usernameValue}`,
      password: decrypt(credential.solPasswordEncrypted, 'sol-password'),
    });
    const response = await this.request(
      `${this.tokenBase()}/${encodeURIComponent(clientId)}/oauth2/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      },
    );
    const body = await this.json(response);
    const value = this.string(body.access_token);
    if (!value) throw new BadGatewayException('SUNAT devolvió un token vacío');
    const expiresIn = Math.max(60, Number(body.expires_in) || 300);
    this.tokens.set(credential.id, {
      value,
      expiresAt: Date.now() + expiresIn * 1_000,
    });
    return value;
  }

  private tokenBase() {
    return (
      this.config.get<string>('SUNAT_GRE_TOKEN_URL') ||
      'https://api-seguridad.sunat.gob.pe/v1/clientessol'
    ).replace(/\/$/, '');
  }

  private cpeBase() {
    return (
      this.config.get<string>('SUNAT_GRE_API_URL') ||
      'https://api-cpe.sunat.gob.pe/v1/contribuyente/gem/comprobantes'
    ).replace(/\/$/, '');
  }

  private async request(url: string, init: RequestInit) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new BadGatewayException(
        error instanceof Error
          ? error.message
          : 'No se pudo conectar con SUNAT',
      );
    }
    if (response.ok) return response;
    const body = await response.text();
    throw new BadGatewayException(
      `SUNAT HTTP ${response.status}: ${body.slice(0, 500)}`,
    );
  }

  private async json(response: Response) {
    try {
      return (await response.json()) as JsonRecord;
    } catch {
      throw new BadGatewayException('SUNAT devolvió una respuesta inválida');
    }
  }

  private string(value: unknown) {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value).trim()
      : '';
  }
}

export class GrePendingError extends Error {
  readonly retryable = true;

  constructor(readonly ticket: string) {
    super(`SUNAT aún procesa la GRE con ticket ${ticket}`);
    this.name = 'GrePendingError';
  }
}
