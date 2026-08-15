# Plan de implementación

Última actualización: 2026-08-15.

Leyenda: ✅ hecho y verificado · 🟡 parcial · ⬜ pendiente

---

## Estructura del monorepo

```
cerquita/
  apps/
    api/          NestJS · monolito modular · Prisma + PostGIS     ✅
    web/          Next.js · mapa + resultados + detalle            ✅
    admin/        Next.js · panel de administración                ✅
    mobile/       Expo · React Native                              ✅
  packages/
    design-tokens/  primitives → semantic → CSS vars               ✅
    types/          enums, entidades de red, eventos de dominio    ✅
    validation/     esquemas Zod compartidos                       ✅
    domain/         reglas puras y testeables                      ✅
    utils/          Money, geo, clustering, tiempo, slugs          ✅
    api-client/     cliente tipado compartido                      ✅
  docs/                                                            ✅
  design-reference/  concepto original, sin modificar (§112)       ✅
```

Dos paquetes que estaban planificados **no existen, a propósito**:

- `packages/config` — `tsconfig.base.json` en la raíz y `eslint.config.mjs`
  (flat config, que ya alcanza a todo el workspace) hacen ese trabajo. Un
  paquete envolviéndolos era una capa sin contenido.
- `packages/ui` — web y mobile no pueden compartir componentes (DOM contra
  React Native), y admin comparte con web tres archivos de tabla. Lo que sí se
  comparte es lo que está en `design-tokens`, del lado correcto de la frontera.

Se prefirió borrar los directorios vacíos antes que dejar un `⬜` permanente:
§125 pide que no queden andamios sin implementar.

## Archivos existentes

El repositorio estaba **vacío** (ver `docs/design-audit.md`). No hubo nada que
conservar, transformar ni borrar. Todo el contenido es nuevo.

---

## Fases

### Fase 0 — Análisis ✅

- Inspección del repositorio (vacío).
- Intento de importar el diseño por las cuatro vías disponibles → bloqueado.
- `docs/design-audit.md` y este documento.

### Fase 1 — Fundaciones ✅

- Monorepo pnpm, TypeScript estricto (`noUncheckedIndexedAccess`, etc.).
- `design-tokens` con la separación primitives/semantic que hace intercambiable
  el diseño.
- `utils`: **Money en unidades menores enteras** (nunca punto flotante),
  geo con fuzzing determinístico, geometría de clustering, tiempo en UTC.
- `types`: enums, entidades de red, eventos de dominio.
- `domain`: precios sociales, subastas, ofertas, órdenes, stock, permisos,
  matching, riesgo — todo puro y testeable.
- `validation`: esquemas Zod compartidos.
- Base de datos: schema Prisma completo, migración con índices GiST, búsqueda
  full-text en español y constraints de integridad.
- Auth: registro, login, refresh con rotación, sesiones, argon2id.
- Seed con datos ricos, incluida demanda real para que `/demand` tenga algo que
  mostrar sin que haya que inventar publicaciones a mano.
- Tests unitarios: 183 al día de hoy, todos en verde.

### Fase 2 — Reproducir el diseño ✅

El export llegó y está aplicado. Ver `docs/design-audit.md`.

- ✅ Bundle original conservado sin modificar en `design-reference/` (§112).
- ✅ Paleta, tipografía, radios y sombras extraídos del board a `design-tokens`;
  sólo `primitives.ts` tiene valores crudos.
- ✅ Síntesis de las direcciones **1a** (map first: el mapa es la home) y **1c**
  (social commerce: precios de amigo, comentarios públicos, feed), que es la
  mezcla que pidió el usuario.
- ✅ Los mismos tokens alimentan web (CSS custom properties) y mobile (objeto de
  tema en `apps/mobile/src/lib/theme.ts`), así que las dos apps no pueden
  divergir de color.

### Fase 3 — Core marketplace ✅

|                                             | Backend | Web | Mobile |
| ------------------------------------------- | ------- | --- | ------ |
| Listings (venta / busco / subasta)          | ✅      | ✅  | ✅     |
| Mapa por viewport con clustering en PostGIS | ✅      | ✅  | ✅     |
| Búsqueda full-text + geo + filtros          | ✅      | ✅  | ✅     |
| Búsqueda con IA (adapter + mock real)       | ✅      | ✅  | —      |
| Ofertas y contraofertas                     | ✅      | ✅  | —      |
| Perfiles                                    | ✅      | ✅  | —      |
| Favoritos y colecciones                     | ✅      | ✅  | —      |
| Chat en tiempo real                         | ✅      | ✅  | ✅     |

