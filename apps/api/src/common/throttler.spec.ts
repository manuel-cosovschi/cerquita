import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserAwareThrottlerGuard } from './throttler';

/**
 * Who a rate limit is charged to (spec §95).
 *
 * The choice of key is the whole design here, and both ways of getting it wrong
 * are silent. Too broad and a shared address — an office, a mobile carrier, a
 * building — locks out a neighbourhood because one person mistyped a password,
 * which in a hyperlocal marketplace is the normal case rather than the edge one.
 * Too trusting and the limit does not exist: a caller who can choose their own
 * key mints a fresh budget per request.
 *
 * Neither failure produces an error anybody sees. The first looks like the app
 * being down for some people; the second looks like nothing at all.
 */

/**
 * The guard without its dependencies.
 *
 * `getTracker` needs none of them — it reads the request and nothing else — and
 * building the real Nest graph to reach one function would test the container
 * rather than the decision.
 */
const guard = Object.create(UserAwareThrottlerGuard.prototype) as {
  getTracker(req: Record<string, unknown>): Promise<string>;
  shouldSkip(context: unknown): Promise<boolean>;
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    path: '/api/listings',
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
    headers: {},
    ...overrides,
  };
}

function context(path: string) {
  return { switchToHttp: () => ({ getRequest: () => ({ path }) }) };
}

describe('the rate limit key', () => {
  const original = process.env.TRUST_PROXY;

  beforeEach(() => {
    delete process.env.TRUST_PROXY;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = original;
  });

  it('follows the account once somebody is signed in', async () => {
    const key = await guard.getTracker(request({ user: { userId: 'u-1' } }));
    expect(key).toBe('user:u-1');
  });

  it('does not reset when the same person changes address', async () => {
    // Otherwise the budget is escapable by hopping wifi, which is a thing
    // phones do on their own.
    const home = await guard.getTracker(request({ user: { userId: 'u-1' }, ip: '10.0.0.1' }));
    const street = await guard.getTracker(request({ user: { userId: 'u-1' }, ip: '190.2.3.4' }));

    expect(home).toBe(street);
  });

  it('charges a login to the account being attempted, not to the whole building', async () => {
    const mine = await guard.getTracker(
      request({ path: '/api/auth/login', body: { email: 'Ana@Cerquita.dev' } }),
    );
    const neighbour = await guard.getTracker(
      request({ path: '/api/auth/login', body: { email: 'beto@cerquita.dev' } }),
    );

    expect(mine).not.toBe(neighbour);
    // Normalised, or `ANA@…` and `ana@…` are two budgets for one account.
    expect(mine).toBe('cred:ana@cerquita.dev:10.0.0.1');
  });

  it('still keeps a login bucket per address, so one attacker is not many', async () => {
    const here = await guard.getTracker(
      request({ path: '/api/auth/login', body: { email: 'ana@cerquita.dev' } }),
    );
    const elsewhere = await guard.getTracker(
      request({ path: '/api/auth/login', ip: '190.2.3.4', body: { email: 'ana@cerquita.dev' } }),
    );

    expect(here).not.toBe(elsewhere);
  });

  it('only reads the email on the credential routes', async () => {
    // An `email` field in any other body would otherwise let a caller pick
    // their own bucket for every write in the app.
    const key = await guard.getTracker(
      request({ path: '/api/listings', body: { email: 'whatever@example.com' } }),
    );

    expect(key).toBe('ip:10.0.0.1');
  });

  it('ignores x-forwarded-for when there is no proxy', async () => {
    /*
     * The bypass this prevents: with the header trusted unconditionally, a
     * caller sends a different value on every request and never meets a limit.
     */
    const key = await guard.getTracker(request({ headers: { 'x-forwarded-for': '203.0.113.9' } }));

    expect(key).toBe('ip:10.0.0.1');
  });

  it('reads it when the app is told it is behind one', async () => {
    process.env.TRUST_PROXY = 'true';

    const key = await guard.getTracker(
      request({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }),
    );

    // The first entry: the client, not the hops after it.
    expect(key).toBe('ip:203.0.113.9');
  });

  it('falls back to the socket when the trusted header is empty', async () => {
    process.env.TRUST_PROXY = 'true';

    const key = await guard.getTracker(request({ headers: { 'x-forwarded-for': '  ' } }));

    expect(key).toBe('ip:10.0.0.1');
  });

  it('lets the health checks through', async () => {
    // A balancer polls these far more often than anybody clicks, and throttling
    // them takes the service out of rotation for looking healthy too eagerly.
    expect(await guard.shouldSkip(context('/api/health'))).toBe(true);
    expect(await guard.shouldSkip(context('/api/ready'))).toBe(true);
    expect(await guard.shouldSkip(context('/api/listings'))).toBe(false);
  });
});
