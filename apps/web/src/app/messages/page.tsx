import type { Metadata } from 'next';
import Link from 'next/link';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';

export const metadata: Metadata = {
  title: 'Chats',
  // Conversations must never be indexed (spec §94).
  robots: { index: false, follow: false },
};

export default function MessagesPage() {
  return (
    <AppScreen title="Chats" subtitle="Tus conversaciones" active="chats">
      <EmptyState
        title="No tenés conversaciones"
        body="Cuando preguntes por algo o te escriban, la conversación aparece acá."
        actions={
          <Link href="/" className={appScreenStyles.primary}>
            Buscar algo cerca
          </Link>
        }
      />
    </AppScreen>
  );
}
