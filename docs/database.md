# Base de datos

PostgreSQL 16 + PostGIS 3.4. Prisma para el esquema y las migraciones; SQL crudo
para todo lo geográfico.

## Dos convenciones que atraviesan todo

**1. Dinero.** Todos los montos son `Int` en la unidad menor de la moneda
(centavos), con una columna de moneda al lado. No hay `Float` ni `Decimal` cerca
de un precio. El rango representable llega a ~90 billones de pesos.

**2. Ubicación.** Cada fila localizable guarda dos puntos:

| Columna          | Quién la ve                                             |
| ---------------- | ------------------------------------------------------- |
| `exactLocation`  | Sólo el servidor. Distancias, radios, matching.         |
| `publicLocation` | Lo que reciben los clientes. Difuminado determinístico. |

El difuminado es determinístico por id: si el punto cambiara en cada request,
promediando varias respuestas se recupera el real.

## Por qué las columnas geográficas son nullable

Prisma no genera `create` para un modelo que tiene una columna `Unsupported`
obligatoria. La solución no fue relajar la invariante sino moverla a la base:

```sql
CHECK (status = 'draft' OR (exactLocation IS NOT NULL AND publicLocation IS NOT NULL))
```

El servicio inserta como `draft`, escribe los puntos y recién ahí activa la
publicación — todo en una transacción.

## Constraints que respaldan al código

La aplicación ya valida estas reglas. La base las repite para que ni un bug ni
una sesión manual puedan romperlas:

| Constraint                              | Qué impide                                              |
| --------------------------------------- | ------------------------------------------------------- |
| `listing_stock_non_negative`            | Stock negativo / sobreventa                             |
| `listing_published_requires_location`   | Publicación visible sin ubicación                       |
| `listing_discount_bps_range`            | Descuentos fuera de 0–100%                              |
| `auction_amounts_coherent`              | Reserva menor al precio inicial, fin antes del comienzo |
| `friendship_canonical_order`            | Amistades duplicadas (A,B) y (B,A)                      |
| `follow_not_self`                       | Seguirse a uno mismo                                    |
| `review_rating_range`                   | Puntajes fuera de 1–5                                   |
| `UNIQUE(orderId, authorId)` en `Review` | Dos reseñas del mismo autor por orden                   |
| `UNIQUE(auctionId, amount)` en `Bid`    | Dos pujas ganadoras idénticas                           |

## Índices

**Geográficos (GiST)** sobre cada columna `geography`, más uno parcial para
publicaciones visibles, que es el caso del 99% de las consultas del mapa.

**Full-text (GIN)** sobre un `tsvector` en español mantenido por trigger, con
pesos: título (A) > tags (B) > descripción (C).

**Trigram (GIN)** sobre títulos y nombres de tienda, para consultas cortas o mal
escritas que `tsquery` no resuelve bien ("ps5", "bicileta").

## Snapshots en órdenes

`OrderItem` guarda copia del título, precio, imagen y variante al momento de la
compra. Una venta histórica tiene que poder mostrarse correctamente aunque la
publicación se haya editado o borrado.

## Migraciones

```bash
pnpm db:migrate              # desarrollo
pnpm --filter @cerquita/api db:migrate:deploy   # producción
pnpm db:seed
```

Nunca editar la base a mano: todo cambio va por migración.
