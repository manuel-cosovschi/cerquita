# Auditoría de diseño

Estado: **export recibido y tokens aplicados**. Última actualización: 2026-08-14.

Fuente: `design-reference/concepto-a-map-first/` (handoff bundle de Claude Design,
entregado por el usuario). El bundle original se conserva sin modificar, como
pide la spec §112.

---

## 1. Qué contiene el bundle

| Archivo | Qué es |
|---|---|
| `Cerquita - Design Exploration Board.dc.html` | El diseño. 40 KB, leído completo. |
| `support.js` | Runtime del canvas de Claude Design. Generado, "do not edit". |
| `tile-test.html` | Experimento de filtros sobre tiles de OpenStreetMap. |
| `.thumbnail` | Miniatura del board. |

**`support.js` no se usó.** Es el runtime del visor (`GENERATED from
dc-runtime/src/*.ts`), exactamente lo que la spec §1 anticipaba. No hay ninguna
dependencia hacia él.

## 2. Las siete direcciones

El segundo bundle (182 KB, vs 37 KB del primero) sí trae las siete:

| | Dirección | Idea |
|---|---|---|
| 1a | Map first | El mapa es la app, todo lo demás flota encima |
| 1b | Marketplace + mapa | Grilla primero, el mapa es una vista más |
| 1c | Social commerce | Personas antes que objetos, feed a pantalla completa |
| 1d | Minimal / premium | Editorial, mucho aire, tipografía haciendo el trabajo |
| 1e | Cámara first | Apuntás el teléfono a la calle y ves qué se vende |
| 1f | Búsqueda conversacional | Escribís lo que necesitás y el mapa se reconfigura |
| 1g | "Ahora" | Feed de tiempo real: subastas, bajas, gente buscando |

El usuario pidió una mezcla de **1a + 1c**. La propuesta de síntesis está en §9.

Además, el board declara explícitamente que su branding es descartable:

> *"Sorteé paleta, tipografía y radio por dirección a propósito, para que ninguna
> herede mis defaults. Es branding provisional y descartable: primero UX, después
> identidad."*

Y cierra proponiendo: *"llevá 1a a las 5 pantallas"*, *"mezclá el mapa de 1a con
la navegación de otra"*.

**Lectura:** esto es una ronda de exploración, no un diseño cerrado. Lo que sí es
intención real de diseño es el **layout y la interacción** de 1a. Los **hues
específicos** son deliberadamente arbitrarios y están pensados para reemplazarse
cuando se elija dirección.

Por eso los tokens se aplicaron tal cual el export, pero `primitives.ts` lleva
esa advertencia escrita arriba: el layout es definitivo, la paleta no.

## 3. Dirección 1a — "Map first"

Tres pantallas, 390×844: **Mapa**, **Búsqueda "PS5"**, **Producto**.

### Navegación

Dock **flotante** de 5 (Mapa · Feed · **+** · Chats · Perfil), no una barra fija:
inset 14px de los bordes, 34px del fondo, alto 70, radio 34, con `backdrop-filter:
blur(14px)`. Publicar es el FAB naranja del centro, 58×58.

El mapa **nunca se abandona**: búsqueda y producto llegan como bottom sheets que
lo tapan parcialmente.

### Mapa

- Tiles reales de OSM (Mar del Plata) **desaturados y cálidos**:
  `saturate(.55) contrast(.96) brightness(1.04)`, más un lavado naranja al 7%.
- **Markers = foto + burbuja de precio colgando**, no pills de texto. Miniatura
  62×62 radio 24, con anillo blanco de 3px; la burbuja de precio solapa 9px hacia
  arriba; el caption (distancia o etiqueta) va debajo.
- **Relación por anillo**: amigo = anillo turquesa. Subasta = burbuja naranja con
  timer. "Busca" = pill blanca con avatar `?` y contorno turquesa.
- **Clusters** = círculos negros con número y halo translúcido (52 y 40 px).
- Ubicación propia = punto azul con pulso de 2,4 s.
- Chip "AHORA · 6" en negro, arriba a la derecha.
- "Buscar en esta zona" flota sobre el dock.

### Paleta

| Rol | Valor | Nota |
|---|---|---|
| Tinta | `#141210` | Casi negro **cálido**, nunca negro puro |
| Canvas | `#f6f2ea` | Crema, no blanco |
| Superficie | `#ffffff` | |
| Acento | `oklch(.74 .17 55)` → `#fa8927` | Naranja: subastas, urgencia, publicar |
| Texto sobre acento | `#241403` | **Oscuro**, no blanco |
| Social | `oklch(.66 .12 190)` → `#00a9a2` | Turquesa: **sólo** relación de amistad |
| Precio de amigo | `oklch(.42 .1 190)` → `#005d59` | |
| Info | `oklch(.6 .17 255)` → `#2a80e2` | Ubicación propia y verificado |

