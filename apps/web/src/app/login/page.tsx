import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';

export const metadata: Metadata = {
  title: 'Entrar',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  // `useSearchParams` reads the `?next=` redirect, which forces this subtree to
  // render on the client; the boundary keeps the rest of the route static.
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
