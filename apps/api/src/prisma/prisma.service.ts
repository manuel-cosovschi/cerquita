import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Prisma client wrapper.
 *
 * Also the home of the transaction helpers used by the concurrency-critical
 * paths (bids, stock, reservations). Those paths need SERIALIZABLE or explicit
 * row locks, which Prisma exposes but does not choose for you.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `work` in a SERIALIZABLE transaction, retrying on serialization
   * failures.
   *
   * Postgres raises 40001 when it cannot order two concurrent transactions; the
   * correct response is to retry, not to surface an error. Used by checkout and
   * bidding, where two clients legitimately race.
   */
  async serializable<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    { attempts = 3, timeoutMs = 10_000 }: { attempts?: number; timeoutMs?: number } = {},
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: timeoutMs,
        });
      } catch (error) {
        lastError = error;
        if (!isSerializationFailure(error) || attempt === attempts) throw error;
        // Brief jittered backoff so retries do not collide again immediately.
        await sleep(10 * attempt + Math.random() * 20);
      }
    }

    throw lastError;
  }

  /**
   * Runs `work` in a transaction that first takes an exclusive lock on one row.
   *
   * Deliberately READ COMMITTED, not SERIALIZABLE. Under SERIALIZABLE (or
   * REPEATABLE READ) the transaction's snapshot is fixed at its first statement,
   * so a re-read after `SELECT … FOR UPDATE` still returns the OLD row and the
   * caller decides on stale state. READ COMMITTED takes a fresh snapshot per
   * statement, so once the lock is released by the winner, the loser genuinely
   * sees the winner's write and can reject cleanly.
   *
   * This is the pattern behind "only one bid can win": bids serialize on the
   * auction row, and the second bidder is told its bid is below the new minimum
   * rather than colliding with a constraint.
   */
  async withRowLock<T>(
    table: string,
    id: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        const exists = await this.lockRow(tx, table, id);
        if (!exists) throw new RowNotFoundError(table, id);
        return work(tx);
      },
      { timeout: timeoutMs },
    );
  }

  /**
   * Locks a single row `FOR UPDATE` inside an existing transaction.
   *
   * Returns true when the row exists. Prefer `withRowLock`, which pairs this
   * with the correct isolation level.
   */
  async lockRow(tx: Prisma.TransactionClient, table: string, id: string): Promise<boolean> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`Refusing to lock unsafe table name: ${table}`);
    }
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "${table}" WHERE id = $1::uuid FOR UPDATE`,
      id,
    );
    return rows.length > 0;
  }
}

export class RowNotFoundError extends Error {
  constructor(
    readonly table: string,
    readonly id: string,
  ) {
    super(`${table} ${id} not found`);
  }
}

export function isSerializationFailure(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034 is Prisma's "transaction conflict / write conflict".
    if (error.code === 'P2034') return true;
  }
  const code = (error as { code?: string })?.code;
  return code === '40001' || code === '40P01';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
