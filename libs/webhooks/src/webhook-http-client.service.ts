import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { request } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isPublicIp } from './webhook-url-policy.service';

@Injectable()
export class WebhookHttpClientService {
  post(
    url: URL,
    headers: Record<string, string>,
    body: string,
    timeoutMs: number,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const call = request(
        url,
        {
          method: 'POST',
          headers: {
            ...headers,
            'content-length': String(Buffer.byteLength(body)),
          },
          lookup: publicLookup,
        },
        (response) => {
          clearTimeout(timer);
          const status = response.statusCode ?? 0;
          response.destroy();
          resolve(status);
        },
      );
      const timer = setTimeout(
        () => call.destroy(new Error('El endpoint excedio el tiempo limite')),
        timeoutMs,
      );
      call.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      call.end(body);
    });
  }
}

const publicLookup: LookupFunction = (hostname, options, callback) => {
  const family = typeof options === 'number' ? options : options.family;
  lookup(
    hostname,
    { all: true, verbatim: true, family },
    (error, addresses) => {
      if (error) return callback(error, '', 4);
      if (
        !addresses.length ||
        addresses.some(({ address }) => !isPublicIp(address))
      ) {
        return callback(
          Object.assign(new Error('El destino del webhook no es publico'), {
            code: 'EACCES',
          }),
          '',
          4,
        );
      }
      if (typeof options !== 'number' && options.all) {
        const multipleAddressCallback = callback as unknown as (
          error: NodeJS.ErrnoException | null,
          result: LookupAddress[],
        ) => void;
        multipleAddressCallback(null, addresses);
        return;
      }
      const publicAddress = addresses[0];
      callback(null, publicAddress.address, publicAddress.family);
    },
  );
};
