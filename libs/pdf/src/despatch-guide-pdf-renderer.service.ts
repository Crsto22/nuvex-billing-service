import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  PdfDespatchGuide,
  PdfDespatchIssuer,
} from './despatch-guide-pdf.types';
import { DespatchGuideQrService } from './despatch-guide-qr.service';

const INK = '#151515';
const MUTED = '#555555';
const BORDER = '#8A8A8A';
const SOFT = '#E6E6E6';
const TABLE_HEADER = '#F2F2F2';

@Injectable()
export class DespatchGuidePdfRendererService {
  constructor(private readonly qr: DespatchGuideQrService) {}

  async render(guide: PdfDespatchGuide): Promise<Buffer> {
    const qr = await this.qr.png(guide);
    const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: 34, left: 38, right: 38, bottom: 38 },
      bufferPages: true,
      info: this.info(guide),
    });
    const result = this.collect(pdf);
    const issuer = guide.issuerSnapshot as unknown as PdfDespatchIssuer;

    this.header(pdf, guide, issuer);
    this.transferDetails(pdf, guide);
    let y = this.tableHeader(pdf, 341);

    for (const item of guide.items) {
      const height = Math.max(
        22,
        pdf.heightOfString(item.description, { width: 300 }) + 10,
      );
      if (y + height > 690) {
        pdf.addPage();
        this.continuationHeader(pdf, guide);
        y = this.tableHeader(pdf, 78);
      }
      pdf.fillColor(INK).font('Helvetica').fontSize(7.5);
      pdf.text(String(item.lineNumber), 42, y + 7, {
        width: 28,
        align: 'center',
      });
      pdf.text(item.quantity.toFixed(), 70, y + 7, {
        width: 55,
        align: 'right',
      });
      pdf.text(item.unitCode, 125, y + 7, {
        width: 47,
        align: 'center',
      });
      pdf.text(item.sku || '-', 172, y + 7, {
        width: 75,
        align: 'center',
      });
      pdf.text(item.description, 247, y + 6, { width: 304 });
      pdf
        .strokeColor(BORDER)
        .lineWidth(0.4)
        .moveTo(40, y + height)
        .lineTo(553, y + height)
        .stroke();
      y += height;
    }

    if (y + 158 > 748) {
      pdf.addPage();
      this.continuationHeader(pdf, guide);
      y = 86;
    }
    this.footerBlock(pdf, guide, qr, y + 12);
    this.pageFooters(pdf);
    pdf.end();
    return result;
  }

  private header(
    pdf: PDFKit.PDFDocument,
    guide: PdfDespatchGuide,
    issuer: PdfDespatchIssuer,
  ) {
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(21)
      .text(issuer.tradeName || issuer.legalName, 42, 54, {
        width: 275,
        align: 'center',
      });
    pdf.fontSize(8).text(issuer.legalName, 42, 111, { width: 275 });
    pdf
      .font('Helvetica')
      .fontSize(6.8)
      .text(issuer.address, 42, 126, { width: 275, height: 20 });
    pdf.text(`Nombre comercial: ${issuer.tradeName || '-'}`, 42, 151, {
      width: 275,
    });
    pdf.text(`Ubigeo: ${issuer.ubigeo}`, 42, 163, { width: 275 });
    pdf.text(
      `Inicio del traslado: ${this.date(guide.transferStartDate)}`,
      42,
      181,
      { width: 275 },
    );
    pdf.text(
      `Motivo: ${guide.transferReasonCode}${guide.transferReasonDescription ? ` - ${guide.transferReasonDescription}` : ''}`,
      42,
      193,
      { width: 275, height: 12, ellipsis: true },
    );
    pdf.text(
      `Modalidad: ${guide.transportMode === 'PUBLIC' ? 'PUBLICO (01)' : 'PRIVADO (02)'}`,
      42,
      205,
      { width: 160 },
    );
    pdf.text(
      `Peso: ${guide.grossWeight.toFixed(3)} ${guide.weightUnit}   Bultos: ${guide.packageCount ?? '-'}`,
      42,
      217,
      { width: 275 },
    );

    pdf.roundedRect(330, 38, 223, 82, 4).fillAndStroke(SOFT, BORDER);
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(`R.U.C. N\u00b0 ${issuer.ruc}`, 340, 50, {
        width: 203,
        align: 'center',
      });
    pdf.fontSize(9.5).text('GUIA DE REMISION ELECTRONICA', 340, 70, {
      width: 203,
      align: 'center',
    });
    pdf.fontSize(9).text('REMITENTE', 340, 87, {
      width: 203,
      align: 'center',
    });
    pdf.fontSize(11).text(`${guide.series}-${guide.number}`, 340, 102, {
      width: 203,
      align: 'center',
    });

    pdf.roundedRect(330, 132, 223, 98, 4).strokeColor(BORDER).stroke();
    this.labelValue(
      pdf,
      'Fecha emision',
      this.date(guide.issueDate),
      340,
      143,
      72,
      125,
    );
    this.labelValue(pdf, 'Hora', guide.issueTime, 340, 159, 72, 125);
    this.labelValue(
      pdf,
      'Destinatario',
      guide.recipient!.name,
      340,
      175,
      72,
      125,
    );
    this.labelValue(
      pdf,
      guide.recipient!.documentType,
      guide.recipient!.documentNumber,
      340,
      191,
      72,
      125,
    );
    this.labelValue(
      pdf,
      'Doc. relacionado',
      guide.relatedDocumentType && guide.relatedDocumentNumber
        ? `${guide.relatedDocumentType} - ${guide.relatedDocumentNumber}`
        : 'No consignado',
      340,
      207,
      72,
      125,
    );
  }

  private transferDetails(pdf: PDFKit.PDFDocument, guide: PdfDespatchGuide) {
    const y = 244;
    pdf.roundedRect(40, y, 513, 84, 4).strokeColor(BORDER).stroke();
    this.labelValue(
      pdf,
      'Punto de partida',
      `[${guide.departureUbigeo}] ${guide.departureAddress}`,
      48,
      y + 10,
      90,
      402,
    );
    this.labelValue(
      pdf,
      'Punto de llegada',
      guide.arrivalUbigeo && guide.arrivalAddress
        ? `[${guide.arrivalUbigeo}] ${guide.arrivalAddress}`
        : 'No corresponde por traslado itinerante',
      48,
      y + 27,
      90,
      402,
    );
    if (guide.transportMode === 'PUBLIC') {
      this.labelValue(
        pdf,
        'Transportista',
        `${guide.carrier!.ruc} - ${guide.carrier!.legalName}${guide.carrier!.mtcRegistrationNumber ? ` - MTC ${guide.carrier!.mtcRegistrationNumber}` : ''}`,
        48,
        y + 44,
        90,
        402,
      );
      this.labelValue(
        pdf,
        'Fecha de entrega',
        this.date(guide.transferStartDate),
        48,
        y + 61,
        90,
        402,
      );
    } else {
      const vehicle =
        guide.vehicles.find((item) => item.primary) ?? guide.vehicles[0];
      const driver =
        guide.drivers.find((item) => item.primary) ?? guide.drivers[0];
      this.labelValue(pdf, 'Vehiculo', vehicle.plate, 48, y + 44, 90, 130);
      this.labelValue(
        pdf,
        'Conductor',
        `${driver.documentNumber} - ${driver.firstNames} ${driver.lastNames}`,
        278,
        y + 44,
        67,
        195,
      );
      this.labelValue(
        pdf,
        'Licencia',
        driver.licenseNumber,
        48,
        y + 61,
        90,
        130,
      );
    }
  }

  private tableHeader(pdf: PDFKit.PDFDocument, y: number) {
    pdf.rect(40, y, 513, 24).fillAndStroke(TABLE_HEADER, BORDER);
    pdf.fillColor(INK).font('Helvetica-Bold').fontSize(7.2);
    pdf.text('Item', 42, y + 8, { width: 28, align: 'center' });
    pdf.text('Cantidad', 70, y + 8, { width: 55, align: 'center' });
    pdf.text('Unidad', 125, y + 8, { width: 47, align: 'center' });
    pdf.text('Codigo', 172, y + 8, { width: 75, align: 'center' });
    pdf.text('Descripcion de los bienes', 247, y + 8, {
      width: 304,
      align: 'center',
    });
    return y + 24;
  }

  private footerBlock(
    pdf: PDFKit.PDFDocument,
    guide: PdfDespatchGuide,
    qr: Buffer,
    y: number,
  ) {
    pdf.roundedRect(40, y, 513, 96, 4).strokeColor(BORDER).stroke();
    pdf.image(qr, 458, y + 8, { width: 80, height: 80 });
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text('VALIDACION SUNAT:', 50, y + 13, { width: 110 });
    pdf
      .font('Helvetica')
      .text(`Estado: ${this.status(guide)}`, 50, y + 30, { width: 390 });
    pdf.text(`Codigo CDR: ${guide.sunatCode ?? '-'}`, 50, y + 45, {
      width: 390,
    });
    pdf.text(`Mensaje: ${guide.sunatMessage ?? '-'}`, 50, y + 60, {
      width: 390,
      height: 25,
      ellipsis: true,
    });

    const observations = guide.sunatObservations?.length
      ? guide.sunatObservations.join(' | ')
      : 'Sin observaciones.';
    pdf
      .roundedRect(40, y + 106, 513, 38, 4)
      .strokeColor(BORDER)
      .stroke();
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(7.2)
      .text('OBSERVACIONES:', 50, y + 114, { width: 95 });
    pdf.font('Helvetica').text(observations, 50, y + 127, {
      width: 490,
      height: 10,
      ellipsis: true,
    });
  }

  private continuationHeader(pdf: PDFKit.PDFDocument, guide: PdfDespatchGuide) {
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(
        `GUIA DE REMISION ELECTRONICA REMITENTE ${guide.series}-${guide.number}`,
        40,
        42,
        { width: 513, align: 'center' },
      );
  }

  private pageFooters(pdf: PDFKit.PDFDocument) {
    const range = pdf.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      pdf.switchToPage(page);
      pdf
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(6.5)
        .text(
          'Representacion impresa de la Guia de Remision Electronica - Remitente.',
          52,
          785,
          { width: 430, align: 'center', lineBreak: false },
        );
      pdf.text(`${page + 1}/${range.count}`, 500, 785, {
        width: 45,
        align: 'right',
        lineBreak: false,
      });
    }
  }

  private labelValue(
    pdf: PDFKit.PDFDocument,
    label: string,
    value: string,
    x: number,
    y: number,
    labelWidth: number,
    valueWidth: number,
  ) {
    pdf.fillColor(INK).font('Helvetica-Bold').fontSize(7.2).text(label, x, y, {
      width: labelWidth,
    });
    pdf.font('Helvetica').text(`: ${value}`, x + labelWidth, y, {
      width: valueWidth,
      height: 13,
      ellipsis: true,
    });
  }

  private status(guide: PdfDespatchGuide) {
    return guide.status === 'ACCEPTED_WITH_OBSERVATIONS'
      ? 'ACEPTADA CON OBSERVACIONES'
      : 'ACEPTADA';
  }

  private date(value: Date) {
    const [year, month, day] = value.toISOString().slice(0, 10).split('-');
    return `${day}/${month}/${year}`;
  }

  private info(guide: PdfDespatchGuide) {
    return {
      Title: `GRE Remitente ${guide.series}-${guide.number}`,
      Author: (guide.issuerSnapshot as unknown as PdfDespatchIssuer).legalName,
      Subject: 'Representacion impresa de la Guia de Remision Electronica',
      Creator: 'Nuvex Billing API',
    };
  }

  private collect(pdf: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
    });
  }
}
