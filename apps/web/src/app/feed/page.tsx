import type { Metadata } from 'next';
import Link from 'next/link';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';

export const metadata: Metadata = {
  title: 'Feed',
  // The feed is personal, so it must not be indexed (spec §94).
  robots: { index: false, follow: false },
};

/**
 * Feed — direction 1c's home, demoted to a tab in the synthesis.
 *
 * It exists so someone after a specific thing has a way in that does not
 * require exploring the map first, which is the risk the board flags for 1a.
 *
 * Rendered signed-out for now: the feed endpoint is per-user and the web app has
 * no session yet, so rather than fake entries this states plainly what it needs.
 * Faking a populated feed would hide exactly the cold-start problem the board
 * warns about for 1c.
 */
export default function FeedPage() {
  return (
    <AppScreen
      title="Feed"
      subtitle="Lo que publican quienes seguís y tus amigos"
      active="feed"
    >
      <EmptyState
        title="Todavía no hay nada acá"
        body="El feed se llena con lo que publican las personas y tiendas que seguís. Empezá por el mapa y seguí a quien te interese."
        actions={
          <>
            <Link href="/" className={appScreenStyles.primary}>
              Ver el mapa
            </Link>
            <Link href="/search" className={appScreenStyles.secondary}>
              Buscar personas
            </Link>
          </>
        }
      />
    </AppScreen>
  );
}
