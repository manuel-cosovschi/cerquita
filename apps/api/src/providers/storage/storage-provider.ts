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

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * Reads an image's pixel dimensions from its header.
 *
 * The alternative is to let the client tell us how big its own upload is, and
 * those numbers end up in `<img width height>` on every listing card. A wrong
 * value only costs a layout shift, but the bytes already say the truth and we
 * are already parsing them to sniff the type.
 *
 * Returns undefined when the format is one we cannot read without decoding
 * (some AVIF layouts); the caller falls back rather than rejecting the upload.
 */
export function readImageDimensions(buffer: Buffer): ImageDimensions | undefined {
  const type = detectImageType(buffer);
  if (type === 'image/png') return readPngDimensions(buffer);
  if (type === 'image/jpeg') return readJpegDimensions(buffer);
  if (type === 'image/webp') return readWebpDimensions(buffer);
  return undefined;
}

/** IHDR is always the first chunk, at a fixed offset. */
function readPngDimensions(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Walks the JPEG marker chain to the Start Of Frame, which is the only segment
 * that carries the dimensions. Everything before it is skipped by its own
 * declared length.
 */
function readJpegDimensions(buffer: Buffer): ImageDimensions | undefined {
  let offset = 2; // past SOI

  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return undefined;

    const marker = buffer[offset + 1];
    if (marker === undefined) return undefined;

    // SOF0..SOF15, excluding the DHT/JPG/DAC markers that share the range.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isStartOfFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) return undefined;
    offset += 2 + segmentLength;
  }

  return undefined;
}

/** WebP has three container variants and each stores the size differently. */
function readWebpDimensions(buffer: Buffer): ImageDimensions | undefined {
  const format = buffer.toString('ascii', 12, 16);

  if (format === 'VP8 ' && buffer.length >= 30) {
    // Lossy: 14 bits each, after the 3-byte start code.
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (format === 'VP8L' && buffer.length >= 25) {
    // Lossless: 14 bits each, packed across four bytes, both minus one.
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }

  if (format === 'VP8X' && buffer.length >= 30) {
    // Extended: 24-bit little-endian, both minus one.
    const width = buffer.readUIntLE(24, 3) + 1;
    const height = buffer.readUIntLE(27, 3) + 1;
    return { width, height };
  }

  return undefined;
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
