import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { DomainEvent, DomainEventOf, DomainEventType } from '@cerquita/types';

type Handler<T extends DomainEventType> = (event: DomainEventOf<T>) => void | Promise<void>;

/**
 * In-process domain event bus (spec §81).
 *
 * Modules publish facts instead of calling each other, so notifications, the
 * feed, analytics and saved-search matching can all react to a sale without the
 * orders module knowing any of them exist.
 *
 * Handlers are isolated: one that throws is logged and does not prevent the
 * others from running, nor does it fail the request that published the event.
 * The transport is deliberately swappable for a real queue later — the contract
 * is the payload, not the mechanism.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly emitter = new EventEmitter({ captureRejections: true });

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  on<T extends DomainEventType>(type: T, handler: Handler<T>): void {
    this.emitter.on(type, (event: DomainEventOf<T>) => {
      void Promise.resolve(handler(event)).catch((error) => {
        this.logger.error(`Handler for ${type} failed`, error instanceof Error ? error.stack : error);
      });
    });
  }

  async publish(event: DomainEvent): Promise<void> {
    this.logger.debug(`${event.type} ${event.id}`);
    this.emitter.emit(event.type, event);
  }
}
