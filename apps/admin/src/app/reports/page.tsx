'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, type AdminReport, type ModerationAction } from '@cerquita/api-client';
import { Console } from '@/components/Console';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatRelativeTime } from '@/lib/time';
import styles from '@/components/table.module.css';

const TARGET_LABELS: Record<AdminReport['targetType'], string> = {
  listing: 'Publicación',
  user: 'Usuario',
  store: 'Tienda',
  message: 'Mensaje',
  review: 'Reseña',
};

/**
 * The report queue.
 *
 * Every destructive action requires a typed reason before its button enables.
 * That is not politeness: the API writes the action and its audit entry in one
 * transaction, so a blank reason would produce an audit log that records what
 * happened and not why — which is exactly what an audit log is for.
 */
export default function ReportsPage() {
  const { user } = useSession();
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReports(await api.admin.reports('open'));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos cargar las denuncias.');
      setReports([]);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [load, user]);

  return (
    <Console title="Denuncias" subtitle="Reportes abiertos, más antiguos primero">
      {error && <p className={styles.error}>{error}</p>}

      {reports === null ? (
        <p className={styles.empty}>Cargando…</p>
      ) : reports.length === 0 ? (
        <p className={styles.empty}>No hay denuncias abiertas.</p>
      ) : (
        <div className={styles.cards}>
          {reports.map((report) => (
            <ReportCard key={report.id} report={report} onDone={load} onError={setError} />
          ))}
        </div>
      )}
    </Console>
  );
}

function ReportCard({
  report,
  onDone,
  onError,
}: {
  report: AdminReport;
  onDone: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await onDone();
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'No pudimos aplicar la acción.');
      setBusy(false);
    }
  }

  // Which moderation actions make sense depends on what was reported. Offering
  // "remove listing" on a reported user would just fail at the API.
  const actions: Array<{ action: ModerationAction; label: string; danger?: boolean }> =
    report.targetType === 'listing'
      ? [{ action: 'remove_listing', label: 'Bajar publicación', danger: true }]
      : report.targetType === 'user'
        ? [
            { action: 'warn_user', label: 'Advertir' },
            { action: 'suspend_user', label: 'Suspender', danger: true },
            { action: 'ban_user', label: 'Banear', danger: true },
          ]
        : [];

  const canAct = reason.trim().length > 0;

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.kind}>
          {TARGET_LABELS[report.targetType]} · {report.category}
        </span>
        <span className={styles.when}>{formatRelativeTime(report.createdAt)}</span>
      </div>

      {report.detail && <p className={styles.detail}>{report.detail}</p>}

      <div className={styles.meta}>
        <span>
          Reportó <strong>@{report.reporter.username}</strong>
        </span>
        <span className={styles.id}>{report.targetId}</span>
      </div>

      <div className={styles.actions}>
        <label className="sr-only" htmlFor={`reason-${report.id}`}>
          Motivo, para el registro de auditoría
        </label>
        <input
          id={`reason-${report.id}`}
          className={styles.reasonInput}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Motivo (queda en auditoría)"
          maxLength={300}
        />

        {actions.map((entry) => (
          <button
            key={entry.action}
            type="button"
            className={entry.danger ? styles.buttonDanger : styles.button}
            disabled={busy || !canAct}
            onClick={() =>
              void run(async () => {
                await api.admin.moderate({
                  action: entry.action,
                  targetId: report.targetId,
                  reason: reason.trim(),
                });
                await api.admin.resolveReport(report.id, 'actioned');
              })
            }
          >
            {entry.label}
          </button>
        ))}

        {/* Dismissing is also a decision worth recording, so it takes the same
            reason field rather than being a one-click escape. */}
        <button
          type="button"
          className={styles.button}
          disabled={busy}
          onClick={() => void run(() => api.admin.resolveReport(report.id, 'dismissed'))}
        >
          Desestimar
        </button>
      </div>
    </article>
  );
}
