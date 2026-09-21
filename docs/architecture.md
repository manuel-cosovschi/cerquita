# Arquitectura

## Forma general

Monolito modular, no microservicios (spec §4). Los módulos de dominio son
independientes y se comunican por un event bus interno, así que separar uno en un
servicio propio más adelante es mover código, no reescribirlo.

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  web        │  │  admin      │  │  mobile     │
│  Next.js    │  │  Next.js    │  │  Expo       │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        │  @cerquita/api-client (tipado, compartido)
                 ┌──────▼──────────────────────┐
                 │  api  ·  NestJS             │
                 │                             │
                 │  auth · listings · geo      │
                 │  search · social · offers   │
                 │  auctions · checkout        │
                 │            ↕ event bus      │
                 └──────┬───────────────┬──────┘
                        │               │
                ┌───────▼──────┐  ┌─────▼─────┐
                │ PostgreSQL   │  │  Redis    │
                │ + PostGIS    │  │           │
                └──────────────┘  └───────────┘
```

## Por qué los packages compartidos existen

`packages/domain` contiene las reglas de negocio como funciones puras: precios
sociales, validación de pujas, totales de órdenes, transiciones de estado,
permisos. No importan Prisma, ni Nest, ni nada de infraestructura.

Esto no es purismo. Tiene dos consecuencias concretas:

1. **Se pueden testear exhaustivamente sin base de datos.** Los casos críticos
   del spec §91 (precios por tier, dos pujas simultáneas, dos compradores por la
   última unidad, autorización cruzada) corren en milisegundos.
2. **La misma regla corre en más de un lugar sin duplicarse.** `resolvePrice` la
   usa el serializador de listings _y_ el checkout. Si estuvieran duplicadas,
   eventualmente divergirían — y la divergencia sería que el usuario ve un precio
   y se le cobra otro.

## El límite de serialización

Ningún endpoint devuelve una fila de Prisma directamente. Todo pasa por un
serializador, y ahí viven dos invariantes:

- **La ubicación exacta nunca sale.** Sólo el punto público, ya difuminado.
- **Los precios se resuelven por espectador.** Lo que se ve es lo que se cobra.

Poner esto en un solo lugar es lo que hace que la garantía sea auditable: hay un
archivo que revisar, no cincuenta handlers.

## Concurrencia

Tres caminos necesitan cuidado real, y cada uno usa la herramienta que
corresponde:

| Camino            | Mecanismo                                    | Por qué                                                                                            |
| ----------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Pujas             | `READ COMMITTED` + `SELECT … FOR UPDATE`     | Las pujas se serializan en el lock. La segunda lee la puja de la primera y se rechaza limpiamente. |
| Stock             | UPDATE condicional (`WHERE disponible >= n`) | Atómico. La segunda transacción reevalúa el WHERE contra la fila nueva y no matchea.               |
| Cierre de subasta | Job + row lock                               | La subasta cierra a horario, mire alguien o no. Idempotente entre instancias.                      |

**Sobre `SERIALIZABLE`:** se usó primero para las pujas y estaba mal. En
`SERIALIZABLE` (y en `REPEATABLE READ`) el snapshot queda fijo en la primera
consulta de la transacción, así que releer después del `FOR UPDATE` devuelve la
fila vieja: la lógica de dominio decidía sobre estado obsoleto y sólo el
constraint `UNIQUE(auctionId, amount)` evitaba el desastre. Se detectó probando
dos pujas simultáneas de verdad contra la base.

Además, las invariantes están duplicadas como constraints en la base
(`CHECK`), así que ni un bug ni una sesión de `psql` pueden producir stock
negativo o una publicación sin ubicación.

## El mapa

El mapa es el producto, así que sus consultas son SQL crudo contra PostGIS en vez
de pasar por el ORM (spec §35):

- **Clustering en la base** con `ST_SnapToGrid`. Un viewport sobre una ciudad
  densa devuelve ~50 clusters, no 50.000 publicaciones.
- **Índices GiST** sobre `geography`, incluido uno parcial para las publicaciones
  visibles, que es el 99% de las consultas.
- **Una request por viewport**, nunca una por marker.
- El servidor decide, según el zoom, si responde con clusters o con markers.

## Providers

Pagos, IA, storage y push están detrás de interfaces. Cada uno tiene un mock
funcional, así que la app corre entera sin credenciales (spec §89).

Dos detalles deliberados:

- Los mocks **se niegan a cargar** con `NODE_ENV=production`. Un build que
  "captura" pagos sin mover plata tiene que fallar ruidosamente al arrancar.
- El mock de IA **no inventa contenido**. Si no hay modelo configurado,
  `suggestListing` devuelve sólo lo que se puede inferir honestamente, en vez de
  fabricar una descripción que el vendedor nunca escribió.

## Eventos

Los módulos publican hechos (`ListingCreated`, `BidPlaced`, `OrderPaid`) en vez
de llamarse entre sí. Notificaciones, feed, analytics y matching de búsquedas
guardadas se suscriben.

El bus actual es in-process. El contrato es el payload, no el transporte, así que
cambiarlo por una cola real no toca a los publicadores.

## Autenticación

- Access token JWT de vida corta; refresh token opaco y rotado en cada uso.
- Los refresh tokens se guardan **sólo hasheados** (SHA-256).
- Contraseñas con argon2id.
- El login compara contra un hash señuelo real cuando la cuenta no existe, para
  que el tiempo de respuesta no revele qué emails están registrados.
- Roles y membresías de tienda se leen de la base **en cada request**, no del
  token, así que revocar un permiso tiene efecto inmediato.
- El guard es global: las rutas son privadas salvo que declaren `@Public()` o
  `@OptionalAuth()`. Olvidarse de un decorador falla cerrado.
