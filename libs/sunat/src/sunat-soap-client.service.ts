import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOMParser } from '@xmldom/xmldom';
import { Environment } from '@prisma/client';

type XmlDocument = ReturnType<DOMParser['parseFromString']>;

export interface SendBillInput {
  environment: Environment;
  username: string;
  password: string;
  fileName: string;
  zip: Buffer;
}

export type SendSummaryInput = SendBillInput;

@Injectable()
export class SunatSoapClientService {
  private readonly betaEndpoint: string;
  private readonly productionEndpoint: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(config: ConfigService) {
    this.betaEndpoint = config.getOrThrow<string>('SUNAT_BETA_BILL_ENDPOINT');
    this.productionEndpoint = config.getOrThrow<string>(
      'SUNAT_PRODUCTION_BILL_ENDPOINT',
    );
    this.timeoutMs = config.getOrThrow<number>('SUNAT_SOAP_TIMEOUT_MS');
    this.maxResponseBytes = config.getOrThrow<number>(
      'SUNAT_MAX_RESPONSE_BYTES',
    );
  }

  async sendBill(input: SendBillInput) {
    if (input.zip.length > this.maxResponseBytes) {
      throw new BadRequestException('El ZIP excede el limite permitido');
    }
    const response = await this.request(
      this.envelope(input, 'sendBill'),
      'sendBill',
      input.environment,
    );
    const xml = await this.readLimited(response);
    const fault = this.fault(xml);
    if (fault) {
      if (this.isRetryableFault(fault.code, fault.message)) {
        throw new SunatTransportException(fault.code, fault.message);
      }
      throw new SunatSoapFaultException(fault.code, fault.message);
    }
    if (!response.ok) {
      if (response.status >= 500) {
        throw new SunatTransportException(
          `HTTP_${response.status}`,
          `SUNAT respondio HTTP ${response.status}`,
        );
      }
      throw new SunatSoapFaultException(
        `HTTP_${response.status}`,
        `SUNAT respondio HTTP ${response.status}`,
      );
    }

    const document = this.parse(xml);
    const value =
      this.firstText(document, 'applicationResponse') ??
      this.firstText(document, 'document');
    if (!value || !validBase64(value)) {
      throw new SunatTransportException(
        'INVALID_RESPONSE',
        'SUNAT respondio sin un CDR valido',
      );
    }
    const cdrZip = Buffer.from(value.replace(/\s+/g, ''), 'base64');
    if (!cdrZip.length || cdrZip.length > this.maxResponseBytes) {
      throw new SunatTransportException(
        'INVALID_CDR_SIZE',
        'El CDR de SUNAT tiene un tamano invalido',
      );
    }
    return { cdrZip };
  }

  async sendSummary(input: SendSummaryInput) {
    if (input.zip.length > this.maxResponseBytes) {
      throw new BadRequestException('El ZIP excede el limite permitido');
    }
    const response = await this.request(
      this.envelope(input, 'sendSummary'),
      'sendSummary',
      input.environment,
    );
    const xml = await this.readLimited(response);
    this.assertSoapResponse(response, xml);
    const document = this.parse(xml);
    const ticket = this.firstText(document, 'ticket');
    if (!ticket || ticket.length > 100) {
      throw new SunatTransportException(
        'INVALID_TICKET',
        'SUNAT respondio sin un ticket valido',
      );
    }
    return { ticket };
  }

  async getStatus(input: {
    environment: Environment;
    username: string;
    password: string;
    ticket: string;
  }) {
    const response = await this.request(
      this.statusEnvelope(input),
      'getStatus',
      input.environment,
    );
    const xml = await this.readLimited(response);
    this.assertSoapResponse(response, xml);
    const document = this.parse(xml);
    const statusCode = this.firstText(document, 'statusCode');
    const content = this.firstText(document, 'content');
    if (!statusCode) {
      throw new SunatTransportException(
        'INVALID_STATUS_RESPONSE',
        'SUNAT respondio sin estado para el ticket',
      );
    }
    if (statusCode === '98') return { statusCode, cdrZip: null };
    if (!content || !validBase64(content)) {
      throw new SunatTransportException(
        'INVALID_STATUS_CDR',
        `SUNAT respondio el estado ${statusCode} sin CDR valido`,
      );
    }
    const cdrZip = Buffer.from(content.replace(/\s+/g, ''), 'base64');
    if (!cdrZip.length || cdrZip.length > this.maxResponseBytes) {
      throw new SunatTransportException(
        'INVALID_CDR_SIZE',
        'El CDR de SUNAT tiene un tamano invalido',
      );
    }
    return { statusCode, cdrZip };
  }

