import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export type RequestWithId = Request & { requestId: string };

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,100}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction) {
    const incoming = request.header('x-request-id');
    const requestId =
      incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

    (request as RequestWithId).requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
  }
}
