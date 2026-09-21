'use client';

import { useRef, useState } from 'react';
import { ApiError } from '@cerquita/api-client';
import { api } from '@/lib/api';
import styles from './PhotoUploader.module.css';

export interface UploadedPhoto {
  url: string;
  width: number;
  height: number;
}

/** The API caps a listing at twelve images. */
const MAX_PHOTOS = 12;

/**
 * Photos for the publish form.
 *
 * Each file is uploaded as it is picked rather than held until submit: on a
 * phone connection a listing with eight photos would otherwise sit on a spinner
 * for a minute at the exact moment the seller is deciding whether this was
 * worth the effort.
 *
 * Dimensions come back from the server, which reads them out of the file — the
 * client never declares how big its own upload is.
 */
export function PhotoUploader({
  photos,
  onChange,
}: {
  photos: UploadedPhoto[];
  onChange: (photos: UploadedPhoto[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const room = MAX_PHOTOS - photos.length;

  async function accept(files: FileList | null) {
    if (!files?.length) return;

    const chosen = Array.from(files).slice(0, room);
    setUploading(chosen.length);
    setError(null);

    // Sequential, not parallel: a phone uploading eight photos at once on a bad
    // connection gets eight slow requests instead of one fast one.
    const uploaded: UploadedPhoto[] = [];
    for (const file of chosen) {
      try {
        uploaded.push(await api.uploads.image(file));
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'No pudimos subir una de las fotos.');
        break;
      } finally {
        setUploading((current) => current - 1);
      }
    }

    if (uploaded.length > 0) onChange([...photos, ...uploaded]);
    // Cleared so picking the same file again still fires a change event.
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div>
      <div className={styles.grid}>
        {photos.map((photo, index) => (
          <div key={photo.url} className={styles.tile}>
            <img className={styles.image} src={photo.url} alt="" />
            {index === 0 && <span className={styles.cover}>Portada</span>}
            <button
              type="button"
              className={styles.removeButton}
              onClick={() => onChange(photos.filter((entry) => entry.url !== photo.url))}
              aria-label="Quitar esta foto"
            >
              ×
            </button>
          </div>
        ))}

        {Array.from({ length: uploading }, (_, index) => (
          <div key={`uploading-${index}`} className={styles.tile}>
            <span className={styles.uploading}>Subiendo…</span>
          </div>
        ))}

        <button
          type="button"
          className={styles.add}
          onClick={() => inputRef.current?.click()}
          disabled={room <= 0}
        >
          <span className={styles.addIcon} aria-hidden="true">
            +
          </span>
          {room > 0 ? 'Agregar foto' : 'Máximo 12'}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        hidden
        onChange={(event) => void accept(event.target.files)}
      />

      {error && <p className={styles.error}>{error}</p>}
      <p className={styles.hint}>
        La primera foto es la portada: es la que se ve en el mapa y en los resultados.
      </p>
    </div>
  );
}
