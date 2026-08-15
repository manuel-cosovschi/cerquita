'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Order, OrderStatus } from '@cerquita/types';
import { ApiError } from '@cerquita/api-client';
import { formatMoney, money } from '@cerquita/utils';
import { AppScreen } from '@/components/AppScreen';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from './page.module.css';

/**
 * An order.
 *
 * Deliberately not called "compra exitosa". Cerquita does not hold the money or
 * move the item (spec §46), so what exists at this point is an agreement
 * between two people — the screen says what still has to happen and puts the
 * chat one tap away, rather than implying the platform has it handled.
 */
export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const { user, loading } = useSession();
  const router = useRouter();

  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    api.checkout
      .order(orderId)
      .then((result) => {
        if (!cancelled) setOrder(result);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : 'No pudimos cargar este pedido.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [orderId, user]);

  if (loading) {
    return (
      <AppScreen title="Pedido" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (!user) {
    return (
      <AppScreen title="Pedido" active="profile">
        <p className={styles.state}>
          <Link href={`/login?next=${encodeURIComponent(`/order/${orderId}`)}`}>Entrá</Link> para
          ver este pedido.
        </p>
      </AppScreen>
    );
  }

  if (error) {
    return (
      <AppScreen title="Pedido" active="profile">
        <p className={styles.state}>{error}</p>
      </AppScreen>
    );
  }

  if (!order) {
    return (
      <AppScreen title="Pedido" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  const counterpart = user.userId === order.buyer.id ? order.seller : order.buyer;

  async function openChat() {
    setOpening(true);
    try {
      const conversation = await api.chat.open({ recipientId: counterpart.id });
      router.push(`/messages/${conversation.id}`);
    } catch {
      setError('No pudimos abrir el chat.');
      setOpening(false);
    }
  }

  return (
    <AppScreen title="Pedido" active="profile">
      <span className={styles.badge}>{statusLabel(order.status)}</span>
      <p className={styles.reference}>#{order.reference}</p>

      <ul className={styles.items}>
        {order.items.map((item) => (
          <li key={item.id} className={styles.item}>
            {item.imageUrlSnapshot ? (
              <img className={styles.thumb} src={item.imageUrlSnapshot} alt="" />
            ) : (
              <span className={styles.thumb} aria-hidden="true" />
            )}
            <div className={styles.itemBody}>
              {/* Snapshots, not the live listing: what was bought must not
                  change because the seller edited the title afterwards. */}
              <p className={styles.itemTitle}>{item.titleSnapshot}</p>
              <p className={styles.itemMeta}>
                {item.quantity} ×{' '}
                {formatMoney(money(item.unitPriceSnapshot.amount, item.unitPriceSnapshot.currency))}
              </p>
            </div>
            <span className={styles.lineTotal}>
              {formatMoney(money(item.lineTotal.amount, item.lineTotal.currency))}
            </span>
          </li>
        ))}
      </ul>

      {/*
        `subtotal` is already net of the social discount, so the saving is
        reported after the total rather than as a subtraction line — otherwise
        the three numbers do not add up on screen.
      */}
      <div className={styles.totals}>
        <div className={styles.totalRow}>
          <span>Productos</span>
          <span>{formatMoney(money(order.subtotal.amount, order.subtotal.currency))}</span>
        </div>
        {order.shippingTotal.amount > 0 && (
          <div className={styles.totalRow}>
            <span>Envío</span>
            <span>
              {formatMoney(money(order.shippingTotal.amount, order.shippingTotal.currency))}
            </span>
          </div>
        )}
        <div className={`${styles.totalRow} ${styles.grandRow}`}>
          <span>Total</span>
          <span>{formatMoney(money(order.total.amount, order.total.currency))}</span>
        </div>
        {order.discountTotal.amount > 0 && (
          <div className={`${styles.totalRow} ${styles.discountRow}`}>
            <span>Ahorraste</span>
            <span>
              {formatMoney(money(order.discountTotal.amount, order.discountTotal.currency))}
            </span>
          </div>
        )}
      </div>

      <section className={styles.next}>
        <h2 className={styles.nextTitle}>Qué sigue</h2>
        <p className={styles.nextBody}>{nextStep(order)}</p>
      </section>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => void openChat()}
          disabled={opening}
        >
          {opening ? 'Abriendo…' : `Hablar con ${counterpart.displayName}`}
        </button>
        <Link href="/" className={styles.secondary}>
          Volver al mapa
        </Link>
      </div>
    </AppScreen>
  );
}

function statusLabel(status: OrderStatus): string {
  // Exhaustive by type: adding a status to the enum breaks the build here
  // rather than showing a raw identifier to a buyer.
  const labels: Record<OrderStatus, string> = {
    pending_payment: 'Esperando el pago',
    paid: 'Pagado',
    preparing: 'En preparación',
    ready_for_pickup: 'Listo para retirar',
    shipped: 'Enviado',
    delivered: 'Entregado',
    completed: 'Completado',
    cancelled: 'Cancelado',
    refunded: 'Reembolsado',
    disputed: 'En disputa',
  };
  return labels[status];
}

function nextStep(order: Order): string {
  if (order.deliveryMethod === 'meetup' || order.deliveryMethod === 'pickup') {
    return 'Coordiná por chat dónde y cuándo se encuentran. Cerquita no retiene el pago: revisá el producto antes de pagar.';
  }
  return 'Coordiná el envío por chat con la otra persona. Cerquita no interviene en la entrega.';
}
