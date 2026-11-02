import { BadRequestException, Injectable } from '@nestjs/common';
import { create } from 'xmlbuilder2';
import { IssuerSnapshot } from './ubl.types';

type XmlNode = ReturnType<typeof create>;

interface VoidedDocumentsBatch {
  generationDate: Date;
  referenceDate: Date;
  sequence: number;
  tenant: { ruc: string };
  items: Array<{
    lineId: number;
    document: {
      documentType: string;
      series: string;
      number: number;
      issuerSnapshot: unknown;
    };
    voidRequest: { reason: string } | null;
  }>;
}

@Injectable()
export class UblVoidedDocumentsBuilderService {
  build(batch: VoidedDocumentsBatch) {
    if (!batch.items.length) {
      throw new BadRequestException(
        'La Comunicacion de Baja no tiene documentos',
      );
    }
    const issuer = batch.items[0].document.issuerSnapshot as IssuerSnapshot;
    if (!/^\d{11}$/.test(issuer.ruc) || issuer.ruc !== batch.tenant.ruc) {
      throw new BadRequestException('El emisor debe tener un RUC valido');
    }
    for (const item of batch.items) {
      if (
        !['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(
          item.document.documentType,
        )
      ) {
        throw new BadRequestException(
          'La Comunicacion de Baja solo admite facturas y sus notas',
        );
      }
      if (!item.voidRequest?.reason.trim()) {
        throw new BadRequestException(
          'Cada documento debe indicar el motivo de baja',
        );
      }
    }

    const root = create({ version: '1.0', encoding: 'UTF-8' }).ele(
      'VoidedDocuments',
      {
        xmlns:
          'urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1',
        'xmlns:cac':
          'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
        'xmlns:cbc':
          'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
        'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
        'xmlns:ext':
          'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
        'xmlns:sac':
          'urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1',
      },
    );
    root
      .ele('ext:UBLExtensions')
      .ele('ext:UBLExtension')
      .ele('ext:ExtensionContent');
    root.ele('cbc:UBLVersionID').txt('2.0');
    root.ele('cbc:CustomizationID').txt('1.0');
    root.ele('cbc:ID').txt(this.id(batch));
    root
      .ele('cbc:ReferenceDate')
      .txt(batch.referenceDate.toISOString().slice(0, 10));
    root
      .ele('cbc:IssueDate')
      .txt(batch.generationDate.toISOString().slice(0, 10));
    this.signature(root, issuer);
    this.supplier(root, issuer);

    [...batch.items]
      .sort((left, right) => left.lineId - right.lineId)
      .forEach((item) => {
        const line = root.ele('sac:VoidedDocumentsLine');
        line.ele('cbc:LineID').txt(String(item.lineId));
        line
          .ele('cbc:DocumentTypeCode')
          .txt(this.documentCode(item.document.documentType));
        line.ele('sac:DocumentSerialID').txt(item.document.series);
        line.ele('sac:DocumentNumberID').txt(String(item.document.number));
        line
          .ele('sac:VoidReasonDescription')
          .txt(item.voidRequest!.reason.trim());
      });
    return root.end({ prettyPrint: false });
  }

  id(batch: Pick<VoidedDocumentsBatch, 'generationDate' | 'sequence'>) {
    return `RA-${batch.generationDate.toISOString().slice(0, 10).replace(/-/g, '')}-${String(batch.sequence).padStart(3, '0')}`;
  }

  private signature(root: XmlNode, issuer: IssuerSnapshot) {
    const signature = root.ele('cac:Signature');
    signature.ele('cbc:ID').txt('SIGNATURE');
    const party = signature.ele('cac:SignatoryParty');
    party.ele('cac:PartyIdentification').ele('cbc:ID').txt(issuer.ruc);
    party
      .ele('cac:PartyName')
      .ele('cbc:Name')
      .txt(issuer.tradeName || issuer.legalName);
    signature
      .ele('cac:DigitalSignatureAttachment')
      .ele('cac:ExternalReference')
      .ele('cbc:URI')
      .txt('#SIGNATURE');
  }

  private supplier(root: XmlNode, issuer: IssuerSnapshot) {
    const party = root.ele('cac:AccountingSupplierParty');
    party.ele('cbc:CustomerAssignedAccountID').txt(issuer.ruc);
    party.ele('cbc:AdditionalAccountID').txt('6');
    party
      .ele('cac:Party')
      .ele('cac:PartyLegalEntity')
      .ele('cbc:RegistrationName')
      .txt(issuer.legalName);
  }

  private documentCode(type: string) {
    if (type === 'CREDIT_NOTE') return '07';
    if (type === 'DEBIT_NOTE') return '08';
    return '01';
  }
}
