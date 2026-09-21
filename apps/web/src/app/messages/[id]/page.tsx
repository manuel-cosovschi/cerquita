'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Conversation, Message } from '@cerquita/types';
import { ApiError } from '@cerquita/api-client';
import { formatMoney, money } from '@cerquita/utils';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatClockTime, formatDayLabel } from '@/lib/time';
import styles from './page.module.css';
import { ListingImage } from '@/components/ListingImage';

/** How often the thread re-checks for messages sent by the other side. */
const POLL_MS = 8_000;

/**
 * A conversation.
 *
 * Sending is optimistic: the bubble appears immediately, greyed, and is
 * replaced by the server's message when it lands. Waiting for a round trip
 * before showing your own message makes a chat feel broken on a slow
 * connection.
 *
 * The optimistic message carries a `clientId`, which the API treats as an
 * idempotency key — so a retry after a dropped connection resolves to the
 * message already stored rather than posting it twice.
 *
 * New messages arrive by polling. The API has a socket gateway, but the
 * gateway broadcasts what the HTTP route already stored, so polling and
 * sockets agree on the same source of truth; the socket can replace the timer
 * later without changing anything else here.
 */
export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const conversationId = params.id;
  const { user, loading } = useSession();
  const router = useRouter();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');

  const threadRef = useRef<HTMLDivElement>(null);
  // Tracks whether the reader is at the bottom. Scrolling someone back down
  // while they are reading older messages is worse than missing an autoscroll.
  const stuckToBottom = useRef(true);

  const refresh = useCallback(async () => {
    const page = await api.chat.messages(conversationId);
    setMessages(page.items);
    // Anything the server now knows about stops being pending.
    setPending((current) =>
      current.filter((draft) => !page.items.some((message) => message.id === draft.id)),
    );
  }, [conversationId]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      try {
        const [thread] = await Promise.all([api.chat.conversation(conversationId), refresh()]);
        if (cancelled) return;
        setConversation(thread);
        // Opening the thread is what marks it read — not receiving the push.
        await api.chat.markRead(conversationId);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof ApiError ? cause.message : 'No pudimos abrir esta conversación.',
          );
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    const timer = setInterval(() => {
      void refresh().catch(() => {
        // A failed poll is not worth interrupting the conversation over; the
        // next tick will try again.
      });
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversationId, refresh, user]);

  useEffect(() => {
    if (!stuckToBottom.current) return;
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, pending]);

  if (loading || (!ready && user)) {
    return (
      <div className={styles.screen}>
        <p className={styles.state}>Cargando…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={styles.screen}>
        <p className={styles.state}>
          <Link href={`/login?next=${encodeURIComponent(`/messages/${conversationId}`)}`}>
            Entrá
          </Link>{' '}
          para ver esta conversación.
        </p>
      </div>
    );
  }

  if (error && !conversation) {
    return (
      <div className={styles.screen}>
        <p className={styles.state}>{error}</p>
      </div>
    );
  }

  const other =
    conversation?.participants.find((participant) => participant.id !== user.userId) ??
    conversation?.participants[0];

  // Narrowed once here so the send path does not need a non-null assertion.
  const viewerId = user.userId;

  async function send() {
    const body = draft.trim();
    if (!body) return;

    const clientId = crypto.randomUUID();
    const optimistic: Message = {
      id: clientId,
      conversationId,
      kind: 'text',
      body,
      senderId: viewerId,
      createdAt: new Date().toISOString(),
    };

    setPending((current) => [...current, optimistic]);
    setDraft('');
    setError(null);
    stuckToBottom.current = true;

    try {
      const sent = await api.chat.send(conversationId, body, clientId);
      setMessages((current) => [...current, sent]);
      setPending((current) => current.filter((message) => message.id !== clientId));
    } catch (cause) {
      // The draft comes back so nothing typed is lost.
      setPending((current) => current.filter((message) => message.id !== clientId));
      setDraft(body);
      setError(cause instanceof ApiError ? cause.message : 'No pudimos enviar el mensaje.');
    }
  }

  const timeline = [...messages, ...pending];

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.back}
          onClick={() => router.push('/messages')}
          aria-label="Volver a los chats"
        >
          ←
        </button>

        {other?.avatarUrl ? (
          <img className={styles.avatar} src={other.avatarUrl} alt="" />
        ) : (
          <span className={styles.avatar} aria-hidden="true">
            {(other?.displayName ?? '?').slice(0, 1).toUpperCase()}
          </span>
        )}

        <div className={styles.who}>
          <p className={styles.name}>{other?.displayName ?? 'Conversación'}</p>
          {other && <p className={styles.about}>@{other.username}</p>}
        </div>
      </header>

      {conversation?.listing && (
        <Link href={`/listing/${conversation.listing.id}`} className={styles.contextCard}>
          <ListingImage
            image={conversation.listing.coverImage}
            title={conversation.listing.title}
            className={styles.contextImage}
          />
          <span>
            <span className={styles.contextTitle}>{conversation.listing.title}</span>
            {conversation.listing.price && (
              <span className={styles.contextPrice}>
                {formatMoney(
                  money(
                    conversation.listing.price.effective.amount,
                    conversation.listing.price.effective.currency,
                  ),
                )}
              </span>
            )}
          </span>
        </Link>
      )}

      <div
        className={styles.thread}
        ref={threadRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          stuckToBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
      >
        {timeline.length === 0 && (
          <p className={styles.state}>
            Todavía no hay mensajes. Preguntá si sigue disponible o coordiná dónde verse.
          </p>
        )}

        {timeline.map((message, index) => {
          const previous = timeline[index - 1];
          const showDay =
            !previous || !sameDay(previous.createdAt, message.createdAt) ? message.createdAt : null;

          return (
            // The separator and the bubble are siblings in the same flex
            // column, so they share one key rather than a wrapper element.
            <Fragment key={message.id}>
              {showDay && <span className={styles.day}>{formatDayLabel(showDay)}</span>}
              <MessageBubble
                message={message}
                mine={message.senderId === viewerId}
                isPending={pending.some((draft) => draft.id === message.id)}
              />
            </Fragment>
          );
        })}
      </div>

      {/*
        Spec §46: the platform never holds the money, so it says so rather than
        implying an escrow that does not exist.
      */}
      <p className={styles.safetyNote}>
        Cerquita no retiene el pago. Coordiná un lugar público y revisá el producto antes de pagar.
      </p>

      {error && <p className={styles.error}>{error}</p>}

      <form
        className={styles.composer}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="message-body">
          Escribí un mensaje
        </label>
        <textarea
          id="message-body"
          className={styles.input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line — the convention every
            // chat uses, and the reason a plain textarea is not enough.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="Escribí un mensaje…"
          rows={1}
          maxLength={2000}
        />
        <button className={styles.send} type="submit" disabled={!draft.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  mine,
  isPending,
}: {
  message: Message;
  mine: boolean;
  isPending: boolean;
}) {
  if (message.kind === 'meeting_point') {
    return <span className={styles.meeting}>📍 Punto de encuentro propuesto</span>;
  }

  return (
    <span
      className={`${styles.bubble} ${mine ? styles.mine : styles.theirs} ${
        isPending ? styles.pending : ''
      }`}
    >
      {message.imageUrl ? (
        <img className={styles.image} src={message.imageUrl} alt="" />
      ) : (
        message.body
      )}
      <span className={styles.time}>
        {formatClockTime(message.createdAt)}
        {isPending && ' · enviando'}
      </span>
    </span>
  );
}

function sameDay(a: string, b: string): boolean {
  const left = new Date(a);
  const right = new Date(b);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
