'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '@cerquita/api-client';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from './Console.module.css';

const SECTIONS = [
  { href: '/', label: 'Resumen' },
  { href: '/reports', label: 'Denuncias', queue: 'openReports' as const },
  { href: '/disputes', label: 'Disputas', queue: 'openDisputes' as const },
  { href: '/audit', label: 'Auditoría' },
  { href: '/config', label: 'Configuración' },
];

/**
 * The console shell.
 *
 * Two things it does that the storefront does not:
 *
 * 1. It fails CLOSED. A non-admin who signs in here is told plainly that this
 *    account has no access, rather than shown an empty console. The API already
 *    refuses every route; this just makes the refusal legible.
 * 2. It shows queue depth in the sidebar, so a moderator can see where the work
 *    is without opening each list.
 */
export function Console({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { user, loading, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const [queue, setQueue] = useState<{ openReports: number; openDisputes: number } | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!user) return;

    api.admin
      .dashboard()
      .then((dashboard) => setQueue(dashboard.queue))
      .catch((cause) => {
        // 403 here means the account is real but not staff. That is the one
        // error worth showing rather than swallowing.
        if (cause instanceof ApiError && (cause.status === 403 || cause.status === 401)) {
          setDenied(true);
        }
      });
  }, [user]);

  if (loading) {
    return <p className={styles.state}>Cargando…</p>;
  }

  if (!user) {
    return <SignIn />;
  }

  if (denied) {
    return (
      <div className={styles.state}>
        <p>Esta cuenta no tiene acceso a la consola.</p>
        <button
          type="button"
          className={styles.signOut}
          onClick={async () => {
            await logout();
            router.refresh();
          }}
        >
          Salir
        </button>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div>
          <p className={styles.wordmark}>Cerquita</p>
          <p className={styles.role}>Consola · {user.username}</p>
        </div>

        <nav className={styles.nav} aria-label="Secciones">
          {SECTIONS.map((section) => {
            const active = pathname === section.href;
            const pending = section.queue && queue ? queue[section.queue] : 0;

            return (
              <Link
                key={section.href}
                href={section.href}
                className={`${styles.navItem} ${active ? styles.navActive : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {section.label}
                {pending > 0 && <span className={styles.count}>{pending}</span>}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          className={styles.signOut}
          onClick={async () => {
            await logout();
            router.refresh();
          }}
        >
          Cerrar sesión
        </button>
      </aside>

      <main className={styles.main}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        {children}
      </main>
    </div>
  );
}

/**
 * Sign-in.
 *
 * No registration link and no password reset: console accounts are granted, not
 * self-served.
 */
function SignIn() {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ maxWidth: 360, margin: '18vh auto', padding: '0 24px' }}>
      <h1 className={styles.title}>Consola</h1>
      <p className={styles.subtitle}>Acceso restringido.</p>

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await login(email.trim(), password);
          } catch (cause) {
            setError(cause instanceof ApiError ? cause.message : 'No pudimos entrar.');
            setBusy(false);
          }
        }}
        style={{ display: 'grid', gap: 12 }}
      >
        {error && (
          <p style={{ color: 'var(--color-danger)', fontSize: 14, margin: 0 }} role="alert">
            {error}
          </p>
        )}

        <label htmlFor="email" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          style={inputStyle}
        />

        <label htmlFor="password" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          style={inputStyle}
        />

        <button type="submit" disabled={busy} style={buttonStyle}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  minHeight: 44,
  padding: '0 14px',
  border: 'none',
  borderRadius: 10,
  background: 'var(--color-surface)',
  boxShadow: 'var(--ring-hairline)',
  fontSize: 15,
  color: 'var(--color-text-primary)',
};

const buttonStyle: React.CSSProperties = {
  minHeight: 44,
  marginTop: 8,
  border: 'none',
  borderRadius: 999,
  background: 'var(--color-brand)',
  color: 'var(--color-text-inverse)',
  fontWeight: 700,
  cursor: 'pointer',
};
