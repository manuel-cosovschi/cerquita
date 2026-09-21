'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError } from '@cerquita/api-client';
import { applyDiscount, formatMoney, money } from '@cerquita/utils';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from './page.module.css';

/** The price the worked example is calculated on: $50.000 in minor units. */
const EXAMPLE = money(5_000_000, 'ARS');

/** Sliders move in whole percents; the wire keeps basis points. */
const STEP_BPS = 100;
const MAX_BPS = 5000;

/**
 * Social pricing (spec §30).
 *
 * The seller decides what a follower and a friend pay. Two rules are enforced
 * here so the screen cannot propose something the server would reject:
 *
 * - a friend never pays more than a follower. The tiers are ordered by how close
 *   the relationship is, and pricing that inverts them makes no sense to anyone.
 * - the maximum is 50%. Not a technical limit — a seller who sets 90% by
 *   dragging a slider has made a mistake, not a decision.
 */
export default function PricingSettingsPage() {
  const { user, loading } = useSession();

  const [follower, setFollower] = useState(0);
  const [friend, setFriend] = useState(0);
  const [initial, setInitial] = useState<{ follower: number; friend: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    api.users
      .settings()
      .then((settings) => {
        if (cancelled) return;
        setFollower(settings.discounts.followerBasisPoints);
        setFriend(settings.discounts.friendBasisPoints);
        setInitial({
          follower: settings.discounts.followerBasisPoints,
          friend: settings.discounts.friendBasisPoints,
        });
      })
      .catch(() => {
        if (!cancelled) setError('No pudimos cargar tu configuración.');
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return (
      <AppScreen title="Precios sociales" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (!user) {
    return (
      <AppScreen title="Precios sociales" active="profile">
        <EmptyState
          title="Iniciá sesión"
          body="Configurá qué precio ven tus amigos y quienes te siguen."
          actions={
            <Link href="/login?next=%2Fsettings%2Fpricing" className={appScreenStyles.primary}>
              Entrar
            </Link>
          }
        />
      </AppScreen>
    );
  }

  if (!initial) {
    return (
      <AppScreen title="Precios sociales" active="profile">
        <p className={styles.state}>{error ?? 'Cargando…'}</p>
      </AppScreen>
    );
  }

  const dirty = follower !== initial.follower || friend !== initial.friend;

  // A friend paying more than a follower inverts the relationship ladder, so the
  // follower slider pushes the friend one along rather than allowing it.
  function setFollowerDiscount(value: number) {
    setFollower(value);
    if (friend < value) setFriend(value);
    setSaved(false);
  }

  function setFriendDiscount(value: number) {
    setFriend(Math.max(value, follower));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.users.updateDiscounts({
        followerBasisPoints: follower,
        friendBasisPoints: friend,
      });
      setInitial({ follower, friend });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos guardar los cambios.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppScreen title="Precios sociales" active="profile">
      <p className={styles.intro}>
        Elegí cuánto menos pagan las personas que te siguen y tus amigos. Se aplica solo a lo que
        publicás como persona: lo de tu tienda se configura en su gestión, y ahí no hay amigos, sólo
        seguidores.
      </p>

      <DiscountGroup
        id="follower"
        label="Quienes te siguen"
        note="Cualquiera que te siga ve este precio."
        value={follower}
        onChange={setFollowerDiscount}
      />

      <DiscountGroup
        id="friend"
        label="Tus amigos"
        note="Amistad aceptada de las dos partes."
        value={friend}
        onChange={setFriendDiscount}
      />

      {friend === follower && friend > 0 && (
        <p className={styles.warning}>
          Tus amigos y quienes te siguen pagan lo mismo. Si querés diferenciarlos, subí el descuento
          de amigos.
        </p>
      )}

      <button
        className={styles.save}
        type="button"
        onClick={() => void save()}
        disabled={!dirty || saving}
      >
        {saving ? 'Guardando…' : 'Guardar'}
      </button>

      {saved && !dirty && <p className={styles.saved}>Listo, lo guardamos.</p>}
      {error && <p className={styles.error}>{error}</p>}
    </AppScreen>
  );
}

function DiscountGroup({
  id,
  label,
  note,
  value,
  onChange,
}: {
  id: string;
  label: string;
  note: string;
  value: number;
  onChange: (value: number) => void;
}) {
  // Rounded with the same helper the server uses, so the example is the number
  // the buyer will actually be charged, not an approximation of it.
  const discounted = applyDiscount(EXAMPLE, value);

  return (
    <div className={styles.group}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <span className={styles.note}>{note}</span>

      <div className={styles.row}>
        <input
          id={id}
          className={styles.slider}
          type="range"
          min={0}
          max={MAX_BPS}
          step={STEP_BPS}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <output className={styles.value} htmlFor={id}>
          {value / 100}%
        </output>
      </div>

      <p className={styles.example}>
        Algo de <span className={styles.exampleAmount}>{formatMoney(EXAMPLE)}</span> les sale{' '}
        <span className={styles.exampleAmount}>{formatMoney(discounted)}</span>
      </p>
    </div>
  );
}
