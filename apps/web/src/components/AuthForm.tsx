'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '@cerquita/api-client';
import { useSession } from '@/lib/session';
import styles from './AuthForm.module.css';

/**
 * Login and registration.
 *
 * One component for both because they differ by three fields and a verb, and
 * splitting them would mean maintaining the same error handling, redirect
 * behaviour and submit state twice.
 *
 * The redirect target comes from `?next=`, so hitting a signed-in-only surface
 * and logging in returns you to it instead of dumping you on the map.
 */
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { login, register, user } = useSession();
  const router = useRouter();
  const params = useSearchParams();

  const next = safeNext(params.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Someone who is already signed in has no business on this screen — including
  // the case where the session restored itself a moment after the page loaded.
  useEffect(() => {
    if (user) router.replace(next);
  }, [user, next, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setError(null);
    setSubmitting(true);

    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register({
          email: email.trim(),
          password,
          username: username.trim().toLowerCase(),
          displayName: displayName.trim(),
        });
      }
      router.replace(next);
    } catch (cause) {
      // The API writes its messages in Spanish and for humans, so they are shown
      // as-is; anything else gets a generic line rather than a stack trace.
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'No pudimos conectar con el servidor. Probá de nuevo.',
      );
      setSubmitting(false);
    }
  }

  const isRegister = mode === 'register';

  return (
    <div className={styles.screen}>
      <Link href="/" className={styles.back}>
        ← Volver al mapa
      </Link>

      <h1 className={styles.wordmark}>Cerquita</h1>
      <p className={styles.promise}>
        {isRegister
          ? 'Creá tu cuenta para publicar, ofertar y ver los precios de amigo.'
          : 'Entrá para ver precios de amigo, tus compras y tus publicaciones.'}
      </p>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {isRegister && (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="displayName">
                Tu nombre
              </label>
              <input
                id="displayName"
                className={styles.input}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="username">
                Usuario
              </label>
              <input
                id="username"
                className={styles.input}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                inputMode="text"
                required
              />
              <span className={styles.hint}>
                Así te encuentran tus amigos: cerquita.app/@usuario
              </span>
            </div>
          </>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className={styles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            required
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required
          />
          {isRegister && <span className={styles.hint}>Al menos 10 caracteres.</span>}
        </div>

        <button className={styles.submit} type="submit" disabled={submitting}>
          {submitting ? 'Un segundo…' : isRegister ? 'Crear cuenta' : 'Entrar'}
        </button>
      </form>

      <p className={styles.alt}>
        {isRegister ? (
          <>
            ¿Ya tenés cuenta?{' '}
            <Link className={styles.altLink} href={withNext('/login', next)}>
              Entrá
            </Link>
          </>
        ) : (
          <>
            ¿Todavía no tenés cuenta?{' '}
            <Link className={styles.altLink} href={withNext('/register', next)}>
              Creála
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Only same-origin, absolute-path redirects are honoured.
 *
 * `?next=https://evil.example` on a login link is the classic open-redirect: the
 * user signs in on the real site and is handed to somebody else's page still
 * trusting it. Anything that is not a plain `/path` goes to the map instead.
 */
function safeNext(value: string | null): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function withNext(path: string, next: string): string {
  return next === '/' ? path : `${path}?next=${encodeURIComponent(next)}`;
}
