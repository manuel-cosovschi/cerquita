import { Injectable, Logger } from '@nestjs/common';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import type { StorageProvider, StoredObject, UploadInput } from './storage-provider';

/**
 * Writes uploads to a directory on disk and serves them from a static route.
 *
 * Development only. Keys are validated against path traversal before being
 * joined onto the storage root — an unchecked key like `../../etc/passwd` would
 * otherwise let a caller write outside the directory.
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly publicBaseUrl: string,
  ) {
    this.root = resolve(rootDir);
  }

  async put(input: UploadInput): Promise<StoredObject> {
    const target = this.resolveKey(input.key);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.body);
    this.logger.debug(`Stored ${input.key} (${input.body.byteLength} bytes)`);

    return { key: input.key, url: this.urlFor(input.key), size: input.body.byteLength };
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  urlFor(key: string): string {
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
  }

  /** Rejects any key that would escape the storage root. */
  private resolveKey(key: string): string {
    const cleaned = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    const target = resolve(join(this.root, cleaned));

    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error(`Refusing to write outside the storage root: ${key}`);
    }
    return target;
  }
}
