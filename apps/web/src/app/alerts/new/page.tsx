import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AlertsScreen } from '../AlertsScreen';

export const metadata: Metadata = {
  title: 'Nueva alerta',
  robots: { index: false, follow: false },
};

/**
 * The same screen as /alerts.
 *
 * Empty states across the app link here with "creá una alerta", and landing on
 * a form that hides the alerts you already have is how duplicates happen. The
 * separate path exists because it reads better in those links; `?q=` carries
 * the query that found nothing.
 */
export default function NewAlertPage() {
  return (
    <Suspense>
      <AlertsScreen />
    </Suspense>
  );
}
