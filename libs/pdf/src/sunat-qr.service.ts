import { Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import { PdfTaxDocument, PdfCustomer, PdfIssuer } from './pdf.types';

const CUSTOMER_DOCUMENT_CODES: Record<string, string> = {
  NONE: '0',
  DNI: '1',
  FOREIGN_ID: '4',
  RUC: '6',
  PASSPORT: '7',
  DIPLOMATIC_ID: 'A',
};

@Injectable()
export class SunatQrService {
  payload(document: PdfTaxDocument): string {
    const issuer = document.issuerSnapshot as unknown as PdfIssuer;
    const customer = document.customerSnapshot as unknown as PdfCustomer;
    const customerType = CUSTOMER_DOCUMENT_CODES[customer.documentType] ?? '';
    const documentCode = {
      INVOICE: '01',
      RECEIPT: '03',
      CREDIT_NOTE: '07',
      DEBIT_NOTE: '08',
      DESPATCH_GUIDE: '09',
    }[document.documentType];
    return [
      issuer.ruc,
      documentCode,
      document.series,
      String(document.number),
      document.taxAmount.toFixed(2),
      document.totalAmount.toFixed(2),
      document.issueDate.toISOString().slice(0, 10),
      customerType,
      customer.documentNumber ?? '',
      document.sunatHash ?? '',
      '',
    ].join('|');
  }

  async png(document: PdfTaxDocument): Promise<Buffer> {
    return QRCode.toBuffer(this.payload(document), {
      type: 'png',
      errorCorrectionLevel: 'Q',
      margin: 1,
      width: 420,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  }
}
