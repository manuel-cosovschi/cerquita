import type { Metadata } from 'next';
import Link from 'next/link';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';

export const metadata: Metadata = {
  title: 'Perfil',
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <AppScreen title="Perfil" active="profile">
      <EmptyState
        title="Iniciá sesión"
        body="Con tu cuenta ves los precios de amigo, tus compras, ventas y publicaciones."
        actions={
          <>
            <Link href="/login" className={appScreenStyles.primary}>
              Entrar
            </Link>
            <Link href="/register" className={appScreenStyles.secondary}>
              Crear cuenta
            </Link>
          </>
        }
      />
    </AppScreen>
  );
}
