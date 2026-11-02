import { UblVoidedDocumentsBuilderService } from './ubl-voided-documents-builder.service';

describe('UblVoidedDocumentsBuilderService', () => {
  it.each([
    ['INVOICE', '01', 'F001'],
    ['CREDIT_NOTE', '07', 'FC01'],
    ['DEBIT_NOTE', '08', 'FD01'],
  ])('genera VoidedDocuments para %s', (documentType, code, series) => {
    const builder = new UblVoidedDocumentsBuilderService();
    const xml = builder.build({
      generationDate: new Date('2026-11-02T00:00:00.000Z'),
      referenceDate: new Date('2026-11-01T00:00:00.000Z'),
      sequence: 8,
      tenant: { ruc: '20615136663' },
      items: [
        {
          lineId: 1,
          document: {
            documentType,
            series,
            number: 42,
            issuerSnapshot: {
              ruc: '20615136663',
              legalName: 'CORDEX T & D S.A.C.',
              tradeName: 'CORDEX T & D',
            },
          },
          voidRequest: { reason: 'Documento no otorgado' },
        },
      ],
    });

    expect(xml).toContain('<cbc:ID>RA-20261102-008</cbc:ID>');
    expect(xml).toContain(
      `<cbc:DocumentTypeCode>${code}</cbc:DocumentTypeCode>`,
    );
    expect(xml).toContain(
      `<sac:DocumentSerialID>${series}</sac:DocumentSerialID>`,
    );
    expect(xml).toContain('<sac:DocumentNumberID>42</sac:DocumentNumberID>');
    expect(xml).toContain(
      '<sac:VoidReasonDescription>Documento no otorgado</sac:VoidReasonDescription>',
    );
  });
});
