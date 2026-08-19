import { expect, test, type APIRequestContext } from '@playwright/test';
import { API, AS, login, type Session } from './helpers';

/**
 * Turning a notification off actually turns it off.
 *
 * A preference switch is a promise, and it is the kind that fails silently in
 * both directions: if it stopped suppressing, nobody complains to the codebase —
 * they just get annoyed; if it started suppressing everything, nobody notices
 * either, because a notification that never arrives looks exactly like nothing
 * having happened.
 *
 * `new_follower` is the type used here because it is the one this suite can
 * cause and undo cleanly: following is unilateral, so the whole thing rewinds
 * with one delete.
 */

const TYPE = 'new_follower';

async function userId(request: APIRequestContext, session: Session): Promise<string> {
  const me = await request.get(`${API}/api/auth/me`, { headers: session.headers });
  return ((await me.json()) as { userId: string }).userId;
}

async function setPreference(
  request: APIRequestContext,
  session: Session,
  inApp: boolean,
): Promise<void> {
  const response = await request.post(`${API}/api/notifications/preferences`, {
    headers: session.headers,
    data: { type: TYPE, inApp, push: false },
  });
  expect(response.ok(), 'the preference should be saved').toBe(true);
}

/** How many `new_follower` notices the recipient is holding right now. */
async function count(request: APIRequestContext, session: Session): Promise<number> {
  const response = await request.get(`${API}/api/notifications`, { headers: session.headers });
  const { items } = (await response.json()) as { items: Array<{ type: string }> };
  return items.filter((item) => item.type === TYPE).length;
}

/** Unfollow, then follow: makes the event happen whatever the starting state. */
async function refollow(
  request: APIRequestContext,
  follower: Session,
  targetId: string,
): Promise<void> {
  await request.delete(`${API}/api/users/${targetId}/follow`, { headers: follower.headers });
  const response = await request.post(`${API}/api/users/${targetId}/follow`, {
    headers: follower.headers,
    data: {},
  });
  expect(response.ok(), 'the follow should go through').toBe(true);
}

test.describe('notification preferences', () => {
  test('a type switched off produces nothing, and switched on produces one', async ({
    request,
  }) => {
    const recipient = await login(request, AS.seller);
    const follower = await login(request, AS.stranger);
    const recipientId = await userId(request, recipient);

    try {
      // Off.
      await setPreference(request, recipient, false);
      const quiet = await count(request, recipient);

      await refollow(request, follower, recipientId);
      expect(await count(request, recipient), 'nothing should arrive while off').toBe(quiet);

      /*
       * On, and then the same event again.
       *
       * Both halves are needed. Asserting only the silence would pass against a
       * notification system that had stopped working altogether, and asserting
       * only the arrival would pass against a preference that is never read.
       */
      await setPreference(request, recipient, true);
      await refollow(request, follower, recipientId);
      expect(await count(request, recipient), 'exactly one should arrive while on').toBe(quiet + 1);
    } finally {
      await request.delete(`${API}/api/users/${recipientId}/follow`, {
        headers: follower.headers,
      });
      // Back to the default, which is on: the next run starts from the same
      // place this one did.
      await setPreference(request, recipient, true);
    }
  });

  test('one person switching a type off does not silence it for everybody', async ({ request }) => {
    /*
     * The preference is keyed by `(userId, type)`. A lookup that dropped the
     * user — or an over-eager cache — would read one person's choice as
     * everybody's, and the only symptom would be other people's notifications
     * quietly disappearing.
     */
    const quiet = await login(request, AS.seller);
    const loud = await login(request, AS.friend);
    const follower = await login(request, AS.stranger);

    const quietId = await userId(request, quiet);
    const loudId = await userId(request, loud);

    try {
      await setPreference(request, quiet, false);

      const before = await count(request, loud);
      await refollow(request, follower, loudId);

      expect(await count(request, loud), "somebody else's switch is not mine").toBe(before + 1);
    } finally {
      await request.delete(`${API}/api/users/${loudId}/follow`, { headers: follower.headers });
      await request.delete(`${API}/api/users/${quietId}/follow`, { headers: follower.headers });
      await setPreference(request, quiet, true);
    }
  });
});
