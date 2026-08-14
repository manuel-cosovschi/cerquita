/**
 * Object storage abstraction (spec §43 storage, §59, §89).
 *
 * S3-compatible in shape, with a local-disk implementation for development so
 * image upload works with no cloud credentials.
 */
export interface UploadInput {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
}

export interface StoredObject {
  readonly key: string;
  readonly url: string;
  readonly size: number;
}

export interface StorageProvider {
  readonly name: string;
  put(input: UploadInput): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  urlFor(key: string): string;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

/** Image constraints enforced before anything is written (spec §59). */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class InvalidUploadError extends Error {}

/**
 * Validates an upload by its declared type AND its magic bytes.
 *
 * Trusting `content-type` alone would let a caller upload anything by relabeling
 * it, so the header is checked against what the bytes actually are.
 */
export function assertValidImage(buffer: Buffer, contentType: string): void {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType)) {
    throw new InvalidUploadError(`Formato no permitido: ${contentType}`);
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new InvalidUploadError('La imagen supera los 10 MB');
  }
  if (buffer.byteLength < 64) {
    throw new InvalidUploadError('El archivo está vacío o corrupto');
  }

  const detected = detectImageType(buffer);
  if (!detected) {
    throw new InvalidUploadError('El archivo no es una imagen válida');
  }
  if (detected !== contentType) {
    throw new InvalidUploadError(
      `El contenido del archivo (${detected}) no coincide con el tipo declarado`,
    );
  }
}

/** Sniffs the file signature. Returns undefined when it is not a supported image. */
export function detectImageType(buffer: Buffer): string | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF') {
    if (buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return undefined;
}
