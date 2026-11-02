import { Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import {
  PdfDespatchGuide,
  PdfDespatchIssuer,
} from './despatch-guide-pdf.types';

@Injectable()
export class DespatchGuideQrService {
  payload(guide: PdfDespatchGuide) {
    const issuer = guide.issuerSnapshot as unknown as PdfDespatchIssuer;
    return [
      issuer.ruc,
      '09',
      guide.series,
      String(guide.number),
      guide.issueDate.toISOString().slice(0, 10),
      guide.sunatHash ?? '',
    ].join('|');
  }

  png(guide: PdfDespatchGuide) {
    return QRCode.toBuffer(this.payload(guide), {
      type: 'png',
      errorCorrectionLevel: 'Q',
      margin: 1,
      width: 500,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  }
}
