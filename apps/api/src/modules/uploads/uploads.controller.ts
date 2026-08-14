import {
  BadRequestException,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  assertValidImage,
  InvalidUploadError,
  MAX_IMAGE_BYTES,
  readImageDimensions,
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../../providers/storage/storage-provider';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator';

/**
 * The shape multer hands back.
 *
 * Declared here rather than pulled in as an ambient `Express.Multer.File`: this
 * is the entire surface the endpoint touches, and a global type declaration for
 * four fields is not worth a dependency.
 */
interface UploadedImageFile {
  readonly originalname: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
  readonly size: number;
}

export interface UploadedImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Image upload (spec §59).
 *
 * Signed in only, and validated before a single byte is written: the declared
 * content type is checked against the file's actual magic bytes, because a
 * caller can relabel anything. Dimensions are read from the header rather than
 * taken from the request — the bytes already know, and the client does not need
 * to be trusted about it.
 *
 * The stored key is a fresh UUID. The uploader's filename never reaches disk:
 * it is attacker-controlled and would carry path separators, unicode tricks and
 * double extensions into the storage layer.
 */
@Controller('uploads')
export class UploadsController {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  @Post('images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  async uploadImage(
    @UploadedFile() file: UploadedImageFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UploadedImage> {
    if (!file?.buffer) {
      throw new BadRequestException({ message: 'No llegó ninguna imagen', code: 'no_file' });
    }

    try {
      assertValidImage(file.buffer, file.mimetype);
    } catch (cause) {
      if (cause instanceof InvalidUploadError) {
        throw new BadRequestException({ message: cause.message, code: 'invalid_image' });
      }
      throw cause;
    }

    const stored = await this.storage.put({
      // Namespaced by uploader so a listing's images stay traceable to whoever
      // put them there when something has to be moderated.
      key: `uploads/${user.userId}/${randomUUID()}${safeExtension(file.originalname, file.mimetype)}`,
      body: file.buffer,
      contentType: file.mimetype,
    });

    // A format we cannot measure without decoding still uploads; the fallback
    // is a square, which is what the card layout assumes anyway.
    const dimensions = readImageDimensions(file.buffer) ?? { width: 1080, height: 1080 };

    return { url: stored.url, width: dimensions.width, height: dimensions.height };
  }
}

/**
 * Picks the extension from the CONTENT TYPE, using the original name only to
 * distinguish jpg from jpeg. The uploaded filename is never trusted for
 * anything that reaches the filesystem.
 */
function safeExtension(originalName: string, contentType: string): string {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/avif') return '.avif';
  return extname(originalName).toLowerCase() === '.jpeg' ? '.jpeg' : '.jpg';
}
