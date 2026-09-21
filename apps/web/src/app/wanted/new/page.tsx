import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PublishForm } from '../../sell/new/PublishForm';

export const metadata: Metadata = {
  title: 'Publicar que busco',
  robots: { index: false, follow: false },
};

/**
 * "Busco" gets its own URL rather than `?kind=wanted`.
 *
 * It is linked from empty states across the app — "no encontramos nada por acá,
 * publicá que lo buscás" — and a shareable path reads better there than a query
 * string on the sell route.
 */
export default function NewWantedPage() {
  return (
    <Suspense>
      <PublishForm kind="wanted" />
    </Suspense>
  );
}
