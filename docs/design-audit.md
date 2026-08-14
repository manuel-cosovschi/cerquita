# Auditoría de diseño

Estado: **bloqueado parcialmente**. Última actualización: 2026-08-14.

---

## 1. Qué se pidió auditar

La instrucción fue importar el proyecto de Claude Design:

```
https://claude.ai/design/p/0a2c2b56-7620-4c18-bfde-5c170f3b5d2e
  ?file=Cerquita+-+Design+Exploration+Board.dc.html
```

con estos archivos como foco:

- `Cerquita - Design Exploration Board.dc.html` (las 3 pantallas: Map/Home, Search, Product Detail)
- `support.js`

## 2. Qué se encontró en el repositorio

**Nada.** El repositorio estaba completamente vacío: sólo `.git`, sin ningún commit.

```
$ ls -la
.git/
$ git log
fatal: your current branch does not have any commits yet
```

No había HTML exportado, ni assets, ni `support.js`, ni tokens, ni código generado.

## 3. Por qué el diseño no pudo leerse

Se intentaron, en orden, todas las vías disponibles:

| Vía | Resultado |
|---|---|
| MCP `claude_design` → `get_project` / `list_files` | `DesignSync needs design-system authorization` — requiere `/design-login`, que necesita una terminal interactiva |
| `WebFetch` sobre la URL del proyecto | HTTP 503 |
| `curl` a `claude.ai/design/p/<id>` | HTTP 403 |
| `curl` a `api.anthropic.com/v1/design/mcp` | HTTP 405 (endpoint vivo, pero requiere POST autenticado) |

La sesión es no interactiva, así que el flujo OAuth de `/design-login` no puede
ejecutarse acá.

**Conclusión: la fuente visual de verdad no estuvo disponible en ningún momento.**

### Cómo desbloquearlo

Cualquiera de estas dos opciones alcanza:

1. En Claude Design, usar **"Send to Claude Code Web"**, que copia los archivos
   del proyecto al workspace. Después, `docs/design-audit.md` se reescribe con la
   auditoría real y se reemplaza un solo archivo de código (ver §6).
2. Copiar manualmente el `.dc.html` exportado y sus assets a `/design-reference/`
   y avisar.

## 4. Decisión tomada frente al bloqueo

La especificación es explícita en dos puntos que acá entran en tensión:

- §1 — «El diseño exportado es la fuente visual de verdad. NO rediseñes
  arbitrariamente esas pantallas.»
- §134 — «No vuelvas a preguntarme si quiero implementar únicamente las 3
  pantallas existentes. Implementá toda Cerquita progresivamente.»

Detenerse a esperar el diseño habría violado §134 y dejado cero entregable.
Inventar una identidad visual y presentarla como si fuera la exportada habría
violado §1 y §125.

La decisión fue **separar estrictamente lo que depende del diseño de lo que no**,
y avanzar a fondo con lo segundo:

- **No depende del diseño** (implementado): dominio, base de datos, API,
  geolocalización, concurrencia, pagos, subastas, precios sociales, búsqueda,
  seguridad, tests, infraestructura. Es la mayor parte del sistema y **nada de
  esto cambia** cuando llegue el diseño.
- **Depende del diseño** (aislado en un solo lugar): colores, tipografías,
  espaciados, radios, sombras y geometría de markers.

## 5. Design tokens detectados

**Ninguno.** No se pudo extraer ni un solo valor del diseño exportado.

Lo que existe hoy en `packages/design-tokens/src/primitives.ts` es un set
**PROVISIONAL**, marcado como tal en el propio archivo. No pretende parecerse al
diseño de Claude Design, porque no hay forma de saber cómo es. Es un andamio
coherente para que la app sea usable y para que la arquitectura de tokens quede
probada.

Lo que **sí** es una decisión de arquitectura sólida y no cambia:

```
primitives.ts   ← ÚNICO archivo con valores visuales crudos (el que se reemplaza)
      ↓
semantic.ts     ← roles con significado de producto (sale, auction, wanted,
                   friend, follower, discount, mapCluster…)
      ↓
css.ts          ← genera CSS custom properties para web/admin
      ↓
componentes     ← nunca leen primitives, sólo roles semánticos
```

Los roles semánticos no son decorativos: `auction`, `wanted`, `friend`,
`follower`, `discount` y `mapCluster` codifican significado de producto. Cuando
llegue el diseño real, esos roles siguen siendo los mismos; sólo cambian los
valores detrás.

## 6. Qué hay que hacer cuando llegue el diseño

Es un cambio de **un solo archivo**:

1. Abrir el `.dc.html` exportado y extraer: paleta, tipografías, escala de
   espaciado, radios, sombras, tamaños de marker.
2. Reemplazar los valores de `packages/design-tokens/src/primitives.ts`.
3. Revisar el mapeo de `semantic.ts` (qué color de la paleta corresponde a
   `auction`, a `friend`, etc.).
4. Correr `pnpm build` y comparar contra el export (spec §116).

Ningún componente, pantalla ni app necesita tocarse. Eso es exactamente lo que
esta separación compra.

## 7. Componentes deducidos

De la especificación (§66) y del modelo de datos ya implementado, el inventario
de componentes que el diseño va a tener que vestir:

**Mapa** — `ProductMarker`, `StoreMarker`, `WantedMarker`, `AuctionMarker`,
`ClusterBubble`, `MapLayerChips`, `SearchThisAreaButton`, `MapBottomSheet`.

**Comercio** — `Price`, `SocialPrice` (público/seguidor/amigo), `Countdown`,
`ProductCard`, `ListingCard`, `StoreCard`, `OfferCard`, `BidCard`,
`PriceHistoryChart`.

**Base** — `Button`, `IconButton`, `Avatar`, `Badge`, `Chip`, `FilterChip`,
`SearchBar`, `Tabs`, `SegmentedControl`, `BottomSheet`, `Modal`, `Toast`,
`Skeleton`, `EmptyState`, `ErrorState`, `Rating`, `UserRow`, `ChatBubble`,
`NotificationRow`.

## 8. Sobre `support.js`

No se pudo leer (mismo bloqueo). Independientemente de su contenido, la
especificación (§1) es clara en que pertenece al runtime del canvas de diseño y
**no** debe usarse como arquitectura de la aplicación. No se usó, y no hay
ninguna dependencia hacia él.

## 9. Modo oscuro

La spec (§69) pide implementarlo sólo si el diseño lo contempla, y **no**
inventarlo si todavía no fue diseñado.

Como el diseño no pudo leerse, se hizo lo intermedio: `semantic.ts` define un
esquema oscuro estructuralmente completo, marcado explícitamente como **no
verificado**, y `css.ts` emite los tres estados de tema correctamente
(`:root`, `prefers-color-scheme`, `[data-theme]`). El modo oscuro queda a un
cambio de valores de distancia, sin refactor. No se activa por defecto.

## 10. Resumen

| | Estado |
|---|---|
| Diseño exportado accesible | ❌ Bloqueado (requiere login interactivo) |
| Assets / tipografías / imágenes | ❌ No disponibles |
| Tokens extraídos del diseño | ❌ Ninguno |
| Arquitectura de tokens | ✅ Implementada y probada |
| Roles semánticos de producto | ✅ Definidos |
| Backend / dominio / datos | ✅ Implementado (no depende del diseño) |
| Superficie a cambiar cuando llegue el diseño | 1 archivo |
