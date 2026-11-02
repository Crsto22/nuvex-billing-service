import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOMParser } from '@xmldom/xmldom';
import { unzipSync } from 'fflate';

type XmlDocument = ReturnType<DOMParser['parseFromString']>;

export type SunatCdrResult = {
  status: 'ACCEPTED' | 'ACCEPTED_WITH_OBSERVATIONS' | 'REJECTED';
  code: string;
  message: string;
  observations: string[];
  referenceId: string;
  xmlFileName: string;
};

@Injectable()
export class SunatCdrParserService {
  private readonly maxBytes: number;

  constructor(config: ConfigService) {
    this.maxBytes = config.getOrThrow<number>('SUNAT_MAX_RESPONSE_BYTES');
  }

  parse(cdrZip: Buffer, expectedReference: string): SunatCdrResult {
    if (!cdrZip.length || cdrZip.length > this.maxBytes) {
      throw new SunatInvalidCdrException('El ZIP CDR tiene un tamano invalido');
    }
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(new Uint8Array(cdrZip));
    } catch {
      throw new SunatInvalidCdrException('SUNAT devolvio un ZIP CDR invalido');
    }
    const xmlEntries = Object.entries(files).filter(
      ([name]) =>
        !name.includes('..') &&
        !name.startsWith('/') &&
        name.toLowerCase().endsWith('.xml'),
    );
    if (xmlEntries.length !== 1) {
      throw new SunatInvalidCdrException(
        'El CDR debe contener exactamente un archivo XML',
      );
    }
    const [xmlFileName, bytes] = xmlEntries[0];
    if (!bytes.length || bytes.length > this.maxBytes) {
      throw new SunatInvalidCdrException(
        'El XML del CDR tiene un tamano invalido',
      );
    }
    const document = new DOMParser().parseFromString(
      Buffer.from(bytes).toString('utf8'),
      'application/xml',
    );
    if (document.getElementsByTagName('parsererror').length) {
      throw new SunatInvalidCdrException('El CDR contiene XML invalido');
    }
    const code = text(document, 'ResponseCode');
    const description = text(document, 'Description');
    const referenceId = text(document, 'ReferenceID');
    if (!code || !description || !referenceId) {
      throw new SunatInvalidCdrException(
        'El CDR no contiene la respuesta obligatoria',
      );
    }
    if (referenceId !== expectedReference) {
      throw new SunatInvalidCdrException(
        'El CDR no corresponde al comprobante enviado',
      );
    }
    const observations = texts(document, 'Note');
    return {
      status:
        code === '0'
          ? observations.length
            ? 'ACCEPTED_WITH_OBSERVATIONS'
            : 'ACCEPTED'
          : 'REJECTED',
      code,
      message: [description, ...observations].join(' | ').slice(0, 1_000),
      observations,
      referenceId,
      xmlFileName,
    };
  }
}

export class SunatInvalidCdrException extends ServiceUnavailableException {}

function text(document: XmlDocument, localName: string) {
  return (
    document
      .getElementsByTagNameNS('*', localName)
      .item(0)
      ?.textContent?.trim() || ''
  );
}

function texts(document: XmlDocument, localName: string) {
  const elements = document.getElementsByTagNameNS('*', localName);
  return Array.from({ length: elements.length }, (_, index) =>
    elements.item(index)?.textContent?.trim(),
  ).filter((value): value is string => Boolean(value));
}