### Fase 4 — Social ✅

- ✅ Follows (unilateral) y amistades (bilateral, con orden canónico en BD).
- ✅ Bloqueos, que ocultan contenido en ambas direcciones y cortan el chat.
- ✅ **Precios sociales resueltos en el servidor** — verificado end-to-end.
- ✅ Feed con fan-out a seguidores y amigos al publicar.
- ✅ Notificaciones: in-app siempre, push best-effort, preferencias por tipo.
- ✅ Reseñas atadas a una orden liquidada, con reputación transaccional.
- ✅ UI de feed y notificaciones en web.

### Fase 5 — Comercio ✅ (núcleo)

- ✅ Carrito separado por vendedor (§40).
- ✅ Checkout que **recalcula todo** y rechaza totales manipulados.
- ✅ Órdenes con snapshots inmutables.
- ✅ `PaymentProvider` con mock + Mercado Pago.
- ✅ Historial de precios.
- ✅ Reservas con el mismo guard de stock que el checkout, barridas por el scheduler.
- ✅ Promociones: motor, ABM en `/store/manage` y baja lógica (una promoción
  terminada deja de aplicarse pero no se borra: las órdenes viejas la citan).

### Fase 6 — Subastas ✅

- ✅ Pujas transaccionales con row lock; **una sola puja ganadora** (verificado).
- ✅ Anti-sniping con extensión acotada.
- ✅ Comprar ahora, que se retira si las pujas lo superan.
- ✅ Scheduler que abre y cierra subastas sin depender de que alguien mire.
- ✅ WebSocket de sólo lectura (las pujas van por HTTP, con los mismos guards).
- ✅ Notificaciones de outbid, subasta ganada y venta.

### Fase 7 — Tiendas ✅

- ✅ Modelo completo: miembros, roles, horarios, ubicación física, seguidores.
- ✅ Marker único de tienda en el mapa (§49) — una tienda con 500 productos no
  tapa el mapa.
- ✅ ABM de tienda, miembros con roles jerárquicos y horarios.
- ✅ Catálogo: producto / opciones / variantes / inventario, con validación de
  combinaciones y guarda de stock comprometido.
- ✅ Publicación explícita de un producto al mapa.
- ✅ Dashboard del vendedor agregado en SQL (§50).
- ✅ UI de gestión de tienda: alta, dashboard y promociones.

### Fase 8 — Inteligencia ✅

- ✅ Adapter de IA con mock **real** (parser en castellano, con tests).
- ✅ Matching de búsquedas guardadas y de "Busco", enganchado a los eventos:
  una publicación nueva notifica a quien tenga una alerta compatible o un Busco
  que la satisfaga, y una baja de precio sólo re-notifica a quien recién ahora
  entra en presupuesto.
- ✅ Demanda local agregada (§51): qué se pide cerca contra qué hay en venta,
  en `/demand`, enlazado desde el chooser de publicar. **Sólo agregados** — la
  pantalla nombra categorías y palabras repetidas, nunca a quién las pidió, y
  una categoría con un solo pedido no se reporta (sería señalar a esa persona).

### Fase 9 — Admin ✅

- ✅ Dashboard con métricas agregadas en SQL (usuarios, GMV, comisiones, cola).
- ✅ Moderación con razón obligatoria y audit log transaccional.
- ✅ Suspender/banear revoca sesiones al instante.
- ✅ Reportes, disputas, risk score advisory, feature flags y configuración
  global editable.
- ✅ La app `apps/admin`: cola de moderación, reportes, disputas, auditoría y
  configuración global.

### Fase 10 — Hardening 🟡

- ✅ Guard global (las rutas son privadas salvo opt-in explícito).
- ✅ Validación de entrada en todos los endpoints.
- ✅ Errores accionables, sin stack traces al cliente.
- ✅ `/health` y `/ready`, request id correlacionado.
- ✅ Constraints de integridad en la base.
- ✅ Rate limiting con ventanas por usuario y por IP; las rutas de credenciales
  se limitan por `email + IP`, para que un NAT compartido no deje afuera a un
  barrio entero.
- ✅ CI: instala, genera el cliente de Prisma, lint, formato, typecheck, tests,
  aplica las migraciones desde cero contra PostGIS, siembra y compila las tres
  apps que tienen build.
