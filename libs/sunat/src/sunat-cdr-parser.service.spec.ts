import { ConfigService } from '@nestjs/config';
import { zipSync } from 'fflate';
import {
  SunatCdrParserService,
  SunatInvalidCdrException,
} from './sunat-cdr-parser.service';

describe('SunatCdrParserService', () => {
  const parser = new SunatCdrParserService({
    getOrThrow: jest.fn().mockReturnValue(10_485_760),
  } as unknown as ConfigService);

  it('interpreta un CDR aceptado', () => {
    const result = parser.parse(cdr('0', 'Aceptado'), 'F001-42');
    expect(result).toMatchObject({
      status: 'ACCEPTED',
      code: '0',
      message: 'Aceptado',
      referenceId: 'F001-42',
    });
  });

  it('interpreta notas como aceptado con observaciones', () => {
    const result = parser.parse(
      cdr('0', 'Aceptado', ['4000 - Observacion de prueba']),
      'F001-42',
    );
    expect(result.status).toBe('ACCEPTED_WITH_OBSERVATIONS');
    expect(result.observations).toEqual(['4000 - Observacion de prueba']);
  });

  it('interpreta codigo distinto de cero como rechazo', () => {
    expect(
      parser.parse(cdr('2335', 'Documento rechazado'), 'F001-42'),
    ).toMatchObject({ status: 'REJECTED', code: '2335' });
  });

  it('rechaza un CDR de otro comprobante', () => {
    expect(() => parser.parse(cdr('0', 'Aceptado'), 'F001-99')).toThrow(
      SunatInvalidCdrException,
    );
  });
});

function cdr(code: string, description: string, notes: string[] = []) {
  const xml = `<?xml version="1.0"?><ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">${notes.map((note) => `<cbc:Note>${note}</cbc:Note>`).join('')}<cac:DocumentResponse><cac:Response><cbc:ReferenceID>F001-42</cbc:ReferenceID><cbc:ResponseCode>${code}</cbc:ResponseCode><cbc:Description>${description}</cbc:Description></cac:Response></cac:DocumentResponse></ApplicationResponse>`;
  return Buffer.from(
    zipSync({ 'R-20123456789-01-F001-42.xml': Buffer.from(xml) }),
  );
}
