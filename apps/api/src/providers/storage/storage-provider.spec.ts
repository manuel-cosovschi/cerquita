import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import {
  assertValidImage,
  detectImageType,
  InvalidUploadError,
  readImageDimensions,
} from './storage-provider';

/**
 * These parse binary headers by hand, which is the kind of code that is either
 * right or silently wrong. Fixtures are built here rather than committed as
 * binaries so the bytes under test are visible in the test.
 */

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour

  const raw = Buffer.concat(
    Array.from({ length: height }, () =>
      Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]),
    ),
  );

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A JPEG with one skippable APP0 segment before the SOF0, so the test actually
 * exercises the marker walk rather than a fixed offset.
 */
function jpeg(width: number, height: number): Buffer {
  const app0Payload = Buffer.alloc(14, 0);
  const app0Length = Buffer.alloc(2);
  app0Length.writeUInt16BE(app0Payload.length + 2);

  const sof = Buffer.alloc(8);
  sof.writeUInt16BE(11, 0); // segment length
  sof[2] = 8; // precision
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  sof[7] = 1; // component count

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    Buffer.from([0xff, 0xe0]),
    app0Length,
    app0Payload,
    Buffer.from([0xff, 0xc0]), // SOF0
    sof,
    Buffer.alloc(40, 0), // padding so the file clears the minimum size
  ]);
}

function riff(format: string, payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length + 4);
  return Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    size,
    Buffer.from('WEBP', 'ascii'),
    Buffer.from(format, 'ascii'),
    payload,
  ]);
}

/** Lossless WebP: both dimensions minus one, 14 bits each, little-endian. */
function webpLossless(width: number, height: number): Buffer {
  const body = Buffer.alloc(64, 0);
  body.writeUInt32LE(4, 0); // chunk size
  body[4] = 0x2f; // signature byte
  body.writeUInt32LE((width - 1) | ((height - 1) << 14), 5);
  return riff('VP8L', body);
}

/**
 * Extended WebP. After the chunk size come one flags byte and three reserved
 * bytes, then the canvas size as two 24-bit little-endian values, both minus
 * one — absolute offsets 24 and 27.
 */
function webpExtended(width: number, height: number): Buffer {
  const body = Buffer.alloc(64, 0);
  body.writeUInt32LE(10, 0); // chunk size      → absolute 16
  body[4] = 0; // flags                          → absolute 20
  body.writeUIntLE(width - 1, 8, 3); //          → absolute 24
  body.writeUIntLE(height - 1, 11, 3); //        → absolute 27
  return riff('VP8X', body);
}

/**
 * Lossy WebP. The 14-bit dimensions sit at absolute 26 and 28, behind the frame
 * tag and the three-byte sync code.
 */
function webpLossy(width: number, height: number): Buffer {
  const body = Buffer.alloc(64, 0);
  body.writeUInt32LE(20, 0); // chunk size       → absolute 16
  body[7] = 0x9d; //  sync code                  → absolute 23
  body[8] = 0x01;
  body[9] = 0x2a;
  body.writeUInt16LE(width, 10); //              → absolute 26
  body.writeUInt16LE(height, 12); //             → absolute 28
  return riff('VP8 ', body);
}

describe('detectImageType', () => {
  it('recognises each supported format from its signature', () => {
    expect(detectImageType(png(4, 4))).toBe('image/png');
    expect(detectImageType(jpeg(4, 4))).toBe('image/jpeg');
    expect(detectImageType(webpLossless(4, 4))).toBe('image/webp');
  });

  it('does not mistake arbitrary bytes for an image', () => {
    expect(detectImageType(Buffer.from('#!/bin/sh\necho hola\n'.repeat(8)))).toBeUndefined();
  });
});

describe('readImageDimensions', () => {
  it('reads PNG dimensions from IHDR', () => {
    expect(readImageDimensions(png(320, 180))).toEqual({ width: 320, height: 180 });
  });

  it('walks JPEG markers past a segment it does not care about', () => {
    // The SOF is not at a fixed offset — an APP0 sits in front of it here, and
    // reading a constant position would return the JFIF header as a size.
    expect(readImageDimensions(jpeg(1200, 900))).toEqual({ width: 1200, height: 900 });
  });

  it('reads lossless WebP, where both dimensions are stored minus one', () => {
    expect(readImageDimensions(webpLossless(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it('reads lossy WebP', () => {
    expect(readImageDimensions(webpLossy(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it('reads extended WebP', () => {
    expect(readImageDimensions(webpExtended(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it('returns undefined rather than guessing when it cannot read the header', () => {
    expect(readImageDimensions(Buffer.alloc(200, 7))).toBeUndefined();
  });
});

describe('assertValidImage', () => {
  it('accepts a real image of the declared type', () => {
    expect(() => assertValidImage(png(8, 8), 'image/png')).not.toThrow();
  });

  it('rejects a file whose bytes disagree with its declared type', () => {
    // The whole point: content-type is caller-controlled, so relabelling a PNG
    // as a JPEG must not get it past the check.
    expect(() => assertValidImage(png(8, 8), 'image/jpeg')).toThrow(InvalidUploadError);
  });

  it('rejects a format that is not an image at all', () => {
    const script = Buffer.from('#!/bin/sh\necho pwned\n'.repeat(8));
    expect(() => assertValidImage(script, 'image/png')).toThrow(InvalidUploadError);
  });

  it('rejects a type outside the allow-list even when the bytes match', () => {
    expect(() => assertValidImage(png(8, 8), 'image/gif')).toThrow(InvalidUploadError);
  });

  it('rejects a file too small to be a real image', () => {
    expect(() => assertValidImage(Buffer.alloc(10), 'image/png')).toThrow(InvalidUploadError);
  });
});
