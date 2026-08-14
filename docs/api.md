# API

Base: `http://localhost:4000/api`

Todas las respuestas son JSON. Los montos son `{ amount, currency }` con `amount`
en unidades menores enteras.

## Autenticación

`Authorization: Bearer <accessToken>`.

Las rutas son privadas por defecto. Las públicas lo declaran explícitamente; las
que sirven a ambos (`@OptionalAuth`) responden a anónimos con precio público y a
usuarios autenticados con el precio de su relación.

| Método | Ruta | Auth |
|---|---|---|
| POST | `/auth/register` | pública |
| POST | `/auth/login` | pública |
| POST | `/auth/refresh` | pública |
| POST | `/auth/logout` | pública |
| GET | `/auth/me` | requerida |

El refresh rota: usar un refresh token lo revoca y devuelve uno nuevo.

## Mapa

```
GET /map/listings?bbox=minLng,minLat,maxLng,maxLat&zoom=14&layer=all
```

Una request por viewport. El servidor decide, según el zoom, si responde con
clusters o con markers individuales.

`layer`: `all` · `sales` · `wanted` · `auctions` · `stores` · `friends` ·
`following` · `near_me` · `now`.

`now` es una consulta temporal sobre las publicaciones existentes (subastas por
cerrar, recién publicado, promociones vigentes), no una copia de ellas.

```jsonc
{
  "markers": [
    { "type": "cluster", "id": "…", "point": {…}, "count": 128, "bounds": {…} },
    { "type": "listing", "id": "…", "kind": "auction", "price": {…}, "auctionEndsAt": "…" },
    { "type": "store",   "id": "…", "name": "Casaca de Cancha", "activeListingCount": 47 }
  ],
  "clustered": true,
  "truncated": false
}
```

## Publicaciones

| Método | Ruta | Notas |
|---|---|---|
| POST | `/listings` | `kind`: `sale` \| `wanted` \| `auction` |
| GET | `/listings/:id` | Auth opcional; el precio depende del espectador |
| PATCH | `/listings/:id` | Sólo dueño o miembro de la tienda |
| PATCH | `/listings/:id/status` | `active` \| `paused` \| `removed` |

La respuesta trae `location` **aproximada**, con `precisionMeters`. El punto
exacto no se serializa nunca.

## Búsqueda

`POST /search` — es POST porque los filtros son un objeto anidado (bbox, arrays)
que no sobrevive bien a un query string.

`POST /search/ai` — lenguaje natural:

```json
{ "prompt": "Quiero una mountain bike usada por menos de $500.000 a menos de 5 km" }
```

Devuelve los resultados más `interpreted`, con los filtros que se dedujeron, para
que la interfaz pueda mostrarlos y dejar corregirlos. Sin `ANTHROPIC_API_KEY`
funciona igual con el parser por reglas.

## Ofertas

| Método | Ruta |
|---|---|
| POST | `/offers` |
| POST | `/offers/:id/respond` — `accept` \| `reject` \| `counter` |
| DELETE | `/offers/:id` |

## Subastas

| Método | Ruta |
|---|---|
| POST | `/auctions/:id/bids` |
| POST | `/auctions/:id/buy-now` |

`expectedMinimum` es opcional: si no coincide con el mínimo real, la puja se
rechaza con `stale_minimum` en vez de comprometer al usuario a un monto que no
quiso.

**WebSocket** `/auctions` — sólo lectura. Las pujas van por HTTP para pasar por
los mismos guards, validación y transacción. El socket sólo difunde lo que el
servidor ya decidió.

## Carrito y checkout

| Método | Ruta |
|---|---|
| GET | `/cart` |
| POST | `/cart/items` |
| PATCH | `/cart/items/:itemId` |
| DELETE | `/cart/items/:itemId` |
| POST | `/checkout` |
| GET | `/orders/:id` |

`quotedTotal` es opcional y **no se cobra**: sólo se compara. Si difiere, la
respuesta es `409 price_changed` con el total autoritativo.

## Social

`POST|DELETE /users/:id/follow` · `POST /users/:id/friend-request` ·
`POST /friendships/:id/respond` · `POST|DELETE /users/:id/block` ·
`POST /stores/:id/follow`

## Salud

`GET /health` — liveness, no toca dependencias.
`GET /ready` — readiness, verifica la base.

## Errores

```json
{ "message": "Tu puja no alcanza el mínimo requerido",
  "code": "below_minimum",
  "requestId": "…" }
```

`message` es accionable y en castellano. `code` es estable para la interfaz.
Nunca se devuelve un stack trace ni un fragmento de SQL.

Códigos habituales: `validation_error`, `unauthenticated`, `forbidden`,
`not_found`, `insufficient_stock`, `price_changed`, `below_minimum`,
`stale_minimum`, `already_highest_bidder`, `seller_cannot_bid`, `write_conflict`.

## Chat

| Método | Ruta |
|---|---|
| GET | `/conversations` |
| POST | `/conversations` |
| GET | `/conversations/:id` |
| GET | `/conversations/:id/messages` |
| POST | `/conversations/:id/messages` |
| POST | `/conversations/:id/read` |

Abrir una conversación que ya existe **reutiliza el hilo** en vez de crear uno
nuevo. `clientId` hace idempotente el envío: reintentar tras una conexión
inestable devuelve el mensaje ya guardado.

**WebSocket** `/chat` — sólo lectura. Autentica en el connect y mete al socket en
una sala por usuario, así que nadie puede suscribirse a los mensajes de otro.

## Notificaciones

| Método | Ruta |
|---|---|
| GET | `/notifications` |
| GET | `/notifications/unread-count` |
| POST | `/notifications/:id/read` |
| POST | `/notifications/read-all` |
| POST | `/notifications/devices` |
| POST | `/notifications/preferences` |

El registro in-app se escribe siempre; el push es best-effort encima. Si el
proveedor falla, la notificación igual aparece al abrir la app.

## Favoritos, colecciones y alertas

`GET|POST /favorites` · `DELETE /favorites/listing/:id` ·
`DELETE /favorites/store/:id` · `GET|POST /collections` ·
`GET|POST /saved-searches` · `DELETE /saved-searches/:id`

## Perfiles

`GET /users/:username` · `GET /users/:username/listings?tab=selling|wanted|auctions|sold` ·
`GET /users/:username/reviews` · `PATCH /users/me/profile` ·
`PATCH /users/me/discounts` · `PATCH /users/me/privacy`

El perfil incluye `relationship` con el `tier` resuelto por el servidor. La
solapa `sold` respeta la preferencia de privacidad del dueño incluso si se pide
el endpoint directo.

## Reseñas

`POST /reviews` · `GET /reviews/pending`

Requieren una orden liquidada en la que el autor participó. La reputación se
actualiza en la misma transacción que la reseña.

## Pendiente

ABM de tiendas, reservas y admin tienen modelo de datos y reglas de dominio,
pero todavía no endpoints. Ver `docs/implementation-plan.md`.

### Liquidación marketplace

`PaymentProvider` modela los estados (cobro, retención, comisión, liquidación,
reembolso) sin afirmar cómo se retiene el dinero. El split real de Mercado Pago
requiere una cuenta de marketplace aprobada y onboarding OAuth por vendedor. La
comisión se calcula y se guarda en la orden; lo que falta conectar es el
movimiento de fondos. No se inventó un escrow ficticio.
