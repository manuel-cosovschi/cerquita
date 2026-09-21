import { formatRelativeTime as format } from '@cerquita/utils';

/**
 * Relative time for UI rows, from an ISO string.
 *
 * The shared helper deliberately takes `now` as an argument so domain logic can
 * never read the machine clock implicitly. Presentation is the one place where
 * reading it is the correct thing to do, so the wrapper lives here rather than
 * loosening the helper.
 *
 * Only call this from client components: rendering "hace 2 min" on the server
 * and again in the browser produces two different strings and a hydration
 * mismatch.
 */
export function formatRelativeTime(iso: string): string {
  return format(new Date(iso), new Date());
}

/** Clock time for message bubbles: `14:32`. */
export function formatClockTime(iso: string, locale = 'es-AR'): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** Day separator inside a thread: "Hoy", "Ayer", or a dated label. */
export function formatDayLabel(iso: string, locale = 'es-AR'): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) return 'Hoy';
  if (isSameDay(date, yesterday)) return 'Ayer';

  return date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    // The year only earns its place once it is no longer the current one.
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
