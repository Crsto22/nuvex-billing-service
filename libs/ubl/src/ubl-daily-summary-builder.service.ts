import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { create } from 'xmlbuilder2';
import { IssuerSnapshot } from './ubl.types';

type SummaryDocument = Prisma.DailySummaryGetPayload<{
  include: {
    items: { include: { document: { include: { references: true } } } };
    tenant: true;
  };
}>;

type XmlNode = ReturnType<typeof create>;

@Injectable()
export class UblDailySummaryBuilderService {
  build(summary: SummaryDocument) {
    if (!summary.items.length) {
      throw new BadRequestException('El Resumen Diario no tiene documentos');
    }
    const first = summary.items[0].document;
    const issuer = first.issuerSnapshot as unknown as IssuerSnapshot;
    if (!/^\d{11}$/.test(issuer.ruc)) {
      throw new BadRequestException('El emisor debe tener un RUC valido');
    }
    for (const item of summary.items) {
      if (!['1', '2', '3', '4'].includes(item.conditionCode)) {
        throw new BadRequestException(
          'El codigo de condicion del Resumen Diario no es valido',
        );
      }
      if (
        !['RECEIPT', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(
          item.document.documentType,
        )
      ) {
        throw new BadRequestException(
          'El Resumen Diario solo admite boletas y sus notas',
        );
      }
      if (!item.document.series.startsWith('B')) {
        throw new BadRequestException(
          'Los documentos del Resumen Diario deben usar serie B',
        );
      }
    }

    const root = create({ version: '1.0', encoding: 'UTF-8' }).ele(
      'SummaryDocuments',
      {
        xmlns:
          'urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1',
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
    root.ele('cbc:CustomizationID').txt('1.1');
    root.ele('cbc:ID').txt(this.id(summary));
    root
      .ele('cbc:ReferenceDate')
      .txt(summary.referenceDate.toISOString().slice(0, 10));
    root
      .ele('cbc:IssueDate')
      .txt(summary.generationDate.toISOString().slice(0, 10));
    this.signature(root, issuer);
    this.supplier(root, issuer);

    [...summary.items]
      .sort((left, right) => left.lineId - right.lineId)
      .forEach((item) => this.line(root, item));
    return root.end({ prettyPrint: false });
  }

  id(summary: Pick<SummaryDocument, 'generationDate' | 'sequence'>) {
    return `RC-${summary.generationDate.toISOString().slice(0, 10).replace(/-/g, '')}-${String(summary.sequence).padStart(3, '0')}`;
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

  private line(root: XmlNode, item: SummaryDocument['items'][number]) {
    const document = item.document;
    const customer = document.customerSnapshot as {
      documentType?: string;
      documentNumber?: string | null;
    };
    const node = root.ele('sac:SummaryDocumentsLine');
    node.ele('cbc:LineID').txt(String(item.lineId));
    node
      .ele('cbc:DocumentTypeCode')
      .txt(this.documentCode(document.documentType));
    node.ele('cbc:ID').txt(`${document.series}-${document.number}`);
    if (customer.documentNumber) {
      node
        .ele('cac:AccountingCustomerParty')
        .ele('cbc:CustomerAssignedAccountID')
        .txt(customer.documentNumber)
        .up()
        .ele('cbc:AdditionalAccountID')
        .txt(this.customerCode(customer.documentType));
    }
    if (
      ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(document.documentType) &&
      document.references[0]
    ) {
      const reference = document.references[0];
      const invoiceReference = node
        .ele('cac:BillingReference')
        .ele('cac:InvoiceDocumentReference');
      invoiceReference
        .ele('cbc:ID')
        .txt(`${reference.referencedSeries}-${reference.referencedNumber}`);
      invoiceReference
        .ele('cbc:DocumentTypeCode')
        .txt(reference.referencedType === 'INVOICE' ? '01' : '03');
    }
    node.ele('cac:Status').ele('cbc:ConditionCode').txt(item.conditionCode);
    this.money(
      node,
      'sac:TotalAmount',
      document.totalAmount,
      document.currency,
    );
    if (document.taxableAmount.gt(0)) {
      const billing = node.ele('sac:BillingPayment');
      this.money(
        billing,
        'cbc:PaidAmount',
        document.taxableAmount,
        document.currency,
      );
      billing.ele('cbc:InstructionID').txt('01');
    }
    if (document.exemptAmount.gt(0)) {
      const billing = node.ele('sac:BillingPayment');
      this.money(
        billing,
        'cbc:PaidAmount',
        document.exemptAmount,
        document.currency,
      );
      billing.ele('cbc:InstructionID').txt('02');
    }
    if (document.unaffectedAmount.gt(0)) {
      const billing = node.ele('sac:BillingPayment');
      this.money(
        billing,
        'cbc:PaidAmount',
        document.unaffectedAmount,
        document.currency,
      );
      billing.ele('cbc:InstructionID').txt('03');
    }
    const tax = node.ele('cac:TaxTotal');
    this.money(tax, 'cbc:TaxAmount', document.taxAmount, document.currency);
    const subtotal = tax.ele('cac:TaxSubtotal');
    this.money(
      subtotal,
      'cbc:TaxAmount',
      document.taxAmount,
      document.currency,
    );
    const category = subtotal.ele('cac:TaxCategory');
    if (document.taxableAmount.gt(0)) {
      category.ele('cbc:Percent').txt('18.00');
    }
    const scheme = category.ele('cac:TaxScheme');
    scheme.ele('cbc:ID').txt('1000');
    scheme.ele('cbc:Name').txt('IGV');
    scheme.ele('cbc:TaxTypeCode').txt('VAT');
  }

  private documentCode(type: string) {
    if (type === 'CREDIT_NOTE') return '07';
    if (type === 'DEBIT_NOTE') return '08';
    return '03';
  }

  private customerCode(type?: string) {
    return (
      (
        { DNI: '1', FOREIGN_ID: '4', RUC: '6', PASSPORT: '7' } as Record<
          string,
          string
        >
      )[type ?? ''] ?? '0'
    );
  }

  private money(
    parent: XmlNode,
    name: string,
    amount: Prisma.Decimal,
    currency: string,
  ) {
    parent.ele(name, { currencyID: currency }).txt(amount.toFixed(2));
  }
}
