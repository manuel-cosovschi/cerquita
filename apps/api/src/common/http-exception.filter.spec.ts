import { BadRequestException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from './http-exception.filter';
import { RowNotFoundError } from '../prisma/prisma.service';

/**
 * Nothing the client sees comes from inside (spec §84, §104).
 *
 * The two halves of this are in tension, which is why it is worth pinning down:
 * the response has to say enough for somebody to act on it, and the *only*
 * information it may carry is information this filter chose to put there. A
 * database error whose message names a column, an unhandled `Error` whose text
 * quotes an internal path, a thrown string — each is a leak, and each arrives
 * through the same door.
 *
 * The detail is not thrown away, it moves: the server logs it, correlated by
 * request id, so the id in the user's hands is enough to find it.
 */

interface Captured {
  status: number;
  body: Record<string, unknown>;
}

/**
 * `null` means the request carries no id, which is not the same as omitting the
 * argument — a default of `'req-1'` would swallow an explicit `undefined` and
 * the "no id" case would silently test the "has an id" one.
 */
function run(exception: unknown, requestId: string | null = 'req-1'): Captured {
  const captured: Captured = { status: 0, body: {} };

  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'POST', url: '/api/things', id: requestId ?? undefined }),
    }),
  };

  new HttpExceptionFilter().catch(exception, host as never);
  return captured;
}

/** Everything an internal error could plausibly carry into the open. */
const SECRETS = [
  'SELECT',
  'prisma',
  'Prisma',
  '/home/',
  'node_modules',
  'at Object.',
  'Error:',
  'password',
  'ThrottlerException',
];

function leaks(body: Record<string, unknown>): string[] {
  const text = JSON.stringify(body);
  return SECRETS.filter((secret) => text.includes(secret));
}

describe('the error filter', () => {
  beforeEach(() => {
    // The filter logs, correctly, and a test run should not be a wall of red.
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('says nothing about an error it did not expect', () => {
    const { status, body } = run(
      new Error('connect ECONNREFUSED 10.0.0.4:5432 — password=hunter2'),
    );

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(leaks(body)).toEqual([]);
    expect(body.code).toBe('internal_error');
    // And still tells the person what to do, which is the other half of the
    // rule: a bare 500 is safe and useless.
    expect(String(body.message)).toMatch(/Probá de nuevo/);
  });

  it('says nothing about a thrown non-error either', () => {
    /*
     * `throw 'boom'` and `throw { sql: … }` both arrive here. The string is the
     * dangerous one: an implementation that falls back to `String(exception)`
     * publishes it verbatim, while the same fallback renders an object as the
     * harmless `[object Object]`. Testing only the object would report a filter
     * that leaks strings as clean.
     */
    for (const thrown of [
      'SELECT "passwordHash" FROM "User" — no such column',
      { sql: 'SELECT 1' },
    ]) {
      const { status, body } = run(thrown);

      expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(leaks(body)).toEqual([]);
      // Exactly the canned message: anything derived from the exception, in any
      // shape, is a leak waiting for the right input.
      expect(body.message).toBe('Algo salió mal de nuestro lado. Probá de nuevo en un momento.');
    }
  });

  it('turns a database error into a category, not a diagnosis', () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`email`)',
      { code: 'P2002', clientVersion: '6.0.0' },
    );

    const { status, body } = run(duplicate);

    expect(status).toBe(HttpStatus.CONFLICT);
    expect(leaks(body)).toEqual([]);
    // Not the column name: which field collided is the server's business, and
    // on a login form it answers "is this email registered?".
    expect(JSON.stringify(body)).not.toContain('email');
  });

  it('does not leak an unrecognised database code as a 200-shaped success', () => {
    const unknown = new Prisma.PrismaClientKnownRequestError('Raw query failed: SELECT 1', {
      code: 'P9999',
      clientVersion: '6.0.0',
    });

    const { status, body } = run(unknown);

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(leaks(body)).toEqual([]);
  });

  it('replaces the throttler class name with an instruction', () => {
    const { status, body } = run(new ThrottlerException());

    expect(status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(body.code).toBe('rate_limited');
    // "ThrottlerException: Too Many Requests" is a stack detail wearing a
    // message's clothes.
    expect(leaks(body)).toEqual([]);
    expect(String(body.message)).toMatch(/Esperá/);
  });

  it('passes a deliberate error through untouched', () => {
    // The ones the code raises on purpose already carry a message written for
    // whoever reads it; the filter must not flatten those into "algo salió mal".
    const { status, body } = run(
      new BadRequestException({
        message: 'Ese precio no puede ser negativo',
        code: 'invalid_price',
      }),
    );

    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.message).toBe('Ese precio no puede ser negativo');
    expect(body.code).toBe('invalid_price');
  });

  it('maps a missing row to 404 rather than 500', () => {
    const { status, body } = run(new RowNotFoundError('Listing', 'a3f1-secret-id'));

    expect(status).toBe(HttpStatus.NOT_FOUND);
    expect(body.code).toBe('not_found');
    // Neither the table nor the id it was looking for: the first names the
    // schema, the second confirms an id somebody was guessing at.
    expect(JSON.stringify(body)).not.toContain('Listing');
    expect(JSON.stringify(body)).not.toContain('a3f1-secret-id');
  });

  it('always hands back the request id, so the detail is findable', () => {
    expect(run(new Error('x')).body.requestId).toBe('req-1');
    // Even when the middleware never ran: a body with no id at all would leave
    // somebody reporting "it failed" with nothing to search the logs for.
    expect(run(new Error('x'), null).body.requestId).toBe('unknown');
  });

  it('logs the stack it refused to send', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const thrown = new Error('the real reason');

    run(thrown);

    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[1])).toContain('the real reason');
    // Correlated, or the log is a haystack.
    expect(String(error.mock.calls[0]?.[0])).toContain('req-1');
  });
});
