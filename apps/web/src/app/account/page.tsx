'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { UserProfile } from '@cerquita/types';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from './page.module.css';

/**
 * The signed-in profile.
 *
 * Three states, and all three are real: still restoring the session, signed out,
 * signed in. Rendering the signed-out prompt while the refresh is still in
 * flight would flash "iniciá sesión" at someone who never left.
 */
export default function AccountPage() {
  const { user, loading, logout } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // Shown on the Actividad row so the account screen says whether anything is
  // waiting, instead of making the user open it to find out.
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }

    let cancelled = false;
    api.users
      .profile(user.username)
      .then((result) => {
        if (!cancelled) setProfile(result);
      })
      .catch(() => {
        // The dock still has to work if the profile call fails; the header falls
        // back to the username we already have from the token.
        if (!cancelled) setProfile(null);
      });

    // Offers and friend requests are the two things somebody is waiting on.
    // Failures are silent: the count is a convenience, not the screen.
    Promise.allSettled([api.offers.list(), api.social.pendingFriendRequests()])
      .then(([offers, requests]) => {
        if (cancelled) return;
        const openOffers =
          offers.status === 'fulfilled'
            ? offers.value.filter(
                (offer) => offer.status === 'pending' && offer.toUser.id === user.userId,
              ).length
            : 0;
        const openRequests = requests.status === 'fulfilled' ? requests.value.length : 0;
        setPending(openOffers + openRequests);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return (
      <AppScreen title="Perfil" active="profile">
        <p className={styles.loading}>Cargando…</p>
      </AppScreen>
    );
  }

  if (!user) {
    return (
      <AppScreen title="Perfil" active="profile">
        <EmptyState
          title="Iniciá sesión"
          body="Con tu cuenta ves los precios de amigo, tus compras, ventas y publicaciones."
          actions={
            <>
              <Link href="/login?next=%2Faccount" className={appScreenStyles.primary}>
                Entrar
              </Link>
              <Link href="/register?next=%2Faccount" className={appScreenStyles.secondary}>
                Crear cuenta
              </Link>
            </>
          }
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen title="Perfil" active="profile">
      <div className={styles.identity}>
        {profile?.avatarUrl ? (
          <img className={styles.avatar} src={profile.avatarUrl} alt="" />
        ) : (
          <span className={styles.avatar} aria-hidden="true">
            {(profile?.displayName ?? user.username).slice(0, 1).toUpperCase()}
          </span>
        )}
        <div>
          <h2 className={styles.name}>{profile?.displayName ?? user.username}</h2>
          <p className={styles.handle}>@{user.username}</p>
          {profile?.bio && <p className={styles.bio}>{profile.bio}</p>}
        </div>
      </div>

      {profile && (
        <div className={styles.stats}>
          <Stat value={profile.salesCount} label="Ventas" />
          <Stat value={profile.friendCount} label="Amigos" />
          <Stat value={profile.followerCount} label="Seguidores" />
          <Stat value={profile.reviewCount} label="Reseñas" />
        </div>
      )}

      <ul className={styles.menu}>
        <li>
          <Link className={styles.menuItem} href="/activity">
            Actividad
            <span className={styles.menuNote}>
              {pending > 0 ? `${pending} sin responder` : 'Ofertas, solicitudes y avisos'}
            </span>
          </Link>
        </li>
        <li>
          <Link className={styles.menuItem} href={`/user/${user.username}`}>
            Ver mi perfil público
            <span className={styles.menuNote}>Como lo ven los demás</span>
          </Link>
        </li>
        <li>
          <Link className={styles.menuItem} href="/favorites">
            Guardados
          </Link>
        </li>
        <li>
          <Link className={styles.menuItem} href="/sell">
            Publicar algo
          </Link>
        </li>
        <li>
          <Link className={styles.menuItem} href="/alerts">
            Alertas
            <span className={styles.menuNote}>Avisos de lo que buscás</span>
          </Link>
        </li>
        <li>
          <Link className={styles.menuItem} href="/settings/pricing">
            Precios para amigos y seguidores
            <span className={styles.menuNote}>Tu descuento social</span>
          </Link>
        </li>
      </ul>

      <button
        type="button"
        className={`${styles.menuItem} ${styles.logout}`}
        onClick={async () => {
          await logout();
          router.replace('/');
        }}
      >
        Cerrar sesión
      </button>
    </AppScreen>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}
