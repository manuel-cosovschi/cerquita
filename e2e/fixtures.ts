import { test as base } from '@playwright/test';

/**
 * The suite's own `test`, which paces itself.
 *
 * The API allows twenty requests a second per account. That is a sensible
 * ceiling for a person and far below what this suite does when it runs flat
 * out: no single test here comes close, but several in a row on the same
 * account inside one second do.
 *
 * When that happens the 429 does not arrive as a clear failure. It arrives as a
 * response that is not the shape the test expected — `carts is not iterable`,
 * or a price tier that did not change because the write before it was refused —
 * and the test that reports it is rarely the one that caused it.
 *
 * Waiting is the honest fix. Raising the limit for tests would mean the suite
 * no longer runs against the guards it exists to prove, and the guards are
 * right: this is the suite being unlike a person, not the API being wrong.
 *
 * It lives in a fixture rather than in each spec's `beforeEach` because the
 * first attempt did the latter, paced the two files that had just broken, and
 * the next run broke two different ones. A rule that has to be remembered per
 * file is a rule that will be forgotten.
 */
export const test = base.extend<{ pace: void }>({
  pace: [
    // eslint-disable-next-line no-empty-pattern -- Playwright's fixture signature.
    async ({}, use, testInfo) => {
      // Only the API project. The browser projects are slow enough on their
      // own, and a second per test there would add a minute for nothing.
      if (testInfo.project.name === 'api') {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
