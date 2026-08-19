'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Promotion, StoreSummary, UserProfile } from '@cerquita/types';
import { ApiError, type StoreDashboard } from '@cerquita/api-client';
import { formatMoney, fromMajorUnits, money } from '@cerquita/utils';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from './page.module.css';

type PromotionKind = 'percentage' | 'fixed_price' | 'coupon' | 'flash_sale';

const KINDS: ReadonlyArray<{ id: PromotionKind; label: string; needs: 'bps' | 'price' }> = [
  { id: 'percentage', label: 'Porcentaje', needs: 'bps' },
  { id: 'flash_sale', label: 'Oferta relámpago', needs: 'bps' },
  { id: 'coupon', label: 'Cupón', needs: 'bps' },
  { id: 'fixed_price', label: 'Precio fijo', needs: 'price' },
];

const CURRENCY = 'ARS';

/**
 * Store management (spec §50, §55).
 *
 * The pricing engine already knew how to apply a promotion; nothing in the
 * product could create one. This is the screen that makes that mechanism
 * reachable, next to the numbers that tell you whether it worked.
 *
 * A person can belong to several stores, so the screen picks one rather than
 * assuming. With exactly one it selects it silently — a chooser with a single
 * option is just a click.
 */
export default function StoreManagePage() {
  const { user, loading } = useSession();

  const [stores, setStores] = useState<StoreSummary[] | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<StoreDashboard | null>(null);
  const [promotions, setPromotions] = useState<Promotion[]>([]);

  const [kind, setKind] = useState<PromotionKind>('percentage');
  const [label, setLabel] = useState('');
  const [percent, setPercent] = useState('10');
  const [fixedPrice, setFixedPrice] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [endsAt, setEndsAt] = useState('');

  /** The shop's rate for its own followers, as a percentage in the input. */
  const [followerPercent, setFollowerPercent] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api.users
      .profile(user.username)
      .then((profile: UserProfile) => {
        setStores(profile.stores);
        if (profile.stores.length > 0) setStoreId(profile.stores[0]?.id ?? null);
      })
      .catch(() => setStores([]));
  }, [user]);

  const load = useCallback(async (id: string) => {
    // Independent: a store with no promotions should still show its numbers.
    const [dash, promos] = await Promise.allSettled([
      api.stores.dashboard(id),
      api.stores.promotions(id),
    ]);
    if (dash.status === 'fulfilled') setDashboard(dash.value);
    if (promos.status === 'fulfilled') setPromotions(promos.value);
  }, []);

  /**
   * The follower rate comes from the store itself rather than the dashboard,
   * which is why it loads separately: the dashboard is numbers, this is a
   * setting.
   */
  const loadFollowerRate = useCallback(async (handle: string) => {
    try {
      const store = await api.stores.get(handle);
      setFollowerPercent(String(store.followerBasisPoints / 100));
    } catch {
      // Leaving the field blank is better than filling it with a guess.
    }
  }, []);

  useEffect(() => {
    if (!storeId) return;
    void load(storeId);

    const handle = stores?.find((entry) => entry.id === storeId)?.handle;
    if (handle) void loadFollowerRate(handle);
  }, [load, loadFollowerRate, storeId, stores]);

  if (loading) {
    return (
      <AppScreen title="Mi tienda" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (!user) {
    return (
      <AppScreen title="Mi tienda" active="profile">
        <EmptyState
          title="Iniciá sesión"
          body="Gestioná tu tienda, sus promociones y sus métricas."
          actions={
            <Link href="/login?next=%2Fstore%2Fmanage" className={appScreenStyles.primary}>
              Entrar
            </Link>
          }
        />
      </AppScreen>
    );
  }

  if (stores === null) {
    return (
      <AppScreen title="Mi tienda" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (stores.length === 0) {
    return (
      <AppScreen title="Mi tienda" active="profile">
        <EmptyState
          title="Todavía no tenés una tienda"
          body="Una tienda te da catálogo, horarios, promociones y métricas. Vender como persona sigue funcionando igual."
          actions={
            <Link href="/store/new" className={appScreenStyles.primary}>
              Crear tienda
            </Link>
          }
        />
      </AppScreen>
    );
  }

  const store = stores.find((entry) => entry.id === storeId) ?? stores[0];
  const needs = KINDS.find((entry) => entry.id === kind)?.needs ?? 'bps';

  async function saveFollowerRate(event: FormEvent) {
    event.preventDefault();
    if (!storeId) return;

    const percent = Number(followerPercent.replace(',', '.'));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      setError('Poné un descuento entre 0 y 100.');
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      // Basis points on the wire: percentages with decimals are how rounding
      // errors get into prices.
      await api.stores.update(storeId, { followerBasisPoints: Math.round(percent * 100) });
      setSaved(percent > 0 ? `Tus seguidores pagan ${percent}% menos.` : 'Descuento desactivado.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos guardar el descuento.');
    } finally {
      setBusy(false);
    }
  }

  async function createPromotion(event: FormEvent) {
    event.preventDefault();
    if (!storeId || busy) return;

    setBusy(true);
    setError(null);
    setSaved(null);

    try {
      await api.stores.createPromotion(storeId, {
        kind,
        label: label.trim(),
        // Percentages travel as basis points, the same as everywhere else.
        basisPoints: needs === 'bps' ? Math.round(Number(percent) * 100) : undefined,
        fixedPrice:
          needs === 'price' && fixedPrice.trim()
            ? fromMajorUnits(fixedPrice.replace(',', '.'), CURRENCY)
            : undefined,
        couponCode: kind === 'coupon' ? couponCode.trim().toUpperCase() : undefined,
        // A flash sale without an end never ends, which is not a flash sale.
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
        requiredTier: 'public',
        stacksWithSocialDiscount: false,
      });

      setLabel('');
      setCouponCode('');
      setEndsAt('');
      setSaved('Promoción creada.');
      await load(storeId);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos crear la promoción.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen
      title={store?.name ?? 'Mi tienda'}
      subtitle="Métricas y promociones"
      active="profile"
    >
      {stores.length > 1 && (
        <div className={styles.storePicker}>
          {stores.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`${styles.chip} ${entry.id === storeId ? styles.chipActive : ''}`}
              onClick={() => setStoreId(entry.id)}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}

      {dashboard && (
        <section className={styles.section} aria-label="Métricas">
          <div className={styles.stats}>
            <Stat label="Órdenes" value={dashboard.orders} />
            <Stat
              label="Facturado"
              value={formatMoney(money(dashboard.revenue.amount, dashboard.revenue.currency))}
            />
            <Stat
              label="Ticket promedio"
              value={formatMoney(
                money(dashboard.averageTicket.amount, dashboard.averageTicket.currency),
              )}
            />
            <Stat label="Compradores" value={dashboard.buyers} />
            <Stat label="Publicaciones activas" value={dashboard.activeListings} />
            <Stat label="Vistas" value={dashboard.views} />
            <Stat label="Seguidores" value={dashboard.followers} />
            {/* Null, not zero: with no views there is no rate to report. */}
            <Stat
              label="Conversión"
              value={dashboard.conversionRate !== null ? `${dashboard.conversionRate}%` : '—'}
            />
          </div>
        </section>
      )}

      <section className={styles.section} aria-label="Descuento a seguidores">
        <h2 className={styles.sectionTitle}>Descuento a seguidores</h2>

        <form className={styles.form} onSubmit={saveFollowerRate}>
          <div>
            <label className={styles.label} htmlFor="followerPercent">
              Cuánto les descontás
            </label>
            <input
              id="followerPercent"
              className={styles.input}
              inputMode="decimal"
              value={followerPercent}
              onChange={(event) => setFollowerPercent(event.target.value)}
              placeholder="5"
            />
            <p className={styles.hint}>
              Se aplica solo a quien te sigue, en todo lo que publiques. Las tiendas no tienen
              amigos: esta es su única tarifa social, y se ve en tu perfil público para que la
              oferta valga antes de seguirte.
            </p>
          </div>

          <button type="submit" className={styles.submit} disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar descuento'}
          </button>
        </form>
      </section>

      <section className={styles.section} aria-label="Promociones">
        <h2 className={styles.sectionTitle}>Promociones</h2>

        {promotions.length === 0 ? (
          <p className={styles.hint}>Todavía no hay promociones activas.</p>
        ) : (
          <ul className={styles.promoList}>
            {promotions.map((promotion) => (
              <li key={promotion.id} className={styles.promo}>
                <div className={styles.promoBody}>
                  <p className={styles.promoLabel}>{promotion.label}</p>
                  <p className={styles.promoDetail}>{describe(promotion)}</p>
                  {promotion.couponCode && (
                    <span className={styles.coupon}>{promotion.couponCode}</span>
                  )}
                </div>
                <button
                  type="button"
                  className={styles.end}
                  onClick={async () => {
                    if (!storeId) return;
                    await api.stores.endPromotion(storeId, promotion.id).catch(() => undefined);
                    await load(storeId);
                  }}
                >
                  Terminar
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className={styles.form} onSubmit={createPromotion}>
          <h3 className={styles.sectionTitle}>Nueva promoción</h3>

          {error && <p className={styles.error}>{error}</p>}
          {saved && !error && <p className={styles.ok}>{saved}</p>}

          <div>
            <span className={styles.label}>Tipo</span>
            <div className={styles.chips}>
              {KINDS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`${styles.chip} ${kind === entry.id ? styles.chipActive : ''}`}
                  aria-pressed={kind === entry.id}
                  onClick={() => setKind(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={styles.label} htmlFor="label">
              Cómo se muestra
            </label>
            <input
              id="label"
              className={styles.input}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="20% en toda la tienda"
              maxLength={80}
              required
            />
          </div>

          <div className={styles.pair}>
            {needs === 'bps' ? (
              <div>
                <label className={styles.label} htmlFor="percent">
                  Descuento
                </label>
                <input
                  id="percent"
                  className={styles.input}
                  inputMode="decimal"
                  value={percent}
                  onChange={(event) => setPercent(event.target.value)}
                />
                <p className={styles.hint}>
                  En porcentaje. Se guarda como {Math.round(Number(percent) * 100) || 0} basis
                  points.
                </p>
              </div>
            ) : (
              <div>
                <label className={styles.label} htmlFor="fixedPrice">
                  Precio fijo
                </label>
                <input
                  id="fixedPrice"
                  className={styles.input}
                  inputMode="decimal"
                  value={fixedPrice}
                  onChange={(event) => setFixedPrice(event.target.value)}
                  placeholder="9990"
                  required
                />
              </div>
            )}

            <div>
              <label className={styles.label} htmlFor="endsAt">
                Termina
              </label>
              <input
                id="endsAt"
                className={styles.input}
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                required={kind === 'flash_sale'}
              />
            </div>
          </div>

          {kind === 'coupon' && (
            <div>
              <label className={styles.label} htmlFor="coupon">
                Código
              </label>
              <input
                id="coupon"
                className={styles.input}
                value={couponCode}
                onChange={(event) => setCouponCode(event.target.value)}
                placeholder="VERANO26"
                maxLength={40}
                required
              />
              <p className={styles.hint}>
                Tiene que ser único en toda la plataforma, no sólo en tu tienda.
              </p>
            </div>
          )}

          <button className={styles.submit} type="submit" disabled={busy || !label.trim()}>
            {busy ? 'Creando…' : 'Crear promoción'}
          </button>

          <p className={styles.hint}>
            Las promociones de tienda no se suman al descuento social: las tiendas no tienen amigos,
            tienen promociones.
          </p>
        </form>
      </section>
    </AppScreen>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

function describe(promotion: Promotion): string {
  const parts: string[] = [];
  if (promotion.basisPoints) parts.push(`−${promotion.basisPoints / 100}%`);
  if (promotion.fixedPrice) {
    parts.push(formatMoney(money(promotion.fixedPrice.amount, promotion.fixedPrice.currency)));
  }
  if (promotion.endsAt) {
    parts.push(`hasta ${new Date(promotion.endsAt).toLocaleDateString('es-AR')}`);
  }
  return parts.join(' · ') || 'Activa';
}
