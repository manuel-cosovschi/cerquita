import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Listing } from '@cerquita/types';
import { formatMoney, money } from '@cerquita/utils';
import { serverApi } from '@/lib/api';
import { ListingDetail } from './ListingDetail';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Fetched anonymously on the server, on purpose.
 *
 * This is the copy that gets indexed and previewed in a shared link, so the
 * public price is the right one to render here — a crawler must never be shown
 * somebody's friend discount. `ListingDetail` re-fetches as the viewer once a
 * session exists.
 */
async function loadListing(id: string): Promise<Listing | null> {
  try {
    return await serverApi.listings.get(id);
  } catch {
    return null;
  }
}

/**
 * Dynamic metadata so a shared listing link previews correctly and the page is
 * indexable (spec §94).
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const listing = await loadListing(id);

  if (!listing) return { title: 'Publicación no encontrada' };

  const price = listing.price
    ? formatMoney(money(listing.price.effective.amount, listing.price.effective.currency))
    : undefined;

  return {
    title: listing.title,
    description: listing.description.slice(0, 160) || `${listing.title} en Cerquita`,
    openGraph: {
      title: price ? `${listing.title} — ${price}` : listing.title,
      description: listing.description.slice(0, 200),
      images: listing.coverImage ? [{ url: listing.coverImage.url }] : undefined,
      type: 'website',
    },
  };
}

export default async function ListingPage({ params }: PageProps) {
  const { id } = await params;
  const listing = await loadListing(id);

  if (!listing) notFound();

  return <ListingDetail initial={listing} />;
}
