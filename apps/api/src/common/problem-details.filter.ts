import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { RequestWithId } from './request-id.middleware';

type HttpExceptionBody = {
  error?: string;
  message?: string | string[];
};

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionBody = this.exceptionBody(exception);
    const messages = Array.isArray(exceptionBody.message)
      ? exceptionBody.message
      : exceptionBody.message
        ? [exceptionBody.message]
        : [];

    if (status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `${request.method} ${request.originalUrl} failed [${request.requestId}]`,
        stack,
      );
    }

    response
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title:
          status >= 500
            ? 'Internal Server Error'
            : exceptionBody.error || this.statusTitle(status),
        status,
        detail:
          status >= 500
            ? 'Ocurrió un error interno. Use requestId para solicitar soporte.'
            : messages[0],
        requestId: request.requestId,
        ...(messages.length > 1 ? { errors: messages } : {}),
      });
  }

  private exceptionBody(exception: unknown): HttpExceptionBody {
    if (!(exception instanceof HttpException)) return {};
    const body = exception.getResponse();
    return typeof body === 'string' ? { message: body } : body;
  }

  private statusTitle(status: number) {
    return HttpStatus[status] || 'Request Error';
  }
}
