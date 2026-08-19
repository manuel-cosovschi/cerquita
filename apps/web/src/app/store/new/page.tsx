'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { DeliveryMethod } from '@cerquita/types';
import { ApiError } from '@cerquita/api-client';
import type { Coordinates } from '@cerquita/utils';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';
import { LocationPicker } from '@/components/LocationPicker';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from '../manage/page.module.css';

const DELIVERY: ReadonlyArray<{ id: DeliveryMethod; label: string }> = [
  { id: 'pickup', label: 'Retiran en el local' },
  { id: 'meetup', label: 'Nos encontramos' },
  { id: 'store_delivery', label: 'Reparto propio' },
  { id: 'shipping', label: 'Envío' },
];

/**
 * Creating a store (spec §15).
 *
 * A store is not an upgraded person: it has a catalogue, opening hours, staff
 * and promotions, and it has no friends — a business offers discounts, not
 * relationships. The form says that plainly rather than letting someone find
 * out later that their friend pricing stopped applying.
 *
 * The physical-address question gates the map, because a store that only ships
 * has no storefront to publish and asking for one would invite a fake pin.
 */
export default function NewStorePage() {
  const { user, loading } = useSession();
  const router = useRouter();

  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleEdited, setHandleEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [hasPhysicalLocation, setHasPhysicalLocation] = useState(true);
  const [address, setAddress] = useState('');
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [delivery, setDelivery] = useState<DeliveryMethod[]>(['pickup']);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <AppScreen title="Crear tienda" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (!user) {
    return (
      <AppScreen title="Crear tienda" active="profile">
        <EmptyState
          title="Iniciá sesión"
          body="Necesitás una cuenta para abrir una tienda."
          actions={
            <Link href="/login?next=%2Fstore%2Fnew" className={appScreenStyles.primary}>
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

    if (hasPhysicalLocation && !location) {
      setError('Marcá en el mapa dónde está el local.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const store = await api.stores.create({
        name: name.trim(),
        handle: handle.trim().toLowerCase(),
        description: description.trim() || undefined,
        hasPhysicalLocation,
        location: hasPhysicalLocation && location ? location : undefined,
        address: hasPhysicalLocation ? address.trim() || undefined : undefined,
        deliveryMethods: delivery,
      });

      router.replace(`/store/${store.handle}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos crear la tienda.');
      setBusy(false);
    }
  }

  return (
    <AppScreen title="Crear tienda" active="profile">
      <form className={styles.form} onSubmit={submit}>
        {error && <p className={styles.error}>{error}</p>}

        <div>
          <label className={styles.label} htmlFor="name">
            Nombre
          </label>
          <input
            id="name"
            className={styles.input}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              // The handle follows the name until somebody touches it, and then
              // it stops — silently rewriting a chosen handle is worse than
              // making them type it.
              if (!handleEdited) setHandle(slugify(event.target.value));
            }}
            maxLength={80}
            required
          />
        </div>

        <div>
          <label className={styles.label} htmlFor="handle">
            Dirección de la tienda
          </label>
          <input
            id="handle"
            className={styles.input}
            value={handle}
            onChange={(event) => {
              setHandleEdited(true);
              setHandle(slugify(event.target.value));
            }}
            required
          />
          <p className={styles.hint}>cerquita.app/store/{handle || 'tu-tienda'}</p>
        </div>

        <div>
          <label className={styles.label} htmlFor="description">
            Qué venden
          </label>
          <textarea
            id="description"
            className={styles.textarea}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
          />
        </div>

        <div>
          <span className={styles.label}>¿Tienen local?</span>
          <div className={styles.chips}>
            <button
              type="button"
              className={`${styles.chip} ${hasPhysicalLocation ? styles.chipActive : ''}`}
              aria-pressed={hasPhysicalLocation}
              onClick={() => setHasPhysicalLocation(true)}
            >
              Sí, atendemos ahí
            </button>
            <button
              type="button"
              className={`${styles.chip} ${!hasPhysicalLocation ? styles.chipActive : ''}`}
              aria-pressed={!hasPhysicalLocation}
              onClick={() => setHasPhysicalLocation(false)}
            >
              No, sólo enviamos
            </button>
          </div>
        </div>

        {hasPhysicalLocation && (
          <>
            <div>
              <label className={styles.label} htmlFor="address">
                Dirección
              </label>
              <input
                id="address"
                className={styles.input}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Av. Corrientes 1234"
                maxLength={300}
              />
              <p className={styles.hint}>
                A diferencia de una publicación, la dirección de un local sí es pública: la gente
                tiene que poder llegar.
              </p>
            </div>

            <div>
              <span className={styles.label}>Dónde está</span>
              <LocationPicker value={location} onChange={setLocation} />
            </div>
          </>
        )}

        <div>
          <span className={styles.label}>Cómo entregan</span>
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
                        ? // The API needs at least one, so the last cannot be removed.
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
        </div>

        <button className={styles.submit} type="submit" disabled={busy || !name.trim() || !handle}>
          {busy ? 'Creando…' : 'Crear tienda'}
        </button>

        <p className={styles.hint}>
          Las tiendas no tienen amigos: en vez de precios de amigo, ofrecen promociones. Tus
          publicaciones personales siguen usando tus descuentos sociales.
        </p>
      </form>
    </AppScreen>
  );
}

/** Mirrors the handle rules the API enforces, so the field cannot type an invalid one. */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
