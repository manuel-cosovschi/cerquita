/**
 * Shared Zod primitives.
 *
 * These schemas are the contract boundary: the API validates every request body
 * and query string against them, and the clients reuse the same schemas for form
 * validation, so a rule is written once (spec §85).
 */

import { z } from 'zod';
import {
  AUDIENCE_TIERS,
  DELIVERY_METHODS,
  ITEM_CONDITIONS,
  LISTING_KINDS,
  LISTING_STATUSES,
  MAP_LAYERS,
  SEARCH_SORTS,
} from '@cerquita/types';

export const uuidSchema = z.string().uuid();

export const currencySchema = z.enum(['ARS', 'USD', 'EUR', 'BRL', 'UYU', 'CLP']);

/**
 * Money on the wire. `amount` is integer minor units — the schema rejects
 * decimals outright rather than silently rounding a float someone sent.
 */
export const moneySchema = z.object({
  amount: z.number().int().safe(),
  currency: currencySchema,
});

export const positiveMoneySchema = moneySchema.refine((value) => value.amount > 0, {
  message: 'El monto debe ser mayor a cero',
});

export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** `minLng,minLat,maxLng,maxLat`, validated for ordering as well as shape. */
export const bboxSchema = z.string().transform((value, ctx) => {
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'bbox debe tener el formato minLng,minLat,maxLng,maxLat',
    });
    return z.NEVER;
  }
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
  if (minLat > maxLat || minLng > maxLng) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bbox invertido' });
    return z.NEVER;
  }
  if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bbox fuera de rango' });
    return z.NEVER;
  }
  return { minLng, minLat, maxLng, maxLat };
});

/** Percentages are integers in basis points everywhere. */
export const basisPointsSchema = z.number().int().min(0).max(10_000);

export const listingKindSchema = z.enum(LISTING_KINDS);
export const listingStatusSchema = z.enum(LISTING_STATUSES);
export const itemConditionSchema = z.enum(ITEM_CONDITIONS);
export const deliveryMethodSchema = z.enum(DELIVERY_METHODS);
export const audienceTierSchema = z.enum(AUDIENCE_TIERS);
export const mapLayerSchema = z.enum(MAP_LAYERS);
export const searchSortSchema = z.enum(SEARCH_SORTS);

/** Cursor pagination. Offset pagination is deliberately not offered — it drifts. */
export const paginationSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const usernameSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9][a-z0-9_.]*[a-z0-9]$/, 'Solo minúsculas, números, punto y guion bajo')
  .refine((value) => !value.includes('..'), 'No se permiten puntos consecutivos');

export const storeHandleSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Solo minúsculas, números y guiones')
  .refine((value) => !value.includes('--'), 'No se permiten guiones consecutivos');

export const passwordSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(200);

export const emailSchema = z.string().email().max(320).toLowerCase();

/** Radius in metres, bounded so a query cannot ask for the whole planet. */
export const radiusMetersSchema = z.coerce.number().int().min(100).max(200_000);

export type Pagination = z.infer<typeof paginationSchema>;
export type BoundingBoxInput = z.infer<typeof bboxSchema>;
