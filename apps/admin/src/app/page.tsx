'use client';

import { useEffect, useState } from 'react';
import type { AdminDashboard } from '@cerquita/api-client';
import { formatMoney, money } from '@cerquita/utils';
import { Console } from '@/components/Console';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from '@/components/table.module.css';

/**
 * The overview.
 *
 * Queue depth first, because that is the only part of this page anyone can act
 * on. The business numbers come second: they are context, not work.
 */
export default function DashboardPage() {
  const { user } = useSession();
  const [data, setData] = useState<AdminDashboard | null>(null);

  useEffect(() => {
    if (!user) return;
    api.admin.dashboard().then(setData).catch(() => setData(null));
  }, [user]);

  return (
    <Console title="Resumen" subtitle="Estado de la plataforma">
      {!data ? (
        <p className={styles.empty}>Cargando…</p>
      ) : (
        <>
          <h2 className={styles.sectionTitle}>Pendiente</h2>
          <div className={styles.statGrid}>
            <Stat label="Denuncias abiertas" value={data.queue.openReports} />
            <Stat label="Disputas abiertas" value={data.queue.openDisputes} />
            <Stat label="Subastas en curso" value={data.queue.liveAuctions} />
          </div>

          <h2 className={styles.sectionTitle}>Comunidad</h2>
          <div className={styles.statGrid}>
            <Stat
              label="Usuarios"
              value={data.users.total}
              note={`${data.users.newLast30Days} en los últimos 30 días`}
            />
            <Stat label="Suspendidos o baneados" value={data.users.suspended} />
            <Stat label="Publicaciones activas" value={data.listings.active} />
            <Stat label="Vendidas" value={data.listings.sold} />
          </div>

          <h2 className={styles.sectionTitle}>Comercio</h2>
          <div className={styles.statGrid}>
            <Stat label="Órdenes pagas" value={data.commerce.orders} />
            <Stat
              label="Volumen"
              value={formatMoney(money(data.commerce.gmv.amount, data.commerce.gmv.currency))}
            />
            <Stat
              label="Comisiones"
              value={formatMoney(money(data.commerce.fees.amount, data.commerce.fees.currency))}
            />
            <Stat
              label="Ticket promedio"
              value={formatMoney(
                money(data.commerce.averageTicket.amount, data.commerce.averageTicket.currency),
              )}
            />
          </div>
        </>
      )}
    </Console>
  );
}

function Stat({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {note && <span className={styles.statNote}>{note}</span>}
    </div>
  );
}
