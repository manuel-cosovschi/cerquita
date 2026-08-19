'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, type SavedSearch } from '@cerquita/api-client';
import { formatMoney, fromMajorUnits, money } from '@cerquita/utils';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from './page.module.css';

type Kind = 'sale' | 'auction' | 'wanted';

const KINDS: ReadonlyArray<{ id: Kind; label: string }> = [
  { id: 'sale', label: 'En venta' },
  { id: 'auction', label: 'Subastas' },
  { id: 'wanted', label: 'Busco' },
];

const CURRENCY = 'ARS';

/** Where the feed stored the viewer's position; reused rather than asked again. */
const POSITION_KEY = 'cerquita.position';

/**
 * Alerts (spec §32).
 *
 * A saved search that notifies. The list comes before the form because an alert
 * you cannot see is an alert you cannot turn off, and a screen that only
 * creates them is how people end up with six copies of the same one.
 *
 * `?q=` pre-fills the text, so "no encontramos nada por acá — creá una alerta"
 * from an empty search arrives with the query already typed in.
 */
export function AlertsScreen() {
  const { user, loading } = useSession();
  const params = useSearchParams();

  const [alerts, setAlerts] = useState<SavedSearch[] | null>(null);
  const [name, setName] = useState('');
  const [text, setText] = useState(params.get('q') ?? '');
  const [kinds, setKinds] = useState<Kind[]>(['sale']);
  const [maxPrice, setMaxPrice] = useState('');
  const [radiusKm, setRadiusKm] = useState('5');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAlerts(await api.alerts.list());
    } catch {
      setAlerts([]);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [load, user]);

  if (loading) {
    return (
      <AppScreen title="Alertas" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (!user) {
    return (
      <AppScreen title="Alertas" active="profile">
        <EmptyState
          title="Iniciá sesión"
          body="Te avisamos cuando alguien publique lo que estás buscando cerca tuyo."
          actions={
            <Link href="/login?next=%2Falerts" className={appScreenStyles.primary}>
              Entrar
            </Link>
          }
        />
      </AppScreen>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      await api.alerts.create({
        // The name is what the list shows; falling back to the query keeps the
        // form to two required fields instead of three.
        name: name.trim() || text.trim() || 'Alerta',
        text: text.trim() || undefined,
        kinds: kinds.length > 0 ? kinds : undefined,
        maxPrice: maxPrice.trim()
          ? fromMajorUnits(maxPrice.replace(',', '.'), CURRENCY)
          : undefined,
        center: storedPosition() ?? undefined,
        radiusMeters: Math.round((Number(radiusKm) || 5) * 1000),
        notify: true,
      });

      setName('');
      setText('');
      setMaxPrice('');
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos crear la alerta.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen
      title="Alertas"
      subtitle="Te avisamos cuando aparezca lo que buscás"
      active="profile"
    >
      {alerts === null ? (
        <p className={styles.state}>Cargando…</p>
      ) : alerts.length === 0 ? (
        <p className={styles.state}>Todavía no tenés alertas.</p>
      ) : (
        <ul className={styles.list}>
          {alerts.map((alert) => (
            <li key={alert.id} className={styles.row}>
              <div className={styles.rowBody}>
                <p className={styles.name}>{alert.name}</p>
                <p className={styles.criteria}>{describe(alert)}</p>
                {!alert.notify && <p className={styles.muted}>Sin avisos</p>}
              </div>
              <button
                type="button"
                className={styles.remove}
                onClick={async () => {
                  await api.alerts.remove(alert.id).catch(() => undefined);
                  await load();
                }}
              >
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className={styles.form} onSubmit={submit}>
        <h2 className={styles.formTitle}>Nueva alerta</h2>

        {error && <p className={styles.error}>{error}</p>}

        <div>
          <label className={styles.label} htmlFor="text">
            Qué estás buscando
          </label>
          <input
            id="text"
            className={styles.input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Bicicleta rodado 29"
            required
          />
        </div>

        <div>
          <label className={styles.label} htmlFor="name">
            Nombre de la alerta (opcional)
          </label>
          <input
            id="name"
            className={styles.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={text || 'Bici para Tomi'}
          />
        </div>

        <div>
          <span className={styles.label}>Qué tipo de publicación</span>
          <div className={styles.chips}>
            {KINDS.map((entry) => {
              const active = kinds.includes(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                  aria-pressed={active}
                  onClick={() =>
                    setKinds((current) =>
                      active ? current.filter((id) => id !== entry.id) : [...current, entry.id],
                    )
                  }
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.pair}>
          <div>
            <label className={styles.label} htmlFor="maxPrice">
              Hasta cuánto
            </label>
            <input
              id="maxPrice"
              className={styles.input}
              inputMode="decimal"
              value={maxPrice}
              onChange={(event) => setMaxPrice(event.target.value)}
              placeholder="Sin límite"
            />
          </div>

          <div>
            <label className={styles.label} htmlFor="radius">
              A qué distancia
            </label>
            <select
              id="radius"
              className={styles.select}
              value={radiusKm}
              onChange={(event) => setRadiusKm(event.target.value)}
            >
              <option value="1">1 km</option>
              <option value="5">5 km</option>
              <option value="10">10 km</option>
              <option value="25">25 km</option>
            </select>
          </div>
        </div>

        <button className={styles.submit} type="submit" disabled={busy || !text.trim()}>
          {busy ? 'Creando…' : 'Crear alerta'}
        </button>

        <p className={styles.hint}>
          Usamos la última ubicación que compartiste. Si no compartiste ninguna, la alerta busca en
          todos lados.
        </p>
      </form>
    </AppScreen>
  );
}

/** Reuses the position the feed already asked for, rather than prompting again. */
function storedPosition(): { lat: number; lng: number } | null {
  try {
    const stored = window.localStorage.getItem(POSITION_KEY);
    return stored ? (JSON.parse(stored) as { lat: number; lng: number }) : null;
  } catch {
    return null;
  }
}

function describe(alert: SavedSearch): string {
  const parts: string[] = [];
  if (alert.text) parts.push(`"${alert.text}"`);
  if (alert.maxPrice) parts.push(`hasta ${formatMoney(money(alert.maxPrice, 'ARS'))}`);
  if (alert.radiusMeters) parts.push(`a ${Math.round(alert.radiusMeters / 1000)} km`);
  return parts.length > 0 ? parts.join(' · ') : 'Cualquier publicación nueva';
}
