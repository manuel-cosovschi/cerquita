import type { Metadata } from 'next';
import Link from 'next/link';
import { AppScreen, appScreenStyles } from '@/components/AppScreen';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Publicar',
  robots: { index: false, follow: false },
};

/**
 * The publish chooser (spec §58).
 *
 * Three kinds, not one form with a type dropdown: what you are doing changes
 * every field that follows, so the choice comes first.
 */
const OPTIONS = [
  {
    href: '/sell/new?kind=sale',
    title: 'Vender algo',
    body: 'Publicás un objeto con precio. Podés aceptar ofertas y fijar precios para amigos.',
    tone: 'sale' as const,
  },
  {
    href: '/wanted/new',
    title: 'Estoy buscando',
    body: 'Publicás lo que necesitás y un presupuesto. Quien lo tenga te avisa.',
    tone: 'wanted' as const,
  },
  {
    href: '/sell/new?kind=auction',
    title: 'Crear subasta',
    body: 'Arranca en un precio y sube con las pujas. Vos ponés cuándo termina.',
    tone: 'auction' as const,
  },
];

export default function SellPage() {
  return (
    <AppScreen title="Publicar" subtitle="¿Qué querés hacer?" active="map">
      <ul className={styles.list}>
        {OPTIONS.map((option) => (
          <li key={option.href}>
            <Link href={option.href} className={`${styles.card} ${styles[option.tone]}`}>
              <span className={styles.cardTitle}>{option.title}</span>
              <span className={styles.cardBody}>{option.body}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className={styles.note}>
        <Link href="/" className={appScreenStyles.secondary}>
          Volver al mapa
        </Link>
      </p>
    </AppScreen>
  );
}