Un detalle que cambia el mapeo: **el botón primario es la tinta, no el naranja**.
"Comprar ahora" es negro; "Ofertar" es naranja. Así que `brand` = tinta y el
naranja queda como `accent`.

Otro: la venta directa **no tiene color propio** — es el default de tinta. El
color está reservado para lo que se desvía: subasta, amigo, busca.

### Tipografía

Dos familias con trabajos distintos, y mezclarlas es el recurso principal:

- **Bricolage Grotesque 800** — wordmark, precios, contadores ("37 cerca tuyo").
- **Archivo 400/500/600/700** — todo lo demás.
- Monospace — timers y captions técnicos.

### Radios

"Radio 28 · burbujas y pills". Nada es cuadrado: pills y botones 28, cards 26,
sheets y dock 34, miniatura de marker 24, thumb de card 20, burbuja de precio 14.

### Sombras

Grandes, suaves y de **spread negativo** — leen como elevación, no como borde.
Los markers además llevan un **anillo sólido**, que es lo que los separa del mapa.

## 4. Qué se cambió en el código

Un solo archivo de valores, como estaba prometido:

- `packages/design-tokens/src/primitives.ts` — reescrito con los valores reales.
  Suma escalas que el export exige y antes no existían: `ring`, `layout`,
  `mapTiles`.
- `packages/design-tokens/src/semantic.ts` — remapeo de roles. Los cambios de
  fondo: `brand` pasó de verde a tinta, `sale` dejó de tener color propio,
  `auction` es el naranja y `friend` el turquesa.
- `packages/design-tokens/src/css.ts` — emite las escalas nuevas.
- `apps/web` — carga las dos tipografías y usa la display para precios.

**Ningún componente ni pantalla se tocó.** Eso era exactamente lo que la
separación primitives/semantic compraba.

## 5. Diferencias con lo ya construido

La web actual **no** implementa 1a todavía. Lo que difiere:

| | Construido | Diseño 1a |
|---|---|---|
| Markers | Pill con texto | Foto + burbuja de precio colgando |
| Navegación | Header web | Dock flotante de 5 con FAB central |
| Layout | Split desktop | Mobile, sheets sobre el mapa |
| Tiles | Grilla de referencia | OSM desaturado y cálido |

Los tokens ya son correctos; falta rehacer los componentes sobre ellos.

## 6. Ambigüedades que conviene resolver antes de seguir

1. **¿1a es la dirección elegida?** Es la única del bundle, pero el board se
   presenta como ronda de exploración de siete. Si faltan las otras seis,
   conviene verlas antes de reconstruir pantallas.
2. **¿La paleta se congela?** El propio board la declara descartable. Está
   aplicada, pero si va a cambiar, conviene que cambie antes de la UI.
3. **Desktop no está diseñado.** 1a es mobile (390×844). La spec §60 pide un
   desktop que no sea mobile ampliado, y eso no está en el export.
4. **Faltan pantallas.** El board dice que feed y crear-publicación se harían
   "sobre las 2 o 3 finalistas".
5. **Dark mode no existe.** El bundle sólo trae un experimento de tiles oscuros
   (`tile-test.html`), no pantallas. Los tokens oscuros están listos pero
   marcados como **no verificados**.
6. **Fotos.** El board las marca como placeholders rayados: *"si me pasás fotos
   reales las cambio"*.

## 7. Modo oscuro

`tile-test.html` prueba `invert(1) hue-rotate(180deg) saturate(.55)
brightness(.9) contrast(1.05)` sobre los tiles — un candidato de mapa oscuro.
Quedó guardado como `mapTiles.filterDarkCandidate`, marcado como no aprobado.

## 8. Resumen

| | Estado |
|---|---|
| Export accesible | ✅ Recibido |
| Leído completo | ✅ Board + support.js + tile-test |
| Tokens extraídos | ✅ Color, tipografía, radios, sombras, geometría de markers |
| Aplicados al código | ✅ 1 archivo de valores + remapeo semántico |
| Pantallas reconstruidas sobre 1a | ⬜ Pendiente |
| Direcciones faltantes | ⚠️ 6 de 7 no están en el bundle |
| Paleta definitiva | ⚠️ El board la declara provisional |
| Desktop y dark mode | ⬜ No diseñados |
