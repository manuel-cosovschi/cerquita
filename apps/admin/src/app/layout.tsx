import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { tokensCss } from '@/lib/tokens.css';
import { SessionProvider } from '@/lib/session';

export const metadata: Metadata = {
  title: {
    default: 'Consola · Cerquita',
    template: '%s · Consola',
  },
  // Nothing in here is ever indexable, at any depth.
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <head>
        <style dangerouslySetInnerHTML={{ __html: tokensCss }} />
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
