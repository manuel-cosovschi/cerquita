import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SearchView } from '@/components/SearchView';

export const metadata: Metadata = {
  title: 'Buscar',
  robots: { index: false, follow: true },
};

export default function SearchPage() {
  // The view reads `?q=` to run a search on arrival, which makes it a client
  // subtree; the boundary keeps the rest of the route static.
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  );
}
