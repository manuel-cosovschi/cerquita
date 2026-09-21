'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { Category, DeliveryMethod, ItemCondition } from '@cerquita/types';
import { ApiError } from '@cerquita/api-client';
import { fromMajorUnits, type Coordinates } from '@cerquita/utils';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';
import { LocationPicker } from '@/components/LocationPicker';
import { PhotoUploader, type UploadedPhoto } from '@/components/PhotoUploader';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from './page.module.css';

type Kind = 'sale' | 'auction' | 'wanted';

const CONDITIONS: ReadonlyArray<{ id: ItemCondition; label: string }> = [
  { id: 'new', label: 'Nuevo' },
  { id: 'like_new', label: 'Como nuevo' },
  { id: 'good', label: 'Bueno' },
  { id: 'fair', label: 'Usado' },
  { id: 'for_parts', label: 'Para repuestos' },
];

const DELIVERY: ReadonlyArray<{ id: DeliveryMethod; label: string }> = [
  { id: 'meetup', label: 'Nos encontramos' },
  { id: 'pickup', label: 'Lo retiran' },
  { id: 'shipping', label: 'Envío' },
];

const TITLES: Record<Kind, string> = {
  sale: 'Vender algo',
  auction: 'Crear subasta',
  wanted: 'Estoy buscando',
};

/** Currency is fixed per market; the API takes it explicitly all the same. */
const CURRENCY = 'ARS';

/**
 * The publish form (spec §14, §58).
 *
 * One component for all three kinds, because they share the same seven
 * questions and differ in four. Splitting them would mean maintaining photo
 * upload, the location picker and the error handling three times.
 *
 * Money is typed in pesos and converted with `fromMajorUnits`, never by
 * multiplying by 100: currencies do not all have two decimal places, and the
 * whole codebase stores integer minor units.
 */