  private async request(
    body: string,
    action: string,
    environment: Environment,
  ) {
    try {
      return await fetch(this.endpoint(environment), {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `"urn:${action}"`,
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const message =
        error instanceof Error &&
        ['AbortError', 'TimeoutError'].includes(error.name)
          ? `SUNAT no respondio en ${this.timeoutMs}ms`
          : 'No se pudo conectar con SUNAT';
      throw new SunatTransportException('NETWORK_ERROR', message);
    }
  }

  private endpoint(environment: Environment) {
    return environment === Environment.PRODUCTION
      ? this.productionEndpoint
      : this.betaEndpoint;
  }

  private assertSoapResponse(response: Response, xml: string) {
    const fault = this.fault(xml);
    if (fault) {
      if (this.isRetryableFault(fault.code, fault.message)) {
        throw new SunatTransportException(fault.code, fault.message);
      }
      throw new SunatSoapFaultException(fault.code, fault.message);
    }
    if (!response.ok) {
      if (response.status >= 500) {
        throw new SunatTransportException(
          `HTTP_${response.status}`,
          `SUNAT respondio HTTP ${response.status}`,
        );
      }
      throw new SunatSoapFaultException(
        `HTTP_${response.status}`,
        `SUNAT respondio HTTP ${response.status}`,
      );
    }
  }

  private async readLimited(response: Response) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
      throw new SunatTransportException(
        'RESPONSE_TOO_LARGE',
        'La respuesta SUNAT excede el limite permitido',
      );
    }
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > this.maxResponseBytes) {
        await reader.cancel();
        throw new SunatTransportException(
          'RESPONSE_TOO_LARGE',
          'La respuesta SUNAT excede el limite permitido',
        );
      }
      chunks.push(item.value);
    }
    return Buffer.concat(chunks.map((item) => Buffer.from(item))).toString(
      'utf8',
    );
  }

  private envelope(
    input: SendBillInput,
    operation: 'sendBill' | 'sendSummary',
  ) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header><wsse:Security><wsse:UsernameToken><wsse:Username>${escapeXml(input.username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(input.password)}</wsse:Password></wsse:UsernameToken></wsse:Security></soapenv:Header>
  <soapenv:Body><ser:${operation}><fileName>${escapeXml(input.fileName)}</fileName><contentFile>${input.zip.toString('base64')}</contentFile></ser:${operation}></soapenv:Body>
</soapenv:Envelope>`;
  }

  private statusEnvelope(input: {
    environment: Environment;
    username: string;
    password: string;
    ticket: string;
  }) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header><wsse:Security><wsse:UsernameToken><wsse:Username>${escapeXml(input.username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(input.password)}</wsse:Password></wsse:UsernameToken></wsse:Security></soapenv:Header>
  <soapenv:Body><ser:getStatus><ticket>${escapeXml(input.ticket)}</ticket></ser:getStatus></soapenv:Body>
</soapenv:Envelope>`;
  }

  private fault(xml: string) {
    const document = this.parse(xml);
    const faults = document.getElementsByTagNameNS('*', 'Fault');
    if (!faults.length) return null;
    return {
      code: this.firstText(document, 'faultcode') ?? 'SOAP_FAULT',
      message:
        this.firstText(document, 'faultstring') ??
        'SUNAT devolvio una falla SOAP',
    };
  }

  private parse(xml: string) {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.getElementsByTagName('parsererror').length) {
      throw new SunatTransportException(
        'INVALID_XML_RESPONSE',
        'SUNAT devolvio una respuesta XML invalida',
      );
    }
    return document;
  }

  private firstText(document: XmlDocument, localName: string) {
    return (
      document
        .getElementsByTagNameNS('*', localName)
        .item(0)
        ?.textContent?.trim() || null
    );
  }

  private isRetryableFault(code: string, message: string) {
    if (/no se puede leer.*archivo xml|cvc-|schema|saxparse/i.test(message)) {
      return false;
    }
    if (/Server/i.test(code)) return true;
    const numeric = Number(code.match(/(\d{3,4})$/)?.[1]);
    return Number.isInteger(numeric) && numeric >= 100 && numeric <= 999;
  }
}

export class SunatTransportException extends ServiceUnavailableException {
  constructor(
    readonly sunatCode: string,
    message: string,
  ) {
    super(message);
  }
}

export class SunatSoapFaultException extends BadRequestException {
  constructor(
    readonly sunatCode: string,
    message: string,
  ) {
    super(message);
  }
}

function validBase64(value: string) {
  const compact = value.replace(/\s+/g, '');
  return compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