- ✅ Tests e2e (Playwright, 27) contra el stack real, sin mocks: precios
  sociales resueltos en el servidor, ubicación exacta que nunca sale, checkout
  que rechaza un total manipulado, dos pujas simultáneas con un solo ganador,
  y demanda local que reporta patrones sin nombrar personas.
- ✅ Pasada de accesibilidad: cero violaciones WCAG 2.1 AA (axe) en las quince
  pantallas de web y las cinco del admin, con el chequeo incorporado a la suite
  e2e para que no vuelva en silencio.

---

## Decisiones registradas

| Decisión                                                | Motivo                                                                                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Monolito modular, no microservicios                     | §4. Los módulos se comunican por event bus, así que separarlos después no es un rewrite.                                                                                                                           |
| Prisma + SQL crudo para geo                             | §35. Esconder PostGIS detrás del ORM costaba más de lo que ahorraba: el clustering por `ST_SnapToGrid` y el orden por `ST_Distance` no se expresan bien vía ORM.                                                   |
| Dinero en enteros de unidad menor                       | §97. Sin punto flotante en ningún monto.                                                                                                                                                                           |
| `READ COMMITTED` + `FOR UPDATE` para pujas              | Con `SERIALIZABLE` el snapshot queda fijo y la relectura tras el lock devuelve estado viejo. Se descubrió probando dos pujas simultáneas reales.                                                                   |
| Geografía nullable en Prisma                            | Prisma no genera `create` si una columna `Unsupported` es obligatoria. La invariante la garantiza un CHECK en la base.                                                                                             |
| Ubicación pública determinística                        | Si el punto difuso cambiara en cada request, promediando se recupera el real.                                                                                                                                      |
| Paquetes compilados a CommonJS                          | Es el formato que cargan sin configuración extra Nest, Next y Metro.                                                                                                                                               |
| Tokens provisionales aislados hasta que llegó el export | §1 vs §134: se avanzó sin inventar una identidad visual que se presentara como la diseñada. Cuando llegó el board, aplicarlo fue reemplazar `primitives.ts`, que era exactamente para lo que servía la separación. |
| `textOnBrand` y `textOnAccent` separados                | Colapsarlos en un solo color dejaba tinta oscura sobre el botón casi negro: invisible. El export pone tinta oscura sobre el naranja y clara sobre el negro, y son dos decisiones distintas.                        |
| Demanda local sólo agregada, con umbral de 2            | Una categoría con un solo pedido identifica a quien lo pidió. El pedido ya es público en el mapa; una lista rankeada de "cerca de esta esquina quieren X" es otro objeto, y uno que conviene no construir.         |
| Rate limit de credenciales por `email + IP`             | Con la clave por IP sola, un NAT compartido (un edificio, una oficina) se bloquea entero porque una sola persona erró la contraseña. Se descubrió agotando el presupuesto del navegador desde curl.                |
| Sin `packages/ui` ni `packages/config`                  | Ver arriba: no había nada real que compartir en ninguno de los dos.                                                                                                                                                |
| E2E contra el stack real, sin mocks                     | Lo que estos tests protegen sólo se rompe con las piezas conectadas. Un mock del servidor de precios convierte "el precio lo resuelve el servidor" en una tautología.                                              |
| E2E con un solo worker                                  | Los límites de rate son reales en estos tests, a propósito. Workers en paralelo contra una sola IP producen 429 que parecen bugs del producto.                                                                     |
| Cada test e2e publica lo que compra                     | Comprar algo del seed funciona exactamente una vez; a la segunda corrida está vendido. Una suite que sólo pasa con la base recién sembrada es una suite que nadie corre dos veces.                                 |
| Contraste corregido en el token, no en las pantallas    | El texto terciario fallaba en doce pantallas por una sola razón: todas beben del mismo token. Arreglar cada CSS habría dejado el defecto vivo en la próxima pantalla que se escribiera.                            |
| El dock inactivo al 0.6 y no al 0.4                     | La intención del diseño —los ítems inactivos se retiran en vez de cambiar de color— es correcta; el valor no era legible. Se conservó la intención y se movió el número.                                           |

## Próximos pasos

Lo funcional está cerrado: el bucle de §131 (buscar → ver → hablar → comprar →
reseñar) corre entero en web, y mobile cubre mapa, detalle y chat contra la
misma API. CI, e2e y accesibilidad ya corren.

Nada bloqueante. Lo que queda es trabajo de operación, no de construcción:
observabilidad en producción, presupuesto de performance, y el proveedor de
tiles del mapa (hoy la grilla es el fallback declarado).
