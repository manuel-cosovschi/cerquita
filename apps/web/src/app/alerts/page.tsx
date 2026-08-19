import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AlertsScreen } from './AlertsScreen';

export const metadata: Metadata = {
  title: 'Alertas',
  robots: { index: false, follow: false },
};

export default function AlertsPage() {
  return (
    <Suspense>
      <AlertsScreen />
    </Suspense>
  );
}
