import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { tokensCss } from '@/lib/tokens.css';

export const metadata: Metadata = {
  title: {
    default: 'Cerquita — comprá y vendé cerca tuyo',
    template: '%s · Cerquita',
  },
  description:
    'Encontrá, comprá, vendé y subastá cosas que están cerca tuyo. Un marketplace hiperlocal.',
  // Public pages are indexable; private surfaces opt out per route (spec §94).
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <head>
        {/*
          Design tokens are injected as CSS custom properties. Doing it here
          rather than in a static stylesheet means the token package stays the
          single source of truth for every visual value.
        */}
        <style dangerouslySetInnerHTML={{ __html: tokensCss }} />
      </head>
      <body>
        <a className="skip-link" href="#contenido">
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
