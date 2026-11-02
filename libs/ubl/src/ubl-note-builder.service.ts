import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { create } from 'xmlbuilder2';
import { CustomerSnapshot, IssuerSnapshot, UblDocument } from './ubl.types';

const CUSTOMER_CODES: Record<string, string> = {
  NONE: '0',
  DNI: '1',
  FOREIGN_ID: '4',
  RUC: '6',
  PASSPORT: '7',
  DIPLOMATIC_ID: 'A',
};

type XmlNode = ReturnType<typeof create>;

@Injectable()
export class UblNoteBuilderService {
  build(document: UblDocument) {
    this.validate(document);
    const credit = document.documentType === 'CREDIT_NOTE';
    const rootName = credit ? 'CreditNote' : 'DebitNote';
    const issuer = document.issuerSnapshot as unknown as IssuerSnapshot;
    const customer = document.customerSnapshot as unknown as CustomerSnapshot;
    const reference = document.references[0];
    const root = create({ version: '1.0', encoding: 'UTF-8' }).ele(rootName, {
      xmlns: `urn:oasis:names:specification:ubl:schema:xsd:${rootName}-2`,
      'xmlns:cac':
        'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
      'xmlns:cbc':
        'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
      'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
      'xmlns:ext':
        'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
    });
    root
      .ele('ext:UBLExtensions')
      .ele('ext:UBLExtension')
      .ele('ext:ExtensionContent');
    root.ele('cbc:UBLVersionID').txt('2.1');
    root.ele('cbc:CustomizationID').txt('2.0');
    root.ele('cbc:ID').txt(this.number(document.series, document.number));
    root.ele('cbc:IssueDate').txt(this.date(document.issueDate));
    if (document.issueTime) root.ele('cbc:IssueTime').txt(document.issueTime);
    root
      .ele('cbc:DocumentCurrencyCode', {
        listID: 'ISO 4217 Alpha',
        listName: 'Currency',
        listAgencyName: 'United Nations Economic Commission for Europe',
      })
      .txt(document.currency);

    const discrepancy = root.ele('cac:DiscrepancyResponse');
    discrepancy
      .ele('cbc:ReferenceID')
      .txt(this.number(reference.referencedSeries, reference.referencedNumber));
    discrepancy
      .ele('cbc:ResponseCode', {
        listAgencyName: 'PE:SUNAT',
        listName: credit ? 'Tipo de nota de credito' : 'Tipo de nota de debito',
        listURI: `urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo${credit ? '09' : '10'}`,
      })
      .txt(document.reasonCode!);
    discrepancy.ele('cbc:Description').txt(document.reasonDescription!);

    const invoiceReference = root
      .ele('cac:BillingReference')
      .ele('cac:InvoiceDocumentReference');
    invoiceReference
      .ele('cbc:ID')
      .txt(this.number(reference.referencedSeries, reference.referencedNumber));
    invoiceReference
      .ele('cbc:DocumentTypeCode', {
        listAgencyName: 'PE:SUNAT',
        listName: 'Tipo de Documento',
        listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01',
      })
      .txt(reference.referencedType === 'INVOICE' ? '01' : '03');

    this.signature(root, issuer);
    this.supplier(root, issuer);
    this.customer(root, customer);
    this.taxTotal(root, document);
    this.monetaryTotal(root, document);
    document.lines
      .slice()
      .sort((left, right) => left.lineNumber - right.lineNumber)
      .forEach((line) => this.line(root, document, line, credit));
    return root.end({ prettyPrint: false });
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
    const party = root.ele('cac:AccountingSupplierParty').ele('cac:Party');
    this.partyId(party, issuer.ruc, '6');
    if (issuer.tradeName) {
      party.ele('cac:PartyName').ele('cbc:Name').txt(issuer.tradeName);
    }
    const legal = party.ele('cac:PartyLegalEntity');
    legal.ele('cbc:RegistrationName').txt(issuer.legalName);
    const address = legal.ele('cac:RegistrationAddress');
    address
      .ele('cbc:ID', { schemeName: 'Ubigeos', schemeAgencyName: 'PE:INEI' })
      .txt(issuer.ubigeo);
    address
      .ele('cbc:AddressTypeCode', { listName: 'Establecimientos anexos' })
      .txt(issuer.establishmentCode);
    address.ele('cac:AddressLine').ele('cbc:Line').txt(issuer.address);
    address
      .ele('cac:Country')
      .ele('cbc:IdentificationCode', { listID: 'ISO 3166-1' })
      .txt('PE');
  }

  private customer(root: XmlNode, customer: CustomerSnapshot) {
    const party = root.ele('cac:AccountingCustomerParty').ele('cac:Party');
    this.partyId(
      party,
      customer.documentNumber?.trim() || '-',
      CUSTOMER_CODES[customer.documentType],
    );
    const legal = party.ele('cac:PartyLegalEntity');
    legal.ele('cbc:RegistrationName').txt(customer.name);
    if (customer.address) {
      legal
        .ele('cac:RegistrationAddress')
        .ele('cac:AddressLine')
        .ele('cbc:Line')
        .txt(customer.address);
    }
  }

  private partyId(parent: XmlNode, value: string, schemeID: string) {
    parent
      .ele('cac:PartyIdentification')
      .ele('cbc:ID', {
        schemeID,
        schemeName: 'Documento de Identidad',
        schemeAgencyName: 'PE:SUNAT',
        schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06',
      })
      .txt(value);
  }

