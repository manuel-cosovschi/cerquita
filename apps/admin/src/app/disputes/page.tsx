'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, type AdminDispute } from '@cerquita/api-client';
import { formatMoney, fromMajorUnits, money } from '@cerquita/utils';
import { Console } from '@/components/Console';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatRelativeTime } from '@/lib/time';
import styles from '@/components/table.module.css';

type Resolution = 'resolved_buyer' | 'resolved_seller' | 'partial' | 'closed';

const RESOLUTIONS: ReadonlyArray<{ id: Resolution; label: string }> = [
  { id: 'resolved_buyer', label: 'A favor del comprador' },
  { id: 'resolved_seller', label: 'A favor del vendedor' },
  { id: 'partial', label: 'Parcial' },
  { id: 'closed', label: 'Cerrar sin acción' },
];

/**
 * The dispute queue.
 *
 * A refund amount is asked for only on a partial resolution, because that is
 * the only outcome where the number is a judgement rather than a consequence:
 * "a favor del comprador" refunds the order, and letting a moderator type a
 * different figure next to that label would make the label a lie.
 */
export default function DisputesPage() {
  const { user } = useSession();
  const [disputes, setDisputes] = useState<AdminDispute[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDisputes(await api.admin.disputes());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos cargar las disputas.');
      setDisputes([]);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [load, user]);

  return (
    <Console title="Disputas" subtitle="Órdenes en conflicto, más antiguas primero">
      {error && <p className={styles.error}>{error}</p>}

      {disputes === null ? (
        <p className={styles.empty}>Cargando…</p>
      ) : disputes.length === 0 ? (
        <p className={styles.empty}>No hay disputas abiertas.</p>
      ) : (
        <div className={styles.cards}>
          {disputes.map((dispute) => (
            <DisputeCard key={dispute.id} dispute={dispute} onDone={load} onError={setError} />
          ))}
        </div>
      )}
    </Console>
  );
}

function DisputeCard({
  dispute,
  onDone,
  onError,
}: {
  dispute: AdminDispute;
  onDone: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [resolution, setResolution] = useState<Resolution>('resolved_buyer');
  const [refund, setRefund] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const currency = dispute.order?.currency ?? 'ARS';
  const needsAmount = resolution === 'partial';
  const canSubmit = reason.trim().length >= 3 && (!needsAmount || refund.trim().length > 0);

  async function submit() {
    setBusy(true);
    try {
      await api.admin.resolveDispute(dispute.id, {
        resolution,
        reason: reason.trim(),
        // Typed in pesos, sent in minor units — the same rule as everywhere else.
        refundAmount: needsAmount
          ? fromMajorUnits(refund.replace(',', '.'), currency)
          : undefined,
      });
      await onDone();
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'No pudimos resolver la disputa.');
      setBusy(false);
    }
  }

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.kind}>
          Orden {dispute.order?.reference ?? dispute.orderId.slice(0, 8)} · {dispute.status}
        </span>
        <span className={styles.when}>{formatRelativeTime(dispute.createdAt)}</span>
      </div>

      <p className={styles.reason}>{dispute.reason}</p>

      <div className={styles.meta}>
        {dispute.order && (
          <span>Total {formatMoney(money(dispute.order.total, dispute.order.currency))}</span>
        )}
        <span className={styles.id}>{dispute.orderId}</span>
        {dispute.evidence && dispute.evidence.length > 0 && (
          <span>
            {dispute.evidence.length} archivo{dispute.evidence.length === 1 ? '' : 's'} de evidencia
          </span>
        )}
      </div>

      <div className={styles.actions}>
        <label className="sr-only" htmlFor={`resolution-${dispute.id}`}>
          Resolución
        </label>
        <select
          id={`resolution-${dispute.id}`}
          className={styles.reasonInput}
          value={resolution}
          onChange={(event) => setResolution(event.target.value as Resolution)}
        >
          {RESOLUTIONS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>

        {needsAmount && (
          <>
            <label className="sr-only" htmlFor={`refund-${dispute.id}`}>
              Monto a reembolsar
            </label>
            <input
              id={`refund-${dispute.id}`}
              className={styles.reasonInput}
              inputMode="decimal"
              value={refund}
              onChange={(event) => setRefund(event.target.value)}
              placeholder="Monto a reembolsar"
            />
          </>
        )}

        <label className="sr-only" htmlFor={`dispute-reason-${dispute.id}`}>
          Fundamento
        </label>
        <input
          id={`dispute-reason-${dispute.id}`}
          className={styles.reasonInput}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Fundamento (queda en auditoría)"
          maxLength={1000}
        />

        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={busy || !canSubmit}
          onClick={() => void submit()}
        >
          {busy ? 'Resolviendo…' : 'Resolver'}
        </button>
      </div>
    </article>
  );
}
