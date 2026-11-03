import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { amountInWords } from './amount-in-words';
import { PdfCustomer, PdfFormat, PdfIssuer, PdfTaxDocument } from './pdf.types';
import { SunatQrService } from './sunat-qr.service';
import type { ResolvedBrandingLogo } from './branding-logo-resolver.service';

const INK = '#111111';
const BORDER = '#8A8A8A';
const SOFT = '#E6E6E6';
const MUTED = '#555555';

@Injectable()
export class PdfRendererService {
  constructor(private readonly qr: SunatQrService) {}

  async render(
    document: PdfTaxDocument,
    format: PdfFormat,
    logo?: ResolvedBrandingLogo,
  ): Promise<Buffer> {
    const qr = await this.qr.png(document);
    return format === 'A4'
      ? this.a4(document, qr, logo)
      : this.ticket(document, qr, logo);
  }

  private a4(
    document: PdfTaxDocument,
    qr: Buffer,
    logo?: ResolvedBrandingLogo,
  ) {
    const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: 34, left: 38, right: 38, bottom: 34 },
      bufferPages: true,
      info: this.info(document),
    });
    const result = this.collect(pdf);
    const issuer = document.issuerSnapshot as unknown as PdfIssuer;
    const customer = document.customerSnapshot as unknown as PdfCustomer;

    this.a4Header(pdf, document, issuer, logo);
    this.a4Customer(pdf, document, customer);

    const note = this.isNote(document);
    if (note) this.a4NoteDetails(pdf, document);
    let y = this.a4TableHeader(pdf, note ? 278 : 225);
    for (const line of document.lines) {
      const rowHeight = Math.max(
        22,
        pdf.heightOfString(line.description, { width: 220 }) + 9,
      );
      if (y + rowHeight > 540) {
        pdf.addPage();
        y = this.a4TableHeader(pdf, 45);
      }
      pdf.fillColor(INK).font('Helvetica').fontSize(7.5);
      pdf.text(line.quantity.toFixed(2), 42, y + 7, {
        width: 45,
        align: 'center',
      });
      pdf.text(line.unitCode, 87, y + 7, { width: 48, align: 'center' });
      pdf.text(line.sku ?? line.externalId ?? '-', 135, y + 7, {
        width: 65,
        align: 'center',
      });
      pdf.text(line.description, 200, y + 6, { width: 220 });
      pdf.text(line.unitValue.toFixed(2), 420, y + 7, {
        width: 62,
        align: 'right',
      });
      pdf.text(line.totalAmount.toFixed(2), 482, y + 7, {
        width: 69,
        align: 'right',
      });
      pdf
        .strokeColor(BORDER)
        .lineWidth(0.5)
        .moveTo(40, y + rowHeight)
        .lineTo(553, y + rowHeight)
        .stroke();
      y += rowHeight;
    }

    y = this.a4Totals(pdf, document, y);
    this.a4AmountAndQr(pdf, document, qr, y + 12);
    this.a4Observations(pdf, document, y + 118);
    this.a4Footer(pdf, document);
    this.pageNumbers(pdf);
    pdf.end();
    return result;
  }

  private a4Header(
    pdf: PDFKit.PDFDocument,
    document: PdfTaxDocument,
    issuer: PdfIssuer,
    logo?: ResolvedBrandingLogo,
  ) {
    if (logo) {
      this.logo(pdf, logo, 42, 43, 270, 58);
    } else {
      pdf
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(24)
        .text(issuer.tradeName || issuer.legalName, 42, 54, {
          width: 270,
          align: 'center',
        });
    }
    pdf
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(issuer.legalName, 42, 121, { width: 270 });
    pdf
      .font('Helvetica')
      .fontSize(7.5)
      .text(issuer.address, 42, 137, { width: 270 });
    pdf.text(`Nombre comercial: ${issuer.tradeName || '-'}`, 42, 150, {
      width: 270,
    });

    pdf.roundedRect(330, 38, 223, 82, 4).fillAndStroke(SOFT, BORDER);
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(`R.U.C. N° ${issuer.ruc}`, 340, 55, {
        width: 203,
        align: 'center',
      });
    pdf.fontSize(11).text(this.documentTitle(document), 340, 76, {
      width: 203,
      align: 'center',
    });
    pdf.fontSize(11).text(`${document.series}-${document.number}`, 340, 98, {
      width: 203,
      align: 'center',
    });
  }

  private a4Customer(
    pdf: PDFKit.PDFDocument,
    document: PdfTaxDocument,
    customer: PdfCustomer,
  ) {
    const y = 132;
    pdf.roundedRect(330, y, 223, 76, 4).strokeColor(BORDER).stroke();
    const rows: Array<[string, string]> = [
      ['Fecha emisión', this.shortDate(document)],
      ['Señor(es)', customer.name],
      [customer.documentType || 'Documento', customer.documentNumber ?? '-'],
      ['Dirección', customer.address ?? '-'],
    ];
    rows.forEach(([label, value], index) => {
      const rowY = y + 10 + index * 15;
      pdf
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(7)
        .text(label, 340, rowY, { width: 62 });
      pdf.font('Helvetica').text(`: ${value}`, 403, rowY, { width: 140 });
    });
    pdf
      .font('Helvetica')
      .fontSize(7)
      .text(
        `Moneda: ${document.currency} | Pago: ${document.paymentMethod === 'CREDIT' ? 'Crédito' : 'Contado'}`,
        42,
        171,
        { width: 270 },
      );
  }

  private a4TableHeader(pdf: PDFKit.PDFDocument, y: number) {
    pdf.rect(40, y, 513, 24).fillAndStroke('#F2F2F2', BORDER);
    pdf.fillColor(INK).font('Helvetica-Bold').fontSize(7.5);
    const headers: Array<
      [string, number, number, 'left' | 'center' | 'right']
    > = [
      ['Cant.', 42, 45, 'center'],
      ['Unidad', 87, 48, 'center'],
      ['Código', 135, 65, 'center'],
      ['Descripción', 200, 220, 'center'],
      ['P.U.', 420, 62, 'right'],
      ['Total', 482, 69, 'right'],
    ];
    headers.forEach(([label, x, width, align]) =>
      pdf.text(label, x, y + 8, { width, align }),
    );
    return y + 24;
  }

  private a4NoteDetails(pdf: PDFKit.PDFDocument, document: PdfTaxDocument) {
    const reference = document.references[0];
    const referencedTitle = reference
      ? this.documentTypeLabel(reference.referencedType)
      : 'COMPROBANTE';
    const referencedNumber = reference
      ? `${reference.referencedSeries}-${reference.referencedNumber}`
      : '-';
    pdf.roundedRect(40, 218, 513, 49, 4).strokeColor(BORDER).stroke();
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text('COMPROBANTE AFECTADO:', 48, 228, { width: 126 });
    pdf
      .font('Helvetica')
      .text(`${referencedTitle} ${referencedNumber}`, 174, 228, {
        width: 365,
      });
    pdf.font('Helvetica-Bold').text('MOTIVO SUNAT:', 48, 246, { width: 126 });
    pdf
      .font('Helvetica')
      .text(
        `${document.reasonCode ?? '-'} - ${document.reasonDescription ?? '-'}`,
        174,
        246,
        { width: 365 },
      );
  }

  private a4Totals(
    pdf: PDFKit.PDFDocument,
    document: PdfTaxDocument,
    y: number,
  ) {
    const rows = this.totalRows(document);
    const boxHeight = rows.length * 15 + 10;
    pdf.rect(40, y, 513, boxHeight).strokeColor(BORDER).stroke();
    let rowY = y + 7;
    pdf.fillColor(INK).fontSize(8);
    for (const [label, amount, bold] of rows) {
      pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      pdf.text(label, 385, rowY, { width: 90, align: 'right' });
      pdf.text(this.currencySymbol(document.currency), 482, rowY, {
        width: 18,
        align: 'center',
      });
      pdf.text(amount, 500, rowY, { width: 43, align: 'right' });
      rowY += 15;
    }
    return y + boxHeight;
  }

  private a4AmountAndQr(
    pdf: PDFKit.PDFDocument,
    document: PdfTaxDocument,
    qr: Buffer,
    y: number,
  ) {
    pdf.roundedRect(40, y, 513, 100, 4).strokeColor(BORDER).stroke();
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('IMPORTE EN LETRAS:', 48, y + 12, { width: 102 });
    pdf
      .font('Helvetica')
      .text(
        amountInWords(document.totalAmount.toFixed(2), document.currency),
        145,
        y + 12,
        { width: 285 },
      );
    pdf.image(qr, 456, y + 8, { width: 84, height: 84 });
    if (document.paymentMethod === 'CREDIT' && document.installments.length) {
      pdf
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .text('CUOTAS:', 48, y + 38);
      document.installments.slice(0, 4).forEach((installment, index) => {
        pdf
          .font('Helvetica')
          .text(
            `${installment.number}. ${document.currency} ${installment.amount.toFixed(2)} - ${installment.dueDate.toISOString().slice(0, 10)}`,
            48,
            y + 53 + index * 11,
            { width: 350 },
          );
      });
    }
  }

  private a4Observations(
    pdf: PDFKit.PDFDocument,
    document: PdfTaxDocument,
    y: number,
  ) {
    pdf.roundedRect(40, y, 513, 39, 4).strokeColor(BORDER).stroke();
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text('OBSERVACIONES:', 48, y + 8);
    pdf
      .font('Helvetica')
      .text(document.sunatMessage ?? 'Sin observaciones.', 48, y + 20, {
        width: 495,
      });
  }

  private a4Footer(pdf: PDFKit.PDFDocument, document: PdfTaxDocument) {
    pdf
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(6.8)
      .text(
        `Representación impresa de la ${this.documentTitle(document)}. Consulte la validez del comprobante en el portal de SUNAT. Estado: ${this.status(document)}. Código: ${document.sunatCode ?? '-'}.`,
        60,
        782,
        { width: 475, align: 'center', lineBreak: false },
      );
  }

  private ticket(
    document: PdfTaxDocument,
    qr: Buffer,
    logo?: ResolvedBrandingLogo,
  ) {
    const estimated =
      485 +
      document.lines.length * 34 +
      document.installments.length * 12 +
      (this.isNote(document) ? 42 : 0);
    const height = Math.max(650, Math.min(1600, estimated));
    const pdf = new PDFDocument({
      size: [226.77, height],
      margins: { top: 18, left: 13, right: 13, bottom: 18 },
      info: this.info(document),
    });
    const result = this.collect(pdf);
    const issuer = document.issuerSnapshot as unknown as PdfIssuer;
    const customer = document.customerSnapshot as unknown as PdfCustomer;
    const width = 200.77;
    let y = 22;

    if (logo) {
      this.logo(pdf, logo, 38, y, 150, 55);
      y += 68;
    } else {
      pdf
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(18)
        .text(issuer.tradeName || issuer.legalName, 13, y, {
          width,
          align: 'center',
        });
      y = pdf.y + 17;
    }
    pdf.font('Courier-Bold').fontSize(8).text(issuer.legalName, 13, y, {
      width,
      align: 'center',
    });
    pdf
      .font('Courier')
      .fontSize(7.5)
      .text(issuer.address, 13, pdf.y + 3, { width, align: 'center' });
    if (issuer.tradeName) {
      pdf.text(`NOMBRE COMERCIAL: ${issuer.tradeName}`, 13, pdf.y + 3, {
        width,
        align: 'center',
      });
    }
    pdf.text(`R.U.C. N° ${issuer.ruc}`, 13, pdf.y + 4, {
      width,
      align: 'center',
    });
    pdf
      .font('Courier-Bold')
      .fontSize(9)
      .text(this.documentTitle(document), 13, pdf.y + 4, {
        width,
        align: 'center',
      });
    pdf
      .fontSize(11)
      .text(`${document.series}-${document.number}`, 13, pdf.y + 5, {
        width,
        align: 'center',
      });
    y = pdf.y + 20;

    y = this.ticketRule(pdf, y);
    pdf.font('Courier-Bold').fontSize(8);
    y = this.ticketField(pdf, 'Fecha', this.shortDate(document), y, width);
    y = this.ticketField(pdf, 'Cliente', customer.name, y, width);
    y = this.ticketField(
      pdf,
      customer.documentType || 'Doc.',
      customer.documentNumber ?? '-',
      y,
      width,
    );
    y = this.ticketField(pdf, 'Dirección', customer.address ?? '-', y, width);
    if (this.isNote(document)) {
      const reference = document.references[0];
      y = this.ticketField(
        pdf,
        'Doc. afectado',
        reference
          ? `${this.documentTypeLabel(reference.referencedType)} ${reference.referencedSeries}-${reference.referencedNumber}`
          : '-',
        y,
        width,
      );
      y = this.ticketField(
        pdf,
        `Motivo ${document.reasonCode ?? '-'}`,
        document.reasonDescription ?? '-',
        y,
        width,
      );
    }
    y = this.ticketRule(pdf, y + 3);

    pdf.font('Courier-Bold').fontSize(7.5);
    pdf.text('CANT.', 13, y, { width: 35 });
    pdf.text('DESCRIPCIÓN', 48, y, { width: 94 });
    pdf.text('P.UNIT', 142, y, { width: 34, align: 'right' });
    pdf.text('TOTAL', 176, y, { width: 37, align: 'right' });
    y = this.ticketRule(pdf, y + 12);

    for (const line of document.lines) {
      const descriptionHeight = pdf.heightOfString(line.description, {
        width: 94,
      });
      const rowHeight = Math.max(13, descriptionHeight + 4);
      pdf.font('Courier').fontSize(7.3);
      pdf.text(line.quantity.toFixed(2), 13, y, { width: 35 });
      pdf.text(line.description, 48, y, { width: 94 });
      pdf.text(line.unitValue.toFixed(2), 142, y, {
        width: 34,
        align: 'right',
      });
      pdf.text(line.totalAmount.toFixed(2), 176, y, {
        width: 37,
        align: 'right',
      });
      y += rowHeight;
    }
    y = this.ticketRule(pdf, y + 2);

    pdf.font('Courier').fontSize(8);
    for (const [label, amount, bold] of this.totalRows(document)) {
      pdf.font(bold ? 'Courier-Bold' : 'Courier');
      pdf.text(label, 13, y, { width: 125 });
      pdf.text(this.currencySymbol(document.currency), 138, y, {
        width: 22,
        align: 'right',
      });
      pdf.text(amount, 160, y, { width: 53, align: 'right' });
      y += 13;
    }

    y += 15;
    pdf
      .font('Courier-Bold')
      .fontSize(7.6)
      .text('IMPORTE EN LETRAS', 13, y, { width });
    pdf
      .font('Courier')
      .text(
        amountInWords(document.totalAmount.toFixed(2), document.currency),
        13,
        y + 14,
        { width },
      );
    y = pdf.y + 18;

    pdf.image(qr, 64, y, { width: 99, height: 99 });
    y += 111;
    pdf
      .font('Courier-Bold')
      .fontSize(8)
      .text('¡Gracias por su preferencia!', 13, y, {
        width,
        align: 'center',
      });
    pdf
      .font('Courier')
      .fontSize(7)
      .text(
        `Representación impresa de la ${this.documentTitle(document)}. Consulte la validez en el portal de SUNAT.`,
        13,
        pdf.y + 14,
        { width, align: 'center' },
      );
    pdf.text(
      `Estado: ${this.status(document)} - Código: ${document.sunatCode ?? '-'}`,
      13,
      pdf.y + 6,
      { width, align: 'center' },
    );
    pdf.end();
    return result;
  }

  private ticketField(
    pdf: PDFKit.PDFDocument,
    label: string,
    value: string,
    y: number,
    width: number,
  ) {
    pdf.font('Courier-Bold');
    const labelHeight = pdf.heightOfString(`${label}:`, { width: 55 });
    pdf.text(`${label}:`, 13, y, { width: 55 });
    pdf.font('Courier');
    const valueHeight = pdf.heightOfString(value, { width: width - 55 });
    pdf.text(value, 68, y, { width: width - 55 });
    return y + Math.max(12, labelHeight, valueHeight) + 3;
  }

  private ticketRule(pdf: PDFKit.PDFDocument, y: number) {
    pdf
      .strokeColor(INK)
      .lineWidth(0.7)
      .moveTo(13, y)
      .lineTo(213.77, y)
      .stroke();
    return y + 7;
  }

  private totalRows(
    document: PdfTaxDocument,
  ): Array<[string, string, boolean]> {
    const rows: Array<[string, string, boolean]> = [
      ['SUB TOTAL', document.taxableAmount.toFixed(2), false],
    ];
    if (!document.exemptAmount.isZero())
      rows.push(['OP. EXONERADA', document.exemptAmount.toFixed(2), false]);
    if (!document.unaffectedAmount.isZero())
      rows.push(['OP. INAFECTA', document.unaffectedAmount.toFixed(2), false]);
    if (!document.discountAmount.isZero())
      rows.push(['DESCUENTO', document.discountAmount.toFixed(2), false]);
    rows.push(
      ['I.G.V.', document.taxAmount.toFixed(2), false],
      ['TOTAL', document.totalAmount.toFixed(2), true],
    );
    return rows;
  }

  private status(document: PdfTaxDocument) {
    return document.status === 'ACCEPTED_WITH_OBSERVATIONS'
      ? 'ACEPTADO CON OBSERVACIONES'
      : 'ACEPTADO';
  }

  private shortDate(document: PdfTaxDocument) {
    const [year, month, day] = document.issueDate
      .toISOString()
      .slice(0, 10)
      .split('-');
    return `${day}/${month}/${year}`;
  }

  private currencySymbol(currency: string) {
    return currency === 'PEN' ? 'S/' : currency === 'USD' ? '$' : currency;
  }

  private info(document: PdfTaxDocument) {
    return {
      Title: `${this.documentTitle(document)} ${document.series}-${document.number}`,
      Author: (document.issuerSnapshot as unknown as PdfIssuer).legalName,
      Subject: 'Representación impresa de comprobante de pago electrónico',
      Creator: 'Nuvex Billing API',
    };
  }

  private documentTitle(document: PdfTaxDocument) {
    return {
      INVOICE: 'FACTURA ELECTRÓNICA',
      RECEIPT: 'BOLETA DE VENTA ELECTRÓNICA',
      CREDIT_NOTE: 'NOTA DE CRÉDITO ELECTRÓNICA',
      DEBIT_NOTE: 'NOTA DE DÉBITO ELECTRÓNICA',
      DESPATCH_GUIDE: 'GUÍA DE REMISIÓN ELECTRÓNICA',
    }[document.documentType];
  }

  private isNote(document: PdfTaxDocument) {
    return ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(document.documentType);
  }

  private documentTypeLabel(documentType: PdfTaxDocument['documentType']) {
    return {
      INVOICE: 'FACTURA',
      RECEIPT: 'BOLETA',
      CREDIT_NOTE: 'NOTA DE CRÉDITO',
      DEBIT_NOTE: 'NOTA DE DÉBITO',
      DESPATCH_GUIDE: 'GUÍA DE REMISIÓN',
    }[documentType];
  }

  private collect(pdf: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
    });
  }

  private pageNumbers(pdf: PDFKit.PDFDocument) {
    const range = pdf.bufferedPageRange();
    for (
      let index = range.start;
      index < range.start + range.count;
      index += 1
    ) {
      pdf.switchToPage(index);
      pdf
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(6.5)
        .text(`${index + 1}/${range.count}`, 500, 796, {
          width: 52,
          align: 'right',
          lineBreak: false,
        });
    }
  }

  private logo(
    pdf: PDFKit.PDFDocument,
    logo: ResolvedBrandingLogo,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    const scale = Math.min(width / logo.width, height / logo.height, 1);
    const renderedWidth = logo.width * scale;
    const renderedHeight = logo.height * scale;
    pdf.image(
      logo.body,
      x + (width - renderedWidth) / 2,
      y + (height - renderedHeight) / 2,
      { width: renderedWidth, height: renderedHeight },
    );
  }
}
