'use client';

import { useEffect, useState } from 'react';
import type { AuditEntry } from '@cerquita/api-client';
import { Console } from '@/components/Console';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from '@/components/table.module.css';

/**
 * The audit log.
 *
 * Read-only by construction: there is no endpoint to edit or delete an entry,
 * and there should not be. A log a moderator can amend is not evidence.
 */
export default function AuditPage() {
  const { user } = useSession();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!user) return;
    api.admin
      .auditLog(filter.trim() || undefined)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [user, filter]);

  return (
    <Console title="Auditoría" subtitle="Cada acción de moderación, con quién y por qué">
      <div className={styles.actions} style={{ marginBottom: 20 }}>
        <label className="sr-only" htmlFor="target">
          Filtrar por id
        </label>
        <input
          id="target"
          className={styles.reasonInput}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filtrar por id del objetivo"
        />
      </div>

      {entries === null ? (
        <p className={styles.empty}>Cargando…</p>
      ) : entries.length === 0 ? (
        <p className={styles.empty}>Sin registros.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>Quién</th>
                <th>Acción</th>
                <th>Objetivo</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono">{new Date(entry.createdAt).toLocaleString('es-AR')}</td>
                  <td>@{entry.admin.username}</td>
                  <td>{entry.action}</td>
                  <td>
                    <span className={styles.id}>{entry.targetId}</span>
                    <br />
                    {entry.targetType}
                  </td>
                  <td>{entry.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Console>
  );
}
