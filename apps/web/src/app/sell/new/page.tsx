import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PublishForm } from './PublishForm';

export const metadata: Metadata = {
  title: 'Publicar',
  robots: { index: false, follow: false },
};

export default function NewListingPage() {
  // The form reads `?kind=` to decide which questions to ask, which makes it a
  // client subtree; the boundary keeps the rest of the route static.
  return (
    <Suspense>
      <PublishForm />
    </Suspense>
  );
}
