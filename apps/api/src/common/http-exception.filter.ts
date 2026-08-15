import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { RowNotFoundError } from '../prisma/prisma.service';

/**
 * Turns every thrown error into a safe, actionable response body.
 *
 * Two rules (spec §84, §104):
 *  - the client never sees a stack trace, a SQL fragment or "500 Internal Server
 *    Error" as its only information;
 *  - the server logs the full detail, correlated by request id.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request & { id?: string }>();
    const requestId = request.id ?? 'unknown';

    const { status, body } = this.describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} [${requestId}] -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} [${requestId}] -> ${status}`);
    }

    response.status(status).json({ ...body, requestId });
  }

  private describe(exception: unknown): {
    status: number;
    body: Record<string, unknown>;
  } {
    // The throttler throws a plain HttpException whose message is the class
    // name. Left alone it reaches a user as "ThrottlerException: Too Many
    // Requests", which is a stack detail, not an instruction.
    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        body: {
          message: 'Demasiados intentos. Esperá un momento y probá de nuevo.',
          code: 'rate_limited',
        },
      };
    }

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      const body =
        typeof payload === 'string'
          ? { message: payload, code: 'error' }
          : (payload as Record<string, unknown>);
      return { status: exception.getStatus(), body };
    }

    if (exception instanceof RowNotFoundError) {
      return {
        status: HttpStatus.NOT_FOUND,
        body: { message: 'No encontramos lo que buscabas', code: 'not_found' },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.describePrisma(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        message: 'Algo salió mal de nuestro lado. Probá de nuevo en un momento.',
        code: 'internal_error',
      },
    };
  }

  private describePrisma(error: Prisma.PrismaClientKnownRequestError): {
    status: number;
    body: Record<string, unknown>;
  } {
    switch (error.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          body: { message: 'Ese valor ya está en uso', code: 'duplicate' },
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: { message: 'No encontramos lo que buscabas', code: 'not_found' },
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          body: { message: 'Referencia inválida', code: 'invalid_reference' },
        };
      case 'P2034':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            message: 'Hubo mucha actividad simultánea. Intentá de nuevo.',
            code: 'write_conflict',
          },
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: { message: 'Error al procesar la operación', code: 'database_error' },
        };
    }
  }
}
