'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, type ListingComment } from '@cerquita/api-client';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from './Comments.module.css';

/**
 * Comments on a listing — direction 1c's trust mechanism.
 *
 * These are public references, not a chat: "Nacho: doy fe, la vi funcionando"
 * is worth more to a stranger than any badge. Each author carries their social
 * proof relative to the viewer, so a vouch from someone you actually know reads
 * differently from one from a stranger. That distinction is the entire point.
 */
export function Comments({ listingId, count }: { listingId: string; count: number }) {
  const { user } = useSession();
  const pathname = usePathname();

  const [comments, setComments] = useState<ListingComment[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Held locally so the count reacts to posting and does not disagree with the
  // list on screen — the server value is only the starting point.
  const [total, setTotal] = useState(count);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api.comments
      .list(listingId)
      .then((result) => {
        if (!cancelled) setComments(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
    // Re-fetching when the viewer changes matters: social proof is resolved per
    // viewer, so the same thread reads differently after logging in.
  }, [listingId, user?.userId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);

    try {
      const created = await api.comments.create(listingId, body);
      setComments((current) => [...(current ?? []), created]);
      setTotal((current) => current + 1);
      setDraft('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos publicar tu comentario.');
    } finally {
      setSending(false);
    }
  }

  if (failed) return null;

  return (
    <section aria-label="Comentarios">
      <h2 className={styles.heading}>
        {total > 0 ? `${total} comentario${total === 1 ? '' : 's'}` : 'Comentarios'}
      </h2>

      {comments === null && <p className={styles.loading}>Cargando…</p>}

      {comments?.length === 0 && (
        <p className={styles.empty}>
          Todavía no hay comentarios. Preguntá lo que quieras saber — la respuesta la ve todo el
          mundo.
        </p>
      )}

      {comments && comments.length > 0 && (
        <ul className={styles.list}>
          {comments.map((comment) => (
            <li key={comment.id} className={styles.item}>
              <span className={styles.avatar} aria-hidden="true">
                {comment.author.displayName.slice(0, 1)}
              </span>
              <span className={styles.body}>
                <span className={styles.head}>
                  <b className={styles.name}>{comment.author.displayName}</b>
                  {/* The reference, right where it does its work. */}
                  {comment.socialProof && (
                    <span className={styles.proof}>{comment.socialProof}</span>
                  )}
                </span>
                <span className={styles.text}>{comment.body}</span>

                {comment.replies && comment.replies.length > 0 && (
                  <ul className={styles.replies}>
                    {comment.replies.map((reply) => (
                      <li key={reply.id} className={styles.reply}>
                        <b className={styles.name}>{reply.author.displayName}</b> {reply.body}
                      </li>
                    ))}
                  </ul>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {user ? (
        <form className={styles.composer} onSubmit={submit}>
          <label className="sr-only" htmlFor="comment-body">
            Escribí un comentario
          </label>
          <textarea
            id="comment-body"
            className={styles.input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Preguntá algo…"
            rows={1}
            maxLength={1000}
          />
          <button className={styles.send} type="submit" disabled={sending || !draft.trim()}>
            {sending ? '…' : 'Enviar'}
          </button>
        </form>
      ) : (
        <p className={styles.signedOut}>
          <Link
            className={styles.signedOutLink}
            href={`/login?next=${encodeURIComponent(pathname)}`}
          >
            Entrá
          </Link>{' '}
          para preguntar algo sobre esta publicación.
        </p>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
