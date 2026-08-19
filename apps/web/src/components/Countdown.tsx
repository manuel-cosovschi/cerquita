'use client';

import { useEffect, useState } from 'react';
import { countdown, formatCountdown } from '@cerquita/utils';

export interface CountdownProps {
  endsAt: string;
  compact?: boolean;
  onExpire?: () => void;
}

/**
 * Live countdown for auctions and offer expiries.
 *
 * Rendered client-side only after mount: the server and the browser would
 * otherwise disagree about "now" and React would report a hydration mismatch.
 * Until then it renders nothing, which is honest — the value genuinely is not
 * knowable server-side.
 *
 * The displayed time is never authoritative. The server decides when an auction
 * closes (spec §28); this is a hint for the user.
 */
export function Countdown({ endsAt, compact, onExpire }: CountdownProps) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const target = new Date(endsAt);
  const parts = now ? countdown(target, now) : null;

  useEffect(() => {
    if (parts?.expired) onExpire?.();
  }, [parts?.expired, onExpire]);

  if (!parts) {
    return <span className="numeric" suppressHydrationWarning aria-hidden="true" />;
  }

  if (parts.expired) {
    return <span className="numeric">Finalizada</span>;
  }

  const label = formatCountdown(parts);

  return (
    <time
      className="numeric"
      dateTime={endsAt}
      suppressHydrationWarning
      aria-label={`Termina en ${describeForScreenReader(parts)}`}
    >
      {compact ? label : `Termina en ${label}`}
    </time>
  );
}

/** "04:32" is meaningless read aloud; this spells it out. */
function describeForScreenReader(parts: ReturnType<typeof countdown>): string {
  const chunks: string[] = [];
  if (parts.days > 0) chunks.push(`${parts.days} día${parts.days === 1 ? '' : 's'}`);
  if (parts.hours > 0) chunks.push(`${parts.hours} hora${parts.hours === 1 ? '' : 's'}`);
  if (parts.days === 0 && parts.minutes > 0) {
    chunks.push(`${parts.minutes} minuto${parts.minutes === 1 ? '' : 's'}`);
  }
  if (chunks.length === 0) chunks.push(`${parts.seconds} segundos`);
  return chunks.join(' y ');
}
