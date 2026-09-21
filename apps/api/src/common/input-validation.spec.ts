import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every request body goes through a schema.
 *
 * A `@Body()` with no pipe is not a validation bug that shows up as a 400 — it
 * shows up as whatever the handler does with a field it assumed was a number,
 * two layers down, usually as a 500 and occasionally as a write. The schemas are
 * shared with the clients, so writing one is the cheap part; remembering to
 * attach it is the part a tripwire can do.
 *
 * Query strings are deliberately not covered here. They arrive as text and are
 * parsed at the service boundary — `limit` and `radius` are clamped there, and
 * a missing coordinate is rejected outright — because a schema that ran earlier
 * would still have to hand the same clamped value to the same query.
 */

const MODULES = join(__dirname, '..', 'modules');

describe('request bodies', () => {
  const bodies = allBodies();

  it('all go through a Zod schema', () => {
    const unvalidated = bodies.filter((entry) => !entry.text.includes('zodBody('));

    expect(
      unvalidated.map((entry) => entry.where),
      'a @Body() with no schema reaches the handler as whatever was sent',
    ).toEqual([]);
  });

  it('were actually found', () => {
    // Without this, a controller layout the regex stopped matching would make
    // the assertion above compare two empty lists forever.
    expect(bodies.length).toBeGreaterThan(30);
  });
});

function allBodies(): Array<{ where: string; text: string }> {
  const found: Array<{ where: string; text: string }> = [];

  for (const file of controllers(MODULES)) {
    const lines = readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, index) => {
      if (!line.includes('@Body(')) return;

      // The pipe can sit on the same line or wrap onto the next one or two.
      found.push({
        where: `${file.slice(file.indexOf('modules'))}:${index + 1}`,
        text: lines.slice(index, index + 3).join(' '),
      });
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
