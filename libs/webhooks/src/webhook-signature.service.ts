import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class WebhookSignatureService {
  sign(secret: string, timestamp: number, body: string) {
    return `v1=${createHmac('sha256', secret)
      .update(`${timestamp}.${body}`, 'utf8')
      .digest('hex')}`;
  }

  verify(secret: string, timestamp: number, body: string, signature: string) {
    const actual = Buffer.from(this.sign(secret, timestamp, body));
    const expected = Buffer.from(signature);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
