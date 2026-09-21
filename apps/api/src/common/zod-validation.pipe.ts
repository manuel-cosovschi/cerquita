import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Schemas are typed by their OUTPUT only. Several of ours transform their input
 * (`bbox` parses a string into an object, `sort` fills in a default), so pinning
 * the input type as well would reject exactly the schemas that need the pipe.
 */
type AnyInputSchema<Output> = ZodType<Output, ZodTypeDef, unknown>;

/**
 * Validates a request payload against a shared Zod schema.
 *
 * The parsed (and coerced) value replaces the raw input, so a handler receives
 * exactly the declared type and nothing else — extra keys a client tried to
 * smuggle in are dropped rather than passed through to Prisma.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: AnyInputSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        message: 'Revisá los datos enviados',
        code: 'validation_error',
        issues: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return result.data;
  }
}

export const zodBody = <T>(schema: AnyInputSchema<T>) => new ZodValidationPipe(schema);