export function PublishForm({ kind: fixedKind }: { kind?: Kind } = {}) {
  const params = useSearchParams();
  const router = useRouter();
  const { user, loading } = useSession();

  const kind: Kind = fixedKind ?? parseKind(params.get('kind'));

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [condition, setCondition] = useState<ItemCondition>('good');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [delivery, setDelivery] = useState<DeliveryMethod[]>(['meetup']);
  const [acceptsOffers, setAcceptsOffers] = useState(true);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [location, setLocation] = useState<Coordinates | null>(null);

  // Auction-only
  const [startingPrice, setStartingPrice] = useState('');
  const [increment, setIncrement] = useState('');
  const [durationDays, setDurationDays] = useState('7');

  // Wanted-only
  const [maxBudget, setMaxBudget] = useState('');
  const [radiusKm, setRadiusKm] = useState('5');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  useEffect(() => {
    api.categories
      .list()
      .then((result) => {
        setCategories(result);
        // Leaf categories are the meaningful ones; parents exist to group them.
        const firstLeaf = result.find((entry) => entry.parentId);
        if (firstLeaf) setCategoryId(firstLeaf.id);
      })
      .catch(() => setCategories([]));
  }, []);

  if (loading) {
    return (
      <AppScreen title={TITLES[kind]} active="map">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (!user) {
    const next = encodeURIComponent(kind === 'wanted' ? '/wanted/new' : `/sell/new?kind=${kind}`);
    return (
      <AppScreen title={TITLES[kind]} active="map">
        <EmptyState
          title="Iniciá sesión"
          body="Necesitás una cuenta para publicar."
          actions={
            <>
              <Link href={`/login?next=${next}`} className={appScreenStyles.primary}>
                Entrar
              </Link>
              <Link href={`/register?next=${next}`} className={appScreenStyles.secondary}>
                Crear cuenta
              </Link>
            </>
          }
        />
      </AppScreen>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    if (!location) {
      setError('Marcá en el mapa dónde está.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setIssues([]);

    try {
      const base = {
        title: title.trim(),
        description: description.trim(),
        categoryId,
        tags: [] as string[],
        images: photos.map((photo, index) => ({
          url: photo.url,
          width: photo.width,
          height: photo.height,
          position: index,
        })),
        location,
      };

      const body =
        kind === 'sale'
          ? {
              ...base,
              kind: 'sale' as const,
              price: fromMajorUnits(price.replace(',', '.'), CURRENCY),
              condition,
              quantity: Math.max(1, Number(quantity) || 1),
              deliveryMethods: delivery,
              acceptsOffers,
            }
          : kind === 'auction'
            ? {
                ...base,
                kind: 'auction' as const,
                condition,
                deliveryMethods: delivery,
                startingPrice: fromMajorUnits(startingPrice.replace(',', '.'), CURRENCY),
                minimumIncrement: fromMajorUnits(increment.replace(',', '.'), CURRENCY),
                endsAt: daysFromNow(Number(durationDays) || 7).toISOString(),
              }
            : {
                ...base,
                kind: 'wanted' as const,
                maxBudget: maxBudget.trim()
                  ? fromMajorUnits(maxBudget.replace(',', '.'), CURRENCY)
                  : undefined,
                wantedRadiusMeters: Math.round((Number(radiusKm) || 5) * 1000),
              };

      const listing = await api.listings.create(body);
      router.replace(`/listing/${listing.id}`);
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        // The API returns field-level complaints; showing them individually is
        // the difference between "falta algo" and knowing what.
        setIssues((cause.body.issues ?? []).map((issue) => issue.message));
      } else {
        setError('No pudimos publicar. Probá de nuevo.');
      }
      setSubmitting(false);
    }
  }

  const leaves = (categories ?? []).filter((entry) => entry.parentId);
  const parentsById = new Map((categories ?? []).map((entry) => [entry.id, entry]));

  return (
    <AppScreen title={TITLES[kind]} active="map">
      <form className={styles.form} onSubmit={submit} noValidate>
        {kind !== 'wanted' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Fotos</h2>
            <PhotoUploader photos={photos} onChange={setPhotos} />
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Qué es</h2>

          <div>
            <label className={styles.label} htmlFor="title">
              {kind === 'wanted' ? '¿Qué estás buscando?' : 'Título'}
            </label>
            <input
              id="title"
              className={styles.input}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder={kind === 'wanted' ? 'Bici rodado 29' : 'Bicicleta rodado 29'}
              required
            />
          </div>

          <div>
            <label className={styles.label} htmlFor="description">
              Descripción
            </label>
            <textarea
              id="description"
              className={styles.textarea}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={5000}
              placeholder={
                kind === 'wanted'
                  ? 'Contá para qué la necesitás y qué estado te sirve.'
                  : 'Contá en qué estado está, hace cuánto la tenés, si falta algo.'
              }
            />
          </div>

          <div>
            <label className={styles.label} htmlFor="category">
              Categoría
            </label>
            <select
              id="category"
              className={styles.select}
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              required
            >
              {leaves.map((entry) => {
                const parent = entry.parentId ? parentsById.get(entry.parentId) : undefined;
                return (
                  <option key={entry.id} value={entry.id}>
                    {parent ? `${parent.name} · ${entry.name}` : entry.name}
                  </option>
                );
              })}
            </select>
          </div>

          {kind !== 'wanted' && (
            <div>
              <span className={styles.label}>Estado</span>
              <div className={styles.chips}>
                {CONDITIONS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`${styles.chip} ${condition === entry.id ? styles.chipActive : ''}`}
                    aria-pressed={condition === entry.id}
                    onClick={() => setCondition(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            {kind === 'auction' ? 'La subasta' : kind === 'wanted' ? 'Tu presupuesto' : 'Precio'}
          </h2>

          {kind === 'sale' && (
            <>
              <div>
                <label className={styles.label} htmlFor="price">
                  Precio en pesos
                </label>
                <input
                  id="price"
                  className={`${styles.input} ${styles.money}`}
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="45000"
                  required
                />
                <p className={styles.hint}>
                  Tus amigos y seguidores pueden ver un precio menor según lo que hayas configurado
                  en tu perfil.
                </p>
              </div>

              <div>
                <label className={styles.label} htmlFor="quantity">
                  Cuántos tenés
                </label>
                <input
                  id="quantity"
                  className={styles.input}
                  inputMode="numeric"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </div>

              <div className={styles.toggleRow}>
                <span className={styles.toggleLabel}>Aceptar ofertas</span>
                <input
                  type="checkbox"
                  checked={acceptsOffers}
                  onChange={(event) => setAcceptsOffers(event.target.checked)}
                  aria-label="Aceptar ofertas"
                />
              </div>
            </>
          )}

          {kind === 'auction' && (
            <>
              <div>
                <label className={styles.label} htmlFor="startingPrice">
                  Precio inicial
                </label>
                <input
                  id="startingPrice"
                  className={`${styles.input} ${styles.money}`}
                  inputMode="decimal"
                  value={startingPrice}
                  onChange={(event) => setStartingPrice(event.target.value)}
                  placeholder="10000"
                  required
                />
              </div>

              <div>
                <label className={styles.label} htmlFor="increment">
                  Incremento mínimo
                </label>
                <input
                  id="increment"
                  className={`${styles.input} ${styles.money}`}
                  inputMode="decimal"
                  value={increment}
                  onChange={(event) => setIncrement(event.target.value)}
                  placeholder="500"
                  required
                />
                <p className={styles.hint}>
                  Cada puja tiene que superar a la anterior al menos por este monto.
                </p>
              </div>

              <div>
                <label className={styles.label} htmlFor="duration">
                  Cuánto dura
                </label>
                <select
                  id="duration"
                  className={styles.select}
                  value={durationDays}
                  onChange={(event) => setDurationDays(event.target.value)}
                >
                  <option value="1">1 día</option>
                  <option value="3">3 días</option>
                  <option value="7">7 días</option>
                  <option value="14">14 días</option>
                </select>
                <p className={styles.hint}>
                  Una puja en los últimos minutos extiende el cierre, así nadie gana por esperar al
                  último segundo.
                </p>
              </div>
            </>
          )}

          {kind === 'wanted' && (
            <>
              <div>
                <label className={styles.label} htmlFor="maxBudget">
                  Hasta cuánto pagarías (opcional)
                </label>
                <input
                  id="maxBudget"
                  className={`${styles.input} ${styles.money}`}
                  inputMode="decimal"
                  value={maxBudget}
                  onChange={(event) => setMaxBudget(event.target.value)}
                  placeholder="30000"
                />
              </div>

              <div>
                <label className={styles.label} htmlFor="radius">
                  A qué distancia lo buscás
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
            </>
          )}
        </section>

        {kind !== 'wanted' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Cómo lo entregás</h2>
            <div className={styles.chips}>
              {DELIVERY.map((entry) => {
                const active = delivery.includes(entry.id);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                    aria-pressed={active}
                    onClick={() =>
                      setDelivery((current) =>
                        active
                          ? // Never leave it empty: the API requires at least one.
                            current.length > 1
                            ? current.filter((id) => id !== entry.id)
                            : current
                          : [...current, entry.id],
                      )
                    }
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Dónde está</h2>
          <LocationPicker value={location} onChange={setLocation} />
        </section>

        {(error || issues.length > 0) && (
          <div className={styles.issues} role="alert">
            {error}
            {issues.length > 0 && (
              <ul className={styles.issueList}>
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <button className={styles.submit} type="submit" disabled={submitting}>
          {submitting ? 'Publicando…' : 'Publicar'}
        </button>
      </form>
    </AppScreen>
  );
}

function parseKind(value: string | null): Kind {
  return value === 'auction' || value === 'wanted' ? value : 'sale';
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
