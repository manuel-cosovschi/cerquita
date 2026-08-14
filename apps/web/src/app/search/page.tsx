import type { Metadata } from 'next';
import { SearchView } from '@/components/SearchView';

export const metadata: Metadata = {
  title: 'Buscar',
  robots: { index: false, follow: true },
};

export default function SearchPage() {
  return <SearchView />;
}
