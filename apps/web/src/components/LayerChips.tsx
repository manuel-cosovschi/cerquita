'use client';

import type { MapLayer } from '@cerquita/types';
import styles from './LayerChips.module.css';

const LAYERS: Array<{ value: MapLayer; label: string }> = [
  { value: 'all', label: 'Todo' },
  { value: 'sales', label: 'Ventas' },
  { value: 'wanted', label: 'Busco' },
  { value: 'auctions', label: 'Subastas' },
  { value: 'stores', label: 'Tiendas' },
  { value: 'friends', label: 'Amigos' },
  { value: 'following', label: 'Siguiendo' },
  { value: 'now', label: 'Ahora' },
];

/**
 * Quick map filters (spec §12).
 *
 * A radio group rather than a row of buttons, so arrow keys move between options
 * the way assistive tech expects.
 */
export function LayerChips({
  value,
  onChange,
}: {
  value: MapLayer;
  onChange: (layer: MapLayer) => void;
}) {
  return (
    <div className={styles.row} role="radiogroup" aria-label="Filtrar el mapa">
      {LAYERS.map((layer) => (
        <button
          key={layer.value}
          type="button"
          role="radio"
          aria-checked={value === layer.value}
          className={`${styles.chip} ${value === layer.value ? styles.active : ''}`}
          onClick={() => onChange(layer.value)}
        >
          {layer.label}
        </button>
      ))}
    </div>
  );
}
