'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { Cart, DeliveryMethod } from '@cerquita/types';
import { ApiError } from '@cerquita/api-client';
import { formatMoney, money } from '@cerquita/utils';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from './page.module.css';

const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
  meetup: 'Nos encontramos',
  pickup: 'Lo retiro',
  store_delivery: 'Envío de la tienda',
  shipping: 'Envío',
};

/** Which delivery methods a buyer can pick without an address on file. */
const OFFERED: DeliveryMethod[] = ['meetup', 'pickup'];

/**
 * The cart.
 *
 * One block per seller, because carts never mix sellers (spec §40) — you meet
 * one person at one place. A single merged total would be a number nobody can
 * actually pay in one transaction.
 *
 * Every amount on this screen comes from the server. `quotedTotal` sends back
 * what was displayed so checkout can refuse if the price moved in between; it
 * is a tripwire, never the amount charged (spec §41).
 */
export default function CartPage() {
  const { user, loading } = useSession();
  const router = useRouter();

  const [carts, setCarts] = useState<Cart[] | null>(null);
  const [delivery, setDelivery] = useState<Record<string, DeliveryMethod>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setCarts(await api.cart.list());
  }, []);

  useEffect(() => {
    if (!user) {
      setCarts(null);
      return;
    }

    let cancelled = false;
    api.cart
      .list()
      .then((result) => {
        if (!cancelled) setCarts(result);
      })
      .catch(() => {
        if (!cancelled) setCarts([]);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  async function changeQuantity(itemId: string, quantity: number) {
    setBusy(itemId);
    setError(null);
    try {
      if (quantity <= 0) await api.cart.remove(itemId);
      else await api.cart.setQuantity(itemId, quantity);
      // Reload rather than patch: totals, discounts and availability are all
      // the server's to compute, and guessing them here would drift.
      await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos actualizar el carrito.');
    } finally {
      setBusy(null);
    }
  }

  async function checkout(cart: Cart) {
    setBusy(cart.id);
    setError(null);
    try {
      const result = await api.checkout.submit({
        cartId: cart.id,
        deliveryMethod: delivery[cart.id] ?? 'meetup',
        quotedTotal: cart.total,
      });

      // A provider that needs a hosted payment page sends the buyer there;
      // otherwise the order is already created and we go straight to it.
      if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
      else router.push(`/order/${result.order.id}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos completar la compra.');
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <AppScreen title="Carrito" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (!user) {
    return (
      <AppScreen title="Carrito" active="profile">
        <EmptyState
          title="Iniciá sesión"
          body="Necesitás una cuenta para comprar."
          actions={
            <Link href="/login?next=%2Fcart" className={appScreenStyles.primary}>
              Entrar
            </Link>
          }
        />
      </AppScreen>
    );
  }

  if (carts === null) {
    return (
      <AppScreen title="Carrito" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (carts.length === 0) {
    return (
      <AppScreen title="Carrito" active="profile">
        <EmptyState
          title="Tu carrito está vacío"
          body="Cuando toques Comprar en algo, lo vas a encontrar acá."
          actions={
            <Link href="/" className={appScreenStyles.primary}>
              Explorar el mapa
            </Link>
          }
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      title="Carrito"
      subtitle={carts.length === 1 ? 'Un vendedor' : `${carts.length} vendedores`}
      active="profile"
    >
      {error && <p className={styles.error}>{error}</p>}

      {carts.map((cart) => {
        const method = delivery[cart.id] ?? 'meetup';

        return (
          <section key={cart.id} className={styles.cart} aria-label={`Carrito de ${cart.seller.displayName}`}>
            <div className={styles.sellerRow}>
              <p className={styles.sellerName}>{cart.store?.name ?? cart.seller.displayName}</p>
              <Link className={styles.sellerLink} href={`/user/${cart.seller.username}`}>
                Ver perfil
              </Link>
            </div>

            <ul className={styles.items}>
              {cart.items.map((item) => (
                <li key={item.id} className={styles.item}>
                  {item.image ? (
                    <img className={styles.thumb} src={item.image.url} alt="" />
                  ) : (
                    <span className={styles.thumb} aria-hidden="true" />
                  )}

                  <div className={styles.itemBody}>
                    <p className={styles.itemTitle}>{item.title}</p>
                    <p className={styles.itemPrice}>
                      {formatMoney(
                        money(item.unitPrice.effective.amount, item.unitPrice.effective.currency),
                      )}{' '}
                      c/u
                    </p>
                    {item.unitPrice.tier !== 'public' && (
                      <p className={styles.itemTier}>
                        {item.unitPrice.tier === 'friend'
                          ? 'Precio de amigo'
                          : 'Precio para seguidores'}
                      </p>
                    )}

                    <div className={styles.quantity}>
                      <button
                        type="button"
                        className={styles.step}
                        onClick={() => void changeQuantity(item.id, item.quantity - 1)}
                        disabled={busy === item.id}
                        aria-label="Restar uno"
                      >
                        −
                      </button>
                      <span className={styles.count}>{item.quantity}</span>
                      <button
                        type="button"
                        className={styles.step}
                        onClick={() => void changeQuantity(item.id, item.quantity + 1)}
                        // Stock is the server's number; the button stops where it does.
                        disabled={busy === item.id || item.quantity >= item.availableQuantity}
                        aria-label="Sumar uno"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className={styles.remove}
                        onClick={() => void changeQuantity(item.id, 0)}
                        disabled={busy === item.id}
                      >
                        Quitar
                      </button>
                    </div>
                  </div>

                  <span className={styles.lineTotal}>
                    {formatMoney(money(item.lineTotal.amount, item.lineTotal.currency))}
                  </span>
                </li>
              ))}
            </ul>

            {/*
              `subtotal` already has the social discount applied — it is not a
              pre-discount figure. So the saving is stated after the total as a
              fact, not slotted between two numbers where it would read as a
              subtraction that does not add up.
            */}
            <div className={styles.totals}>
              <div className={styles.totalRow}>
                <span>Productos</span>
                <span>{formatMoney(money(cart.subtotal.amount, cart.subtotal.currency))}</span>
              </div>
              <div className={`${styles.totalRow} ${styles.grandRow}`}>
                <span>Total</span>
                <span>{formatMoney(money(cart.total.amount, cart.total.currency))}</span>
              </div>
              {cart.discountTotal.amount > 0 && (
                <div className={`${styles.totalRow} ${styles.discountRow}`}>
                  <span>Ahorrás</span>
                  <span>
                    {formatMoney(money(cart.discountTotal.amount, cart.discountTotal.currency))}
                  </span>
                </div>
              )}
            </div>

            <div className={styles.delivery} role="group" aria-label="Cómo lo recibís">
              {OFFERED.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`${styles.deliveryOption} ${method === option ? styles.deliveryActive : ''}`}
                  aria-pressed={method === option}
                  onClick={() => setDelivery((current) => ({ ...current, [cart.id]: option }))}
                >
                  {DELIVERY_LABELS[option]}
                </button>
              ))}
            </div>

            <button
              type="button"
              className={styles.checkout}
              onClick={() => void checkout(cart)}
              disabled={busy === cart.id}
            >
              {busy === cart.id ? 'Procesando…' : 'Comprar'}
            </button>

            {/* Spec §46: no invented escrow. */}
            <p className={styles.note}>
              Cerquita no retiene el pago ni garantiza la entrega. Coordiná con el vendedor y revisá
              el producto antes de pagar.
            </p>
          </section>
        );
      })}
    </AppScreen>
  );
}
