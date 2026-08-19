'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ListingSummary, UserProfile } from '@cerquita/types';
import { ApiError, type ProfileReview, type ProfileTab } from '@cerquita/api-client';
import { AppScreen } from '@/components/AppScreen';
import { ListingCard } from '@/components/ListingCard';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from './page.module.css';
import { Stat } from '@/components/Stat';

const TABS: ReadonlyArray<{ id: ProfileTab; label: string }> = [
  { id: 'selling', label: 'En venta' },
  { id: 'auctions', label: 'Subastas' },
  { id: 'wanted', label: 'Busca' },
  { id: 'sold', label: 'Vendido' },
];

/**
 * Somebody else's profile.
 *
 * The order is direction 1c's argument made literal: name, then the social
 * reference, then the actions, and only then the numbers. A rating average is a
 * summary of strangers' opinions; "amiga de Nacho" is a person you can ask.
 *
 * Which tabs exist is the server's call — a seller who hid their sold listings
 * gets an empty tab, because hiding is enforced at the endpoint and the client
 * must not imply otherwise.
 */
export default function ProfilePage() {
  const params = useParams<{ username: string }>();
  const username = params.username;
  const { user } = useSession();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ProfileTab>('selling');
  const [listings, setListings] = useState<ListingSummary[] | null>(null);
  const [reviews, setReviews] = useState<ProfileReview[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setProfile(await api.users.profile(username));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos cargar este perfil.');
    }
  }, [username]);

  // Re-runs when the viewer changes: relationship, social proof and which tabs
  // return anything are all resolved per viewer.
  useEffect(() => {
    void load();
  }, [load, user?.userId]);

  // Reviews are loaded once per profile: they are the same for every viewer,
  // so unlike the listings they do not need to follow the session.
  useEffect(() => {
    let cancelled = false;
    api.users
      .reviews(username)
      .then((page) => {
        if (!cancelled) setReviews(page.items);
      })
      .catch(() => {
        if (!cancelled) setReviews([]);
      });

    return () => {
      cancelled = true;
    };
  }, [username]);

  useEffect(() => {
    let cancelled = false;
    setListings(null);

    api.users
      .listings(username, tab)
      .then((result) => {
        if (!cancelled) setListings(result);
      })
      .catch(() => {
        if (!cancelled) setListings([]);
      });

    return () => {
      cancelled = true;
    };
  }, [username, tab, user?.userId]);

  if (error) {
    return (
      <AppScreen title="Perfil" active="profile">
        <p className={styles.state}>{error}</p>
      </AppScreen>
    );
  }

  if (!profile) {
    return (
      <AppScreen title="Perfil" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  const isSelf = user?.userId === profile.id;
  const relationship = profile.relationship;

  async function act(action: 'follow' | 'unfollow' | 'friend') {
    if (!profile || busy) return;
    setBusy(true);
    try {
      if (action === 'follow') await api.social.follow(profile.id);
      else if (action === 'unfollow') await api.social.unfollow(profile.id);
      else await api.social.requestFriendship(profile.id);
      // Reload rather than patch state locally: following someone can change the
      // price they see, and the server is the only place that decides that.
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos completar la acción.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen title={profile.displayName} active="profile">
      <div className={styles.header}>
        {profile.avatarUrl ? (
          <img className={styles.avatar} src={profile.avatarUrl} alt="" />
        ) : (
          <span className={styles.avatar} aria-hidden="true">
            {profile.displayName.slice(0, 1).toUpperCase()}
          </span>
        )}

        <div className={styles.identity}>
          <h2 className={styles.name}>
            {profile.displayName}
            {profile.verified && (
              <>
                {' '}
                <span title="Cuenta verificada">✓</span>
                <span className="sr-only">Verificado</span>
              </>
            )}
          </h2>
          <p className={styles.handle}>@{profile.username}</p>

          {/* The reference does more work here than any badge. */}
          {profile.socialProof && <span className={styles.proof}>{profile.socialProof}</span>}

          {profile.bio && <p className={styles.bio}>{profile.bio}</p>}
          {profile.area && <p className={styles.area}>{profile.area}</p>}
        </div>
      </div>

      {!isSelf && (
        <div className={styles.actions}>
          {relationship?.isFollowing ? (
            <button
              type="button"
              className={`${styles.action} ${styles.actionDone}`}
              onClick={() => void act('unfollow')}
              disabled={busy}
            >
              Siguiendo
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.action} ${styles.actionPrimary}`}
              onClick={() => void act('follow')}
              disabled={busy}
            >
              Seguir
            </button>
          )}

          <button
            type="button"
            className={`${styles.action} ${
              relationship?.friendship === 'accepted' ? styles.actionDone : styles.actionSecondary
            }`}
            onClick={() => void act('friend')}
            disabled={
              busy ||
              relationship?.friendship === 'accepted' ||
              relationship?.friendship === 'pending'
            }
          >
            {friendLabel(relationship?.friendship)}
          </button>
        </div>
      )}

      <div className={styles.stats}>
        <Stat value={profile.salesCount} label="Ventas" one="Venta" />
        <Stat value={profile.friendCount} label="Amigos" one="Amigo" />
        <Stat value={profile.followerCount} label="Seguidores" one="Seguidor" />
        <Stat value={profile.reviewCount} label="Reseñas" one="Reseña" />
      </div>

      <div className={styles.tabs} role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`${styles.tab} ${tab === entry.id ? styles.tabActive : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {reviews.length > 0 && (
        <section className={styles.reviews} aria-label="Reseñas">
          <h3 className={styles.reviewsTitle}>Lo que dicen ({profile.reviewCount})</h3>
          <ul className={styles.reviewList}>
            {reviews.map((review) => (
              <li key={review.id} className={styles.review}>
                <div className={styles.reviewHead}>
                  <span className={styles.reviewStars} aria-label={`${review.rating} de 5`}>
                    {'★'.repeat(review.rating)}
                    <span className={styles.reviewStarsOff}>{'★'.repeat(5 - review.rating)}</span>
                  </span>
                  <span className={styles.reviewAuthor}>{review.author.displayName}</span>
                </div>
                {review.body && <p className={styles.reviewBody}>{review.body}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {listings === null ? (
        <p className={styles.state}>Cargando…</p>
      ) : listings.length === 0 ? (
        <p className={styles.state}>Nada por acá todavía.</p>
      ) : (
        <div className={styles.grid}>
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </AppScreen>
  );
}

function friendLabel(status: string | null | undefined): string {
  if (status === 'accepted') return 'Amigos';
  if (status === 'pending') return 'Solicitud enviada';
  return 'Agregar como amigo';
}
