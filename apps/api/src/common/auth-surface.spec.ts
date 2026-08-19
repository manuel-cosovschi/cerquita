import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A tripwire on the public surface.
 *
 * The guard is global and fails closed: every route needs a token unless it
 * carries `@Public()` or `@OptionalAuth()`. That design makes forgetting a
 * decorator harmless — the route is simply private — and makes *adding* one the
 * only way to go wrong. Adding one is a single line, easy to write while
 * chasing a 401 in the browser, and invisible in a diff full of other changes.
 *
 * So the set is written down. A new opt-out fails this test, which turns it from
 * something that slips through into something somebody has to justify by editing
 * this list. That is the whole intent: not to forbid public routes, but to stop
 * one from becoming public by accident.
 *
 * Read from the source rather than from Nest's metadata on purpose — this has to
 * hold at review time, before anything is wired up or started.
 */

const MODULES = join(__dirname, '..', 'modules');

/** Routes reachable with no token at all. */
const PUBLIC = [
  'auth POST register',
  'auth POST login',
  'auth POST refresh',
  'auth POST logout',
  'categories GET (índice)',
  'demand GET (índice)',
  '(raíz) GET health',
  '(raíz) GET ready',
];

/**
 * Routes that serve anonymous callers and attach the viewer when there is one.
 *
 * All reads. A write in this list would be a route anybody on the internet can
 * call, which is a different thing entirely from a page a guest can browse.
 */
const OPTIONAL = [
  '(raíz) GET listings/:id/comments',
  'feed GET (índice)',
  'listings GET :id',
  'map GET listings',
  'search POST (índice)',
  'search POST ai',
  'search POST people',
  'search POST social-hint',
  'search POST stores',
  'stores GET :handle',
  'stores GET :id',
  'users GET :username',
  'users GET :username/listings',
  'users GET :username/reviews',
];

interface OptOut {
  readonly kind: 'public' | 'optional';
  readonly route: string;
}

/** Every `@Public()` / `@OptionalAuth()` in the API, with the route it guards. */
function optOuts(): OptOut[] {
  const found: OptOut[] = [];

  for (const file of controllers(MODULES)) {
    const source = readFileSync(file, 'utf8');
    const prefix = /@Controller\(['"]([^'"]*)['"]\)/.exec(source)?.[1] ?? '';
    const lines = source.split('\n');

    lines.forEach((line, index) => {
      const decorator = /@(Public|OptionalAuth)\(\)/.exec(line);
      if (!decorator) return;

      // The HTTP verb is on one of the next few lines: other decorators
      // (@Throttle, @HttpCode, @Roles) can sit between them.
      for (const next of lines.slice(index + 1, index + 6)) {
        const method = /@(Get|Post|Patch|Put|Delete)\(\s*['"]?([^'")]*)['"]?\s*\)/.exec(next);
        if (!method) continue;

        found.push({
          kind: decorator[1] === 'Public' ? 'public' : 'optional',
          // `(raíz)` and `(índice)` rather than an empty string, so a failure
          // does not print a route with a hole in it.
          route: `${prefix || '(raíz)'} ${method[1]!.toUpperCase()} ${method[2] || '(índice)'}`,
        });
        return;
      }

      throw new Error(`${file}:${index + 1} — an opt-out with no route under it`);
    });
  }

  return found;
}

function controllers(directory: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...controllers(path));
    else if (entry.name.endsWith('.controller.ts')) out.push(path);
  }

  return out;
}

describe('the routes that do not require a token', () => {
  const all = optOuts();

  it('are exactly the ones written down here', () => {
    const seen = (kind: OptOut['kind']) =>
      all
        .filter((entry) => entry.kind === kind)
        .map((entry) => entry.route)
        .sort();

    // Named separately so a failure says which kind of opening was added: a
    // route anybody can call, or a route that merely tolerates a guest.
    expect(seen('public'), 'routes reachable with no token').toEqual([...PUBLIC].sort());
    expect(seen('optional'), 'routes that also serve guests').toEqual([...OPTIONAL].sort());
  });

  it('never let an anonymous caller write', () => {
    /*
     * `@OptionalAuth` on a POST is not automatically wrong — search is a POST
     * because its filters do not fit in a query string — but it is always worth
     * a second look, so the exceptions are named one by one.
     */
    const READ_ONLY_POSTS = OPTIONAL.filter((route) => route.startsWith('search POST '));

    const writes = all
      .filter((entry) => entry.kind === 'optional')
      .map((entry) => entry.route)
      .filter((route) => !route.includes(' GET ') && !READ_ONLY_POSTS.includes(route));

    expect(writes, 'an anonymous caller should not be able to change anything').toEqual([]);
  });

  it('found the decorators at all', () => {
    // Guards the parser itself: a regex that matched nothing would make both
    // assertions above compare two empty lists and pass forever.
    expect(all.length).toBeGreaterThan(15);
  });
});
