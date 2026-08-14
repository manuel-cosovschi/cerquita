# Plan de implementación

Última actualización: 2026-08-14.

Leyenda: ✅ hecho y verificado · 🟡 parcial · ⬜ pendiente

---

## Estructura del monorepo

```
cerquita/
  apps/
    api/          NestJS · monolito modular · Prisma + PostGIS     ✅
    web/          Next.js · mapa + resultados + detalle            🟡
    admin/        Next.js · panel de administración                ⬜
    mobile/       Expo · React Native                              ⬜
  packages/
    design-tokens/  primitives → semantic → CSS vars               ✅
    types/          enums, entidades de red, eventos de dominio    ✅
    validation/     esquemas Zod compartidos                       ✅
    domain/         reglas puras y testeables                      ✅
    utils/          Money, geo, clustering, tiempo, slugs          ✅
    api-client/     cliente tipado compartido                      🟡
    ui/             librería de componentes                        ⬜
    config/         config compartida de tooling                   ⬜
  docs/                                                            🟡
  design-reference/  export original (cuando esté disponible)      ⬜
```

## Archivos existentes

El repositorio estaba **vacío** (ver `docs/design-audit.md`). No hubo nada que
conservar, transformar ni borrar. Todo el contenido es nuevo.

Cuando llegue el export de Claude Design se guarda **sin modificar** en
`/design-reference/`, como pide §112.

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
- Seed con datos ricos.
- 124 tests unitarios.

### Fase 2 — Reproducir el diseño 🟡 **bloqueada**

No puede completarse sin el export. Ver `docs/design-audit.md` §3.

Lo que sí se hizo: la arquitectura de tokens y los roles semánticos, para que
reproducir el diseño sea reemplazar un archivo y no reescribir pantallas.

### Fase 3 — Core marketplace ✅ (backend) / 🟡 (clientes)

| | Backend | Web |
|---|---|---|
| Listings (venta / busco / subasta) | ✅ | 🟡 |
| Mapa por viewport con clustering en PostGIS | ✅ | 🟡 |
| Búsqueda full-text + geo + filtros | ✅ | 🟡 |
| Búsqueda con IA (adapter + mock real) | ✅ | ⬜ |
| Ofertas y contraofertas | ✅ | ⬜ |
| Perfiles | 🟡 | ⬜ |
| Favoritos y colecciones | ⬜ | ⬜ |
| Chat en tiempo real | ⬜ | ⬜ |

### Fase 4 — Social 🟡

- ✅ Follows (unilateral) y amistades (bilateral, con orden canónico en BD).
- ✅ Bloqueos, que ocultan contenido en ambas direcciones.
- ✅ **Precios sociales resueltos en el servidor** — verificado end-to-end.
- ⬜ Feed, notificaciones, reseñas.

### Fase 5 — Comercio ✅ (núcleo)

- ✅ Carrito separado por vendedor (§40).
- ✅ Checkout que **recalcula todo** y rechaza totales manipulados.
- ✅ Órdenes con snapshots inmutables.
- ✅ `PaymentProvider` con mock + Mercado Pago.
- ✅ Historial de precios.
- 🟡 Reservas (dominio ✅, endpoints ⬜), promociones (motor ✅, ABM ⬜).

### Fase 6 — Subastas ✅

- ✅ Pujas transaccionales con row lock; **una sola puja ganadora** (verificado).
- ✅ Anti-sniping con extensión acotada.
- ✅ Comprar ahora, que se retira si las pujas lo superan.
- ✅ Scheduler que abre y cierra subastas sin depender de que alguien mire.
- ✅ WebSocket de sólo lectura (las pujas van por HTTP, con los mismos guards).
- ⬜ Notificaciones de outbid / ganada.

### Fase 7 — Tiendas 🟡

- ✅ Modelo completo: miembros, roles, horarios, ubicación física, seguidores.
- ✅ Marker único de tienda en el mapa (§49) — una tienda con 500 productos no
  tapa el mapa.
- ✅ Producto / variante / inventario en el schema.
- ⬜ Endpoints de ABM y dashboard.

### Fase 8 — Inteligencia 🟡

- ✅ Adapter de IA con mock **real** (parser en castellano, con tests).
- ✅ Matching de búsquedas guardadas y de "Busco" en el dominio.
- ⬜ Job de matching, demanda local agregada, recomendaciones.

### Fase 9 — Admin ⬜

Modelo listo (roles, audit log, reportes, disputas, risk score, feature flags,
configuración global). Falta la app.

### Fase 10 — Hardening 🟡

- ✅ Guard global (las rutas son privadas salvo opt-in explícito).
- ✅ Validación de entrada en todos los endpoints.
- ✅ Errores accionables, sin stack traces al cliente.
- ✅ `/health` y `/ready`, request id correlacionado.
- ✅ Constraints de integridad en la base.
- ⬜ Rate limiting, CI, tests e2e, accesibilidad.

---

## Decisiones registradas

| Decisión | Motivo |
|---|---|
| Monolito modular, no microservicios | §4. Los módulos se comunican por event bus, así que separarlos después no es un rewrite. |
| Prisma + SQL crudo para geo | §35. Esconder PostGIS detrás del ORM costaba más de lo que ahorraba: el clustering por `ST_SnapToGrid` y el orden por `ST_Distance` no se expresan bien vía ORM. |
| Dinero en enteros de unidad menor | §97. Sin punto flotante en ningún monto. |
| `READ COMMITTED` + `FOR UPDATE` para pujas | Con `SERIALIZABLE` el snapshot queda fijo y la relectura tras el lock devuelve estado viejo. Se descubrió probando dos pujas simultáneas reales. |
| Geografía nullable en Prisma | Prisma no genera `create` si una columna `Unsupported` es obligatoria. La invariante la garantiza un CHECK en la base. |
| Ubicación pública determinística | Si el punto difuso cambiara en cada request, promediando se recupera el real. |
| Paquetes compilados a CommonJS | Es el formato que cargan sin configuración extra Nest, Next y Metro. |
| Tokens provisionales aislados | §1 vs §134: avanzar sin inventar una identidad visual que se presente como la diseñada. |

## Próximos pasos

1. **Desbloquear el diseño** (§3 de la auditoría) → completar Fase 2.
2. Web: sincronización mapa ↔ resultados, detalle, publicar.
3. Chat + notificaciones (cierra el bucle de §131: buscar → ver → hablar → comprar).
4. Admin.
5. Mobile.
6. CI y e2e.