  private taxTotal(root: XmlNode, document: UblDocument) {
    const total = root.ele('cac:TaxTotal');
    this.money(total, 'cbc:TaxAmount', document.taxAmount, document.currency);
    const categories = [
      ['10', document.taxableAmount, document.taxAmount],
      ['20', document.exemptAmount, new Prisma.Decimal(0)],
      ['30', document.unaffectedAmount, new Prisma.Decimal(0)],
    ] as const;
    categories
      .filter(([, base]) => base.gt(0))
      .forEach(([code, base, tax]) =>
        this.taxSubtotal(total, base, tax, document.currency, code),
      );
  }

  private monetaryTotal(root: XmlNode, document: UblDocument) {
    const total = root.ele(
      document.documentType === 'DEBIT_NOTE'
        ? 'cac:RequestedMonetaryTotal'
        : 'cac:LegalMonetaryTotal',
    );
    this.money(
      total,
      'cbc:PayableAmount',
      document.totalAmount,
      document.currency,
    );
  }

  private line(
    root: XmlNode,
    document: UblDocument,
    line: UblDocument['lines'][number],
    credit: boolean,
  ) {
    const node = root.ele(credit ? 'cac:CreditNoteLine' : 'cac:DebitNoteLine');
    node.ele('cbc:ID').txt(String(line.lineNumber));
    node
      .ele(credit ? 'cbc:CreditedQuantity' : 'cbc:DebitedQuantity', {
        unitCode: line.unitCode,
        unitCodeListID: 'UN/ECE rec 20',
        unitCodeListAgencyName: 'United Nations Economic Commission for Europe',
      })
      .txt(line.quantity.toFixed());
    this.money(
      node,
      'cbc:LineExtensionAmount',
      line.lineValue,
      document.currency,
    );
    const priceReference = node
      .ele('cac:PricingReference')
      .ele('cac:AlternativeConditionPrice');
    this.money(
      priceReference,
      'cbc:PriceAmount',
      line.unitPrice,
      document.currency,
      10,
    );
    priceReference.ele('cbc:PriceTypeCode').txt('01');
    const tax = node.ele('cac:TaxTotal');
    this.money(tax, 'cbc:TaxAmount', line.taxAmount, document.currency);
    this.taxSubtotal(
      tax,
      line.lineValue,
      line.taxAmount,
      document.currency,
      line.taxAffectationCode,
    );
    const item = node.ele('cac:Item');
    item.ele('cbc:Description').txt(line.description);
    if (line.sku) {
      item.ele('cac:SellersItemIdentification').ele('cbc:ID').txt(line.sku);
    }
    const price = node.ele('cac:Price');
    this.money(price, 'cbc:PriceAmount', line.unitValue, document.currency, 10);
  }

  private taxSubtotal(
    parent: XmlNode,
    base: Prisma.Decimal,
    tax: Prisma.Decimal,
    currency: string,
    affectation: string,
  ) {
    const data = this.taxData(affectation);
    const subtotal = parent.ele('cac:TaxSubtotal');
    this.money(subtotal, 'cbc:TaxableAmount', base, currency);
    this.money(subtotal, 'cbc:TaxAmount', tax, currency);
    const category = subtotal.ele('cac:TaxCategory');
    category.ele('cbc:ID').txt(data.category);
    category.ele('cbc:Percent').txt(data.percent);
    category
      .ele('cbc:TaxExemptionReasonCode', {
        listAgencyName: 'PE:SUNAT',
        listName: 'Afectacion del IGV',
        listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo07',
      })
      .txt(affectation);
    const scheme = category.ele('cac:TaxScheme');
    scheme
      .ele('cbc:ID', {
        schemeID: 'UN/ECE 5153',
        schemeName: 'Codigo de tributos',
        schemeAgencyName: 'PE:SUNAT',
      })
      .txt(data.id);
    scheme.ele('cbc:Name').txt(data.name);
    scheme.ele('cbc:TaxTypeCode').txt(data.type);
  }

  private taxData(code: string) {
    if (code === '20') {
      return {
        category: 'E',
        id: '9997',
        name: 'EXO',
        type: 'VAT',
        percent: '0',
      };
    }
    if (code === '30') {
      return {
        category: 'O',
        id: '9998',
        name: 'INA',
        type: 'FRE',
        percent: '0',
      };
    }
    return {
      category: 'S',
      id: '1000',
      name: 'IGV',
      type: 'VAT',
      percent: '18',
    };
  }

  private money(
    parent: XmlNode,
    name: string,
    amount: Prisma.Decimal,
    currency: string,
    scale = 2,
  ) {
    parent.ele(name, { currencyID: currency }).txt(amount.toFixed(scale));
  }

  private validate(document: UblDocument) {
    if (!['CREDIT_NOTE', 'DEBIT_NOTE'].includes(document.documentType)) {
      throw new BadRequestException('El documento no es una nota tributaria');
    }
    const issuer = document.issuerSnapshot as unknown as IssuerSnapshot;
    const customer = document.customerSnapshot as unknown as CustomerSnapshot;
    if (!/^\d{11}$/.test(issuer.ruc) || !/^\d{6}$/.test(issuer.ubigeo)) {
      throw new BadRequestException('Los datos del emisor son inválidos');
    }
    if (!CUSTOMER_CODES[customer.documentType]) {
      throw new BadRequestException(
        'Tipo de documento del cliente no soportado',
      );
    }
    if (!document.reasonCode || !document.reasonDescription) {
      throw new BadRequestException('La nota no tiene motivo SUNAT');
    }
    if (document.references.length !== 1) {
      throw new BadRequestException('La nota debe referenciar un comprobante');
    }
    if (!document.lines.length) {
      throw new BadRequestException('La nota debe tener líneas calculadas');
    }
  }

  private number(series: string, number: number) {
    return `${series}-${number}`;
  }

  private date(value: Date) {
    return value.toISOString().slice(0, 10);
  }
}
