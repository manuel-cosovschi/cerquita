'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Conversation } from '@cerquita/types';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatRelativeTime } from '@/lib/time';
import styles from './page.module.css';

/**
 * The conversation list.
 *
 * The other participant is worked out by elimination rather than by position:
 * the API returns everyone in the thread, and assuming the counterpart is
 * `participants[0]` would show you your own name half the time.
 */
export default function MessagesPage() {
  const { user, loading } = useSession();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);

  useEffect(() => {
    if (!user) {
      setConversations(null);
      return;
    }

    let cancelled = false;
    api.chat
      .conversations()
      .then((result) => {
        if (!cancelled) setConversations(result);
      })
      .catch(() => {
        if (!cancelled) setConversations([]);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return (
      <AppScreen title="Chats" active="chats">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (!user) {
    return (
      <AppScreen title="Chats" active="chats">
        <EmptyState
          title="Iniciá sesión"
          body="Tus conversaciones con compradores y vendedores aparecen acá."
          actions={
            <Link href="/login?next=%2Fmessages" className={appScreenStyles.primary}>
              Entrar
            </Link>
          }
        />
      </AppScreen>
    );
  }

  if (conversations === null) {
    return (
      <AppScreen title="Chats" active="chats">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (conversations.length === 0) {
    return (
      <AppScreen title="Chats" subtitle="Tus conversaciones" active="chats">
        <EmptyState
          title="No tenés conversaciones"
          body="Cuando preguntes por algo o te escriban, la conversación aparece acá."
          actions={
            <Link href="/" className={appScreenStyles.primary}>
              Buscar algo cerca
            </Link>
          }
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen title="Chats" subtitle="Tus conversaciones" active="chats">
      <ul className={styles.list}>
        {conversations.map((conversation) => {
          const other =
            conversation.participants.find((participant) => participant.id !== user.userId) ??
            conversation.participants[0];
          const unread = conversation.unreadCount > 0;

          return (
            <li key={conversation.id}>
              <Link
                href={`/messages/${conversation.id}`}
                className={`${styles.row} ${unread ? styles.rowUnread : ''}`}
              >
                {other?.avatarUrl ? (
                  <img className={styles.avatar} src={other.avatarUrl} alt="" />
                ) : (
                  <span className={styles.avatar} aria-hidden="true">
                    {(other?.displayName ?? '?').slice(0, 1).toUpperCase()}
                  </span>
                )}

                <span className={styles.body}>
                  <span className={styles.head}>
                    <span className={styles.name}>{other?.displayName ?? 'Conversación'}</span>
                    <span className={styles.time}>
                      {formatRelativeTime(conversation.updatedAt)}
                    </span>
                  </span>

                  {conversation.listing && (
                    <span className={styles.about}>Sobre {conversation.listing.title}</span>
                  )}

                  <span className={`${styles.preview} ${unread ? styles.previewUnread : ''}`}>
                    {preview(conversation)}
                  </span>
                </span>

                {unread && (
                  <span className={styles.badge}>
                    {conversation.unreadCount}
                    {/* Read aloud, so it has to agree: "1 mensajes sin leer" is
                        the most common case there is — one message. */}
                    <span className="sr-only">
                      {conversation.unreadCount === 1 ? ' mensaje sin leer' : ' mensajes sin leer'}
                    </span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </AppScreen>
  );
}

/** Messages can be an image or an offer, which have no body to preview. */
function preview(conversation: Conversation): string {
  const last = conversation.lastMessage;
  if (!last) return 'Sin mensajes todavía';
  if (last.body?.trim()) return last.body;
  if (last.imageUrl) return 'Foto';
  if (last.offerId) return 'Oferta';
  return 'Mensaje';
}
