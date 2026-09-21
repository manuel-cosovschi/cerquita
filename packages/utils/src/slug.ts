/** Handle/slug normalisation for store handles, usernames and SEO URLs. */

/**
 * Lowercase, accent-stripped, hyphen-joined. Spanish text is the primary input,
 * so `ñ` is preserved as `n` rather than dropped, and `Casaca de Cancha` becomes
 * `casaca-de-cancha`.
 */
export function slugify(input: string, maxLength = 60): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9_.]{1,28}[a-z0-9])$/;

/** Usernames are 3-30 chars, lowercase, and cannot start or end with punctuation. */
export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value) && !value.includes('..');
}

const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** Store handles appear in public URLs (`/store/casaca-de-cancha`). */
export function isValidStoreHandle(value: string): boolean {
  return HANDLE_PATTERN.test(value) && !value.includes('--');
}

/** Appends a numeric suffix until the candidate is free. */
export function uniqueSlug(base: string, isTaken: (candidate: string) => boolean): string {
  const root = slugify(base) || 'item';
  if (!isTaken(root)) return root;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${root}-${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}
