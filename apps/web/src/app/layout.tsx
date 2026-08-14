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
          The two faces the exported design uses: Bricolage Grotesque for the
          wordmark and prices, Archivo for everything else. Preconnect first so
          the fonts are not a render-blocking round trip. If they fail to load,
          the token stacks fall back to system faces rather than breaking layout.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Archivo:wght@400;500;600;700;800&display=swap"
        />
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
