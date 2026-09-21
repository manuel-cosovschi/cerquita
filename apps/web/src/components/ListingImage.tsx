'use client';

import { useState } from 'react';
import type { ImageAsset } from '@cerquita/types';

export interface ListingImageProps {
  image?: ImageAsset;
  /** Used as alt text when the image carries none of its own. */
  title: string;
  className?: string;
  /** Applied to the stand-in when there is no image, or it fails to load. */
  fallbackClassName?: string;
  /** What the stand-in says. Empty renders a plain block, which some rows want. */
  fallbackLabel?: string;
}

/**
 * A listing's photo, or something sensible when there isn't one.
 *
 * The "isn't one" case covers more than a listing published without photos. A
 * marketplace serves images somebody else uploaded to somewhere else: hosts go
 * away, files get deleted, links rot. Without this the browser draws its broken
 * image glyph, which looks like the app is broken rather than the photo.
 *
 * `onError` fires once per source, so a failing URL settles into the stand-in
 * instead of retrying.
 */
export function ListingImage({
  image,
  title,
  className,
  fallbackClassName,
  fallbackLabel,
}: ListingImageProps) {
  const [failed, setFailed] = useState(false);

  if (!image || failed) {
    return (
      <span className={fallbackClassName ?? className} aria-hidden="true">
        {fallbackLabel}
      </span>
    );
  }

  return (
    <img
      src={image.url}
      alt={image.alt ?? title}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
