import { expect, test, type APIRequestContext } from '@playwright/test';
import { API, AS, PASSWORD, login } from './helpers';

/**
 * Banning ends a session now, not in fifteen minutes.
 *
 * The plan claimed this and the code delivered it, but nothing was watching.
 * That combination is the dangerous one: `resolveIdentity` hits the database on
 * every single authenticated request, which is exactly the kind of thing a
 * later performance pass caches — and a cached identity would keep a banned
 * account working for as long as its access token lives, silently, with every
 * existing test still green.
 *
 * The distinction being defended: revoking refresh tokens is not the same as
 * ending a session. A JWT that has already been issued keeps verifying until it
 * expires; only a check on each request can stop it.
 */

/** A fresh account, so nothing here bans somebody the other tests need. */
async function register(request: APIRequestContext): Promise<{
  id: string;
  email: string;
  refreshToken: string;
  headers: { Authorization: string };
}> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `e2e-${stamp}@cerquita.test`;

  const response = await request.post(`${API}/api/auth/register`, {
    data: {
      email,
      password: PASSWORD,
      username: `e2e${stamp}`.slice(0, 20),
      displayName: 'Cuenta de prueba',
    },
  });

  if (!response.ok()) {
    throw new Error(`Could not register: ${response.status()} ${await response.text()}`);
  }

  const tokens = (await response.json()) as { accessToken: string; refreshToken: string };
  const headers = { Authorization: `Bearer ${tokens.accessToken}` };

  // Registration hands back tokens, not a profile. The id comes from the token
  // the same way every client gets it.
  const me = await request.get(`${API}/api/auth/me`, { headers });
  const { userId } = (await me.json()) as { userId: string };

  return { id: userId, email, refreshToken: tokens.refreshToken, headers };
}

async function moderate(
  request: APIRequestContext,
  headers: Record<string, string>,
  body: Record<string, unknown>,
) {
  return request.post(`${API}/api/admin/moderate`, { headers, data: body });
}

test.describe('moderation', () => {
  test('a ban ends the session on the very next request', async ({ request }) => {
    const victim = await register(request);
    const admin = await login(request, AS.admin);

    // The token works before the ban, so the assertion after it means something.
    const before = await request.get(`${API}/api/auth/me`, { headers: victim.headers });
    expect(before.status()).toBe(200);

    const action = await moderate(request, admin.headers, {
      action: 'ban_user',
      targetId: victim.id,
      reason: 'Cuenta de prueba de la suite e2e.',
    });
    expect(action.ok()).toBe(true);

    // Same token, unexpired, one request later.
    const after = await request.get(`${API}/api/auth/me`, { headers: victim.headers });
    expect(after.status()).toBe(401);

    // And they cannot mint a fresh one: the refresh tokens went with it.
    const renewed = await request.post(`${API}/api/auth/refresh`, {
      data: { refreshToken: victim.refreshToken },
    });
    expect(renewed.ok()).toBe(false);

    // Nor sign in again from scratch.
    const back = await request.post(`${API}/api/auth/login`, {
      data: { email: victim.email, password: PASSWORD },
    });
    expect(back.ok()).toBe(false);
  });

  test('a suspension that has run out is not a suspension', async ({ request }) => {
    /*
     * `suspendedUntil` is a deadline, not a flag. Checking it for presence
     * rather than for being in the future would lock somebody out permanently
     * after a one-week suspension — and no test would notice for a week.
     */
    const victim = await register(request);
    const admin = await login(request, AS.admin);

    const expired = new Date(Date.now() - 60_000).toISOString();
    const action = await moderate(request, admin.headers, {
      action: 'suspend_user',
      targetId: victim.id,
      reason: 'Suspensión ya vencida, para probar el borde.',
      suspendUntil: expired,
    });
    expect(action.ok()).toBe(true);

    const me = await request.get(`${API}/api/auth/me`, { headers: victim.headers });
    expect(me.status()).toBe(200);
  });

  test('a suspension that is still running locks the account out', async ({ request }) => {
    const victim = await register(request);
    const admin = await login(request, AS.admin);

    const action = await moderate(request, admin.headers, {
      action: 'suspend_user',
      targetId: victim.id,
      reason: 'Suspensión vigente, para probar el otro borde.',
      suspendUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    expect(action.ok()).toBe(true);

    const me = await request.get(`${API}/api/auth/me`, { headers: victim.headers });
    expect(me.status()).toBe(401);
  });

  test('a normal account cannot moderate anybody', async ({ request }) => {
    const seller = await login(request, AS.seller);
    const stranger = await login(request, AS.stranger);

    const attempt = await moderate(request, seller.headers, {
      action: 'ban_user',
      targetId: (
        (await (await request.get(`${API}/api/auth/me`, { headers: stranger.headers })).json()) as {
          userId: string;
        }
      ).userId,
      reason: 'No debería poder.',
    });

    expect(attempt.status()).toBe(403);
  });

  test('moderating without a reason is refused', async ({ request }) => {
    /*
     * The reason is not paperwork: it is the only column in the audit log that
     * says *why*, and an action recorded without one is an action nobody can
     * review later. The schema requires it; this is what keeps that true through
     * a refactor of the DTO.
     */
    const admin = await login(request, AS.admin);
    const victim = await register(request);

    const attempt = await moderate(request, admin.headers, {
      action: 'warn_user',
      targetId: victim.id,
    });

    expect(attempt.status()).toBe(400);
  });

  test('every action lands in the audit log, with who and why', async ({ request }) => {
    const victim = await register(request);
    const admin = await login(request, AS.admin);
    const reason = `Registro de auditoría ${Date.now()}`;

    await moderate(request, admin.headers, {
      action: 'warn_user',
      targetId: victim.id,
      reason,
    });

    const log = await request.get(`${API}/api/admin/audit-log`, { headers: admin.headers });
    const entries = (await log.json()) as Array<{
      action: string;
      targetId: string;
      reason: string;
      admin: { username: string };
    }>;

    const entry = entries.find((item) => item.reason === reason);
    expect(entry, 'the action should be in the audit log').toBeTruthy();
    expect(entry?.action).toBe('warn_user');
    expect(entry?.targetId).toBe(victim.id);
    expect(entry?.admin.username).toBe('admin');
  });
});
