import { ExploreView } from '@/components/ExploreView';

/**
 * Home — map first (spec §9).
 *
 * The explore view is a client component because it owns live viewport state.
 * Public listing and store pages are server-rendered for SEO (spec §94); this
 * one is an interactive surface, not an indexable document.
 */
export default function HomePage() {
  return <ExploreView />;
}
