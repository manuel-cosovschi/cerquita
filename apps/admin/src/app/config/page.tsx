'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@cerquita/api-client';
import { Console } from '@/components/Console';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from '@/components/table.module.css';

/**
 * Platform configuration.
 *
 * Two kinds of setting, and they are separated because they carry different
 * risk. Feature flags are reversible in a click. The commission rate and the
 * search radius change what every price and every query does, so they are
 * edited in a form with an explicit save rather than toggled.
 *
 * Everything stays in the units the API uses — basis points, metres, minutes —
 * with the human reading shown alongside. A percentage field that silently
 * converts is how a 15% commission becomes 1500%.
 */
export default function ConfigPage() {
  const { user } = useSession();

  const [flags, setFlags] = useState<Record<string, boolean> | null>(null);
  const [feeBps, setFeeBps] = useState('');
  const [radiusMetres, setRadiusMetres] = useState('');
  const [reservationMinutes, setReservationMinutes] = useState('');
  const [auctionDays, setAuctionDays] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      setFlags(await api.admin.flags());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos cargar la configuración.');
      setFlags({});
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [load, user]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.admin.updateConfig(body);
      await load();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos guardar.');
    } finally {
      setBusy(false);
    }
  }

  // Only the fields that were actually filled in are sent: an empty box means
  // "leave this alone", not "set it to zero".
  function saveNumbers() {
    const body: Record<string, unknown> = {};
    if (feeBps.trim()) body.platformFeeBasisPoints = Number(feeBps);
    if (radiusMetres.trim()) body.maxSearchRadiusMeters = Number(radiusMetres);
    if (reservationMinutes.trim()) body.defaultReservationMinutes = Number(reservationMinutes);
    if (auctionDays.trim()) body.maxAuctionDurationDays = Number(auctionDays);

    if (Object.keys(body).length === 0) {
      setError('No cambiaste ningún valor.');
      return;
    }
    void patch(body);
  }

  return (
    <Console title="Configuración" subtitle="Parámetros globales y feature flags">
      {error && <p className={styles.error}>{error}</p>}
      {saved && !error && (
        <p className={styles.error} style={{ background: 'var(--color-success-subtle)', color: 'var(--color-success)' }}>
          Guardado.
        </p>
      )}

      <h2 className={styles.sectionTitle}>Parámetros</h2>
      <div className={styles.card} style={{ marginBottom: 32 }}>
        <NumberField
          id="fee"
          label="Comisión de la plataforma"
          hint="En basis points: 1000 = 10%."
          value={feeBps}
          onChange={setFeeBps}
          reading={feeBps.trim() ? `${Number(feeBps) / 100}%` : undefined}
        />
        <NumberField
          id="radius"
          label="Radio máximo de búsqueda"
          hint="En metros."
          value={radiusMetres}
          onChange={setRadiusMetres}
          reading={radiusMetres.trim() ? `${Number(radiusMetres) / 1000} km` : undefined}
        />
        <NumberField
          id="reservation"
          label="Duración de una reserva"
          hint="En minutos."
          value={reservationMinutes}
          onChange={setReservationMinutes}
        />
        <NumberField
          id="auction"
          label="Duración máxima de una subasta"
          hint="En días."
          value={auctionDays}
          onChange={setAuctionDays}
        />

        <div className={styles.actions} style={{ marginTop: 16 }}>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={busy}
            onClick={saveNumbers}
          >
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      <h2 className={styles.sectionTitle}>Feature flags</h2>
      {flags === null ? (
        <p className={styles.empty}>Cargando…</p>
      ) : Object.keys(flags).length === 0 ? (
        <p className={styles.empty}>No hay flags definidos.</p>
      ) : (
        <div className={styles.tableWrap}>
          {Object.entries(flags).map(([key, enabled]) => (
            <div key={key} className={styles.toggleRow}>
              <span className={styles.toggleLabel}>{key}</span>
              <button
                type="button"
                className={enabled ? styles.buttonPrimary : styles.button}
                disabled={busy}
                onClick={() => void patch({ featureFlags: { ...flags, [key]: !enabled } })}
              >
                {enabled ? 'Activo' : 'Inactivo'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Console>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  reading,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  reading?: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        {label}
      </label>
      <div className={styles.actions}>
        <input
          id={id}
          className={styles.reasonInput}
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={hint}
        />
        {/* The human reading of the raw value, so nobody has to divide by 100
            in their head before pressing save. */}
        {reading && (
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>= {reading}</span>
        )}
      </div>
    </div>
  );
}
