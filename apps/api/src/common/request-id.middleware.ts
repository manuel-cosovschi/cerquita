import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Attaches a request id to every request and echoes it back.
 *
 * An id supplied by the client is honoured only when it looks like one, so a
 * caller cannot inject arbitrary text into the logs through this header.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request & { id?: string }, response: Response, next: NextFunction): void {
    const incoming = request.header('x-request-id');
    const id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();

    request.id = id;
    response.setHeader('x-request-id', id);
    next();
  }
}
