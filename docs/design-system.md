# Design system

> El export de Claude Design no pudo leerse. Los valores actuales son
> **provisionales**. Ver `docs/design-audit.md`.

## Las tres capas

```
primitives.ts   ← ÚNICO archivo con valores visuales crudos
      ↓
semantic.ts     ← roles con significado de producto
      ↓
css.ts          ← CSS custom properties para web y admin
      ↓
componentes     ← nunca leen primitives
```

**Regla:** ningún componente importa `primitives.ts`. Eso es lo que permite
reemplazar el diseño cambiando un archivo.

## Roles semánticos

No son decorativos: codifican significado de producto.

| Rol                   | Qué significa                       |
| --------------------- | ----------------------------------- |
| `sale`                | Venta directa                       |
| `auction`             | Subasta, cuenta regresiva, urgencia |
| `wanted`              | Publicación "Busco"                 |
| `store`               | Tienda                              |
| `friend` / `follower` | Relación social del espectador      |
| `discount`            | Baja de precio, promoción           |
| `mapCluster`          | Burbuja de cluster                  |

Cuando llegue el diseño real, estos roles siguen siendo los mismos; sólo cambian
los valores detrás.

## Cómo aplicar el diseño exportado

1. Extraer del `.dc.html`: paleta, tipografías, escala de espaciado, radios,
   sombras, tamaños de marker.
2. Reemplazar los valores en `packages/design-tokens/src/primitives.ts`.
3. Revisar el mapeo de `semantic.ts`.
4. `pnpm build` y comparar contra el export (spec §116): spacing, tipografía,
   radios, colores, sombras, tamaño de markers, proporción de cards.

## Modo oscuro

`semantic.ts` define un esquema oscuro estructuralmente completo pero **no
verificado**, porque nunca fue diseñado. `css.ts` emite los tres estados de tema
correctamente (`:root`, `prefers-color-scheme`, `[data-theme]`), así que
activarlo es cambiar valores, no refactorizar. No está activo por defecto.

## Accesibilidad

Lo que ya está implementado:

- Objetivo táctil mínimo de 44px, en tokens (`--touch-target-min`).
- `:focus-visible` en todo lo interactivo, y skip link.
- El mapa se navega con teclado: flechas para desplazar, `+`/`−` para zoom.
- Cada marker tiene una etiqueta legible por lector de pantalla — un pin sin
  texto es invisible para tecnología asistiva.
- Los countdown se anuncian como "2 horas y 5 minutos", no como "02:05".
- Estados de carga con `aria-busy` y `aria-live`.
- `prefers-reduced-motion` respetado globalmente.
- Cifras tabulares en precios y timers para que no salten al actualizarse.

Pendiente: auditoría de contraste contra la paleta definitiva (no tiene sentido
hacerla contra valores provisionales) y dynamic type en mobile.
