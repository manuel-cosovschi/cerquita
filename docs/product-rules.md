# Reglas de producto

Las reglas viven en `packages/domain` como funciones puras. Este documento
explica el _por qué_; el código es la definición.

## Un solo tipo de usuario

No existen cuentas de comprador y de vendedor. Un `User` compra, vende, publica
que busca, oferta, subasta, puja, crea tiendas y las administra. Nadie cambia de
"modo".

Una tienda tampoco es una cuenta: es una entidad con miembros y roles. Un usuario
pertenece a varias tiendas con distinto rol en cada una.

## Precios sociales

Un vendedor configura descuentos por relación (ej. seguidores −5%, amigos −15%),
heredables por publicación y sobreescribibles por publicación.

Reglas:

- **El servidor decide.** El precio se resuelve en el servidor y el checkout lo
  recalcula desde cero. El número que manda el cliente sólo se compara para
  avisar que cambió.
- **Un amigo nunca paga más que un seguidor.** Si alguien configura
  "seguidores −10%, amigos −5%", casi seguro se equivocó; se aplica el mejor.
- **Las tiendas no tienen amigos.** Un amigo del dueño compra al precio de
  seguidor.
- **Los descuentos no se acumulan** salvo que la promoción lo declare. Acumular
  es una decisión de negocio con consecuencias de ingresos, no un accidente del
  orden de resolución.
- **Una promoción nunca sube el precio** por encima del de lista.

## Dos relaciones sociales distintas

**Seguir** es unilateral. **La amistad** es bilateral y requiere aceptación.

Sólo una amistad _aceptada_ cuenta como `friend`, y sólo que el espectador siga
al vendedor cuenta como `follower` — que el vendedor te siga a vos no da nada, o
cualquiera se auto-promocionaría a un descuento.

La reputación son las operaciones y las reseñas, no los seguidores.

## Subastas

- El servidor es la única autoridad. El ganador **nunca** se decide en el cliente.
- Una puja tiene que superar `puja actual + incremento mínimo`.
- El vendedor no puede pujar en lo suyo, y quien va ganando no puede pujar contra
  sí mismo (sólo se encarecería su propia compra).
- **Anti-sniping:** una puja dentro de la ventana de cierre extiende la subasta,
  con tope, para que una puja de último segundo no impida responder.
- **Comprar ahora** se retira si las pujas lo superan: si no, quien pujó más alto
  quedaría desplazado por alguien que paga menos.
- Sin reserva alcanzada no hay venta; el artículo vuelve a estar disponible.
- Las subastas abren y cierran por job, mire alguien o no.

## Ofertas

- Se ofrece por debajo del precio que _ese comprador_ pagaría (no del público:
  un amigo con descuento no debería quedar bloqueado por "superar" el precio).
- Contraofertar **cierra** la oferta original y abre una nueva en sentido
  contrario, preservando el historial para eventuales disputas.
- Una oferta aceptada fija el precio, y el checkout usa ese, no el social.

## Stock y reservas

`disponible = cantidad − reservado − vendido`, y nunca puede ser negativo. Lo
garantizan un UPDATE condicional y un `CHECK`.

Una reserva vence sola y libera el stock.

## Carrito y checkout

**Un carrito por vendedor** (§40). Un pago no puede liquidarse a dos
destinatarios distintos. Visualmente se muestran agrupados.

El checkout recalcula precio, descuentos, cupón, stock, oferta y total. La
comisión se cobra sobre la mercadería, nunca sobre el envío que el vendedor le
paga a un transportista.

## Ubicación

La dirección exacta nunca se revela automáticamente. Las publicaciones muestran
un punto aproximado y las distancias se redondean a rangos gruesos, para que no
se pueda triangular una posición precisa mirando desde varios puntos.

El punto de encuentro se acuerda por chat, después del acuerdo.

## Contenido promocionado

Aparece primero pero siempre identificado. Publicidad disfrazada de resultado
orgánico no es una opción.
